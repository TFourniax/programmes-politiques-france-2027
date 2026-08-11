import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","je","la","le","les","leur","lui","ma","mais","me","meme","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous","quel","quelle","quels","quelles"]);
const GENERIC = new Set([
  "alors","aimerais","avoir","candidat","candidats","candidature","candidatures","compare","comparaison",
  "connaitre","corpus","difference","dire","dis","donne","donner","engagement","engagements","est","etre",
  "exemple","exemples","explique","faire","fais","info","infos","information","informations","mesure","mesures",
  "officiel","officiels","parle","parler","peux","peut","position","positions","programme","programmes","projet",
  "projets","propos","propose","proposent","proposition","propositions","prevoit","savoir","sera","seraient","serait",
  "seront","sont","source","sources","sujet","sujets","type","types","veut","veulent","vision","voudrais"
]);
const ACRONYM_STOP = new Set(["de","des","du","d","et","la","le","les"]);
const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));
const conceptById = new Map(ontology.concepts.map((item) => [item.id, item]));
const chunkCache = new Map();
let corpusStats = null;

export function normalize(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lightStem(raw) {
  let term = normalize(raw);
  if (term.length <= 4 || /^\d+$/.test(term)) return term;
  if (term.endsWith("aux") && term.length > 6) return `${term.slice(0, -3)}al`;
  if (term.endsWith("es") && term.length > 6) term = term.slice(0, -2);
  else if (term.endsWith("s") && term.length > 5) term = term.slice(0, -1);
  return term;
}

function tokenList(value = "") {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => (term.length > 1 || /^\d+$/.test(term)) && !STOP.has(term))
    .map(lightStem);
}

function tokenSet(value = "") {
  return new Set(tokenList(value));
}

function countTerms(value = "") {
  const counts = new Map();
  for (const term of tokenList(value)) counts.set(term, (counts.get(term) || 0) + 1);
  return counts;
}

function acronym(value = "") {
  const words = normalize(value).split(/\s+/).filter((word) => word && !ACRONYM_STOP.has(word));
  return words.length >= 2 ? words.map((word) => word[0]).join("") : "";
}

function phrasePresent(normalizedText, normalizedPhrase) {
  if (!normalizedPhrase) return false;
  return ` ${normalizedText} `.includes(` ${normalizedPhrase} `);
}

function entityAliases(entity) {
  const aliases = new Set();
  const name = normalize(entity.name || "");
  const id = normalize(entity.id || "");
  if (name) aliases.add(name);
  if (id) aliases.add(id);
  const short = acronym(entity.name || "");
  if (short.length >= 2) aliases.add(short);
  if (entity.id === "parti-socialiste") aliases.add("ps");
  if (entity.id === "rassemblement-national") aliases.add("rn");
  if (entity.id === "la-france-insoumise") aliases.add("lfi");
  if (entity.id === "les-republicains") aliases.add("lr");
  if (entity.id === "pcf") aliases.add("pcf");
  return [...aliases];
}

const entityAliasRows = [
  ...entities.candidates.map((entity) => ({ entity, type: "candidate", aliases: entityAliases(entity) })),
  ...entities.parties.map((entity) => ({ entity, type: "party", aliases: entityAliases(entity) }))
];

function detectedEntities(question) {
  const normalized = normalize(question);
  const words = new Set(normalized.split(/\s+/));
  const matches = [];
  for (const row of entityAliasRows) {
    if (row.aliases.some((alias) => alias.includes(" ") ? phrasePresent(normalized, alias) : words.has(alias))) {
      matches.push({ id: row.entity.id, name: row.entity.name, type: row.type });
    }
  }
  return matches;
}

function conceptAliases(concept) {
  return concept.aliases.map(normalize).filter(Boolean);
}

function detectedConcepts(question) {
  const normalized = normalize(question);
  const words = new Set(normalized.split(/\s+/));
  return ontology.concepts.filter((concept) => conceptAliases(concept).some((alias) => {
    if (alias.includes(" ")) return phrasePresent(normalized, alias);
    return words.has(alias);
  }));
}

function queryIntent(question) {
  const q = normalize(question);
  return {
    candidateStatus: /candidat|candidature|declare|investi|designe|primaire|renonce|retire|officiel/.test(q),
    compare: /compare|comparaison|difference|versus| vs /.test(` ${q} `),
    programme: /programme|proposition|mesure|propose|veut|prevoit|engagement|position/.test(q),
    source: /source|preuve|document|citation/.test(q)
  };
}

