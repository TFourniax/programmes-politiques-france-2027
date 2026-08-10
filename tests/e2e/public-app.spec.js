import { test, expect } from '@playwright/test';

test('homepage exposes the six neutral exploration modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Comprendre avant de choisir.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: "Modes d'exploration" })).toBeVisible();
  for (const label of ['Questionner', 'Comparer', 'Candidats', 'Thèmes', 'Boussole', 'Quiz']) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }
  await expect(page.getByText(/Une donnée absente du corpus n’est jamais interprétée comme une opposition/)).toBeVisible();
});

test('personality, comparison, topic and quiz views load from the corpus API', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Candidats/ }).click();
  await expect(page.getByText('Fiches personnalités')).toBeVisible();
  const personalitySelect = page.locator('.explorerSelectLabel select').first();
  await personalitySelect.selectOption({ index: 1 });
  await expect(page.locator('.candidateProfileHero')).toBeVisible();
  await expect(page.getByText(/pas encore candidat officiel au sens du Conseil constitutionnel/)).toBeVisible();
  await page.getByRole('button', { name: /Comparer/ }).click();
  const selectors = page.locator('.candidateSlots select');
  await selectors.nth(0).selectOption({ index: 1 });
  await selectors.nth(1).selectOption({ index: 2 });
  await expect(page.locator('.comparisonTable')).toBeVisible();
  await page.getByRole('button', { name: /^Thèmes/ }).click();
  await expect(page.getByText('Explorateur thématique')).toBeVisible();
  await expect(page.locator('.topicCandidateList')).toBeVisible();
  await page.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByText('Quiz de compréhension')).toBeVisible();
  await expect(page.locator('.quizCard')).toBeVisible();
});

test('health endpoint exposes a populated and dated corpus', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.counts.candidates).toBeGreaterThanOrEqual(40);
  expect(payload.counts.documents).toBeGreaterThanOrEqual(20);
  expect(payload.counts.proposals).toBeGreaterThanOrEqual(25);
  expect(payload.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
