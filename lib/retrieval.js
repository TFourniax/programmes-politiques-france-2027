import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","je","la","le","les","leur","lui","ma","mais","me","meme","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous","quel","quelle","quels","quelles"]);
const QUERY_FILLER = new Set([
  "alors","aimerais","aimerait","avoir","concernant","connaitre","connais","corpus",
  "dire","dis","disponible","disponibles","donne","donner","est","etaient","etait","ete","etre",
  "exemple","exemples","explique","faire","fais","info","infos","information","informations",
  "interesse","interessent","parle","parler","peux","peut","position","positions","propos","savoir",
  "sera","seraient","serait","seront","sont","sujet","sujets","type","types","vision","voudrais",
  "voudrait"
]);
const INTENT_ONLY_TERMS = new Set([
  "candidat","candidats","candidature","candidatures","compare","comparaison","difference",
  "engagement","engagements","mesure","mesures","programme","programmes","projet","projets","propose",
  "proposent","proposition","propositions","prevoit","source","sources","veut","veulent"
]);
const ACRONYM_STOP = new Set(["de","des","du","d","et"]);
const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));
const entityAliasesById = new Map();

let cachedStats = null;

function loadIndex() {
  return searchIndex;
}

function norm(value="") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rawTokens(value) {
  return norm(value).split(/\s+/).filter(Boolean);
}

function tokens(value) {
  return [...new Set(rawTokens(value).filter((x) => (x.length > 1 || /^\d+$/.test(x)) && !STOP.has(x)))];
}

function signalTokens(value) {
  return tokens(value).filter((term) => !QUERY_FILLER.has(term) && !INTENT_ONLY_TERMS.has(term));
}

function acronym(value) {
  const words = rawTokens(value).filter((word) => word && !ACRONYM_STOP.has(word));
  if (words.length < 2) return "";
  return words.map((word) => word[0]).join("");
}

function addEntityAliases(entity) {
  if (!entity?.id) return;
  const aliases = new Set();
  const idTokens = rawTokens(entity.id);
  const nameTokens = rawTokens(entity.name || "");
  for (const token of idTokens) if (token.length > 1) aliases.add(token);
  const short = acronym(entity.name || "");
  if (short.length >= 2) aliases.add(short);
  if (nameTokens.length === 1 && nameTokens[0].length > 1) aliases.add(nameTokens[0]);
  entityAliasesById.set(entity.id, aliases);
}

for (const item of entities.candidates) addEntityAliases(item);
for (const item of entities.parties) addEntityAliases(item);

function tokenVariants(term) {
  const variants = new Set([term]);
  if (/^[a-z]{5,}$/.test(term)) {
    if (term.endsWith("s")) variants.add(term.slice(0, -1));
    else variants.add(`${term}s`);
    if (term.endsWith("x")) variants.add(term.slice(0, -1));
  }
  return variants;
}

function tokenSet(value) {
  return new Set(rawTokens(value));
}

function hasToken(set, term) {
  for (const candidate of tokenVariants(term)) {
    if (set.has(candidate)) return true;
  }
  return false;
}