export function analyzeQuery(question) {
  const all = [...new Set(tokenList(question))];
  const subjectTokens = all.filter((term) => !GENERIC.has(term));
  const concepts = detectedConcepts(question);
  const requestedEntities = detectedEntities(question);
  const numbers = [...new Set(all.filter((term) => /^\d+$/.test(term) && term !== "2027"))];
  return {
    normalized: normalize(question),
    allTokens: all,
    subjectTokens,
    concepts,
    requestedEntities,
    numbers,
    intent: queryIntent(question)
  };
}

function chunkData(chunk) {
  if (chunkCache.has(chunk.id)) return chunkCache.get(chunk.id);
  const text = normalize(chunk.text || "");
  const title = normalize(chunk.title || "");
  const section = normalize(chunk.section || "");
  const topics = normalize((chunk.topics || []).join(" "));
  const entity = normalize(chunk.entityLabel || "");
  const combined = [chunk.text, chunk.title, chunk.section, ...(chunk.topics || []), chunk.entityLabel].filter(Boolean).join(" ");
  const terms = countTerms(combined);
  const data = {
    text, title, section, topics, entity,
    normalized: normalize(combined),
    terms,
    termSet: new Set(terms.keys()),
    length: Math.max(1, [...terms.values()].reduce((sum, value) => sum + value, 0))
  };
  chunkCache.set(chunk.id, data);
  return data;
}

function stats() {
  if (corpusStats) return corpusStats;
  const df = new Map();
  let totalLength = 0;
  for (const chunk of searchIndex.chunks) {
    const data = chunkData(chunk);
    totalLength += data.length;
    for (const term of data.termSet) df.set(term, (df.get(term) || 0) + 1);
  }
  corpusStats = {
    df,
    total: searchIndex.chunks.length,
    avgLength: totalLength / Math.max(1, searchIndex.chunks.length)
  };
  return corpusStats;
}

function bm25(term, data) {
  const tf = data.terms.get(lightStem(term)) || 0;
  if (!tf) return 0;
  const { df, total, avgLength } = stats();
  const n = df.get(lightStem(term)) || 0;
  const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
  const k1 = 1.2;
  const b = 0.72;
  const denom = tf + k1 * (1 - b + b * data.length / Math.max(1, avgLength));
  return idf * ((tf * (k1 + 1)) / denom);
}

function conceptTerms(concept) {
  return [...new Set((concept.retrieval_terms || []).flatMap((term) => tokenList(term)))];
}

