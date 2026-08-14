import assert from "node:assert/strict";
import compass from "../data/compass.json" with { type: "json" };
import { buildCandidateProfile, buildComparison, buildQuiz, buildTopicExplorer, getExplorerMeta } from "../lib/explorer-attribution.js";

const meta = getExplorerMeta();
assert.ok(meta.candidates.length >= 2, "Explorer needs at least two candidate records");
const canonicalTopicIds = (compass.questions || []).map((topic) => topic.id);
assert.deepEqual(
  meta.topics.map((topic) => topic.id),
  canonicalTopicIds,
  "Explorer must expose exactly the public topic taxonomy"
);
assert.ok(canonicalTopicIds.includes("defense-international"), "Explorer must expose defense/international");
assert.ok(canonicalTopicIds.includes("numerique-ia"), "Explorer must expose digital/AI");

const selectable = meta.candidates.filter((candidate) => candidate.selectable);
assert.ok(selectable.length >= 2, "Explorer needs at least two selectable personalities");

const profileCandidate = selectable.find((candidate) => candidate.partyId) || selectable[0];
const profile = buildCandidateProfile(profileCandidate.id);
assert.equal(profile.candidate.id, profileCandidate.id);
assert.equal(profile.coverage.length, meta.topics.length);
assert.equal(
  Object.values(profile.coverageSummary).reduce((sum, value) => sum + value, 0),
  meta.topics.length,
  "Every topic must resolve to exactly one coverage state"
);

for (const coverage of profile.coverage) {
  assert.ok(["documented", "partial", "party_only", "none"].includes(coverage.level), `Unexpected coverage state: ${coverage.level}`);
  for (const evidence of coverage.directEvidence) {
    assert.equal(evidence.entityId, profile.candidate.id, "Direct candidate evidence must belong to the candidate entity");
  }
  for (const evidence of coverage.partyContext) {
    assert.equal(evidence.entityId, profile.candidate.partyId, "Party context must belong to the candidate's party entity");
    assert.notEqual(evidence.entityId, profile.candidate.id, "Party source provenance must stay distinct from candidate evidence");
  }
  if (coverage.partyProgrammeAttributed) {
    assert.equal(profile.candidate.partyProgrammeAttributable, true, "Only an official party candidate may inherit party evidence");
    assert.ok(coverage.attributedPartyEvidence.length > 0, "Attributed party coverage must expose its evidence");
    for (const evidence of coverage.attributedPartyEvidence) {
      assert.equal(evidence.entityId, profile.candidate.partyId, "Attributed evidence must preserve the party as source entity");
      assert.equal(evidence.attributedToCandidateId, profile.candidate.id);
      assert.equal(evidence.attributionBasis, "official_party_programme");
    }
  }
  if (coverage.level === "party_only") {
    assert.equal(coverage.directEvidence.length, 0, "party_only cannot contain direct candidate evidence");
    assert.equal(coverage.partyProgrammeAttributed, false, "party_only is reserved for non-attributable party context");
    assert.ok(coverage.partyContext.length > 0, "party_only must contain explicit party context");
  }
  if (coverage.level === "none") {
    assert.equal(coverage.directEvidence.length, 0);
    assert.equal(coverage.attributedPartyEvidence.length, 0);
  }
}

for (const document of profile.directDocuments) {
  assert.equal(document.entityId, profile.candidate.id, "Candidate document list must contain direct candidate records only");
}
for (const document of profile.partyContextDocuments) {
  assert.equal(document.entityId, profile.candidate.partyId, "Party context list must contain party records only");
}

const officialPartyCandidate = selectable.find((candidate) => candidate.currentStatus === "party_designated");
assert.ok(officialPartyCandidate, "Fixture must include at least one party-designated presidential candidate");
const officialProfile = buildCandidateProfile(officialPartyCandidate.id);
assert.equal(officialProfile.candidate.partyProgrammeAttributable, true);
assert.ok(officialProfile.attributedPartyDocuments.length > 0, "Official party candidate must inherit the indexed party programme");
assert.ok(
  officialProfile.coverage.some((item) => item.partyProgrammeAttributed),
  "Official party candidate must expose at least one attributed programme topic"
);

const nonOfficialPartyCandidate = selectable.find((candidate) => candidate.partyId && !candidate.partyProgrammeAttributable && candidate.id !== officialPartyCandidate.id);
assert.ok(nonOfficialPartyCandidate, "Fixture must include a non-designated party-affiliated personality");
const nonOfficialProfile = buildCandidateProfile(nonOfficialPartyCandidate.id);
assert.equal(nonOfficialProfile.attributedPartyDocuments.length, 0, "Party programme must not be inherited without official party designation");
assert.ok(nonOfficialProfile.coverage.every((item) => !item.partyProgrammeAttributed));

const candidateIds = selectable.slice(0, 2).map((candidate) => candidate.id);
const topicIds = meta.topics.slice(0, 3).map((topic) => topic.id);
const comparison = buildComparison(candidateIds, topicIds);
assert.equal(comparison.rows.length, 2);
assert.equal(comparison.topics.length, 3);
assert.equal(comparison.signals.length, 3);

for (const row of comparison.rows) {
  assert.equal(row.cells.length, comparison.topics.length);
  for (const cell of row.cells) {
    for (const evidence of cell.directEvidence) {
      assert.equal(evidence.entityId, row.candidate.id, "Comparison direct evidence must match its candidate row");
    }
    for (const evidence of cell.partyContext) {
      assert.equal(evidence.entityId, row.candidate.partyId, "Comparison party source must match its candidate party");
    }
    if (cell.partyProgrammeAttributed) {
      assert.equal(row.candidate.partyProgrammeAttributable, true);
      assert.ok(cell.attributedPartyEvidence.length > 0);
    }
  }
}

const attributionComparison = buildComparison(
  [officialPartyCandidate.id, nonOfficialPartyCandidate.id],
  meta.topics.map((topic) => topic.id).slice(0, 6)
);
assert.ok(
  attributionComparison.signals.some((signal) => signal.attributed.includes(officialPartyCandidate.name)),
  "Comparison must distinguish official party-programme attribution from direct evidence"
);
assert.ok(
  attributionComparison.signals.every((signal) => !signal.attributed.includes(nonOfficialPartyCandidate.name)),
  "Non-designated personality must never appear in the attributed-party bucket"
);

const topic = buildTopicExplorer(meta.topics[0].id);
assert.equal(topic.candidates.length, meta.candidates.length, "Thematic explorer must show every tracked personality, including missing coverage");
assert.equal(
  Object.values(topic.summary).reduce((sum, value) => sum + value, 0),
  meta.candidates.length,
  "Thematic coverage summary must account for every tracked personality"
);
for (const row of topic.candidates) {
  for (const evidence of row.coverage.directEvidence) assert.equal(evidence.entityId, row.candidate.id);
  for (const evidence of row.coverage.partyContext) assert.equal(evidence.entityId, row.candidate.partyId);
}

const quiz = buildQuiz(null, 8);
assert.equal(quiz.questions.length, 8, "General knowledge quiz must provide eight questions");
for (const question of quiz.questions) {
  assert.equal(question.options.length, 4, "Quiz questions must have four answer choices");
  assert.ok(Number.isInteger(question.correctIndex));
  assert.ok(question.correctIndex >= 0 && question.correctIndex < question.options.length);
  assert.ok(question.source?.githubUrl, "Every quiz question must expose a GitHub verification source");
}

console.log(`Explorer QA OK: ${meta.candidates.length} personalities, ${meta.topics.length} topics, ${quiz.questions.length} quiz questions`);
