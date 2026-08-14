import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import entities from "../data/entities.json" with { type: "json" };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = path.join(ROOT, "corpus", "2027");
const CURRENT = new Set(["current", "amended"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const candidateIds = new Set((entities.candidates || []).map((candidate) => candidate.id));
const partyIds = new Set((entities.parties || []).map((party) => party.id));

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function parseScalar(raw = "") {
  const value = raw.trim();
  if (!value || value === "null" || value === "~") return null;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).split(",").map((item) => parseScalar(item)).filter(Boolean);
  return value;
}

function parseDocument(file) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.startsWith("---\n")) return null;
  const end = source.indexOf("\n---\n", 4);
  if (end === -1) return null;
  const meta = {};
  for (const line of source.slice(4, end).split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    meta[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }
  return { meta, body: source.slice(end + 5).trim() };
}

function cleanMarkdown(value = "") {
  return String(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function excerpt(text = "", limit = 290) {
  const value = cleanMarkdown(text);
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const sentence = cut.lastIndexOf(". ");
  return `${(sentence > limit * 0.55 ? cut.slice(0, sentence + 1) : cut).trim()}…`;
}

function entityType(entityId) {
  if (candidateIds.has(entityId)) return "candidate";
  if (partyIds.has(entityId)) return "party";
  return "unknown";
}

function entityLabel(entityId) {
  return entities.candidates?.find((candidate) => candidate.id === entityId)?.name
    || entities.parties?.find((party) => party.id === entityId)?.name
    || entityId
    || "Entité inconnue";
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

export function buildRecentDocumentFeed(limit = 80) {
  const updates = [];
  for (const file of walk(CORPUS).filter((item) => item.endsWith(".md")).sort()) {
    const parsed = parseDocument(file);
    if (!parsed) continue;
    const { meta, body } = parsed;
    const documentStatus = meta.document_status || "unknown";
    if (!CURRENT.has(documentStatus)) continue;

    // An automatic capture fallback is evidence of when we observed the page,
    // not evidence of its publication date. It must never enter the publication chronology.
    if (meta.date_basis === "capture_fallback") continue;

    const publishedAt = String(meta.published_at || "").slice(0, 10);
    if (!DAY.test(publishedAt)) continue;
    const title = meta.title || cleanMarkdown(body.match(/^#\s+(.+)$/m)?.[1] || path.basename(file, ".md"));
    const entityId = meta.entity_id || null;
    updates.push({
      id: meta.document_id || relative(file),
      title,
      entityId,
      entityType: entityType(entityId),
      entityLabel: entityLabel(entityId),
      publishedAt,
      dateBasis: meta.date_basis || "source_publication",
      capturedAt: meta.captured_at || null,
      sourceUrl: meta.source_url || meta.primary_source_url || null,
      sourceTier: meta.source_tier || null,
      documentStatus,
      path: relative(file),
      topics: Array.isArray(meta.topics) ? meta.topics : [],
      excerpt: excerpt(body)
    });
  }
  return updates
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.entityLabel.localeCompare(b.entityLabel, "fr") || a.title.localeCompare(b.title, "fr"))
    .slice(0, limit);
}
