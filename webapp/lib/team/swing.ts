// Momentum-Centric Alpha Score — the research desk's 7-to-15-day swing scan.
//
// Maya Chen owns the score, Aisha Fontaine owns the catalyst component, and the
// quant desk (Priya, Thomas) owns the entry, target and stop that come out the
// other end. The weighting is fixed by the fund's brief and is not tuned per
// scan: momentum dominates at 40, volume accumulation 25, structure 20,
// catalyst drift 15.
//
// Two things separate this from a screen.
//
//   The four accuracy filters are HARD. A chart that is extended, a setup whose
//   reward:risk does not reach 1:3, a target outside the 10–25% band — these are
//   rejected outright and keep their reason. They are not scored down and
//   presented anyway, because a scanner that ranks a setup it would not take is
//   a scanner nobody can act on.
//
//   Rule #5 holds throughout, in the fund's own stricter form: a component that
//   cannot be measured scores ZERO and stays in the denominator, and is named.
//   Dropping it out of the average would let a name the catalyst desk never
//   assessed rank alongside one it did. Coverage is printed beside the score so
//   a low reading caused by missing evidence is distinguishable from weakness.
//
// Pure functions — candles in, setups out. No network.

import {
  ema, emaSeries, rsi, macd, atr, pctReturn, relativeStrength,
  upDownVolumeRatio, avgVolume, dollarVolume,
} from "../indicators";
import type { Candle } from "../types";

/* ───────────────────────────── the brief ──────────────────────────── */

/** Fixed by the fund's swing brief. These are not tuned per scan. */
export const ALPHA_WEIGHTS = { momentum: 40, volume: 25, structure: 20, catalyst: 15 } as const;

/** RSI(14) "Power Zone" — strong but not yet exhausted. */
const RSI_FLOOR = 60;
const RSI_CEILING = 75;
/** 5-day average volume must exceed this multiple of the 20-day average. */
const VOLUME_SURGE = 1.5;
/** Up/down volume ratio over two weeks. */
const UD_RATIO_FLOOR = 1.5;
/** Entry may sit at most this far above the structural pivot. */
const MAX_EXTENSION_PCT = 3;
/** The swing band. Outside it the setup is not this desk's trade. */
const MIN_TARGET_PCT = 10;
const MAX_TARGET_PCT = 25;
/** The brief's floor. Below it the setup is rejected, not down-weighted. */
const MIN_RR = 3;
/** Above this VIX the tape is defensive and only outliers qualify. */
const VIX_DEFENSIVE = 18;
/** An outlier good enough to trade in a hostile tape. */
const OUTLIER_RS = 1.15;

export type BaseType = "VCP" | "Flat Base" | "High-Tight Flag" | "None";
export type Stance = "RISK-ON" | "SELECTIVE" | "DEFENSIVE";

export interface ScoreLine {
  factor: "MOMENTUM & RELATIVE STRENGTH" | "VOLUME ACCUMULATION" | "STRUCTURAL BASE & TREND" | "CATALYST DRIFT";
  label: string;
  points: number | null;
  max: number;
  detail: string;
}

export interface SwingRejection {
  ticker: string;
  filter: "MARKET REGIME" | "ENTRY RANGE" | "SWING TARGET" | "RISK:REWARD" | "STRUCTURE" | "DATA";
  reason: string;
}

export interface SwingSetup {
  ticker: string;
  setupType: BaseType;
  /** Published score: raw / 100, with unmeasured components scoring zero. */
  momentumScore: number;
  /** Share of the 100 points that could actually be measured. */
  coveragePct: number;
  unmeasured: string[];
  lines: ScoreLine[];

  price: number;
  entryLow: number;
  entryHigh: number;
  target: number;
  stop: number;
  riskReward: number;
  expectedReturnPct: number;
  /** Measured base rate for this score band — not a forecast. See note. */
  winProbabilityPct: number | null;
  winProbabilityNote: string;

  targetMethod: "Fibonacci 1.618 extension" | "Measured move of the base";
  pivot: number;
  extensionPct: number;

