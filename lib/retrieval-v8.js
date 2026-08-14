import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV7
} from "./retrieval-v7.js";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const CANDIDATE_BY_ID = new Map((entities.candidates || []).map((item) => [item.id, item]));
const PARTY_BY_ID = new Map((entities.parties || []).map((item) => [item.id, item]));
const CANDIDATE_IDS = new Set(CANDIDATE_BY_ID.keys());
const PARTY_IDS = new Set(PARTY_BY_ID.keys());

function phrase(text, value) {
  const haystack = ` ${normalize(text)} `;
  const needle = ` ${normalize(value)} `;
  return needle.trim().length >= 8 && haystack.includes(needle);
}

function requestedActorType(question) {
  const q = ` ${normalize(question)} `;
  const candidate = /\b(candidat|candidats|candidate|candidates|personnalite|personnalites)\b/.test(q);
  const party = /\b(parti|partis|mouvement|mouvements)\b/.test(q);
  if (candidate === party) return null;
  return candidate ? "candidate" : "party";
}

function allowedByRequestedType(entityId, type) {
  if (!type) return true;
  return type === "candidate" ? CANDIDATE_IDS.has(entityId) : PARTY_IDS.has(entityId);
}

function relationMeta(entityId) {
  const candidate = CANDIDATE_BY_ID.get(entityId);
  if (candidate) {
    const party = candidate.primary_party_id ? PARTY_BY_ID.get(candidate.primary_party_id) : null;
    return { partyId: candidate.primary_party_id || null, partyName: party?.name || null };
  }
  const party = PARTY_BY_ID.get(entityId);
  return party ? { partyId: party.id, partyName: party.name } : { partyId: null, partyName: null };
}

function activeProposal(chunk) {
  return chunk?.kind === "proposal"
    && !INACTIVE.has(String(chunk.documentStatus || "current").toLowerCase())
    && !INACTIVE.has(String(chunk.proposalStatus || "current").toLowerCase());
}

function exactCanonicalProposalMatches(question, analysis) {
  if (analysis.intent?.unsupported || !analysis.requestedEntities?.length) return [];
  const requestedIds = new Set(analysis.requestedEntities.map((entity) => entity.id));
  const type = requestedActorType(question);
  const byPath = new Map();

  for (const chunk of searchIndex.chunks || []) {
    if (!activeProposal(chunk)) continue;
    if (!requestedIds.has(chunk.entityId)) continue;
    if (!allowedByRequestedType(chunk.entityId, type)) continue;
    if (!chunk.title || !phrase(question, chunk.title)) continue;
    const current = byPath.get(chunk.path);
    if (!current || String(chunk.text || "").length > String(current.text || "").length) byPath.set(chunk.path, chunk);
  }
  return [...byPath.values()];
}

function toResult(chunk, analysis) {
  return {
    score: 1000000,
    text: chunk.text,
    match: {
      concepts: (analysis.concepts || []).map((concept) => ({
        id: concept.id,
        label: concept.label,
        terms: [],
        matchedAlias: concept.matchedAlias
      })),
      directTerms: []
    },
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
      exactCanonicalTitleMatch: true,
      ...relationMeta(chunk.entityId)
    }
  };
}

function mergeExact(base, exact, limit) {
  if (!exact.length) return base;
  const byKey = new Map();
  for (const item of [...exact, ...(base.results || [])]) {
    const key = `${item?.citation?.entityId || ""}:${item?.citation?.path || item?.citation?.recordId || ""}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  const results = [...byKey.values()].slice(0, limit);
  return {
    ...base,
    results,
    debug: {
      ...base.debug,
      answerable: true,
      reason: "exact_canonical_title_match",
      exactCanonicalTitleMatches: exact.map((item) => item.citation.path)
    }
  };
}

export function retrieveDeterministic(question, options = {}) {
  const limit = Number(options.limit || 10);
  const base = retrieveV7(question, options);
  const analysis = analyzeQuery(question);
  const exact = exactCanonicalProposalMatches(question, analysis).map((chunk) => toResult(chunk, analysis));
  return mergeExact(base, exact, limit);
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
