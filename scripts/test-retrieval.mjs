import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { retrieve, getMeta } from '../lib/retrieval.js';
import {
  candidateEvidence,
  classifyQuestion,
  fallbackStructuredAnswer,
  hydrateStructuredAnswer,
  resolveRetrievalQuery,
  selectCandidates
} from '../lib/presentation.js';

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

assert.equal(classifyQuestion('Qui est déclaré candidat à ce stade ?'), 'candidates');
assert.equal(classifyQuestion('Quels sont les candidats officiels ?'), 'candidates');
assert.equal(classifyQuestion('Quels candidats ont déjà des propositions documentées ?'), 'measures', 'candidate policy questions must not be reduced to status lists');
assert.equal(classifyQuestion('Compare les positions documentées sur les retraites'), 'comparison');

const declaredCandidates = selectCandidates('Qui est déclaré candidat à ce stade ?');
assert.ok(declaredCandidates.length >= 5, 'declared candidate query should return direct registry records');
assert.ok(declaredCandidates.every((candidate) => ['declared_presidential','party_designated','declared_conditional'].includes(candidate.current_status)));
assert.ok(declaredCandidates.every((candidate) => candidate.official_candidate === false), 'pre-election registry must not silently upgrade candidates to official');

const declaredEvidence = declaredCandidates.map(candidateEvidence);
assert.equal(declaredEvidence.length, declaredCandidates.length);
assert.ok(declaredEvidence.every((item) => item.citation.path === 'data/entities.json'));
assert.ok(declaredEvidence.every((item) => item.citation.partyName && item.citation.partyColor), 'candidate evidence should include presentation metadata from canonical entities');

const candidateFallback = fallbackStructuredAnswer('Qui est déclaré candidat à ce stade ?', declaredEvidence, { mode:'candidates', candidates:declaredCandidates });
assert.equal(candidateFallback.layout, 'candidates');
assert.equal(candidateFallback.cards.length, declaredCandidates.length);
assert.ok(candidateFallback.cards.every((card) => card.partyColor && card.statusLabel && card.sourceNumbers.length === 1));

const candidateHydrated = hydrateStructuredAnswer({
  layout:'candidates',
  title:'Titre modèle',
  summary:'Résumé modèle',
  note:'Note',
  sections:[],
  cards:[{entityId:'fake-person',title:'Hallucination',subtitle:'',summary:'',bullets:[],sourceNumbers:[1]}],
  followUps:[]
}, 'Qui est déclaré candidat à ce stade ?', declaredEvidence, { mode:'candidates', candidates:declaredCandidates });
assert.equal(candidateHydrated.cards.length, declaredCandidates.length, 'candidate cards must be rebuilt from canonical registry, never trusted from model output');
assert.ok(!candidateHydrated.cards.some((card) => card.entityId === 'fake-person'));

const retirementRaw = [{
  entityId: retirement[0].citation.entityId,
  title:'Carte sourcée',
  subtitle:'Retraites',
  summary:'Résumé',
  bullets:['Point sourcé'],
  sourceNumbers:[1]
},{
  entityId:'invented-entity',
  title:'Entité inventée',
  subtitle:'',
  summary:'',
  bullets:[],
  sourceNumbers:[1]
}];
const retirementHydrated = hydrateStructuredAnswer({layout:'measures',title:'Retraites',summary:'Résumé',note:'',sections:[],cards:retirementRaw,followUps:[]}, 'Qui propose la retraite à 60 ans ?', retirement, {mode:'measures'});
assert.ok(retirementHydrated.cards.some((card) => card.title === 'Carte sourcée'));
assert.ok(!retirementHydrated.cards.some((card) => card.entityId === 'invented-entity'), 'model cannot introduce an entity absent from retrieved evidence');

const followUpQuery = resolveRetrievalQuery('Et sur l’immigration ?', [
  {role:'user',content:'Que propose Bruno Retailleau ?'},
  {role:'assistant',content:'Réponse précédente'}
]);
assert.match(followUpQuery, /Bruno Retailleau/);
assert.match(followUpQuery, /immigration/);

console.log('Retrieval & presentation QA OK', {
  snapshotDate: meta.snapshotDate,
  documents: meta.counts.documents,
  proposals: meta.counts.proposals,
  chunks: meta.counts.chunks,
  markdownFiles: meta.counts.markdownFiles,
  declaredCandidates: declaredCandidates.length
});
