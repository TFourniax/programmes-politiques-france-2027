import { NextResponse } from "next/server";
import watchHealth from "../../../research/veille/health.json" with { type: "json" };
import { getMeta } from "../../../lib/retrieval.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const meta = getMeta();
    return NextResponse.json({
      ok: true,
      runtime: "nodejs",
      snapshotDate: meta.snapshotDate,
      counts: meta.counts,
      indexVersion: meta.indexVersion,
      watch: {
        status: watchHealth.status,
        generatedAt: watchHealth.generated_at,
        lastCollectionSuccessAt: watchHealth.last_collection_success_at,
        lastPromotionRunAt: watchHealth.last_promotion_run_at,
        geminiAvailable: watchHealth.gemini_available,
        pendingWork: watchHealth.pending_work,
        reasons: watchHealth.reasons || []
      }
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error?.message || "Erreur inconnue du runtime"
    }, { status: 500 });
  }
}
