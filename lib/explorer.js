import searchIndex from "../data/search-index.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import compass from "../data/compass.json" with { type: "json" };

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

const STOP = new Set(["a","au","aux","avec","ce","ces","dans","de","des","du","elle","en","et","eux","il","la","le","les","leur","lui","mais","meme","ne","nos","notre","nous","on","ou","par","pas","pour","qu","que","qui","sa","se","ses","son","sur","un","une","vos","votre","vous","quel","quelle","quels","quelles","doit","doivent","politique"]);
const CURRENT_DOCUMENT_STATUSES = new Set(["current", "amended", "draft", "unknown"]);
const NON_SELECTABLE_STATUSES = new Set(["withdrawn", "not_running", "deceased"]);

const candidateById = new Map(entities.candidates.map((item) => [item.id, item]));
const partyById = new Map(entities.parties.map((item) => [item.id, item]));
const topicById = new Map(compass.questions.map((item) => [item.id, item]));

function norm(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value = "") {
  return [...new Set(norm(value).split(/\s+/).filter((item) => item.length > 2 && !STOP.has(item)))];
}

function topicTerms(topic) {
  return tokens([topic.label, topic.description, topic.query].filter(Boolean).join(" "));
}

function topicRelevance(chunk, topic) {
  if (!topic) return 0;
  const terms = topicTerms(topic);
  const title = norm(chunk.title);
  const section = norm(chunk.section || "");
  const topics = norm((chunk.topics || []).join(" "));
  const text = norm(chunk.text);
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += 1;
    if (topics.includes(term)) score += 2.5;
    if (section.includes(term)) score += 2;
    if (title.includes(term)) score += 2.5;
  }
  return score;
}

function partyDecoration(partyId) {
  const party = partyId ? partyById.get(partyId) : null;
  return {
    partyId: partyId || null,
    partyName: party?.name || null,
    partyColor: PARTY_COLORS[partyId] || "#748196",
    partyUrl: party?.official_website || party?.official_url || null
  };
}

function decorateCandidate(candidate) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    currentStatus: candidate.current_status,
    statusLabel: STATUS_LABELS[candidate.current_status] || candidate.current_status,
    statusAsOf: candidate.status_as_of || entities.snapshot_date,
    statusConfidence: candidate.status_confidence || null,
    officialCandidate: candidate.official_candidate === true,
    declaredAt: candidate.declared_at || null,
    sourceUrl: candidate.source_url || null,
    sourceTier: candidate.source_tier || null,
    selectable: !NON_SELECTABLE_STATUSES.has(candidate.current_status),
    ...partyDecoration(candidate.primary_party_id)
  };
}

