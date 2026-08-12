import assert from 'node:assert/strict';
import { retrieveDeterministic } from '../lib/retrieval-v2.js';

const inactive = new Set(['superseded', 'withdrawn', 'archived', 'rejected', 'draft', 'historical']);

function expectAnswerable(question, predicate = null) {
  const result = retrieveDeterministic(question, { limit: 14 });
  assert.equal(result.debug.answerable, true, `question humaine non comprise: ${question} (${result.debug.reason})`);
  assert.ok(result.results.length > 0, `aucune preuve pour une question attendue répondable: ${question}`);
  assert.ok(result.results.every((item) => !inactive.has(String(item.citation?.documentStatus || '').toLowerCase())), `version inactive exposée: ${question}`);
  if (predicate) assert.ok(result.results.some(predicate), `aucun résultat attendu pour: ${question}`);
  return result;
}

// Vocabulaire technique courant : aucun provider sémantique ne doit être nécessaire.
const fission = expectAnswerable('Que prévoit Renaissance pour la fission ?', (item) => item.citation?.entityId === 'renaissance');
assert.ok(fission.debug.concepts?.some((item) => item.id === 'nucleaire'), 'fission doit mapper déterministement vers nucléaire');

expectAnswerable('Parle-moi simplement des retraites');
expectAnswerable("Quel projet propose d'abroger Parcoursup ?", (item) => item.citation?.entityId === 'parti-socialiste');
expectAnswerable('Que propose le PS sur Parcour sup ?', (item) => item.citation?.entityId === 'parti-socialiste');
expectAnswerable('Qui est déclaré candidat à ce stade ?');

const offCorpus = retrieveDeterministic("Que propose Renaissance sur l'énergie des licornes ?", { limit: 10 });
assert.equal(offCorpus.debug.answerable, false, 'un qualificatif inventé ne doit jamais être ignoré');
assert.equal(offCorpus.results.length, 0, 'le hors-corpus ne doit jamais produire de cartes approximatives');

const ranking = retrieveDeterministic("Quel est le meilleur programme pour l'économie ?", { limit: 10 });
assert.equal(ranking.debug.answerable, false, 'le moteur ne doit pas transformer un classement subjectif en fait');
assert.match(String(ranking.debug.reason || ''), /^unsupported_/, 'le refus subjectif doit être explicite');

const attributed = expectAnswerable('Que propose Renaissance sur le nucléaire ?');
assert.ok(attributed.results.some((item) => item.citation?.entityId === 'renaissance'), 'les propositions de Renaissance doivent rester attribuées au parti');
assert.ok(!attributed.results.some((item) => item.citation?.entityId === 'gabriel-attal' && item.citation?.kind === 'proposal'), 'une proposition du parti ne doit pas devenir artificiellement une proposition personnelle de Gabriel Attal');

console.log('HUMAN_LANGUAGE_REGRESSIONS_OK', {
  cases: 9,
  fissionResults: fission.results.length,
  offCorpusReason: offCorpus.debug.reason,
  subjectiveReason: ranking.debug.reason
});
