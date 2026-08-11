import assert from 'node:assert/strict';
import fs from 'node:fs';
import { retrieve as prodRetrieve } from '../lib/retrieval.js';
import { analyzeQuery, resolveDeterministicContext, retrieveDeterministic } from '../lib/retrieval-v2.js';
import { composeDeterministicAnswer } from '../lib/deterministic-answer-v2.js';
import { candidateEvidence } from '../lib/presentation.js';
import { classifyDeterministicQuestion, isTargetedCandidateQuestion, selectDeterministicCandidates } from '../lib/deterministic-query.js';

const checks=[];
function record(category,id,ok,details={}){checks.push({category,id,ok,...details});}
function paths(result){return result.results.map((item)=>item.citation?.path).filter(Boolean);}
function entities(result){return [...new Set(result.results.map((item)=>item.citation?.entityId).filter(Boolean))];}
function includesAny(values,expected){return expected.some((item)=>values.includes(item));}
function routeMode(question,history=[]){const context=resolveDeterministicContext(question,history);let mode=classifyDeterministicQuestion(question);if(mode==='overview'&&context.inheritedMode)mode=context.inheritedMode;return{context,mode};}

const robustness=[
{id:'smic-punctuation',q:'Qui propose un SMIC à 2000€ ?',expected:['proposals/pouvoir-achat-travail/anasse-kazib-smic-2000.md']},
{id:'smic-dot',q:'Qui propose un SMIC à 2.000€ ?',expected:['proposals/pouvoir-achat-travail/anasse-kazib-smic-2000.md']},
{id:'smic-space',q:'Qui défend un salaire minimum à 2 000 € ?',expected:['proposals/pouvoir-achat-travail/anasse-kazib-smic-2000.md']},
{id:'parcoursup-platform',q:"Qui veut supprimer la plateforme d’admission post-bac Parcoursup ?",expected:['proposals/services-publics/ps-abrogation-parcoursup.md']},
{id:'parcoursup-spacing',q:'Qui veut remplacer Parcour sup par une procédure publique ?',expected:['proposals/services-publics/ps-abrogation-parcoursup.md']},
{id:'nuclear-typo',q:'Quelle formation veut développer le nucleair avec de nouveaux réacteurs ?',expected:['proposals/ecologie-energie/renaissance-14-epr-smr-2030.md']},
{id:'immigration-typo',q:"Quel projet prévoit une loi pluriannuelle sur l’immigraiton ?",expected:['proposals/immigration-integration/ps-loi-pluriannuelle-immigration.md']},
{id:'retirement-typo',q:'Qui propose une retraitre anticipée pour les métiers pénibles ?',expected:['proposals/retraites/anasse-kazib-60-55.md']},
{id:'school-geographic',q:"Qui veut supprimer l’affectation scolaire selon la zone géographique ?",expected:['proposals/services-publics/david-lisnard-suppression-carte-scolaire.md']},
{id:'carbon-account',q:'Quel parti veut créer un compte carbone individuel pour chaque personne ?',expected:['proposals/ecologie-energie/equinoxe-quotas-carbone-individuels.md']},
{id:'night-internet',q:"Qui veut restreindre l’accès à internet des adolescents pendant la nuit ?",expected:['proposals/securite-justice/renaissance-couvre-feu-numerique-mineurs.md']},
{id:'salary-ratio',q:'Quel projet veut limiter l’écart de rémunération de 1 à 20 ?',expected:['proposals/pouvoir-achat-travail/ps-ratio-salaires-1-20.md']},
{id:'median-salary',q:'Quel parti vise un salaire médian de 3000 euros par mois ?',expected:['proposals/pouvoir-achat-travail/renaissance-salaire-median-3000.md']},
{id:'source-epr',q:'Quelle est la source officielle de la proposition de construire 14 EPR ?',expected:['proposals/ecologie-energie/renaissance-14-epr-smr-2030.md']}
];
for(const test of robustness){const prod=prodRetrieve(test.q,{limit:8}),exp=retrieveDeterministic(test.q,{limit:8});const pp=paths(prod),ep=paths(exp);record('robustness',test.id,includesAny(ep,test.expected),{question:test.q,prodHit:includesAny(pp,test.expected),expHit:includesAny(ep,test.expected),prodTop:pp.slice(0,3),expTop:ep.slice(0,3)});}

