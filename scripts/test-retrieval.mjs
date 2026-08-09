import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { retrieve, getMeta } from '../lib/retrieval.js';

const root = path.resolve(process.cwd());

function top(query, options) {
  return retrieve(query, options).results;
}

function includesPath(results, fragment) {
  return results.some((item) => item.citation.path.includes(fragment));
}

const meta = getMeta();
assert.equal(meta.snapshotDate, '2026-08-09');
assert.ok(meta.counts.candidates >= 40, 'candidate snapshot should contain at least 40 tracked personalities');
assert.ok(meta.counts.documents >= 1, 'meta API should expose indexed document count');
assert.ok(meta.counts.proposals >= 1, 'meta API should expose atomic proposal count');
assert.equal(meta.counts.markdownFiles, meta.counts.documents + meta.counts.proposals, 'markdown count should equal documents + proposals');
assert.ok(meta.counts.markdownFiles >= 20, 'full-text index should include Markdown corpus and proposal files');

const candidates = top('Quels sont les candidats déclarés à la présidentielle 2027 ?', { limit: 12 });
assert.ok(candidates.some((item) => item.citation.kind === 'candidate_status'));
assert.ok(candidates.some((item) => item.citation.entityId === 'jean-luc-melenchon'));

const retirement = top('Qui propose la retraite à 60 ans ?', { limit: 8 });
assert.ok(includesPath(retirement, 'retraites/jean-luc-melenchon-age-60.md'));

const smic = top('SMIC 1700 euros net', { limit: 8 });
assert.ok(smic.some((item) => /1700/.test(item.text)) || includesPath(smic, 'travail/jean-luc-melenchon-smic-1700.md'));

const retailleau = top('Bruno Retailleau référendum immigration étudiants extra-européens', { limit: 8 });
assert.ok(retailleau.some((item) => item.citation.entityId === 'bruno-retailleau'));
assert.ok(retailleau.some((item) => item.citation.kind === 'document' || item.citation.kind === 'proposal'));

const service = top('service citoyen obligatoire neuf mois permis de conduire', { limit: 8 });
assert.ok(service.some((item) => /neuf mois|9 mois/i.test(item.text)), 'full Markdown body should be searchable');

const nonsense = top('zyxqv blorptastic quasarbanane', { limit: 8, minScore: 4 });
assert.equal(nonsense.length, 0, 'unrelated nonsense query should not invent a result');

for (const result of [...retirement, ...retailleau, ...service]) {
  const file = path.join(root, result.citation.path);
  assert.ok(fs.existsSync(file), `citation path should exist: ${result.citation.path}`);
}

console.log('Retrieval QA OK', {
  snapshotDate: meta.snapshotDate,
  documents: meta.counts.documents,
  proposals: meta.counts.proposals,
  chunks: meta.counts.chunks,
  markdownFiles: meta.counts.markdownFiles
});
