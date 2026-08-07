import { NextResponse } from "next/server";
import { getMeta } from "../../../lib/retrieval.js";

export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json(getMeta());
}