function stats() {
  if (cachedStats) return cachedStats;
  const chunks = loadIndex().chunks;
  const documentFrequency = new Map();
  for (const chunk of chunks) {
    const terms = new Set(tokens([chunk.title, chunk.entityLabel, chunk.text, ...(chunk.topics || [])].join(" ")));
    for (const term of terms) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  cachedStats = { documentFrequency, total: chunks.length };
  return cachedStats;
}

function rarity(term) {
  const { documentFrequency, total } = stats();
  const df = documentFrequency.get(term) || 0;
  return Math.log((total + 1) / (df + 1)) + 1;
}

function queryIntent(raw) {
  const q = norm(raw);
  return {
    candidateStatus: /candidat|candidature|declare|investi|designe|primaire|renonce|retire/.test(q),
    compare: /compare|comparaison|difference|qui propose|lesquels|quels candidats/.test(q),
    programme: /programme|proposition|mesure|propose|veut|prevoit|engagement/.test(q),
    source: /source|preuve|document|citation/.test(q)
  };
}

function chunkLexicon(chunk) {
  return {
    title: tokenSet(chunk.title),
    entity: tokenSet(chunk.entityLabel),
    section: tokenSet(chunk.section || ""),
    topics: tokenSet((chunk.topics || []).join(" ")),
    text: tokenSet(chunk.text),
    hay: norm([chunk.title, chunk.entityLabel, chunk.section || "", ...(chunk.topics || []), chunk.text].join(" "))
  };
}

function entityAliasMatch(chunk, term) {
  return entityAliasesById.get(chunk.entityId)?.has(term) === true;
}

function scoreChunk(chunk, queryTokens, raw, intent, signals) {
  const fields = chunkLexicon(chunk);
  let score = 0;
  const matchedQueryTerms = new Set();
  const matchedSignalTerms = new Set();

  for (const term of queryTokens) {
    const weight = rarity(term);
    let matched = false;
    if (hasToken(fields.text, term)) { score += 2.2 * weight; matched = true; }
    if (hasToken(fields.topics, term)) { score += 3.2 * weight; matched = true; }
    if (hasToken(fields.section, term)) { score += 3.8 * weight; matched = true; }
    if (hasToken(fields.title, term)) { score += 5.0 * weight; matched = true; }
    if (hasToken(fields.entity, term) || entityAliasMatch(chunk, term)) { score += 6.0 * weight; matched = true; }
    if (matched) matchedQueryTerms.add(term);
  }

  for (const term of signals) {
    if (matchedQueryTerms.has(term) || entityAliasMatch(chunk, term)) matchedSignalTerms.add(term);
  }

  const phrase = norm(raw);
  if (phrase.length > 6 && fields.hay.includes(phrase)) score += 12;

  const intentOnly = signals.length === 0 && Object.values(intent).some(Boolean);
  if (!matchedQueryTerms.size && !intentOnly) {
    return { score: 0, matchedQueryTerms, matchedSignalTerms, phraseMatched: false, intentOnly };
  }

  if (intent.candidateStatus && chunk.kind === "candidate_status") score += 8;
  if (intent.programme && ["document", "proposal"].includes(chunk.kind)) score += 3;
  if (intent.compare && chunk.kind === "proposal") score += 4;
  if (intent.source && chunk.sourceUrl) score += 2;
  if (chunk.confidence === "high") score += 0.8;
  if (chunk.sourceTier === "tier_1_primary_official") score += 0.8;

  const signalPhrase = signals.join(" ");
  const phraseMatched = Boolean(signalPhrase && fields.hay.includes(signalPhrase));
  if (phraseMatched) score += 4;
  return { score, matchedQueryTerms, matchedSignalTerms, phraseMatched, intentOnly };
}

function requiredSignalMatches(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return Math.max(2, Math.ceil(count * 0.5));
}

function relevantEnough(meta, signals) {
  if (!signals.length) return meta.intentOnly;
  const matched = meta.matchedSignalTerms.size;
  if (matched < requiredSignalMatches(signals.length)) return false;
  if (signals.length >= 3 && matched / signals.length < 0.5) return false;

  // A short numeric subject such as "formule 1" must occur as an actual phrase,
  // not as two unrelated tokens somewhere in the same political document.
  if (signals.length === 2 && signals.some((term) => /^\d{1,2}$/.test(term))) {
    return meta.phraseMatched;
  }
  return true;
}

function diversified(ranked, limit, intent) {
  const output = [];
  const perPath = new Map();
  const perEntity = new Map();
  for (const item of ranked) {
    const pathCount = perPath.get(item.chunk.path) || 0;
    const entityCount = perEntity.get(item.chunk.entityId) || 0;
    const pathCap = item.chunk.kind === "candidate_status" ? 1 : 3;
    const entityCap = intent.compare ? 3 : 5;
    if (pathCount >= pathCap || entityCount >= entityCap) continue;
    output.push(item);
    perPath.set(item.chunk.path, pathCount + 1);
    perEntity.set(item.chunk.entityId, entityCount + 1);
    if (output.length >= limit) break;
  }
  return output;
}

function relationMeta(entityId) {
  const candidate = candidateById.get(entityId);
  if (candidate) {
    const party = candidate.primary_party_id ? partyById.get(candidate.primary_party_id) : null;
    return {
      partyId: candidate.primary_party_id || null,
      partyName: party?.name || null
    };
  }

  const party = partyById.get(entityId);
  if (party) return { partyId: party.id, partyName: party.name };
  return { partyId: null, partyName: null };
}

export function retrieve(question, {limit=8, minScore=1.8}={}) {
  const index = loadIndex();
  const q = tokens(question);
  const signals = signalTokens(question);
  const intent = queryIntent(question);
  if (!q.length) {
    return {
      results: [],
      debug:{queryTokens:q, signalTokens:signals, candidates:index.chunks.length, intent, answerable:false, reason:"empty_query"}
    };
  }

  const scored = index.chunks
    .map((chunk) => {
      const meta = scoreChunk(chunk, q, question, intent, signals);
      return {chunk, ...meta};
    })
    .filter((item) => item.score >= minScore)
    .sort((a,b) => b.score - a.score);

  const relevant = scored.filter((item) => relevantEnough(item, signals));
  const selected = diversified(relevant, limit, intent);
  const answerable = selected.length > 0;
  return {
    results: selected.map(({chunk,score}) => ({
      score:Number(score.toFixed(3)),
      text:chunk.text,
      citation:{
        title:chunk.title,
        entityId:chunk.entityId,
        entityLabel:chunk.entityLabel,
        kind:chunk.kind,
        path:chunk.path,
        sourceUrl:chunk.sourceUrl,
        sourceTier:chunk.sourceTier || null,
        documentStatus:chunk.documentStatus,
        candidateStatus:chunk.candidateStatus,
        publishedAt:chunk.publishedAt,
        confidence:chunk.confidence || null,
        certainty:chunk.certainty || null,
        section:chunk.section || null,
        githubUrl:`${REPO}/blob/main/${chunk.path}`,
        ...relationMeta(chunk.entityId)
      }
    })),
    debug:{
      queryTokens:q,
      signalTokens:signals,
      candidates:index.chunks.length,
      intent,
      matched:scored.length,
      relevant:relevant.length,
      answerable,
      reason:answerable ? "relevant_evidence" : "insufficient_relevance"
    }
  };
}

export function getMeta() {
  const index = loadIndex();
  return {snapshotDate:index.snapshotDate, counts:index.counts, indexVersion:index.version};
}
