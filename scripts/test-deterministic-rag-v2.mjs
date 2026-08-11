import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import benchmark from '../data/qa-deterministic-benchmark.json' with { type: 'json' };
import { retrieve as legacyRetrieve } from '../lib/retrieval.js';
import { retrieveDeterministic } from '../lib/retrieval-v2.js';
import { composeDeterministicAnswer } from '../lib/deterministic-answer-v2.js';
import { classifyQuestion } from '../lib/presentation.js';

function evaluate(name, engine) {
  let hits5 = 0;
  let reciprocalRank = 0;
  const missed = [];
  for (const testCase of benchmark.positive) {
    const results = engine(testCase.question, { limit: 8 }).results;
    const index = results.findIndex((item) => testCase.expectedAny.includes(item.citation?.path));
    if (index >= 0 && index < 5) hits5 += 1;
    if (index >= 0) reciprocalRank += 1 / (index + 1);
    else missed.push({ id: testCase.id, returned: results.slice(0, 5).map((item) => item.citation?.path) });
  }

  let rejected = 0;
  const falsePositives = [];
  for (const question of benchmark.negative) {
    const results = engine(question, { limit: 8 }).results;
    if (!results.length) rejected += 1;
    else falsePositives.push({ question, returned: results.slice(0, 3).map((item) => item.citation?.path) });
  }
  return {
    name,
    positiveCases: benchmark.positive.length,
    hitAt5: hits5 / benchmark.positive.length,
    mrr: reciprocalRank / benchmark.positive.length,
    negativeCases: benchmark.negative.length,
    rejectRate: rejected / benchmark.negative.length,
    missed,
    falsePositives
  };
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
}

function latency(engine) {
  const queries = [...benchmark.positive.map((item) => item.question), ...benchmark.negative];
  engine(queries[0], { limit: 8 });
  const timings = [];
  for (let round = 0; round < 8; round += 1) {
    for (const question of queries) {
      const start = performance.now();
      engine(question, { limit: 8 });
      timings.push(performance.now() - start);
    }
  }
  return {
    medianMs: percentile(timings, 0.5),
    p95Ms: percentile(timings, 0.95),
    maxMs: Math.max(...timings)
  };
}

function normalized(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function assertExtractiveFidelity(question) {
  const mode = classifyQuestion(question);
  const retrieval = retrieveDeterministic(question, { limit: 10 });
  assert.ok(retrieval.results.length > 0, `expected evidence for extractive fidelity test: ${question}`);
  const answer = composeDeterministicAnswer(question, retrieval.results, { mode, candidates: [] });
  const sourceTexts = retrieval.results.map((item) => normalized(`${item.citation?.title || ''}. ${item.text}`));
  for (const card of answer.cards) {
    const claims = [card.summary, ...(card.bullets || [])].filter(Boolean);
    for (const claim of claims) {
      assert.ok(sourceTexts.some((text) => text.includes(normalized(claim))), `non-extractive card text detected: ${claim}`);
    }
    assert.ok((card.sourceNumbers || []).every((number) => number >= 1 && number <= retrieval.results.length));
  }
}

function entitySet(results) {
  return new Set(results.map((item) => item.citation?.entityId).filter(Boolean));
}

const legacy = evaluate('legacy', legacyRetrieve);
const deterministic = evaluate('deterministic', retrieveDeterministic);
const legacyLatency = latency(legacyRetrieve);
const deterministicLatency = latency(retrieveDeterministic);

assert.ok(deterministic.hitAt5 >= 0.94, `deterministic hit@5 too low: ${JSON.stringify(deterministic)}`);
assert.ok(deterministic.mrr >= 0.85, `deterministic MRR too low: ${JSON.stringify(deterministic)}`);
assert.equal(deterministic.rejectRate, 1, `deterministic out-of-scope rejection must be perfect: ${JSON.stringify(deterministic.falsePositives)}`);
assert.ok(deterministic.hitAt5 >= legacy.hitAt5, `deterministic retrieval regressed hit@5 vs legacy: legacy=${legacy.hitAt5}, v2=${deterministic.hitAt5}`);

assert.equal(retrieveDeterministic('Quels sont les candidats officiels ?', { limit: 3 }).debug.answerable, true);
assert.equal(retrieveDeterministic('Quels sont les candidats de Formule 1 ?', { limit: 3 }).debug.answerable, false);
assert.ok(retrieveDeterministic("Que proposent-ils pour le pouvoir d'achat ?", { limit: 8 }).debug.concepts.some((item) => item.id === 'pouvoir-achat'));

const parcoursup = retrieveDeterministic("Quel projet propose d'abroger Parcoursup ?", { limit: 10 }).results;
assert.deepEqual([...entitySet(parcoursup)], ['parti-socialiste'], 'Parcoursup answer must stay scoped to the PS evidence actually retrieved');

const carbon = retrieveDeterministic("Qui veut attribuer à chacun un budget personnel d'émissions de CO2 ?", { limit: 10 }).results;
assert.ok(carbon.some((item) => item.citation?.path === 'proposals/ecologie-energie/equinoxe-quotas-carbone-individuels.md'));
assert.deepEqual([...entitySet(carbon)], ['equinoxe'], 'specific personal-carbon-budget paraphrase must not activate generic budget/climate cards');

const comparison = retrieveDeterministic('Compare David Lisnard et Renaissance sur les retraites', { limit: 14 }).results;
assert.ok(comparison.some((item) => item.citation?.entityId === 'david-lisnard'));
assert.ok(comparison.some((item) => item.citation?.entityId === 'renaissance'));
assert.ok([...entitySet(comparison)].every((id) => ['david-lisnard','renaissance'].includes(id)), 'targeted comparison must not introduce a third entity');

assertExtractiveFidelity("Quel projet propose d'abroger Parcoursup ?");
assertExtractiveFidelity("Quel projet veut développer fortement l'atome avec de nouveaux réacteurs ?");
assertExtractiveFidelity("Qui veut attribuer à chacun un budget personnel d'émissions de CO2 ?");

const route = fs.readFileSync('app/api/chat/route.js', 'utf8');
assert.ok(!route.includes('answerWithModel'), 'runtime chat route must not call a generative model');
assert.ok(!route.includes('lib/llm'), 'runtime chat route must not import the LLM provider');

const report = {
  legacy: {
    hitAt5: Number(legacy.hitAt5.toFixed(3)),
    mrr: Number(legacy.mrr.toFixed(3)),
    rejectRate: Number(legacy.rejectRate.toFixed(3)),
    missed: legacy.missed,
    falsePositives: legacy.falsePositives,
    latency: Object.fromEntries(Object.entries(legacyLatency).map(([key, value]) => [key, Number(value.toFixed(3))]))
  },
  deterministic: {
    hitAt5: Number(deterministic.hitAt5.toFixed(3)),
    mrr: Number(deterministic.mrr.toFixed(3)),
    rejectRate: Number(deterministic.rejectRate.toFixed(3)),
    missed: deterministic.missed,
    falsePositives: deterministic.falsePositives,
    latency: Object.fromEntries(Object.entries(deterministicLatency).map(([key, value]) => [key, Number(value.toFixed(3))]))
  },
  runtimeGenerativeCalls: 0,
  answerMode: 'deterministic-extractive-v2'
};
console.log('DETERMINISTIC_RAG_BENCHMARK=' + JSON.stringify(report));
