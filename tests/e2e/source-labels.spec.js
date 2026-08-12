import { test, expect } from '@playwright/test';

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
  await expect(panel).not.toContainText(/tier_[1-4]_|declared_presidential|explicit_but_|capture_fallback|candidate_status/i);

  await expect(answer).toContainText(/Réponse limitée aux éléments sourcés du corpus/i);
  await expect(page.locator('.messageMeta').last()).toContainText(/Réponse vérifiée à partir du corpus/i);
});

test('homepage freshness copy is explicit and human-readable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.warning')).toContainText(/Données du corpus actualisées jusqu’au \d{4}-\d{2}-\d{2}/);
  await expect(page.locator('.chatHeader')).toContainText(/Corpus prêt|vérification du corpus/);
});
