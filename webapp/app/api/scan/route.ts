import { NextRequest, NextResponse } from "next/server";
import { runScan, DEFAULT_UNIVERSE } from "@/lib/scan";
import { runDividendScan } from "@/lib/dividendScan";
import { runThematicPortfolio, type RebalanceCadence } from "@/lib/thematicPortfolio";
import { universeForSector } from "@/lib/sectorUniverse";
import { dailyCandles } from "@/lib/marketData";
import { assessRegime } from "@/lib/team/governance";
import { rankGroups, regimePlaybook, buildThematicUniverse, THEME_PROXIES } from "@/lib/team/thematic";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers");
  const rawMode = req.nextUrl.searchParams.get("mode");
  const mode: "momentum"|"dividend"|"thematic" = rawMode === "dividend" ? "dividend" : rawMode === "thematic" ? "thematic" : "momentum";
  const sector = req.nextUrl.searchParams.get("sector") || "All";
  const thematic = req.nextUrl.searchParams.get("thematic") !== "0";
  const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));

  try {
    const explicit = raw ? raw.split(",").map(t => t.trim().toUpperCase()).filter(t => /^[A-Z.\-]{1,10}$/.test(t)).slice(0, 20) : null;

    if (mode === "thematic") {
      const holdings = Math.min(10, Math.max(5, parseInt(req.nextUrl.searchParams.get("holdings") ?? "8", 10) || 8));
      const cadence: RebalanceCadence = req.nextUrl.searchParams.get("cadence") === "quarterly" ? "quarterly" : "monthly";
      return NextResponse.json(await runThematicPortfolio(holdings, cadence));
    }

    if (mode === "dividend") {
      const universe = explicit?.length ? explicit : universeForSector(sector);
      return NextResponse.json({ ...(await runDividendScan(universe, topN)), universeSource: explicit?.length ? "explicit" : "sector", sector, universe });
    }
    if (explicit?.length) return NextResponse.json({ ...(await runScan(explicit, topN)), mode: "momentum", universeSource: "explicit", sector });
    if (sector !== "All") {
      const universe = universeForSector(sector);
      return NextResponse.json({ ...(await runScan(universe, topN)), mode: "momentum", universeSource: "sector", sector, universe });
    }
    if (!thematic) return NextResponse.json({ ...(await runScan(DEFAULT_UNIVERSE, topN)), mode: "momentum", universeSource: "default", sector });

    const spy = await dailyCandles("SPY", 300).catch(() => [] as Candle[]);
    const regime = spy.length ? assessRegime(spy) : null;
    const playbook = regimePlaybook(regime);
    const proxyCandles: Record<string, Candle[]> = {};
    await Promise.all(THEME_PROXIES.map(async t => { const c = await dailyCandles(t, 300).catch(() => [] as Candle[]); if (c.length) proxyCandles[t] = c; }));
    const ranked = spy.length ? rankGroups(proxyCandles, spy) : [];
    const themed = buildThematicUniverse(ranked, playbook, 20);
    if (!themed.tickers.length) return NextResponse.json({ setups: [], rejected: [], scanned: 0, sentinel: {}, samp: {}, regime: regime ?? null, playbook, themes: ranked.slice(0, 8), universeSource: "thematic", universeNote: themed.note, warnings: [], sources: ["Daily price history", "Sector and theme proxy ETFs measured against SPY"], mode: "momentum", sector });
    const result = await runScan(themed.tickers, topN, { themes: ranked });
    return NextResponse.json({ ...result, playbook, themes: themed.groups, universeSource: "thematic", universeNote: themed.note, universe: themed.tickers, mode: "momentum", sector });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Scan failed" }, { status: 500 });
  }
}
