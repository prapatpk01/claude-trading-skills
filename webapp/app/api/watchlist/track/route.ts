import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { dailyCandles } from "@/lib/marketData";
import { evaluateIdea, summariseIdeas, type IdeaOutcome } from "@/lib/watchTracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadWatchlist(): Promise<any[]> {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("watchlist").select("*").order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }
  return memStore.watchlist as any[];
}

export async function GET() {
  try {
    const items = await loadWatchlist();
    if (!items.length) return NextResponse.json({ rows: [], summary: null });

    const rows = await Promise.all(
      items.slice(0, 30).map(async (w) => {
        const addedOn = (w.created_at ?? new Date().toISOString()).slice(0, 10);
        // enough history to cover the holding period plus a margin
        const candles = await dailyCandles(w.ticker, 400).catch(() => []);
        const outcome: IdeaOutcome = evaluateIdea(
          {
            addedOn,
            entry: w.entry_price ?? null,
            target: w.target_price ?? w.alert_price ?? null,
            stop: w.stop_price ?? null,
          },
          candles
        );
        return {
          id: w.id,
          ticker: w.ticker,
          reason: w.reason ?? null,
          source: w.source ?? null,
          addedOn,
          outcome,
        };
      })
    );

    // resolved ideas first, then the ones still working
    const order: Record<string, number> = { "TARGET HIT": 0, STOPPED: 1, OPEN: 2, "NO LEVELS": 3, "NO DATA": 4 };
    rows.sort((a, b) => (order[a.outcome.status] ?? 9) - (order[b.outcome.status] ?? 9));

    return NextResponse.json({
      rows,
      summary: summariseIdeas(rows.map((r) => r.outcome)),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Tracking failed" }, { status: 500 });
  }
}
