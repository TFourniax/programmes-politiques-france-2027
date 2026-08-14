import { test, expect } from '@playwright/test';

async function askRetirementQuestion(page) {
  await page.goto('/');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill('Que propose le corpus sur les retraites ?');
  await page.getByRole('button', { name: 'Envoyer la question' }).click();
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  await expect(page.getByText('Réponse du corpus', { exact: true })).toBeVisible();
}

test('deep dive belongs to each card and expands independently inside that card', async ({ page }) => {
  await askRetirementQuestion(page);
  const message = page.locator('.message.structuredMessage').first();
  const cardButtons = message.locator('.answerCard .deepDiveControl button');
  await expect(cardButtons.first()).toBeVisible();
  expect(await cardButtons.count()).toBeGreaterThan(0);
  await expect(message.locator(':scope > .deepDiveControl')).toHaveCount(0);

  const firstCard = message.locator('.answerCard').filter({ has: page.getByRole('button', { name: /Approfondir/ }) }).first();
  const compactBullets = await firstCard.locator('.answerBullets li').count();
  await expect(firstCard.getByRole('button', { name: /Approfondir/ })).toBeVisible();
  await expect(firstCard.getByText(/Afficher davantage de détails vérifiés pour cette card/)).toBeVisible();

  await firstCard.getByRole('button', { name: /Approfondir/ }).click();
  await expect(firstCard.getByRole('button', { name: /Réduire/ })).toBeVisible();
  await expect(firstCard.locator('.answerCardDeepDetails')).toBeVisible();
  await expect(message.getByText('Réponse du corpus', { exact: true })).toBeVisible();
  await expect(message.getByText('Réponse approfondie du corpus', { exact: true })).toHaveCount(0);
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  const deepBullets = await firstCard.locator('.answerBullets li').count();
  expect(deepBullets).toBeGreaterThanOrEqual(compactBullets);

  const expandableCards = message.locator('.answerCard').filter({ has: page.locator('.deepDiveControl button') });
  if (await expandableCards.count() > 1) {
    const secondCard = expandableCards.nth(1);
    await expect(secondCard.getByRole('button', { name: /Approfondir/ })).toBeVisible();
    await expect(secondCard.locator('.answerCardDeepDetails')).toHaveCount(0);
  }

  await firstCard.getByRole('button', { name: /Réduire/ }).click();
  await expect(firstCard.locator('.answerCardDeepDetails')).toHaveCount(0);
  await expect(firstCard.getByRole('button', { name: /Approfondir/ })).toBeVisible();
});

test('an expanded card stays inside the viewport on mobile and desktop', async ({ page }) => {
  await askRetirementQuestion(page);
  const message = page.locator('.message.structuredMessage').first();
  const firstCard = message.locator('.answerCard').filter({ has: page.getByRole('button', { name: /Approfondir/ }) }).first();
  await firstCard.getByRole('button', { name: /Approfondir/ }).click();
  await expect(firstCard.locator('.answerCardDeepDetails')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
});
