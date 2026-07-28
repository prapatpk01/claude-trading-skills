import { NextRequest, NextResponse } from "next/server";
import { runScan, DEFAULT_UNIVERSE } from "@/lib/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers");
  const universe = raw
    ? raw.split(",").map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.\-]{1,10}$/.test(t))
    : DEFAULT_UNIVERSE;
  const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));
  try {
    const result = await runScan(universe.slice(0, 20), topN);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Scan failed" }, { status: 500 });
  }
}
