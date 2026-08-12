import ontology from "../data/political-ontology.json" with { type: "json" };
import searchIndex from "../data/search-index.json" with { type: "json" };
import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV5
} from "./retrieval-v5.js";

const BENIGN_UNKNOWN_QUALIFIERS = new Set([
  "acteur","acteurs","adolescent","adolescents","anticipe","anticipee","comment","formation","mineur","mineurs","nuit","nets","part","portent",
  "precedent","precedents","precedente","precedentes","sujet","montant","financement","financer","finance","financee",
  "monter","permettre","partir","finir","attribuer","chacun","personne","couper","pendant",
  "reformer","acces","davantage","fondee","programmer","programmation","plusieurs","annee","annees",
  "travailleur","travailleurs","metier","metiers","plus","moins","tot","tard","introduire","ajouter",
  "completer","limiter","creer","mettre","viser","porter","lancer","construire","remplacer","supprimer",
  "simple","simplement"
]);

const POLITICAL_SCOPE_TERMS = new Set([
  "2027","election","electoral","politique","presidentiel","parti"
]);

const CANDIDATE_SCOPE_TERMS = new Set([
  ...POLITICAL_SCOPE_TERMS,
  "declare","declarer","designation","designe","investi","potentiel","probable","possible","primaire","renonce","retire","statut","course","condition",
  "sont","jour","aujourd","hui","liste","nom","present"
]);

const TEMPORAL_BY_PATH = new Map();
for (const chunk of searchIndex.chunks || []) {
  if (!chunk.path || (!chunk.dateBasis && !chunk.capturedAt)) continue;
  const current = TEMPORAL_BY_PATH.get(chunk.path) || {};
  TEMPORAL_BY_PATH.set(chunk.path, {
    dateBasis: current.dateBasis || chunk.dateBasis || null,
    capturedAt: current.capturedAt || chunk.capturedAt || null
  });
}

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

function hasExplicitPoliticalScope(analysis) {
  if (analysis.concepts?.length || analysis.requestedEntities?.length) return true;
  const subject = [...new Set((analysis.subjectTokens || []).map(qualifierStem))];
  if (analysis.intent?.candidateStatus) {
    return subject.every((term) => CANDIDATE_SCOPE_TERMS.has(term));
  }
  if (analysis.intent?.programme || analysis.intent?.source) {
    return subject.length > 0 && subject.every((term) => POLITICAL_SCOPE_TERMS.has(term));
  }
  return false;
}

function outOfScopeResult(question, analysis) {
  return {
    results: [],
    debug: {
      answerable: false,
      reason: "out_of_scope_no_political_anchor",
      concepts: analysis.concepts || [],
      requestedEntities: analysis.requestedEntities || [],
      subjectTokens: analysis.subjectTokens || [],
      unknownQualifierTokens: analysis.unknownQualifierTokens || [],
      numbers: analysis.numbers || [],
      intent: analysis.intent || {},
      originalQuestion: question,
      candidates: 0,
      matched: 0,
      coherent: 0
    }
  };
}

function conceptCoveredTerms(concepts = []) {
  const covered = new Set();
  for (const concept of concepts) {
    const source = [concept.matchedAlias, concept.label, ...(concept.aliases || []), ...(concept.retrieval_terms || [])].filter(Boolean).join(" ");
    for (const term of normalize(source).split(/\s+/).filter(Boolean)) covered.add(qualifierStem(term));
  }
  return covered;
}

function scopedResidualQualifiers(question) {
  const analysis = analyzeQuery(question);
  // This second-stage guard is intentionally limited to an explicitly targeted actor + concept.
  // Broad thematic questions and semantic paraphrases keep the high recall of the base engine.
  if (!analysis.requestedEntities?.length || !analysis.concepts?.length) return [];
  const covered = conceptCoveredTerms(analysis.concepts);
  const numbers = new Set(analysis.numbers || []);
  return [...new Set(analysis.subjectTokens || [])]
    .map(qualifierStem)
    .filter((term) => term.length >= 4)
    .filter((term) => !numbers.has(term))
    .filter((term) => !covered.has(term))
    .filter((term) => !harmless(term));
}

function evidenceTerms(result) {
  const text = [
    result?.citation?.title,
    result?.citation?.section,
    result?.text
  ].filter(Boolean).join(" ");
  return new Set(normalize(text).split(/\s+/).filter(Boolean).map(qualifierStem));
}

function unmatchedTargetedQualifiers(question, results) {
  const residual = scopedResidualQualifiers(question);
  if (!residual.length) return [];
  // Prefer atomic proposals when available: a generic source document containing a word
  // elsewhere (for example "mars" as a month) must not validate the requested qualification.
  const proposals = results.filter((item) => item?.citation?.kind === "proposal");
  const pool = proposals.length ? proposals : results;
  const evidence = pool.map(evidenceTerms);
  return residual.filter((term) => !evidence.some((terms) => terms.has(term)));
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

function enforceTargetedQualifierScope(question, result) {
  if (!result.results?.length) return result;
  const unmatched = unmatchedTargetedQualifiers(question, result.results);
  if (!unmatched.length) return result;
  return {
    results: [],
    debug: {
      ...result.debug,
      answerable: false,
      reason: "unmatched_qualifier",
      unmatchedQualifierTokens: unmatched
    }
  };
}

function exposeTemporalProvenance(result) {
  if (!result.results?.length) return result;
  return {
    ...result,
    results: result.results.map((item) => {
      const temporal = TEMPORAL_BY_PATH.get(item?.citation?.path) || {};
      const rawDate = item?.citation?.publishedAt || null;
      const captureFallback = temporal.dateBasis === "capture_fallback";
      return {
        ...item,
        citation: {
          ...item.citation,
          dateBasis: temporal.dateBasis || null,
          capturedAt: temporal.capturedAt || null,
          publishedAtRaw: rawDate,
          publishedAt: captureFallback && rawDate
            ? `capturé le ${rawDate} · date de publication non exposée`
            : rawDate
        }
      };
    })
  };
}

export function retrieveDeterministic(question, options = {}) {
  const scopeAnalysis = analyzeQuery(question);
  if (!scopeAnalysis.intent?.unsupported && !hasExplicitPoliticalScope(scopeAnalysis)) {
    return outOfScopeResult(question, scopeAnalysis);
  }

  const first = retrieveV5(question, options);
  if (first.debug?.reason !== "unknown_qualifier") {
    return exposeTemporalProvenance(enforceTargetedQualifierScope(question, first));
  }
  const retried = retryWithoutHarmlessQualifiers(question, first.debug, options) || first;
  return exposeTemporalProvenance(enforceTargetedQualifierScope(question, retried));
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
