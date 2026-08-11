import { NextResponse } from "next/server";
import { retrieveDeterministic } from "../../../lib/retrieval-v2.js";
import { composeDeterministicAnswer } from "../../../lib/deterministic-answer-v2.js";
import {
  candidateEvidence,
  classifyQuestion,
  resolveRetrievalQuery,
  selectCandidates
} from "../../../lib/presentation.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function noDataAnswer(question) {
  return {
    layout: "overview",
    title: "Aucune donnée pertinente dans le corpus",
    summary: `Le corpus ne contient pas d’élément suffisamment pertinent pour répondre à « ${question} ». Je préfère ne pas afficher de résultats approximatifs ou hors sujet.`,
    note: "La réponse reste strictement limitée aux données politiques versionnées dans le dépôt.",
    sections: [],
    cards: [],
    followUps: []
  };
}

export async function POST(request) {
  if (limited(request)) return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({error:"Requête JSON invalide."},{status:400}); }
  const question = String(payload?.question || "").trim();
  if (!question || question.length > 1200) return NextResponse.json({error:"La question doit contenir entre 1 et 1200 caractères."},{status:400});

  const history = normalizeHistory(payload?.history);
  const mode = classifyQuestion(question);
  const candidates = mode === "candidates" ? selectCandidates(question) : [];
  const retrievalQuery = resolveRetrievalQuery(question,history);

  let evidence = [];
  let retrievalDebug;

  if (mode === "candidates") {
    const scopeProbe = retrieveDeterministic(retrievalQuery,{limit:3});
    retrievalDebug = {...scopeProbe.debug, mode, directCandidateRecords:candidates.length, query:retrievalQuery};
    if (!scopeProbe.debug.answerable) {
      const answer = noDataAnswer(question);
      return NextResponse.json({answer,citations:[],retrieval:retrievalDebug,generated:false,providerError:null,engine:"deterministic-bm25-ontology-v1"});
    }
    evidence = candidates.map(candidateEvidence);
  } else {
    const limit = mode === "comparison" ? 14 : mode === "measures" ? 12 : 10;
    const retrieval = retrieveDeterministic(retrievalQuery,{limit});
    evidence = retrieval.results;
    retrievalDebug = {...retrieval.debug, mode, query:retrievalQuery};
    if (!evidence.length) {
      const answer = noDataAnswer(question);
      return NextResponse.json({answer,citations:[],retrieval:retrievalDebug,generated:false,providerError:null,engine:"deterministic-bm25-ontology-v1"});
    }
  }

  const answer = composeDeterministicAnswer(question,evidence,{mode,candidates});
  return NextResponse.json({
    answer,
    citations:citationsFromEvidence(evidence),
    retrieval:retrievalDebug,
    generated:false,
    providerError:null,
    engine:"deterministic-bm25-ontology-v1"
  });
}
