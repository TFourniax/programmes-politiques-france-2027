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
      deployment: {
        commitRef: process.env.DEPLOY_COMMIT_REF || ""
      },
      snapshotDate: meta.snapshotDate,
      counts: meta.counts,
      indexVersion: meta.indexVersion,
      chat: {
        engine: "deterministic-bm25-ontology-v4",
        responseGeneration: "deterministic_extractive",
        edgeRateLimit: { requests: 30, seconds: 60 },
        semanticFallback: {
          enabled: fallback.enabled,
          configured: fallback.configured,
          providerHost: fallback.providerHost,
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
        lastDirectFeedRunAt: watchHealth.last_direct_feed_run_at || null,
        lastStructuredPrimaryRunAt: watchHealth.last_structured_primary_run_at || null,
        lastPromotionRunAt: watchHealth.last_promotion_run_at,
        geminiAvailable: watchHealth.gemini_available,
        pendingWork: watchHealth.pending_work,
        rawOfficialSourceWarnings: watchHealth.official_source_warnings_last_run || 0,
        coveredOfficialSourceWarnings: watchHealth.covered_official_source_warnings_last_run || 0,
        uncoveredOfficialSourceWarnings: watchHealth.uncovered_official_source_warnings_last_run || 0,
        equivalentPrimaryCoverage: watchHealth.equivalent_primary_coverage_count || 0,
        structuredPrimaryCoverage: watchHealth.structured_primary_coverage_count || 0,
        alternateOfficialFeedCoverage: watchHealth.alternate_official_feed_coverage_count || 0,
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
