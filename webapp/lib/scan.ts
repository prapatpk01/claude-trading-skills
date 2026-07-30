import { dailyCandles, getMarketData } from "./marketData";
import { computeTechnicals, computeMomentumScore, buildSwingSetup } from "./analysis";
import { ema, pctReturn, sma } from "./indicators";
import { scoreMomentumV3, type MomentumScoreV3 } from "./team/scoring";
import { readStructure, scoreEngineA, checkEntry, ENTRY_SCORE } from "./team/engines";
import { buildGrowthInput, bestGrowthPct } from "./team/growthInputs";
import { getSecFundamentals } from "./sec";
import { runSAMP, type SampResult } from "./team/samp";
import { computeBeta } from "./derive";
import { movesFromCandles, extendedHours, judgeFreshness, type PriceMoves } from "./priceMoves";
import { assessCatalyst, toEngineCatalyst, type CatalystRead } from "./team/catalyst";
import { groupForSector, type GroupRank } from "./team/thematic";
import { projectEarningsDates } from "./research";
import { ROSTER } from "./team/roster";
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

/** Which desk's gate a name met, or was stopped by. */
export type ScanStage = "momentum" | "catalyst" | "quant";

export interface ScanStageReport {
  stage: ScanStage;
  owner: string;
  role: string;
  heading: string;
  passed: number;
  rejected: number;
  note: string;
}

/** How many names each desk passed on — the shape of the search, at a glance. */
export interface ScanFunnel {
  scanned: number;
  stages: ScanStageReport[];
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
  /** Aisha's catalyst read per shortlisted name, keyed by ticker. */
  catalysts: Record<string, CatalystRead>;
  /** Joint conviction (momentum + catalyst) for each presented setup. */
  conviction: Record<string, number>;
  /** What each desk passed and stopped. */
  funnel: ScanFunnel;
  /** Names excluded, with the desk that excluded them and the rule. */
  rejected: { stage: ScanStage; ticker: string; score: number; signal: string; blocks: string[]; reason: string }[];
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
    ttm: null,
    annualEps: [],
    candles,
    benchmarkCandles: spy,
    sources: ["Daily price history"],
    warnings: [],
  };
}

/**
 * Run the scan as the desk actually works it — three stages, each owned.
 *
 *   Stage 1  Maya Chen        finds momentum. Cheap, wide, price-and-filings
 *                             only: the v3.0 score, the hard blocks, Engine A's
 *                             growth gate and entry layer.
 *   Stage 2  Aisha Fontaine   decides whether there is a REASON. Theme, thesis
 *                             and catalyst on the shortlist only — this is where
 *                             the expensive per-name fetch happens, because a
 *                             desk does deep work on a shortlist, not on a
 *                             universe.
 *   Stage 3  Priya Nair       and Kai Tanaka set the entry and the target
 *            + Kai Tanaka     together. Both must sign off: Priya's pressure
 *                             engine can veto the timing, Kai's stop can veto
 *                             the reward:risk, and neither can overrule the
 *                             other into a trade.
 *
 * A name reaches the card only if all three stages pass it, and every rejection
 * records which stage stopped it and why.
 */
