import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { buildPerformance } from "@/lib/performance";
import { buildDividendSummary } from "@/lib/dividends";
import { getLightQuote } from "@/lib/marketData";
import { openOnly } from "@/lib/openPositions";
import { loadOpenHoldings } from "@/lib/portfolioSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadHoldings(): Promise<{ ticker: string; shares: number; avg_cost: number; closed_at?: string | null }[]> {
  const sb = getSupabase();
  if (sb) {
    // Ledger-derived, so analytics and the cash buffer describe one portfolio.
    const read = await loadOpenHoldings(sb);
    return read.rows.map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost, closed_at: null }));
  }
  return openOnly(memStore.holdings)
    .filter((h) => Number(h.shares) > 0)
    .map((h) => ({ ticker: h.ticker, shares: Number(h.shares), avg_cost: Number(h.avg_cost) || 0, closed_at: h.closed_at ?? null }));
}

const jsonNoStore = (body: any, init?: { status?: number }) => NextResponse.json(body, {
  ...(init ?? {}),
  headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
});

export async function GET(req: NextRequest) {
  const days = Math.min(1825, Math.max(30, parseInt(req.nextUrl.searchParams.get("days") ?? "365", 10) || 365));
  try {
    const holdings = await loadHoldings();
    if (!holdings.length) return jsonNoStore({ performance: null, dividends: null, empty: true });

    const prices: Record<string, number | null> = {};
    await Promise.all(Array.from(new Set(holdings.map((h) => h.ticker))).map(async (t) => {
      const q = await getLightQuote(t).catch(() => null);
      prices[t] = q?.price ?? null;
    }));

    const [performance, dividends] = await Promise.all([
      buildPerformance(holdings.map((h) => ({ ticker: h.ticker, shares: h.shares })), days).catch(() => null),
      buildDividendSummary(holdings, prices).catch(() => null),
    ]);

    return jsonNoStore({ performance, dividends, prices, empty: false, activeTickers: holdings.map((h) => h.ticker) });
  } catch (e: any) {
    return jsonNoStore({ error: e?.message ?? "Analytics failed" }, { status: 500 });
  }
}
