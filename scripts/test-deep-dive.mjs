import assert from "node:assert/strict";
import { composeDeterministicAnswer } from "../lib/deterministic-answer-v2.js";
import { composeDeepAnswer } from "../lib/deep-answer.js";
import { canExpandEvidence, enrichEvidence, expandEvidence } from "../lib/evidence-depth.js";
import { normalize, retrieveDeterministic } from "../lib/retrieval-v2.js";

const question = "Que propose le corpus sur les retraites ?";
const retrieval = retrieveDeterministic(question, { limit: 12 });
assert.ok(retrieval.results.length > 0, "the fixture query must return deterministic corpus evidence");

const enriched = enrichEvidence(retrieval.results);
assert.equal(enriched.length, retrieval.results.length);
for (const item of enriched) {
  assert.ok(Array.isArray(item.citation.sourceDocumentIds), "evidence provenance must expose source document ids");
  assert.ok(Number.isInteger(item.citation.sourceCount), "evidence provenance must expose a deterministic source count");
}

const compactEntities = new Set(enriched.map((item) => item.citation?.entityId).filter(Boolean));
const expanded = expandEvidence(enriched, { maxEvidence: 36, chunksPerSource: 3 });
assert.ok(expanded.length >= enriched.length, "deepening must never discard compact evidence");
assert.ok(canExpandEvidence(enriched, retrieval.debug), "a substantive programme query should expose a deep-dive when linked corpus evidence exists");
for (const item of expanded) {
  if (item.citation?.canonicalClaimId) {
    assert.ok(compactEntities.has(item.citation.entityId), "linked source evidence must preserve canonical claim attribution");
    if (item.citation.sourceOwnerEntityId && item.citation.sourceOwnerEntityId !== item.citation.entityId) {
      assert.ok(item.citation.canonicalClaimId, "cross-owner evidence must stay explicitly attached to its canonical claim");
    }
  }
}

const compactAnswer = composeDeterministicAnswer(question, enriched, { mode: "measures" });
const deepAnswer = composeDeepAnswer(question, expanded, { mode: "measures" });
assert.equal(deepAnswer.depth, "deep");
assert.equal(deepAnswer.layout, compactAnswer.layout);
assert.ok(deepAnswer.cards.length >= compactAnswer.cards.length, "deepening must preserve the answer entities");
for (const card of deepAnswer.cards) {
  if (card.entityId) assert.ok(compactEntities.has(card.entityId), "deepening must not invent an entity through a supporting document owner");
}

const corpusTexts = expanded.flatMap((item) => [item.text, item.citation?.title]).filter(Boolean).map(normalize);
for (const card of deepAnswer.cards) {
  for (const text of [card.summary, ...(card.bullets || [])].filter(Boolean)) {
    const normalized = normalize(text);
    assert.ok(
      corpusTexts.some((source) => source.includes(normalized) || normalized.includes(source)),
      `deep answer text must remain extractive: ${text}`
    );
  }
}

const outOfScope = retrieveDeterministic("Quel est le meilleur smartphone à acheter ?", { limit: 20 });
assert.equal(outOfScope.results.length, 0, "deep-dive work must not weaken out-of-corpus refusal");

console.log(`Deep-dive regression OK: ${enriched.length} compact evidence rows -> ${expanded.length} expanded rows.`);
