import ontology from "../data/political-ontology.json" with { type: "json" };
import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV5
} from "./retrieval-v5.js";

const BENIGN_UNKNOWN_QUALIFIERS = new Set([
  "acteur","acteurs","adolescent","adolescents","anticipe","anticipee","anticipee","comment","formation","mineur","mineurs","nuit","nets","part","portent",
  "precedent","precedents","precedente","precedentes","sujet",
  "monter","permettre","partir","finir","financee","attribuer","chacun","personne","couper","pendant",
  "reformer","acces","davantage","fondee","programmer","programmation","plusieurs","annee","annees",
  "travailleur","travailleurs","metier","metiers","plus","moins","tot","tard","introduire","ajouter",
  "completer","limiter","creer","mettre","viser","porter","lancer","construire","remplacer","supprimer"
]);

const ONTOLOGY_TERMS = [...new Set(
  ontology.concepts.flatMap((concept) => [
    concept.label,
    ...(concept.aliases || []),
    ...(concept.retrieval_terms || [])
  ]).flatMap((value) => normalize(value).split(/\s+/).filter((term) => term.length >= 5))
)];

function oneEditOrTranspose(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const mismatches = [];
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) mismatches.push(index);
    if (mismatches.length === 1) return true;
    if (mismatches.length === 2) {
      const [first, second] = mismatches;
      return second === first + 1 && a[first] === b[second] && a[second] === b[first];
    }
    return false;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = 0;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    skipped += 1;
    longIndex += 1;
    if (skipped > 1) return false;
  }
  return true;
}

function qualifierStem(value = "") {
  const term = normalize(value);
  if (term.length <= 4 || /^\d+$/.test(term)) return term;
  if (term.endsWith("aux") && term.length > 6) return `${term.slice(0, -3)}al`;
  if (term.endsWith("es") && term.length > 6) return term.slice(0, -2);
  if (term.endsWith("s") && term.length > 5) return term.slice(0, -1);
  return term;
}

function ontologyTypo(term) {
  return term.length >= 5 && ONTOLOGY_TERMS.some((candidate) => oneEditOrTranspose(term, candidate));
}

function harmless(term) {
  return BENIGN_UNKNOWN_QUALIFIERS.has(term) || ontologyTypo(term);
}

function retryWithoutHarmlessQualifiers(question, debug, options) {
  const unknown = [...new Set(debug?.unknownQualifierTokens || [])];
  if (!unknown.length || !unknown.every(harmless)) return null;
  const blocked = new Set(unknown);
  const cleaned = normalize(question)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => !blocked.has(qualifierStem(term)))
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
