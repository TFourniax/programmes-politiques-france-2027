import assert from 'node:assert/strict';
import { retrieveDeterministic } from '../lib/retrieval-v2.js';
import { composeDeterministicAnswer } from '../lib/deterministic-answer-v2.js';
import { buildContextualSuggestions } from '../lib/contextual-suggestions.js';

const INTERNAL_COPY = /(?:extrait de preuve|attribution et preuve|cette entrée est attribuée|la formulation reste limitée|promotion automatique|tier_[1-4]_|explicit_but_|capture_fallback|generated_by)/i;

function answer(question, mode = 'measures') {
  const retrieval = retrieveDeterministic(question, { limit: mode === 'comparison' ? 14 : 12 });
  assert.equal(retrieval.debug.answerable, true, `la question doit être répondable: ${question}`);
  assert.ok(retrieval.results.length > 0, `des preuves doivent être retrouvées: ${question}`);
  const result = composeDeterministicAnswer(question, retrieval.results, {
    mode,
    requestedEntities: retrieval.debug.requestedEntities || []
  });
  assert.ok(result.cards.length > 0, `la réponse doit contenir au moins une carte: ${question}`);
  return { retrieval, result };
}

const journeys = [
  ["Quel projet propose d'abroger Parcoursup ?", 'measures'],
  ["Que propose David Lisnard sur l'immigration ?", 'measures'],
  ["Que propose Renaissance sur le nucléaire ?", 'measures'],
  ["Quelles mesures sont documentées sur le pouvoir d'achat et les salaires ?", 'measures'],
  ["Compare David Lisnard et Renaissance sur les retraites", 'comparison']
];

for (const [question, mode] of journeys) {
  const { retrieval, result } = answer(question, mode);
  const publicCopy = JSON.stringify(result);
  assert.doesNotMatch(publicCopy, INTERNAL_COPY, `la réponse ne doit pas exposer la plomberie du corpus: ${question}`);
  assert.ok(result.summary.length >= 30 && result.summary.length <= 420, `le résumé doit rester lisible: ${question}`);
  for (const card of result.cards) {
    assert.ok(String(card.title || '').trim(), `chaque carte doit avoir un titre: ${question}`);
    assert.ok(String(card.summary || '').trim(), `chaque carte doit avoir un résumé: ${question}`);
    assert.doesNotMatch(String(card.subtitle || ''), INTERNAL_COPY, `le sous-titre doit être humain: ${question}`);
    assert.doesNotMatch(String(card.summary || ''), INTERNAL_COPY, `le résumé doit être humain: ${question}`);
    assert.doesNotMatch((card.bullets || []).join(' '), INTERNAL_COPY, `les puces doivent être humaines: ${question}`);
  }

  const suggestions = buildContextualSuggestions(question, retrieval.results, [], { limit: 3, sessionState: {} });
  assert.ok(suggestions.length <= 3, `au plus trois suggestions doivent être proposées: ${question}`);
  assert.equal(new Set(suggestions).size, suggestions.length, `les suggestions doivent être uniques: ${question}`);
  for (const suggestion of suggestions) {
    assert.match(suggestion, /\?$/, `une suggestion doit être formulée comme une vraie question: ${suggestion}`);
    assert.doesNotMatch(suggestion, /[_]|tier_|explicit_|capture_fallback/i, `une suggestion ne doit pas exposer d'identifiant interne: ${suggestion}`);
    const replay = retrieveDeterministic(suggestion, { limit: 6 });
    assert.equal(replay.debug.answerable, true, `toute suggestion affichée doit réellement mener à une réponse: ${suggestion}`);
    assert.ok(replay.results.length > 0, `toute suggestion affichée doit réellement avoir des sources: ${suggestion}`);
  }
}

console.log('HUMAN_ANSWER_QUALITY_OK', { journeys: journeys.length });