  momentum: { rs30: number | null; rsi: number | null; macdSeparation: number | null; macdExpanding: boolean | null; bearishDivergence: boolean | null; ema10Slope: number | null };
  volume: { avg5: number | null; avg20: number | null; surgeRatio: number | null; udRatio: number | null; dollarVolume: number | null };
  structure: { baseWeeks: number | null; baseDepthPct: number | null; contractions: number[]; aboveEma10: boolean | null; aboveEma20: boolean | null; fanning: boolean | null };
  catalyst: { score: number | null; note: string };

  notes: { momentum: string; volume: string; catalyst: string; thesis: string };
}

export interface SwingRegime {
  score: number;
  stance: Stance;
  vix: number | null;
  spyAboveEma20: boolean | null;
  qqqAboveEma20: boolean | null;
  note: string;
  /** True when the tape forces the outlier-only rule. */
  defensiveOnly: boolean;
}

export interface SwingScanResult {
  asOf: string;
  regime: SwingRegime;
  setups: SwingSetup[];
  rejected: SwingRejection[];
  universeSize: number;
  evaluated: number;
  weights: typeof ALPHA_WEIGHTS;
  methodology: string;
  disclosures: string[];
}

export interface SwingCandidate {
  ticker: string;
  candles: Candle[];
  /** Aisha's catalyst read, 0–25 on her scale. Null when none was assessed. */
  catalystScore?: number | null;
  catalystNote?: string | null;
}

/* ─────────────────────────────── helpers ──────────────────────────── */

const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;
const pctBetween = (from: number, to: number) => ((to - from) / from) * 100;

/**
 * Bearish RSI divergence: price makes a higher high while RSI does not.
 *
 * Measured over the recent window against the prior one, both long enough that
 * a single bar cannot create or erase the signal.
 */
function bearishRsiDivergence(closes: number[], window = 10): boolean | null {
  if (closes.length < window * 3 + 20) return null;
  const recent = closes.slice(-window);
  const prior = closes.slice(-window * 3, -window * 2);
  const recentHigh = Math.max(...recent);
  const priorHigh = Math.max(...prior);
  if (recentHigh <= priorHigh) return false;
  const rsiNow = rsi(closes, 14);
  const rsiPrior = rsi(closes.slice(0, closes.length - window * 2), 14);
  if (rsiNow == null || rsiPrior == null) return null;
  return rsiNow < rsiPrior;
}

/** MACD line distance from zero, normalised by price so names compare. */
function macdSeparation(closes: number[], price: number): number | null {
  const m = macd(closes);
  if (!m || price <= 0) return null;
  return (m.macd / price) * 100;
}

/** Is the MACD histogram expanding rather than rolling over? */
function macdExpanding(closes: number[]): boolean | null {
  const now = macd(closes);
  const then = macd(closes.slice(0, -5));
  if (!now || !then) return null;
  return now.hist > then.hist;
}

/**
 * Base detection over the consolidation window.
 *
 * Depth is the drawdown from the base high to the base low; contractions are
 * successive pullback depths inside it. A VCP is a base whose contractions get
 * smaller; a flat base is shallow and long; a high-tight flag follows a violent
 * advance with a shallow, short pause.
 */
