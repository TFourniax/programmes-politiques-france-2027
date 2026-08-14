import { test, expect } from '@playwright/test';

const INTERNAL_TECH_COPY = /(?:tier_[1-4]_|capture_fallback|generated_by|internal_database|stack trace|ECONN|TypeError|HTTP 5\d\d)/i;

test('composer is understandable, keyboard friendly and exposes a polite loading state', async ({ page }) => {
  await page.goto('/?mode=chat#explorer');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  const send = page.getByRole('button', { name: 'Envoyer la question' });
  await expect(textarea).toBeVisible();
  await expect(send).toBeDisabled();

  await textarea.fill('Que propose Renaissance sur le nucléaire ?');
  await expect(send).toBeEnabled();
  await textarea.press('Enter');
  await expect(page.getByRole('status')).toContainText(/Recherche dans les sources du corpus/i);
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  await expect(textarea).toHaveValue('');

  const answer = page.locator('.message.structuredMessage').first();
  await expect(answer).toContainText(/Renaissance/i);
  await expect(answer).not.toContainText(INTERNAL_TECH_COPY);
  await expect(answer.getByRole('button', { name: /Source 1/ }).first()).toBeVisible();
});

test('a failed request is explained in plain language without leaking technical internals', async ({ page }) => {
  await page.route('**/api/chat', async route => {
    if (route.request().method() === 'GET') {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'internal_database_connection_failed HTTP 503' })
    });
  });
  await page.goto('/?mode=chat#explorer');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill('Que propose le PS sur les retraites ?');
  await page.getByRole('button', { name: 'Envoyer la question' }).click();
  const lastAssistant = page.locator('.message.assistant').last();
  await expect(lastAssistant).toContainText('Le service n’a pas pu répondre pour le moment. Réessayez dans quelques instants.');
  await expect(lastAssistant).not.toContainText(INTERNAL_TECH_COPY);
  await expect(page.getByText('Service indisponible')).toBeVisible();
});

test('mode navigation is reversible with browser history while filters stay lightweight', async ({ page }) => {
  await page.goto('/?mode=chat#explorer');
  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(page).toHaveURL(/mode=history/);
  await expect(page.getByText('Historique des positions')).toBeVisible();
  await page.getByRole('button', { name: /^Recherche/ }).click();
  await expect(page).toHaveURL(/mode=chat/);
  await page.goBack();
  await expect(page).toHaveURL(/mode=history/);
  await expect(page.getByText('Historique des positions')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/mode=chat/);
  await expect(page.getByText('Recherche libre dans le corpus')).toBeVisible();
});

test('a contextual suggestion behaves like a real next user question', async ({ page }) => {
  await page.goto('/?mode=chat#explorer');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill("Quel projet propose d'abroger Parcoursup ?");
  await textarea.press('Enter');
  const answers = page.locator('.message.structuredMessage');
  await expect(answers).toHaveCount(1);
  const first = answers.first();
  const followUp = first.locator('.followUps button').first();
  await expect(followUp).toBeVisible();
  const label = (await followUp.innerText()).replace('↗', '').trim();
  expect(label).toMatch(/\?$/);
  await followUp.click();
  await expect(answers).toHaveCount(2);
  await expect(answers.nth(1)).not.toContainText(INTERNAL_TECH_COPY);
  await expect(answers.nth(1).getByRole('button', { name: /Source 1/ }).first()).toBeVisible();
});

test('critical mobile interactions remain readable and tappable', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'));
  await page.goto('/?mode=chat#explorer');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  const send = page.getByRole('button', { name: 'Envoyer la question' });
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox.width).toBeGreaterThanOrEqual(36);
  expect(sendBox.height).toBeGreaterThanOrEqual(36);

  await textarea.fill("Quelles propositions sont documentées sur le pouvoir d'achat et les salaires ?");
  await textarea.press('Enter');
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    clipped: [...document.querySelectorAll('.structuredAnswer, .answerCard, .followUps button')]
      .filter(el => el.scrollWidth > el.clientWidth + 2)
      .map(el => ({ cls: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }))
  }));
  expect(dimensions.doc).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(dimensions.clipped).toEqual([]);
});
