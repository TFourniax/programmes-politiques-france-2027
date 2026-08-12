import assert from "node:assert/strict";
import fs from "node:fs";
import searchIndex from "../data/search-index.json" with { type: "json" };
import benchmark from "../data/qa-deterministic-benchmark.json" with { type: "json" };
import { retrieveDeterministic } from "../lib/retrieval-v2.js";
import { classifyDeterministicQuestion, selectDeterministicCandidates } from "../lib/deterministic-query.js";
import { buildHistoryTimeline, getHistoryMeta } from "../lib/history.js";
import { buildContextualSuggestions, sanitizeSuggestionSessionState } from "../lib/contextual-suggestions.js";

const INACTIVE = new Set(["superseded", "withdrawn", "archived", "rejected", "draft", "historical"]);
const active = (status) => !INACTIVE.has(String(status || "unknown").toLowerCase());

const strictQualifierNegatives = [
  "Que propose Renaissance sur l'énergie des licornes ?",
  "Que propose Renaissance sur le nucléaire sur Mars ?",
  "Que propose le PS sur la santé des dinosaures ?",
  "Que propose Équinoxe sur le climat de Jupiter ?",
  "Que propose le RN sur l'immigration des extraterrestres ?",
  "Que propose David Lisnard sur l'éducation des dragons ?"
];
for (const question of strictQualifierNegatives) {
  const result = retrieveDeterministic(question, { limit: 8 });
  assert.equal(result.results.length, 0, `un concept politique valide ne doit pas masquer un qualificatif hors corpus: ${question}`);
  assert.equal(result.debug.answerable, false, `la requête doit être explicitement non répondable: ${question}`);
}

assert.equal(
  classifyDeterministicQuestion("Que propose le candidat David Lisnard sur les retraites ?"),
  "measures",
  "le mot candidat dans une question de programme ne doit pas basculer vers le registre des statuts"
);
assert.equal(
  classifyDeterministicQuestion("Compare les candidats David Lisnard et Emmanuel Macron sur les retraites"),
  "comparison",
  "une comparaison de politiques doit garder la priorité sur le vocabulaire candidat"
);
assert.equal(
  classifyDeterministicQuestion("Quel est le statut de la candidature de David Lisnard ?"),
  "candidates",
  "une vraie question de statut doit continuer à utiliser le registre des candidatures"
);
assert.ok(
  selectDeterministicCandidates("Quel est le statut de la candidature de David Lisnard ?").some((item) => item.id === "david-lisnard"),
  "la sélection ciblée de candidat doit rester fonctionnelle pour une question de statut"
);

const currentQueries = [
  ...benchmark.positive.map((item) => item.question),
  "Quelles sont les propositions documentées sur les retraites ?",
  "Que propose le corpus sur l'énergie ?",
  "Quelles propositions sont documentées sur l'immigration ?",
  "Quelles mesures sont documentées sur la fiscalité ?"
];
for (const question of currentQueries) {
  const result = retrieveDeterministic(question, { limit: 14 });
  for (const item of result.results) {
    assert.ok(active(item.citation?.documentStatus), `le chatbot courant ne doit jamais exposer une version inactive (${item.citation?.documentStatus}) pour ${question}: ${item.citation?.path}`);
  }
}

const inactivePaths = new Set(searchIndex.chunks
  .filter((chunk) => ["proposal", "document"].includes(chunk.kind) && !active(chunk.documentStatus))
  .map((chunk) => chunk.path));
for (const question of currentQueries) {
  const returned = retrieveDeterministic(question, { limit: 20 }).results.map((item) => item.citation?.path);
  assert.ok(returned.every((path) => !inactivePaths.has(path)), `une ancienne version indexée a contaminé le retrieval courant: ${question}`);
}

for (const chunk of searchIndex.chunks.filter((item) => ["proposal", "document"].includes(item.kind))) {
  assert.ok(chunk.recordId, `chaque document/proposition doit avoir un recordId versionnable: ${chunk.path}`);
  assert.ok(Array.isArray(chunk.supersedes), `supersedes doit être normalisé en tableau: ${chunk.path}`);
  assert.ok(Array.isArray(chunk.supersededBy), `supersededBy doit être normalisé en tableau: ${chunk.path}`);
}

