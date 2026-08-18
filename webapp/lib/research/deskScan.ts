// The research desk's own sourcing run.
//
// Automatic discovery is deliberately bounded to the CIO-approved universe:
// S&P 500 + Nasdaq-100 + Russell 2000. A user may still explicitly type a ticker
// for one-off analysis, but the desk itself never widens discovery to every US
// listing or to the SEC registrant master list.

import { dailyCandles } from "@/lib/marketData";
import { getSecFundamentals } from "@/lib/sec";
import { runSwingScan, type SwingCandidate, type SwingScanResult } from "@/lib/team/swing";
import { assessCatalyst } from "@/lib/team/catalyst";
import { projectEarningsDates } from "@/lib/research";
import { universeForSector } from "@/lib/sectorUniverse";
import { buildRotatingMarketUniverse, loadThreeIndexUniverse } from "@/lib/research/marketUniverse";
import type { Candle } from "@/lib/types";

/** Names the desk will not source into: liquidity instruments and benchmarks. */
const NEVER_SOURCE = new Set(["SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);

export interface DeskScanOptions {
  /** Explicit names to scan. Explicit user analysis is not automatic discovery. */
  tickers?: string[] | null;
  sector?: string;
  /** How many setups to carry out of the scan. */
  topN?: number;
  /** How many approved-index names to pull history for in this request. */
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
  universeSource: "explicit" | "sector-approved-index" | "approved-three-index-universe";
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

/** Deterministic daily rotation for a caller-provided approved ticker set. */
export function buildDiscoveryUniverse(approvedTickers: string[], asOf = new Date()): string[] {
  const clean = Array.from(new Set(approvedTickers.map(ticker => String(ticker).trim().toUpperCase()).filter(ticker => /^[A-Z.\-]{1,10}$/.test(ticker))));
  if (!clean.length) return [];
  const seed = Math.floor(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()) / 86_400_000);
  return clean
    .map(ticker => {
      let hash = 2166136261;
      const value = `${seed}:${ticker}`;
      for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
      return { ticker, rank: hash >>> 0 };
    })
    .sort((left, right) => left.rank - right.rank || left.ticker.localeCompare(right.ticker))
    .map(row => row.ticker);
}

/**
 * Run the desk's scan.
 *
 * Automatic scans only use the three approved indexes. If one provider cannot
 * be reached, the warning is surfaced and the desk remains inside the index
 * families that did load; it never falls back to the full US market.
 */
export async function runDeskScan(options: DeskScanOptions = {}): Promise<DeskScanOutcome> {
  const {
    tickers = null,
    sector = "All",
    topN = 5,
    universeLimit = 48,
    catalystLimit = 24,
    exclude = [],
  } = options;

  const warnings: string[] = [];
  const explicit = tickers?.length ? normalizeTickers(tickers) : null;
  const blocked = new Set([...NEVER_SOURCE, ...Array.from(exclude, (t) => String(t).toUpperCase())]);

  let base: string[] = [];
  let universeSource: DeskScanOutcome["universeSource"];
  if (explicit) {
    base = explicit;
    universeSource = "explicit";
  } else if (sector === "All") {
    const market = await buildRotatingMarketUniverse({ exclude: blocked, detailedLimit: universeLimit });
    warnings.push(...market.warnings);
    base = market.queue.map(row => row.ticker);
    universeSource = "approved-three-index-universe";
  } else {
    const approved = await loadThreeIndexUniverse();
    warnings.push(...approved.warnings);
    const allowed = new Set(approved.masterTickers);
    base = buildDiscoveryUniverse(universeForSector(sector).filter(ticker => allowed.has(ticker.toUpperCase())));
    universeSource = "sector-approved-index";
  }

  // Explicit one-off analysis is honoured as supplied. Automatic discovery
  // skips holdings/reserves and is already guaranteed to be inside the approved indexes.
  const universe = (explicit ? base : base.filter((t) => !blocked.has(t.toUpperCase()))).slice(0, universeLimit);
  if (!universe.length) {
    throw new Error(explicit ? "No valid US-listed ticker symbols were supplied." : `No approved-index research names are available for sector ${sector}.`);
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
  // name without one is scored zero for that component under Rule #5.
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
    universeSource,
    sector,
  };
}
