import { test, expect } from '@playwright/test';

test('homepage exposes the seven neutral exploration modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Les programmes politiques, vérifiables jusque dans la source.' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: "Modes d'exploration" })).toBeVisible();
  for (const label of ['Recherche', 'Comparer', 'Candidats', 'Thèmes', 'Historique', 'Boussole', 'Quiz']) {
    await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  }
  await expect(page.getByText(/Une case vide signifie « non encore documenté ici », jamais « position inexistante »/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Candidats' }).first()).toHaveAttribute('href', '/candidats');
  await expect(page.getByRole('link', { name: 'Thèmes' }).first()).toHaveAttribute('href', '/themes');
  await expect(page.getByRole('link', { name: 'Données & méthode' }).first()).toHaveAttribute('href', '/donnees');
});

test('personality, comparison, topic, history and quiz views load from corpus APIs', async ({ page }) => {
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

  await page.getByRole('button', { name: /^Historique/ }).click();
  await expect(page.getByText('Historique des positions')).toBeVisible();
  const historySelects = page.locator('.historyFilters select');
  await historySelects.nth(0).selectOption('renaissance');
  await historySelects.nth(1).selectOption('nucleaire');
  await expect(page.getByRole('heading', { name: 'Évolution documentée' })).toBeVisible();
  await expect(page.locator('.timelineEvent').first()).toBeVisible();
  await expect(page.getByText(/ordre des dates seul|simple différence de date|n’est jamais interprété/i).first()).toBeVisible();

  await page.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByText('Quiz de compréhension')).toBeVisible();
  await expect(page.locator('.quizCard')).toBeVisible();
});

test('dense public views remain inside a phone viewport', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'));
  await page.goto('/');

  async function expectNoHorizontalOverflow() {
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
    expect(dimensions.bodyWidth).toBeLessThanOrEqual(dimensions.viewport + 2);
  }

  await expectNoHorizontalOverflow();
  await page.getByRole('button', { name: /Comparer/ }).click();
  const selectors = page.locator('.candidateSlots select');
  await selectors.nth(0).selectOption({ index: 1 });
  await selectors.nth(1).selectOption({ index: 2 });
  await expect(page.locator('.comparisonTable')).toBeVisible();
  await expectNoHorizontalOverflow();

  await page.getByRole('button', { name: /^Historique/ }).click();
  const historySelects = page.locator('.historyFilters select');
  await historySelects.nth(0).selectOption('renaissance');
  await historySelects.nth(1).selectOption('nucleaire');
  await expect(page.locator('.timelineEvent').first()).toBeVisible();
  await expectNoHorizontalOverflow();

  await page.getByRole('button', { name: /^Recherche/ }).click();
  const textarea = page.locator('textarea');
  await textarea.fill("Quelles propositions sont documentées sur le pouvoir d'achat et les salaires ?");
  await page.locator('button.send').click();
  await expect(page.locator('.message.structuredMessage')).toHaveCount(1);
  await expectNoHorizontalOverflow();
});

test('health endpoint exposes corpus, watch and safe chat readiness', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  expect(payload.counts.candidates).toBeGreaterThanOrEqual(40);
  expect(payload.counts.documents).toBeGreaterThanOrEqual(20);
  expect(payload.counts.proposals).toBeGreaterThanOrEqual(25);
  expect(payload.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(payload.chat.engine).toBe('deterministic-bm25-ontology-v4');
  expect(payload.chat.responseGeneration).toBe('deterministic_extractive');
  expect(payload.chat.edgeRateLimit).toEqual({ requests: 30, seconds: 60 });
  expect(payload.chat.semanticFallback.role).toBe('retrieval_interpretation_only');
  expect(typeof payload.chat.semanticFallback.enabled).toBe('boolean');
  expect(typeof payload.chat.semanticFallback.configured).toBe('boolean');
  expect(payload.chat.semanticFallback.timeoutMs).toBeGreaterThanOrEqual(1000);
  expect(payload.chat.semanticFallback.timeoutMs).toBeLessThanOrEqual(10000);
});

