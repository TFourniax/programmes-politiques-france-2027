import entities from "../data/entities.json" with { type: "json" };

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";

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
  declared_presidential: 1,
  party_designated: 2,
  declared_conditional: 3,
  declared_primary: 4,
  exploratory: 5,
  potential: 6,
  withdrawn: 7,
  not_running: 8,
  deceased: 9,
  unknown: 10,
  official_candidate: 0
};

const PARTY_COLORS = {
  "la-france-insoumise": "#d7264f",
  "place-publique": "#f45b69",
  "parti-socialiste": "#e64980",
  pcf: "#e30613",
  "les-ecologistes": "#23a55a",
  "generation-ecologie": "#62b55a",
  "lutte-ouvriere": "#d71920",
  "revolution-permanente": "#d50000",
  renaissance: "#f4c542",
  horizons: "#27a9d8",
  "les-republicains": "#2d6fbd",
  "nouvelle-energie": "#4b7bec",
  "rassemblement-national": "#174a7e",
  reconquete: "#334a69",
  "debout-la-france": "#476f9f",
  "les-patriotes": "#2f6cac",
  upr: "#705aa8",
  "solution-democratique": "#768195",
  equinoxe: "#64b88a",
  "la-convention": "#7a67c7",
  "france-humaniste": "#9a735d",
  debout: "#e48b3d"
};

const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));

