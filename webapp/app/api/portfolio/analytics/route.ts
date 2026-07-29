import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { buildPerformance } from "@/lib/performance";
import { buildDividendSummary } from "@/lib/dividends";
import { getLightQuote } from "@/lib/marketData";
import { openOnly } from "@/lib/openPositions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Open positions only. Performance, dividends and the calendar all describe
 * the book as it stands, so a sold position must not appear in them — it would
 * promise income from shares nobody owns.
 */
async function loadHoldings(): Promise<{ ticker: string; shares: number; avg_cost: number }[]> {
  const sb = getSupabase();
  if (sb) {
    let { data, error } = await sb.from("holdings").select("ticker,shares,avg_cost,closed_at");
    if (error && /closed_at/i.test(error.message)) {
      // The date migration has not been run — every row is treated as open.
      ({ data, error } = await sb.from("holdings").select("ticker,shares,avg_cost"));
    }
    if (error) throw new Error(error.message);
    return openOnly((data ?? []) as any[]) as any[];
  }
  return openOnly(memStore.holdings).map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost }));
}

export async function GET(req: NextRequest) {
  const days = Math.min(1825, Math.max(30, parseInt(req.nextUrl.searchParams.get("days") ?? "365", 10) || 365));
  try {
    const holdings = await loadHoldings();
    if (!holdings.length) {
      return NextResponse.json({ performance: null, dividends: null, empty: true });
    }

    // current prices, used for yields and as a fallback valuation
    const prices: Record<string, number | null> = {};
    await Promise.all(
      Array.from(new Set(holdings.map((h) => h.ticker))).map(async (t) => {
        const q = await getLightQuote(t).catch(() => null);
        prices[t] = q?.price ?? null;
      })
    );

    const [performance, dividends] = await Promise.all([
      buildPerformance(holdings.map((h) => ({ ticker: h.ticker, shares: h.shares })), days).catch(() => null),
      buildDividendSummary(holdings, prices).catch(() => null),
    ]);

    return NextResponse.json({ performance, dividends, prices, empty: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Analytics failed" }, { status: 500 });
  }
}
