import assert from "node:assert/strict";
import searchIndex from "../data/search-index.json" with { type: "json" };
import { analyzeQuery } from "../lib/retrieval-v2.js";

const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const byPath = new Map();
for (const chunk of searchIndex.chunks) {
  if (chunk.kind !== "proposal") continue;
  if (INACTIVE.has(String(chunk.documentStatus || "unknown").toLowerCase())) continue;
  if (!byPath.has(chunk.path)) byPath.set(chunk.path, []);
  byPath.get(chunk.path).push(chunk);
}

const missing = [];
for (const [path, chunks] of byPath) {
  const input = chunks.map((chunk) => [chunk.title, chunk.section, ...(chunk.topics || []), chunk.text].filter(Boolean).join(" ")).join(" ");
  const concepts = analyzeQuery(input).concepts;
  if (!concepts.length) missing.push(path);
}

const total = byPath.size;
const covered = total - missing.length;
const coverage = total ? covered / total : 1;
console.log("ONTOLOGY_COVERAGE=" + JSON.stringify({ total, covered, coverage: Number(coverage.toFixed(3)), missing }));
assert.ok(total > 0, "le corpus doit contenir des propositions actives");
assert.equal(missing.length, 0, `chaque proposition active doit être rattachable à l'ontologie pour le retrieval et les suggestions: ${missing.join(", ")}`);
