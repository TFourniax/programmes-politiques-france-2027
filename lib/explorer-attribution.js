import fs from "node:fs";
import path from "node:path";
import searchIndex from "../data/search-index.json" with { type: "json" };
import {
  buildCandidateProfile as buildBaseCandidateProfile,
  buildComparison as buildBaseComparison,
  buildQuiz,
  buildTopicExplorer as buildBaseTopicExplorer,
  getExplorerMeta as getBaseExplorerMeta
} from "./explorer.js";

const REPO = process.env.NEXT_PUBLIC_REPOSITORY_URL || "https://github.com/TFourniax/programmes-politiques-france-2027";
const OFFICIAL_PARTY_CANDIDATE_STATUSES = new Set(["party_designated", "official_candidate"]);
const EXPLICIT_CERTAINTIES = new Set(["explicit", "explicit_but_conditional", "explicit_but_underspecified"]);
const PRIMARY_TIERS = new Set(["tier_1_primary_official", "tier_2_primary_statement"]);

export function canAttributePartyProgramme(candidate) {
  return Boolean(candidate?.partyId && OFFICIAL_PARTY_CANDIDATE_STATUSES.has(candidate.currentStatus));
}

function decorateCandidate(candidate) {
  return candidate ? { ...candidate, partyProgrammeAttributable: canAttributePartyProgramme(candidate) } : candidate;
}

function sentenceExcerpt(value = "", target = 320) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (!text || text.length <= target) return text;
  const after = text.slice(target, Math.min(text.length, target + 240)).match(/[.!?…](?:["»”')\]]*)?(?=\s|$)/);
  if (after) return text.slice(0, target + after.index + after[0].length).trim();
  const before = [...text.slice(0, target).matchAll(/[.!?…](?:["»”')\]]*)?(?=\s|$)/g)].at(-1);
  if (before && before.index >= Math.floor(target * 0.55)) return text.slice(0, before.index + before[0].length).trim();
  return text;
}

function evidenceFromChunk(chunk) {
  return {
    id: chunk.id,
    entityId: chunk.entityId,
    entityLabel: chunk.entityLabel,
    kind: chunk.kind,
    title: chunk.title,
    excerpt: sentenceExcerpt(chunk.text),
    path: chunk.path,
    sourceUrl: chunk.sourceUrl || null,
    sourceTier: chunk.sourceTier || null,
    documentStatus: chunk.documentStatus || "unknown",
    candidateStatus: chunk.candidateStatus || null,
    publishedAt: chunk.publishedAt || null,
    confidence: chunk.confidence || null,
    certainty: chunk.certainty || null,
    section: chunk.section || null,
    githubUrl: `${REPO}/blob/main/${chunk.path}`
  };
}

function unquote(value = "") {
  const trimmed = String(value).trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function frontmatterScalar(source, key) {
  if (!source.startsWith("---\n")) return null;
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const raw = source.slice(4, end);
  const line = raw.split(/\r?\n/).find((item) => item.startsWith(`${key}:`));
  if (!line) return null;
  const value = unquote(line.slice(line.indexOf(":") + 1));
  return value && value !== "null" && value !== "~" ? value : null;
}

function canonicalPartyDocuments(partyId, partyName) {
  if (!partyId || !/^[a-z0-9-]+$/.test(partyId)) return [];
  const root = path.join(process.cwd(), "corpus", "2027", partyId);
  if (!fs.existsSync(root)) return [];
  const files = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  return files.map((name) => {
    const absolute = path.join(root, name);
    const source = fs.readFileSync(absolute, "utf8");
    const splitAt = source.startsWith("---\n") ? source.indexOf("\n---\n", 4) : -1;
    const body = splitAt >= 0 ? source.slice(splitAt + 5) : source;
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const title = frontmatterScalar(source, "title") || heading || name.replace(/\.md$/, "");
    const relativePath = path.posix.join("corpus", "2027", partyId, name);
    const verificationState = frontmatterScalar(source, "verification_state");
    return {
      id: frontmatterScalar(source, "document_id") || relativePath,
      entityId: partyId,
      entityLabel: partyName || partyId,
      kind: "document",
      title,
      excerpt: sentenceExcerpt(body.replace(/^#+\s+/gm, "").replace(/\[(.*?)\]\([^)]*\)/g, "$1")),
      path: relativePath,
      sourceUrl: frontmatterScalar(source, "source_url"),
      sourceTier: frontmatterScalar(source, "source_tier"),
      documentStatus: frontmatterScalar(source, "document_status") || "unknown",
      candidateStatus: null,
      publishedAt: frontmatterScalar(source, "published_at") || null,
      confidence: verificationState === "verified" ? "high" : null,
      certainty: null,
      section: null,
      githubUrl: `${REPO}/blob/main/${relativePath}`,
      provenanceBasis: "canonical_markdown"
    };
  });
}

function entityPolicyDocuments(entityId, entityLabel = null) {
  if (!entityId) return [];
  const byPath = new Map();

  for (const item of canonicalPartyDocuments(entityId, entityLabel)) byPath.set(item.path, item);

  for (const chunk of searchIndex.chunks || []) {
    if (chunk.entityId !== entityId || !["document", "proposal"].includes(chunk.kind)) continue;
    const indexed = evidenceFromChunk(chunk);
    const previous = byPath.get(chunk.path);
    if (!previous || (previous.kind === "proposal" || String(indexed.excerpt || "").length > String(previous.excerpt || "").length)) byPath.set(chunk.path, indexed);
  }

  return [...byPath.values()].sort((a, b) =>
    String(b.publishedAt || "").localeCompare(String(a.publishedAt || ""))
    || String(a.title || "").localeCompare(String(b.title || ""), "fr")
  );
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
  const partyContextDocuments = candidate.partyId ? entityPolicyDocuments(candidate.partyId, candidate.partyName) : [];
  return {
    ...base,
    candidate,
    coverage,
    coverageSummary: coverageSummary(coverage),
    partyContextDocuments,
    attributedPartyDocuments: attributedEvidence(partyContextDocuments, candidate),
    neutralityNote: canAttributePartyProgramme(candidate)
      ? `Les sources directement rattachées à ${candidate.name} restent distinguées des documents de ${candidate.partyName}. Comme ${candidate.name} est officiellement désigné par ce parti, son programme de parti peut lui être attribué ; chaque élément conserve néanmoins sa provenance de parti.`
      : "La couverture personnelle repose sur les sources directement rattachées à la personnalité. Les documents de son parti restent consultables comme contexte et historique, mais son programme n'est attribué à la personnalité que lorsqu'elle est officiellement désignée par ce parti."
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
