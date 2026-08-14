import {
  buildCandidateProfile as buildBaseCandidateProfile,
  buildComparison as buildBaseComparison,
  buildQuiz,
  buildTopicExplorer as buildBaseTopicExplorer,
  getExplorerMeta as getBaseExplorerMeta
} from "./explorer.js";

const OFFICIAL_PARTY_CANDIDATE_STATUSES = new Set(["party_designated", "official_candidate"]);
const EXPLICIT_CERTAINTIES = new Set(["explicit", "explicit_but_conditional", "explicit_but_underspecified"]);
const PRIMARY_TIERS = new Set(["tier_1_primary_official", "tier_2_primary_statement"]);

export function canAttributePartyProgramme(candidate) {
  return Boolean(candidate?.partyId && OFFICIAL_PARTY_CANDIDATE_STATUSES.has(candidate.currentStatus));
}

function decorateCandidate(candidate) {
  return candidate ? { ...candidate, partyProgrammeAttributable: canAttributePartyProgramme(candidate) } : candidate;
}

function attributedEvidence(items, candidate) {
  if (!canAttributePartyProgramme(candidate)) return [];
  return (items || []).map((item) => ({
    ...item,
    attributionBasis: "official_party_programme",
    attributedToCandidateId: candidate.id,
    attributedToCandidateName: candidate.name,
    sourceEntityId: item.entityId,
    sourceEntityLabel: candidate.partyName || null
  }));
}

function inheritedQuality(items) {
  const explicitProposalCount = items.filter((item) => item.kind === "proposal" && EXPLICIT_CERTAINTIES.has(item.certainty)).length;
  const primarySourceCount = items.filter((item) => PRIMARY_TIERS.has(item.sourceTier)).length;
  const evidenceScore = items.reduce((sum, item) => {
    if (item.kind === "proposal" && item.certainty === "explicit") return sum + 4;
    if (item.kind === "proposal" && EXPLICIT_CERTAINTIES.has(item.certainty)) return sum + 3;
    if (PRIMARY_TIERS.has(item.sourceTier)) return sum + 2;
    return sum + 0.5;
  }, 0);
  return { explicitProposalCount, primarySourceCount, evidenceScore: Number(evidenceScore.toFixed(1)) };
}

function upgradeCoverage(candidate, coverage) {
  const inherited = attributedEvidence(coverage.partyContext, candidate);
  if (!inherited.length) {
    return {
      ...coverage,
      partyProgrammeAttributed: false,
      attributedPartyEvidence: [],
      attributedPartySourceCount: 0,
      effectiveSourceCount: coverage.directSourceCount,
      effectiveEvidenceScore: coverage.quality?.evidenceScore || 0
    };
  }

  const inheritedMetrics = inheritedQuality(inherited);
  const directCount = coverage.directEvidence?.length || 0;
  const effectiveScore = Number(((coverage.quality?.evidenceScore || 0) + inheritedMetrics.evidenceScore).toFixed(1));
  const effectiveExplicit = (coverage.quality?.explicitProposalCount || 0) + inheritedMetrics.explicitProposalCount;
  const effectivePrimary = (coverage.quality?.primarySourceCount || 0) + inheritedMetrics.primarySourceCount;
  const effectiveCount = directCount + inherited.length;

  let level = coverage.level;
  if (level !== "documented") {
    const solid = effectiveExplicit >= 2 || (effectiveCount >= 2 && effectiveScore >= 5 && (effectivePrimary >= 1 || effectiveExplicit >= 1));
    level = solid ? "documented" : "partial";
  }

  return {
    ...coverage,
    level,
    partyProgrammeAttributed: true,
    attributedPartyEvidence: inherited,
    attributedPartySourceCount: inherited.length,
    effectiveSourceCount: effectiveCount,
    effectiveEvidenceScore: effectiveScore,
    note: `Le programme de ${candidate.partyName || "son parti"} est attribuable à ${candidate.name} parce que cette personnalité est officiellement désignée par ce parti. La source reste le document du parti et demeure visible comme telle.`
  };
}

