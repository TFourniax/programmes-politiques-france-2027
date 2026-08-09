import fs from "node:fs";
import path from "node:path";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const INDEX_PATH = path.join(process.cwd(), "data", "search-index.json");
const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","je","la","le","les","leur","lui","ma","mais","me","meme","mes","moi","mon","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","ta","te","tes","toi","ton","tu","un","une","vos","votre","vous","quel","quelle","quels","quelles"]);

let cachedIndex = null;
let cachedStats = null;

function loadIndex() {
  if (!cachedIndex) cachedIndex = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  return cachedIndex;
}

function norm(value="") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return [...new Set(norm(value).split(/\s+/).filter((x) => x.length > 1 && !STOP.has(x)))];
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

function scoreChunk(chunk, queryTokens, raw, intent) {
  const title = norm(chunk.title);
  const entity = norm(chunk.entityLabel);
  const section = norm(chunk.section || "");
  const topics = norm((chunk.topics || []).join(" "));
  const text = norm(chunk.text);
  const hay = `${title} ${entity} ${section} ${topics} ${text}`;
  let score = 0;

  for (const term of queryTokens) {
    const weight = rarity(term);
    if (text.includes(term)) score += 2.2 * weight;
    if (topics.includes(term)) score += 3.2 * weight;
    if (section.includes(term)) score += 3.8 * weight;
    if (title.includes(term)) score += 5.0 * weight;
    if (entity.includes(term)) score += 6.0 * weight;
  }

  const phrase = norm(raw);
  if (phrase.length > 6 && hay.includes(phrase)) score += 12;
  if (intent.candidateStatus && chunk.kind === "candidate_status") score += 8;
  if (intent.programme && ["document", "proposal"].includes(chunk.kind)) score += 3;
  if (intent.compare && chunk.kind === "proposal") score += 4;
  if (intent.source && chunk.sourceUrl) score += 2;
  if (chunk.confidence === "high") score += 0.8;
  if (chunk.sourceTier === "tier_1_primary_official") score += 0.8;
  return score;
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

export function retrieve(question, {limit=8, minScore=1.8}={}) {
  const index = loadIndex();
  const q = tokens(question);
  const intent = queryIntent(question);
  if (!q.length) return {results: [], debug:{queryTokens:q, candidates:index.chunks.length, intent}};

  const ranked = index.chunks
    .map((chunk) => ({chunk, score:scoreChunk(chunk, q, question, intent)}))
    .filter((item) => item.score >= minScore)
    .sort((a,b) => b.score - a.score);

  const selected = diversified(ranked, limit, intent);
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
        githubUrl:`${REPO}/blob/main/${chunk.path}`
      }
    })),
    debug:{queryTokens:q, candidates:index.chunks.length, intent, matched:ranked.length}
  };
}

export function getMeta() {
  const index = loadIndex();
  return {snapshotDate:index.snapshotDate, counts:index.counts, indexVersion:index.version};
}
