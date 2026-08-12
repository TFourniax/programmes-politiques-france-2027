import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };
import ontologyAnchors from "../data/political-ontology-anchors.json" with { type: "json" };

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","je","la","le","les","leur","lui","ma","mais","me","meme","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous","quel","quelle","quels","quelles"]);
const GENERIC = new Set([
  "actuel","actuelle","actuels","actuelles","alors","autre","autres","avoir","candidat","candidats","candidature","candidatures",
  "compare","comparaison","concerne","concernent","connaitre","corpus","developpe","developper","developpement","difference","dire","dis",
  "documente","documentee","documentes","documentees","donne","donner","engagement","engagements","est","etre","exemple","exemples","explique",
  "faire","fais","fortement","info","infos","information","informations","mesure","mesures","nouveau","nouveaux","nouvelle","nouvelles",
  "officiel","officiels","parle","parler","peux","peut","position","positions","programme","programmes","projet","projets","propos","propose",
  "proposent","proposition","propositions","prevoit","public","publique","publics","publiques","savoir","source","sources","sujet","sujets",
  "systeme","systemes","type","types","veut","veulent","vision","voudrais"
]);
const QUERY_MODIFIERS = new Set([
  "abroger","acces","actuellement","ajouter","annee","annees","ans","attribuer","augmenter","baisser","brut","chacun","chacune","chaque",
  "completer","construire","couper","creer","davantage","deux","diminuer","euro","euros","financer","financee","financier","financiere","financiers","financieres",
  "finir","fondee","fonder","introduire","lancer","limiter","long","longue","mettre","million","millions","milliard","milliards","mille","minimum","maximum",
  "monter","moins","neuf","partir","pendant","permettre","personne","plus","plusieurs","porter","premier","premiere","procedure","programmer","programmation",
  "quatre","reformer","remplacer","restreindre","selection","sept","six","supprimer","temps","tot","tard","trois","travailleur","travailleurs","viser","zero"
]);
const MANUAL_ALIASES = new Map([
  ["parti-socialiste", ["ps"]],
  ["rassemblement-national", ["rn"]],
  ["la-france-insoumise", ["lfi"]],
  ["les-republicains", ["lr"]],
  ["pcf", ["pcf"]]
]);
const INACTIVE_POLICY_STATUSES = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);

const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));
const chunkCache = new Map();
let cachedStats = null;

function isPublicChunk(chunk) {
  if (!["document", "proposal"].includes(chunk.kind)) return true;
  return !INACTIVE_POLICY_STATUSES.has(String(chunk.documentStatus || "unknown").toLowerCase());
}
const PUBLIC_CHUNKS = searchIndex.chunks.filter(isPublicChunk);

function compactThousands(value = "") {
  let text = String(value).replace(/[\u00a0\u202f]/g, " ");
  let previous;
  do {
    previous = text;
    text = text.replace(/(\d{1,3})\s+(?=\d{3}\b)/g, "$1");
  } while (text !== previous);
  return text;
}

export function normalize(value = "") {
  const plain = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return compactThousands(plain);
}

function stem(value = "") {
  const term = normalize(value);
  if (term.length <= 4 || /^\d+$/.test(term)) return term;
  if (term.endsWith("aux") && term.length > 6) return `${term.slice(0, -3)}al`;
  if (term.endsWith("es") && term.length > 6) return term.slice(0, -2);
  if (term.endsWith("s") && term.length > 5) return term.slice(0, -1);
  return term;
}

function tokens(value = "") {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean)
    .filter((term) => (term.length > 1 || /^\d+$/.test(term)) && !STOP.has(term))
    .map(stem);
}

function tokenSet(value = "") { return new Set(tokens(value)); }
function termCounts(value = "") {
  const out = new Map();
  for (const term of tokens(value)) out.set(term, (out.get(term) || 0) + 1);
  return out;
}
function phrase(text, value) { return ` ${normalize(text)} `.includes(` ${normalize(value)} `); }

function oneEditOrTranspose(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const mismatches = [];
    for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) mismatches.push(i);
    if (mismatches.length === 1) return true;
    if (mismatches.length === 2) {
      const [i, j] = mismatches;
      return j === i + 1 && a[i] === b[j] && a[j] === b[i];
    }
    return false;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) { i += 1; j += 1; continue; }
    skipped += 1; j += 1;
    if (skipped > 1) return false;
  }
  return true;
}

