import { NextResponse } from "next/server";
import { buildHistoryTimeline, getHistoryMeta } from "../../../lib/history.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "meta";
    if (view === "meta") return NextResponse.json(getHistoryMeta());
    if (view === "timeline") {
      const entity = searchParams.get("entity") || "";
      const topic = searchParams.get("topic") || null;
      if (!entity) return NextResponse.json({ error: "Acteur requis" }, { status: 400 });
      return NextResponse.json(buildHistoryTimeline(entity, topic));
    }
    return NextResponse.json({ error: "Vue historique inconnue" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Erreur historique" }, { status: 400 });
  }
}
