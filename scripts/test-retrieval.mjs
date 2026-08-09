import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { retrieve, getMeta } from '../lib/retrieval.js';
import { completeSentenceExcerpt, groupPoliticalCards } from '../lib/card-grouping.js';
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

function longestSuffixPrefix(previous, current) {
  const max = Math.min(previous.length, current.length);
  for (let size = max; size >= 20; size -= 1) {
    if (previous.endsWith(current.slice(0, size))) return size;
  }
  return 0;
}

const meta = getMeta();
assert.equal(meta.snapshotDate, '2026-08-09');
assert.equal(meta.indexVersion, 2, 'search index should use sentence-aligned chunking');
assert.ok(meta.counts.candidates >= 40, 'candidate snapshot should contain at least 40 tracked personalities');
assert.ok(meta.counts.documents >= 1, 'meta API should expose indexed document count');
assert.ok(meta.counts.proposals >= 1, 'meta API should expose atomic proposal count');
assert.equal(meta.counts.markdownFiles, meta.counts.documents + meta.counts.proposals, 'markdown count should equal documents + proposals');
assert.ok(meta.counts.markdownFiles >= 20, 'full-text index should include Markdown corpus and proposal files');

const searchIndex = JSON.parse(fs.readFileSync(path.join(root, 'data', 'search-index.json'), 'utf8'));
const chunksByPath = new Map();
for (const chunk of searchIndex.chunks.filter((item) => ['document', 'proposal'].includes(item.kind))) {
  const list = chunksByPath.get(chunk.path) || [];
  list.push(chunk);
  chunksByPath.set(chunk.path, list);
}
for (const [filePath, chunks] of chunksByPath) {
  chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
  for (let index = 1; index < chunks.length; index += 1) {
    const previous = chunks[index - 1].text;
    const current = chunks[index].text;
    const overlap = longestSuffixPrefix(previous, current);
    if (!overlap) continue;
    const beforeOverlap = previous.slice(0, previous.length - overlap).trimEnd();
    assert.match(
      beforeOverlap,
      /[.!?…](?:["»”')\]]*)?$/,
      `overlap must begin after a complete sentence in ${filePath}#${chunks[index].chunkIndex}`
    );
  }
}

const candidates = top('Quels sont les candidats déclarés à la présidentielle 2027 ?', { limit: 12 });
assert.ok(candidates.some((item) => item.citation.kind === 'candidate_status'));
assert.ok(candidates.some((item) => item.citation.entityId === 'jean-luc-melenchon'));
assert.ok(candidates.filter((item) => item.citation.entityId === 'jean-luc-melenchon').every((item) => item.citation.partyId === 'la-france-insoumise'));

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
  summary:'Résumé complet.',
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

const groupingEvidence = [
  {
    score:10,
    text:'Jean-Luc Mélenchon. Sa candidature présidentielle est déclarée.',
    citation:{entityId:'jean-luc-melenchon',entityLabel:'Jean-Luc Mélenchon',kind:'candidate_status',partyId:'la-france-insoumise',partyName:'La France insoumise'}
  },
  {
    score:9,
    text:'La France insoumise. Le programme documente la suppression du service national universel (SNU). Financement ou chiffrage. Aucun coût global de la mesure n’est indiqué dans la source consultée.',
    citation:{entityId:'la-france-insoumise',entityLabel:'La France insoumise',kind:'document',partyId:'la-france-insoumise',partyName:'La France insoumise'}
  }
];
const grouped = groupPoliticalCards({
  layout:'measures',title:'Mesures',summary:'Résumé',note:'',sections:[],followUps:[],
  cards:[
    {entityId:'jean-luc-melenchon',entityType:'candidate',title:'Jean-Luc Mélenchon',subtitle:'La France insoumise',summary:'Candidature présidentielle déclarée.',bullets:[],sourceNumbers:[1],partyId:'la-france-insoumise',partyName:'La France insoumise',partyColor:'#d7264f',candidateStatus:'declared_presidential'},
    {entityId:'la-france-insoumise',entityType:'party',title:'La France insoumise',subtitle:'Sources',summary:'ional universel (SNU). Financement ou chiffrage. Aucun coût global...',bullets:[],sourceNumbers:[2],partyId:'la-france-insoumise',partyName:'La France insoumise',partyColor:'#d7264f'}
  ]
}, groupingEvidence);
assert.equal(grouped.cards.length, 1, 'candidate and primary-party cards should be merged');
assert.equal(grouped.cards[0].entityId, 'jean-luc-melenchon');
assert.equal(grouped.cards[0].title, 'Jean-Luc Mélenchon');
assert.equal(grouped.cards[0].subtitle, 'La France insoumise');
assert.deepEqual(grouped.cards[0].sourceNumbers, [1, 2], 'merged candidate card should retain candidate and party citations');
assert.ok(!/^ional\b/i.test(grouped.cards[0].summary), 'merged summary must not start mid-word');
assert.ok(!/(?:\.\.\.|…)\s*$/.test(grouped.cards[0].summary), 'merged summary must not end with artificial ellipsis');
assert.match(grouped.cards[0].summary, /Aucun coût global/, 'broken party summary should be rebuilt from complete evidence');

const dlfEvidence = [{
  score:8,
  text:'Projet Debout la France. Le projet politique du parti contient des propositions institutionnelles, économiques, fiscales, migratoires et européennes.',
  citation:{entityId:'debout-la-france',entityLabel:'Debout la France',kind:'document',partyId:'debout-la-france',partyName:'Debout la France'}
}];
const dlfGrouped = groupPoliticalCards({
  layout:'overview',title:'Projet',summary:'Résumé',note:'',sections:[],followUps:[],
  cards:[{entityId:'debout-la-france',entityType:'party',title:'Debout la France',subtitle:'Source',summary:'Projet Debout la France. Le projet politique du parti contient des propositions institutionnelles, économiques, fiscales, migratoires et européennes.',bullets:[],sourceNumbers:[1],partyId:'debout-la-france',partyName:'Debout la France',partyColor:'#476f9f'}]
}, dlfEvidence);
assert.equal(dlfGrouped.cards.length, 1);
assert.equal(dlfGrouped.cards[0].entityId, 'nicolas-dupont-aignan', 'a party-only card should use the unique active candidate when the canonical relationship is unambiguous');
assert.equal(dlfGrouped.cards[0].title, 'Nicolas Dupont-Aignan');
assert.equal(dlfGrouped.cards[0].subtitle, 'Debout la France');

const repairedExcerpt = completeSentenceExcerpt('ional universel (SNU). Financement ou chiffrage. Aucun coût global de la mesure n’est indiqué dans la source consultée.', 80);
assert.equal(repairedExcerpt, 'Financement ou chiffrage. Aucun coût global de la mesure n’est indiqué dans la source consultée.');

const followUpQuery = resolveRetrievalQuery('Et sur l’immigration ?', [
  {role:'user',content:'Que propose Bruno Retailleau ?'},
  {role:'assistant',content:'Réponse précédente'}
]);
assert.match(followUpQuery, /Bruno Retailleau/);
assert.match(followUpQuery, /immigration/);

console.log('Retrieval & presentation QA OK', {
  snapshotDate: meta.snapshotDate,
  indexVersion: meta.indexVersion,
  documents: meta.counts.documents,
  proposals: meta.counts.proposals,
  chunks: meta.counts.chunks,
  markdownFiles: meta.counts.markdownFiles,
  declaredCandidates: declaredCandidates.length
});