const lastnameCounts = new Map();
for (const candidate of entities.candidates) {
  const last = normalize(candidate.name).split(/\s+/).at(-1);
  if (last?.length >= 4) lastnameCounts.set(last, (lastnameCounts.get(last) || 0) + 1);
}

const entityRows = [
  ...entities.candidates.map((entity) => ({ entity, type: "candidate" })),
  ...entities.parties.map((entity) => ({ entity, type: "party" }))
].map((row) => {
  const aliases = new Set([normalize(row.entity.name), normalize(row.entity.id)]);
  if (row.type === "candidate") {
    const last = normalize(row.entity.name).split(/\s+/).at(-1);
    if (last?.length >= 4 && lastnameCounts.get(last) === 1) aliases.add(last);
  }
  for (const alias of MANUAL_ALIASES.get(row.entity.id) || []) aliases.add(alias);
  return { ...row, aliases: [...aliases].filter((alias) => alias.length >= 2) };
});

function aliasMatches(normalized, words, alias) {
  if (alias.includes(" ")) return phrase(normalized, alias);
  if (words.has(alias)) return true;
  if (alias.length < 5) return false;
  return [...words].some((word) => oneEditOrTranspose(word, alias));
}

function detectEntities(question) {
  const normalized = normalize(question);
  const words = new Set(normalized.split(/\s+/).filter(Boolean));
  return entityRows
    .filter((row) => row.aliases.some((alias) => aliasMatches(normalized, words, alias)))
    .map((row) => ({ id: row.entity.id, name: row.entity.name, type: row.type }));
}

function detectedEntityTerms(requestedEntities) {
  const ids = new Set(requestedEntities.map((entity) => entity.id));
  const out = new Set();
  for (const row of entityRows) {
    if (!ids.has(row.entity.id)) continue;
    for (const alias of row.aliases) for (const term of tokens(alias)) out.add(term);
  }
  return out;
}

function bestConceptMatch(concept, normalized, words) {
  const exact = concept.aliases
    .map((raw) => normalize(raw))
    .filter(Boolean)
    .filter((alias) => alias.includes(" ") ? phrase(normalized, alias) : words.has(alias));
  if (exact.length) {
    exact.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length);
    return { alias: exact[0], fuzzy: false };
  }
  const fuzzy = concept.aliases
    .map((raw) => normalize(raw))
    .filter((alias) => alias && !alias.includes(" ") && alias.length >= 5)
    .find((alias) => [...words].some((word) => oneEditOrTranspose(word, alias)));
  return fuzzy ? { alias: fuzzy, fuzzy: true } : null;
}

function detectConcepts(question) {
  const normalized = normalize(question);
  const words = new Set(normalized.split(/\s+/).filter(Boolean));
  const detected = [];
  for (const concept of ontology.concepts) {
    const match = bestConceptMatch(concept, normalized, words);
    if (match) detected.push({ ...concept, matchedAlias: match.alias, fuzzy: match.fuzzy });
  }

  const multiAliasWords = new Set(
    detected
      .map((concept) => normalize(concept.matchedAlias || "").split(/\s+/).filter(Boolean))
      .filter((parts) => parts.length >= 2)
      .flat()
  );
  return detected.filter((concept) => {
    const parts = normalize(concept.matchedAlias || "").split(/\s+/).filter(Boolean);
    return parts.length >= 2 || !multiAliasWords.has(parts[0]);
  });
}

function conceptCoveredTerms(concepts) {
  const covered = new Set();
  for (const concept of concepts) {
    const source = [concept.matchedAlias, concept.label, ...(concept.aliases || []), ...(concept.retrieval_terms || [])].filter(Boolean).join(" ");
    for (const term of tokens(source)) covered.add(term);
  }
  return covered;
}

function unsupportedIntent(q) {
  const absence = /\bne\s+(propose|proposent|parle|parlent|prevoit|prevoient|defend|defendent|soutient|soutiennent|veut|veulent)\s+pas\b/.test(q)
    || /\bqui\s+ne\s+(propose|parle|prevoit|defend|soutient|veut)\s+pas\b/.test(q);
  const ranking = /\b(meilleur|meilleure|meilleurs|meilleures|pire|pires)\b/.test(q)
    || /\bplus\s+(favorable|radical|radicale|radicaux|radicales|strict|stricte|stricts|strictes|dur|dure|durs|dures)\b/.test(q)
    || /\bplus\s+a\s+(droite|gauche)\b/.test(q);
  if (absence) return "absence_inference";
  if (ranking) return "subjective_ranking";
  return null;
}

