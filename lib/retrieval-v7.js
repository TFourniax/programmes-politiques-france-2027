import ontology from "../data/political-ontology.json" with { type: "json" };
import entities from "../data/entities.json" with { type: "json" };
import {
  analyzeQuery,
  normalize,
  resolveDeterministicContext,
  resolveDeterministicQuery,
  retrieveDeterministic as retrieveV6
} from "./retrieval-v6.js";

const GENERIC_TITLED_NOUNS = new Set([
  "acteur", "acteurs", "article", "comment", "combien", "constitution", "europe", "france", "loi", "ou", "plan", "pourquoi", "programme", "projet", "quand", "quel", "quelle", "quelles", "quels", "reforme", "republique", "sujet"
]);
const CONCEPT_BY_ID = new Map((ontology.concepts || []).map((concept) => [concept.id, concept]));
const CANDIDATE_BY_ID = new Map((entities.candidates || []).map((candidate) => [candidate.id, candidate]));
const PARTY_BY_ID = new Map((entities.parties || []).map((party) => [party.id, party]));
const CANDIDATE_IDS = new Set(CANDIDATE_BY_ID.keys());
const PARTY_IDS = new Set(PARTY_BY_ID.keys());
const OFFICIAL_PARTY_CANDIDATE_STATUSES = new Set(["party_designated", "official_candidate"]);

const NUMBER_ATOMS = new Map(Object.entries({
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
  cent: 100, cents: 100, mille: 1000, million: 1000000, millions: 1000000, milliard: 1000000000, milliards: 1000000000
}));
const NUMBER_CONNECTORS = new Set(["et"]);
const QUANTITATIVE_UNITS = new Set([
  "euro", "euros", "an", "ans", "annee", "annees", "jour", "jours", "heure", "heures", "mois",
  "pourcent", "poste", "postes", "emploi", "emplois", "logement", "logements", "fonctionnaire", "fonctionnaires",
  "centre", "centres", "place", "places", "eleve", "eleves", "vehicule", "vehicules", "voiture", "voitures",
  "reacteur", "reacteurs", "epr", "epr2", "km", "kilometre", "kilometres"
]);

function normalizedNumberText(value = "") {
  return normalize(value)
    .replace(/\bquatre vingt dix\b/g, "90")
    .replace(/\bquatre vingt\b/g, "80")
    .replace(/\bsoixante et onze\b/g, "71")
    .replace(/\bsoixante dix\b/g, "70");
}

function isNumberToken(token) {
  return /^\d+$/.test(token) || NUMBER_ATOMS.has(token) || NUMBER_CONNECTORS.has(token);
}

function parseFrenchNumber(sequence = []) {
  let total = 0;
  let current = 0;
  let consumedValue = false;
  for (const token of sequence) {
    if (NUMBER_CONNECTORS.has(token)) continue;
    if (/^\d+$/.test(token)) {
      current += Number(token);
      consumedValue = true;
      continue;
    }
    const value = NUMBER_ATOMS.get(token);
    if (value === undefined) return null;
    consumedValue = true;
    if (value === 100) {
      current = Math.max(1, current) * 100;
    } else if (value === 1000) {
      total += Math.max(1, current) * 1000;
      current = 0;
    } else if (value >= 1000000) {
      total += Math.max(1, current) * value;
      current = 0;
    } else {
      current += value;
    }
  }
  if (!consumedValue) return null;
  const parsed = total + current;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function canonicalizeQuantitativeWords(question = "") {
  const tokens = normalizedNumberText(question).split(/\s+/).filter(Boolean);
  const out = [];
  for (let index = 0; index < tokens.length;) {
    if (NUMBER_CONNECTORS.has(tokens[index])) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }
    if (!isNumberToken(tokens[index])) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }
    let end = index;
    while (end < tokens.length && isNumberToken(tokens[end])) end += 1;
    const sequence = tokens.slice(index, end);
    const explicitDigitCount = sequence.filter((token) => /^\d+$/.test(token)).length;
    if (explicitDigitCount >= 2) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }
    let unitIndex = end;
    if (["de", "d"].includes(tokens[unitIndex])) unitIndex += 1;
    const unit = tokens[unitIndex];
    const parsed = QUANTITATIVE_UNITS.has(unit) ? parseFrenchNumber(sequence) : null;
    if (parsed === null || sequence.every((token) => /^\d+$/.test(token))) {
      out.push(tokens[index]);
      index += 1;
      continue;
    }
    out.push(String(parsed));
    index = end;
  }
  return out.join(" ");
}

function stem(value = "") {
  const term = normalize(value);
  if (term.length <= 4 || /^\d+$/.test(term)) return term;
  if (term.endsWith("aux") && term.length > 6) return `${term.slice(0, -3)}al`;
  if (term.endsWith("es") && term.length > 6) return term.slice(0, -2);
  if (term.endsWith("s") && term.length > 5) return term.slice(0, -1);
  return term;
}

