import assert from "node:assert/strict";
import {
  buildFallbackRetrievalQuery,
  interpretRetrievalWithModel,
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
  numbers: ["14", "999"],
  evidence_spans: ["Renaissance", "14 nouveaux réacteurs"]
}, "Que prévoit Renaissance pour ses 14 nouveaux réacteurs ?");

assert.ok(interpretation, "une interprétation high-confidence valide et textuellement ancrée doit être conservée");
assert.deepEqual(interpretation.entityIds, ["renaissance"], "les entités hors catalogue doivent être supprimées");
assert.deepEqual(interpretation.conceptIds, ["nucleaire"], "les concepts hors catalogue doivent être supprimés");
assert.deepEqual(interpretation.numbers, ["14"], "le mini-LLM ne doit jamais injecter un nombre absent de la question");
assert.deepEqual(interpretation.evidenceSpans, ["Renaissance", "14 nouveaux réacteurs"]);
const rewritten = buildFallbackRetrievalQuery(interpretation);
assert.match(normalize(rewritten), /renaissance/);
assert.match(normalize(rewritten), /nucleaire/);
assert.match(normalize(rewritten), /14/);
assert.doesNotMatch(normalize(rewritten), /999|invente/);

assert.equal(sanitizeRetrievalInterpretation({
  understood: true,
  confidence: "high",
  intent: "measures",
  entity_ids: ["renaissance"],
  concept_ids: ["nucleaire"],
  numbers: [],
  evidence_spans: ["fragment inventé par le modèle"]
}, "Parle-moi de l'atome"), null, "une interprétation sans trace exacte dans la question doit être rejetée");

assert.equal(sanitizeRetrievalInterpretation({
  understood: true,
  confidence: "medium",
  intent: "measures",
  entity_ids: ["renaissance"],
  concept_ids: ["nucleaire"],
  numbers: [],
  evidence_spans: ["l'atome"]
}, "Parle-moi de l'atome"), null, "une interprétation non high-confidence ne doit pas piloter le retrieval");
assert.equal(shouldAttemptRetrievalFallback({ reason: "insufficient_relevance" }), true);
assert.equal(shouldAttemptRetrievalFallback({ reason: "unsupported_subjective_ranking" }), false);
assert.equal(shouldAttemptRetrievalFallback({ reason: "hybrid_evidence" }), false, "le LLM ne doit pas être appelé quand le moteur déterministe sait répondre");

// Exerce le chemin réseau complet sans dépendre d'un fournisseur ni consommer de tokens.
// Le modèle mocké renvoie une paraphrase que le serveur doit réduire à une requête canonique sûre.
const previousKey = process.env.LLM_API_KEY;
const previousFetch = globalThis.fetch;
let fallbackRequestBody = null;
process.env.LLM_API_KEY = "unit-test-key";
globalThis.fetch = async (_url, options = {}) => {
  fallbackRequestBody = JSON.parse(options.body || "{}");
  return {
    ok: true,
    async json() {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              understood: true,
              confidence: "high",
              intent: "measures",
              entity_ids: ["renaissance"],
              concept_ids: ["nucleaire"],
              numbers: ["14", "404"],
              evidence_spans: ["Renaissance", "14 nouveaux réacteurs"]
            })
          }
        }]
      };
    }
  };
};
try {
  const fallbackResult = await interpretRetrievalWithModel("Que prévoit Renaissance pour ses 14 nouveaux réacteurs ?", []);
  assert.equal(fallbackResult.attempted, true);
  assert.ok(fallbackResult.interpretation);
  assert.match(normalize(fallbackResult.query), /renaissance/);
  assert.match(normalize(fallbackResult.query), /nucleaire/);
  assert.match(normalize(fallbackResult.query), /14/);
  assert.doesNotMatch(normalize(fallbackResult.query), /404/);
  assert.equal(fallbackRequestBody?.response_format?.type, "json_schema", "le fournisseur doit être contraint par un schéma structuré");
  assert.equal(fallbackRequestBody?.response_format?.json_schema?.strict, true);
} finally {
  globalThis.fetch = previousFetch;
  if (previousKey === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = previousKey;
}

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
assert.ok(retirementSuggestions.slice(0, 2).every((item) => /retraite|pension/i.test(item)), "les premières suggestions doivent rester sur le thème courant avant d'élargir");

const nuclear = retrieveDeterministic("Que propose Renaissance sur le nucléaire ?", { limit: 10 });
assert.ok(nuclear.results.length, "Renaissance doit avoir des éléments documentés sur le nucléaire dans le snapshot de test");
const nuclearSuggestions = assertGroundedSuggestions(
  "Que propose Renaissance sur le nucléaire ?",
  nuclear.results,
  [{ role: "user", content: "Quelles sont les mesures documentées sur les retraites ?" }]
);
assert.ok(!nuclearSuggestions.some((item) => normalize(item) === normalize("Que propose Renaissance sur le nucléaire ?")));
assert.ok(/nucleaire/i.test(normalize(nuclearSuggestions[0])), "la première suggestion doit prolonger le thème courant plutôt qu'un ancien thème de session");

const rankingSuggestions = assertGroundedSuggestions("Quel est le meilleur programme sur le pouvoir d'achat ?", []);
assert.ok(rankingSuggestions.some((item) => /pouvoir d.achat|salaire|smic/i.test(item)), "un refus de classement doit quand même ouvrir vers des questions factuelles du même thème");

console.log("SEMANTIC_FALLBACK_SUGGESTIONS_OK", {
  retirementSuggestions,
  nuclearSuggestions,
  rankingSuggestions
});