function intent(question) {
  const q = normalize(question);
  const candidateStatus = /(?:candidat|candidature).{0,45}(?:declare|officiel|potentiel|probable|possible|primaire|investi|designe|retire|renonce|condition|statut|en course)|(?:declare|officiel|potentiel|probable|possible|primaire|investi|designe|retire|renonce|condition|statut|en course).{0,45}(?:candidat|candidature)/.test(q);
  const unsupportedReason = unsupportedIntent(q);
  return {
    candidateStatus,
    compare: /compare|comparaison|difference|versus| vs /.test(` ${q} `),
    programme: /programme|proposition|mesure|propose|veut|prevoit|engagement|position/.test(q),
    source: /source|preuve|document|citation/.test(q),
    unsupported: Boolean(unsupportedReason),
    unsupportedReason
  };
}

function chunkData(chunk) {
  if (chunkCache.has(chunk.id)) return chunkCache.get(chunk.id);
  const combined = [chunk.title, chunk.entityLabel, chunk.section, ...(chunk.topics || []), chunk.text].filter(Boolean).join(" ");
  const counts = termCounts(combined);
  const data = {
    counts,
    set: new Set(counts.keys()),
    length: Math.max(1, [...counts.values()].reduce((a, b) => a + b, 0)),
    title: tokenSet(chunk.title),
    section: tokenSet(chunk.section),
    topics: tokenSet((chunk.topics || []).join(" ")),
    entity: tokenSet(chunk.entityLabel)
  };
  chunkCache.set(chunk.id, data);
  return data;
}

function stats() {
  if (cachedStats) return cachedStats;
  const df = new Map();
  let totalLength = 0;
  for (const chunk of PUBLIC_CHUNKS) {
    const data = chunkData(chunk);
    totalLength += data.length;
    for (const term of data.set) df.set(term, (df.get(term) || 0) + 1);
  }
  cachedStats = { df, total: PUBLIC_CHUNKS.length, avgLength: totalLength / Math.max(1, PUBLIC_CHUNKS.length) };
  return cachedStats;
}

function unknownQualifierTokens(subjectTokens, concepts, numbers) {
  if (!concepts.length) return [];
  const covered = conceptCoveredTerms(concepts);
  const numberSet = new Set(numbers);
  const { df } = stats();
  return [...new Set(subjectTokens)]
    .filter((term) => !numberSet.has(term))
    .filter((term) => !covered.has(term))
    .filter((term) => term.length >= 4)
    .filter((term) => !QUERY_MODIFIERS.has(term))
    .filter((term) => !df.has(stem(term)));
}

export function analyzeQuery(question) {
  const allTokens = [...new Set(tokens(question))];
  const requestedEntities = detectEntities(question);
  const entityTerms = detectedEntityTerms(requestedEntities);
  const subjectTokens = allTokens.filter((term) => !GENERIC.has(term) && !entityTerms.has(term));
  const concepts = detectConcepts(question);
  const numbers = [...new Set(allTokens.filter((term) => /^\d+$/.test(term) && term !== "2027"))];
  return {
    allTokens,
    subjectTokens,
    unknownQualifierTokens: unknownQualifierTokens(subjectTokens, concepts, numbers),
    concepts,
    requestedEntities,
    numbers,
    intent: intent(question)
  };
}

function topicTerms(analysis) {
  const concepts = analysis.concepts.map((concept) => concept.matchedAlias || concept.label);
  const subjects = analysis.subjectTokens.filter((term) => !concepts.some((value) => tokens(value).includes(term)));
  return [...new Set([...concepts, ...subjects])].filter(Boolean);
}

function lastUserMessage(history = []) {
  return [...history].reverse().find((item) => item?.role === "user" && String(item.content || "").trim())?.content || "";
}

