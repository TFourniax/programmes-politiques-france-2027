import { NextResponse } from "next/server";
import { retrieve } from "../../../lib/retrieval.js";
import { answerWithModel } from "../../../lib/llm.js";
import {
  candidateEvidence,
  classifyQuestion,
  fallbackStructuredAnswer,
  hydrateStructuredAnswer,
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

function supportedFollowUp(question) {
  if (selectCandidates(question).length) return true;
  return retrieve(question,{limit:3,minScore:2.1}).results.length > 0;
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

  let evidence;
  let retrievalDebug;
  if (mode === "candidates") {
    evidence = candidates.map(candidateEvidence);
    retrievalDebug = { mode, directCandidateRecords:candidates.length, query:question };
  } else {
    const limit = mode === "comparison" ? 12 : mode === "measures" ? 10 : 8;
    const retrieval = retrieve(retrievalQuery,{limit});
    evidence = retrieval.results;
    retrievalDebug = {...retrieval.debug, mode, query:retrievalQuery};
  }

  if (!evidence.length) {
    const answer = fallbackStructuredAnswer(question,[],{mode,candidates});
    return NextResponse.json({answer,citations:[],retrieval:retrievalDebug,generated:false,providerError:null});
  }

  const model = await answerWithModel(question,evidence,{mode,history});
  const answer = hydrateStructuredAnswer(model.answer,question,evidence,{mode,candidates});
  answer.followUps = answer.followUps.filter((item) => item !== question && supportedFollowUp(item)).slice(0,3);

  return NextResponse.json({
    answer,
    citations:citationsFromEvidence(evidence),
    retrieval:retrievalDebug,
    generated:model.generated,
    providerError:model.error||null
  });
}
