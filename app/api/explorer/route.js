import { NextResponse } from "next/server";
import { buildCandidateProfile, buildComparison, buildQuiz, buildTopicExplorer, getExplorerMeta } from "../../../lib/explorer-attribution.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "meta";

    if (view === "meta") return NextResponse.json(getExplorerMeta());
    if (view === "candidate") return NextResponse.json(buildCandidateProfile(searchParams.get("id")));
    if (view === "comparison") return NextResponse.json(buildComparison(csv(searchParams.get("candidates")), csv(searchParams.get("topics"))));
    if (view === "topic") return NextResponse.json(buildTopicExplorer(searchParams.get("id")));
    if (view === "quiz") return NextResponse.json(buildQuiz(searchParams.get("topic") || null, 8));

    return NextResponse.json({ error: "Vue inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Erreur explorer" }, { status: 400 });
  }
}