export async function runScan(
  universe: string[],
  topN = 5,
  opts: { themes?: GroupRank[]; deepDiveLimit?: number } = {}
): Promise<ScanResult> {
  const warnings: string[] = [];
  const spy = await dailyCandles("SPY", 150).catch((e) => {
    warnings.push(`SPY benchmark: ${e?.message ?? "failed"}`);
    return [] as Candle[];
  });
  const regime = assessRegime(spy);

  const sentinel: Record<string, MomentumScoreV3> = {};
  const engines: Record<string, any> = {};
  const samp: ScanResult["samp"] = {};
  const catalysts: Record<string, CatalystRead> = {};
  const rejected: ScanResult["rejected"] = [];
  const dailyMoves: Record<string, PriceMoves> = {};
  let scanned = 0;

  const reject = (
    stage: ScanStage, ticker: string, score: number, signal: string,
    blocks: string[], reason: string
  ) => { rejected.push({ stage, ticker, score, signal, blocks, reason }); };

  // ══ Stage 1 — Maya Chen: the momentum screen ══════════════════════════
  interface Survivor {
    ticker: string;
    candles: Candle[];
    md: MarketData;
    tech: ReturnType<typeof computeTechnicals>;
    score: ReturnType<typeof computeMomentumScore>;
    v3: MomentumScoreV3;
    engineA: ReturnType<typeof scoreEngineA>;
    growthPct: number | null;
  }
  const survivors: Survivor[] = [];

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
      {
        const m = movesFromCandles(candles);
        dailyMoves[ticker] = {
          ticker, ...m, extended: null,
          priceSource: m.price != null ? "last daily close" : null,
          ...judgeFreshness(m.asOf),
        };
      }
      const md = lightMarketData(ticker, candles, spy);
      const tech = computeTechnicals(md);
      const score = computeMomentumScore(tech, false);

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

      if (engineA.blocks.some((b) => b.code === "GROWTH_LT_12")) {
        reject("momentum", ticker, engineA.score, engineA.signal,
          engineA.blocks.map((b) => b.reason),
          growthPct == null
            ? "No growth history available — cannot clear the 12% growth gate (Engine A)"
            : `Growth ${growthPct.toFixed(1)}% is below the 12% gate — momentum without growth is tactical only, not a fund setup`);
        continue;
      }
      if (engineA.score < ENTRY_SCORE) {
        reject("momentum", ticker, engineA.score, engineA.signal, [],
          `Engine A score ${engineA.score} is below the ${ENTRY_SCORE} entry bar (${engineA.coveragePct}% of the model evaluable)`);
        continue;
      }
      if (!entryCheck.cleared) {
        reject("momentum", ticker, engineA.score, engineA.signal, [],
          `Entry layer not cleared — ${entryCheck.failures.join("; ")}`);
        continue;
      }
      if (v3.hardBlocks.length) {
        reject("momentum", ticker, v3.total, v3.signal,
          v3.hardBlocks.map((b) => b.reason),
          `Hard block — ${v3.hardBlocks.map((b) => b.code).join(", ")}`);
        continue;
      }
      if (v3.total < WATCH_FLOOR) {
        reject("momentum", ticker, v3.total, v3.signal, [],
          `Score ${v3.total} below the ${WATCH_FLOOR} watch floor — ${v3.signal}`);
        continue;
      }
      survivors.push({ ticker, candles, md, tech, score, v3, engineA, growthPct });
    } catch (e: any) {
      warnings.push(`${ticker}: ${e?.message ?? "failed"}`);
    }
  }
  survivors.sort((a, b) => b.v3.total - a.v3.total);
  const passedMomentum = survivors.length;

  // ══ Stage 2 — Aisha Fontaine: theme, thesis, catalyst ════════════════
  //
  // Only the shortlist gets the expensive read. getMarketData pulls the
  // consensus-estimate history the catalyst engine needs and which the cheap
  // screen above deliberately does not fetch; running it across a whole
  // universe would multiply the scan's cost for names already rejected.
  const deepLimit = opts.deepDiveLimit ?? 12;
  const shortlist = survivors.slice(0, deepLimit);
  if (survivors.length > shortlist.length) {
    warnings.push(
      `${survivors.length - shortlist.length} name(s) cleared the momentum screen but fall outside the top ${deepLimit} by score, ` +
      `so the catalyst desk did not review them. Raise the limit to widen the shortlist.`
    );
  }

  interface Reviewed extends Survivor { catalyst: CatalystRead | null; conviction: number }
  const reviewed: Reviewed[] = [];

  for (const s of shortlist) {
    let catalyst: CatalystRead | null = null;
    try {
      const full = await getMarketData(s.ticker);
      const reported = full.earnings.map((e) => e.reportedDate).filter((d): d is string => !!d);
      const { dates, medianGapDays } = projectEarningsDates(reported, new Date(), 1);
      const theme = opts.themes?.length
        ? groupForSector(opts.themes, full.overview?.sector ?? null)
        : null;
      catalyst = assessCatalyst({
        earnings: full.earnings,
        quarters: full.quarters,
        candles: s.candles,
        benchmark: spy,
        nextEarningsDate: dates[0] ?? null,
        nextEarningsBasis: medianGapDays
          ? `Projected from a median ${medianGapDays}-day reporting cadence across ${reported.length} past reports [E].`
          : undefined,
        theme: theme
          ? { label: theme.label, proxy: theme.proxy, leadership: theme.leadership, rs3mPct: theme.rs3m }
          : null,
      });
      catalysts[s.ticker] = catalyst;

      // Re-score Engine A now that the catalyst line can actually be filled.
      // In stage 1 it read "not evaluated" — correctly, because the cheap
      // screen does not fetch consensus estimates — which cost the name up to
      // 10 of the 100 points and depressed its coverage percentage.
      const growth2 = buildGrowthInput(await getSecFundamentals(s.ticker).catch(() => null), false);
      const rescored = scoreEngineA({
        growth: growth2,
        structure: readStructure(s.candles, spy),
        catalystScore: toEngineCatalyst(catalyst),
        catalystDetail: catalyst.thesis,
      });
      engines[s.ticker] = {
        ...engines[s.ticker],
        score: rescored.score,
        signal: rescored.signal,
        coveragePct: rescored.coveragePct,
        blocks: rescored.blocks,
        catalystScored: true,
      };
    } catch (e: any) {
      warnings.push(`${s.ticker}: catalyst review unavailable — ${e?.message ?? "failed"}`);
    }

    // The blackout is a hard stop: a print inside two days is not analysable,
    // and the fund does not buy a coin toss.
    if (catalyst?.nextEvent.blackout) {
      reject("catalyst", s.ticker, s.v3.total, s.v3.signal, [],
        `Earnings in ${catalyst.nextEvent.daysAway} day(s) — inside the pre-print blackout. The setup may be right; the timing is not.`);
      continue;
    }
    // A drift running against the name after its own report is the market
    // disagreeing with the result, and it persists as long as a positive one.
    if (catalyst?.negative) {
      reject("catalyst", s.ticker, s.v3.total, s.v3.signal, [],
        `Catalyst reads negative — ${catalyst.pead?.excessPct != null
          ? `${catalyst.pead.excessPct}% against the index since the ${catalyst.pead.reportedDate} report`
          : "the last quarter missed consensus"}. Momentum without a reason is a chart, not a thesis.`);
      continue;
    }

    // Conviction blends what the two research desks each measured. Momentum is
    // the larger weight because it is measured on every name; the catalyst read
    // is scaled by how much of its own model could be evaluated, so a thin read
    // cannot carry a name on its own.
    const catalystPart = catalyst?.score != null
      ? (catalyst.score / 25) * 100 * (catalyst.coveragePct / 100)
      : 0;
    const conviction = Math.round(s.v3.total * 0.7 + catalystPart * 0.3);
    reviewed.push({ ...s, catalyst, conviction });
  }
  reviewed.sort((a, b) => b.conviction - a.conviction);
  const passedCatalyst = reviewed.length;

  // ══ Stage 3 — the quant desk: Priya Nair and Kai Tanaka, jointly ═════
  //
  // Priya reads pressure and can veto the timing; Kai sets the stop and can
  // veto the reward:risk. Both signatures are required, and each is recorded
  // so a reader can see which desk let a name through and which stopped it.
  const candidates: { setup: SwingSetup; conviction: number }[] = [];

  for (const r of reviewed) {
    // Priya's SAMP engine — an independent 3-layer read on the same bars.
    const sp = runSAMP(r.candles, { profile: "Precision" });
    if (sp) {
      samp[r.ticker] = {
        direction: sp.direction, strength: sp.strength, acceleration: sp.acceleration,
        regime: sp.regime, state: sp.state, strongBull: sp.strongBull, strongBear: sp.strongBear,
        earlyBull: sp.earlyBull, watchLong: sp.watchLong,
        lastSignal: sp.lastSignal, barsSinceLastSignal: sp.barsSinceLastSignal,
      };
    }
    if (sp && sp.direction < 0 && sp.acceleration < 0) {
      reject("quant", r.ticker, r.v3.total, r.v3.signal, [],
        `Priya's desk withholds the entry — SAMP pressure negative (direction ${sp.direction}, acceleration ${sp.acceleration}). The thesis may be right; buying into falling pressure is not the way to express it.`);
      continue;
    }

    // Kai's levels. Built from the SAME score that is displayed, so the card and
    // its thesis can never quote two different numbers for one name.
    const unified = { ...r.score, total: r.v3.total, momentumRS: r.v3.phaseTotals["3A"]?.points ?? r.score.momentumRS };
    const setup = buildSwingSetup(
      r.md, r.tech, unified,
      r.catalyst?.thesis ?? "Trend persistence / sector momentum (scan-derived)."
    );
    if (!setup) continue;
    if (setup.riskReward < MIN_RR) {
      reject("quant", r.ticker, r.v3.total, r.v3.signal, [],
        `Kai's desk rejects the geometry — reward:risk 1:${setup.riskReward} at this entry, below the 1:${MIN_RR} minimum. A good business at a bad entry is still a bad trade.`);
      continue;
    }
    candidates.push({ setup, conviction: r.conviction });
  }

  // Ranked by the joint conviction, not by momentum alone — that is the point
  // of putting a second research desk in the path.
  const ranked = candidates.sort((a, b) => b.conviction - a.conviction).slice(0, topN);
  const convictionByTicker: Record<string, number> = {};
  for (const c of ranked) convictionByTicker[c.setup.ticker] = c.conviction;
  const candidatesOut = ranked.map((c) => c.setup);
  const passedQuant = candidatesOut.length;

  const funnel: ScanFunnel = {
    scanned,
    stages: [
      {
        stage: "momentum", owner: ROSTER.maya.name, role: ROSTER.maya.role,
        heading: "Momentum screen",
        passed: passedMomentum, rejected: rejected.filter((x) => x.stage === "momentum").length,
        note: `Momentum Scoring v3.0 with its hard blocks, plus Engine A's 12% growth gate and entry layer. Price and filings only — cheap enough to run across the whole universe.`,
      },
      {
        stage: "catalyst", owner: ROSTER.aisha.name, role: ROSTER.aisha.role,
        heading: "Theme, thesis & catalyst",
        passed: passedCatalyst, rejected: rejected.filter((x) => x.stage === "catalyst").length,
        note: `Measured post-earnings drift against the index, surprise history, the revision proxy and the next scheduled print — on the top ${deepLimit} by momentum only, because this stage costs a full data pull per name.`,
      },
      {
        stage: "quant", owner: `${ROSTER.priya.name} + ${ROSTER.kai.name}`,
        role: "Quant & Risk — joint sign-off",
        heading: "Entry, stop & target",
        passed: passedQuant, rejected: rejected.filter((x) => x.stage === "quant").length,
        note: `Priya's SAMP pressure read can veto the timing; Kai's ATR stop sets the geometry and can veto on reward:risk. Both must sign; neither can overrule the other into a trade.`,
      },
    ],
  };

  const setups = candidatesOut;

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
    ? `No name cleared all three desks out of ${scanned} scanned. ` +
      funnel.stages.map((st) => `${st.heading} stopped ${st.rejected}`).join(", ") + ". " +
      `Market regime is ${regime.stance.toLowerCase()} — in a broad pullback the model is designed to return nothing rather than the least-bad chart.`
    : null;

  return {
    regime, setups, sentinel, engines, samp, catalysts, conviction: convictionByTicker,
    funnel, moves, rejected, scanned, warnings,
    asOf: new Date().toISOString(), noQualifiers, minRiskReward: MIN_RR,
    rulesVersion: "v4.0",
  };
}
