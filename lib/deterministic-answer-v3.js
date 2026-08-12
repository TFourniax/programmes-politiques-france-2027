import { fallbackStructuredAnswer } from "./presentation.js";
import { analyzeQuery, normalize } from "./retrieval-v2.js";

function splitSentences(value = "") {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text) return [];
  const matches = text.match(/[^.!?…]+(?:[.!?…]+|$)/g) || [text];
  return matches.map((item) => item.trim()).filter((item) => item.length >= 12);
}

function termMatches(text, words, term) {
  const candidate = normalize(term);
  if (!candidate) return false;
  if (words.has(candidate)) return true;
  return candidate.length >= 4 && text.includes(candidate);
}

function genericMetaSentence(value = "") {
  const text = normalize(value);
  return /^proposition explicitement documentee/.test(text)
    || /^attribution(?: et preuve)?$/.test(text)
    || /^extrait de preuve/.test(text)
    || /^tracabilite$/.test(text)
    || /^limite(?: d attribution)?$/.test(text)
    || /^cette entree est attribuee/.test(text)
    || /^la formulation reste limitee/.test(text)
    || /^promotion automatique/.test(text)
    || /source primaire officielle attribuee/.test(text)
    || /n est pas automatiquement transform/.test(text)
    || /ne constitue pas a lui seul un programme presidentiel personnel/.test(text)
    || /^la source (consultee|presente)/.test(text);
}

const HEADING_WORDS = new Set([
  "agriculture","climat","defense","ecologie","economie","education","energie","epargne","etat","finances",
  "immigration","industrie","justice","logement","numerique","retraite","retraites","salaire","salaires","sante",
  "securite","services","travail"
]);
const VERBISH = /\b(abroge|ajoute|augmente|complete|confirme|cree|defend|fixe|introduit|permet|porte|prevoit|propose|reduire|remplace|supprime|vise|veut)\b/;
function sectionHeading(sentence, item) {
  const sentenceKey = normalize(sentence);
  const sectionKey = normalize(item?.citation?.section || "");
  if (sectionKey && sentenceKey === sectionKey) return true;
  if (item?.citation?.kind !== "document") return false;
  const parts = sentenceKey.split(/\s+/).filter(Boolean);
  if (!parts.length || parts.length > 6 || /\d/.test(sentenceKey) || VERBISH.test(sentenceKey)) return false;
  const meaningful = parts.filter((part) => !["et","de","des","du","la","le","les"].includes(part));
  if (!meaningful.length) return false;
  return meaningful.every((part) => HEADING_WORDS.has(part));
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
  return conceptHits.length >= 2 ? { hits: conceptHits, direct: false } : { hits: [], direct: false };
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
    if (genericMetaSentence(sentence) || sectionHeading(sentence, item)) return;
    const signals = signalsForSentence(sentence, analysis, item, false);
    if (!signals.hits.length) return;
    direct.push({ sentence, sourceNumber, signals, score: sentenceScore(sentence, signals, item, index) });
  });
  if (direct.length) return direct;

  const semantic = [];
  sentences.forEach((sentence, index) => {
    if (genericMetaSentence(sentence) || sectionHeading(sentence, item)) return;
    const signals = signalsForSentence(sentence, analysis, item, true);
    if (!signals.hits.length) return;
    semantic.push({ sentence, sourceNumber, signals, score: sentenceScore(sentence, signals, item, index) });
  });
  return semantic;
}

const SIMILARITY_STOP = new Set(["le","la","les","un","une","des","de","du","et","ou","pour","par","dans","sur","avec","son","sa","ses","leur","leurs","est","sont","propose","proposent","prevoit","defend"]);
function semanticTerms(value) {
  return new Set(normalize(value).split(/\s+/).filter((term) => term.length >= 3 && !SIMILARITY_STOP.has(term)));
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
  const union = new Set([...sa, ...sb]).size;
  return union > 0 && intersection / union >= 0.68;
}

function extractiveRows(question, evidenceRows) {
  const rows = evidenceRows.flatMap(({ item, sourceNumber }) => rowsForEvidence(question, item, sourceNumber));
  rows.sort((a, b) => b.score - a.score);
  const unique = [];
  for (const row of rows) {
    if (unique.some((item) => similarText(item.sentence, row.sentence))) continue;
    unique.push(row);
    if (unique.length >= 6) break;
  }
  return unique;
}

function proposalRows(rows) {
  return rows.filter((row) => row.item?.citation?.kind === "proposal");
}
function proposalTitles(rows) {
  return [...new Set(proposalRows(rows).map((row) => String(row.item?.citation?.title || "").trim()).filter(Boolean))];
}
function proposalSourceNumbers(rows) {
  return [...new Set(proposalRows(rows).map((row) => row.sourceNumber))].sort((a, b) => a - b);
}

