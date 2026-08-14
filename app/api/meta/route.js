import { NextResponse } from "next/server";
import runtimeMeta from "../../../data/runtime-meta.json" with { type: "json" };

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({
    snapshotDate: runtimeMeta.snapshotDate,
    counts: runtimeMeta.counts,
    indexVersion: runtimeMeta.indexVersion,
    builtAt: runtimeMeta.builtAt
  });
}
