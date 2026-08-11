import { fallbackStructuredAnswer } from "./presentation.js";
import { analyzeQuery, normalize } from "./retrieval-v2.js";

function splitSentences(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return [];
  const matches = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text];
  return matches.map((item) => item.trim()).filter((item) => item.length >= 18);
}

function termMatches(normalized, words, term) {
  const candidate = normalize(term);
  if (!candidate) return false;
  if (words.has(candidate)) return true;
  return candidate.length >= 4 && normalized.includes(candidate);
}

function sentenceSignals(sentence, analysis) {
  const normalized = normalize(sentence);
  const words = new Set(normalized.split(/\s+/));
  const directTerms = analysis.subjectTokens || [];
  const directHits = directTerms.filter((term) => termMatches(normalized, words, term));
  if (directHits.length) return { hits: directHits, direct: true };

  // Controlled semantic fallback is used only when the query has no usable direct
  // subject term. This prevents a broad ontology concept from selecting peripheral
  // sentences inside an otherwise relevant document.
  if (!directTerms.length) {
    const conceptTerms = (analysis.concepts || []).flatMap((concept) => concept.retrieval_terms || []);
    const conceptHits = [...new Set(conceptTerms.map(normalize).filter(Boolean))]
      .filter((term) => termMatches(normalized, words, term));
    if (conceptHits.length) return { hits: conceptHits, direct: false };
  }
  return { hits: [], direct: false };
}

function sentenceScore(sentence, signals, evidenceItem) {
  let score = signals.hits.length * (signals.direct ? 3 : 1.5);
  score += Math.min(4, Number(evidenceItem?.score || 0) / 7);
  if (/\d/.test(sentence)) score += 0.2;
  return score;
}

function normalizeComparable(value = "") {
  return normalize(value).replace(/\s+/g, " ");
}

function extractiveRows(question, evidenceRows) {
  const analysis = analyzeQuery(question);
  const rows = [];
  evidenceRows.forEach(({ item, sourceNumber }) => {
    const sentences = splitSentences(item.text);
    sentences.forEach((sentence, index) => {
      const signals = sentenceSignals(sentence, analysis);
      if (!signals.hits.length) return;
      rows.push({
        sentence,
        sourceNumber,
        signals,
        score: sentenceScore(sentence, signals, item) - index * 0.03
      });
    });
  });
  rows.sort((a, b) => b.score - a.score);
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = normalizeComparable(row.sentence);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
    if (unique.length >= 5) break;
  }
  return unique;
}

function modeTitle(mode) {
  if (mode === "comparison") return "Comparaison des positions documentées";
  if (mode === "measures") return "Mesures documentées dans le corpus";
  return "Réponse documentée à partir du corpus";
}

function modeSummary(mode, groupCount, evidenceCount) {
  if (mode === "comparison") {
    return `Le corpus permet de comparer ${groupCount} entité(s) à partir de ${evidenceCount} élément(s) directement documenté(s). Les formulations ci-dessous sont extraites des sources indexées.`;
  }
  return `Le corpus contient ${evidenceCount} élément(s) suffisamment pertinent(s) pour répondre. La synthèse ci-dessous est extractive : elle reprend uniquement des formulations présentes dans les données versionnées.`;
}

export function composeDeterministicAnswer(question, evidence, { mode = "overview", candidates = [] } = {}) {
  if (mode === "candidates") {
    const answer = fallbackStructuredAnswer(question, evidence, { mode, candidates });
    return {
      ...answer,
      note: `${answer.note || ""} Réponse entièrement déterministe, sans génération par LLM.`.trim(),
      followUps: []
    };
  }

  const base = fallbackStructuredAnswer(question, evidence, { mode, candidates });
  const baseByEntity = new Map(base.cards.map((card) => [card.entityId, card]));
  const groups = new Map();
  evidence.forEach((item, index) => {
    const entityId = item.citation?.entityId || item.citation?.path || `source-${index + 1}`;
    if (!groups.has(entityId)) groups.set(entityId, []);
    groups.get(entityId).push({ item, sourceNumber: index + 1 });
  });

  const cards = [];
  for (const [entityId, rows] of groups) {
    const extracted = extractiveRows(question, rows);
    if (!extracted.length) continue;
    const baseCard = baseByEntity.get(entityId) || {
      entityId,
      title: rows[0].item.citation?.entityLabel || rows[0].item.citation?.title || "Élément documenté",
      subtitle: rows[0].item.citation?.section || "Corpus",
      entityType: rows[0].item.citation?.kind === "candidate_status" ? "candidate" : "party"
    };
    const sourceNumbers = [...new Set(extracted.map((row) => row.sourceNumber))].sort((a, b) => a - b);
    cards.push({
      ...baseCard,
      summary: extracted[0].sentence,
      bullets: extracted.slice(1, 5).map((row) => row.sentence),
      sourceNumbers
    });
  }

  return {
    layout: mode,
    title: modeTitle(mode),
    summary: modeSummary(mode, cards.length, evidence.length),
    note: "Réponse entièrement déterministe et extractive : aucune information extérieure au corpus et aucune reformulation générative n’est ajoutée.",
    sections: [],
    cards: cards.slice(0, 10),
    followUps: []
  };
}
