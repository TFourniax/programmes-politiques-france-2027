import assert from "node:assert/strict";
import {
  buildFallbackRetrievalQuery,
  sanitizeRetrievalInterpretation,
  shouldAttemptRetrievalFallback
} from "../lib/retrieval-fallback.js";
import { buildContextualSuggestions } from "../lib/contextual-suggestions.js";
import { normalize, retrieveDeterministic } from "../lib/retrieval-v2.js";

const interpretation = sanitizeRetrievalInterpretation({
  understood: true,
  confidence: "high",
  intent: "measures",
  entity_ids: ["renaissance", "entite-inventee"],
  concept_ids: ["nucleaire", "concept-invente"],
  numbers: ["14", "999"]
}, "Que prévoit Renaissance pour ses 14 nouveaux réacteurs ?");

assert.ok(interpretation, "une interprétation high-confidence valide doit être conservée");
assert.deepEqual(interpretation.entityIds, ["renaissance"], "les entités hors catalogue doivent être supprimées");
assert.deepEqual(interpretation.conceptIds, ["nucleaire"], "les concepts hors catalogue doivent être supprimés");
assert.deepEqual(interpretation.numbers, ["14"], "le mini-LLM ne doit jamais injecter un nombre absent de la question");
const rewritten = buildFallbackRetrievalQuery(interpretation);
assert.match(normalize(rewritten), /renaissance/);
assert.match(normalize(rewritten), /nucleaire/);
assert.match(normalize(rewritten), /14/);
assert.doesNotMatch(normalize(rewritten), /999|invente/);

assert.equal(sanitizeRetrievalInterpretation({
  understood: true,
  confidence: "medium",
  intent: "measures",
  entity_ids: ["renaissance"],
  concept_ids: ["nucleaire"],
  numbers: []
}, "Parle-moi de l'atome"), null, "une interprétation non high-confidence ne doit pas piloter le retrieval");
assert.equal(shouldAttemptRetrievalFallback({ reason: "insufficient_relevance" }), true);
assert.equal(shouldAttemptRetrievalFallback({ reason: "unsupported_subjective_ranking" }), false);
assert.equal(shouldAttemptRetrievalFallback({ reason: "hybrid_evidence" }), false, "le LLM ne doit pas être appelé quand le moteur déterministe sait répondre");

function assertGroundedSuggestions(question, evidence, history = []) {
  const suggestions = buildContextualSuggestions(question, evidence, history, { limit: 3 });
  assert.ok(suggestions.length >= 1 && suggestions.length <= 3, `des suggestions sont attendues pour: ${question}`);
  assert.equal(new Set(suggestions.map(normalize)).size, suggestions.length, "les suggestions doivent être distinctes");
  assert.ok(!suggestions.some((item) => normalize(item) === normalize(question)), "la question courante ne doit pas être répétée");
  for (const suggestion of suggestions) {
    const check = retrieveDeterministic(suggestion, { limit: 4 });
    assert.ok(check.debug.answerable && check.results.length, `la suggestion doit être répondable par le corpus: ${suggestion}`);
    assert.ok(!String(check.debug.reason || "").startsWith("unsupported_"), `la suggestion ne doit pas déclencher un refus: ${suggestion}`);
  }
  return suggestions;
}

const retirement = retrieveDeterministic("Que propose le corpus sur les retraites ?", { limit: 10 });
assert.ok(retirement.results.length, "le corpus doit exposer des éléments sur les retraites");
const retirementSuggestions = assertGroundedSuggestions("Que propose le corpus sur les retraites ?", retirement.results);
assert.ok(retirementSuggestions.some((item) => /retraite|pension/i.test(item)), "au moins une suggestion doit prolonger le thème courant");

const nuclear = retrieveDeterministic("Que propose Renaissance sur le nucléaire ?", { limit: 10 });
assert.ok(nuclear.results.length, "Renaissance doit avoir des éléments documentés sur le nucléaire dans le snapshot de test");
const nuclearSuggestions = assertGroundedSuggestions(
  "Que propose Renaissance sur le nucléaire ?",
  nuclear.results,
  [{ role: "user", content: "Quelles sont les mesures documentées sur les retraites ?" }]
);
assert.ok(!nuclearSuggestions.some((item) => normalize(item) === normalize("Que propose Renaissance sur le nucléaire ?")));

const rankingSuggestions = assertGroundedSuggestions("Quel est le meilleur programme sur le pouvoir d'achat ?", []);
assert.ok(rankingSuggestions.some((item) => /pouvoir d.achat|salaire|smic/i.test(item)), "un refus de classement doit quand même ouvrir vers des questions factuelles du même thème");

console.log("SEMANTIC_FALLBACK_SUGGESTIONS_OK", {
  retirementSuggestions,
  nuclearSuggestions,
  rankingSuggestions
});