function conceptEvidence(concept, data) {
  const values = conceptTerms(concept)
    .map((term) => ({ term, score: bm25(term, data) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    matched: values.length > 0,
    terms: values.slice(0, 6).map((item) => item.term),
    score: values.slice(0, 4).reduce((sum, item) => sum + item.score, 0)
  };
}

function relationMeta(entityId) {
  const candidate = candidateById.get(entityId);
  if (candidate) {
    const party = candidate.primary_party_id ? partyById.get(candidate.primary_party_id) : null;
    return { partyId: candidate.primary_party_id || null, partyName: party?.name || null };
  }
  const party = partyById.get(entityId);
  if (party) return { partyId: party.id, partyName: party.name };
  return { partyId: null, partyName: null };
}

function scoreChunk(chunk, analysis) {
  const data = chunkData(chunk);
  let score = 0;
  const directMatches = new Set();
  const matchedConcepts = [];

  for (const term of analysis.subjectTokens) {
    const termScore = bm25(term, data);
    if (!termScore) continue;
    directMatches.add(term);
    score += 2.7 * termScore;
    const stem = lightStem(term);
    if (tokenSet(chunk.title).has(stem)) score += 2.8;
    if (tokenSet(chunk.section || "").has(stem)) score += 2.2;
    if (tokenSet((chunk.topics || []).join(" ")).has(stem)) score += 2.3;
    if (tokenSet(chunk.entityLabel || "").has(stem)) score += 4.5;
  }

  for (const concept of analysis.concepts) {
    const evidence = conceptEvidence(concept, data);
    if (!evidence.matched) continue;
    matchedConcepts.push({ id: concept.id, label: concept.label, terms: evidence.terms });
    score += 5.5 + Math.min(7, evidence.score * 0.8);
  }

  const entityMatch = analysis.requestedEntities.some((entity) => entity.id === chunk.entityId);
  if (entityMatch) score += 18;

  const matchedNumbers = analysis.numbers.filter((number) => data.termSet.has(number));
  score += matchedNumbers.length * 7;

  if (analysis.intent.candidateStatus && chunk.kind === "candidate_status") score += 6;
  if (analysis.intent.programme && ["proposal", "document"].includes(chunk.kind)) score += 2.5;
  if (analysis.intent.compare && chunk.kind === "proposal") score += 3;
  if (analysis.intent.source && chunk.sourceUrl) score += 1.5;
  if (chunk.documentStatus === "current") score += 0.7;
  if (chunk.confidence === "high") score += 0.4;
  if (chunk.sourceTier === "tier_1_primary_official") score += 0.4;

  return { score, directMatches, matchedConcepts, entityMatch, matchedNumbers };
}

function minimumDirectMatches(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return Math.max(2, Math.ceil(count * 0.45));
}

function relevantEnough(chunk, scored, analysis, minScore) {
  if (scored.score < minScore) return false;
  if (analysis.requestedEntities.length && !scored.entityMatch) return false;
  if (analysis.numbers.length && scored.matchedNumbers.length < analysis.numbers.length) return false;

  if (analysis.concepts.length) {
    if (!scored.matchedConcepts.length) return false;
    return true;
  }

  if (analysis.subjectTokens.length) {
    return scored.directMatches.size >= minimumDirectMatches(analysis.subjectTokens.length);
  }

  return analysis.intent.candidateStatus && chunk.kind === "candidate_status";
}

function diversified(ranked, limit, intent) {
  const out = [];
  const pathCounts = new Map();
  const entityCounts = new Map();
  for (const item of ranked) {
    const pathCount = pathCounts.get(item.chunk.path) || 0;
    const entityCount = entityCounts.get(item.chunk.entityId) || 0;
    const pathCap = item.chunk.kind === "candidate_status" ? 1 : 2;
    const entityCap = intent.compare ? 4 : 5;
    if (pathCount >= pathCap || entityCount >= entityCap) continue;
    out.push(item);
    pathCounts.set(item.chunk.path, pathCount + 1);
    entityCounts.set(item.chunk.entityId, entityCount + 1);
    if (out.length >= limit) break;
  }
  return out;
}

export function retrieveDeterministic(question, { limit = 10, minScore = 2.2 } = {}) {
  const analysis = analyzeQuery(question);
  if (!analysis.allTokens.length) {
    return { results: [], debug: { answerable: false, reason: "empty_query", analysis } };
  }

  const ranked = searchIndex.chunks
    .map((chunk) => ({ chunk, ...scoreChunk(chunk, analysis) }))
    .filter((item) => relevantEnough(item.chunk, item, analysis, minScore))
    .sort((a, b) => b.score - a.score);
  const selected = diversified(ranked, limit, analysis.intent);

  return {
    results: selected.map(({ chunk, score, matchedConcepts, directMatches }) => ({
      score: Number(score.toFixed(3)),
      text: chunk.text,
      match: {
        concepts: matchedConcepts,
        directTerms: [...directMatches]
      },
      citation: {
        title: chunk.title,
        entityId: chunk.entityId,
        entityLabel: chunk.entityLabel,
        kind: chunk.kind,
        path: chunk.path,
        sourceUrl: chunk.sourceUrl,
        sourceTier: chunk.sourceTier || null,
        documentStatus: chunk.documentStatus,
        candidateStatus: chunk.candidateStatus,
        publishedAt: chunk.publishedAt,
        confidence: chunk.confidence || null,
        certainty: chunk.certainty || null,
        section: chunk.section || null,
        githubUrl: `${REPO}/blob/main/${chunk.path}`,
        ...relationMeta(chunk.entityId)
      }
    })),
    debug: {
      answerable: selected.length > 0,
      reason: selected.length ? "hybrid_evidence" : "insufficient_relevance",
      concepts: analysis.concepts.map(({ id, label }) => ({ id, label })),
      requestedEntities: analysis.requestedEntities,
      subjectTokens: analysis.subjectTokens,
      numbers: analysis.numbers,
      intent: analysis.intent,
      candidates: searchIndex.chunks.length,
      matched: ranked.length
    }
  };
}

export function getDeterministicMeta() {
  return {
    engine: "deterministic-bm25-ontology-v1",
    ontologyVersion: ontology.version,
    snapshotDate: searchIndex.snapshotDate,
    counts: searchIndex.counts,
    indexVersion: searchIndex.version
  };
}
