import { test, expect } from '@playwright/test';

async function askRetirementQuestion(page) {
  await page.goto('/');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill('Que propose le corpus sur les retraites ?');
  await page.getByRole('button', { name: 'Envoyer la question' }).click();
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  await expect(page.getByText('Réponse du corpus', { exact: true })).toBeVisible();
}

test('a substantive corpus answer can expand and collapse without creating a second chat message', async ({ page }) => {
  await askRetirementQuestion(page);
  const message = page.locator('.message.structuredMessage').first();
  const compactBullets = await message.locator('.answerBullets li').count();
  const deepen = message.getByRole('button', { name: /Approfondir/ });
  await expect(deepen).toBeVisible();
  await expect(message.getByText(/Afficher davantage de détails vérifiés du corpus/)).toBeVisible();

  await deepen.click();
  await expect(message.getByText('Réponse approfondie du corpus', { exact: true })).toBeVisible();
  await expect(message.getByRole('button', { name: /Réduire/ })).toBeVisible();
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  const deepBullets = await message.locator('.answerBullets li').count();
  expect(deepBullets).toBeGreaterThanOrEqual(compactBullets);

  await message.getByRole('button', { name: /Réduire/ }).click();
  await expect(message.getByText('Réponse du corpus', { exact: true })).toBeVisible();
  await expect(message.getByRole('button', { name: /Approfondir/ })).toBeVisible();
});

test('deep answer stays inside the viewport on mobile and desktop', async ({ page }) => {
  await askRetirementQuestion(page);
  const message = page.locator('.message.structuredMessage').first();
  await message.getByRole('button', { name: /Approfondir/ }).click();
  await expect(message.getByText('Réponse approfondie du corpus', { exact: true })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
  expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
});