function norm(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function historyText(history = []) {
  return history
    .filter((item) => item?.role === "user")
    .slice(-2)
    .map((item) => String(item.content || "").trim())
    .filter(Boolean)
    .join(" ");
}

export function resolveRetrievalQuery(question, history = []) {
  const q = norm(question);
  const shortFollowUp = q.split(/\s+/).filter(Boolean).length <= 7 || /^(et|eux|elles|lui|elle|celui|celle|sinon|quid|meme question)/.test(q);
  const previous = historyText(history);
  return shortFollowUp && previous ? `${previous}. Question de suivi: ${question}` : question;
}

export function classifyQuestion(question) {
  const q = norm(question);
  const asksCandidateList =
    /(?:qui|quels|quelles|liste|combien).{0,35}(?:candidat|candidature)/.test(q) ||
    /(?:candidat|candidature).{0,35}(?:declare|officiel|potentiel|primaire|investi|designe|retire|renonce)/.test(q);
  if (asksCandidateList) return "candidates";
  if (/compare|comparaison|difference|oppos|versus| vs /.test(` ${q} `)) return "comparison";
  if (/proposition|mesure|programme|propose|prevoit|engagement|retraite|fiscal|impot|immigration|europe|travail|smic|ecologie/.test(q)) return "measures";
  return "overview";
}

function requestedCandidateStatuses(question) {
  const q = norm(question);
  if (/officiel/.test(q)) return { statuses: ["official_candidate"], officialOnly: true, label: "candidats officiels" };
  if (/retire|renonce|ne se presente pas/.test(q)) return { statuses: ["withdrawn", "not_running"], label: "candidatures retirées ou abandonnées" };
  if (/primaire/.test(q)) return { statuses: ["declared_primary"], label: "candidatures à une primaire" };
  if (/potentiel|probable|possible/.test(q)) return { statuses: ["potential", "exploratory"], label: "candidatures potentielles ou exploratoires" };
  if (/condition/.test(q)) return { statuses: ["declared_conditional"], label: "candidatures conditionnelles" };
  if (/investi|designe/.test(q)) return { statuses: ["party_designated"], label: "candidats désignés par leur parti" };
  if (/declare/.test(q)) return { statuses: ["declared_presidential", "party_designated", "declared_conditional"], label: "candidatures présidentielles déclarées" };
  return {
    statuses: ["declared_presidential", "party_designated", "declared_conditional", "declared_primary", "exploratory", "potential"],
    label: "personnalités actuellement en course ou suivies comme candidates potentielles"
  };
}

export function selectCandidates(question) {
  if (classifyQuestion(question) !== "candidates") return [];
  const request = requestedCandidateStatuses(question);
  const selected = entities.candidates.filter((candidate) => {
    if (request.officialOnly) return candidate.official_candidate === true;
    return request.statuses.includes(candidate.current_status);
  });
  return selected.sort((a, b) => {
    const status = (STATUS_ORDER[a.current_status] ?? 99) - (STATUS_ORDER[b.current_status] ?? 99);
    return status || a.name.localeCompare(b.name, "fr");
  });
}

function partyInfo(partyId) {
  const party = partyId ? partyById.get(partyId) : null;
  return {
    partyId: partyId || "",
    partyName: party?.name || "Sans parti principal enregistré",
    partyColor: PARTY_COLORS[partyId] || "#748196"
  };
}

export function candidateEvidence(candidate) {
  const party = partyInfo(candidate.primary_party_id);
  return {
    score: 100,
    text: `${candidate.name}. Statut au ${candidate.status_as_of || entities.snapshot_date}: ${STATUS_LABELS[candidate.current_status] || candidate.current_status}. Parti ou mouvement principal enregistré: ${party.partyName}. Niveau de confiance de la preuve: ${candidate.status_confidence}. ${candidate.declared_at ? `Date de déclaration enregistrée: ${candidate.declared_at}.` : ""} Candidat officiel au sens du Conseil constitutionnel: ${candidate.official_candidate ? "oui" : "non"}.`,
    citation: {
      title: `Statut de ${candidate.name}`,
      entityId: candidate.id,
      entityLabel: candidate.name,
      kind: "candidate_status",
      path: "data/entities.json",
      sourceUrl: candidate.source_url || null,
      sourceTier: candidate.source_tier || null,
      documentStatus: "current",
      candidateStatus: candidate.current_status,
      publishedAt: candidate.declared_at || candidate.status_as_of || entities.snapshot_date,
      confidence: candidate.status_confidence || null,
      certainty: null,
      section: "Statut",
      githubUrl: `${REPO}/blob/main/data/entities.json`,
      ...party
    }
  };
}

function entityDecoration(entityId) {
  const candidate = candidateById.get(entityId);
  if (candidate) {
    return {
      entityType: "candidate",
      candidateStatus: candidate.current_status,
      statusLabel: STATUS_LABELS[candidate.current_status] || candidate.current_status,
      confidence: candidate.status_confidence || "",
      declaredAt: candidate.declared_at || "",
      officialCandidate: candidate.official_candidate === true,
      sourceUrl: candidate.source_url || "",
      ...partyInfo(candidate.primary_party_id)
    };
  }
  const party = partyById.get(entityId);
  if (party) {
    return {
      entityType: "party",
      candidateStatus: "",
      statusLabel: "Parti ou mouvement",
      confidence: "",
      declaredAt: "",
      officialCandidate: false,
      sourceUrl: party.official_website || party.official_url || "",
      ...partyInfo(party.id)
    };
  }
  return {
    entityType: "topic",
    candidateStatus: "",
    statusLabel: "",
    confidence: "",
    declaredAt: "",
    officialCandidate: false,
    sourceUrl: "",
    partyId: "",
    partyName: "",
    partyColor: "#748196"
  };
}

function validSources(values, total) {
  return [...new Set((Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= total))];
}

function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function deterministicCandidateCard(candidate, evidence) {
  const party = partyInfo(candidate.primary_party_id);
  const sourceNumber = evidence.findIndex((item) => item.citation?.entityId === candidate.id && item.citation?.kind === "candidate_status") + 1;
  return {
    entityId: candidate.id,
    entityType: "candidate",
    title: candidate.name,
    subtitle: party.partyName,
    summary: `Statut enregistré au ${candidate.status_as_of || entities.snapshot_date} : ${STATUS_LABELS[candidate.current_status] || candidate.current_status}.`,
    bullets: [
      candidate.declared_at ? `Déclaration enregistrée : ${candidate.declared_at}` : "Date de déclaration non renseignée dans le registre",
      `Niveau de preuve du statut : ${candidate.status_confidence || "non renseigné"}`
    ],
    sourceNumbers: sourceNumber > 0 ? [sourceNumber] : [],
    candidateStatus: candidate.current_status,
    statusLabel: STATUS_LABELS[candidate.current_status] || candidate.current_status,
    confidence: candidate.status_confidence || "",
    declaredAt: candidate.declared_at || "",
    officialCandidate: candidate.official_candidate === true,
    sourceUrl: candidate.source_url || "",
    ...party
  };
}

export function fallbackStructuredAnswer(question, evidence, { mode = classifyQuestion(question), candidates = [] } = {}) {
  if (mode === "candidates") {
    const request = requestedCandidateStatuses(question);
    return {
      layout: "candidates",
      title: candidates.length ? `${candidates.length} ${request.label}` : `Aucun élément trouvé pour les ${request.label}`,
      summary: candidates.length
        ? `Voici les statuts enregistrés dans le snapshot du ${entities.snapshot_date}. Les catégories sont conservées telles quelles : déclaré, désigné, conditionnel, primaire, potentiel et candidat officiel ne sont pas synonymes.`
        : `Le registre ne contient actuellement aucun profil correspondant exactement à cette catégorie.`,
      note: "Le statut « candidat officiel » reste réservé à la liste publiée par le Conseil constitutionnel.",
      sections: [],
      cards: candidates.map((candidate) => deterministicCandidateCard(candidate, evidence)),
      followUps: [
        "Quels candidats ont déjà des propositions documentées dans le corpus ?",
        "Compare les positions documentées sur les retraites.",
        "Quels statuts de candidature sont encore incertains ?"
      ]
    };
  }

  const grouped = [];
  const seen = new Set();
  evidence.forEach((item, index) => {
    const key = item.citation?.entityId || item.citation?.path || String(index);
    if (seen.has(key)) return;
    seen.add(key);
    const decoration = entityDecoration(item.citation?.entityId);
    grouped.push({
      entityId: item.citation?.entityId || "",
      title: item.citation?.entityLabel || item.citation?.title || "Élément documenté",
      subtitle: item.citation?.section || item.citation?.kind || "Corpus",
      summary: item.text.length > 260 ? `${item.text.slice(0, 257)}…` : item.text,
      bullets: [],
      sourceNumbers: [index + 1],
      ...decoration
    });
  });

  return {
    layout: mode,
    title: "Éléments documentés dans le corpus",
    summary: `Voici les passages les plus pertinents trouvés pour « ${question} ». La réponse ci-dessous reste limitée aux informations versionnées dans le dépôt.`,
    note: "Aucune information extérieure au dépôt n’a été utilisée.",
    sections: [],
    cards: grouped.slice(0, 8),
    followUps: [
      "Quelles sources primaires soutiennent ces éléments ?",
      "Compare les positions documentées sur ce sujet.",
      "Quelles informations manquent encore dans le corpus sur ce thème ?"
    ]
  };
}

export function hydrateStructuredAnswer(raw, question, evidence, { mode = classifyQuestion(question), candidates = [] } = {}) {
  const fallback = fallbackStructuredAnswer(question, evidence, { mode, candidates });
  if (!raw || typeof raw !== "object") return fallback;
  const total = evidence.length;
  const allowedEntities = new Set(evidence.map((item) => item.citation?.entityId).filter(Boolean));

  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((section) => ({
      title: cleanText(section?.title),
      text: cleanText(section?.text),
      bullets: (Array.isArray(section?.bullets) ? section.bullets : []).map((item) => cleanText(item)).filter(Boolean).slice(0, 6),
      sourceNumbers: validSources(section?.sourceNumbers, total)
    }))
    .filter((section) => section.title || section.text || section.bullets.length)
    .slice(0, 5);

  let cards;
  if (mode === "candidates") {
    cards = candidates.map((candidate) => deterministicCandidateCard(candidate, evidence));
  } else {
    cards = (Array.isArray(raw.cards) ? raw.cards : [])
      .map((card) => {
        const entityId = cleanText(card?.entityId);
        const sourceNumbers = validSources(card?.sourceNumbers, total);
        if (!sourceNumbers.length) return null;
        if (entityId && !allowedEntities.has(entityId)) return null;
        return {
          entityId,
          title: cleanText(card?.title, "Élément documenté"),
          subtitle: cleanText(card?.subtitle),
          summary: cleanText(card?.summary),
          bullets: (Array.isArray(card?.bullets) ? card.bullets : []).map((item) => cleanText(item)).filter(Boolean).slice(0, 6),
          sourceNumbers,
          ...entityDecoration(entityId)
        };
      })
      .filter(Boolean)
      .slice(0, 10);
    if (!cards.length) cards = fallback.cards;
  }

  return {
    layout: ["candidates", "comparison", "measures", "overview"].includes(raw.layout) ? raw.layout : mode,
    title: cleanText(raw.title, fallback.title),
    summary: cleanText(raw.summary, fallback.summary),
    note: cleanText(raw.note, fallback.note),
    sections,
    cards,
    followUps: (Array.isArray(raw.followUps) ? raw.followUps : fallback.followUps)
      .map((item) => cleanText(item))
      .filter(Boolean)
      .slice(0, 4)
  };
}

export function candidateStatusLabel(status) {
  return STATUS_LABELS[status] || status || "Statut non renseigné";
}
