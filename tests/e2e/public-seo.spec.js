import { test, expect } from '@playwright/test';

test('editorial landing and indexable corpus routes expose discoverable public data', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Les programmes politiques, documentés jusque dans la source.' })).toBeVisible();
  await expect(page.getByText('Open source & auditable', { exact: true })).toBeVisible();
  await expect(page.getByText('Retrieval sans invention', { exact: true })).toBeVisible();
  await expect(page.getByText(/aucun LLM ne l’invente/i)).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Mises à jour' })).toBeVisible();
  const homeCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(homeCanonical).pathname).toBe('/');
  const datasetJsonLd = JSON.parse(await page.locator('script[type="application/ld+json"]').first().textContent());
  expect(datasetJsonLd['@context']).toBe('https://schema.org');
  expect(datasetJsonLd['@type']).toBe('Dataset');
  expect(datasetJsonLd.name).toContain('France 2027');
  expect(datasetJsonLd.sameAs).toContain('github.com/TFourniax/programmes-politiques-france-2027');
  expect(datasetJsonLd.measurementTechnique).toMatch(/retrieval déterministe/i);

  const manifestResponse = await request.get('/api/open-data');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.sourceOfTruth).toBe('versioned_markdown_yaml');
  expect(manifest.canonicalData).toContain('registries/candidates.yaml');
  expect(manifest.canonicalData).toContain('registries/documents.yaml');
  expect(manifest.canonicalData).toContain('corpus/2027/**/*.md');
  expect(manifest.canonicalData).toContain('proposals/**/*.md');
  expect(manifest.canonicalData).not.toContain('data/entities.json');
  expect(manifest.discoveryViews).toContain('data/entities.json');
  expect(manifest.discoveryViews).toContain('data/compass.json');
  expect(manifest.discoveryViews.some((item) => item.startsWith('generated/evidence-graph.json'))).toBe(true);
  expect(manifest.researchInfrastructure.schemas).toHaveLength(4);
  expect(manifest.publicEndpoints.updates).toContain('/mises-a-jour');
  expect(manifest.counts.proposals).toBeGreaterThanOrEqual(25);
  expect(manifest.activeCandidates.length).toBeGreaterThan(0);
  expect(manifest.topics.length).toBe(12);
  expect(manifest.topics.some((topic) => topic.id === 'defense-international')).toBe(true);
  expect(manifest.topics.some((topic) => topic.id === 'numerique-ia')).toBe(true);
  expect(manifest.methodology.answerGeneration).toBe('deterministic_extractive');
  expect(manifest.methodology.candidatePartyAttribution).toBe('party_programme_only_for_official_party_candidate_with_source_provenance_preserved');
  expect(manifest.methodology.partyProgrammeEligibleStatuses).toEqual(['party_designated', 'official_candidate']);

  const candidate = manifest.activeCandidates[0];
  await page.goto(`/candidats/${candidate.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(candidate.name);
  const candidateCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(candidateCanonical).pathname).toBe(`/candidats/${candidate.id}`);
  await expect(page.getByText(/attribution vérifiable/i)).toBeVisible();

  const topic = manifest.topics.find((item) => item.id === 'numerique-ia');
  await page.goto(`/themes/${topic.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(topic.label);
  const topicCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(topicCanonical).pathname).toBe(`/themes/${topic.id}`);
  await expect(page.getByText(/Une absence de source attribuable dans ce corpus ne démontre jamais/i)).toBeVisible();

  await page.goto('/mises-a-jour');
  await expect(page.getByRole('heading', { name: 'Mises à jour du corpus' })).toBeVisible();
  await expect(page.locator('.seoEvidence').first()).toBeVisible();
  await expect(page.getByText('Chapitre 4 : Étendre le domaine de la liberté', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/capture_fallback/)).toBeVisible();
  const updatesCanonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  expect(new URL(updatesCanonical).pathname).toBe('/mises-a-jour');

  await page.goto('/donnees');
  await expect(page.getByRole('heading', { name: 'Couverture, fraîcheur et limites visibles' })).toBeVisible();
  await expect(page.locator('.coverageMatrix')).toBeVisible();
  await expect(page.getByText(/source de vérité : Markdown\/YAML versionnés/i)).toBeVisible();

  const firstTopic = manifest.topics[0];
  const matrixCovered = await page.evaluate((label) => {
    const table = document.querySelector('.coverageMatrix table');
    if (!table) return null;
    const headers = [...table.querySelectorAll('thead th')].map((node) => node.textContent.trim());
    const column = headers.indexOf(label);
    if (column < 1) return null;
    return [...table.querySelectorAll('tbody tr')].filter((row) => {
      const cell = row.children[column];
      const state = cell?.querySelector('.coverageState');
      return state?.classList.contains('documented') || state?.classList.contains('partial');
    }).length;
  }, firstTopic.label);
  expect(matrixCovered).not.toBeNull();
  const topicCard = page.locator('.seoCard').filter({ hasText: firstTopic.label }).first();
  await expect(topicCard).toContainText(`${matrixCovered} candidature(s) active(s) avec preuve attribuable`);
});

