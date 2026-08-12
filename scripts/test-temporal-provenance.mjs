import assert from 'node:assert/strict';
import searchIndex from '../data/search-index.json' with { type: 'json' };
import { retrieveDeterministic } from '../lib/retrieval-v2.js';
import { buildHistoryTimeline } from '../lib/history.js';

const captureFallback = (searchIndex.chunks || []).filter((chunk) =>
  ['document', 'proposal'].includes(chunk.kind)
  && chunk.dateBasis === 'capture_fallback'
  && chunk.entityId
  && chunk.publishedAt
);

assert.ok(captureFallback.length > 0, 'le corpus réel doit contenir au moins un cas de date fondée sur la capture pour tester sa transparence');

for (const chunk of captureFallback) {
  assert.ok(chunk.capturedAt, `un record capture_fallback doit conserver capturedAt: ${chunk.path}`);
  const timeline = buildHistoryTimeline(chunk.entityId);
  const event = timeline.timeline.find((item) => item.path === chunk.path);
  assert.ok(event, `le record doit être visible dans son historique: ${chunk.path}`);
  assert.equal(event.dateBasis, 'capture_fallback');
  assert.match(event.dateLabel, /^capturé le .+date de publication non exposée$/i, `la date ne doit jamais être présentée comme publication: ${chunk.path}`);
}

// A source returned by the chat path must carry the same human-facing distinction.
const sample = captureFallback.find((chunk) => String(chunk.documentStatus || '').toLowerCase() === 'current') || captureFallback[0];
const query = [sample.entityLabel, sample.title, sample.section].filter(Boolean).join(' ');
const retrieval = retrieveDeterministic(query, { limit: 20 });
const returned = retrieval.results.find((item) => item.citation?.path === sample.path);
assert.ok(returned, `le record de capture doit pouvoir être retrouvé par son intitulé: ${sample.path}`);
assert.equal(returned.citation.dateBasis, 'capture_fallback');
assert.equal(returned.citation.publishedAtRaw, sample.publishedAt);
assert.match(returned.citation.publishedAt, /^capturé le .+date de publication non exposée$/i);

console.log('TEMPORAL_PROVENANCE_OK', {
  captureFallbackRecords: new Set(captureFallback.map((item) => item.path)).size,
  sample: sample.path
});
