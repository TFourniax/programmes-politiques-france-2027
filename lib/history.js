import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };
import { analyzeQuery } from "./retrieval-v2.js";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));
const conceptById = new Map(ontology.concepts.map((item) => [item.id, item]));
const conceptCache = new Map();

function isPolicy(chunk) {
  return ["document", "proposal"].includes(chunk.kind) && chunk.entityId;
}

function activeStatus(status) {
  return !INACTIVE.has(String(status || "unknown").toLowerCase());
}

function excerpt(text = "", max = 360) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const sentence = [...cut.matchAll(/[.!?…](?=\s|$)/g)].at(-1);
  if (sentence && sentence.index >= Math.floor(max * 0.55)) return cut.slice(0, sentence.index + 1).trim();
  return `${cut.trim()}…`;
}

function conceptsForRecord(record) {
  if (conceptCache.has(record.path)) return conceptCache.get(record.path);
  const input = [record.title, record.section, ...(record.topics || []), record.text].filter(Boolean).join(" ");
  const ids = [...new Set(analyzeQuery(input).concepts.map((item) => item.id).filter((id) => conceptById.has(id)))];
  conceptCache.set(record.path, ids);
  return ids;
}

function uniqueRecords() {
  const byPath = new Map();
  for (const chunk of searchIndex.chunks.filter(isPolicy)) {
    const current = byPath.get(chunk.path);
    if (!current) {
      byPath.set(chunk.path, { ...chunk, textParts: [chunk.text], sections: [chunk.section].filter(Boolean), topicsAggregate: [...(chunk.topics || [])] });
      continue;
    }
    current.textParts.push(chunk.text);
    if (chunk.section) current.sections.push(chunk.section);
    current.topicsAggregate.push(...(chunk.topics || []));
  }
  return [...byPath.values()].map((record) => {
    const merged = {
      ...record,
      text: record.textParts.join(" "),
      section: [...new Set(record.sections)].join(" · ") || record.section || null,
      topics: [...new Set(record.topicsAggregate.filter(Boolean))]
    };
    return {
      ...merged,
      textParts: undefined,
      sections: undefined,
      topicsAggregate: undefined,
      conceptIds: conceptsForRecord(merged)
    };
  });
}

const records = uniqueRecords();
const recordById = new Map(records.map((item) => [item.recordId || item.path, item]));

function entityInfo(id) {
  const candidate = candidateById.get(id);
  if (candidate) {
    const party = candidate.primary_party_id ? partyById.get(candidate.primary_party_id) : null;
    return {
      id,
      name: candidate.name,
      type: "candidate",
      partyId: candidate.primary_party_id || null,
      partyName: party?.name || null
    };
  }
  const party = partyById.get(id);
  if (party) return { id, name: party.name, type: "party", partyId: party.id, partyName: party.name };
  return null;
}

function relationTitles(ids = []) {
  return ids.map((id) => {
    const target = recordById.get(id);
    return { id, title: target?.title || id, path: target?.path || null };
  });
}

function dateLabel(record) {
  if (!record.publishedAt) return "date non renseignée";
  if (record.dateBasis === "capture_fallback") {
    return `capturé le ${record.publishedAt} · date de publication non exposée`;
  }
  return record.publishedAt;
}

function event(record) {
  const status = String(record.documentStatus || "unknown").toLowerCase();
  const current = activeStatus(status);
  return {
    recordId: record.recordId || record.path,
    kind: record.kind,
    title: record.title,
    entityId: record.entityId,
    entityLabel: record.entityLabel,
    publishedAt: record.publishedAt || null,
    dateBasis: record.dateBasis || null,
    capturedAt: record.capturedAt || null,
    dateLabel: dateLabel(record),
    status,
    current,
    certainty: record.certainty || null,
    sourceTier: record.sourceTier || null,
    confidence: record.confidence || null,
    excerpt: excerpt(record.text),
    path: record.path,
    githubUrl: `${REPO}/blob/main/${record.path}`,
    sourceUrl: record.sourceUrl || null,
    conceptIds: record.conceptIds || [],
    supersedes: relationTitles(record.supersedes || []),
    supersededBy: relationTitles(record.supersededBy || []),
    evolutionSignal: (record.supersedes || []).length
      ? "replaces_previous"
      : (record.supersededBy || []).length
        ? "replaced_by_newer"
        : current
          ? "current_snapshot"
          : "historical_record"
  };
}

function sortTimeline(a, b) {
  return String(b.publishedAt || "0000-00-00").localeCompare(String(a.publishedAt || "0000-00-00"))
    || a.title.localeCompare(b.title, "fr");
}

export function getHistoryMeta() {
  const idsWithRecords = new Set(records.map((item) => item.entityId));
  const conceptIds = new Set(records.flatMap((item) => item.conceptIds || []));
  const actors = [...idsWithRecords]
    .map(entityInfo)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  const topics = ontology.concepts
    .filter((item) => conceptIds.has(item.id))
    .map((item) => ({ id: item.id, label: item.label }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  return {
    snapshotDate: entities.snapshot_date,
    actors,
    topics,
    counts: {
      records: records.length,
      current: records.filter((item) => activeStatus(item.documentStatus)).length,
      historical: records.filter((item) => !activeStatus(item.documentStatus)).length
    }
  };
}

export function buildHistoryTimeline(entityId, conceptId = null) {
  const actor = entityInfo(entityId);
  if (!actor) throw new Error("Acteur inconnu");
  if (conceptId && !conceptById.has(conceptId)) throw new Error("Thème historique inconnu");

  const selected = records
    .filter((item) => item.entityId === entityId)
    .filter((item) => !conceptId || item.conceptIds.includes(conceptId))
    .map(event)
    .sort(sortTimeline);

  const current = selected.filter((item) => item.current);
  const historical = selected.filter((item) => !item.current);
  const explicitVersionLinks = selected.reduce((sum, item) => sum + item.supersedes.length + item.supersededBy.length, 0);
  let partyContext = null;
  if (actor.type === "candidate" && actor.partyId) {
    const partyRecords = records
      .filter((item) => item.entityId === actor.partyId)
      .filter((item) => !conceptId || item.conceptIds.includes(conceptId));
    partyContext = {
      id: actor.partyId,
      name: actor.partyName,
      records: partyRecords.length,
      note: "Ces documents appartiennent au parti et ne sont pas automatiquement attribués à la personnalité."
    };
  }

  return {
    snapshotDate: entities.snapshot_date,
    actor,
    topic: conceptId ? { id: conceptId, label: conceptById.get(conceptId).label } : null,
    summary: {
      total: selected.length,
      current: current.length,
      historical: historical.length,
      explicitVersionLinks
    },
    timeline: selected,
    partyContext,
    methodologyNote: "La chronologie montre les documents et propositions versionnés. Un lien d’évolution n’est présenté comme tel que lorsqu’un champ supersedes/superseded_by le documente explicitement ; l’ordre des dates seul n’est jamais interprété comme un changement de position. Lorsqu’une source ne publie pas de date exploitable, l’interface indique explicitement une date de capture au lieu de la présenter comme une date de publication."
  };
}
