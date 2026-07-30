import { dailyCandles } from "./marketData";
import { computeTechnicals, computeMomentumScore, buildSwingSetup } from "./analysis";
import { ema, pctReturn, sma } from "./indicators";
import { scoreMomentumV3, type MomentumScoreV3 } from "./team/scoring";
import { readStructure, scoreEngineA, checkEntry, ENTRY_SCORE } from "./team/engines";
import { buildGrowthInput, bestGrowthPct } from "./team/growthInputs";
import { getSecFundamentals } from "./sec";
import { runSAMP, type SampResult } from "./team/samp";
import { computeBeta } from "./derive";
import { movesFromCandles, extendedHours, type PriceMoves } from "./priceMoves";
import type { MarketData, SwingSetup, Candle } from "./types";

/** Score floor to be presented at all — below this the model says REJECT. */
const WATCH_FLOOR = 42;
/** The swing brief calls for at least 1:3 reward:risk. */
const MIN_RR = 3;

// A pragmatic default liquid, high-beta momentum universe.
export const DEFAULT_UNIVERSE = [
  "NVDA", "AMD", "AVGO", "MSFT", "META", "AMZN", "GOOGL", "TSLA",
  "PLTR", "SMCI", "MU", "ARM", "CRWD", "NFLX", "UBER", "SHOP",
];

export interface MarketRegime {
  score: number; // 0-100
  stance: string;
  spyAboveEma20: boolean;
  spyReturn1m: number | null;
  realizedVol: number | null; // annualized %, VIX proxy
  note: string;
}

function realizedVolAnnualized(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i].close / slice[i - 1].close));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varc) * Math.sqrt(252) * 100;
}

