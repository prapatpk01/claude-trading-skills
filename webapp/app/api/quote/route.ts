import { NextRequest, NextResponse } from "next/server";
import { getLightQuote } from "@/lib/marketData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? req.nextUrl.searchParams.get("ticker") ?? "";
  const tickers = raw.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 25);
  if (tickers.length === 0) return NextResponse.json({ quotes: {} });

  const quotes: Record<string, { price: number; changePercent: number } | null> = {};
  for (const t of tickers) {
    try {
      const q = await getLightQuote(t);
      quotes[t] = q ? { price: q.price, changePercent: q.changePercent } : null;
    } catch {
      quotes[t] = null;
    }
  }
  return NextResponse.json({ quotes });
}
