import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";
import { runActiveFundV2 } from "@/lib/activeFundV2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown, limit: number) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => /^[A-Z.\-]{1,10}$/.test(x)))).slice(0, limit)
    : [];

async function buildReview(extraCandidates: string[] = []) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase portfolio source is unavailable.");

  const [holdingsRead, cash, watch] = await Promise.all([
    loadOpenHoldings(sb),
    buildCashBufferSnapshot(),
    sb.from("watchlist").select("ticker,stage").then((r: any) => r, () => ({ data: [], error: null })),
  ]);

  const watchlistTickers = Array.from(new Set([
    ...((watch.data ?? []).map((row: any) => String(row.ticker ?? "").trim().toUpperCase())),
    ...extraCandidates,
  ].filter((ticker: string) => /^[A-Z.\-]{1,10}$/.test(ticker))));

  const totalNav = Number(cash.totalNav ?? 0);
  if (!(totalNav > 0)) throw new Error("Verified Fund NAV is required before active rotation review.");

  const result = await runActiveFundV2({
    positions: holdingsRead.rows.map(row => ({ ticker: row.ticker, shares: Number(row.shares), avgCost: Number(row.avg_cost) })),
    watchlistTickers,
    cash: {
      totalNav,
      cashBalance: Number(cash.cashBalance ?? 0),
      dividendAvailable: Number(cash.dividendAvailable ?? 0),
      liquidityBuffer: Number(cash.liquidityBuffer ?? 0),
      cashFloorPct: Number(cash.cashFloorPct ?? cash.targetPct ?? 0),
      targetValue: Number(cash.targetValue ?? 0),
      bufferPct: cash.bufferPct == null ? null : Number(cash.bufferPct),
      reserveHoldings: (cash.reserveHoldings ?? []).map((row: any) => ({ ticker: String(row.ticker), marketValue: Number(row.marketValue ?? 0) })),
    },
  });

  return {
    ...result,
    sourceOfTruth: holdingsRead.origin,
    reconciliationNote: holdingsRead.note,
    watchlistCount: watchlistTickers.length,
  };
}

export async function GET() {
  try {
    return NextResponse.json(await buildReview(), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Active fund review failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const extraCandidates = cleanTickers(body?.candidateTickers, 25);
    return NextResponse.json(await buildReview(extraCandidates), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Active fund review failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
