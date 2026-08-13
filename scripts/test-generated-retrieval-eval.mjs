import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import entities from '../data/entities.json' with { type: 'json' };
import { retrieveDeterministic } from '../lib/retrieval-v2.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const proposalRoot = path.join(ROOT, 'proposals');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
  });
}

function parseProposal(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const field = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const proposalStatus = field('proposal_status') || 'current';
  const entityId = field('entity_id');
  const topic = field('topic');
  if (proposalStatus !== 'current') return null;
  if (!entityId || !topic) return null;
  const heading = match[2].split(/\r?\n/).find((line) => line.startsWith('# '))?.slice(2).trim();
  if (!heading || heading.length < 8) return null;
  return { path: path.relative(ROOT, file).split(path.sep).join('/'), entityId: String(entityId), topic: String(topic), title: heading };
}

function actionAnnotation(level, title, payload) {
  if (!process.env.GITHUB_ACTIONS) return;
  const message = JSON.stringify(payload).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  console.log(`::${level} file=scripts/test-generated-retrieval-eval.mjs,title=${title}::${message}`);
}

const labels = new Map();
for (const group of ['candidates', 'parties']) {
  for (const row of entities[group] || []) labels.set(String(row.id), String(row.name || row.id));
}

const proposals = walk(proposalRoot).map(parseProposal).filter(Boolean);
const cases = [];
for (const proposal of proposals) {
  const actor = labels.get(proposal.entityId) || proposal.entityId;
  const variants = [
    proposal.title,
    `Retrouve la proposition documentée « ${proposal.title} »`,
    `Que propose ${actor} au sujet de « ${proposal.title} » ?`,
    `${actor} : ${proposal.title}`,
    `Quelle mesure du corpus correspond à cette formulation : ${proposal.title} ?`,
  ];
  for (const [variant, question] of variants.entries()) cases.push({ id: `${proposal.path}#${variant + 1}`, question, expectedPath: proposal.path });
}

assert.ok(proposals.length >= 60, `evaluation corpus unexpectedly small: ${proposals.length} current proposals`);
assert.ok(cases.length >= 300, `generated evaluation unexpectedly small: ${cases.length} cases`);

let hit1 = 0;
let hit5 = 0;
let reciprocalRank = 0;
const failures = [];
const byVariant = new Map();
for (const testCase of cases) {
  const result = retrieveDeterministic(testCase.question, { limit: 8 });
  const returned = result.results.map((item) => item.citation?.path).filter(Boolean);
  const index = returned.indexOf(testCase.expectedPath);
  if (index === 0) hit1 += 1;
  if (index >= 0 && index < 5) hit5 += 1;
  if (index >= 0) reciprocalRank += 1 / (index + 1);
  const variant = Number(testCase.id.split('#').pop());
  const row = byVariant.get(variant) || { total: 0, hit5: 0 };
  row.total += 1;
  if (index >= 0 && index < 5) row.hit5 += 1;
  byVariant.set(variant, row);
  if (index < 0 || index >= 5) failures.push({ id: testCase.id, question: testCase.question, expectedPath: testCase.expectedPath, returned: returned.slice(0, 5), reason: result.debug?.reason || null });
}

const metrics = {
  proposals: proposals.length,
  cases: cases.length,
  hit1: hit1 / cases.length,
  hit5: hit5 / cases.length,
  mrr: reciprocalRank / cases.length,
  failures: failures.length,
  variants: Object.fromEntries([...byVariant].map(([key, row]) => [key, { ...row, hit5: row.hit5 / row.total }])),
};
const compactMetrics = {
  proposals: metrics.proposals,
  cases: metrics.cases,
  hit1: Number(metrics.hit1.toFixed(3)),
  hit5: Number(metrics.hit5.toFixed(3)),
  mrr: Number(metrics.mrr.toFixed(3)),
  failures: metrics.failures,
  variants: Object.fromEntries(Object.entries(metrics.variants).map(([key, row]) => [key, Number(row.hit5.toFixed(3))])),
};
actionAnnotation('notice', 'Generated retrieval metrics', compactMetrics);
if (failures.length) actionAnnotation('warning', 'Generated retrieval sample failures', failures.slice(0, 8));
console.log('Generated retrieval evaluation metrics', compactMetrics);
assert.ok(metrics.hit5 >= 0.875, `generated evaluation hit@5 too low: ${metrics.hit5.toFixed(3)}`);
assert.ok(metrics.mrr >= 0.60, `generated evaluation MRR too low: ${metrics.mrr.toFixed(3)}`);
for (const [variant, row] of Object.entries(metrics.variants)) assert.ok(row.hit5 >= 0.75, `generated evaluation variant ${variant} hit@5 too low: ${row.hit5.toFixed(3)}`);
console.log('Generated retrieval evaluation OK', compactMetrics);