function excerpt(value = "", max = 320) {
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}…`;
}

function evidenceFromChunk(chunk, relevance = null) {
  return {
    id: chunk.id,
    entityId: chunk.entityId,
    entityLabel: chunk.entityLabel,
    kind: chunk.kind,
    title: chunk.title,
    excerpt: excerpt(chunk.text),
    path: chunk.path,
    sourceUrl: chunk.sourceUrl || null,
    sourceTier: chunk.sourceTier || null,
    documentStatus: chunk.documentStatus || "unknown",
    candidateStatus: chunk.candidateStatus || null,
    publishedAt: chunk.publishedAt || null,
    confidence: chunk.confidence || null,
    certainty: chunk.certainty || null,
    section: chunk.section || null,
    relevance: relevance === null ? null : Number(relevance.toFixed(2)),
    githubUrl: `${REPO}/blob/main/${chunk.path}`
  };
}

function uniquePaths(scoredChunks, limit = Infinity) {
  const seen = new Set();
  const output = [];
  for (const item of scoredChunks) {
    if (seen.has(item.chunk.path)) continue;
    seen.add(item.chunk.path);
    output.push(evidenceFromChunk(item.chunk, item.score));
    if (output.length >= limit) break;
  }
  return output;
}

function policyChunks(entityId, { currentOnly = false } = {}) {
  return searchIndex.chunks.filter((chunk) => {
    if (chunk.entityId !== entityId) return false;
    if (!["document", "proposal"].includes(chunk.kind)) return false;
    if (currentOnly && !CURRENT_DOCUMENT_STATUSES.has(chunk.documentStatus || "unknown")) return false;
    return true;
  });
}

function topicEvidence(entityId, topic, { currentOnly = true, limit = 4 } = {}) {
  const scored = policyChunks(entityId, { currentOnly })
    .map((chunk) => ({ chunk, score: topicRelevance(chunk, topic) }))
    .filter((item) => item.score >= 1.5)
    .sort((a, b) => b.score - a.score || String(b.chunk.publishedAt || "").localeCompare(String(a.chunk.publishedAt || "")));
  return uniquePaths(scored, limit);
}

function coverage(candidate, topic) {
  const direct = topicEvidence(candidate.id, topic, { currentOnly: true, limit: 4 });
  const party = candidate.primary_party_id ? topicEvidence(candidate.primary_party_id, topic, { currentOnly: true, limit: 4 }) : [];
  let level = "none";
  if (direct.length >= 2) level = "documented";
  else if (direct.length === 1) level = "partial";
  else if (party.length) level = "party_only";
  return {
    topicId: topic.id,
    topicLabel: topic.label,
    level,
    directSourceCount: direct.length,
    partySourceCount: party.length,
    directEvidence: direct,
    partyContext: party,
    note: level === "party_only"
      ? "Des éléments existent pour le parti principal, mais ils ne sont pas attribués automatiquement à cette personnalité."
      : level === "none"
        ? "Aucun élément directement rattaché à cette personnalité n’a été trouvé sur ce thème dans le corpus actuel."
        : null
  };
}

function documentList(entityId) {
  const scored = policyChunks(entityId, { currentOnly: false })
    .map((chunk) => ({ chunk, score: 0 }))
    .sort((a, b) => String(b.chunk.publishedAt || "").localeCompare(String(a.chunk.publishedAt || "")));
  return uniquePaths(scored);
}

function timelineForCandidate(candidate) {
  const events = documentList(candidate.id).map((item) => ({
    type: item.kind,
    date: item.publishedAt,
    title: item.title,
    documentStatus: item.documentStatus,
    sourceTier: item.sourceTier,
    githubUrl: item.githubUrl,
    sourceUrl: item.sourceUrl,
    excerpt: item.excerpt
  }));
  events.push({
    type: "candidate_status",
    date: candidate.status_as_of || entities.snapshot_date,
    title: STATUS_LABELS[candidate.current_status] || candidate.current_status,
    documentStatus: "current",
    sourceTier: candidate.source_tier || null,
    sourceUrl: candidate.source_url || null,
    githubUrl: `${REPO}/blob/main/data/entities.json`,
    excerpt: `Statut enregistré pour ${candidate.name} au ${candidate.status_as_of || entities.snapshot_date}.`
  });
  return events.sort((a, b) => String(b.date || "0000-00-00").localeCompare(String(a.date || "0000-00-00")) || a.title.localeCompare(b.title, "fr"));
}

function coverageSummary(items) {
  return items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, { documented: 0, partial: 0, party_only: 0, none: 0 });
}

export function getExplorerMeta() {
  return {
    snapshotDate: entities.snapshot_date,
    notice: entities.notice,
    topics: compass.questions.map((topic) => ({
      id: topic.id,
      label: topic.label,
      description: topic.description,
      exploreQuestion: topic.exploreQuestion
    })),
    candidates: entities.candidates.map(decorateCandidate).sort((a, b) => a.name.localeCompare(b.name, "fr")),
    counts: searchIndex.counts
  };
}

export function buildCandidateProfile(candidateId) {
  const candidate = candidateById.get(candidateId);
  if (!candidate) throw new Error("Candidat inconnu");
  const coverageItems = compass.questions.map((topic) => coverage(candidate, topic));
  const partyDocs = candidate.primary_party_id ? documentList(candidate.primary_party_id) : [];
  return {
    snapshotDate: entities.snapshot_date,
    candidate: decorateCandidate(candidate),
    coverage: coverageItems,
    coverageSummary: coverageSummary(coverageItems),
    directDocuments: documentList(candidate.id),
    partyContextDocuments: partyDocs,
    timeline: timelineForCandidate(candidate),
    neutralityNote: "Les documents du parti sont présentés séparément. Ils ne sont jamais comptés comme des positions personnelles du candidat sans source qui les lui attribue directement."
  };
}

export function buildComparison(candidateIds, topicIds) {
  const ids = [...new Set(candidateIds)].filter((id) => candidateById.has(id)).slice(0, 4);
  if (ids.length < 2) throw new Error("Sélectionnez entre 2 et 4 candidats");
  const selectedTopics = [...new Set(topicIds)].map((id) => topicById.get(id)).filter(Boolean).slice(0, 6);
  const topics = selectedTopics.length ? selectedTopics : compass.questions.slice(0, 4);
  const rows = ids.map((id) => {
    const candidate = candidateById.get(id);
    return {
      candidate: decorateCandidate(candidate),
      cells: topics.map((topic) => coverage(candidate, topic))
    };
  });
  const signals = topics.map((topic, topicIndex) => {
    const direct = [];
    const partyOnly = [];
    const missing = [];
    for (const row of rows) {
      const cell = row.cells[topicIndex];
      if (["documented", "partial"].includes(cell.level)) direct.push(row.candidate.name);
      else if (cell.level === "party_only") partyOnly.push(row.candidate.name);
      else missing.push(row.candidate.name);
    }
    return {
      topicId: topic.id,
      topicLabel: topic.label,
      direct,
      partyOnly,
      missing,
      completeForSelection: missing.length === 0 && partyOnly.length === 0
    };
  });
  return {
    snapshotDate: entities.snapshot_date,
    topics: topics.map((topic) => ({ id: topic.id, label: topic.label, description: topic.description })),
    rows,
    signals,
    neutralityNote: "La comparaison porte sur la documentation disponible, pas sur une note politique. Une case vide signifie « non documenté ici », pas « opposé ». Les plateformes de parti restent séparées des positions personnelles."
  };
}

export function buildTopicExplorer(topicId) {
  const topic = topicById.get(topicId);
  if (!topic) throw new Error("Thème inconnu");
  const candidates = entities.candidates.map((candidate) => ({
    candidate: decorateCandidate(candidate),
    coverage: coverage(candidate, topic)
  })).sort((a, b) => {
    const rank = { documented: 0, partial: 1, party_only: 2, none: 3 };
    return rank[a.coverage.level] - rank[b.coverage.level] || a.candidate.name.localeCompare(b.candidate.name, "fr");
  });
  const parties = entities.parties.map((party) => ({
    party: { id: party.id, name: party.name, officialWebsite: party.official_website || null, color: PARTY_COLORS[party.id] || "#748196" },
    evidence: topicEvidence(party.id, topic, { currentOnly: true, limit: 4 })
  })).filter((item) => item.evidence.length).sort((a, b) => b.evidence.length - a.evidence.length || a.party.name.localeCompare(b.party.name, "fr"));
  return {
    snapshotDate: entities.snapshot_date,
    topic: { id: topic.id, label: topic.label, description: topic.description, exploreQuestion: topic.exploreQuestion },
    candidates,
    parties,
    summary: coverageSummary(candidates.map((item) => item.coverage)),
    neutralityNote: "Les personnalités sont classées uniquement selon la présence de sources dans le corpus, jamais selon leur proximité idéologique ou la valeur de leurs propositions."
  };
}

function hash(value = "") {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rotate(items, seed) {
  if (!items.length) return [];
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function shuffledOptions(correct, distractors, seed) {
  const values = [correct, ...distractors.filter((item) => item !== correct)].slice(0, 4);
  const ordered = [...values].sort((a, b) => hash(`${seed}:${a}`) - hash(`${seed}:${b}`));
  return { options: ordered, correctIndex: ordered.indexOf(correct) };
}

function maskEntity(text, name) {
  let output = String(text || "");
  const parts = String(name || "").split(/\s+/).filter((part) => part.length > 3);
  output = output.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "cette personnalité");
  for (const part of parts) output = output.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "cette personnalité");
  return excerpt(output, 230);
}

export function buildQuiz(topicId = null, count = 8) {
  const topic = topicId ? topicById.get(topicId) : null;
  if (topicId && !topic) throw new Error("Thème inconnu");
  const selectableCandidates = entities.candidates.filter((candidate) => !NON_SELECTABLE_STATUSES.has(candidate.current_status));
  const statusLabels = [...new Set(selectableCandidates.map((candidate) => STATUS_LABELS[candidate.current_status] || candidate.current_status))];
  const statusQuestions = rotate(selectableCandidates, hash(`status:${topicId || "all"}`)).slice(0, 12).map((candidate) => {
    const correct = STATUS_LABELS[candidate.current_status] || candidate.current_status;
    const distractors = rotate(statusLabels.filter((label) => label !== correct), hash(candidate.id)).slice(0, 3);
    const choice = shuffledOptions(correct, distractors, candidate.id);
    return {
      id: `status:${candidate.id}`,
      type: "status",
      question: `Quel statut est enregistré pour ${candidate.name} dans l’instantané actuel ?`,
      ...choice,
      explanation: `Le registre indique « ${correct} » au ${candidate.status_as_of || entities.snapshot_date}.`,
      source: { title: `Statut de ${candidate.name}`, githubUrl: `${REPO}/blob/main/data/entities.json`, sourceUrl: candidate.source_url || null }
    };
  });

  const evidencePool = selectableCandidates.flatMap((candidate) => {
    const chunks = topic
      ? topicEvidence(candidate.id, topic, { currentOnly: true, limit: 2 })
      : documentList(candidate.id).filter((item) => CURRENT_DOCUMENT_STATUSES.has(item.documentStatus || "unknown")).slice(0, 2);
    return chunks.map((item) => ({ candidate, item }));
  });
  const candidateNames = selectableCandidates.map((candidate) => candidate.name);
  const evidenceQuestions = rotate(evidencePool, hash(`evidence:${topicId || "all"}`)).slice(0, 12).map(({ candidate, item }) => {
    const distractors = rotate(candidateNames.filter((name) => name !== candidate.name), hash(item.id)).slice(0, 3);
    const choice = shuffledOptions(candidate.name, distractors, item.id);
    return {
      id: `evidence:${item.id}`,
      type: "evidence",
      question: "À quelle personnalité cet élément est-il directement rattaché dans le corpus ?",
      prompt: maskEntity(item.excerpt, candidate.name),
      ...choice,
      explanation: `Cet élément provient de « ${item.title} » et est directement rattaché à ${candidate.name}.`,
      source: { title: item.title, githubUrl: item.githubUrl, sourceUrl: item.sourceUrl }
    };
  });

  const mixed = [];
  const max = Math.max(statusQuestions.length, evidenceQuestions.length);
  for (let i = 0; i < max && mixed.length < count; i += 1) {
    if (evidenceQuestions[i]) mixed.push(evidenceQuestions[i]);
    if (statusQuestions[i] && mixed.length < count) mixed.push(statusQuestions[i]);
  }
  return {
    snapshotDate: entities.snapshot_date,
    topic: topic ? { id: topic.id, label: topic.label } : null,
    questions: mixed.slice(0, count),
    note: "Ce quiz vérifie uniquement la compréhension du corpus et des statuts. Il ne mesure aucune orientation politique et ne produit aucune recommandation de vote."
  };
}
