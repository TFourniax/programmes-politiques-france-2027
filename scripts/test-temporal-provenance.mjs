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

// The chat must expose the same distinction whenever a capture-based record is
// actually selected by retrieval. Do not require an arbitrary document chunk to
// rank by itself: try real public queries built from current records and require
// at least one capture-based citation to be reachable and correctly labelled.
let exposed = null;
for (const sample of captureFallback) {
  if (String(sample.documentStatus || '').toLowerCase() !== 'current') continue;
  const queries = [
    [sample.entityLabel, sample.title].filter(Boolean).join(' '),
    [sample.entityLabel, sample.section].filter(Boolean).join(' '),
    [sample.entityLabel, ...(sample.topics || [])].filter(Boolean).join(' ')
  ].filter((value, index, array) => value.trim() && array.indexOf(value) === index);

  for (const query of queries) {
    const retrieval = retrieveDeterministic(query, { limit: 20 });
    const returned = retrieval.results.find((item) => item.citation?.path === sample.path && item.citation?.dateBasis === 'capture_fallback');
    if (!returned) continue;
    exposed = { sample, returned, query };
    break;
  }
  if (exposed) break;
}

assert.ok(exposed, 'au moins une source courante datée par capture doit être réellement exposable par le chat');
assert.equal(exposed.returned.citation.publishedAtRaw, exposed.sample.publishedAt);
assert.match(exposed.returned.citation.publishedAt, /^capturé le .+date de publication non exposée$/i);

console.log('TEMPORAL_PROVENANCE_OK', {
  captureFallbackRecords: new Set(captureFallback.map((item) => item.path)).size,
  sample: exposed.sample.path,
  query: exposed.query
});
