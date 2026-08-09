import assert from 'node:assert/strict';
import compass from '../data/compass.json' with { type: 'json' };
import { retrieve } from '../lib/retrieval.js';

assert.equal(compass.scale.length, 4, 'compass should expose four importance levels');
assert.ok(compass.questions.length >= 8, 'compass should cover a broad set of civic issues');
assert.equal(new Set(compass.questions.map((item) => item.id)).size, compass.questions.length, 'compass question ids must be unique');

for (const question of compass.questions) {
  assert.ok(question.id && question.label && question.question && question.query && question.exploreQuestion, `invalid compass question: ${question.id}`);
}

const coreThemes = [
  ['retraites', 'retraite'],
  ['fiscalite-redistribution', 'fiscal'],
  ['immigration-integration', 'immigration'],
  ['europe-souverainete', 'europe']
];

for (const [id, label] of coreThemes) {
  const theme = compass.questions.find((item) => item.id === id);
  const evidence = retrieve(theme.query, { limit: 12, minScore: 1.8 }).results.filter((item) => item.citation?.kind !== 'candidate_status');
  assert.ok(evidence.length > 0, `core compass theme should retrieve corpus evidence: ${label}`);
}

console.log('Compass QA OK', { questions: compass.questions.length, coreThemes: coreThemes.length });