const scopedNegatives=[
['lisnard-dinosaurs','Que propose David Lisnard sur les dinosaures ?'],['ps-lyme','Que propose le PS sur la maladie de Lyme ?'],['renaissance-mars','Que propose Renaissance pour coloniser Mars ?'],['equinoxe-bitcoin','Que propose Équinoxe sur le Bitcoin ?'],['kazib-f1','Que propose Anasse Kazib sur la Formule 1 ?']];
for(const[id,q]of scopedNegatives){const prod=prodRetrieve(q,{limit:6}),exp=retrieveDeterministic(q,{limit:6});record('scoped-negative',id,exp.results.length===0,{question:q,prodCount:prod.results.length,expCount:exp.results.length,prodEntities:entities(prod),expEntities:entities(exp)});}

const comparisons=[
{id:'lisnard-ren-retraites',q:'Compare David Lisnard et Renaissance sur les retraites',allowed:['david-lisnard','renaissance'],required:['david-lisnard','renaissance']},
{id:'ps-kazib-smic',q:'Compare le PS et Anasse Kazib sur le SMIC',allowed:['parti-socialiste','anasse-kazib'],required:['parti-socialiste','anasse-kazib']},
{id:'ps-lfi-kazib-smic',q:'Compare le PS, LFI et Anasse Kazib sur le SMIC',allowed:['parti-socialiste','la-france-insoumise','anasse-kazib'],required:['parti-socialiste','la-france-insoumise','anasse-kazib']},
{id:'ren-equinoxe-climat',q:'Compare Renaissance et Équinoxe sur le climat et le carbone',allowed:['renaissance','equinoxe'],required:['renaissance','equinoxe']}
];
for(const test of comparisons){const exp=retrieveDeterministic(test.q,{limit:14});const ids=entities(exp);const allowed=ids.every((id)=>test.allowed.includes(id)),required=test.required.every((id)=>ids.includes(id));record('comparison',test.id,allowed&&required,{question:test.q,entities:ids,paths:paths(exp).slice(0,8)});}

const composite=[
{id:'ps-smic-parcoursup',q:'Que propose le PS sur le SMIC et Parcoursup ?',all:['proposals/pouvoir-achat-travail/ps-smic-1690.md','proposals/services-publics/ps-abrogation-parcoursup.md']},
{id:'ren-nuclear-retirement',q:'Que propose Renaissance sur le nucléaire et les retraites ?',all:['proposals/ecologie-energie/renaissance-14-epr-smr-2030.md','proposals/retraites/renaissance-retraite-investissement.md']},
{id:'two-smic-amounts',q:'Compare les propositions de SMIC à 1 690 et 2 000 euros',all:['proposals/pouvoir-achat-travail/ps-smic-1690.md','proposals/pouvoir-achat-travail/anasse-kazib-smic-2000.md']}
];
for(const test of composite){const exp=retrieveDeterministic(test.q,{limit:14});const ep=paths(exp);record('composite',test.id,test.all.every((p)=>ep.includes(p)),{question:test.q,paths:ep.slice(0,10)});}

