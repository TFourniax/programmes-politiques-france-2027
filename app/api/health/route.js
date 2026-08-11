import { NextResponse } from "next/server";
import bundledWatchHealth from "../../../research/veille/health.json" with { type: "json" };
import { getMeta } from "../../../lib/retrieval.js";
import { retrievalFallbackStatus } from "../../../lib/retrieval-fallback.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WATCH_HEALTH_URL = process.env.WATCH_HEALTH_URL ||
  "https://raw.githubusercontent.com/TFourniax/programmes-politiques-france-2027/main/research/veille/health.json";

async function readWatchHealth() {
  try {
    const response = await fetch(WATCH_HEALTH_URL, {
      headers: { accept: "application/json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) throw new Error(`watch health HTTP ${response.status}`);
    const health = await response.json();
    if (!health || typeof health !== "object" || !health.last_collection_success_at) {
      throw new Error("watch health payload invalid");
    }
    return { health, source: "github_live" };
  } catch {
    return { health: bundledWatchHealth, source: "build_fallback" };
  }
}

export async function GET() {
  try {
    const meta = getMeta();
    const { health: watchHealth, source: watchSource } = await readWatchHealth();
    const fallback = retrievalFallbackStatus();
    return NextResponse.json({
      ok: true,
      runtime: "nodejs",
      snapshotDate: meta.snapshotDate,
      counts: meta.counts,
      indexVersion: meta.indexVersion,
      chat: {
        engine: "deterministic-bm25-ontology-v4",
        responseGeneration: "deterministic_extractive",
        edgeRateLimit: { requests: 8, seconds: 60 },
        semanticFallback: {
          enabled: fallback.enabled,
          configured: fallback.configured,
          model: fallback.model,
          timeoutMs: fallback.timeoutMs,
          circuitOpen: fallback.circuitOpen,
          consecutiveFailures: fallback.consecutiveFailures,
          role: "retrieval_interpretation_only"
        }
      },
      watch: {
        source: watchSource,
        status: watchHealth.status,
        generatedAt: watchHealth.generated_at,
        lastCollectionSuccessAt: watchHealth.last_collection_success_at,
        lastPromotionRunAt: watchHealth.last_promotion_run_at,
        geminiAvailable: watchHealth.gemini_available,
        pendingWork: watchHealth.pending_work,
        persistentOfficialSourceFailures: watchHealth.persistent_official_source_failures || 0,
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