function terms(value = "") {
  return normalize(value).split(/\s+/).filter(Boolean).map(stem);
}

function evidenceTerms(item) {
  return new Set(terms([
    item?.citation?.title,
    item?.citation?.section,
    item?.text
  ].filter(Boolean).join(" ")));
}

function aliasSize(concept) {
  return normalize(concept?.matchedAlias || "").split(/\s+/).filter(Boolean).length;
}

function dominantConceptIds(question) {
  const analysis = analyzeQuery(question);
  if (!analysis.concepts?.length) return [];
  const maxSize = Math.max(...analysis.concepts.map(aliasSize));
  if (maxSize < 2) return [];
  return analysis.concepts.filter((concept) => aliasSize(concept) === maxSize).map((concept) => concept.id);
}

function satisfiesStrictEvidence(item, conceptId) {
  const groups = CONCEPT_BY_ID.get(conceptId)?.strict_evidence_groups || [];
  if (!groups.length) return true;
  const evidence = evidenceTerms(item);
  return groups.every((group) => group.map(stem).some((term) => evidence.has(term)));
}

function enforceDominantConcept(question, result) {
  if (!result?.results?.length) return result;
  const dominantIds = dominantConceptIds(question);
  if (!dominantIds.length) return result;
  const wanted = new Set(dominantIds);
  const filtered = result.results.filter((item) => (item?.match?.concepts || []).some(
    (concept) => wanted.has(concept.id) && satisfiesStrictEvidence(item, concept.id)
  ));
  if (filtered.length === result.results.length) {
    return { ...result, debug: { ...result.debug, dominantConceptIds: dominantIds } };
  }
  return {
    ...result,
    results: filtered,
    debug: {
      ...result.debug,
      answerable: filtered.length > 0,
      reason: filtered.length ? result.debug?.reason : "unmatched_specific_concept",
      dominantConceptIds: dominantIds,
      dominantConceptFiltered: result.results.length - filtered.length
    }
  };
}

function conceptCoveredTerms(concepts = []) {
  const covered = new Set();
  for (const concept of concepts) {
    const source = [
      concept.matchedAlias,
      concept.label,
      ...(concept.aliases || []),
      ...(concept.retrieval_terms || [])
    ].filter(Boolean).join(" ");
    for (const term of terms(source)) covered.add(term);
  }
  return covered;
}

function entityCoveredTerms(requestedEntities = []) {
  const covered = new Set();
  for (const entity of requestedEntities) {
    for (const term of terms(`${entity?.name || ""} ${entity?.id || ""}`)) covered.add(term);
  }
  return covered;
}

function namedPolicyQualifier(question) {
  const analysis = analyzeQuery(question);
  const conceptTerms = conceptCoveredTerms(analysis.concepts || []);
  const entityTerms = entityCoveredTerms(analysis.requestedEntities || []);
  const subjectTerms = new Set((analysis.subjectTokens || []).map(stem));
  const candidates = [];

  for (const match of String(question || "").matchAll(/[\p{Lu}][\p{L}\p{N}]{3,}/gu)) {
    const surface = match[0];
    if (surface === surface.toUpperCase()) continue;
    const normalizedSurface = normalize(surface);
    if (!normalizedSurface || normalizedSurface.includes(" ") || GENERIC_TITLED_NOUNS.has(normalizedSurface)) continue;
    const token = stem(normalizedSurface);
    if (token.length < 5 || !subjectTerms.has(token)) continue;
    if (conceptTerms.has(token) || entityTerms.has(token)) continue;
    candidates.push(token);
  }

  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique : [];
}

function enforceNamedPolicyQualifier(question, result) {
  if (!result?.results?.length) return result;
  const anchors = namedPolicyQualifier(question);
  if (anchors.length !== 1) return result;
  const [anchor] = anchors;
  const filtered = result.results.filter((item) => evidenceTerms(item).has(anchor));
  if (filtered.length === result.results.length) {
    return { ...result, debug: { ...result.debug, lexicalAnchorTokens: anchors } };
  }
  return {
    ...result,
    results: filtered,
    debug: {
      ...result.debug,
      answerable: filtered.length > 0,
      reason: filtered.length ? result.debug?.reason : "unmatched_specific_qualifier",
      lexicalAnchorTokens: anchors,
      lexicalAnchorFiltered: result.results.length - filtered.length
    }
  };
}

function requestedEntityType(question) {
  const q = ` ${normalize(question)} `;
  const candidateRequested = /\b(candidat|candidats|candidate|candidates|personnalite|personnalites)\b/.test(q);
  const partyRequested = /\b(parti|partis|mouvement|mouvements)\b/.test(q);
  if (candidateRequested === partyRequested) return null;
  return candidateRequested ? "candidate" : "party";
}

