import { NextResponse } from "next/server";
import { resolveDeterministicContext, retrieveDeterministic } from "../../../lib/retrieval-v2.js";
import { composeDeterministicAnswer } from "../../../lib/deterministic-answer-v2.js";
import { candidateEvidence } from "../../../lib/presentation.js";
import { buildContextualSuggestions } from "../../../lib/contextual-suggestions.js";
import {
  buildFallbackRetrievalQuery,
  interpretRetrievalWithModel,
  shouldAttemptRetrievalFallback
} from "../../../lib/retrieval-fallback.js";
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

function response(answer, evidence, retrievalDebug, retrievalAssisted = false) {
  return NextResponse.json({
    answer,
    citations: citationsFromEvidence(evidence),
    retrieval: retrievalDebug,
    retrievalAssisted,
    generated: false,
    providerError: null,
    engine: ENGINE
  });
}

function limitForMode(mode) {
  return mode === "comparison" ? 14 : mode === "measures" ? 12 : 10;
}

function modeFromFallback(interpretation, currentMode) {
  if (!interpretation) return currentMode;
  if (interpretation.intent === "candidate_status") return "candidates";
  if (interpretation.intent === "comparison") return "comparison";
  if (interpretation.intent === "measures") return "measures";
  return currentMode;
}

function runRetrieval(query, mode) {
  if (mode === "candidates") {
    const candidates = selectDeterministicCandidates(query);
    const candidateTargeted = isTargetedCandidateQuestion(query);
    const scopeProbe = retrieveDeterministic(query,{limit:3});
    return {
      evidence: candidates.map(candidateEvidence),
      candidates,
      candidateTargeted,
      debug: {...scopeProbe.debug, mode, directCandidateRecords:candidates.length, query}
    };
  }
  const retrieval = retrieveDeterministic(query,{limit:limitForMode(mode)});
  return {
    evidence: retrieval.results,
    candidates: [],
    candidateTargeted: false,
    debug: {...retrieval.debug, mode, query}
  };
}

function suggestionsFor(answerQuestion, originalQuestion, evidence, history) {
  const enrichedHistory = answerQuestion === originalQuestion
    ? history
    : [...history, { role: "user", content: originalQuestion }].slice(-6);
  return buildContextualSuggestions(answerQuestion, evidence, enrichedHistory, { limit: 3 });
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
  let retrievalQuery = context.query;
  let run = runRetrieval(retrievalQuery, mode);
  run.debug = {...run.debug, conversation:context};

  if (String(run.debug.reason || "").startsWith("unsupported_")) {
    const answer = unsupportedAnswer(run.debug.reason);
    answer.followUps = suggestionsFor(question, question, [], history);
    return response(answer, [], run.debug, false);
  }

  let retrievalAssisted = false;
  let fallbackDebug = null;
  const noUsableEvidence = !run.evidence.length || (run.candidateTargeted && !run.debug.answerable);

  if (noUsableEvidence && shouldAttemptRetrievalFallback(run.debug)) {
    const fallback = await interpretRetrievalWithModel(question, history);
    fallbackDebug = {
      attempted: fallback.attempted,
      accepted: Boolean(fallback.interpretation && fallback.query),
      model: fallback.model || null,
      error: fallback.error || null,
      intent: fallback.interpretation?.intent || null,
      entityIds: fallback.interpretation?.entityIds || [],
      conceptIds: fallback.interpretation?.conceptIds || []
    };

    if (fallback.interpretation && fallback.query) {
      const safeQuery = buildFallbackRetrievalQuery(fallback.interpretation);
      const fallbackMode = modeFromFallback(fallback.interpretation, mode);
      const fallbackRun = runRetrieval(safeQuery, fallbackMode);
      if (fallbackRun.evidence.length && fallbackRun.debug.answerable) {
        retrievalAssisted = true;
        retrievalQuery = safeQuery;
        mode = fallbackMode;
        run = fallbackRun;
      }
    }
  }

  run.debug = {
    ...run.debug,
    query: retrievalQuery,
    conversation: context,
    semanticFallback: fallbackDebug
  };

  if (String(run.debug.reason || "").startsWith("unsupported_")) {
    const answer = unsupportedAnswer(run.debug.reason);
    answer.followUps = suggestionsFor(retrievalQuery, question, [], history);
    return response(answer, [], run.debug, retrievalAssisted);
  }

  if (!run.evidence.length || (run.candidateTargeted && !run.debug.answerable)) {
    const answer = noDataAnswer(question, run.debug.requestedEntities || []);
    answer.followUps = suggestionsFor(retrievalQuery, question, [], history);
    return response(answer, [], run.debug, retrievalAssisted);
  }

  const answerQuestion = retrievalAssisted ? retrievalQuery : question;
  const answer = composeDeterministicAnswer(answerQuestion,run.evidence,{
    mode,
    candidates:run.candidates,
    requestedEntities:run.debug.requestedEntities || [],
    candidateTargeted:run.candidateTargeted
  });
  answer.followUps = suggestionsFor(answerQuestion, question, run.evidence, history);
  return response(answer, run.evidence, run.debug, retrievalAssisted);
}
