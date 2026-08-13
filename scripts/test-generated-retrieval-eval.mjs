import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import entities from '../data/entities.json' with { type: 'json' };
import { retrieveDeterministic } from '../lib/retrieval-v2.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const proposalRoot = path.join(ROOT, 'proposals');
const MIN_HIT5 = 0.90;
const MIN_MRR = 0.90;

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
  if ((field('proposal_status') || 'current') !== 'current') return null;
  const entityId = field('entity_id');
  const topic = field('topic');
  if (!entityId || !topic) return null;
  const heading = match[2].split(/\r?\n/).find((line) => line.startsWith('# '))?.slice(2).trim();
  if (!heading || heading.length < 8) return null;
  return { path: path.relative(ROOT, file).split(path.sep).join('/'), entityId: String(entityId), topic: String(topic), title: heading };
}

function annotate(level, title, payload) {
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
  for (const [variant, question] of [
    `Que propose ${actor} au sujet de « ${proposal.title} » ?`,
    `${actor} : ${proposal.title}`,
  ].entries()) cases.push({ id: `${proposal.path}#${variant + 1}`, variant: variant + 1, question, expectedPath: proposal.path });
}

assert.ok(proposals.length >= 60, `evaluation corpus unexpectedly small: ${proposals.length} current proposals`);
assert.ok(cases.length >= 1000, `generated actor-qualified evaluation unexpectedly small: ${cases.length} cases`);

let hit1 = 0;
let hit5 = 0;
let reciprocalRank = 0;
const failures = [];
const byVariant = new Map();
const reasonCounts = new Map();

for (const testCase of cases) {
  const result = retrieveDeterministic(testCase.question, { limit: 8 });
  const returned = result.results.map((item) => item.citation?.path).filter(Boolean);
  const index = returned.indexOf(testCase.expectedPath);
  if (index === 0) hit1 += 1;
  if (index >= 0 && index < 5) hit5 += 1;
  if (index >= 0) reciprocalRank += 1 / (index + 1);
  const row = byVariant.get(testCase.variant) || { total: 0, hit1: 0, hit5: 0, rr: 0 };
  row.total += 1;
  if (index === 0) row.hit1 += 1;
  if (index >= 0 && index < 5) row.hit5 += 1;
  if (index >= 0) row.rr += 1 / (index + 1);
  byVariant.set(testCase.variant, row);
  if (index < 0 || index >= 5) {
    const reason = result.debug?.reason || 'unknown';
    reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    failures.push({ id: testCase.id, expectedPath: testCase.expectedPath, returned: returned.slice(0, 5), reason, unknownQualifierTokens: result.debug?.unknownQualifierTokens || [], unmatchedQualifierTokens: result.debug?.unmatchedQualifierTokens || [] });
  }
}

const metrics = {
  proposals: proposals.length,
  cases: cases.length,
  hit1: hit1 / cases.length,
  hit5: hit5 / cases.length,
  mrr: reciprocalRank / cases.length,
  failures: failures.length,
  reasons: Object.fromEntries([...reasonCounts].sort((a, b) => b[1] - a[1])),
  variants: Object.fromEntries([...byVariant].map(([key, row]) => [key, { total: row.total, hit1: row.hit1 / row.total, hit5: row.hit5 / row.total, mrr: row.rr / row.total }])),
};
const rounded = {
  proposals: metrics.proposals,
  cases: metrics.cases,
  hit1: Number(metrics.hit1.toFixed(3)),
  hit5: Number(metrics.hit5.toFixed(3)),
  mrr: Number(metrics.mrr.toFixed(3)),
  failures: metrics.failures,
  reasons: metrics.reasons,
  variants: Object.fromEntries(Object.entries(metrics.variants).map(([key, row]) => [key, { hit1: Number(row.hit1.toFixed(3)), hit5: Number(row.hit5.toFixed(3)), mrr: Number(row.mrr.toFixed(3)) }])),
};

annotate('notice', 'Actor-qualified retrieval coverage', rounded);
if (failures.length) annotate('notice', 'Actor-qualified retrieval sample misses', failures.slice(0, 6));
console.log('Actor-qualified retrieval coverage', rounded);

assert.ok(metrics.hit5 >= MIN_HIT5, `actor-qualified hit@5 too low: ${metrics.hit5.toFixed(3)} < ${MIN_HIT5}`);
assert.ok(metrics.mrr >= MIN_MRR, `actor-qualified MRR too low: ${metrics.mrr.toFixed(3)} < ${MIN_MRR}`);
for (const [variant, row] of Object.entries(metrics.variants)) {
  assert.ok(row.hit5 >= MIN_HIT5, `actor-qualified variant ${variant} hit@5 too low: ${row.hit5.toFixed(3)}`);
  assert.ok(row.mrr >= MIN_MRR, `actor-qualified variant ${variant} MRR too low: ${row.mrr.toFixed(3)}`);
}
console.log('Generated retrieval evaluation OK', rounded);
