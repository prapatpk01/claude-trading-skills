import { NextRequest, NextResponse } from "next/server";
import { runScan, DEFAULT_UNIVERSE } from "@/lib/scan";
import { dailyCandles } from "@/lib/marketData";
import { assessRegime } from "@/lib/team/governance";
import {
  rankGroups, regimePlaybook, buildThematicUniverse, THEME_PROXIES,
} from "@/lib/team/thematic";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers");
  const thematic = req.nextUrl.searchParams.get("thematic") !== "0";
  const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));

  try {
    // An explicit ticker list always wins — the user asked for those names.
    if (raw) {
      const universe = raw
        .split(",").map((t) => t.trim().toUpperCase())
        .filter((t) => /^[A-Z.\-]{1,10}$/.test(t));
      return NextResponse.json({ ...(await runScan(universe.slice(0, 20), topN)), universeSource: "explicit" });
    }

    if (!thematic) {
      return NextResponse.json({ ...(await runScan(DEFAULT_UNIVERSE, topN)), universeSource: "default" });
    }

    // Build the universe from what is actually leading, gated by the regime.
    // A fixed list of last cycle's winners only ever finds last cycle's trades.
    const spy = await dailyCandles("SPY", 300).catch(() => [] as Candle[]);
    const regime = spy.length ? assessRegime(spy) : null;
    const playbook = regimePlaybook(regime);

    const proxyCandles: Record<string, Candle[]> = {};
    await Promise.all(
      THEME_PROXIES.map(async (t) => {
        const c = await dailyCandles(t, 300).catch(() => [] as Candle[]);
        if (c.length) proxyCandles[t] = c;
      })
    );
    const ranked = spy.length ? rankGroups(proxyCandles, spy) : [];
    const themed = buildThematicUniverse(ranked, playbook, 20);

    if (!themed.tickers.length) {
      // Say why, rather than quietly falling back to the fixed list. A scan
      // that returns nothing because the regime forbids new risk is a finding,
      // not a failure.
      return NextResponse.json({
        setups: [], rejected: [], scanned: 0, sentinel: {}, samp: {},
        regime: regime ?? null,
        playbook,
        themes: ranked.slice(0, 8),
        universeSource: "thematic",
        universeNote: themed.note,
        warnings: [],
        sources: ["Daily price history", "Sector and theme proxy ETFs measured against SPY"],
      });
    }

    const result = await runScan(themed.tickers, topN);
    return NextResponse.json({
      ...result,
      playbook,
      themes: themed.groups,
      universeSource: "thematic",
      universeNote: themed.note,
      universe: themed.tickers,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Scan failed" }, { status: 500 });
  }
}