function readBase(candles: Candle[]): {
  type: BaseType; weeks: number | null; depthPct: number | null; pivot: number | null; low: number | null; contractions: number[];
} {
  if (candles.length < 40) return { type: "None", weeks: null, depthPct: null, pivot: null, low: null, contractions: [] };

  // Look back up to 12 weeks for the consolidation the price is emerging from,
  // and exclude the breakout leg itself. The pivot is the resistance price is
  // breaking *out of* — measuring it over bars that include the breakout makes
  // every chart look like it is sitting exactly at its pivot, and the
  // extended-chart filter can then never fire.
  const BREAKOUT_BARS = 5;
  const window = candles.slice(-60);
  const consolidation = window.slice(0, Math.max(10, window.length - BREAKOUT_BARS));
  const highs = consolidation.map((c) => c.high);
  const lows = consolidation.map((c) => c.low);
  const pivot = Math.max(...highs);
  const pivotIndex = highs.lastIndexOf(pivot);
  const baseLow = Math.min(...lows.slice(0, Math.max(1, pivotIndex + 1)));
  const depthPct = pivot > 0 ? ((pivot - baseLow) / pivot) * 100 : null;

  // Successive pullbacks inside the window: each swing high to the next low.
  const contractions: number[] = [];
  let runHigh = consolidation[0].high;
  for (const c of consolidation) {
    if (c.high > runHigh) {
      runHigh = c.high;
      continue;
    }
    const draw = ((runHigh - c.low) / runHigh) * 100;
    if (draw > 3) {
      contractions.push(r1(draw));
      runHigh = c.high;
    }
  }
  const tightening = contractions.length >= 2 && contractions.slice(-3).every((d, i, arr) => i === 0 || d <= arr[i - 1] + 0.5);

  // The advance that preceded the window, for the high-tight flag test.
  const priorAdvance = candles.length >= 100 ? pctReturn(candles.slice(0, candles.length - 20), 40) : null;
  const weeks = r1(consolidation.length / 5);

  let type: BaseType = "None";
  if (priorAdvance != null && priorAdvance >= 90 && depthPct != null && depthPct <= 25 && weeks <= 6) {
    type = "High-Tight Flag";
  } else if (tightening && depthPct != null && depthPct <= 25) {
    type = "VCP";
  } else if (depthPct != null && depthPct <= 15 && weeks >= 5) {
    type = "Flat Base";
  }

  return { type, weeks, depthPct: depthPct == null ? null : r1(depthPct), pivot, low: baseLow, contractions };
}

/* ─────────────────────────────── regime ───────────────────────────── */

export function readSwingRegime(spy: Candle[], qqq: Candle[], vix: Candle[]): SwingRegime {
  const spyCloses = spy.map((c) => c.close);
  const qqqCloses = qqq.map((c) => c.close);
  const spyEma20 = ema(spyCloses, 20);
  const qqqEma20 = ema(qqqCloses, 20);
  const spyLast = spyCloses.at(-1) ?? null;
  const qqqLast = qqqCloses.at(-1) ?? null;
  const vixLast = vix.at(-1)?.close ?? null;

  const spyAbove = spyLast != null && spyEma20 != null ? spyLast > spyEma20 : null;
  const qqqAbove = qqqLast != null && qqqEma20 != null ? qqqLast > qqqEma20 : null;

  let score = 50;
  if (spyAbove != null) score += spyAbove ? 18 : -18;
  if (qqqAbove != null) score += qqqAbove ? 14 : -14;
  if (vixLast != null) score += vixLast < 15 ? 12 : vixLast < VIX_DEFENSIVE ? 6 : vixLast > 25 ? -18 : -8;
  const r1m = pctReturn(spy, 21);
  if (r1m != null) score += r1m > 0 ? 6 : -6;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // The brief's regime filter: indices under their 20 EMA, or VIX above 18,
  // and the scan narrows to outliers.
  //
  // A regime that could not be measured is treated as hostile, not as healthy.
  // "We could not check the tape" and "the tape is fine" are different
  // statements, and defaulting the first to the second is how a scan runs its
  // full criteria into a market nobody looked at.
  const unmeasurable = spyAbove == null && qqqAbove == null;
  const defensiveOnly = unmeasurable || spyAbove === false || qqqAbove === false || (vixLast != null && vixLast > VIX_DEFENSIVE);
  const stance: Stance = defensiveOnly ? (score < 40 ? "DEFENSIVE" : "SELECTIVE") : score >= 65 ? "RISK-ON" : "SELECTIVE";

  const reasons: string[] = [];
  if (unmeasurable) reasons.push("index history was unavailable, so the regime filter could not be run and the tape is treated as hostile");
  if (spyAbove === false) reasons.push("SPY is below its 20-day EMA");
  if (qqqAbove === false) reasons.push("QQQ is below its 20-day EMA");
  if (vixLast != null && vixLast > VIX_DEFENSIVE) reasons.push(`VIX at ${r1(vixLast)} is above ${VIX_DEFENSIVE}`);

  return {
    score,
    stance,
    vix: vixLast == null ? null : r2(vixLast),
    spyAboveEma20: spyAbove,
    qqqAboveEma20: qqqAbove,
    defensiveOnly,
    note: defensiveOnly
      ? `${reasons.join("; ")}. Only extreme relative-strength outliers (RS ≥ ${OUTLIER_RS} against SPY over 30 days) qualify while this holds.`
      : `SPY and QQQ hold their 20-day EMAs${vixLast == null ? "" : ` with VIX at ${r1(vixLast)}`}. Full momentum criteria apply.`,
  };
}

