import { fallbackStructuredAnswer } from "./presentation.js";
import { analyzeQuery, normalize } from "./retrieval-v2.js";

function splitSentences(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return [];
  const matches = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text];
  return matches.map((item) => item.trim()).filter((item) => item.length >= 18);
}

function termMatches(text, words, term) {
  const candidate = normalize(term);
  if (!candidate) return false;
  if (words.has(candidate)) return true;
  return candidate.length >= 4 && text.includes(candidate);
}

function signalsForSentence(sentence, analysis, item, semanticFallback) {
  const text = normalize(sentence);
  const words = new Set(text.split(/\s+/));
  const directHits = (analysis.subjectTokens || []).filter((term) => termMatches(text, words, term));
  if (directHits.length) return { hits: directHits, direct: true };
  if (!semanticFallback) return { hits: [], direct: false };

  const localTerms = (item?.match?.concepts || []).flatMap((concept) => concept.terms || []);
  const conceptHits = [...new Set(localTerms.map(normalize).filter(Boolean))]
    .filter((term) => termMatches(text, words, term));
  return conceptHits.length ? { hits: conceptHits, direct: false } : { hits: [], direct: false };
}

function sentenceScore(sentence, signals, item, index) {
  let score = signals.hits.length * (signals.direct ? 3 : 1.6);
  score += Math.min(4, Number(item?.score || 0) / 7);
  if (/\d/.test(sentence)) score += 0.2;
  return score - index * 0.03;
}

function rowsForEvidence(question, item, sourceNumber) {
  const analysis = analyzeQuery(question);
  const sentences = splitSentences(item.text);
  const direct = [];
  sentences.forEach((sentence, index) => {
    const signals = signalsForSentence(sentence, analysis, item, false);
    if (!signals.hits.length) return;
    direct.push({ sentence, sourceNumber, signals, score: sentenceScore(sentence, signals, item, index) });
  });
  if (direct.length) return direct;

  const semantic = [];
  sentences.forEach((sentence, index) => {
    const signals = signalsForSentence(sentence, analysis, item, true);
    if (!signals.hits.length) return;
    semantic.push({ sentence, sourceNumber, signals, score: sentenceScore(sentence, signals, item, index) });
  });
  return semantic;
}

function extractiveRows(question, evidenceRows) {
  const rows = evidenceRows.flatMap(({ item, sourceNumber }) => rowsForEvidence(question, item, sourceNumber));
  rows.sort((a, b) => b.score - a.score);
  const unique = [];
  const seen = new Set();
  for (const row of rows) {
    const key = normalize(row.sentence);
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
