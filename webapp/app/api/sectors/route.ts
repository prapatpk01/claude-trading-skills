import { NextRequest, NextResponse } from "next/server";
import { getSectors } from "@/lib/sectors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Sector lookup for a list of tickers.
 *
 * Deliberately a pure lookup: the caller supplies the symbols it is already
 * displaying and does the weighting itself, so an allocation chart can never
 * describe a different set of positions from the table beside it.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 60);
  if (!tickers.length) return NextResponse.json({ sectors: {} });
  try {
    return NextResponse.json({ sectors: await getSectors(tickers) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Sector lookup failed" }, { status: 500 });
  }
}
