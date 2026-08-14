import searchIndex from "../data/search-index.json" with { type: "json" };

const CURRENT = new Set(["current", "amended"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function excerpt(text = "", limit = 290) {
  const value = String(text).replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const sentence = cut.lastIndexOf(". ");
  return `${(sentence > limit * 0.55 ? cut.slice(0, sentence + 1) : cut).trim()}…`;
}

export function buildRecentDocumentFeed(limit = 80) {
  const byPath = new Map();
  for (const chunk of searchIndex.chunks || []) {
    if (chunk.kind !== "document") continue;
    if (!CURRENT.has(chunk.documentStatus || "unknown")) continue;
    const publishedAt = String(chunk.publishedAt || "").slice(0, 10);
    if (!DAY.test(publishedAt)) continue;
    if (!chunk.path || byPath.has(chunk.path)) continue;
    byPath.set(chunk.path, {
      id: chunk.id,
      title: chunk.title,
      entityId: chunk.entityId,
      entityLabel: chunk.entityLabel || chunk.entityId,
      publishedAt,
      sourceUrl: chunk.sourceUrl || null,
      sourceTier: chunk.sourceTier || null,
      documentStatus: chunk.documentStatus || "unknown",
      path: chunk.path,
      topics: [...new Set(chunk.topics || [])],
      excerpt: excerpt(chunk.text)
    });
  }
  return [...byPath.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.entityLabel.localeCompare(b.entityLabel, "fr") || a.title.localeCompare(b.title, "fr"))
    .slice(0, limit);
}