function enforceRequestedEntityType(question, result, limit) {
  if (!result?.results?.length) return result;
  const type = requestedEntityType(question);
  if (!type) return { ...result, results: result.results.slice(0, limit) };
  const allowed = type === "candidate" ? CANDIDATE_IDS : PARTY_IDS;
  const filtered = result.results.filter((item) => allowed.has(item?.citation?.entityId));
  return {
    ...result,
    results: filtered.slice(0, limit),
    debug: {
      ...result.debug,
      answerable: filtered.length > 0,
      reason: filtered.length ? result.debug?.reason : `no_${type}_evidence`,
      requestedEntityType: type,
      entityTypeFiltered: result.results.length - filtered.length
    }
  };
}

function canInheritPartyProgramme(candidate) {
  return Boolean(
    candidate?.primary_party_id
    && OFFICIAL_PARTY_CANDIDATE_STATUSES.has(candidate.current_status)
  );
}

function partyQueryFromAnalysis(candidate, party, analysis) {
  const concepts = (analysis.concepts || []).map((concept) => concept.matchedAlias || concept.label).filter(Boolean);
  const subject = (analysis.subjectTokens || []).filter((term) => term.length >= 3);
  const numbers = analysis.numbers || [];
  const policyTerms = [...new Set([...concepts, ...subject, ...numbers])].join(" ").trim();
  return `Que propose ${party.name} sur ${policyTerms || "son programme politique"} ?`;
}

function mapPartyEvidenceToCandidate(item, candidate, party) {
  return {
    ...item,
    score: Number((Number(item.score || 0) * 0.94).toFixed(3)),
    citation: {
      ...item.citation,
      sourceEntityId: item.citation?.entityId || party.id,
      sourceEntityLabel: item.citation?.entityLabel || party.name,
      entityId: candidate.id,
      entityLabel: candidate.name,
      candidateStatus: candidate.current_status,
      partyId: party.id,
      partyName: party.name,
      attributionBasis: "official_party_programme",
      attributedToCandidateId: candidate.id,
      attributedToCandidateName: candidate.name
    }
  };
}

function mergeEvidence(primary, inherited, limit) {
  const byPath = new Map();
  for (const item of [...primary, ...inherited]) {
    const key = `${item?.citation?.entityId || ""}:${item?.citation?.path || item?.citation?.recordId || ""}`;
    const previous = byPath.get(key);
    if (!previous || Number(item.score || 0) > Number(previous.score || 0)) byPath.set(key, item);
  }
  return [...byPath.values()].sort((a, b) => Number(b.score || 0) - Number(a.score || 0)).slice(0, limit);
}

function retrieveWithOfficialPartyAttribution(question, options) {
  const direct = retrieveV6(question, options);
  const analysis = analyzeQuery(question);
  const eligible = (analysis.requestedEntities || [])
    .filter((entity) => entity.type === "candidate")
    .map((entity) => CANDIDATE_BY_ID.get(entity.id))
    .filter(canInheritPartyProgramme);
  if (!eligible.length) return direct;

  const inherited = [];
  for (const candidate of eligible) {
    const party = PARTY_BY_ID.get(candidate.primary_party_id);
    if (!party) continue;
    const partyQuery = partyQueryFromAnalysis(candidate, party, analysis);
    const partyResult = retrieveV6(partyQuery, { ...options, limit: Math.max(Number(options?.limit || 10), 14) });
    for (const item of partyResult.results || []) {
      if (item?.citation?.entityId !== party.id) continue;
      inherited.push(mapPartyEvidenceToCandidate(item, candidate, party));
    }
  }
  if (!inherited.length) return direct;

  const limit = Number(options?.limit || 10);
  const results = mergeEvidence(direct.results || [], inherited, limit);
  return {
    ...direct,
    results,
    debug: {
      ...direct.debug,
      answerable: results.length > 0,
      reason: "hybrid_evidence_with_official_party_programme",
      officialPartyProgrammeAttribution: eligible.map((candidate) => ({
        candidateId: candidate.id,
        partyId: candidate.primary_party_id
      })),
      inheritedPartyEvidence: inherited.length
    }
  };
}

export function retrieveDeterministic(question, options = {}) {
  const requestedLimit = Number(options.limit || 10);
  const type = requestedEntityType(question);
  const internalLimit = type ? Math.max(requestedLimit, 32) : requestedLimit;
  const canonicalQuestion = canonicalizeQuantitativeWords(question);
  const base = retrieveWithOfficialPartyAttribution(canonicalQuestion, { ...options, limit: internalLimit });
  const dominant = enforceDominantConcept(canonicalQuestion, base);
  const anchored = enforceNamedPolicyQualifier(question, dominant);
  const typed = enforceRequestedEntityType(question, anchored, requestedLimit);
  return {
    ...typed,
    debug: {
      ...typed.debug,
      quantitativeCanonicalQuery: canonicalQuestion !== normalize(question) ? canonicalQuestion : null
    }
  };
}

export { analyzeQuery, normalize, resolveDeterministicContext, resolveDeterministicQuery };