test('history API separates current and historical records without inventing evolutions', async ({ request }) => {
  const metaResponse = await request.get('/api/history?view=meta');
  expect(metaResponse.ok()).toBeTruthy();
  const meta = await metaResponse.json();
  expect(meta.counts.records).toBeGreaterThan(0);
  expect(meta.counts.current + meta.counts.historical).toBe(meta.counts.records);
  expect(meta.actors.some((item) => item.id === 'renaissance')).toBe(true);

  const timelineResponse = await request.get('/api/history?view=timeline&entity=renaissance&topic=nucleaire');
  expect(timelineResponse.ok()).toBeTruthy();
  const timeline = await timelineResponse.json();
  expect(timeline.actor.id).toBe('renaissance');
  expect(timeline.topic.id).toBe('nucleaire');
  expect(timeline.timeline.length).toBeGreaterThan(0);
  expect(timeline.methodologyNote).toMatch(/n’est jamais interprété comme un changement de position/i);
  for (const event of timeline.timeline) {
    if (event.evolutionSignal === 'replaces_previous') expect(event.supersedes.length).toBeGreaterThan(0);
    if (event.evolutionSignal === 'replaced_by_newer') expect(event.supersededBy.length).toBeGreaterThan(0);
  }
});

test('chat endpoint preserves evidence, attribution, suggestions and safe uncertainty across user journeys', async ({ request }) => {
  let ip = 10;
  async function ask(question, history = [], sessionContext = {}) {
    const response = await request.post('/api/chat', {
      headers: { 'x-forwarded-for': `198.51.100.${ip++}` },
      data: { question, history, sessionContext }
    });
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.generated).toBe(false);
    expect(payload.providerError).toBeNull();
    expect(payload.engine).toBe('deterministic-bm25-ontology-v4');
    expect(typeof payload.retrievalAssisted).toBe('boolean');
    expect(Array.isArray(payload.sessionContext?.entityIds)).toBe(true);
    expect(Array.isArray(payload.sessionContext?.conceptIds)).toBe(true);
    expect(payload.sessionContext.entityIds.length).toBeLessThanOrEqual(8);
    expect(payload.sessionContext.conceptIds.length).toBeLessThanOrEqual(8);
    return payload;
  }

  const parcoursup = await ask("Quel projet propose d'abroger Parcoursup ?");
  expect(parcoursup.answer.cards.length).toBeGreaterThan(0);
  expect(parcoursup.answer.cards.some((card) => card.entityId === 'parti-socialiste')).toBe(true);
  expect(parcoursup.answer.cards.every((card) => /Parcoursup/i.test(JSON.stringify({ subtitle: card.subtitle, summary: card.summary, bullets: card.bullets })))).toBe(true);
  expect(parcoursup.citations.some((citation) => citation.path === 'proposals/services-publics/ps-abrogation-parcoursup.md')).toBe(true);
  expect(parcoursup.retrievalAssisted).toBe(false);
  expect(parcoursup.answer.followUps.length).toBeGreaterThanOrEqual(1);
  expect(parcoursup.answer.followUps.length).toBeLessThanOrEqual(3);
  expect(new Set(parcoursup.answer.followUps).size).toBe(parcoursup.answer.followUps.length);
  const suggestionAnswer = await ask(parcoursup.answer.followUps[0], [
    { role: 'user', content: "Quel projet propose d'abroger Parcoursup ?" },
    { role: 'assistant', content: parcoursup.answer.summary }
  ], parcoursup.sessionContext);
  expect(suggestionAnswer.answer.cards.length).toBeGreaterThan(0);
  expect(suggestionAnswer.citations.length).toBeGreaterThan(0);

  for (const question of [
    'Que propose David Lisnard sur les dinosaures ?',
    "Que propose Renaissance sur l'énergie des licornes ?",
    'Que propose Renaissance sur le nucléaire sur Mars ?',
    'Que propose le PS sur la santé des dinosaures ?'
  ]) {
    const offCorpus = await ask(question);
    expect(offCorpus.answer.cards).toHaveLength(0);
    expect(offCorpus.citations).toHaveLength(0);
    expect(offCorpus.answer.title).toMatch(/Aucune donnée pertinente/i);
  }

  const status = await ask('Bruno Retailleau est-il candidat officiel ?');
  expect(status.answer.cards).toHaveLength(1);
  expect(status.answer.cards[0].title).toBe('Bruno Retailleau');
  expect(status.answer.cards[0].officialCandidate).toBe(false);
  expect(status.answer.cards[0].bullets.join(' ')).toMatch(/Candidat officiel au sens du Conseil constitutionnel\s*:\s*non/i);
  expect(status.answer.followUps.length).toBeGreaterThanOrEqual(1);

  const negativeInference = await ask('Qui ne propose pas de retraite par capitalisation ?');
  expect(negativeInference.answer.cards).toHaveLength(0);
  expect(negativeInference.citations).toHaveLength(0);
  expect(negativeInference.answer.title).toMatch(/Impossible de déduire une absence/i);
  expect(negativeInference.answer.followUps.length).toBeGreaterThanOrEqual(1);

  const subjective = await ask("Quel est le meilleur programme pour le pouvoir d'achat ?");
  expect(subjective.answer.cards).toHaveLength(0);
  expect(subjective.citations).toHaveLength(0);
  expect(subjective.answer.title).toMatch(/Classement politique non déduit/i);
  expect(subjective.answer.followUps.length).toBeGreaterThanOrEqual(1);
  expect(subjective.answer.followUps.some((item) => /pouvoir d.achat|salaire|smic/i.test(item))).toBe(true);

  const followUp = await ask('Et sur le nucléaire ?', [
    { role: 'user', content: 'Compare David Lisnard et Renaissance sur les retraites' },
    { role: 'assistant', content: 'Comparaison des positions documentées sur les retraites.' }
  ]);
  expect(followUp.answer.layout).toBe('comparison');
  expect(followUp.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(true);
  expect(JSON.stringify(followUp.answer)).toMatch(/14 EPR|SMR 2030/i);
  expect(JSON.stringify(followUp.answer)).not.toMatch(/composante de capitalisation pour la retraite/i);
  expect(followUp.answer.sections.some((section) => /David Lisnard/.test(section.text) && /absence|Aucun élément/i.test(section.text))).toBe(true);
  expect(followUp.answer.followUps.length).toBeGreaterThanOrEqual(1);

  const noPartyLeak = await ask('Que propose Gabriel Attal sur le nucléaire ?');
  expect(noPartyLeak.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(false);
  expect(noPartyLeak.citations.some((citation) => citation.entityId === 'renaissance')).toBe(false);

  const partialComparison = await ask('Compare David Lisnard et Renaissance sur le nucléaire');
  expect(partialComparison.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(true);
  expect(partialComparison.answer.sections.some((section) => /David Lisnard/.test(section.text) && /absence|Aucun élément/i.test(section.text))).toBe(true);

  for (const payload of [parcoursup, suggestionAnswer, followUp, partialComparison]) {
    expect(payload.citations.every((citation) => !['superseded', 'withdrawn', 'archived', 'rejected', 'draft', 'historical'].includes(String(citation.documentStatus || '').toLowerCase()))).toBe(true);
  }
});

test('server rate limit allows sustained human exploration then caps abuse', async ({ request }, testInfo) => {
  const suffix = testInfo.project.name.includes('mobile') ? 252 : 251;
  const headers = { 'x-forwarded-for': `198.51.100.${suffix}` };
  const data = { question: 'Que propose Renaissance sur le nucléaire ?', history: [], sessionContext: {} };
  for (let index = 0; index < 30; index += 1) {
    const response = await request.post('/api/chat', { headers, data });
    expect(response.status(), `request ${index + 1} should remain available`).toBe(200);
  }
  const limited = await request.post('/api/chat', { headers, data });
  expect(limited.status()).toBe(429);
});

test('each visible answer keeps its own source numbering across multiple chat turns', async ({ page }) => {
  await page.goto('/');
  const textarea = page.locator('textarea');
  const send = page.locator('button.send');

  await textarea.fill("Quel projet propose d'abroger Parcoursup ?");
  await send.click();
  const answers = page.locator('.message.structuredMessage');
  await expect(answers).toHaveCount(1);
  const firstAnswer = answers.nth(0);
  await expect(firstAnswer.getByRole('button', { name: 'Source 1' }).first()).toBeVisible();
  await firstAnswer.getByRole('button', { name: 'Source 1' }).first().click();
  await expect(page.locator('.sourcesPanel')).toContainText(/Parcoursup/i);

  await textarea.fill('Que propose Renaissance sur le nucléaire ?');
  await send.click();
  await expect(answers).toHaveCount(2);
  await expect(page.locator('.sourcesPanel')).toContainText(/EPR|nucléaire|SMR/i);

  await firstAnswer.getByRole('button', { name: 'Source 1' }).first().click();
  await expect(page.locator('.sourcesPanel')).toContainText(/Parcoursup/i);
  await expect(page.locator('.sourcesPanel')).not.toContainText(/14 EPR|SMR 2030/i);
});