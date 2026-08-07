import { NextResponse } from "next/server";
import { retrieve } from "../../../lib/retrieval.js";
import { answerWithModel } from "../../../lib/llm.js";

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

export async function POST(request) {
  if (limited(request)) return NextResponse.json({error:"Trop de requêtes. Réessayez dans une minute."},{status:429});
  let payload;
  try { payload = await request.json(); } catch { return NextResponse.json({error:"Requête JSON invalide."},{status:400}); }
  const question = String(payload?.question || "").trim();
  if (!question || question.length > 1200) return NextResponse.json({error:"La question doit contenir entre 1 et 1200 caractères."},{status:400});
  const retrieval = retrieve(question,{limit:8});
  if (!retrieval.results.length) return NextResponse.json({answer:"Je n’ai pas trouvé d’élément suffisamment pertinent dans le corpus actuel pour répondre sans extrapoler.",citations:[],retrieval:retrieval.debug,generated:false});
  const model = await answerWithModel(question,retrieval.results);
  return NextResponse.json({answer:model.answer,citations:retrieval.results.map((item,index)=>({number:index+1,...item.citation,score:item.score})),retrieval:retrieval.debug,generated:model.generated,providerError:model.error||null});
}
