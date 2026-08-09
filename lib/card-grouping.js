import entities from "../data/entities.json" with { type: "json" };

const STATUS_LABELS = {
  official_candidate: "Candidat officiel",
  declared_presidential: "Candidature présidentielle déclarée",
  party_designated: "Désigné par son parti",
  declared_primary: "Candidat à une primaire",
  declared_conditional: "Candidature déclarée sous condition",
  exploratory: "Démarche exploratoire",
  potential: "Candidature potentielle",
  withdrawn: "Candidature retirée",
  not_running: "Ne se présente pas",
  deceased: "Décédé",
  unknown: "Statut inconnu"
};

const STATUS_ORDER = {
  official_candidate: 0,
  declared_presidential: 1,
  party_designated: 2,
  declared_conditional: 3,
  declared_primary: 4,
  exploratory: 5,
  potential: 6,
  withdrawn: 7,
  not_running: 8,
  deceased: 9,
  unknown: 10
};

const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));

function normalizeSpace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizedComparable(value = "") {
  return normalizeSpace(value).toLocaleLowerCase("fr");
}

function sentenceBoundaryAfter(value, start, maxLookAhead = 360) {
  const end = Math.min(value.length, start + maxLookAhead);
  const window = value.slice(start, end);
  const match = /[.!?…](?:["»”')\]]*)?(?=\s|$)/.exec(window);
  return match ? start + match.index + match[0].length : -1;
}

function stripLeadingFragment(value) {
  const text = normalizeSpace(value);
  if (!text || !/^[a-zà-ÿ]/u.test(text)) return text;
  const boundary = sentenceBoundaryAfter(text, 0, 260);
  if (boundary < 0 || boundary >= text.length) return text;
  return text.slice(boundary).trim();
}

export function completeSentenceExcerpt(value, target = 680) {
  let text = stripLeadingFragment(value);
  if (!text || text.length <= target) return text;

  const after = sentenceBoundaryAfter(text, target, 420);
  if (after > target) return text.slice(0, after).trim();

  const before = text.slice(0, target);
  const boundaries = [...before.matchAll(/[.!?…](?:["»”')\]]*)?(?=\s|$)/g)];
  const last = boundaries.at(-1);
  if (last && last.index >= Math.floor(target * 0.6)) {
    return before.slice(0, last.index + last[0].length).trim();
  }

  return text;
}

function looksBroken(value) {
  const text = normalizeSpace(value);
  if (!text) return true;
  return /^[a-zà-ÿ]/u.test(text) || /(?:\.\.\.|…)\s*$/.test(text);
}

function evidenceText(sourceNumbers, evidence) {
  const parts = [];
  for (const number of sourceNumbers || []) {
    const item = evidence?.[Number(number) - 1];
    const text = completeSentenceExcerpt(item?.text || "", 520);
    if (!text) continue;
    const key = normalizedComparable(text);
    if (parts.some((part) => normalizedComparable(part) === key)) continue;
    parts.push(text);
  }
  return completeSentenceExcerpt(parts.join(" "), 900);
}

function repairCard(card, evidence) {
  const sourceNumbers = [...new Set((card.sourceNumbers || []).map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
  let summary = normalizeSpace(card.summary);
  if (looksBroken(summary)) summary = evidenceText(sourceNumbers, evidence) || stripLeadingFragment(summary);

  return {
    ...card,
    summary: completeSentenceExcerpt(summary, 900),
    bullets: [...new Set((card.bullets || []).map(normalizeSpace).filter(Boolean))].slice(0, 8),
    sourceNumbers
  };
}

function candidateRank(candidate) {
  return STATUS_ORDER[candidate?.current_status] ?? 99;
}

function preferredCandidateForParty(partyId) {
  const candidates = entities.candidates
    .filter((candidate) => candidate.primary_party_id === partyId)
    .filter((candidate) => !["withdrawn", "not_running", "deceased"].includes(candidate.current_status))
    .sort((a, b) => candidateRank(a) - candidateRank(b) || a.name.localeCompare(b.name, "fr"));

  if (!candidates.length) return null;
  const bestRank = candidateRank(candidates[0]);
  const best = candidates.filter((candidate) => candidateRank(candidate) === bestRank);
  return best.length === 1 ? best[0] : null;
}

function asCandidateCard(card, candidate) {
  const party = partyById.get(candidate.primary_party_id);
  return {
    ...card,
    entityId: candidate.id,
    entityType: "candidate",
    title: candidate.name,
    subtitle: party?.name || card.partyName || card.subtitle || "",
    candidateStatus: candidate.current_status,
    statusLabel: STATUS_LABELS[candidate.current_status] || candidate.current_status,
    confidence: candidate.status_confidence || card.confidence || "",
    declaredAt: candidate.declared_at || "",
    officialCandidate: candidate.official_candidate === true,
    partyId: candidate.primary_party_id || card.partyId || "",
    partyName: party?.name || card.partyName || ""
  };
}

function mergeDistinctText(first, second) {
  const a = normalizeSpace(first);
  const b = normalizeSpace(second);
  if (!a) return b;
  if (!b) return a;
  const na = normalizedComparable(a);
  const nb = normalizedComparable(b);
  if (na.includes(nb)) return a;
  if (nb.includes(na)) return b;
  return completeSentenceExcerpt(`${a} ${b}`, 1000);
}

function mergeCards(base, incoming) {
  const sourceNumbers = [...new Set([...(base.sourceNumbers || []), ...(incoming.sourceNumbers || [])])].sort((a, b) => a - b);
  const bullets = [...new Set([...(base.bullets || []), ...(incoming.bullets || [])])].slice(0, 8);
  return {
    ...base,
    summary: mergeDistinctText(base.summary, incoming.summary),
    bullets,
    sourceNumbers,
    sourceUrl: sourceNumbers.length > 1 ? "" : (base.sourceUrl || incoming.sourceUrl || "")
  };
}

export function groupPoliticalCards(answer, evidence = []) {
  if (!answer || !Array.isArray(answer.cards) || answer.cards.length < 2) {
    if (!answer || !Array.isArray(answer?.cards)) return answer;
    return { ...answer, cards: answer.cards.map((card) => repairCard(card, evidence)) };
  }

  const repaired = answer.cards.map((card, index) => ({ ...repairCard(card, evidence), __order: index }));
  const candidateCards = new Map();
  const nonPartyCards = [];
  const partyCards = [];

  for (const card of repaired) {
    if (candidateById.has(card.entityId)) {
      const existing = candidateCards.get(card.entityId);
      candidateCards.set(card.entityId, existing ? mergeCards(existing, card) : card);
    } else if (partyById.has(card.entityId)) {
      partyCards.push(card);
    } else {
      nonPartyCards.push(card);
    }
  }

  for (const partyCard of partyCards) {
    const partyId = partyCard.entityId;
    const directCandidateIds = [...candidateCards.keys()].filter((candidateId) => candidateById.get(candidateId)?.primary_party_id === partyId);
    let targets = directCandidateIds;

    if (!targets.length) {
      const preferred = preferredCandidateForParty(partyId);
      if (preferred) targets = [preferred.id];
    }

    if (!targets.length) {
      nonPartyCards.push(partyCard);
      continue;
    }

    for (const candidateId of targets) {
      const candidate = candidateById.get(candidateId);
      const existing = candidateCards.get(candidateId);
      const candidatePartyCard = asCandidateCard(partyCard, candidate);
      candidateCards.set(candidateId, existing ? mergeCards(existing, candidatePartyCard) : candidatePartyCard);
    }
  }

  const cards = [...candidateCards.values(), ...nonPartyCards]
    .map((card) => {
      const { __order, ...clean } = card;
      return { ...clean, __order: __order ?? Math.min(...(clean.sourceNumbers || [999])) };
    })
    .sort((a, b) => a.__order - b.__order || Math.min(...(a.sourceNumbers || [999])) - Math.min(...(b.sourceNumbers || [999])))
    .slice(0, 10)
    .map(({ __order, ...card }) => card);

  return { ...answer, cards };
}
