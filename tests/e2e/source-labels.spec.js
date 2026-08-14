import { test, expect } from '@playwright/test';

const INTERNAL_ENUMS = /tier_[1-4]_|declared_presidential|explicit_but_|capture_fallback|candidate_status|party_designated|declared_conditional/i;

test('source details use public French labels instead of internal enums', async ({ page }) => {
  await page.goto('/');
  const textarea = page.locator('textarea');
  await textarea.fill('Que propose Renaissance sur le nucléaire ?');
  await page.locator('button.send').click();

  const answer = page.locator('.message.structuredMessage').last();
  await expect(answer).toBeVisible();
  await expect(answer.getByRole('button', { name: 'Source 1' }).first()).toBeVisible();
  await answer.getByRole('button', { name: 'Source 1' }).first().click();

  const panel = page.locator('.sourcesPanel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(/source primaire officielle|document source|proposition documentée/i);
  await expect(panel).not.toContainText(INTERNAL_ENUMS);

  await expect(answer).toContainText(/Réponse limitée aux éléments sourcés du corpus/i);
  await expect(page.locator('.messageMeta').last()).toContainText(/Réponse vérifiée à partir du corpus/i);
});

test('candidate and history explorers never expose storage enums', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Candidats/ }).click();
  const candidateSelect = page.locator('.explorerSelectLabel select').first();
  await candidateSelect.selectOption({ index: 1 });
  const candidateProfile = page.locator('.candidateProfile');
  await expect(candidateProfile).toBeVisible();
  await expect(candidateProfile).not.toContainText(INTERNAL_ENUMS);
  await expect(candidateProfile).toContainText(/niveau de preuve|candidat officiel/i);

  await page.getByRole('button', { name: /^Historique/ }).click();
  const historySelects = page.locator('.historyFilters select');
  await historySelects.nth(0).selectOption('renaissance');
  await historySelects.nth(1).selectOption('nucleaire');
  const timeline = page.locator('.timeline');
  await expect(timeline.locator('.timelineEvent').first()).toBeVisible();
  await expect(timeline).not.toContainText(INTERNAL_ENUMS);
  await expect(timeline).toContainText(/source primaire officielle|version actuelle|formulation explicite|niveau de preuve/i);
});

test('homepage freshness copy is explicit and human-readable', async ({ page }) => {
  await page.goto('/');
  const pulse = page.locator('.publicPulse');
  await expect(pulse).toContainText(/Instantané canonique/i);
  await expect(pulse).toContainText(/\d{1,2}\s+[A-Za-zÀ-ÿ]+\s+20\d{2}/);
  await expect(pulse).toContainText(/Voir la couverture, la fraîcheur et les limites/i);
  await expect(page.locator('.chatHeader')).toContainText(/Corpus prêt|vérification du corpus/);
});
