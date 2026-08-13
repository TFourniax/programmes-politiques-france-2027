import { composeDeterministicAnswer } from "./deterministic-answer-v2.js";
import { analyzeQuery, normalize } from "./retrieval-v2.js";

const STOP = new Set(["le", "la", "les", "un", "une", "des", "de", "du", "et", "ou", "pour", "par", "dans", "sur", "avec", "est", "sont"]);
const DETAIL_SIGNALS = /\b(si|sous|condition|plafond|minimum|maximum|euro|euros|million|millions|milliard|milliards|annee|ans|partir|jusqu|calendrier|financement|beneficiaire|concerne|taux|montant)\b/;

function splitSentences(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return [];
  return (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text])
    .map((item) => item.trim())
    .filter((item) => item.length >= 18);
}

function genericMetaSentence(value = "") {
  const text = normalize(value);
  return /^source primaire officielle attribuee/.test(text)
    || /^cette fiche est une synthese/.test(text)
    || /^promotion automatique/.test(text)
    || /^attribution(?: et preuve)?$/.test(text)
    || /^extrait de preuve/.test(text)
    || /^tracabilite$/.test(text)
    || /^cette entree est attribuee/.test(text)
    || /^la formulation reste limitee/.test(text)
    || /ne transfere jamais automatiquement/.test(text);
}

function semanticTerms(value) {
  return new Set(normalize(value).split(/\s+/).filter((term) => term.length >= 3 && !STOP.has(term)));
}

function similarText(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) / Math.max(na.length, nb.length) >= 0.62) return true;
  const sa = semanticTerms(a), sb = semanticTerms(b);
  if (!sa.size || !sb.size) return false;
  let intersection = 0;
  for (const term of sa) if (sb.has(term)) intersection += 1;
  return intersection / new Set([...sa, ...sb]).size >= 0.66;
}

function queryTerms(question) {
  const analysis = analyzeQuery(question);
  const direct = new Set(analysis.subjectTokens || []);
  const semantic = new Set();
  for (const concept of analysis.concepts || []) {
    for (const raw of [concept.matchedAlias, concept.label, ...(concept.aliases || []), ...(concept.retrieval_terms || [])]) {
      for (const term of normalize(raw || "").split(/\s+/)) if (term.length >= 3 && !STOP.has(term)) semantic.add(term);
    }
  }
  return { analysis, direct, semantic };
}

function sentenceScore(sentence, item, terms, index) {
  const normalized = normalize(sentence);
  const words = new Set(normalized.split(/\s+/));
  let directHits = 0;
  let semanticHits = 0;
  for (const term of terms.direct) if (words.has(term) || normalized.includes(term)) directHits += 1;
  for (const term of terms.semantic) if (words.has(term) || normalized.includes(term)) semanticHits += 1;
  const hasAnchor = directHits > 0 || semanticHits >= 1 || (!terms.direct.size && !terms.semantic.size);
  if (!hasAnchor) return null;
  let score = directHits * 3.2 + Math.min(4, semanticHits * 0.75) + Math.min(2, Number(item?.score || 0) / 10);
  if (/\d/.test(sentence)) score += 0.8;
  if (DETAIL_SIGNALS.test(normalized)) score += 0.55;
  if (item?.citation?.kind === "proposal") score += 0.35;
  if (item?.citation?.sourceTier === "tier_1_primary_official") score += 0.2;
  score -= index * 0.02;
  return score;
}

function candidatesForEntity(question, rows) {
  const terms = queryTerms(question);
  const candidates = [];
  for (const { item, sourceNumber } of rows) {
    splitSentences(item.text).forEach((sentence, index) => {
      if (genericMetaSentence(sentence)) return;
      const score = sentenceScore(sentence, item, terms, index);
      if (score === null) return;
      candidates.push({ sentence, sourceNumber, score });
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function uniqueSourceCount(rows) {
  const sources = new Set();
  for (const { item } of rows) {
    const citation = item?.citation || {};
    if (citation.sourceUrl) sources.add(`url:${citation.sourceUrl}`);
    else if (citation.recordId) sources.add(`record:${citation.recordId}`);
    else if (citation.path) sources.add(`path:${citation.path}`);
  }
  return sources.size;
}

export function composeDeepAnswer(question, evidence, options = {}) {
  const base = composeDeterministicAnswer(question, evidence, options);
  const groups = new Map();
  evidence.forEach((item, index) => {
    const entityId = item?.citation?.entityId || item?.citation?.path || `source-${index + 1}`;
    if (!groups.has(entityId)) groups.set(entityId, []);
    groups.get(entityId).push({ item, sourceNumber: index + 1 });
  });

  const cards = base.cards.map((card) => {
    const rows = groups.get(card.entityId) || [];
    const used = [card.summary, ...(card.bullets || [])].filter(Boolean);
    const bullets = [...(card.bullets || [])];
    const sourceNumbers = new Set(card.sourceNumbers || []);

    for (const candidate of candidatesForEntity(question, rows)) {
      if (used.some((text) => similarText(text, candidate.sentence))) continue;
      used.push(candidate.sentence);
      bullets.push(candidate.sentence);
      sourceNumbers.add(candidate.sourceNumber);
      if (bullets.length >= 10) break;
    }

    const sourceCount = uniqueSourceCount(rows);
    return {
      ...card,
      bullets,
      sourceNumbers: [...sourceNumbers].sort((a, b) => a - b),
      sourceCount
    };
  });

  return {
    ...base,
    depth: "deep",
    summary: base.summary,
    cards: cards.slice(0, 12)
  };
}