export function resolveDeterministicContext(question, history = []) {
  const previousText = lastUserMessage(history);
  const normalized = normalize(question);
  const shortFollowUp = normalized.split(/\s+/).filter(Boolean).length <= 8 || /^(et|eux|elles|lui|elle|sinon|quid|meme question)/.test(normalized);
  if (!previousText || !shortFollowUp) return { query: question, inheritedMode: null, inheritedEntities: [], inheritedTopic: [] };

  const current = analyzeQuery(question);
  const previous = analyzeQuery(previousText);
  const currentTopic = topicTerms(current);
  const previousTopic = topicTerms(previous);
  const pieces = [question];
  const inheritedEntities = current.requestedEntities.length ? [] : previous.requestedEntities;
  const inheritedTopic = currentTopic.length ? [] : previousTopic;
  if (inheritedEntities.length) pieces.push(`Acteurs précédents: ${inheritedEntities.map((item) => item.name).join(", ")}`);
  if (inheritedTopic.length) pieces.push(`Sujet précédent: ${inheritedTopic.join(" ")}`);

  let inheritedMode = null;
  if (!current.intent.compare && previous.intent.compare && (inheritedEntities.length || previous.requestedEntities.length >= 2)) inheritedMode = "comparison";
  else if (!current.intent.candidateStatus && previousTopic.length) inheritedMode = "measures";

  return { query: pieces.join(". "), inheritedMode, inheritedEntities, inheritedTopic };
}

export function resolveDeterministicQuery(question, history = []) {
  return resolveDeterministicContext(question, history).query;
}

function bm25(raw, data) {
  const term = stem(raw);
  const tf = data.counts.get(term) || 0;
  if (!tf) return 0;
  const { df, total, avgLength } = stats();
  const n = df.get(term) || 0;
  const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
  const k1 = 1.2, b = 0.72;
  return idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * data.length / Math.max(1, avgLength))));
}

