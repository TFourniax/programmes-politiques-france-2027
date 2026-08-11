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
assert.equal(meta.indexVersion, 3);
assert.ok(meta.counts.candidates >= 40);
assert.ok(meta.counts.parties >= 25);
assert.ok(meta.counts.documents >= 20);
assert.ok(meta.counts.proposals >= 25);
assert.equal(meta.counts.markdownFiles, meta.counts.documents + meta.counts.proposals);

const index = JSON.parse(fs.readFileSync(path.join(root, 'data', 'search-index.json'), 'utf8'));
for (const chunk of index.chunks.filter((item) => ['document', 'proposal'].includes(item.kind))) {
  assert.ok(fs.existsSync(path.join(root, chunk.path)), `indexed path must exist: ${chunk.path}`);
  assert.ok(chunk.recordId, `versioned index record must expose recordId: ${chunk.path}`);
  assert.ok(Array.isArray(chunk.supersedes));
  assert.ok(Array.isArray(chunk.supersededBy));
}

const declared = selectCandidates('Qui est déclaré candidat à ce stade ?');
assert.ok(declared.length >= 10);
assert.ok(declared.every((candidate) => ['declared_presidential','party_designated','declared_conditional'].includes(candidate.current_status)));
assert.ok(declared.every((candidate) => candidate.official_candidate === false));

const retirement = top('retraite à 60 ans carrière longue', {limit: 5});
assert.ok(retirement.length > 0);
assert.ok(includesPath(retirement, 'proposals/retraites/') || includesPath(retirement, 'corpus/2027/'));

const smic = top('SMIC 1700 net', {limit: 6});
assert.ok(smic.length > 0);
assert.ok(smic.some((item) => /SMIC/i.test(item.text) || /SMIC/i.test(item.citation.title)));

const immigration = top('Retailleau immigration étudiants extra européens', {limit: 8});
assert.ok(immigration.length > 0);

const service = top('service citoyen neuf mois permis conduire', {limit: 8});
assert.ok(service.length > 0);

const nonsense = top('recette gâteau chocolat tennis formule 1', {limit: 5});
assert.equal(nonsense.length, 0);

const candidateQuestion = 'Quels candidats sont déclarés ?';
const candidateMode = classifyQuestion(candidateQuestion);
assert.equal(candidateMode, 'candidates');
const candidateList = selectCandidates(candidateQuestion);
const candidateEvidenceRows = candidateList.map(candidateEvidence);
const candidateFallback = fallbackStructuredAnswer(candidateQuestion, candidateEvidenceRows, {mode:'candidates', candidates:candidateList});
assert.equal(candidateFallback.cards.length, candidateList.length);
assert.ok(candidateFallback.cards.every((card) => card.entityType === 'candidate'));
assert.ok(candidateFallback.cards.every((card) => card.officialCandidate === false));

const policyQuestion = 'Que propose le corpus sur les retraites ?';
const policyEvidence = top(policyQuestion, {limit: 8});
const raw = {
  layout:'measures',
  title:'Retraites',
  summary:'Résumé',
  cards:[
    {entityId:policyEvidence[0]?.citation.entityId,title:'Carte',summary:'Texte',sourceNumbers:[1]},
    {entityId:'entity-invented-by-model',title:'Injection',summary:'À supprimer',sourceNumbers:[1]}
  ],
  sections:[],followUps:[]
};
const hydrated = hydrateStructuredAnswer(raw,policyQuestion,policyEvidence,{mode:'measures'});
assert.ok(hydrated.cards.every((card) => !card.entityId || policyEvidence.some((item) => item.citation.entityId === card.entityId)));

const grouped = groupPoliticalCards(hydrated,policyEvidence);
assert.ok(Array.isArray(grouped.cards));
assert.ok(grouped.cards.length <= hydrated.cards.length);

assert.equal(completeSentenceExcerpt('Une première phrase complète. Une deuxième phrase assez longue pour dépasser la limite.', 35), 'Une première phrase complète.');

const history = [{role:'user',content:'Compare les positions sur les retraites'}];
assert.match(resolveRetrievalQuery('Et Renaissance ?',history),/Compare les positions sur les retraites/);

console.log('Retrieval and presentation QA OK');
