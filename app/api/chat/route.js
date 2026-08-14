import { NextResponse } from "next/server";
import { resolveDeterministicContext, retrieveDeterministic } from "../../../lib/retrieval-v2.js";
import { composeDeterministicAnswer } from "../../../lib/deterministic-answer-v2.js";
import { composeDeepAnswer } from "../../../lib/deep-answer.js";
import { canExpandEvidence, enrichEvidence, expandEvidence } from "../../../lib/evidence-depth.js";
import { candidateEvidence } from "../../../lib/presentation.js";
import {
  buildContextualSuggestions,
  buildSuggestionSessionState,
  sanitizeSuggestionSessionState
} from "../../../lib/contextual-suggestions.js";
import {
  buildFallbackRetrievalQuery,
  interpretRetrievalWithModel,
  shouldAttemptRetrievalFallback,
  withInheritedFallbackContext
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
const fallbackWindows = new Map();
const MAX_LOCAL_WINDOWS = 4096;
const MODES = new Set(["overview", "comparison", "measures", "candidates"]);

function clientKey(request) {
  return request.headers.get("x-nf-client-connection-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "local";
}

function pruneWindowStore(store, now) {
  if (store.size < MAX_LOCAL_WINDOWS / 2) return;
  for (const [key, value] of store) {
    if (!value || value.expiresAt < now) store.delete(key);
  }
  while (store.size > MAX_LOCAL_WINDOWS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

function windowLimited(store, key, limit, durationMs) {
  const now = Date.now();
  pruneWindowStore(store, now);
  const current = store.get(key);
  if (!current || current.expiresAt < now) {
    store.set(key, { count: 1, expiresAt: now + durationMs });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function limited(request) {
  return windowLimited(windows, clientKey(request), 30, 60_000);
}

function fallbackLimited(request) {
  return windowLimited(fallbackWindows, clientKey(request), 2, 60_000);
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

function publicRetrieval(debug = {}) {
  return {
    answerable: Boolean(debug.answerable),
    reason: debug.reason || null,
    mode: debug.mode || null,
    concepts: (debug.concepts || []).map((item) => ({ id: item.id, label: item.label })),
    requestedEntities: (debug.requestedEntities || []).map((item) => ({ id: item.id, name: item.name, type: item.type })),
    semanticFallback: debug.semanticFallback ? {
      attempted: Boolean(debug.semanticFallback.attempted),
      accepted: Boolean(debug.semanticFallback.accepted),
      error: debug.semanticFallback.error || null
    } : null
  };
}

function response(answer, evidence, retrievalDebug, retrievalAssisted = false, sessionContext = {}, expansion = { available: false }, depth = "summary") {
  return NextResponse.json({
    answer,
    citations: citationsFromEvidence(evidence),
    retrieval: publicRetrieval(retrievalDebug),
    retrievalAssisted,
    generated: false,
    providerError: null,
    engine: ENGINE,
    sessionContext,
    expansion,
    depth
  });
}

function limitForMode(mode, depth = "summary") {
  if (depth === "deep") return mode === "comparison" ? 24 : mode === "measures" ? 20 : 18;
  return mode === "comparison" ? 14 : mode === "measures" ? 12 : 10;
}

function modeFromFallback(interpretation, currentMode) {
  if (!interpretation) return currentMode;
  if (interpretation.intent === "candidate_status") return "candidates";
  if (interpretation.intent === "comparison") return "comparison";
  if (interpretation.intent === "measures") return "measures";
  return currentMode;
}

function runRetrieval(query, mode, depth = "summary") {
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
  const retrieval = retrieveDeterministic(query,{limit:limitForMode(mode, depth)});
  return {
    evidence: retrieval.results,
    candidates: [],
    candidateTargeted: false,
    debug: {...retrieval.debug, mode, query}
  };
}

function suggestionsFor(answerQuestion, originalQuestion, evidence, history, sessionState) {
  const enrichedHistory = answerQuestion === originalQuestion
    ? history
    : [...history, { role: "user", content: originalQuestion }].slice(-6);
  return buildContextualSuggestions(answerQuestion, evidence, enrichedHistory, { limit: 3, sessionState });
}

function finalizeAnswer(answer, retrievalAssisted) {
  if (!retrievalAssisted) return answer;
  return {
    ...answer,
    note: "Compréhension de la formulation assistée par un classifieur sémantique de secours ; les résultats ont ensuite été revalidés par le moteur déterministe. La réponse politique reste entièrement extraite du corpus, sans génération de faits ni de positions."
  };
}

function sanitizeExpansionContext(raw) {
  if (!raw || typeof raw !== "object") return null;
  const query = String(raw.query || "").trim();
  const mode = String(raw.mode || "").trim();
  if (!query || query.length > 1200 || !MODES.has(mode)) return null;
  return { query, mode, retrievalAssisted: Boolean(raw.retrievalAssisted) };
}

function expansionFor(depth, mode, evidence, debug, retrievalQuery, retrievalAssisted) {
  if (depth !== "summary" || mode === "candidates" || !canExpandEvidence(evidence, debug)) return { available: false };
  return {
    available: true,
    context: {
      query: retrievalQuery,
      mode,
      retrievalAssisted: Boolean(retrievalAssisted)
    }
  };
}

// A cheap GET loads the exact same serverless bundle and search index as POST.
// The public landing can call it during browser idle time so a user's first real
// question usually arrives on a warm function, without spending an LLM token.
export async function GET() {
  return NextResponse.json({ ok: true, engine: ENGINE, warmup: true });
}

export async function POST(request) {
  if (limited(request)) return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({error:"Requête JSON invalide."},{status:400}); }
  const question = String(payload?.question || "").trim();
  if (!question || question.length > 1200) return NextResponse.json({error:"La question doit contenir entre 1 et 1200 caractères."},{status:400});

  const depth = payload?.depth === "deep" ? "deep" : "summary";
  const deepContext = depth === "deep" ? sanitizeExpansionContext(payload?.expansionContext) : null;
  const history = normalizeHistory(payload?.history);
  const incomingSession = sanitizeSuggestionSessionState(payload?.sessionContext || {});
  const context = deepContext
    ? { query: deepContext.query, inheritedMode: null, inheritedEntities: [], inheritedTopic: [] }
    : resolveDeterministicContext(question, history);
  let mode = deepContext?.mode || classifyDeterministicQuestion(question);
  if (mode === "overview" && context.inheritedMode) mode = context.inheritedMode;
  let retrievalQuery = context.query;
  let run = runRetrieval(retrievalQuery, mode, depth);
  run.debug = {...run.debug, conversation:context};

  if (String(run.debug.reason || "").startsWith("unsupported_")) {
    const answer = unsupportedAnswer(run.debug.reason);
    answer.followUps = depth === "deep" ? [] : suggestionsFor(question, question, [], history, incomingSession);
    const sessionContext = buildSuggestionSessionState(incomingSession, question, []);
    return response(answer, [], run.debug, false, sessionContext, { available: false }, depth);
  }

  let retrievalAssisted = Boolean(deepContext?.retrievalAssisted);
  let fallbackDebug = null;
  const noUsableEvidence = !run.evidence.length || (run.candidateTargeted && !run.debug.answerable);

  // Deepening must remain zero-model: it either reuses the already resolved retrieval query
  // or stays on deterministic retrieval if a caller omits/invalidates the expansion context.
  if (depth === "summary" && noUsableEvidence && shouldAttemptRetrievalFallback(run.debug)) {
    if (fallbackLimited(request)) {
      fallbackDebug = { attempted: false, accepted: false, error: "fallback_rate_limited" };
    } else {
      const fallback = await interpretRetrievalWithModel(question, history);
      const interpretation = withInheritedFallbackContext(fallback.interpretation, context.inheritedEntities);
      const comparisonContextValid = interpretation?.intent !== "comparison" || interpretation.entityIds?.length >= 2;
      fallbackDebug = {
        attempted: fallback.attempted,
        accepted: Boolean(interpretation && comparisonContextValid),
        error: fallback.error || (!comparisonContextValid ? "fallback_comparison_context_incomplete" : null)
      };

      if (interpretation && comparisonContextValid) {
        const safeQuery = buildFallbackRetrievalQuery(interpretation);
        const fallbackMode = modeFromFallback(interpretation, mode);
        const fallbackRun = runRetrieval(safeQuery, fallbackMode, depth);
        if (fallbackRun.evidence.length && fallbackRun.debug.answerable) {
          retrievalAssisted = true;
          retrievalQuery = safeQuery;
          mode = fallbackMode;
          run = fallbackRun;
        }
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
    answer.followUps = depth === "deep" ? [] : suggestionsFor(retrievalQuery, question, [], history, incomingSession);
    const sessionContext = buildSuggestionSessionState(incomingSession, retrievalQuery, []);
    return response(answer, [], run.debug, retrievalAssisted, sessionContext, { available: false }, depth);
  }

  if (!run.evidence.length || (run.candidateTargeted && !run.debug.answerable)) {
    const answer = noDataAnswer(question, run.debug.requestedEntities || []);
    answer.followUps = depth === "deep" ? [] : suggestionsFor(retrievalQuery, question, [], history, incomingSession);
    const sessionContext = buildSuggestionSessionState(incomingSession, retrievalQuery, []);
    return response(answer, [], run.debug, retrievalAssisted, sessionContext, { available: false }, depth);
  }

  const answerQuestion = retrievalAssisted ? retrievalQuery : question;
  const compactEvidence = enrichEvidence(run.evidence);
  const evidence = depth === "deep"
    ? expandEvidence(compactEvidence, { maxEvidence: mode === "comparison" ? 44 : 36, chunksPerSource: 3 })
    : compactEvidence;
  let answer = depth === "deep"
    ? composeDeepAnswer(answerQuestion, evidence, {
      mode,
      candidates:run.candidates,
      requestedEntities:run.debug.requestedEntities || [],
      candidateTargeted:run.candidateTargeted
    })
    : composeDeterministicAnswer(answerQuestion,evidence,{
      mode,
      candidates:run.candidates,
      requestedEntities:run.debug.requestedEntities || [],
      candidateTargeted:run.candidateTargeted
    });
  answer.followUps = depth === "deep" ? [] : suggestionsFor(answerQuestion, question, evidence, history, incomingSession);
  answer = finalizeAnswer(answer, retrievalAssisted);
  const sessionContext = buildSuggestionSessionState(incomingSession, answerQuestion, evidence);
  const expansion = expansionFor(depth, mode, compactEvidence, run.debug, retrievalQuery, retrievalAssisted);
  return response(answer, evidence, run.debug, retrievalAssisted, sessionContext, expansion, depth);
}