function conceptMatch(concept, data) {
  const anchors = [...new Set((ontologyAnchors.anchors?.[concept.id] || []).flatMap(tokens))];
  if (anchors.length && !anchors.some((term) => data.set.has(term))) return { matched: false, terms: [], score: 0 };
  const scored = [...new Set(concept.retrieval_terms.flatMap(tokens))]
    .map((term) => ({ term, score: bm25(term, data) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return { matched: scored.length > 0, terms: scored.slice(0, 6).map((row) => row.term), score: scored.slice(0, 4).reduce((sum, row) => sum + row.score, 0) };
}

function relationMeta(entityId) {
  const candidate = candidateById.get(entityId);
  if (candidate) {
    const party = candidate.primary_party_id ? partyById.get(candidate.primary_party_id) : null;
    return { partyId: candidate.primary_party_id || null, partyName: party?.name || null };
  }
  const party = partyById.get(entityId);
  return party ? { partyId: party.id, partyName: party.name } : { partyId: null, partyName: null };
}

function score(chunk, analysis) {
  const data = chunkData(chunk);
  let value = 0;
  const direct = new Set();
  const concepts = [];
  for (const term of analysis.subjectTokens) {
    const s = bm25(term, data);
    if (!s) continue;
    direct.add(term);
    value += 2.7 * s;
    const t = stem(term);
    if (data.title.has(t)) value += 2.8;
    if (data.section.has(t)) value += 2.2;
    if (data.topics.has(t)) value += 2.3;
    if (data.entity.has(t)) value += 4.5;
  }
  for (const concept of analysis.concepts) {
    const hit = conceptMatch(concept, data);
    if (!hit.matched) continue;
    concepts.push({ id: concept.id, label: concept.label, terms: hit.terms, matchedAlias: concept.matchedAlias });
    value += 5.5 + Math.min(7, hit.score * 0.8);
  }
  const entityMatch = analysis.requestedEntities.some((entity) => entity.id === chunk.entityId);
  if (entityMatch) value += 18;
  const numbers = analysis.numbers.filter((number) => data.set.has(number));
  value += numbers.length * 7;
  if (analysis.intent.candidateStatus && chunk.kind === "candidate_status") value += 6;
  if (analysis.intent.programme && ["proposal", "document"].includes(chunk.kind)) value += 2.5;
  if (analysis.intent.compare && chunk.kind === "proposal") value += 3;
  if (analysis.intent.source && chunk.sourceUrl) value += 1.5;
  if (chunk.kind === "proposal") value += 1.1;
  if (chunk.documentStatus === "current") value += 0.7;
  if (chunk.confidence === "high") value += 0.4;
  if (chunk.sourceTier === "tier_1_primary_official") value += 0.4;
  return { value, direct, concepts, entityMatch, numbers };
}

function directMinimum(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return Math.max(2, Math.ceil(count * 0.45));
}
function hasControlledSemanticBridge(analysis) {
  if (analysis.requestedEntities.length) return true;
  return analysis.concepts.some((concept) => normalize(concept.matchedAlias || "").split(/\s+/).filter(Boolean).length >= 2 || concept.fuzzy);
}
function numbersCompatible(row, analysis) {
  if (!analysis.numbers.length) return true;
  if (analysis.numbers.length === 1) return row.numbers.length === 1;
  return row.numbers.length >= 1;
}
function relevant(chunk, row, analysis, minScore) {
  if (analysis.unknownQualifierTokens.length) return false;
  if (row.value < minScore) return false;
  if (analysis.requestedEntities.length && !row.entityMatch) return false;
  if (!numbersCompatible(row, analysis)) return false;
  if (analysis.concepts.length) {
    if (!row.concepts.length) return false;
    if (analysis.subjectTokens.length && !row.direct.size && !hasControlledSemanticBridge(analysis)) return false;
    return true;
  }
  if (analysis.subjectTokens.length) return row.direct.size >= directMinimum(analysis.subjectTokens.length);
  return analysis.intent.candidateStatus && chunk.kind === "candidate_status";
}
function diversify(rows, limit, compare) {
  const out = [], paths = new Map(), entitiesCount = new Map();
  for (const row of rows) {
    const pc = paths.get(row.chunk.path) || 0;
    const ec = entitiesCount.get(row.chunk.entityId) || 0;
    if (pc >= 2 || ec >= (compare ? 4 : 5)) continue;
    out.push(row);
    paths.set(row.chunk.path, pc + 1);
    entitiesCount.set(row.chunk.entityId, ec + 1);
    if (out.length >= limit) break;
  }
  return out;
}

export function retrieveDeterministic(question, { limit = 10, minScore = 2.2 } = {}) {
  const analysis = analyzeQuery(question);
  if (!analysis.allTokens.length) return { results: [], debug: { answerable: false, reason: "empty_query", analysis } };
  if (analysis.intent.unsupported) {
    return { results: [], debug: { answerable: false, reason: `unsupported_${analysis.intent.unsupportedReason}`, concepts: analysis.concepts, requestedEntities: analysis.requestedEntities, subjectTokens: analysis.subjectTokens, unknownQualifierTokens: analysis.unknownQualifierTokens, numbers: analysis.numbers, intent: analysis.intent, candidates: PUBLIC_CHUNKS.length, matched: 0, coherent: 0 } };
  }
  if (analysis.unknownQualifierTokens.length) {
    return { results: [], debug: { answerable: false, reason: "unknown_qualifier", concepts: analysis.concepts, requestedEntities: analysis.requestedEntities, subjectTokens: analysis.subjectTokens, unknownQualifierTokens: analysis.unknownQualifierTokens, numbers: analysis.numbers, intent: analysis.intent, candidates: PUBLIC_CHUNKS.length, matched: 0, coherent: 0 } };
  }

  const ranked = PUBLIC_CHUNKS
    .map((chunk) => ({ chunk, ...score(chunk, analysis) }))
    .filter((row) => relevant(row.chunk, row, analysis, minScore))
    .sort((a, b) => b.value - a.value);
  const best = ranked[0]?.value || 0;
  const relativeFloor = analysis.intent.compare ? 0.25 : 0.40;
  const coherent = ranked.filter((row) => row.value >= best * relativeFloor);
  const selected = diversify(coherent, limit, analysis.intent.compare);

  return {
    results: selected.map(({ chunk, value, concepts, direct }) => ({
      score: Number(value.toFixed(3)),
      text: chunk.text,
      match: { concepts, directTerms: [...direct] },
      citation: {
        title: chunk.title,
        recordId: chunk.recordId || null,
        entityId: chunk.entityId,
        entityLabel: chunk.entityLabel,
        kind: chunk.kind,
        path: chunk.path,
        sourceUrl: chunk.sourceUrl,
        sourceTier: chunk.sourceTier || null,
        documentStatus: chunk.documentStatus,
        proposalStatus: chunk.proposalStatus || null,
        supersedes: chunk.supersedes || [],
        supersededBy: chunk.supersededBy || [],
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
      concepts: analysis.concepts.map(({ id, label, matchedAlias, fuzzy }) => ({ id, label, matchedAlias, fuzzy: Boolean(fuzzy) })),
      requestedEntities: analysis.requestedEntities,
      subjectTokens: analysis.subjectTokens,
      unknownQualifierTokens: analysis.unknownQualifierTokens,
      numbers: analysis.numbers,
      intent: analysis.intent,
      candidates: PUBLIC_CHUNKS.length,
      matched: ranked.length,
      coherent: coherent.length
    }
  };
}
