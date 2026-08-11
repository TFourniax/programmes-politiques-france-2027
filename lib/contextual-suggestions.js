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
const EXCLUDED_STATUSES = new Set(["withdrawn", "superseded", "archived", "rejected", "draft", "historical"]);

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

function validIds(values, catalogue, limit = 8) {
  return [...new Set((Array.isArray(values) ? values : []).map(String).filter((id) => catalogue.has(id)))].slice(0, limit);
}

export function sanitizeSuggestionSessionState(raw = {}) {
  return {
    entityIds: validIds(raw?.entityIds, entityById),
    conceptIds: validIds(raw?.conceptIds, conceptById)
  };
}

export function buildSuggestionSessionState(previous = {}, question = "", evidence = []) {
  const safe = sanitizeSuggestionSessionState(previous);
  const analysis = analyzeQuery(question);
  const currentEntities = [
    ...analysis.requestedEntities.map((item) => item.id),
    ...(evidence || []).map((item) => item?.citation?.entityId),
    ...(evidence || []).map((item) => item?.citation?.partyId)
  ].filter(Boolean);
  const currentConcepts = analysis.concepts.map((item) => item.id);
  return {
    entityIds: validIds([...currentEntities, ...safe.entityIds], entityById),
    conceptIds: validIds([...currentConcepts, ...safe.conceptIds], conceptById)
  };
}

function conversationProfile(question, history, evidence, sessionState = {}) {
  const questions = [...recentUserQuestions(history), question];
  const conceptWeights = new Map();
  const entityWeights = new Map();
  const answerEntities = new Set();
  const askedPairs = new Set();
  const safeSession = sanitizeSuggestionSessionState(sessionState);

  for (const conceptId of safeSession.conceptIds) addWeight(conceptWeights, conceptId, 2);
  for (const entityId of safeSession.entityIds) addWeight(entityWeights, entityId, 2);

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
    if (entityId) answerEntities.add(entityId);
    addWeight(entityWeights, entityId, 8);
    if (partyId && partyId !== entityId) addWeight(entityWeights, partyId, 4);
  }

  const current = analyzeQuery(question);
  return {
    current,
    currentConceptIds: new Set(current.concepts.map((item) => item.id)),
    currentEntityIds: new Set(current.requestedEntities.map((item) => item.id)),
    conceptWeights,
    entityWeights,
    answerEntities,
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

function addCandidate(map, profile, entityId, conceptId, score, reason, tier) {
  if (!entityById.has(entityId) || !conceptById.has(conceptId)) return;
  const pair = `${entityId}::${conceptId}`;
  if (profile.askedPairs.has(pair)) return;
  const text = suggestionText(entityId, conceptId);
  const key = normalize(text);
  if (!text || profile.normalizedQuestions.has(key)) return;
  const existing = map.get(key);
  const candidate = { text, entityId, conceptId, score, reason, tier };
  if (!existing || tier < existing.tier || (tier === existing.tier && score > existing.score)) map.set(key, candidate);
}

function candidatePool(profile) {
  const candidates = new Map();
  const chunks = currentChunks();
  const chunksByEntity = new Map();
  for (const chunk of chunks) {
    if (!chunksByEntity.has(chunk.entityId)) chunksByEntity.set(chunk.entityId, []);
    chunksByEntity.get(chunk.entityId).push(chunk);
  }

  for (const conceptId of profile.currentConceptIds) {
    const conceptWeight = profile.conceptWeights.get(conceptId) || 10;
    const seenEntities = new Set();
    for (const chunk of chunks) {
      if (seenEntities.has(chunk.entityId) || !chunkConceptIds(chunk).includes(conceptId)) continue;
      seenEntities.add(chunk.entityId);
      const inAnswer = profile.answerEntities.has(chunk.entityId);
      const explicitlyNamed = profile.currentEntityIds.has(chunk.entityId);
      const entityEcho = profile.entityWeights.get(chunk.entityId) || 0;
      const tier = inAnswer && !explicitlyNamed ? 1 : 2;
      const score = 100 + conceptWeight * 4 + entityEcho * 2 + (inAnswer ? 18 : 0);
      addCandidate(candidates, profile, chunk.entityId, conceptId, score, inAnswer ? "current_theme_answer_entity" : "current_theme_other_entity", tier);
    }
  }

  for (const [conceptId, conceptWeight] of profile.conceptWeights) {
    if (profile.currentConceptIds.has(conceptId)) continue;
    for (const entityId of profile.answerEntities) {
      const supportsConcept = (chunksByEntity.get(entityId) || []).some((chunk) => chunkConceptIds(chunk).includes(conceptId));
      if (!supportsConcept) continue;
      addCandidate(candidates, profile, entityId, conceptId, 70 + conceptWeight * 3, "previous_theme_answer_entity", 3);
    }
  }

  for (const entityId of profile.answerEntities) {
    const entityWeight = profile.entityWeights.get(entityId) || 8;
    const seenConcepts = new Set();
    for (const chunk of chunksByEntity.get(entityId) || []) {
      for (const conceptId of chunkConceptIds(chunk)) {
        if (profile.currentConceptIds.has(conceptId) || seenConcepts.has(conceptId)) continue;
        seenConcepts.add(conceptId);
        const thematicEcho = profile.conceptWeights.get(conceptId) || 0;
        addCandidate(candidates, profile, entityId, conceptId, 45 + entityWeight * 2 + thematicEcho * 2, "adjacent_theme_answer_entity", 4);
      }
    }
  }

  return [...candidates.values()].sort((a, b) => a.tier - b.tier || b.score - a.score || a.text.localeCompare(b.text, "fr"));
}

function validatedSuggestion(candidate) {
  const retrieval = retrieveDeterministic(candidate.text, { limit: 4 });
  if (!retrieval.results.length || !retrieval.debug.answerable) return false;
  if (String(retrieval.debug.reason || "").startsWith("unsupported_")) return false;
  if (!retrieval.debug.requestedEntities?.some((item) => item.id === candidate.entityId)) return false;
  if (!retrieval.debug.concepts?.some((item) => item.id === candidate.conceptId)) return false;
  return retrieval.results.every((item) => item.citation?.entityId === candidate.entityId);
}

export function buildContextualSuggestions(question, evidence = [], history = [], { limit = 3, sessionState = {} } = {}) {
  const profile = conversationProfile(question, history, evidence, sessionState);
  const pool = candidatePool(profile).slice(0, 32);
  const selected = [];
  const entityCounts = new Map();

  for (const candidate of pool) {
    if (selected.length >= limit) break;
    if ((entityCounts.get(candidate.entityId) || 0) >= 2) continue;
    if (!validatedSuggestion(candidate)) continue;
    selected.push(candidate.text);
    entityCounts.set(candidate.entityId, (entityCounts.get(candidate.entityId) || 0) + 1);
  }

  return selected;
}