export function assessRegime(spy: Candle[]): MarketRegime {
  const closes = spy.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const ema20 = ema(closes, 20);
  const spyAboveEma20 = ema20 != null && price > ema20;
  const ret1m = pctReturn(spy, 21);
  const vol = realizedVolAnnualized(spy, 20);

  let score = 50;
  if (spyAboveEma20) score += 20; else score -= 20;
  if (ret1m != null) score += Math.max(-15, Math.min(15, ret1m * 1.5));
  if (vol != null) {
    if (vol < 15) score += 10;
    else if (vol > 22) score -= 15;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const stance = score >= 65 ? "Risk-On" : score >= 45 ? "Neutral / Selective" : "Risk-Off / Defensive";
  const note = spyAboveEma20
    ? `SPY holding above its 20-EMA; ${vol != null && vol > 18 ? "elevated vol — favor extreme RS outliers" : "constructive tape for momentum"}.`
    : "SPY below 20-EMA — restrict to defensive momentum & extreme relative-strength outliers.";
  return { score, stance, spyAboveEma20, spyReturn1m: ret1m, realizedVol: vol, note };
}

export interface ScanResult {
  regime: MarketRegime;
  setups: SwingSetup[];
  /** Sentinel v3.0 score for each setup, keyed by ticker. */
  sentinel: Record<string, MomentumScoreV3>;
  /** Team Rules v4 Engine A read per scanned name, keyed by ticker. */
  engines: Record<string, any>;
  /** SAMP 3-layer read per setup (Priya's desk), keyed by ticker. */
  samp: Record<string, Pick<SampResult, "direction" | "strength" | "acceleration" | "regime" | "state" | "strongBull" | "strongBear" | "earlyBull" | "watchLong" | "lastSignal" | "barsSinceLastSignal">>;
  /**
   * 1-day / 1-week change and any extended-hours trade, keyed by ticker.
   *
   * The daily windows come free from the candles the scan already fetched. The
   * extended-hours read costs a request per symbol, so it is only taken for the
   * names that actually qualified — fetching it for the whole universe would
   * multiply the scan's request count for data nobody will look at.
   */
  moves: Record<string, PriceMoves>;
  /** Names excluded, with the rule that excluded them. */
  rejected: { ticker: string; score: number; signal: string; blocks: string[]; reason: string }[];
  scanned: number;
  warnings: string[];
  asOf: string;
  /** Set when nothing cleared the bar, with the reason why. */
  noQualifiers: string | null;
  /** Minimum reward:risk a setup must offer to be presented. */
  minRiskReward: number;
  rulesVersion?: string;
}

function lightMarketData(ticker: string, candles: Candle[], spy: Candle[]): MarketData {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  return {
    ticker,
    quote: last
      ? {
          symbol: ticker,
          price: last.close,
          change: last.close - prev.close,
          changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
          high: last.high,
          low: last.low,
          open: last.open,
          prevClose: prev.close,
          volume: last.volume,
          asOf: last.date,
        }
      : null,
    overview: null,
    financials: { income: [], balance: [], cashflow: [] },
    earnings: [],
    quarters: [],
    annualEps: [],
    candles,
    benchmarkCandles: spy,
    sources: ["Daily price history"],
    warnings: [],
  };
}

/** Run the momentum scan over a universe; returns the top N setups. */
export async function runScan(universe: string[], topN = 5): Promise<ScanResult> {
  const warnings: string[] = [];
  const spy = await dailyCandles("SPY", 150).catch((e) => {
    warnings.push(`SPY benchmark: ${e?.message ?? "failed"}`);
    return [] as Candle[];
  });
  const regime = assessRegime(spy);

  const candidates: SwingSetup[] = [];
  const sentinel: Record<string, MomentumScoreV3> = {};
  const engines: Record<string, any> = {};
  const samp: ScanResult["samp"] = {};
  const rejected: ScanResult["rejected"] = [];
  const dailyMoves: Record<string, PriceMoves> = {};
  let scanned = 0;
  // sequential to stay polite to the data provider
  for (const ticker of universe) {
    try {
      // 400 bars so the 200-SMA hard block and ADX can actually be evaluated
      const candles = await dailyCandles(ticker, 400);
      if (candles.length < 30) {
        warnings.push(`${ticker}: insufficient price history`);
        continue;
      }
      scanned++;
      // The daily windows are already paid for — these are the same closes the
      // technicals are computed from.
      dailyMoves[ticker] = { ticker, ...movesFromCandles(candles), extended: null };
      const md = lightMarketData(ticker, candles, spy);
      const tech = computeTechnicals(md);
      const score = computeMomentumScore(tech, false);

      // Sentinel Momentum Scoring v3.0 — the fund's own model, including the
      // hard blocks that override any score.
      const beta = spy.length ? computeBeta(candles, spy) : null;
      const v3 = scoreMomentumV3({ candles, benchmark: spy, beta });
      sentinel[ticker] = v3;

      // Team Rules v4 Engine A. The scanner hunts growth, so the 12% growth
      // gate and the entry layer apply here exactly as they do to the book —
      // a chart alone is "momentum without growth", which v4 classes as
      // tactical only and does not present as a fund setup.
      const sec = await getSecFundamentals(ticker).catch(() => null);
      const growth = buildGrowthInput(sec, false);
      const growthPct = bestGrowthPct(growth);
      const structure = readStructure(candles, spy);
      const engineA = scoreEngineA({ growth, structure });
      const entryCheck = checkEntry(structure);
      engines[ticker] = {
        score: engineA.score,
        signal: engineA.signal,
        coveragePct: engineA.coveragePct,
        growthPct,
        growthClass: engineA.lines.find((l) => l.label === "Revenue / EPS growth")?.detail ?? null,
        blocks: engineA.blocks,
        entry: entryCheck,
      };

      // Priya's SAMP engine — an independent 3-layer read on the same bars
      const sp = runSAMP(candles, { profile: "Precision" });
      if (sp) {
        samp[ticker] = {
          direction: sp.direction, strength: sp.strength, acceleration: sp.acceleration,
          regime: sp.regime, state: sp.state, strongBull: sp.strongBull, strongBear: sp.strongBear,
          earlyBull: sp.earlyBull, watchLong: sp.watchLong,
          lastSignal: sp.lastSignal, barsSinceLastSignal: sp.barsSinceLastSignal,
        };
      }

      // ── Qualification. A name is only presented as a setup when the fund's
      // own rules would actually allow a long. Previously only hard blocks
      // filtered the list, so a REJECT-scored name could still appear as the
      // top setup — with an entry, a target and a sub-1:1 reward:risk.
      // v4 §3/§5 — the growth gate first.
      if (engineA.blocks.some((b) => b.code === "GROWTH_LT_12")) {
        rejected.push({
          ticker, score: engineA.score, signal: engineA.signal,
          blocks: engineA.blocks.map((b) => b.reason),
          reason: growthPct == null
            ? "No growth history available — cannot clear the 12% growth gate (Engine A)"
            : `Growth ${growthPct.toFixed(1)}% is below the 12% gate — momentum without growth is tactical only, not a fund setup`,
        });
        continue;
      }
      if (engineA.score < ENTRY_SCORE) {
        rejected.push({
          ticker, score: engineA.score, signal: engineA.signal, blocks: [],
          reason: `Engine A score ${engineA.score} is below the ${ENTRY_SCORE} entry bar (${engineA.coveragePct}% of the model evaluable)`,
        });
        continue;
      }
      if (!entryCheck.cleared) {
        rejected.push({
          ticker, score: engineA.score, signal: engineA.signal, blocks: [],
          reason: `Entry layer not cleared — ${entryCheck.failures.join("; ")}`,
        });
        continue;
      }
      if (v3.hardBlocks.length) {
        rejected.push({
          ticker, score: v3.total, signal: v3.signal,
          blocks: v3.hardBlocks.map((b) => b.reason),
          reason: `Hard block — ${v3.hardBlocks.map((b) => b.code).join(", ")}`,
        });
        continue;
      }
      if (v3.total < WATCH_FLOOR) {
        rejected.push({
          ticker, score: v3.total, signal: v3.signal, blocks: [],
          reason: `Score ${v3.total} below the ${WATCH_FLOOR} watch floor — ${v3.signal}`,
        });
        continue;
      }
      // Don't advertise a long while the pressure engine reads bearish.
      if (sp && sp.direction < 0 && sp.acceleration < 0) {
        rejected.push({
          ticker, score: v3.total, signal: v3.signal, blocks: [],
          reason: `SAMP pressure negative (direction ${sp.direction}, acceleration ${sp.acceleration}) — long setup withheld`,
        });
        continue;
      }

      // Build the setup from the SAME score that is displayed, so the card and
      // its thesis can never quote two different numbers for one name.
      const unified = { ...score, total: v3.total, momentumRS: v3.phaseTotals["3A"]?.points ?? score.momentumRS };
      const setup = buildSwingSetup(md, tech, unified, "Trend persistence / sector momentum (scan-derived).");
      if (!setup) continue;
      if (setup.riskReward < MIN_RR) {
        rejected.push({
          ticker, score: v3.total, signal: v3.signal, blocks: [],
          reason: `Reward:risk 1:${setup.riskReward} below the 1:${MIN_RR} minimum at this entry`,
        });
        continue;
      }
      candidates.push(setup);
    } catch (e: any) {
      warnings.push(`${ticker}: ${e?.message ?? "failed"}`);
    }
  }

  const setups = candidates
    .sort((a, b) => b.momentumScore - a.momentumScore)
    .slice(0, topN);

  // Extended hours only for the qualifiers. A pre-market move matters most on a
  // name you are about to buy, and this keeps the cost proportional to that.
  const moves: Record<string, PriceMoves> = { ...dailyMoves };
  await Promise.all(
    setups.map(async (s) => {
      const ext = await extendedHours(s.ticker).catch(() => null);
      const base = moves[s.ticker];
      if (base) moves[s.ticker] = { ...base, extended: ext };
    })
  );

  const noQualifiers = setups.length === 0
    ? `No name cleared the bar out of ${scanned} scanned. ${rejected.filter((r) => r.blocks.length).length} were hard-blocked, ` +
      `${rejected.filter((r) => !r.blocks.length).length} failed on the 12% growth gate, the 65 engine score, the entry layer, pressure or reward:risk. ` +
      `Market regime is ${regime.stance.toLowerCase()} — in a broad pullback the model is designed to return nothing rather than the least-bad chart.`
    : null;

  return {
    regime, setups, sentinel, engines, samp, moves, rejected, scanned, warnings,
    asOf: new Date().toISOString(), noQualifiers, minRiskReward: MIN_RR,
    rulesVersion: "v4.0",
  };
}
