import { NextResponse } from "next/server";
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
      indexVersion: meta.indexVersion
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error?.message || "Erreur inconnue du runtime"
    }, { status: 500 });
  }
}