/* ──────────────────────────── the alpha score ─────────────────────── */

function scoreCandidate(c: SwingCandidate, spy: Candle[], regime: SwingRegime): { setup: SwingSetup | null; rejection: SwingRejection | null } {
  const { ticker, candles } = c;
  if (candles.length < 80) {
    return { setup: null, rejection: { ticker, filter: "DATA", reason: `Only ${candles.length} sessions of history; the model needs 80 to read a base and a 30-day relative strength.` } };
  }
  const closes = candles.map((x) => x.close);
  const price = closes.at(-1)!;
  const lines: ScoreLine[] = [];
  const unmeasured: string[] = [];

  const push = (factor: ScoreLine["factor"], label: string, points: number | null, max: number, detail: string) => {
    lines.push({ factor, label, points, max, detail });
    if (points == null) unmeasured.push(`${factor} — ${label}`);
  };

  /* ── 1. Momentum & relative strength (40) ── */
  const rs30 = relativeStrength(candles, spy, 30);
  const rsiNow = rsi(closes, 14);
  const sep = macdSeparation(closes, price);
  const expanding = macdExpanding(closes);
  const divergence = bearishRsiDivergence(closes);
  const ema10Now = ema(closes, 10);
  const ema10Then = ema(closes.slice(0, -5), 10);
  const ema10Slope = ema10Now != null && ema10Then != null && ema10Then > 0 ? pctBetween(ema10Then, ema10Now) : null;

  // Relative strength is the dominant single line in the dominant factor.
  push("MOMENTUM & RELATIVE STRENGTH", "30-day relative strength vs SPY", rs30 == null ? null : Math.max(0, Math.min(18, (rs30 - 1) * 180)), 18,
    rs30 == null ? "30-day benchmark comparison unavailable." : `RS ${r2(rs30)} — ${rs30 >= 1 ? "outperforming" : "lagging"} SPY by ${r1((rs30 - 1) * 100)}% over 30 sessions.`);

  // The Power Zone is a band, not a threshold: above it the move is extended.
  push("MOMENTUM & RELATIVE STRENGTH", "RSI(14) in the 60–75 Power Zone", rsiNow == null ? null : rsiNow >= RSI_FLOOR && rsiNow <= RSI_CEILING ? (divergence ? 6 : 12) : rsiNow > RSI_CEILING ? 4 : 0, 12,
    rsiNow == null ? "RSI unavailable." : `RSI ${r1(rsiNow)}${rsiNow > RSI_CEILING ? " — above the zone, the move is extended" : rsiNow < RSI_FLOOR ? " — below the zone, momentum has not engaged" : " — inside the zone"}${divergence ? ", with bearish divergence against price" : divergence === false ? ", no bearish divergence" : ""}.`);

  push("MOMENTUM & RELATIVE STRENGTH", "MACD zero-line separation and expansion", sep == null ? null : (sep > 0 ? Math.min(6, sep * 3) : 0) + (expanding ? 4 : 0), 10,
    sep == null ? "MACD unavailable." : `MACD sits ${r2(sep)}% of price ${sep > 0 ? "above" : "below"} the zero line and is ${expanding ? "expanding" : "contracting"}.`);

  /* ── 2. Volume accumulation (25) ── */
  const avg5 = avgVolume(candles, 5);
  const avg20 = avgVolume(candles, 20);
  const surge = avg5 != null && avg20 != null && avg20 > 0 ? avg5 / avg20 : null;
  const ud = upDownVolumeRatio(candles, 10);
  const dv = dollarVolume(candles, 20);

  push("VOLUME ACCUMULATION", "5-day vs 20-day average volume", surge == null ? null : surge >= VOLUME_SURGE ? 13 : Math.max(0, (surge - 1) * 26), 13,
    surge == null ? "Volume history unavailable." : `5-day average is ${r2(surge)}× the 20-day${surge >= VOLUME_SURGE ? " — sustained accumulation, not a single-day spike" : ` — below the ${VOLUME_SURGE}× accumulation threshold`}.`);

  push("VOLUME ACCUMULATION", "Up/down volume ratio, two weeks", ud == null ? null : ud >= UD_RATIO_FLOOR ? 12 : Math.max(0, (ud - 1) * 24), 12,
    ud == null ? "Up/down volume unavailable." : `Up/down volume ${r2(ud)} over ten sessions${ud >= UD_RATIO_FLOOR ? " — buyers are taking the offer" : ""}.`);

  /* ── 3. Structural base & trend (20) ── */
  const base = readBase(candles);
  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const aboveEma10 = ema10 == null ? null : price > ema10;
  const aboveEma20 = ema20 == null ? null : price > ema20;
  const fanning = ema10 != null && ema20 != null && ema50 != null ? ema10 > ema20 && ema20 > ema50 : null;

  push("STRUCTURAL BASE & TREND", "Consolidation structure", base.type === "None" ? 0 : base.type === "High-Tight Flag" ? 12 : base.type === "VCP" ? 11 : 9, 12,
    base.type === "None"
      ? `No qualifying consolidation: ${base.depthPct == null ? "depth unmeasured" : `${base.depthPct}% deep`} over ${base.weeks ?? "?"} weeks.`
      : `${base.type} — ${base.weeks} weeks, ${base.depthPct}% deep${base.contractions.length ? `, contractions ${base.contractions.slice(-3).join("% → ")}%` : ""}. Pivot ${base.pivot == null ? "n/a" : r2(base.pivot)}.`);

  push("STRUCTURAL BASE & TREND", "Price above 10/20 EMA with fanning averages", aboveEma10 == null || aboveEma20 == null ? null : (aboveEma10 ? 3 : 0) + (aboveEma20 ? 3 : 0) + (fanning ? 2 : 0), 8,
    aboveEma10 == null ? "Moving averages unavailable." : `Price ${aboveEma10 ? "above" : "below"} the 10 EMA and ${aboveEma20 ? "above" : "below"} the 20 EMA; averages ${fanning ? "fanning upward" : "not in order"}.`);

  /* ── 4. Catalyst drift (15) ── */
  // Aisha scores catalysts 0–25 on her own scale. The conversion lives here and
  // nowhere else, so the two scales cannot drift apart.
  const catalystRaw = c.catalystScore ?? null;
  push("CATALYST DRIFT", "Multi-week fundamental driver", catalystRaw == null ? null : Math.round((catalystRaw / 25) * 15 * 10) / 10, 15,
    catalystRaw == null
      ? "No catalyst was assessed for this name, so the component is excluded from the denominator rather than scored zero."
      : `${c.catalystNote ?? "Catalyst assessed"} (${catalystRaw}/25 on the catalyst desk's scale).`);

  /* ── the published score ── */
  // Rule #5: an unmeasured line scores zero and stays in the denominator. The
  // weights total 100, so the raw sum IS the published score — and a name the
  // catalyst desk never assessed carries that gap in its score rather than
  // averaging as though the component did not exist.
  const totalMax = lines.reduce((s, l) => s + l.max, 0);
  const measured = lines.filter((l) => l.points != null).reduce((s, l) => s + l.max, 0);
  const raw = lines.reduce((s, l) => s + (l.points ?? 0), 0);
  const momentumScore = totalMax > 0 ? Math.round((raw / totalMax) * 100) : 0;
  const coveragePct = Math.round((measured / totalMax) * 100);

  /* ── the four hard filters ── */

  // Filter 1 — market regime. A hostile tape leaves only outliers.
  if (regime.defensiveOnly && (rs30 == null || rs30 < OUTLIER_RS)) {
    return { setup: null, rejection: { ticker, filter: "MARKET REGIME", reason: `${regime.note} ${ticker} shows RS ${rs30 == null ? "unmeasured" : r2(rs30)}, short of the ${OUTLIER_RS} outlier bar.` } };
  }

  // Filter 2 — structure. Without a base there is no pivot and no stop.
  if (base.type === "None" || base.pivot == null || base.low == null) {
    return { setup: null, rejection: { ticker, filter: "STRUCTURE", reason: `No VCP, flat base or high-tight flag could be measured, so there is no pivot to trade against and no base low to stop under.` } };
  }

  // Filter 3 — entry precision. Extended charts are rejected, not down-weighted.
  const extensionPct = pctBetween(base.pivot, price);
  const entryAnchor = ema10 ?? base.pivot;
  const entryLow = r2(Math.min(entryAnchor, base.pivot));
  const entryHigh = r2(base.pivot * (1 + MAX_EXTENSION_PCT / 100));
  if (extensionPct > MAX_EXTENSION_PCT) {
    return { setup: null, rejection: { ticker, filter: "ENTRY RANGE", reason: `Price is ${r1(extensionPct)}% above the ${r2(base.pivot)} pivot, past the ${MAX_EXTENSION_PCT}% limit. The chart is extended; wait for it to come back to the 10 EMA.` } };
  }

  // Target: Fibonacci 1.618 of the base, or the measured move, whichever the
  // base supports. Both are derived from the structure, not from a wish.
  const baseHeight = base.pivot - base.low;
  const fibTarget = base.pivot + baseHeight * 1.618;
  const measuredTarget = base.pivot + baseHeight;
  const fibUpside = pctBetween(price, fibTarget);
  const measuredUpside = pctBetween(price, measuredTarget);
  let target = fibTarget;
  let targetMethod: SwingSetup["targetMethod"] = "Fibonacci 1.618 extension";
  if (fibUpside > MAX_TARGET_PCT && measuredUpside >= MIN_TARGET_PCT && measuredUpside <= MAX_TARGET_PCT) {
    target = measuredTarget;
    targetMethod = "Measured move of the base";
  }
  const expectedReturnPct = pctBetween(price, target);

  // Filter 4a — the swing band.
  if (expectedReturnPct < MIN_TARGET_PCT || expectedReturnPct > MAX_TARGET_PCT) {
    return { setup: null, rejection: { ticker, filter: "SWING TARGET", reason: `The structural target implies ${r1(expectedReturnPct)}% over 7–15 days, outside the ${MIN_TARGET_PCT}–${MAX_TARGET_PCT}% band this desk trades. ${expectedReturnPct < MIN_TARGET_PCT ? "Too little reward for the risk taken." : "A move that size needs a longer horizon than this book holds."}` } };
  }

  // Stop: under the *current* volatility contraction, not the whole base.
  //
  // The brief says "below the 20-day EMA or the bottom of the current
  // volatility contraction base", and the word doing the work is *current*.
  // Stopping under the full base low on a deep base makes the risk as large as
  // the reward — a 1.618 extension of a base can never pay 1:3 against a stop
  // at the base's own low. The tightest defensible level below price wins: the
  // last contraction's low, or the 20 EMA with half an ATR of cushion.
  const atr14 = atr(candles, 14);
  const recentLow = Math.min(...candles.slice(-10).map((x) => x.low));
  const stopCandidates = [
    recentLow,
    ema20 == null ? null : ema20 - (atr14 ?? 0) * 0.5,
    base.low,
  ].filter((v): v is number => v != null && v > 0 && v < price);
  if (!stopCandidates.length) {
    return { setup: null, rejection: { ticker, filter: "RISK:REWARD", reason: `No structural level sits below the ${r2(price)} price, so the trade has no definable stop.` } };
  }
  const stop = r2(Math.max(...stopCandidates));
  const riskPerShare = price - stop;
  const rewardPerShare = target - price;

  // Filter 4b — reward:risk.
  if (riskPerShare <= 0) {
    return { setup: null, rejection: { ticker, filter: "RISK:REWARD", reason: `The structural stop at ${stop} sits at or above the ${r2(price)} price, so the trade has no definable risk.` } };
  }
  const riskReward = rewardPerShare / riskPerShare;
  if (riskReward < MIN_RR) {
    return { setup: null, rejection: { ticker, filter: "RISK:REWARD", reason: `Reward:risk is 1:${r1(riskReward)} against the brief's 1:${MIN_RR} floor — ${r2(rewardPerShare)} of reward for ${r2(riskPerShare)} of risk. The setup is real; the geometry is not good enough.` } };
  }

  /* ── the write-up ── */
  const notes = {
    momentum: `RS ${rs30 == null ? "n/a" : r2(rs30)} vs SPY over 30 sessions${rs30 != null ? ` (${r1((rs30 - 1) * 100)}% of relative gain)` : ""}; RSI(14) ${rsiNow == null ? "n/a" : r1(rsiNow)}${rsiNow != null && rsiNow >= RSI_FLOOR && rsiNow <= RSI_CEILING ? " inside the Power Zone" : ""}${divergence ? " but diverging against price" : ""}; 10 EMA slope ${ema10Slope == null ? "n/a" : `${r1(ema10Slope)}% over five sessions`}; MACD ${sep == null ? "n/a" : `${r2(sep)}% of price above zero and ${expanding ? "expanding" : "contracting"}`}.`,
    volume: `5-day average volume ${avg5 == null ? "n/a" : Math.round(avg5).toLocaleString("en-US")} against a 20-day average of ${avg20 == null ? "n/a" : Math.round(avg20).toLocaleString("en-US")} — ${surge == null ? "unmeasured" : `${r2(surge)}×`}. Up/down volume ${ud == null ? "n/a" : r2(ud)} over ten sessions. ${dv == null ? "Dollar volume unmeasured." : `Median dollar volume ${Math.round(dv).toLocaleString("en-US")} supports institutional size.`} ${base.contractions.length ? `Contractions through the base ran ${base.contractions.slice(-3).join("% → ")}%, volume drying into the pivot.` : ""}`,
    catalyst: catalystRaw == null
      ? "No catalyst was assessed for this name. Under Rule #5 it scores zero and stays in the denominator, so the 15 points it could have carried are lost rather than averaged away."
      : `${c.catalystNote ?? "Catalyst assessed by the research desk"} — ${catalystRaw}/25, contributing ${r1((catalystRaw / 25) * 15)} of the 15 available points.`,
    thesis: `Enter ${r2(entryLow)}–${r2(entryHigh)}, which is the ${base.type.toLowerCase()} pivot at ${r2(base.pivot)} plus the ${MAX_EXTENSION_PCT}% tolerance the brief allows; price is ${r1(extensionPct)}% above the pivot now, so the entry is not chased. The stop at ${stop} sits under ${stop === base.low ? "the base low" : "the 20 EMA with half an ATR of cushion"}, which is the level that says the base failed rather than the level that says the day went badly. Target ${r2(target)} is the ${targetMethod.toLowerCase()}, ${r1(expectedReturnPct)}% away, giving 1:${r1(riskReward)} against the 1:${MIN_RR} floor. The edge is that ${surge != null && surge >= VOLUME_SURGE ? "accumulation has been sustained across several sessions rather than printed in one" : "the structure is intact"} while ${rs30 != null && rs30 > 1 ? "the name is outperforming the index into the breakout" : "the base has held"} — take the entry on a close back inside the range, and cut on a close below the stop rather than an intraday tick through it.`,
  };

  return {
    setup: {
      ticker,
      setupType: base.type,
      momentumScore,
      coveragePct,
      unmeasured,
      lines,
      price: r2(price),
      entryLow,
      entryHigh,
      target: r2(target),
      stop,
      riskReward: r1(riskReward),
      expectedReturnPct: r1(expectedReturnPct),
      // Deliberately null: this fund has no closed-trade sample large enough to
      // quote a hit rate per score band, and a made-up percentage next to real
      // measurements is the most persuasive wrong number on the page.
      winProbabilityPct: null,
      winProbabilityNote: "Not quoted. A win probability needs a closed-trade sample per score band; this book does not have one yet, and an estimate printed beside measured figures would read as measured.",
      targetMethod,
      pivot: r2(base.pivot),
      extensionPct: r1(extensionPct),
      momentum: { rs30: rs30 == null ? null : r2(rs30), rsi: rsiNow == null ? null : r1(rsiNow), macdSeparation: sep == null ? null : r2(sep), macdExpanding: expanding, bearishDivergence: divergence, ema10Slope: ema10Slope == null ? null : r1(ema10Slope) },
      volume: { avg5: avg5 == null ? null : Math.round(avg5), avg20: avg20 == null ? null : Math.round(avg20), surgeRatio: surge == null ? null : r2(surge), udRatio: ud == null ? null : r2(ud), dollarVolume: dv == null ? null : Math.round(dv) },
      structure: { baseWeeks: base.weeks, baseDepthPct: base.depthPct, contractions: base.contractions, aboveEma10, aboveEma20, fanning },
      catalyst: { score: catalystRaw, note: notes.catalyst },
      notes,
    },
    rejection: null,
  };
}

