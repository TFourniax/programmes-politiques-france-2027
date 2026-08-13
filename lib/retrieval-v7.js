import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV6
} from "./retrieval-v6.js";

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
  const subjectTerms = new Set((analysis.subjectTokens || []).map(stem));
  const candidates = [];

  // This is deliberately narrow: only a proper-case token that survives the
  // normal query analyser as a genuine subject term may become a literal anchor.
  // It protects named policy devices such as Parcoursup without ever turning
  // sentence-leading verbs/interrogatives (Compare, Parle, Quelles...) into
  // fake political entities. Multi-word concepts remain handled by the ontology.
  for (const match of String(question || "").matchAll(/[\p{Lu}][\p{L}\p{N}]{3,}/gu)) {
    const surface = match[0];
    if (surface === surface.toUpperCase()) continue;
    const normalizedSurface = normalize(surface);
    if (!normalizedSurface || normalizedSurface.includes(" ") || GENERIC_TITLED_NOUNS.has(normalizedSurface)) continue;
    const token = stem(normalizedSurface);
    if (token.length < 5 || !subjectTerms.has(token)) continue;
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
