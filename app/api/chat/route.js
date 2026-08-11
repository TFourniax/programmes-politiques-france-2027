import { NextResponse } from "next/server";
import { resolveDeterministicContext, retrieveDeterministic } from "../../../lib/retrieval-v2.js";
import { composeDeterministicAnswer } from "../../../lib/deterministic-answer-v2.js";
import { candidateEvidence } from "../../../lib/presentation.js";
import {
  classifyDeterministicQuestion,
  isTargetedCandidateQuestion,
  selectDeterministicCandidates
} from "../../../lib/deterministic-query.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENGINE = "deterministic-bm25-ontology-v4";
const windows = new Map();
function limited(request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = windows.get(ip);
  if (!current || current.expiresAt < now) { windows.set(ip,{count:1,expiresAt:now+60_000}); return false; }
  current.count += 1;
  return current.count > 8;
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && ["user", "assistant"].includes(item.role))
    .map((item) => ({ role: item.role, content: String(item.content || "").trim().slice(0, 800) }))
    .filter((item) => item.content)
    .slice(-6);
}

function citationsFromEvidence(evidence) {
  return evidence.map((item,index) => ({ number:index+1,...item.citation,score:item.score }));
}

function noDataAnswer(question, requestedEntities = []) {
  const names = requestedEntities.map((item) => item.name).filter(Boolean);
  const target = names.length ? ` pour ${names.join(", ")}` : "";
  return {
    layout: "overview",
    title: "Aucune donnée pertinente dans le corpus",
    summary: `Le corpus ne contient pas d’élément suffisamment pertinent${target} pour répondre à « ${question} ». Je préfère ne pas afficher de résultats approximatifs ou hors sujet.`,
    note: names.length
      ? "L’absence d’un élément dans le corpus ne permet pas de conclure à une absence de position politique. Les positions d’un parti ne sont pas automatiquement attribuées à une personnalité."
      : "La réponse reste strictement limitée aux données politiques versionnées dans le dépôt.",
    sections: [], cards: [], followUps: []
  };
}

function unsupportedAnswer(reason) {
  if (reason === "unsupported_absence_inference") {
    return {
      layout: "overview",
      title: "Impossible de déduire une absence de position",
      summary: "Le corpus permet d’établir ce qui est documenté, mais l’absence d’une proposition ou d’une mention ne prouve pas qu’un candidat ou un parti n’a pas cette position.",
      note: "Je peux comparer les positions effectivement documentées, sans transformer un silence du corpus en position politique.",
      sections: [], cards: [], followUps: []
    };
  }
  return {
    layout: "overview",
    title: "Classement politique non déduit automatiquement",
    summary: "Cette question demande un jugement de valeur ou un classement interprétatif. Le moteur peut comparer les propositions documentées, mais ne décide pas quel programme est « meilleur », « pire » ou « le plus favorable ».",
    note: "Cette limite évite d’introduire une interprétation politique non présente dans les sources.",
    sections: [], cards: [], followUps: []
  };
}

function response(answer, evidence, retrievalDebug) {
  return NextResponse.json({
    answer,
    citations: citationsFromEvidence(evidence),
    retrieval: retrievalDebug,
    generated: false,
    providerError: null,
    engine: ENGINE
  });
}

export async function POST(request) {
  if (limited(request)) return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({error:"Requête JSON invalide."},{status:400}); }
  const question = String(payload?.question || "").trim();
  if (!question || question.length > 1200) return NextResponse.json({error:"La question doit contenir entre 1 et 1200 caractères."},{status:400});

  const history = normalizeHistory(payload?.history);
  const context = resolveDeterministicContext(question, history);
  let mode = classifyDeterministicQuestion(question);
  if (mode === "overview" && context.inheritedMode) mode = context.inheritedMode;
  const candidates = mode === "candidates" ? selectDeterministicCandidates(question) : [];
  const candidateTargeted = mode === "candidates" && isTargetedCandidateQuestion(question);
  const retrievalQuery = context.query;

  let evidence = [];
  let retrievalDebug;

  if (mode === "candidates") {
    const scopeProbe = retrieveDeterministic(retrievalQuery,{limit:3});
    retrievalDebug = {...scopeProbe.debug, mode, directCandidateRecords:candidates.length, query:retrievalQuery, conversation:context};
    if (String(scopeProbe.debug.reason || "").startsWith("unsupported_")) return response(unsupportedAnswer(scopeProbe.debug.reason), [], retrievalDebug);
    if (!scopeProbe.debug.answerable && candidateTargeted) return response(noDataAnswer(question, scopeProbe.debug.requestedEntities || []), [], retrievalDebug);
    evidence = candidates.map(candidateEvidence);
  } else {
    const limit = mode === "comparison" ? 14 : mode === "measures" ? 12 : 10;
    const retrieval = retrieveDeterministic(retrievalQuery,{limit});
    evidence = retrieval.results;
    retrievalDebug = {...retrieval.debug, mode, query:retrievalQuery, conversation:context};
    if (String(retrieval.debug.reason || "").startsWith("unsupported_")) return response(unsupportedAnswer(retrieval.debug.reason), [], retrievalDebug);
    if (!evidence.length) return response(noDataAnswer(question, retrieval.debug.requestedEntities || []), [], retrievalDebug);
  }

  const answer = composeDeterministicAnswer(question,evidence,{
    mode,
    candidates,
    requestedEntities:retrievalDebug.requestedEntities || [],
    candidateTargeted
  });
  return response(answer, evidence, retrievalDebug);
}