test('party programme attribution is allowed only for the officially designated party candidate', async ({ page, request }) => {
  const manifest = await (await request.get('/api/open-data')).json();
  const designated = manifest.activeCandidates.find((candidate) => candidate.status === 'party_designated' && candidate.partyProgrammeAttributable);
  expect(designated).toBeTruthy();
  await page.goto(`/candidats/${designated.id}`);
  await expect(page.getByText(/Programme du parti attribuable/i).first()).toBeVisible();
  await expect(page.getByText(/officiellement désignée|officiellement désigné/i).first()).toBeVisible();

  const notDesignated = manifest.activeCandidates.find((candidate) => candidate.partyId && !candidate.partyProgrammeAttributable);
  expect(notDesignated).toBeTruthy();
  await page.goto(`/candidats/${notDesignated.id}`);
  await expect(page.getByText(/Programme du parti attribuable/i)).toHaveCount(0);
});

test('historical evidence is visibly labeled on current candidate pages', async ({ page }) => {
  const response = await page.goto('/candidats/marine-le-pen');
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole('heading', { level: 1, name: 'Marine Le Pen' })).toBeVisible();
  await expect(page.getByText('Historique du parti', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Versions antérieures conservées pour la traçabilité' })).toBeVisible();
  await expect(page.getByText('Programme législatif 2024 du Rassemblement national', { exact: true })).toBeVisible();
  await expect(page.getByText(/document archivé — contexte historique/i)).toBeVisible();
  await expect(page.getByText(/Ces sources ne sont pas utilisées comme positions actuelles/i)).toBeVisible();
});

test('crawler and agent discovery surfaces are internally consistent', async ({ request }) => {
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.ok()).toBeTruthy();
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain('/candidats');
  expect(sitemapText).toContain('/themes/numerique-ia');
  expect(sitemapText).toContain('/themes/defense-international');
  expect(sitemapText).toContain('/mises-a-jour');
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
  expect(llmsText).toContain('registries/candidates.yaml');
  expect(llmsText).toContain('registries/documents.yaml');
  expect(llmsText).toContain('Vues de découverte dérivées, non canoniques');
  expect(llmsText).toContain('data/entities.json');
  expect(llmsText).toContain('generated/evidence-graph.json');
  expect(llmsText).toContain('CITATION.cff');
  expect(llmsText).toContain('/mises-a-jour');
  expect(llmsText).toContain('Une absence d\'information dans le corpus ne prouve jamais une absence de position politique');
  expect(llmsText).toContain('Numérique & IA');
  expect(llmsText).toContain('Défense & international');

  const warm = await request.get('/api/chat');
  expect(warm.ok()).toBeTruthy();
  const warmPayload = await warm.json();
  expect(warmPayload).toEqual({ ok: true, engine: 'deterministic-bm25-ontology-v4', warmup: true });
});