const historyMeta = getHistoryMeta();
assert.ok(historyMeta.counts.records > 0, "le mode historique doit exposer des documents/propositions versionnés");
assert.equal(historyMeta.counts.current + historyMeta.counts.historical, historyMeta.counts.records);
assert.ok(historyMeta.actors.some((item) => item.id === "renaissance"), "Renaissance doit être disponible dans le sélecteur historique");
const history = buildHistoryTimeline("renaissance", "nucleaire");
assert.equal(history.actor.id, "renaissance");
assert.equal(history.topic.id, "nucleaire");
assert.ok(Array.isArray(history.timeline));
assert.ok(history.timeline.length > 0, "le mode historique doit retrouver les données nucléaires de Renaissance");
for (const event of history.timeline) {
  assert.ok(["proposal", "document"].includes(event.kind));
  assert.ok(Array.isArray(event.supersedes) && Array.isArray(event.supersededBy));
  if (event.evolutionSignal === "replaces_previous") assert.ok(event.supersedes.length > 0, "un changement explicite doit être soutenu par supersedes");
  if (event.evolutionSignal === "replaced_by_newer") assert.ok(event.supersededBy.length > 0, "un remplacement explicite doit être soutenu par superseded_by");
}
assert.match(history.methodologyNote, /n’est jamais interprété comme un changement de position/i);

const retirement = retrieveDeterministic("Que propose le corpus sur les retraites ?", { limit: 12 });
const suggestions = buildContextualSuggestions("Que propose le corpus sur les retraites ?", retirement.results, [], { limit: 3 });
assert.ok(suggestions.length > 0);
for (const suggestion of suggestions) {
  const result = retrieveDeterministic(suggestion, { limit: 6 });
  assert.ok(result.results.length > 0 && result.debug.answerable, `suggestion non répondable: ${suggestion}`);
  assert.ok(result.results.every((item) => active(item.citation?.documentStatus)), `suggestion fondée sur une version inactive: ${suggestion}`);
}

assert.deepEqual(
  sanitizeSuggestionSessionState({ entityIds: ["renaissance", "__invalid__", "fake"], conceptIds: ["nucleaire", "fake"] }),
  { entityIds: ["renaissance"], conceptIds: ["nucleaire"] },
  "le contexte de session transmis par le client doit être traité comme non fiable et filtré"
);

const routeSource = fs.readFileSync("app/api/chat/route.js", "utf8");
assert.match(routeSource, /fallbackLimited\(request\)/, "le fallback payant doit avoir son propre budget de requêtes");
assert.match(routeSource, /windowLimited\(fallbackWindows, clientKey\(request\), 2, 60_000\)/, "le fallback LLM doit rester limité à deux tentatives par minute et par client");
assert.match(routeSource, /windowLimited\(windows, clientKey\(request\), 30, 60_000\)/, "le chemin déterministe doit accepter un usage humain soutenu tout en restant borné");
assert.match(routeSource, /x-nf-client-connection-ip/, "le runtime Netlify doit privilégier l'IP fournie par la plateforme");
assert.match(routeSource, /publicRetrieval/, "les détails internes du ranking ne doivent pas être renvoyés intégralement au navigateur");
assert.match(routeSource, /sessionContext/, "la session structurée doit être transportée explicitement et rester bornée");

const edgeRateLimit = fs.readFileSync("netlify/edge-functions/chat-rate-limit.js", "utf8");
assert.match(edgeRateLimit, /windowLimit:\s*30/);
assert.match(edgeRateLimit, /windowSize:\s*60/);
assert.match(edgeRateLimit, /aggregateBy:\s*\["ip",\s*"domain"\]/);

console.log("PRODUCT_HARDENING_OK", {
  strictQualifierNegatives: strictQualifierNegatives.length,
  currentQueries: currentQueries.length,
  inactiveIndexedPaths: inactivePaths.size,
  history: historyMeta.counts,
  suggestions
});
