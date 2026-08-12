import { retrieveDeterministic } from '../lib/retrieval-v2.js';
import { composeDeterministicAnswer } from '../lib/deterministic-answer-v2.js';
import { classifyQuestion, selectCandidates, candidateEvidence } from '../lib/presentation.js';

const questions = [
  "Quel projet propose d'abroger Parcoursup ?",
  "Quelles propositions documentées concernent le pouvoir d'achat et les salaires ?",
  "Quel projet veut développer fortement l'atome avec de nouveaux réacteurs ?",
  "Que propose Renaissance pour développer le nucléaire ?",
  "Qui veut attribuer à chacun un budget personnel d'émissions de CO2 ?",
  "Compare David Lisnard et Renaissance sur les retraites",
  "Parle-moi de Formule 1"
];

for (const question of questions) {
  const mode = classifyQuestion(question);
  const candidates = mode === 'candidates' ? selectCandidates(question) : [];
  const retrieval = retrieveDeterministic(question, { limit: mode === 'comparison' ? 14 : 10 });
  let evidence = retrieval.results;
  if (mode === 'candidates' && retrieval.debug.answerable) evidence = candidates.map(candidateEvidence);
  const answer = evidence.length
    ? composeDeterministicAnswer(question, evidence, { mode, candidates })
    : {
        layout: 'overview',
        title: 'Aucune donnée pertinente dans le corpus',
        summary: `Le corpus ne contient pas d’élément suffisamment pertinent pour répondre à « ${question} ».`,
        note: 'Réponse refusée plutôt que complétée avec des informations hors corpus.',
        sections: [], cards: [], followUps: []
      };
  console.log('SIMULATED_DETERMINISTIC_ANSWER=' + JSON.stringify({
    question,
    mode,
    retrieval: {
      answerable: retrieval.debug.answerable,
      concepts: retrieval.debug.concepts,
      requestedEntities: retrieval.debug.requestedEntities,
      paths: evidence.slice(0, 6).map((item) => item.citation?.path)
    },
    answer
  }));
}
