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
import { avgVolume, ema, relativeStrength, rsi, upDownVolumeRatio } from "@/lib/indicators";
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
  /** How many technically strongest names survive the cheap pre-screen. */
  technicalLimit?: number;
  /** How many of the technical shortlist get a catalyst read, which costs an SEC call each. */
  catalystLimit?: number;
  /** Administrative exclusions only. Do not use holdings/watchlist as an automatic universe definition. */
  exclude?: Iterable<string>;
}

export interface DeskScanOutcome {
  result: SwingScanResult;
  warnings: string[];
  universe: string[];
  universeSource: "explicit" | "sector-approved-index" | "approved-three-index-universe";
  sector: string;
  funnel: {
    approvedMaster: number | null;
    scheduled: number;
    withHistory: number;
    technicalShortlist: number;
    catalystEnriched: number;
    deepScored: number;
  };
}

type TechnicalRow = {
  ticker: string;
  candles: Candle[];
  preScore: number;
};

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
 * Cheap first-pass ranking using only price/volume evidence already fetched for
 * the swing scan. It decides who deserves expensive catalyst/fundamental work;
 * it never declares a trade and therefore does not bypass the full swing gates.
 */
function technicalPreScore(ticker: string, candles: Candle[], spy: Candle[]): TechnicalRow {
  const closes = candles.map(candle => candle.close);
  const price = closes.at(-1) ?? 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const rs30 = relativeStrength(candles, spy, 30);
  const rsi14 = rsi(closes, 14);
  const avg5 = avgVolume(candles, 5);
  const avg20 = avgVolume(candles, 20);
  const volumeRatio = avg5 != null && avg20 != null && avg20 > 0 ? avg5 / avg20 : null;
  const upDown = upDownVolumeRatio(candles, 10);

  let score = 0;
  if (rs30 != null) score += rs30 >= 1.10 ? 30 : rs30 >= 1.03 ? 24 : rs30 >= 1 ? 18 : Math.max(0, 18 - (1 - rs30) * 120);
  if (rsi14 != null) score += rsi14 >= 55 && rsi14 <= 75 ? 20 : rsi14 >= 50 && rsi14 <= 80 ? 12 : 4;
  if (e20 != null && price > e20) score += 15;
  if (e20 != null && e50 != null && e20 > e50) score += 10;
  if (volumeRatio != null) score += volumeRatio >= 1.5 ? 15 : volumeRatio >= 1.1 ? 10 : volumeRatio >= .9 ? 5 : 0;
  if (upDown != null) score += upDown >= 1.5 ? 10 : upDown >= 1 ? 6 : 0;

  return { ticker, candles, preScore: Math.round(Math.max(0, Math.min(100, score))) };
}

/**
 * Run the desk's scan.
 *
 * Automatic scans only use the three approved indexes. The expensive part is a
 * funnel: rotate an index-balanced batch, fetch candles, rank technically, then
 * enrich only the strongest names with SEC/catalyst evidence before the full
 * swing engine applies its hard execution gates.
 */
export async function runDeskScan(options: DeskScanOptions = {}): Promise<DeskScanOutcome> {
  const {
    tickers = null,
    sector = "All",
    topN = 5,
    universeLimit = 56,
    technicalLimit = 32,
    catalystLimit = 18,
    exclude = [],
  } = options;

  const warnings: string[] = [];
  const explicit = tickers?.length ? normalizeTickers(tickers) : null;
  const blocked = new Set([...NEVER_SOURCE, ...Array.from(exclude, (t) => String(t).toUpperCase())]);

  let base: string[] = [];
  let approvedMaster: number | null = null;
  let universeSource: DeskScanOutcome["universeSource"];
  if (explicit) {
    base = explicit;
    universeSource = "explicit";
  } else if (sector === "All") {
    const market = await buildRotatingMarketUniverse({ exclude: blocked, detailedLimit: universeLimit });
    warnings.push(...market.warnings);
    base = market.queue.map(row => row.ticker);
    approvedMaster = market.masterUniverseSize;
    universeSource = "approved-three-index-universe";
  } else {
    const approved = await loadThreeIndexUniverse();
    warnings.push(...approved.warnings);
    approvedMaster = approved.masterUniverseSize;
    const allowed = new Set(approved.masterTickers);
    base = buildDiscoveryUniverse(universeForSector(sector).filter(ticker => allowed.has(ticker.toUpperCase())));
    universeSource = "sector-approved-index";
  }

  // Explicit one-off analysis is honoured as supplied. Automatic discovery is
  // already guaranteed to be inside the approved indexes and respects only
  // explicit administrative exclusions supplied by the caller.
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

  const withCandles = await mapLimit(universe, 6, async (ticker) => ({
    ticker,
    candles: await dailyCandles(ticker, 260).catch(() => [] as Candle[]),
  }));

  const viable = withCandles.filter((row) => row.candles.length >= 80);
  const ranked = viable
    .map(row => technicalPreScore(row.ticker, row.candles, spy))
    .sort((left, right) => right.preScore - left.preScore || left.ticker.localeCompare(right.ticker));

  // Manual analysis should not silently discard a ticker the user explicitly
  // supplied. Automatic discovery uses the technical funnel to bound deep work.
  const technicalShortlist = explicit ? ranked : ranked.slice(0, Math.max(topN, Math.min(technicalLimit, ranked.length)));
  const catalystTargets = technicalShortlist.slice(0, Math.min(catalystLimit, technicalShortlist.length));

  const enriched = await mapLimit(catalystTargets, 4, async ({ ticker, candles }) => {
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
      } satisfies SwingCandidate;
    } catch {
      return { ticker, candles, catalystScore: null, catalystNote: null } satisfies SwingCandidate;
    }
  });

  const catalystByTicker = new Map(enriched.map(candidate => [candidate.ticker, candidate]));
  const candidates: SwingCandidate[] = technicalShortlist.map(({ ticker, candles }) =>
    catalystByTicker.get(ticker) ?? { ticker, candles, catalystScore: null, catalystNote: null }
  );

  const noHistory = withCandles.filter((row) => row.candles.length < 80).map((row) => row.ticker);
  if (noHistory.length) warnings.push(`Insufficient price history for ${noHistory.join(", ")} — excluded before technical pre-screen.`);

  return {
    result: runSwingScan(candidates, { spy, qqq, vix }, topN),
    warnings,
    universe,
    universeSource,
    sector,
    funnel: {
      approvedMaster,
      scheduled: universe.length,
      withHistory: viable.length,
      technicalShortlist: technicalShortlist.length,
      catalystEnriched: enriched.length,
      deepScored: candidates.length,
    },
  };
}