function coverageSummary(items) {
  return items.reduce((acc, item) => {
    acc[item.level] = (acc[item.level] || 0) + 1;
    return acc;
  }, { documented: 0, partial: 0, party_only: 0, none: 0 });
}

export function getExplorerMeta() {
  const meta = getBaseExplorerMeta();
  return { ...meta, candidates: meta.candidates.map(decorateCandidate) };
}

export function buildCandidateProfile(candidateId) {
  const base = buildBaseCandidateProfile(candidateId);
  const candidate = decorateCandidate(base.candidate);
  const coverage = base.coverage.map((item) => upgradeCoverage(candidate, item));
  return {
    ...base,
    candidate,
    coverage,
    coverageSummary: coverageSummary(coverage),
    attributedPartyDocuments: attributedEvidence(base.partyContextDocuments, candidate),
    neutralityNote: canAttributePartyProgramme(candidate)
      ? `Les sources directement rattachées à ${candidate.name} restent distinguées des documents de ${candidate.partyName}. Comme ${candidate.name} est officiellement désigné par ce parti, son programme de parti peut lui être attribué ; chaque élément conserve néanmoins sa provenance de parti.`
      : "La couverture personnelle repose sur les sources directement rattachées à la personnalité. Un programme de parti n'est attribué à une personnalité que lorsqu'elle est officiellement désignée par ce parti."
  };
}

export function buildComparison(candidateIds, topicIds) {
  const base = buildBaseComparison(candidateIds, topicIds);
  const rows = base.rows.map((row) => {
    const candidate = decorateCandidate(row.candidate);
    return { ...row, candidate, cells: row.cells.map((cell) => upgradeCoverage(candidate, cell)) };
  });
  const signals = base.topics.map((topic, topicIndex) => {
    const direct = [], attributed = [], partyOnly = [], missing = [];
    for (const row of rows) {
      const cell = row.cells[topicIndex];
      if (cell.directEvidence?.length) direct.push(row.candidate.name);
      else if (cell.partyProgrammeAttributed && cell.attributedPartyEvidence?.length) attributed.push(row.candidate.name);
      else if (cell.level === "party_only") partyOnly.push(row.candidate.name);
      else missing.push(row.candidate.name);
    }
    return {
      topicId: topic.id,
      topicLabel: topic.label,
      direct,
      attributed,
      partyOnly,
      missing,
      completeForSelection: missing.length === 0 && partyOnly.length === 0
    };
  });
  return {
    ...base,
    rows,
    signals,
    neutralityNote: "La comparaison décrit la documentation disponible, pas une note politique. Les programmes de parti ne sont attribués qu'aux personnalités officiellement désignées par ces partis ; la provenance du document de parti reste toujours affichée."
  };
}

export function buildTopicExplorer(topicId) {
  const base = buildBaseTopicExplorer(topicId);
  const rank = { documented: 0, partial: 1, party_only: 2, none: 3 };
  const candidates = base.candidates.map((row) => {
    const candidate = decorateCandidate(row.candidate);
    return { ...row, candidate, coverage: upgradeCoverage(candidate, row.coverage) };
  }).sort((a, b) =>
    rank[a.coverage.level] - rank[b.coverage.level]
    || (b.coverage.effectiveEvidenceScore || 0) - (a.coverage.effectiveEvidenceScore || 0)
    || a.candidate.name.localeCompare(b.candidate.name, "fr")
  );
  return {
    ...base,
    candidates,
    summary: coverageSummary(candidates.map((row) => row.coverage)),
    neutralityNote: "L'ordre reflète uniquement la couverture documentaire. Un programme de parti ne compte pour une personnalité que si elle est officiellement désignée par ce parti, sans effacer la provenance de la source."
  };
}

export { buildQuiz };