function cleanSubtitle(baseSubtitle, titles) {
  if (titles.length === 1) return titles[0];
  if (titles.length > 1) return `${titles.length} mesures documentées`;
  if (/^(attribution(?: et preuve)?|tracabilité|limite(?: d'attribution)?)$/i.test(String(baseSubtitle || "").trim())) return "Corpus documenté";
  return baseSubtitle || "Corpus documenté";
}

function modeTitle(mode) {
  if (mode === "comparison") return "Comparaison des positions documentées";
  if (mode === "measures") return "Mesures documentées dans le corpus";
  return "Réponse documentée à partir du corpus";
}

function modeSummary(mode, groupCount, evidenceCount) {
  const evidenceWord = evidenceCount === 1 ? "élément" : "éléments";
  const entityWord = groupCount === 1 ? "entité" : "entités";
  if (mode === "comparison") {
    return `Le corpus permet de comparer ${groupCount} ${entityWord} à partir de ${evidenceCount} ${evidenceWord} directement sourcé${evidenceCount === 1 ? "" : "s"}.`;
  }
  return `Le corpus contient ${evidenceCount} ${evidenceWord} directement pertinent${evidenceCount === 1 ? "" : "s"} pour cette question. La réponse ci-dessous ne reprend que ce qui est explicitement sourcé.`;
}

function missingCoverageSection(requestedEntities, evidence) {
  const seen = new Set(evidence.map((item) => item.citation?.entityId).filter(Boolean));
  const missing = (requestedEntities || []).filter((entity) => !seen.has(entity.id));
  if (!missing.length) return [];
  const names = missing.map((entity) => entity.name).join(", ");
  return [{
    title: "Couverture du corpus",
    text: `Aucun élément suffisamment pertinent n’a été retrouvé pour ${names} sur le sujet demandé. Cette absence dans le corpus ne permet pas de conclure à une absence de position politique.`,
    bullets: [],
    sourceNumbers: []
  }];
}

function targetedCandidateAnswer(question, evidence, candidates, base) {
  const title = candidates.length === 1 ? `Statut de ${candidates[0].name}` : "Statuts des personnalités demandées";
  const cards = base.cards.map((card) => {
    const officialText = `Candidat officiel au sens du Conseil constitutionnel : ${card.officialCandidate ? "oui" : "non"}.`;
    const bullets = [officialText, ...(card.bullets || [])].filter((item, index, array) => array.indexOf(item) === index);
    return { ...card, bullets: bullets.slice(0, 5) };
  });
  return {
    ...base,
    title,
    summary: `Le registre affiche le statut actuellement documenté pour ${candidates.map((item) => item.name).join(", ")}. Le statut « candidat officiel » reste distinct des candidatures déclarées, désignées, conditionnelles, primaires ou potentielles.`,
    cards,
    followUps: base.followUps || []
  };
}

export function composeDeterministicAnswer(question, evidence, { mode = "overview", candidates = [], requestedEntities = [], candidateTargeted = false } = {}) {
  if (mode === "candidates") {
    const base = fallbackStructuredAnswer(question, evidence, { mode, candidates });
    if (candidateTargeted && candidates.length) return targetedCandidateAnswer(question, evidence, candidates, base);
    return {
      ...base,
      note: [base.note, "Réponse limitée aux éléments sourcés du corpus ; aucune position n’est inventée ou déduite d’un silence."].filter(Boolean).join(" ")
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
    const titles = proposalTitles(rows);
    if (!extracted.length && !titles.length) continue;
    const baseCard = baseByEntity.get(entityId) || {
      entityId,
      title: rows[0].item.citation?.entityLabel || rows[0].item.citation?.title || "Élément documenté",
      subtitle: rows[0].item.citation?.section || "Corpus",
      entityType: rows[0].item.citation?.kind === "candidate_status" ? "candidate" : "party"
    };

    const first = extracted[0]?.sentence || "";
    const summary = first || titles[0] || "Élément documenté dans le corpus.";
    const bullets = [];
    for (const row of extracted.slice(1)) {
      if (genericMetaSentence(row.sentence) || similarText(summary, row.sentence) || bullets.some((item) => similarText(item, row.sentence))) continue;
      bullets.push(row.sentence);
      if (bullets.length >= 4) break;
    }
    if (!first && titles.length > 1) {
      for (const title of titles.slice(1)) {
        if (!bullets.some((item) => similarText(item, title))) bullets.push(title);
        if (bullets.length >= 4) break;
      }
    }

    const extractedSources = [...new Set(extracted.map((row) => row.sourceNumber))];
    const sourceNumbers = [...new Set([...extractedSources, ...proposalSourceNumbers(rows)])].sort((a, b) => a - b);
    cards.push({
      ...baseCard,
      subtitle: cleanSubtitle(baseCard.subtitle, titles),
      summary,
      bullets,
      sourceNumbers
    });
  }

  const sections = missingCoverageSection(requestedEntities, evidence);
  return {
    layout: mode,
    title: modeTitle(mode),
    summary: modeSummary(mode, cards.length, evidence.length),
    note: "Réponse limitée aux éléments sourcés du corpus ; aucune position n’est inventée ou déduite d’un silence.",
    sections,
    cards: cards.slice(0, 10),
    followUps: []
  };
}
