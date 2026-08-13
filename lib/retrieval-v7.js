import searchIndex from "../data/search-index.json" with { type: "json" };
import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV6
} from "./retrieval-v6.js";

const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const NON_DISCRIMINATING_TERMS = new Set([
  "abroger", "ajouter", "augmenter", "baisser", "construire", "creer", "diminuer", "financer", "introduire",
  "lancer", "limiter", "mettre", "permettre", "porter", "prevoir", "reformer", "remplacer", "restreindre",
  "selection", "supprimer", "viser", "actuel", "actuelle", "mesure", "projet", "proposition", "programme"
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

const publicChunks = (searchIndex.chunks || []).filter((chunk) => {
  if (!["document", "proposal"].includes(chunk.kind)) return true;
  return !INACTIVE.has(String(chunk.documentStatus || "unknown").toLowerCase());
});
const documentFrequency = new Map();
for (const chunk of publicChunks) {
  const rowTerms = new Set(terms([chunk.title, chunk.section, chunk.text].filter(Boolean).join(" ")));
  for (const term of rowTerms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
}
const rareFrequencyCeiling = Math.max(8, Math.ceil(publicChunks.length * 0.02));

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

function rareExplicitQualifier(question) {
  const analysis = analyzeQuery(question);
  if (!analysis.concepts?.length) return [];
  const covered = conceptCoveredTerms(analysis.concepts);
  const numbers = new Set(analysis.numbers || []);
  const candidates = [...new Set(analysis.subjectTokens || [])]
    .map(stem)
    .filter((term) => term.length >= 5)
    .filter((term) => !numbers.has(term))
    .filter((term) => !covered.has(term))
    .filter((term) => !NON_DISCRIMINATING_TERMS.has(term));
  const rare = candidates.filter((term) => {
    const df = documentFrequency.get(term) || 0;
    return df > 0 && df <= rareFrequencyCeiling;
  });
  // A single rare residual is a strong lexical identifier (a named scheme,
  // institution or policy device). Multiple rare residuals may form a semantic
  // paraphrase, so preserve V6 recall rather than requiring every word verbatim.
  return rare.length === 1 ? rare : [];
}

function evidenceTerms(item) {
  return new Set(terms([
    item?.citation?.title,
    item?.citation?.section,
    item?.text
  ].filter(Boolean).join(" ")));
}

function enforceRareExplicitQualifier(question, result) {
  if (!result?.results?.length) return result;
  const anchors = rareExplicitQualifier(question);
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
  return enforceRareExplicitQualifier(question, retrieveV6(question, options));
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
