import { NextRequest, NextResponse } from "next/server";
import { dailyCandles } from "@/lib/marketData";
import { getSecFundamentals } from "@/lib/sec";
import { runSwingScan, type SwingCandidate } from "@/lib/team/swing";
import { assessCatalyst } from "@/lib/team/catalyst";
import { projectEarningsDates } from "@/lib/research";
import { MOMENTUM_V62_UNIVERSE } from "@/lib/momentumV62";
import { universeForSector } from "@/lib/sectorUniverse";
import { ROSTER } from "@/lib/team/roster";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) break;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * Stage 2 of the investment meeting: the research desk's swing scan.
 *
 * Maya Chen's momentum model with Aisha Fontaine's catalyst component, run over
 * a universe and filtered by the brief's four hard rules. The route fetches;
 * every judgement lives in lib/team/swing.ts.
 */
export async function GET(req: NextRequest) {
  const warnings: string[] = [];
  try {
    const raw = req.nextUrl.searchParams.get("tickers");
    const sector = req.nextUrl.searchParams.get("sector") || "All";
    const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));
    const explicit = raw
      ? raw.split(",").map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z.\-]{1,10}$/.test(t)).slice(0, 40)
      : null;
    if (raw && !explicit?.length) {
      return NextResponse.json({ error: "No valid US-listed ticker symbols were supplied." }, { status: 400 });
    }

    const universe = explicit?.length
      ? explicit
      : sector === "All"
      ? MOMENTUM_V62_UNIVERSE.slice(0, 36)
      : universeForSector(sector);
    if (!universe.length) {
      return NextResponse.json({ error: `No universe is configured for sector ${sector}.` }, { status: 422 });
    }

    // The regime filter runs before anything else, so the benchmarks come first.
    const [spy, qqq, vix] = await Promise.all([
      dailyCandles("SPY", 200).catch(() => [] as Candle[]),
      dailyCandles("QQQ", 200).catch(() => [] as Candle[]),
      dailyCandles("^VIX", 90).catch(() => [] as Candle[]),
    ]);
    if (!spy.length) warnings.push("SPY history unavailable — relative strength and the regime filter could not be measured.");
    if (!vix.length) warnings.push("VIX history unavailable — the volatility half of the regime filter is missing.");

    // Candles for everything; fundamentals only for names that survive the
    // cheap structural read, so a 36-name scan does not make 36 SEC calls.
    const withCandles = await mapLimit(universe, 5, async (ticker) => ({
      ticker,
      candles: await dailyCandles(ticker, 260).catch(() => [] as Candle[]),
    }));

    const viable = withCandles.filter((c) => c.candles.length >= 80);
    const shortlist = viable.slice(0, 24);

    // Aisha's catalyst read for the shortlist. A name without one is scored
    // over the components that were measured, never credited with zero.
    const candidates: SwingCandidate[] = await mapLimit(shortlist, 4, async ({ ticker, candles }) => {
      try {
        const sec = await getSecFundamentals(ticker);
        const quarters = sec?.quarters ?? [];
        const projected = projectEarningsDates(quarters.map((q: any) => String(q?.end ?? q?.date ?? "")).filter(Boolean));
        const read = assessCatalyst({
          earnings: (sec as any)?.earnings ?? [],
          quarters,
          candles,
          benchmark: spy,
          nextEarningsDate: projected.dates[0] ?? null,
        });
        return {
          ticker,
          candles,
          catalystScore: read.score,
          catalystNote: read.score == null ? null : `${read.band}${read.pead?.driftPct == null ? "" : ` · measured PEAD ${read.pead.driftPct.toFixed(1)}% against the benchmark`}`,
        };
      } catch {
        return { ticker, candles, catalystScore: null, catalystNote: null };
      }
    });

    // Names beyond the shortlist still get scored, without a catalyst read.
    for (const { ticker, candles } of viable.slice(24)) {
      candidates.push({ ticker, candles, catalystScore: null, catalystNote: null });
    }
    const noHistory = withCandles.filter((c) => c.candles.length < 80).map((c) => c.ticker);
    if (noHistory.length) warnings.push(`Insufficient price history for ${noHistory.join(", ")} — excluded before scoring.`);

    const result = runSwingScan(candidates, { spy, qqq, vix }, topN);

    return NextResponse.json(
      {
        ...result,
        stage: "2 — Research: swing scan",
        owners: { score: ROSTER.maya.name, catalyst: ROSTER.aisha.name, execution: ROSTER.ryan.name },
        universeSource: explicit?.length ? "explicit" : sector === "All" ? "high-beta-liquid-universe" : "sector",
        sector,
        warnings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    const message = error?.message ?? "The swing scan failed.";
    return NextResponse.json({ error: message, retryable: /timeout|fetch|network|rate/i.test(message) }, { status: 500 });
  }
}
