import assert from 'node:assert/strict';
import { analyzeQuery, retrieveDeterministic } from '../lib/retrieval-v2.js';
import { composeDeterministicAnswer } from '../lib/deterministic-answer-v2.js';
import { buildContextualSuggestions } from '../lib/contextual-suggestions.js';

const INTERNAL_COPY = /(?:extrait de preuve|attribution et preuve|cette entrée est attribuée|la formulation reste limitée|promotion automatique|tier_[1-4]_|explicit_but_|capture_fallback|generated_by)/i;

function normalized(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

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

// Questions volontairement formulées comme de vrais utilisateurs : fautes, nombres,
// paraphrases, comparaison et demande de source. Elles ne servent jamais au scoring du retrieval.
const journeys = [
  ["Quel projet propose d'abroger Parcoursup ?", 'measures'],
  ["Qui veut supprimer la plateforme d’admission post-bac Parcoursup ?", 'measures'],
  ["Que propose David Lisnard sur l'immigration ?", 'measures'],
  ["Que propose Renaissance sur le nucléaire ?", 'measures'],
  ["Quelle formation veut développer le nucleair avec de nouveaux réacteurs ?", 'measures'],
  ["Quel projet prévoit une loi pluriannuelle sur l’immigraiton ?", 'measures'],
  ["Qui propose une retraitre anticipée pour les métiers pénibles ?", 'measures'],
  ["Quel parti veut créer un compte carbone individuel pour chaque personne ?", 'measures'],
  ["Quel projet veut limiter l’écart de rémunération de 1 à 20 ?", 'measures'],
  ["Quelles mesures sont documentées sur le pouvoir d'achat et les salaires ?", 'measures'],
  ["Compare David Lisnard et Renaissance sur les retraites", 'comparison'],
  ["Compare le PS et Anasse Kazib sur le SMIC", 'comparison']
];

for (const [question, mode] of journeys) {
  const { retrieval, result } = answer(question, mode);
  const publicCopy = JSON.stringify(result);
  assert.doesNotMatch(publicCopy, INTERNAL_COPY, `la réponse ne doit pas exposer la plomberie du corpus: ${question}`);
  assert.ok(result.summary.length >= 30 && result.summary.length <= 420, `le résumé doit rester lisible: ${question}`);
  assert.doesNotMatch(result.summary, /\.\.(?:\.|\s|$)/, `le résumé ne doit pas contenir de ponctuation cassée: ${question}`);

  const signatures = [];
  for (const card of result.cards) {
    assert.ok(String(card.title || '').trim(), `chaque carte doit avoir un titre: ${question}`);
    assert.ok(String(card.summary || '').trim(), `chaque carte doit avoir un résumé: ${question}`);
    assert.doesNotMatch(String(card.subtitle || ''), INTERNAL_COPY, `le sous-titre doit être humain: ${question}`);
    assert.doesNotMatch(String(card.summary || ''), INTERNAL_COPY, `le résumé doit être humain: ${question}`);
    assert.doesNotMatch((card.bullets || []).join(' '), INTERNAL_COPY, `les puces doivent être humaines: ${question}`);
    assert.ok((card.sourceNumbers || []).length > 0, `chaque carte factuelle doit rester reliée à une source: ${question}`);
    for (const sourceNumber of card.sourceNumbers || []) {
      assert.ok(Number.isInteger(sourceNumber) && sourceNumber >= 1 && sourceNumber <= retrieval.results.length, `référence source invalide dans: ${question}`);
    }
    const signature = `${normalized(card.title)}|${normalized(card.summary)}`;
    assert.ok(!signatures.includes(signature), `deux cartes identiques ne doivent pas être affichées: ${question}`);
    signatures.push(signature);
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

const outOfCorpus = [
  "Que propose David Lisnard sur les dinosaures ?",
  "Que propose le PS sur la maladie de Lyme ?",
  "Que propose Renaissance pour coloniser Mars ?",
  "Que propose Équinoxe sur le Bitcoin ?",
  "Que propose Anasse Kazib sur la Formule 1 ?"
];
for (const question of outOfCorpus) {
  const retrieval = retrieveDeterministic(question, { limit: 8 });
  assert.equal(retrieval.results.length, 0, `une question hors corpus ciblée doit rester vide: ${question}`);
  assert.equal(retrieval.debug.answerable, false, `une question hors corpus ne doit pas être déclarée répondable: ${question}`);
}

const unsafe = [
  "Qui ne propose pas de retraite par capitalisation ?",
  "Quels partis ne parlent pas du nucléaire ?",
  "Quel candidat est le plus favorable au nucléaire ?",
  "Quel est le meilleur programme pour le pouvoir d’achat ?",
  "Qui est le plus à droite ?",
  "Quel est le pire programme sur l’immigration ?"
];
for (const question of unsafe) {
  const analysis = analyzeQuery(question);
  const retrieval = retrieveDeterministic(question, { limit: 8 });
  assert.equal(analysis.intent?.unsupported, true, `la demande interprétative doit être classée comme non supportée: ${question}`);
  assert.equal(retrieval.results.length, 0, `aucune preuve ne doit être détournée pour répondre à un jugement: ${question}`);
  assert.match(String(retrieval.debug.reason || ''), /^unsupported_/, `le motif de refus doit être explicite: ${question}`);
}

console.log('HUMAN_ANSWER_QUALITY_OK', {
  answerableJourneys: journeys.length,
  scopedNoDataJourneys: outOfCorpus.length,
  unsafeJourneys: unsafe.length,
  total: journeys.length + outOfCorpus.length + unsafe.length
});
