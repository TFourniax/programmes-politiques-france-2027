import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import ontology from "../data/political-ontology.json" with { type: "json" };
import { analyzeQuery, normalize, retrieveDeterministic } from "./retrieval-v2.js";

const entityById = new Map([
  ...entities.candidates.map((item) => [item.id, { ...item, type: "candidate" }]),
  ...entities.parties.map((item) => [item.id, { ...item, type: "party" }])
]);
const conceptById = new Map(ontology.concepts.map((item) => [item.id, item]));
const chunkConceptCache = new Map();
const EXCLUDED_STATUSES = new Set(["withdrawn", "superseded", "archived", "rejected"]);

function currentChunks() {
  return searchIndex.chunks.filter((chunk) =>
    ["proposal", "document"].includes(chunk.kind)
    && chunk.entityId
    && !EXCLUDED_STATUSES.has(String(chunk.documentStatus || "").toLowerCase())
  );
}

function chunkConceptIds(chunk) {
  if (chunkConceptCache.has(chunk.id)) return chunkConceptCache.get(chunk.id);
  const input = [chunk.title, chunk.section, ...(chunk.topics || []), chunk.text].filter(Boolean).join(" ");
  const ids = [...new Set(analyzeQuery(input).concepts.map((item) => item.id).filter((id) => conceptById.has(id)))];
  chunkConceptCache.set(chunk.id, ids);
  return ids;
}

function recentUserQuestions(history = []) {
  return (history || [])
    .filter((item) => item?.role === "user" && String(item.content || "").trim())
    .slice(-4)
    .map((item) => String(item.content));
}

function addWeight(map, key, value) {
  if (!key) return;
  map.set(key, Math.max(map.get(key) || 0, value));
}

function conversationProfile(question, history, evidence) {
  const questions = [...recentUserQuestions(history), question];
  const conceptWeights = new Map();
  const entityWeights = new Map();
  const askedPairs = new Set();

  questions.forEach((text, index) => {
    const analysis = analyzeQuery(text);
    const recency = index === questions.length - 1 ? 10 : Math.max(2, 7 - (questions.length - 1 - index));
    for (const concept of analysis.concepts) addWeight(conceptWeights, concept.id, recency);
    for (const entity of analysis.requestedEntities) addWeight(entityWeights, entity.id, recency);
    for (const entity of analysis.requestedEntities) {
      for (const concept of analysis.concepts) askedPairs.add(`${entity.id}::${concept.id}`);
    }
  });

  for (const item of evidence || []) {
    const entityId = item?.citation?.entityId;
    const partyId = item?.citation?.partyId;
    addWeight(entityWeights, entityId, 8);
    if (partyId && partyId !== entityId) addWeight(entityWeights, partyId, 4);
  }

  const current = analyzeQuery(question);
  return {
    current,
    conceptWeights,
    entityWeights,
    askedPairs,
    normalizedQuestions: new Set(questions.map(normalize).filter(Boolean))
  };
}

function suggestionText(entityId, conceptId) {
  const entity = entityById.get(entityId);
  const concept = conceptById.get(conceptId);
  if (!entity || !concept) return "";
  return `Que propose ${entity.name} sur ${concept.label} ?`;
}

function addCandidate(map, profile, entityId, conceptId, score, reason) {
  if (!entityById.has(entityId) || !conceptById.has(conceptId)) return;
  const pair = `${entityId}::${conceptId}`;
  if (profile.askedPairs.has(pair)) return;
  const text = suggestionText(entityId, conceptId);
  const key = normalize(text);
  if (!text || profile.normalizedQuestions.has(key)) return;
  const existing = map.get(key);
  if (!existing || existing.score < score) map.set(key, { text, entityId, conceptId, score, reason });
}

function candidatePool(profile) {
  const candidates = new Map();
  const chunks = currentChunks();

  // 1. Approfondir les acteurs qui viennent réellement d'apparaître dans la réponse,
  // en privilégiant les thèmes déjà évoqués dans la conversation.
  for (const [entityId, entityWeight] of profile.entityWeights) {
    const sameEntity = chunks.filter((chunk) => chunk.entityId === entityId);
    const seenConcepts = new Set();
    for (const chunk of sameEntity) {
      for (const conceptId of chunkConceptIds(chunk)) {
        if (seenConcepts.has(conceptId)) continue;
        seenConcepts.add(conceptId);
        const thematicEcho = profile.conceptWeights.get(conceptId) || 0;
        addCandidate(candidates, profile, entityId, conceptId, 45 + entityWeight * 2 + thematicEcho * 3, "entity_deep_dive");
      }
    }
  }

  // 2. Continuer le thème actuel avec d'autres acteurs réellement documentés.
  for (const [conceptId, conceptWeight] of profile.conceptWeights) {
    const seenEntities = new Set();
    for (const chunk of chunks) {
      if (seenEntities.has(chunk.entityId) || !chunkConceptIds(chunk).includes(conceptId)) continue;
      seenEntities.add(chunk.entityId);
      const entityEcho = profile.entityWeights.get(chunk.entityId) || 0;
      addCandidate(candidates, profile, chunk.entityId, conceptId, 35 + conceptWeight * 3 + entityEcho * 2, "theme_lateral");
    }
  }

  return [...candidates.values()].sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, "fr"));
}

function validatedSuggestion(candidate) {
  const retrieval = retrieveDeterministic(candidate.text, { limit: 4 });
  if (!retrieval.results.length || !retrieval.debug.answerable) return false;
  if (String(retrieval.debug.reason || "").startsWith("unsupported_")) return false;
  if (!retrieval.debug.requestedEntities?.some((item) => item.id === candidate.entityId)) return false;
  if (!retrieval.debug.concepts?.some((item) => item.id === candidate.conceptId)) return false;
  return retrieval.results.every((item) => item.citation?.entityId === candidate.entityId);
}

export function buildContextualSuggestions(question, evidence = [], history = [], { limit = 3 } = {}) {
  const profile = conversationProfile(question, history, evidence);
  const pool = candidatePool(profile).slice(0, 24);
  const selected = [];
  const entityCounts = new Map();
  const conceptCounts = new Map();

  for (const candidate of pool) {
    if (selected.length >= limit) break;
    if ((entityCounts.get(candidate.entityId) || 0) >= 2) continue;
    if ((conceptCounts.get(candidate.conceptId) || 0) >= 2) continue;
    if (!validatedSuggestion(candidate)) continue;
    selected.push(candidate.text);
    entityCounts.set(candidate.entityId, (entityCounts.get(candidate.entityId) || 0) + 1);
    conceptCounts.set(candidate.conceptId, (conceptCounts.get(candidate.conceptId) || 0) + 1);
  }

  return selected;
}
