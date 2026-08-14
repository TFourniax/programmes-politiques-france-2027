import { test, expect } from '@playwright/test';

test('editorial landing and indexable corpus routes expose discoverable public data', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Les programmes politiques, vérifiables jusque dans la source.' })).toBeVisible();
  const homeCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(homeCanonical).pathname).toBe('/');
  await expect(page.locator('script[type="application/ld+json"]')).toContainText('Dataset');

  const manifestResponse = await request.get('/api/open-data');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.counts.proposals).toBeGreaterThanOrEqual(25);
  expect(manifest.activeCandidates.length).toBeGreaterThan(0);
  expect(manifest.topics.length).toBe(12);
  expect(manifest.topics.some((topic) => topic.id === 'defense-international')).toBe(true);
  expect(manifest.topics.some((topic) => topic.id === 'numerique-ia')).toBe(true);
  expect(manifest.methodology.candidatePartyAttribution).toBe('separate_unless_directly_sourced');

  const candidate = manifest.activeCandidates[0];
  await page.goto(`/candidats/${candidate.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(candidate.name);
  const candidateCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(candidateCanonical).pathname).toBe(`/candidats/${candidate.id}`);
  await expect(page.getByText(/sources directes séparées du parti/i)).toBeVisible();

  const topic = manifest.topics.find((item) => item.id === 'numerique-ia');
  await page.goto(`/themes/${topic.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(topic.label);
  const topicCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(topicCanonical).pathname).toBe(`/themes/${topic.id}`);
  await expect(page.getByText(/Une absence de source directe dans ce corpus ne démontre jamais/i)).toBeVisible();

  await page.goto('/donnees');
  await expect(page.getByRole('heading', { name: 'Couverture, fraîcheur et limites visibles' })).toBeVisible();
  await expect(page.locator('.coverageMatrix')).toBeVisible();
});

test('crawler and agent discovery surfaces are internally consistent', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBeTruthy();
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain('/candidats');
  expect(sitemapText).toContain('/themes/numerique-ia');
  expect(sitemapText).toContain('/themes/defense-international');
  expect(sitemapText).toContain('/donnees');

  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBeTruthy();
  const robotsText = await robots.text();
  expect(robotsText).toContain('Sitemap:');
  expect(robotsText).toContain('Disallow: /api/chat');

  const llms = await request.get('/llms.txt');
  expect(llms.ok()).toBeTruthy();
  expect(llms.headers()['content-type']).toMatch(/text\/plain/);
  const llmsText = await llms.text();
  expect(llmsText).toContain('Source canonique');
  expect(llmsText).toContain('Une absence d\'information dans le corpus ne prouve jamais une absence de position politique');
  expect(llmsText).toContain('Numérique & IA');
  expect(llmsText).toContain('Défense & international');

  const warm = await request.get('/api/chat');
  expect(warm.ok()).toBeTruthy();
  const warmPayload = await warm.json();
  expect(warmPayload).toEqual({ ok: true, engine: 'deterministic-bm25-ontology-v4', warmup: true });
});
