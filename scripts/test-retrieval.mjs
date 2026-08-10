import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import entities from '../data/entities.json' with { type: 'json' };
import { retrieve, getMeta } from '../lib/retrieval.js';
import { completeSentenceExcerpt, groupPoliticalCards } from '../lib/card-grouping.js';
import { candidateEvidence, classifyQuestion, fallbackStructuredAnswer, hydrateStructuredAnswer, resolveRetrievalQuery, selectCandidates } from '../lib/presentation.js';

const root = path.resolve(process.cwd());
const top = (query, options) => retrieve(query, options).results;
const includesPath = (results, fragment) => results.some((item) => item.citation.path.includes(fragment));

const meta = getMeta();
assert.equal(meta.snapshotDate, entities.snapshot_date);
assert.equal(meta.indexVersion, 2);
assert.ok(meta.counts.candidates >= 40);
assert.ok(meta.counts.parties >= 25);
assert.ok(meta.counts.documents >= 20);
assert.ok(meta.counts.proposals >= 25);
assert.equal(meta.counts.markdownFiles, meta.counts.documents + meta.counts.proposals);

const index = JSON.parse(fs.readFileSync(path.join(root, 'data', 'search-index.json'), 'utf8'));
for (const chunk of index.chunks.filter((item) => ['document', 'proposal'].includes(item.kind))) {
  assert.ok(fs.existsSync(path.join(root, chunk.path)), `indexed path must exist: ${chunk.path}`);
}

const declared = selectCandidates('Qui est déclaré candidat à ce stade ?');
assert.ok(declared.length >= 10);
assert.ok(declared.every((candidate) => ['declared_presidential','party_designated','declared_conditional'].includes(candidate.current_status)));
assert.ok(declared.every((candidate) => candidate.official_candidate === false));
const declaredEvidence = declared.map(candidateEvidence);
const candidateAnswer = fallbackStructuredAnswer('Qui est déclaré candidat à ce stade ?', declaredEvidence, { mode:'candidates', candidates:declared });
assert.equal(candidateAnswer.cards.length, declared.length);

assert.equal(classifyQuestion('Quels sont les candidats officiels ?'), 'candidates');
assert.equal(classifyQuestion('Quels candidats ont déjà des propositions documentées ?'), 'measures');
assert.equal(classifyQuestion('Compare les positions documentées sur les retraites'), 'comparison');

const kazibSmic = top('Qui propose un SMIC à 2000 euros ?', { limit: 8, minScore: 1.2 });
assert.ok(includesPath(kazibSmic, 'anasse-kazib-smic-2000.md'));
const psSmic = top('Quel programme propose un SMIC à 1690 euros net ?', { limit: 8, minScore: 1.2 });
assert.ok(includesPath(psSmic, 'ps-smic-1690.md'));
const lisnardSchool = top('Qui veut supprimer la carte scolaire ?', { limit: 8, minScore: 1.2 });
assert.ok(includesPath(lisnardSchool, 'david-lisnard-suppression-carte-scolaire.md'));
const psParcoursup = top('Quel programme veut abroger Parcoursup ?', { limit: 8, minScore: 1.2 });
assert.ok(includesPath(psParcoursup, 'ps-abrogation-parcoursup.md'));
const retirement = top('Qui propose la retraite à 60 ans ?', { limit: 10, minScore: 1.2 });
assert.ok(retirement.some((item) => /60 ans/.test(item.text)));

const nonsense = top('zyxqv blorptastic quasarbanane', { limit: 8, minScore: 4 });
assert.equal(nonsense.length, 0);

const followUpQuery = resolveRetrievalQuery('Et sur l’immigration ?', [
  {role:'user',content:'Que propose Bruno Retailleau ?'},
  {role:'assistant',content:'Réponse précédente'}
]);
assert.match(followUpQuery, /Bruno Retailleau/);
assert.match(followUpQuery, /immigration/);

const hydrated = hydrateStructuredAnswer({
  layout:'measures', title:'Test', summary:'Test', note:'', sections:[],
  cards:[{ entityId:'invented-entity', title:'Hallucination', subtitle:'', summary:'', bullets:[], sourceNumbers:[1] }], followUps:[]
}, 'Qui propose un SMIC à 2000 euros ?', kazibSmic, { mode:'measures' });
assert.ok(!hydrated.cards.some((card) => card.entityId === 'invented-entity'));

const groupingEvidence = [
  { score:10, text:'Jean-Luc Mélenchon. Sa candidature présidentielle est déclarée.', citation:{entityId:'jean-luc-melenchon',entityLabel:'Jean-Luc Mélenchon',kind:'candidate_status',partyId:'la-france-insoumise',partyName:'La France insoumise'} },
  { score:9, text:'La France insoumise. Le programme documente une mesure de parti.', citation:{entityId:'la-france-insoumise',entityLabel:'La France insoumise',kind:'document',partyId:'la-france-insoumise',partyName:'La France insoumise'} }
];
const grouped = groupPoliticalCards({ layout:'measures', title:'Mesures', summary:'Résumé', note:'', sections:[], followUps:[], cards:[
  {entityId:'jean-luc-melenchon',entityType:'candidate',title:'Jean-Luc Mélenchon',subtitle:'La France insoumise',summary:'Candidature déclarée.',bullets:[],sourceNumbers:[1],partyId:'la-france-insoumise',partyName:'La France insoumise'},
  {entityId:'la-france-insoumise',entityType:'party',title:'La France insoumise',subtitle:'Parti',summary:'Mesure de parti.',bullets:[],sourceNumbers:[2],partyId:'la-france-insoumise',partyName:'La France insoumise'}
]}, groupingEvidence);
assert.equal(grouped.cards.length, 1);
assert.equal(grouped.cards[0].entityId, 'jean-luc-melenchon');
assert.deepEqual(grouped.cards[0].sourceNumbers, [1,2]);

const repaired = completeSentenceExcerpt('ional universel. Première phrase complète. Deuxième phrase complète.', 40);
assert.ok(!/^ional\b/i.test(repaired));

console.log('Production retrieval QA OK', {
  snapshotDate: meta.snapshotDate,
  candidates: meta.counts.candidates,
  documents: meta.counts.documents,
  proposals: meta.counts.proposals,
  chunks: meta.counts.chunks
});
