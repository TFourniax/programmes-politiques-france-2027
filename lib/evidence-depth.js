import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const SUPPORT_STOP = new Set([
  "avec", "avoir", "cette", "dans", "des", "elle", "elles", "entre", "etre", "fait", "leur", "leurs", "mais",
  "nous", "notre", "pour", "plus", "peut", "politique", "programme", "propose", "proposition", "source", "sont", "sur",
  "une", "vers", "vous", "ainsi", "comme", "aux", "par", "que", "qui", "les", "est", "du", "de", "la", "le", "un"
]);

const candidateById = new Map((entities.candidates || []).map((item) => [item.id, item]));
const partyById = new Map((entities.parties || []).map((item) => [item.id, item]));
const chunks = (searchIndex.chunks || []).filter((chunk) => {
  if (!["document", "proposal"].includes(chunk.kind)) return true;
  return !INACTIVE.has(String(chunk.documentStatus || "unknown").toLowerCase());
});

const byRecordId = new Map();
for (const chunk of chunks) {
  const key = String(chunk.recordId || "");
  if (!key) continue;
  if (!byRecordId.has(key)) byRecordId.set(key, []);
  byRecordId.get(key).push(chunk);
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

function sourceDocumentIdsForRecord(recordId) {
  const rows = byRecordId.get(String(recordId || "")) || [];
  const ids = rows.flatMap((chunk) => Array.isArray(chunk.sourceDocumentIds) ? chunk.sourceDocumentIds : []);
  return [...new Set(ids.map(String).filter(Boolean))];
}

function publicDate(chunk) {
  const raw = chunk.publishedAt || null;
  return chunk.dateBasis === "capture_fallback" && raw
    ? `capturé le ${raw} · date de publication non exposée`
    : raw;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function supportTerms(value) {
  return new Set(
    normalizeText(value)
      .split(/\s+/)
      .filter((term) => term.length >= 3 && !SUPPORT_STOP.has(term))
  );
}

function supportSimilarity(baseItem, chunk) {
  const base = supportTerms(`${baseItem?.text || ""} ${baseItem?.citation?.title || ""}`);
  const candidate = supportTerms(`${chunk?.title || ""} ${chunk?.text || ""}`);
  if (!base.size || !candidate.size) return 0;
  let shared = 0;
  for (const term of base) if (candidate.has(term)) shared += 1;
  if (shared < 2) return 0;

  const baseNumbers = new Set((String(baseItem?.text || "").match(/\b\d+(?:[.,]\d+)?\b/g) || []));
  const candidateNumbers = new Set((String(chunk?.text || "").match(/\b\d+(?:[.,]\d+)?\b/g) || []));
  let sharedNumbers = 0;
  for (const value of baseNumbers) if (candidateNumbers.has(value)) sharedNumbers += 1;
  return shared + Math.min(3, sharedNumbers * 1.5) + shared / Math.max(1, Math.min(base.size, candidate.size));
}

function relevantSupportingChunks(baseItem, supporting, limit) {
  return supporting
    .map((chunk) => ({ chunk, relevance: supportSimilarity(baseItem, chunk) }))
    .filter((row) => row.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || Number(a.chunk.chunkIndex || 0) - Number(b.chunk.chunkIndex || 0))
    .slice(0, limit)
    .map((row) => row.chunk);
}

function chunkEvidence(chunk, score = 0, attribution = null) {
  const sourceDocumentIds = Array.isArray(chunk.sourceDocumentIds)
    ? [...new Set(chunk.sourceDocumentIds.map(String).filter(Boolean))]
    : [];
  const entityId = attribution?.entityId || chunk.entityId;
  const entityLabel = attribution?.entityLabel || chunk.entityLabel;
  return {
    score,
    text: chunk.text,
    match: { concepts: [], directTerms: [] },
    citation: {
      title: chunk.title,
      recordId: chunk.recordId || null,
      canonicalClaimId: attribution?.canonicalClaimId || null,
      entityId,
      entityLabel,
      sourceOwnerEntityId: attribution ? chunk.entityId : null,
      sourceOwnerEntityLabel: attribution ? chunk.entityLabel : null,
      kind: chunk.kind,
      path: chunk.path,
      sourceUrl: chunk.sourceUrl,
      sourceTier: chunk.sourceTier || null,
      documentStatus: chunk.documentStatus,
      proposalStatus: chunk.proposalStatus || null,
      supersedes: chunk.supersedes || [],
      supersededBy: chunk.supersededBy || [],
      sourceDocumentIds,
      sourceCount: sourceDocumentIds.length || (chunk.kind === "document" && chunk.sourceUrl ? 1 : 0),
      candidateStatus: attribution?.candidateStatus ?? chunk.candidateStatus,
      publishedAt: publicDate(chunk),
      publishedAtRaw: chunk.publishedAt || null,
      dateBasis: chunk.dateBasis || null,
      capturedAt: chunk.capturedAt || null,
      confidence: chunk.confidence || null,
      certainty: attribution?.certainty ?? chunk.certainty ?? null,
      section: chunk.section || null,
      githubUrl: `${REPO}/blob/main/${chunk.path}`,
      ...relationMeta(entityId)
    }
  };
}

function evidenceKey(item) {
  const citation = item?.citation || {};
  return [citation.canonicalClaimId, citation.recordId, citation.path, citation.section, citation.entityId, String(item?.text || "").trim()].join("|");
}

export function enrichEvidence(evidence = []) {
  return evidence.map((item) => {
    const ids = sourceDocumentIdsForRecord(item?.citation?.recordId);
    const current = Array.isArray(item?.citation?.sourceDocumentIds) ? item.citation.sourceDocumentIds : [];
    const sourceDocumentIds = [...new Set([...current, ...ids].map(String).filter(Boolean))];
    const sourceCount = sourceDocumentIds.length || (item?.citation?.sourceUrl ? 1 : 0);
    return {
      ...item,
      citation: {
        ...item.citation,
        sourceDocumentIds,
        sourceCount
      }
    };
  });
}

export function expandEvidence(evidence = [], { maxEvidence = 36, chunksPerSource = 3 } = {}) {
  const base = enrichEvidence(evidence);
  const out = [];
  const seen = new Set();
  const add = (item) => {
    if (!item || out.length >= maxEvidence) return;
    const key = evidenceKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  base.forEach(add);

  for (const item of base) {
    if (out.length >= maxEvidence) break;
    const recordId = item?.citation?.recordId;
    for (const chunk of (byRecordId.get(String(recordId || "")) || []).slice(0, chunksPerSource)) {
      add(chunkEvidence(chunk, Math.max(0.1, Number(item.score || 0) * 0.55)));
    }

    const supportIds = item?.citation?.sourceDocumentIds || [];
    const attribution = {
      entityId: item?.citation?.entityId || null,
      entityLabel: item?.citation?.entityLabel || null,
      canonicalClaimId: item?.citation?.recordId || null,
      candidateStatus: item?.citation?.candidateStatus || null,
      certainty: item?.citation?.certainty || null
    };
    for (const documentId of supportIds) {
      const supporting = (byRecordId.get(String(documentId)) || []).filter((chunk) => chunk.kind === "document");
      for (const chunk of relevantSupportingChunks(item, supporting, chunksPerSource)) {
        add(chunkEvidence(chunk, Math.max(0.1, Number(item.score || 0) * 0.5), attribution));
      }
      if (out.length >= maxEvidence) break;
    }
  }

  return out;
}

function hasRelevantLinkedEvidence(item, chunksPerSource = 1) {
  for (const documentId of item?.citation?.sourceDocumentIds || []) {
    const supporting = (byRecordId.get(String(documentId)) || []).filter((chunk) => chunk.kind === "document");
    if (relevantSupportingChunks(item, supporting, chunksPerSource).length) return true;
  }
  return false;
}

export function canExpandEvidence(evidence = [], retrievalDebug = {}) {
  const enriched = enrichEvidence(evidence);
  if (enriched.some((item) => hasRelevantLinkedEvidence(item))) return true;
  if (enriched.some((item) => (byRecordId.get(String(item?.citation?.recordId || "")) || []).length > 1)) return true;
  return Number(retrievalDebug?.coherent || 0) > enriched.length;
}
