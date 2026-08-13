import { test, expect } from '@playwright/test';

const SMOKE_PROJECTS = new Set(['firefox-smoke', 'webkit-smoke', 'mobile-webkit-smoke']);

test('cross-browser chat smoke', async ({ page }, testInfo) => {
  test.skip(!SMOKE_PROJECTS.has(testInfo.project.name));
  await page.goto('/?mode=chat');
  await expect(page.getByRole('heading', { name: 'Comprendre avant de choisir.' })).toBeVisible();
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill('Que propose le corpus sur les retraites ?');
  await textarea.press('Enter');
  const answer = page.locator('.message.structuredMessage').first();
  await expect(answer).toBeVisible();
  await expect(answer.getByRole('button', { name: /Source 1/ }).first()).toBeVisible();
  const dims = await page.evaluate(() => ({ viewport: innerWidth, doc: document.documentElement.scrollWidth }));
  expect(dims.doc).toBeLessThanOrEqual(dims.viewport + 2);
});

test('cross-browser deep answer smoke', async ({ page }, testInfo) => {
  test.skip(!SMOKE_PROJECTS.has(testInfo.project.name));
  await page.goto('/?mode=chat');
  const textarea = page.getByRole('textbox', { name: 'Votre question' });
  await textarea.fill('Que propose le corpus sur les retraites ?');
  await textarea.press('Enter');
  const answer = page.locator('.message.structuredMessage').first();
  const deepen = answer.getByRole('button', { name: /Approfondir/ });
  await expect(deepen).toBeVisible();
  await deepen.click();
  await expect(answer.getByRole('button', { name: /Réduire/ })).toBeVisible();
});