const namedCandidateQueries=[
{id:'lisnard-status',q:'Quel est le statut de la candidature de David Lisnard ?',name:'David Lisnard'},
{id:'retailleau-official',q:'Bruno Retailleau est-il candidat officiel ?',name:'Bruno Retailleau'},
{id:'bouamrane-status',q:'Quel est le statut de Karim Bouamrane ?',name:'Karim Bouamrane'}
];
for(const test of namedCandidateQueries){const mode=classifyDeterministicQuestion(test.q),candidates=selectDeterministicCandidates(test.q);const exact=candidates.filter((c)=>c.name===test.name);const evidence=candidates.map(candidateEvidence);const answer=composeDeterministicAnswer(test.q,evidence,{mode,candidates,candidateTargeted:isTargetedCandidateQuestion(test.q)});const officialAnswered=answer.cards.length===1&&answer.cards[0].bullets.some((b)=>/Candidat officiel au sens du Conseil constitutionnel/i.test(b));record('candidate-status',test.id,mode==='candidates'&&exact.length===1&&candidates.length===1&&officialAnswered,{question:test.q,mode,candidateNames:candidates.map((c)=>c.name),title:answer.title,cards:answer.cards.map((c)=>({title:c.title,status:c.statusLabel,official:c.officialCandidate,bullets:c.bullets}))});}

const unsafeQuestions=[
['absence-capitalisation','Qui ne propose pas de retraite par capitalisation ?'],['absence-nuclear','Quels partis ne parlent pas du nucléaire ?'],['ranking-nuclear','Quel candidat est le plus favorable au nucléaire ?'],['ranking-purchasing','Quel est le meilleur programme pour le pouvoir d’achat ?'],['ranking-right','Qui est le plus à droite ?'],['ranking-immigration','Quel est le pire programme sur l’immigration ?']];
for(const[id,q]of unsafeQuestions){const analysis=analyzeQuery(q),exp=retrieveDeterministic(q,{limit:8});const safe=analysis.intent?.unsupported===true&&exp.results.length===0&&String(exp.debug.reason||'').startsWith('unsupported_');record('unsafe-inference',id,safe,{question:q,intent:analysis.intent,reason:exp.debug.reason,paths:paths(exp)});}

const conversations=[
{id:'replace-topic-keep-entities',history:[{role:'user',content:'Compare David Lisnard et Renaissance sur les retraites'}],q:'Et sur le nucléaire ?',expectedPath:'proposals/ecologie-energie/renaissance-14-epr-smr-2030.md',forbiddenPath:'proposals/retraites/david-lisnard-capitalisation.md',mode:'comparison'},
{id:'keep-topic-replace-entity',history:[{role:'user',content:'Que propose le PS sur le SMIC ?'}],q:'Et Anasse Kazib ?',expectedPath:'proposals/pouvoir-achat-travail/anasse-kazib-smic-2000.md',forbiddenEntity:'parti-socialiste',mode:'measures'}
];
for(const test of conversations){const routed=routeMode(test.q,test.history),exp=retrieveDeterministic(routed.context.query,{limit:14});const ep=paths(exp),ids=entities(exp);const ok=ep.includes(test.expectedPath)&&(!test.forbiddenPath||!ep.includes(test.forbiddenPath))&&(!test.forbiddenEntity||!ids.includes(test.forbiddenEntity))&&routed.mode===test.mode;record('conversation',test.id,ok,{question:test.q,resolved:routed.context.query,inheritedMode:routed.context.inheritedMode,mode:routed.mode,concepts:exp.debug.concepts,entities:ids,paths:ep.slice(0,10)});}

const attributionQ='Que propose Gabriel Attal sur le nucléaire ?';
const attribution=retrieveDeterministic(attributionQ,{limit:10});
record('attribution','candidate-party-separation',!entities(attribution).includes('renaissance'),{question:attributionQ,entities:entities(attribution),paths:paths(attribution)});

const coverageQ='Compare David Lisnard et Renaissance sur le nucléaire';
const coverageRetrieval=retrieveDeterministic(coverageQ,{limit:14});
const coverageAnswer=composeDeterministicAnswer(coverageQ,coverageRetrieval.results,{mode:'comparison',requestedEntities:coverageRetrieval.debug.requestedEntities});
record('coverage','explicit-missing-actor',coverageAnswer.sections.some((s)=>/David Lisnard/.test(s.text)&&/absence.*corpus|Aucun élément/i.test(s.text)),{entities:entities(coverageRetrieval),sections:coverageAnswer.sections});

