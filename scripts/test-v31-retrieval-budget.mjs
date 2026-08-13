import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import benchmark from '../data/qa-deterministic-benchmark.json' with { type: 'json' };
import { retrieveDeterministic } from '../lib/retrieval-v2.js';

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
}

let hits5 = 0;
let reciprocalRank = 0;
const missed = [];
const outsideTop5 = [];

for (const testCase of benchmark.positive) {
  const results = retrieveDeterministic(testCase.question, { limit: 8 }).results;
  const index = results.findIndex((item) => testCase.expectedAny.includes(item.citation?.path));
  if (index >= 0 && index < 5) hits5 += 1;
  if (index >= 0) {
    reciprocalRank += 1 / (index + 1);
    if (index >= 5) outsideTop5.push({ id: testCase.id, rank: index + 1 });
  } else {
    missed.push({ id: testCase.id, returned: results.slice(0, 5).map((item) => item.citation?.path) });
  }
}

let rejected = 0;
const falsePositives = [];
for (const question of benchmark.negative) {
  const results = retrieveDeterministic(question, { limit: 8 }).results;
  if (!results.length) rejected += 1;
  else falsePositives.push({ question, returned: results.slice(0, 3).map((item) => item.citation?.path) });
}

const queries = [...benchmark.positive.map((item) => item.question), ...benchmark.negative];
retrieveDeterministic(queries[0], { limit: 8 });
const timings = [];
for (let round = 0; round < 6; round += 1) {
  for (const question of queries) {
    const start = performance.now();
    retrieveDeterministic(question, { limit: 8 });
    timings.push(performance.now() - start);
  }
}

const hitAt5 = hits5 / benchmark.positive.length;
const mrr = reciprocalRank / benchmark.positive.length;
const rejectRate = rejected / benchmark.negative.length;
const p95Ms = percentile(timings, 0.95);

assert.ok(hitAt5 >= 0.97, `V3.1 hit@5 budget breached: ${JSON.stringify({ hitAt5, missed, outsideTop5 })}`);
assert.ok(mrr >= 0.89, `V3.1 MRR budget breached: ${mrr}`);
assert.equal(rejectRate, 1, `V3.1 out-of-corpus rejection must remain perfect: ${JSON.stringify(falsePositives)}`);
assert.equal(missed.length, 0, `V3.1 must not completely miss a known answer: ${JSON.stringify(missed)}`);
assert.ok(p95Ms <= 120, `V3.1 retrieval p95 budget breached: ${p95Ms.toFixed(2)}ms`);

console.log('V31_RETRIEVAL_BUDGET_OK', {
  positiveCases: benchmark.positive.length,
  hitAt5: Number(hitAt5.toFixed(3)),
  mrr: Number(mrr.toFixed(3)),
  rejectRate: Number(rejectRate.toFixed(3)),
  p95Ms: Number(p95Ms.toFixed(2)),
  outsideTop5,
});
