// The research desk's own sourcing run.
//
// Until now a new name reached the committee only if a person opened the
// analysis workspace, researched a ticker and pressed "refer". If nobody did
// that, the meeting reviewed the existing book and proposed nothing — which
// reads, correctly, as a fund that never has an idea.
//
// This module is the desk doing its own job: it takes a universe, fetches the
// history and the catalyst read, and runs Maya's momentum model with Aisha's
// catalyst component through the four hard filters in lib/team/swing.ts. It
// fetches; every judgement stays in the engine.
//
// Both the standalone scanner route and the committee meeting call this, so
// the names the meeting debates are produced by the same code the scanner
// page shows — there is one scan in the fund, not two.

import { dailyCandles } from "@/lib/marketData";
import { getSecFundamentals } from "@/lib/sec";
import { runSwingScan, type SwingCandidate, type SwingScanResult } from "@/lib/team/swing";
import { assessCatalyst } from "@/lib/team/catalyst";
import { projectEarningsDates } from "@/lib/research";
import { MOMENTUM_V62_UNIVERSE } from "@/lib/momentumV62";
import { universeForSector } from "@/lib/sectorUniverse";
import type { Candle } from "@/lib/types";

/** Names the desk will not source into: liquidity instruments and benchmarks. */
const NEVER_SOURCE = new Set(["SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);

export interface DeskScanOptions {
  /** Explicit names to scan. When empty the sector universe is used. */
  tickers?: string[] | null;
  sector?: string;
  /** How many setups to carry out of the scan. */
  topN?: number;
  /** How many names to pull history for. Lower it when the caller is on a clock. */
  universeLimit?: number;
  /** How many of those get a catalyst read, which costs an SEC call each. */
  catalystLimit?: number;
  /** Names to leave out — usually what the fund already owns. */
  exclude?: Iterable<string>;
}

export interface DeskScanOutcome {
  result: SwingScanResult;
  warnings: string[];
  universe: string[];
  universeSource: "explicit" | "sector" | "high-beta-liquid-universe";
  sector: string;
}

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

/** Clean, de-duplicate and bound a caller-supplied ticker list. */
export function normalizeTickers(raw: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const ticker = String(part).trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Run the desk's scan.
 *
 * Throws only if the universe cannot be assembled; a data source that does not
 * answer produces a warning and a smaller scan, never a silent pass.
 */
export async function runDeskScan(options: DeskScanOptions = {}): Promise<DeskScanOutcome> {
  const {
    tickers = null,
    sector = "All",
    topN = 5,
    universeLimit = 36,
    catalystLimit = 24,
    exclude = [],
  } = options;

  const warnings: string[] = [];
  const explicit = tickers?.length ? tickers : null;
  const blocked = new Set([...NEVER_SOURCE, ...Array.from(exclude, (t) => String(t).toUpperCase())]);

  const base = explicit ?? (sector === "All" ? MOMENTUM_V62_UNIVERSE : universeForSector(sector));
  // An explicit request is honoured as given; a universe scan skips what the
  // fund already owns, since an existing line is an ADD motion, not a new one.
  const universe = (explicit ? base : base.filter((t) => !blocked.has(t.toUpperCase()))).slice(0, universeLimit);
  if (!universe.length) {
    throw new Error(explicit ? "No valid US-listed ticker symbols were supplied." : `No universe is configured for sector ${sector}.`);
  }

  // The regime filter runs before anything else, so the benchmarks come first.
  const [spy, qqq, vix] = await Promise.all([
    dailyCandles("SPY", 200).catch(() => [] as Candle[]),
    dailyCandles("QQQ", 200).catch(() => [] as Candle[]),
    dailyCandles("^VIX", 90).catch(() => [] as Candle[]),
  ]);
  if (!spy.length) warnings.push("SPY history unavailable — relative strength and the regime filter could not be measured.");
  if (!vix.length) warnings.push("VIX history unavailable — the volatility half of the regime filter is missing.");

  const withCandles = await mapLimit(universe, 5, async (ticker) => ({
    ticker,
    candles: await dailyCandles(ticker, 260).catch(() => [] as Candle[]),
  }));

  const viable = withCandles.filter((c) => c.candles.length >= 80);
  const shortlist = viable.slice(0, catalystLimit);

  // Catalyst reads cost an SEC call each, so only the shortlist gets one. A
  // name without one is scored over the components that were measured, and
  // Rule #5 keeps the unread catalyst in the denominator rather than excusing it.
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

  for (const { ticker, candles } of viable.slice(catalystLimit)) {
    candidates.push({ ticker, candles, catalystScore: null, catalystNote: null });
  }

  const noHistory = withCandles.filter((c) => c.candles.length < 80).map((c) => c.ticker);
  if (noHistory.length) warnings.push(`Insufficient price history for ${noHistory.join(", ")} — excluded before scoring.`);

  return {
    result: runSwingScan(candidates, { spy, qqq, vix }, topN),
    warnings,
    universe,
    universeSource: explicit ? "explicit" : sector === "All" ? "high-beta-liquid-universe" : "sector",
    sector,
  };
}
