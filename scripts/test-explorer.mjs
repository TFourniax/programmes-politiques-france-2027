import assert from "node:assert/strict";
import { buildCandidateProfile, buildComparison, buildQuiz, buildTopicExplorer, getExplorerMeta } from "../lib/explorer.js";

const meta = getExplorerMeta();
assert.ok(meta.candidates.length >= 2, "Explorer needs at least two candidate records");
assert.equal(meta.topics.length, 10, "Explorer must expose the 10 canonical questionnaire topics");

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
    assert.notEqual(evidence.entityId, profile.candidate.id, "Party context must never be counted as direct candidate evidence");
  }
  if (coverage.level === "party_only") {
    assert.equal(coverage.directEvidence.length, 0, "party_only cannot contain direct candidate evidence");
    assert.ok(coverage.partyContext.length > 0, "party_only must contain explicit party context");
  }
  if (coverage.level === "none") {
    assert.equal(coverage.directEvidence.length, 0);
  }
}

for (const document of profile.directDocuments) {
  assert.equal(document.entityId, profile.candidate.id, "Candidate document list must contain direct candidate records only");
}
for (const document of profile.partyContextDocuments) {
  assert.equal(document.entityId, profile.candidate.partyId, "Party context list must contain party records only");
}

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
      assert.equal(evidence.entityId, row.candidate.partyId, "Comparison party context must match its candidate party");
      assert.notEqual(evidence.entityId, row.candidate.id, "Comparison must keep party context separate from candidate evidence");
    }
  }
}

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
