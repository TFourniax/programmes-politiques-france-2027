import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV5
} from "./retrieval-v5.js";

const BENIGN_UNKNOWN_QUALIFIERS = new Set([
  "adolescent","adolescents","comment","mineur","mineurs","nuit","nets","part","portent",
  "monter","permettre","partir","finir","financee","attribuer","chacun","personne","couper","pendant",
  "reformer","acces","davantage","fondee","programmer","programmation","plusieurs","annee","annees",
  "travailleur","travailleurs","metier","metiers","plus","moins","tot","tard","introduire","ajouter",
  "completer","limiter","creer","mettre","viser","porter","lancer","construire","remplacer","supprimer"
]);

function retryWithoutHarmlessQualifiers(question, debug, options) {
  const unknown = [...new Set(debug?.unknownQualifierTokens || [])];
  if (!unknown.length || !unknown.every((term) => BENIGN_UNKNOWN_QUALIFIERS.has(term))) return null;
  const blocked = new Set(unknown);
  const cleaned = normalize(question)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => !blocked.has(term))
    .join(" ");
  if (!cleaned || cleaned === normalize(question)) return null;
  const retried = retrieveV5(cleaned, options);
  return {
    ...retried,
    debug: {
      ...retried.debug,
      harmlessQualifierRetry: true,
      harmlessQualifierTokens: unknown,
      originalQuestion: question
    }
  };
}

export function retrieveDeterministic(question, options = {}) {
  const first = retrieveV5(question, options);
  if (first.debug?.reason !== "unknown_qualifier") return first;
  return retryWithoutHarmlessQualifiers(question, first.debug, options) || first;
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
