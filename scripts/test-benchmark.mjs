import assert from 'node:assert/strict';
import benchmark from '../data/qa-benchmark.json' with { type: 'json' };
import { retrieve } from '../lib/retrieval.js';

let hits = 0;
let reciprocalRank = 0;
const failures = [];

for (const testCase of benchmark.cases) {
  const results = retrieve(testCase.question, { limit: 8, minScore: 1.2 }).results;
  const index = results.findIndex((item) => item.citation?.path === testCase.expectedPath);
  if (index >= 0 && index < 5) hits += 1;
  if (index >= 0) reciprocalRank += 1 / (index + 1);
  else failures.push({ id: testCase.id, expectedPath: testCase.expectedPath, returned: results.slice(0, 5).map((item) => item.citation?.path) });
}

const hitAt5 = hits / benchmark.cases.length;
const mrr = reciprocalRank / benchmark.cases.length;
assert.ok(hitAt5 >= 0.875, `benchmark hit@5 too low: ${hitAt5.toFixed(3)}; failures=${JSON.stringify(failures)}`);
assert.ok(mrr >= 0.55, `benchmark MRR too low: ${mrr.toFixed(3)}; failures=${JSON.stringify(failures)}`);
console.log('Retrieval benchmark OK', { cases: benchmark.cases.length, hitAt5: Number(hitAt5.toFixed(3)), mrr: Number(mrr.toFixed(3)) });
