import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV6
} from "./retrieval-v6.js";

const QUESTION_WORDS = new Set([
  "comment", "combien", "laquelle", "lequel", "lesquels", "pourquoi", "quand", "quel", "quelle", "quelles", "quels", "qui", "quoi"
]);
const COMMAND_WORDS = new Set([
  "compare", "comparer", "comparez", "comparons", "decris", "decrire", "decrivez", "dis", "dire", "dites",
  "donne", "donner", "donnez", "explique", "expliquer", "expliquez", "indique", "indiquer", "indiquez",
  "liste", "lister", "listez", "montre", "montrer", "montrez", "parle", "parler", "parlez", "presente", "presenter",
  "presentez", "raconte", "raconter", "racontez", "resume", "resumer", "resumez"
]);
const GENERIC_TITLED_NOUNS = new Set([
  "article", "constitution", "europe", "france", "loi", "plan", "programme", "projet", "reforme", "republique"
]);

function stem(value = "") {
  const term = normalize(value);
  if (term.length <= 4 || /^\d+$/.test(term)) return term;
  if (term.endsWith("aux") && term.length > 6) return `${term.slice(0, -3)}al`;
  if (term.endsWith("es") && term.length > 6) return term.slice(0, -2);
  if (term.endsWith("s") && term.length > 5) return term.slice(0, -1);
  return term;
}

function terms(value = "") {
  return normalize(value).split(/\s+/).filter(Boolean).map(stem);
}

function conceptCoveredTerms(concepts = []) {
  const covered = new Set();
  for (const concept of concepts) {
    const source = [
      concept.matchedAlias,
      concept.label,
      ...(concept.aliases || []),
      ...(concept.retrieval_terms || [])
    ].filter(Boolean).join(" ");
    for (const term of terms(source)) covered.add(term);
  }
  return covered;
}

function entityCoveredTerms(entities = []) {
  const covered = new Set();
  for (const entity of entities) {
    for (const term of terms(`${entity?.name || ""} ${entity?.id || ""}`)) covered.add(term);
  }
  return covered;
}

function namedPolicyQualifier(question) {
  const analysis = analyzeQuery(question);
  const conceptTerms = conceptCoveredTerms(analysis.concepts || []);
  const entityTerms = entityCoveredTerms(analysis.requestedEntities || []);
  const candidates = [];

  // Only enforce literal matching for a proper-name-like identifier explicitly
  // typed by the user (e.g. Parcoursup). Ordinary political vocabulary must stay
  // semantic: carbon, capitalisation, nuclear, investment, etc. are deliberately
  // not forced to appear verbatim because the ontology covers their paraphrases.
  // Sentence-initial interrogatives and user command verbs are excluded before
  // stemming so natural prompts can never become fake policy names.
  for (const match of String(question || "").matchAll(/[\p{Lu}][\p{L}\p{N}’'\-]{3,}/gu)) {
    const surface = match[0];
    if (surface === surface.toUpperCase()) continue;
    const normalizedSurface = normalize(surface);
    if (
      QUESTION_WORDS.has(normalizedSurface)
      || COMMAND_WORDS.has(normalizedSurface)
      || GENERIC_TITLED_NOUNS.has(normalizedSurface)
    ) continue;
    const token = stem(surface);
    if (token.length < 5) continue;
    if (conceptTerms.has(token) || entityTerms.has(token)) continue;
    candidates.push(token);
  }

  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique : [];
}

function evidenceTerms(item) {
  return new Set(terms([
    item?.citation?.title,
    item?.citation?.section,
    item?.text
  ].filter(Boolean).join(" ")));
}

function enforceNamedPolicyQualifier(question, result) {
  if (!result?.results?.length) return result;
  const anchors = namedPolicyQualifier(question);
  if (anchors.length !== 1) return result;
  const [anchor] = anchors;
  const filtered = result.results.filter((item) => evidenceTerms(item).has(anchor));
  if (filtered.length === result.results.length) {
    return { ...result, debug: { ...result.debug, lexicalAnchorTokens: anchors } };
  }
  return {
    ...result,
    results: filtered,
    debug: {
      ...result.debug,
      answerable: filtered.length > 0,
      reason: filtered.length ? result.debug?.reason : "unmatched_specific_qualifier",
      lexicalAnchorTokens: anchors,
      lexicalAnchorFiltered: result.results.length - filtered.length
    }
  };
}

export function retrieveDeterministic(question, options = {}) {
  return enforceNamedPolicyQualifier(question, retrieveV6(question, options));
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
