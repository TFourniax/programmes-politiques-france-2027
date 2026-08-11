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

test('chat endpoint preserves evidence, attribution and safe uncertainty across user journeys', async ({ request }) => {
  let ip = 10;
  async function ask(question, history = []) {
    const response = await request.post('/api/chat', {
      headers: { 'x-forwarded-for': `198.51.100.${ip++}` },
      data: { question, history }
    });
    expect(response.ok()).toBeTruthy();
    const payload = await response.json();
    expect(payload.generated).toBe(false);
    expect(payload.providerError).toBeNull();
    expect(payload.engine).toBe('deterministic-bm25-ontology-v4');
    return payload;
  }

  const parcoursup = await ask("Quel projet propose d'abroger Parcoursup ?");
  expect(parcoursup.answer.cards).toHaveLength(1);
  expect(parcoursup.answer.cards[0].entityId).toBe('parti-socialiste');
  expect(JSON.stringify(parcoursup.answer.cards)).toMatch(/Parcoursup/i);
  expect(parcoursup.citations.some((citation) => citation.path === 'proposals/services-publics/ps-abrogation-parcoursup.md')).toBe(true);

  const offCorpus = await ask('Que propose David Lisnard sur les dinosaures ?');
  expect(offCorpus.answer.cards).toHaveLength(0);
  expect(offCorpus.citations).toHaveLength(0);
  expect(offCorpus.answer.title).toMatch(/Aucune donnée pertinente/i);

  const status = await ask('Bruno Retailleau est-il candidat officiel ?');
  expect(status.answer.cards).toHaveLength(1);
  expect(status.answer.cards[0].title).toBe('Bruno Retailleau');
  expect(status.answer.cards[0].officialCandidate).toBe(false);
  expect(status.answer.cards[0].bullets.join(' ')).toMatch(/Candidat officiel au sens du Conseil constitutionnel\s*:\s*non/i);

  const negativeInference = await ask('Qui ne propose pas de retraite par capitalisation ?');
  expect(negativeInference.answer.cards).toHaveLength(0);
  expect(negativeInference.citations).toHaveLength(0);
  expect(negativeInference.answer.title).toMatch(/Impossible de déduire une absence/i);

  const subjective = await ask("Quel est le meilleur programme pour le pouvoir d'achat ?");
  expect(subjective.answer.cards).toHaveLength(0);
  expect(subjective.citations).toHaveLength(0);
  expect(subjective.answer.title).toMatch(/Classement politique non déduit/i);

  const followUp = await ask('Et sur le nucléaire ?', [
    { role: 'user', content: 'Compare David Lisnard et Renaissance sur les retraites' },
    { role: 'assistant', content: 'Comparaison des positions documentées sur les retraites.' }
  ]);
  expect(followUp.answer.layout).toBe('comparison');
  expect(followUp.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(true);
  expect(JSON.stringify(followUp.answer)).toMatch(/14 EPR|SMR 2030/i);
  expect(JSON.stringify(followUp.answer)).not.toMatch(/composante de capitalisation pour la retraite/i);
  expect(followUp.answer.sections.some((section) => /David Lisnard/.test(section.text) && /absence|Aucun élément/i.test(section.text))).toBe(true);

  const noPartyLeak = await ask('Que propose Gabriel Attal sur le nucléaire ?');
  expect(noPartyLeak.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(false);
  expect(noPartyLeak.citations.some((citation) => citation.entityId === 'renaissance')).toBe(false);

  const partialComparison = await ask('Compare David Lisnard et Renaissance sur le nucléaire');
  expect(partialComparison.answer.cards.some((card) => card.entityId === 'renaissance')).toBe(true);
  expect(partialComparison.answer.sections.some((section) => /David Lisnard/.test(section.text) && /absence|Aucun élément/i.test(section.text))).toBe(true);
});