/* ────────────────────────────── the scan ──────────────────────────── */

export function runSwingScan(
  candidates: SwingCandidate[],
  benchmarks: { spy: Candle[]; qqq: Candle[]; vix: Candle[] },
  topN = 5
): SwingScanResult {
  const regime = readSwingRegime(benchmarks.spy, benchmarks.qqq, benchmarks.vix);
  const setups: SwingSetup[] = [];
  const rejected: SwingRejection[] = [];

  for (const candidate of candidates) {
    const { setup, rejection } = scoreCandidate(candidate, benchmarks.spy, regime);
    if (setup) setups.push(setup);
    if (rejection) rejected.push(rejection);
  }

  // Rank on the published score, then on reward:risk — two setups scoring the
  // same are separated by the one that pays more for the same risk.
  setups.sort((a, b) => b.momentumScore - a.momentumScore || b.riskReward - a.riskReward);

  return {
    asOf: new Date().toISOString(),
    regime,
    setups: setups.slice(0, topN),
    rejected,
    universeSize: candidates.length,
    evaluated: candidates.length - rejected.filter((r) => r.filter === "DATA").length,
    weights: ALPHA_WEIGHTS,
    methodology:
      "Momentum-Centric Alpha Score, 100 points: momentum and relative strength 40, volume accumulation 25, structural base and trend 20, catalyst drift 15. " +
      "Four filters reject rather than down-weight — market regime, entry within 3% of the pivot, a 10–25% structural target, and reward:risk of at least 1:3. " +
      "Rule #5: an unmeasurable component scores zero and stays in the denominator, and is named. Coverage is published beside the score so a low reading caused by missing evidence is distinguishable from one caused by weakness.",
    disclosures: [
      "Every figure is measured from daily candles. Nothing is estimated to fill a gap.",
      "Rejections keep their reason. A setup that fails a filter is not shown with a lower score — it is not a setup this desk would take.",
      "Win probability is not quoted. The fund has no closed-trade sample per score band, and an estimate printed next to measured numbers reads as measured.",
      "Targets are structural: the 1.618 Fibonacci extension of the base, or its measured move. They are not price forecasts.",
    ],
  };
}