const answerCases=[
"Quel projet propose d'abroger Parcoursup ?","Qui veut attribuer à chacun un budget personnel d'émissions de CO2 ?",'Compare David Lisnard et Renaissance sur les retraites',"Quelles propositions documentées concernent le pouvoir d'achat et les salaires ?",'Que propose Renaissance sur le nucléaire et les retraites ?'];
for(const q of answerCases){const exp=retrieveDeterministic(q,{limit:14});const answer=composeDeterministicAnswer(q,exp.results,{mode:classifyDeterministicQuestion(q),requestedEntities:exp.debug.requestedEntities});const texts=answer.cards.flatMap((card)=>[card.summary,...(card.bullets||[])]).filter(Boolean);const badMeta=texts.filter((t)=>/^(proposition explicitement documentée|attribution|limite d.attribution|travail et salaires|retraites et épargne|économie, industrie et salaires)$/i.test(String(t).replace(/[.!]$/,'')));const badSubtitle=answer.cards.filter((c)=>/^(attribution|limite d.attribution)$/i.test(c.subtitle||''));const duplicates=[];for(const card of answer.cards){const normalized=[card.summary,...(card.bullets||[])].map((x)=>String(x||'').toLowerCase().replace(/[^a-z0-9à-ÿ]+/g,' ').trim()).filter(Boolean);if(new Set(normalized).size!==normalized.length)duplicates.push(card.entityId);}const sourceValid=answer.cards.every((card)=>(card.sourceNumbers||[]).every((n)=>Number.isInteger(n)&&n>=1&&n<=exp.results.length));const noBroken=texts.every((t)=>!String(t).trim().endsWith('…')&&!String(t).trim().endsWith('...'));const grammarClean=!/élément\(s\)|entité\(s\)/.test(answer.summary);record('answer-quality',q,badMeta.length===0&&badSubtitle.length===0&&duplicates.length===0&&sourceValid&&noBroken&&grammarClean,{cards:answer.cards.map((c)=>({entityId:c.entityId,subtitle:c.subtitle,summary:c.summary,bullets:c.bullets,sourceNumbers:c.sourceNumbers})),summary:answer.summary,badMeta,badSubtitle:badSubtitle.map((c)=>c.entityId),duplicates,sourceValid,noBroken,grammarClean});}

const routeSource=fs.readFileSync('app/api/chat/route.js','utf8');
record('architecture','no-runtime-llm',!routeSource.includes('answerWithModel')&&!routeSource.includes('lib/llm'),{});
record('architecture','unsafe-route-handler',routeSource.includes('unsupportedAnswer')&&routeSource.includes('unsupported_absence_inference'),{});

const byCategory={};for(const row of checks){if(!byCategory[row.category])byCategory[row.category]={total:0,passed:0,failed:[]};byCategory[row.category].total+=1;if(row.ok)byCategory[row.category].passed+=1;else byCategory[row.category].failed.push(row);}
const total=checks.length,passed=checks.filter((row)=>row.ok).length;const prodRobustnessWins=checks.filter((row)=>row.category==='robustness'&&row.prodHit).length;const expRobustnessWins=checks.filter((row)=>row.category==='robustness'&&row.expHit).length;
const report={total,passed,passRate:Number((passed/total).toFixed(3)),comparative:{robustnessCases:robustness.length,prodHits:prodRobustnessWins,experimentalHits:expRobustnessWins},byCategory,failures:checks.filter((row)=>!row.ok)};
console.log('ADVERSARIAL_AUDIT_V4='+JSON.stringify(report));
assert.equal(report.failures.length,0,`adversarial audit v4 found ${report.failures.length} issue(s)`);
