import entities from "../data/entities.json" with { type: "json" };
import { classifyQuestion as baseClassifyQuestion, selectCandidates as baseSelectCandidates } from "./presentation.js";

function norm(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const lastnameCounts = new Map();
for (const candidate of entities.candidates) {
  const last = norm(candidate.name).split(/\s+/).at(-1);
  if (last?.length >= 4) lastnameCounts.set(last, (lastnameCounts.get(last) || 0) + 1);
}

const candidateRows = entities.candidates.map((candidate) => {
  const full = norm(candidate.name);
  const aliases = new Set([full, norm(candidate.id)]);
  const last = full.split(/\s+/).at(-1);
  if (last?.length >= 4 && lastnameCounts.get(last) === 1) aliases.add(last);
  return { candidate, aliases: [...aliases] };
});

function phrase(text, value) {
  return ` ${text} `.includes(` ${value} `);
}

export function findNamedCandidates(question) {
  const q = norm(question);
  const words = new Set(q.split(/\s+/).filter(Boolean));
  return candidateRows
    .filter((row) => row.aliases.some((alias) => alias.includes(" ") ? phrase(q, alias) : words.has(alias)))
    .map((row) => row.candidate);
}

export function classifyDeterministicQuestion(question) {
  const q = norm(question);
  const named = findNamedCandidates(question);
  const baseMode = baseClassifyQuestion(question);

  // Policy and comparison intent always win. The ordinary noun "candidat" in
  // "Que propose le candidat X..." must never turn a programme question into
  // a registry/status answer.
  if (baseMode === "comparison" || baseMode === "measures") return baseMode;

  const statusLanguage = /statut|candidature|officiel|declare|declaration|investi|designe|primaire|retire|renonce|en course/.test(q);
  if (named.length && statusLanguage) return "candidates";
  return baseMode;
}

export function selectDeterministicCandidates(question) {
  if (classifyDeterministicQuestion(question) !== "candidates") return [];
  const named = findNamedCandidates(question);
  if (named.length) return named;
  return baseSelectCandidates(question);
}

export function isTargetedCandidateQuestion(question) {
  return classifyDeterministicQuestion(question) === "candidates" && findNamedCandidates(question).length > 0;
}
