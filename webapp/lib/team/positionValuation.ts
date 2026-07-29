// Sentinel Global Fund — position valuation desk.
//
// Answers two questions for every holding: is the price cheap, fair or rich
// against what this instrument has historically been worth, and what size
// change does that imply — add, hold, trim, or exit the position entirely.
//
// Fair value is never taken from a single model. Three independent anchors are
// computed where the data supports them and blended by confidence:
//
//   1. Earnings multiple  — median P/E the market has actually paid, applied to
//      forward EPS. Only used with enough history; the "current P/E ± band"
//      fallback is deliberately excluded because it prices the stock off its own
//      price and would always read FAIR.
//   2. Dividend yield     — current distribution capitalised at the median yield
//      the market has assigned this instrument. The workable anchor for BDCs,
//      REITs and income ETFs, which have no meaningful EPS series.
//   3. Trend              — log-linear regression of price on time. The only
//      anchor available for broad ETFs; weighted lightly and by fit quality.
//
// The FAIR band widens when the anchors disagree, so a name whose valuation is
// genuinely uncertain is not labelled OVERVALUED on a coin-flip.

import type { Candle } from "../types";
import type { AnnualEps } from "../sec";
import type { DividendEvent } from "../dividends";
import type { MomentumScoreV3 } from "./scoring";
import type { RegimeAssessment } from "./governance";
import type { Sleeve } from "./portfolio";
import { assessPositionZone, type ZoneAssessment } from "./risk";
import { multipleScenarios } from "../valuation";

export type ValuationVerdict =
  | "DEEP VALUE" | "UNDERVALUED" | "FAIR" | "OVERVALUED" | "STRETCHED"
  /** Constant-NAV instrument: its price is its value, so no verdict applies. */
  | "CASH EQUIVALENT";
export type PositionAction = "ADD" | "HOLD" | "WATCH" | "TRIM" | "EXIT";

export interface FairValueAnchor {
  method: string;
  fairValue: number;
  /** Relative confidence weight used in the blend. */
  weight: number;
  detail: string;
}

export interface ValuationRead {
  fairValue: number | null;
  /** Price against fair value, in percent. Positive = trading above fair. */
  deviationPct: number | null;
  verdict: ValuationVerdict | null;
  /** Half-width of the FAIR band in percent — widens as anchors disagree. */
  fairBandPct: number;
  anchors: FairValueAnchor[];
  confidence: "high" | "medium" | "low";
  /** Price at the top of the FAIR band — the level an add becomes defensible. */
  buyBelow: number | null;
  /** True for constant-NAV instruments, where no verdict is meaningful. */
  cashLike?: boolean;
  note: string;
}

/** Anchors carrying this label describe price behaviour, not fundamentals. */
const TREND_METHOD = "Trend regression";

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ── Anchor 1: earnings multiple ──────────────────────────────────────────

/** No market sustains a median multiple above this; beyond it the denominator broke. */
const MAX_PLAUSIBLE_PE = 60;

function earningsAnchor(
  candles: Candle[],
  annualEps: AnnualEps[],
  epsTTM: number | null,
  price: number
): FairValueAnchor | null {
  if (!annualEps.length) return null;
  const sc = multipleScenarios(candles, annualEps, epsTTM, null);
  // `observations` below 8 means multipleScenarios fell back to the current
  // multiple, which prices the stock off itself — no information.
  if (!sc || sc.observations < 8 || !(sc.base > 0)) return null;

  // A company whose earnings were near zero a few years ago carries a median
  // "P/E" of several hundred times — an artifact of the depressed denominator,
  // not a multiple anyone paid for earnings power. Left in, it prints a fair
  // value multiples above the market and labels an extended stock DEEP VALUE.
  if (sc.peMid > MAX_PLAUSIBLE_PE) return null;
  const ratio = price > 0 ? sc.base / price : 0;
  if (!(ratio >= 0.4 && ratio <= 2.5)) return null;

  return {
    method: "Earnings multiple",
    fairValue: round2(sc.base),
    weight: sc.observations >= 24 ? 3 : 2,
    detail: `Median P/E ${sc.peMid.toFixed(1)}× (${sc.observations} monthly observations) on forward EPS $${sc.forwardEps.toFixed(2)}`,
  };
}

// ── Anchor 2: dividend yield reversion ───────────────────────────────────

/** Trailing-12-month distribution as of a given date. */
function ttmDividendAt(events: DividendEvent[], date: string): number {
  const from = new Date(new Date(date).getTime() - 365 * 86400000).toISOString().slice(0, 10);
  let sum = 0;
  for (const e of events) {
    if (e.date > from && e.date <= date) sum += e.amount;
  }
  return sum;
}

function yieldAnchor(candles: Candle[], events: DividendEvent[]): FairValueAnchor | null {
  if (events.length < 4 || candles.length < 260) return null;

  // Sample the yield the market assigned, monthly, once a full year of
  // distribution history exists at that point.
  const firstUsable = new Date(new Date(events[0].date).getTime() + 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  const yields: number[] = [];
  for (let i = 0; i < candles.length; i += 21) {
    const c = candles[i];
    if (c.date < firstUsable || c.close <= 0) continue;
    const div = ttmDividendAt(events, c.date);
    if (div > 0) yields.push(div / c.close);
  }
  if (yields.length < 12) return null;

  const medYield = median(yields);
  if (!medYield || medYield <= 0) return null;

  const last = candles[candles.length - 1];
  const currentDiv = ttmDividendAt(events, last.date);
  if (currentDiv <= 0) return null;

  return {
    method: "Dividend yield",
    fairValue: round2(currentDiv / medYield),
    weight: yields.length >= 36 ? 3 : 2,
    detail: `TTM distribution $${currentDiv.toFixed(2)} capitalised at the median ${(medYield * 100).toFixed(2)}% yield (${yields.length} monthly observations)`,
  };
}

// ── Anchor 3: trend regression ───────────────────────────────────────────

function trendAnchor(candles: Candle[]): FairValueAnchor | null {
  const window = candles.slice(-Math.min(candles.length, 756));
  if (window.length < 250) return null;

  const n = window.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const y = Math.log(window[i].close);
    if (!Number.isFinite(y)) return null;
    ys.push(y);
    sx += i; sy += y; sxx += i * i; sxy += i * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  // R² so a directionless price series is not treated as a trend
  const meanY = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * i;
    ssTot += (ys[i] - meanY) ** 2;
    ssRes += (ys[i] - fit) ** 2;
  }
  if (ssTot <= 0) return null;
  const r2 = 1 - ssRes / ssTot;
  // A poor fit means there is no trend to be above or below — the "fair value"
  // would just be the midpoint of a round trip.
  if (r2 < 0.3) return null;

  const fair = Math.exp(intercept + slope * (n - 1));
  if (!Number.isFinite(fair) || fair <= 0) return null;

  return {
    method: TREND_METHOD,
    fairValue: round2(fair),
    weight: r2 >= 0.6 ? 1.5 : 1,
    detail: `Log-linear fit over ${n} sessions, R² ${r2.toFixed(2)}, ${(slope * 252 * 100).toFixed(1)}%/yr drift`,
  };
}

// ── Blend ────────────────────────────────────────────────────────────────

export interface ValuationInput {
  candles: Candle[];
  price: number;
  annualEps?: AnnualEps[];
  epsTTM?: number | null;
  dividends?: DividendEvent[];
  /** Discounted-cash-flow output, when one could be computed. */
  dcf?: { fairValue: number; wacc: number; terminalSharePct: number; reliable: boolean } | null;
}

/**
 * The DCF as one voice rather than the verdict.
 *
 * A standalone DCF is the easiest way to print a nonsense fair value: the
 * terminal value is usually most of the answer, and small changes in WACC or
 * the growth taper move it enormously. Here it enters on the same terms as
 * every other anchor — subject to the plausibility gate and to outlier
 * rejection — and is weighted down when the terminal value dominates, so a
 * runaway perpetuity gets outvoted by the multiple and yield anchors instead
 * of overruling them.
 */
function dcfAnchor(
  dcf: NonNullable<ValuationInput["dcf"]>,
  price: number
): FairValueAnchor | null {
  if (!(dcf.fairValue > 0) || !(price > 0)) return null;
  const ratio = dcf.fairValue / price;
  if (!(ratio >= 0.4 && ratio <= 2.5)) return null;
  return {
    method: "Discounted cash flow",
    fairValue: round2(dcf.fairValue),
    weight: dcf.reliable ? 1.5 : 0.75,
    detail: `5-year FCF at a ${(dcf.wacc * 100).toFixed(1)}% WACC; ${dcf.terminalSharePct.toFixed(0)}% of the value is the terminal value${dcf.reliable ? "" : " — above the 80% line, so the model is weighted down as a perpetuity guess"}`,
  };
}

/**
 * Constant-NAV instruments — T-bill and ultra-short funds like SGOV, BIL and
 * JAAA — hold a pinned price and pass through whatever short rates pay. Every
 * anchor here misreads them: capitalising a floating distribution at a
 * historical median yield says SGOV is "20% overvalued" the moment rates rise,
 * and a trend regression through a sawtooth of ex-dividend drops is noise. For
 * these the price *is* the value, so the desk withholds a verdict rather than
 * inventing one.
 */
function cashLike(candles: Candle[]): { isCash: boolean; detail: string } {
  const win = candles.slice(-252);
  if (win.length < 60) return { isCash: false, detail: "" };
  const closes = win.map((c) => c.close).filter((c) => c > 0);
  if (closes.length < 60) return { isCash: false, detail: "" };

  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  const mid = (hi + lo) / 2;
  const rangePct = mid > 0 ? ((hi - lo) / mid) * 100 : 100;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1);
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100;

  const isCash = rangePct < 8 && vol < 4;
  return {
    isCash,
    detail: isCash
      ? `Constant-NAV instrument — ${rangePct.toFixed(1)}% price range and ${vol.toFixed(1)}% realized volatility over the past year. Its price is its value; the distribution floats with short rates, so no fair-value verdict applies.`
      : "",
  };
}

export function assessValuation(input: ValuationInput): ValuationRead {
  const { candles, price } = input;

  const cash = cashLike(candles);
  if (cash.isCash && price > 0) {
    return {
      fairValue: round2(price),
      deviationPct: 0,
      verdict: "CASH EQUIVALENT",
      fairBandPct: 8,
      anchors: [],
      confidence: "high",
      buyBelow: null,
      cashLike: true,
      note: cash.detail,
    };
  }

  const anchors: FairValueAnchor[] = [];

  const eA = input.annualEps?.length
    ? earningsAnchor(candles, input.annualEps, input.epsTTM ?? null, price)
    : null;
  if (eA) anchors.push(eA);

  const yA = input.dividends?.length ? yieldAnchor(candles, input.dividends) : null;
  if (yA) anchors.push(yA);

  const tA = trendAnchor(candles);
  if (tA) anchors.push(tA);

  const dA = input.dcf ? dcfAnchor(input.dcf, price) : null;
  if (dA) anchors.push(dA);

  // Three independent methods should land in the same neighbourhood. When one
  // sits more than 2.2× away from where the others agree, it is measuring a
  // broken input rather than a different view of value — drop it and say so.
  const rejected: FairValueAnchor[] = [];
  if (anchors.length >= 3) {
    for (let i = anchors.length - 1; i >= 0; i--) {
      const others = anchors.filter((_, j) => j !== i).map((a) => a.fairValue);
      const ref = median(others);
      if (!ref || ref <= 0) continue;
      const ratio = anchors[i].fairValue / ref;
      if (ratio > 2.2 || ratio < 1 / 2.2) rejected.push(...anchors.splice(i, 1));
    }
  }

  if (!anchors.length || !(price > 0)) {
    return {
      fairValue: null,
      deviationPct: null,
      verdict: null,
      fairBandPct: 8,
      anchors,
      confidence: "low",
      buyBelow: null,
      cashLike: false,
      note: "No usable valuation anchor — needs either an EPS history, a distribution history, or a year of prices.",
    };
  }

  const totalW = anchors.reduce((s, a) => s + a.weight, 0);
  const fairValue = anchors.reduce((s, a) => s + a.fairValue * a.weight, 0) / totalW;
  const deviationPct = ((price - fairValue) / fairValue) * 100;

  // Dispersion between anchors widens the band the FAIR verdict occupies.
  const values = anchors.map((a) => a.fairValue);
  const spread = anchors.length > 1 ? (Math.max(...values) - Math.min(...values)) / fairValue : 0;
  const fairBandPct = round2(8 * (1 + clamp(spread, 0, 1)));
  const outerBandPct = fairBandPct * 2.5;

  let verdict: ValuationVerdict;
  if (deviationPct <= -outerBandPct) verdict = "DEEP VALUE";
  else if (deviationPct <= -fairBandPct) verdict = "UNDERVALUED";
  else if (deviationPct < fairBandPct) verdict = "FAIR";
  else if (deviationPct < outerBandPct) verdict = "OVERVALUED";
  else verdict = "STRETCHED";

  const heavy = anchors.filter((a) => a.weight >= 2).length;
  const confidence: ValuationRead["confidence"] =
    anchors.length >= 2 && heavy >= 1 && spread < 0.25 ? "high"
    : heavy >= 1 || anchors.length >= 2 ? "medium"
    : "low";

  return {
    fairValue: round2(fairValue),
    deviationPct: round2(deviationPct),
    verdict,
    fairBandPct,
    anchors,
    confidence,
    buyBelow: round2(fairValue * (1 + fairBandPct / 100)),
    note: [
      anchors.length === 1
        ? `Single anchor (${anchors[0].method}) — treat the reading as indicative.`
        : `Blend of ${anchors.length} anchors; they disagree by ${(spread * 100).toFixed(0)}% of fair value, so the FAIR band is ±${fairBandPct.toFixed(1)}%.`,
      rejected.length
        ? `Discarded as an outlier: ${rejected.map((r) => `${r.method} $${r.fairValue}`).join(", ")} — more than 2.2× away from where the other methods agree.`
        : "",
    ].filter(Boolean).join(" "),
  };
}

// ── Sizing & action ──────────────────────────────────────────────────────
//
// Sizing is governed by the position cap, not by a modelled "ideal" weight.
//
// An earlier version split each sleeve's budget across its names by conviction
// and called the result a target. With a ten-name book that produced targets of
// 2-6% and therefore a TRIM on every single position, including names the same
// engine had just scored STRONG BUY — an instruction nobody would follow and no
// rule actually required. The desk now starts from the position the investor
// holds and only moves it when a rule says to:
//
//   > 23%  mandatory trim back to the 20% cap (Rule #3).
//   20-23% permitted, as WATCH, but only while the price is still at or below
//          fair value and the name is running with a leading theme. That is a
//          deliberate, temporary overweight to let a winner run; it carries a
//          trim trigger so the gain is capped rather than left open.
//   ≤ 20%  hold by default. Adds need a positive reason; trims need a negative
//          one. Neither is manufactured out of a weight arithmetic.

/** Rule #3 — the standing single-name cap. */
export const NAME_CAP_PCT = 20;
/** The overweight a leading, still-cheap name may hold under WATCH. */
export const WATCH_CAP_PCT = 23;
/** Below this weight, a valuation-only trim is noise rather than risk control. */
const MIN_TRIM_WEIGHT_PCT = 5;

export type ConvictionGrade = "STRONG" | "ADEQUATE" | "WEAK" | "BROKEN" | "N/A";

/**
 * Conviction, scored on the model that fits the instrument.
 *
 * Momentum Scoring v3.0 asks whether a name is trending hard enough to carry a
 * swing trade. Applied to an income ETF it answers a question nobody asked:
 * BALI scored 17/100 with three hard blocks, which says only that a covered-call
 * fund does not trend — not that the position is bad. Each sleeve is therefore
 * graded on its own terms.
 */
export interface Conviction {
  grade: ConvictionGrade;
  /** 0-100 within the sleeve's own model, or null where none applies. */
  score: number | null;
  model: string;
  detail: string;
  /** Structural failures that forbid an add regardless of valuation. */
  blocks: string[];
}

export interface IncomeQuality {
  /** Forward distribution yield, percent. */
  yieldPct: number | null;
  /** Current TTM distribution against the one a year earlier. */
  distributionGrowthPct: number | null;
  /** Payments in the last 3 years that came in below the prior payment. */
  cuts: number;
  payments: number;
}

/** Distribution durability, for the income sleeve. */
export function gradeIncome(q: IncomeQuality): Conviction {
  const blocks: string[] = [];
  if (q.payments < 4) {
    return {
      grade: "N/A", score: null, model: "Distribution quality",
      detail: "Fewer than four distributions on record — not enough history to grade.",
      blocks: [],
    };
  }

  let score = 50;
  const bits: string[] = [];

  if (q.yieldPct != null) {
    // The fund's income objective is a 5% blended yield.
    if (q.yieldPct >= 7) { score += 20; bits.push(`${q.yieldPct.toFixed(1)}% yield, well above the 5% objective`); }
    else if (q.yieldPct >= 5) { score += 15; bits.push(`${q.yieldPct.toFixed(1)}% yield, at or above the 5% objective`); }
    else if (q.yieldPct >= 3) { score += 6; bits.push(`${q.yieldPct.toFixed(1)}% yield, below the 5% objective`); }
    else { bits.push(`${q.yieldPct.toFixed(1)}% yield — thin for an income sleeve position`); }
  }

  if (q.distributionGrowthPct != null) {
    const g = q.distributionGrowthPct;
    if (g >= 5) { score += 20; bits.push(`distribution up ${g.toFixed(1)}% year on year`); }
    else if (g >= 0) { score += 12; bits.push(`distribution flat to +${g.toFixed(1)}%`); }
    else if (g >= -10) { score -= 5; bits.push(`distribution down ${Math.abs(g).toFixed(1)}%`); }
    else {
      score -= 25;
      bits.push(`distribution down ${Math.abs(g).toFixed(1)}% year on year`);
      blocks.push(`Distribution cut ${Math.abs(g).toFixed(1)}% over the past year — the income thesis is impaired`);
    }
  }

  const cutRate = q.payments > 0 ? q.cuts / q.payments : 0;
  if (cutRate <= 0.1) { score += 15; bits.push(`${q.cuts} cut${q.cuts === 1 ? "" : "s"} in ${q.payments} payments — steady`); }
  else if (cutRate <= 0.3) { score += 5; bits.push(`${q.cuts} of ${q.payments} payments below the prior one — variable`); }
  else { score -= 10; bits.push(`${q.cuts} of ${q.payments} payments below the prior one — erratic`); }

  score = Math.max(0, Math.min(100, score));
  let grade: ConvictionGrade =
    blocks.length ? "BROKEN" : score >= 75 ? "STRONG" : score >= 55 ? "ADEQUATE" : "WEAK";

  // Stability alone must not carry a thin payer to a strong grade. A perfectly
  // steady 1.2% distribution scores well on every consistency term and would
  // otherwise grade STRONG, which says nothing about whether it belongs in an
  // income sleeve underwritten to a 5% blended yield.
  if (grade !== "BROKEN" && q.yieldPct != null) {
    if (q.yieldPct < 3 && grade !== "WEAK") {
      grade = "WEAK";
      bits.push(`grade capped at WEAK — a ${q.yieldPct.toFixed(1)}% yield does not carry an income-sleeve position however steady it is`);
    } else if (q.yieldPct < 5 && grade === "STRONG") {
      grade = "ADEQUATE";
      bits.push(`grade capped at ADEQUATE — the yield is below the fund's 5% objective`);
    }
  }

  return { grade, score, model: "Distribution quality", detail: bits.join("; ") + ".", blocks };
}

/** Momentum v3.0, for the growth sleeve. */
export function gradeMomentum(score: MomentumScoreV3): Conviction {
  const blocks = score.hardBlocks.map((b) => b.reason);
  const grade: ConvictionGrade =
    score.signal === "STRONG BUY" ? "STRONG"
    : score.signal === "BUY" ? "ADEQUATE"
    : score.hardBlocks.some((b) => b.code === "BELOW_200SMA") ? "BROKEN"
    : "WEAK";
  return {
    grade, score: score.total, model: "Momentum Scoring v3.0",
    detail: `${score.total}/100 — ${score.signal}. ${score.signalReason}`,
    blocks,
  };
}

export interface PositionInput {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number | null;
  sleeve: Sleeve;
  valuation: ValuationRead;
  conviction: Conviction;
  /** ATR stop, used to cap an add against the 1.5%-of-NAV trade risk limit. */
  stop?: number | null;
  /** Set when the name sits in a theme currently leading the market. */
  theme?: { label: string; rsPct: number } | null;
}

export interface PositionPlan {
  ticker: string;
  sleeve: Sleeve;
  price: number | null;
  marketValue: number;
  weightPct: number;
  /** Weight the position would carry after the recommended action. */
  targetWeightPct: number;
  fairValue: number | null;
  deviationPct: number | null;
  verdict: ValuationVerdict | null;
  confidence: ValuationRead["confidence"];
  buyBelow: number | null;
  anchors: FairValueAnchor[];
  valuationNote: string;
  conviction: Conviction;
  theme: { label: string; rsPct: number } | null;
  zone: ZoneAssessment;
  action: PositionAction;
  /** Positive = buy, negative = sell. */
  deltaShares: number;
  deltaValue: number;
  /** Price at which a WATCH overweight must be trimmed back to the cap. */
  trimTrigger: number | null;
  headline: string;
  reasons: string[];
  guard: string | null;
  priority: number;
}

export interface BookActionInput {
  positions: PositionInput[];
  nav: number;
  regime: RegimeAssessment | null;
}

export interface BookActionResult {
  plans: PositionPlan[];
  notes: string[];
}

/** How much of NAV an add may put to work, before the risk cap trims it. */
function addBudgetPct(p: PositionInput, regime: RegimeAssessment | null): number {
  let base = p.conviction.grade === "STRONG" ? 5 : p.conviction.grade === "ADEQUATE" ? 3 : 0;
  // A cheaper price buys a bigger step.
  if (p.valuation.verdict === "DEEP VALUE") base *= 1.5;
  // The regime governs how much of a plan may be deployed at all.
  if (regime?.regime === "Neutral") base *= 0.75;
  else if (regime?.regime === "Risk-Off") base *= p.sleeve === "Growth/Momentum" ? 0 : 0.33;
  else if (regime?.regime === "Crisis") base = 0;
  return base;
}

export function buildPositionActions(input: BookActionInput): BookActionResult {
  const { positions, nav, regime } = input;
  const notes: string[] = [];

  const plans: PositionPlan[] = positions.map((p) => {
    const price = p.price;
    const mv = (price ?? p.avgCost) * p.shares;
    const weightPct = nav > 0 ? (mv / nav) * 100 : 0;
    const zone = assessPositionZone(weightPct, mv, nav);

    const v = p.valuation;
    const dev = v.deviationPct;
    const cheap = v.verdict === "DEEP VALUE" || v.verdict === "UNDERVALUED";
    const rich = v.verdict === "OVERVALUED" || v.verdict === "STRETCHED";
    const cashLike = v.verdict === "CASH EQUIVALENT";
    const leading = p.theme != null;

    const reasons: string[] = [];
    let guard: string | null = null;
    let trimTrigger: number | null = null;
    let action: PositionAction = "HOLD";
    let deltaValue = 0;

    if (cashLike) {
      reasons.push(`Cash equivalent — ${v.note}`);
    } else if (v.verdict) {
      reasons.push(
        `${v.verdict} — $${price?.toFixed(2) ?? "n/a"} against fair value $${v.fairValue?.toFixed(2)} (${dev != null && dev >= 0 ? "+" : ""}${dev?.toFixed(1)}%, ${v.confidence} confidence).`
      );
    } else {
      reasons.push(v.note);
    }
    if (p.conviction.grade !== "N/A") {
      reasons.push(`${p.conviction.model}: ${p.conviction.detail}`);
    }
    if (p.theme) {
      reasons.push(`Running with ${p.theme.label}, ${p.theme.rsPct >= 0 ? "+" : ""}${p.theme.rsPct.toFixed(1)}% relative to SPY over 3 months.`);
    }

    // 1 ── Exit: a broken structure with no fundamental support beneath it.
    const hasFundamentalAnchor = v.anchors.some((a) => a.method !== TREND_METHOD);
    const valuationSupport = cheap && hasFundamentalAnchor && v.confidence !== "low";
    const structurallyBroken = p.conviction.grade === "BROKEN";

    if (structurallyBroken && !valuationSupport && !cashLike && p.shares > 0) {
      action = "EXIT";
      deltaValue = -mv;
      reasons.push(
        `Exit: ${p.conviction.blocks.join("; ")}${hasFundamentalAnchor ? "" : ", and the only fair-value read available is its own price trend, which offers no support"}.`
      );
      guard = "Rule #4 — exit on the stop or into strength, not at the open on a gap.";
    }
    // 2 ── Above the WATCH ceiling: trim back to the cap, no exceptions.
    else if (weightPct > WATCH_CAP_PCT) {
      action = "TRIM";
      deltaValue = -((weightPct - NAME_CAP_PCT) / 100) * nav;
      reasons.push(
        `${weightPct.toFixed(1)}% of NAV is beyond the ${WATCH_CAP_PCT}% ceiling — trim to the ${NAME_CAP_PCT}% cap (Rule #3). No valuation argument overrides this.`
      );
    }
    // 3 ── The 20-23% band: a permitted overweight, on conditions.
    else if (weightPct > NAME_CAP_PCT) {
      const priceSupportsIt = cheap || v.verdict === "FAIR" || cashLike;
      if (priceSupportsIt && (leading || cashLike)) {
        action = "WATCH";
        trimTrigger = v.buyBelow != null ? round2(v.buyBelow * 1.12) : null;
        reasons.push(
          `${weightPct.toFixed(1)}% is over the ${NAME_CAP_PCT}% cap but inside the ${WATCH_CAP_PCT}% watch band: the price is still ${cashLike ? "at par" : "at or below fair value"}${leading ? ` and the name is running with ${p.theme!.label}` : ""}. Hold the overweight to capture the move rather than trimming a winner early.`
        );
        guard = trimTrigger
          ? `Trim back to ${NAME_CAP_PCT}% once the price clears $${trimTrigger.toFixed(2)}, or immediately if the weight passes ${WATCH_CAP_PCT}%.`
          : `Trim back to ${NAME_CAP_PCT}% as soon as the valuation stops supporting the overweight, or if the weight passes ${WATCH_CAP_PCT}%.`;
      } else {
        action = "TRIM";
        deltaValue = -((weightPct - NAME_CAP_PCT) / 100) * nav;
        reasons.push(
          rich
            ? `${weightPct.toFixed(1)}% is over the ${NAME_CAP_PCT}% cap and the price is above fair value — the watch band is not available. Trim to the cap.`
            : `${weightPct.toFixed(1)}% is over the ${NAME_CAP_PCT}% cap and the name is not leading a theme — the watch band requires both. Trim to the cap.`
        );
      }
    }
    // 4 ── Inside the cap: hold unless there is a reason to move.
    else if (rich && weightPct >= MIN_TRIM_WEIGHT_PCT) {
      const fraction = v.verdict === "STRETCHED" ? 0.33 : 0.2;
      action = "TRIM";
      deltaValue = -mv * fraction;
      reasons.push(
        `Inside the cap, but ${dev?.toFixed(1)}% above fair value — take ${Math.round(fraction * 100)}% off and keep the rest. Revisit below $${v.buyBelow?.toFixed(2)}.`
      );
    } else if (cheap && !cashLike) {
      const budget = addBudgetPct(p, regime);
      const room = Math.max(0, NAME_CAP_PCT - weightPct);
      let addPct = Math.min(budget, room);

      if (p.conviction.blocks.length) {
        reasons.push(`No add — ${p.conviction.blocks.join("; ")}.`);
      } else if (addPct <= 0) {
        reasons.push(
          budget <= 0
            ? `No add — ${regime ? `the ${regime.regime} regime permits none for this sleeve (${regime.deployRule.toLowerCase()})` : "conviction is not strong enough to justify one"}.`
            : `Already at the ${NAME_CAP_PCT}% cap — no room to add.`
        );
      } else {
        action = "ADD";
        deltaValue = (addPct / 100) * nav;
        reasons.push(
          `Cheap against fair value with ${p.conviction.grade.toLowerCase()} conviction and room under the cap — step in with ${addPct.toFixed(1)}% of NAV.`
        );
        // Rule #4 — the incremental trade may not risk more than 1.5% of NAV.
        if (price && p.stop != null && p.stop > 0 && p.stop < price) {
          const maxShares = Math.floor((nav * 0.015) / (price - p.stop));
          const maxValue = maxShares * price;
          if (maxValue < deltaValue) {
            deltaValue = maxValue;
            reasons.push(
              `Add capped at ${maxShares} shares by the 1.5%-of-NAV trade risk limit (stop $${p.stop.toFixed(2)}, $${(price - p.stop).toFixed(2)}/share at risk).`
            );
            guard = `Stop $${p.stop.toFixed(2)} must be live before adding (Rule #4).`;
          }
        }
      }
    } else if (rich) {
      reasons.push(
        `${dev?.toFixed(1)}% above fair value, but at ${weightPct.toFixed(1)}% of NAV a trim would be noise rather than risk control — hold and revisit below $${v.buyBelow?.toFixed(2)}.`
      );
    } else {
      reasons.push(
        cashLike
          ? `Held as the cash sleeve at ${weightPct.toFixed(1)}% of NAV${regime ? `, against a ${regime.cashMinPct}% floor for the ${regime.regime} regime` : ""}.`
          : `Fairly priced at ${weightPct.toFixed(1)}% of NAV, inside the ${NAME_CAP_PCT}% cap — nothing to do.`
      );
    }

    // Minimum trade size: never recommend a trade too small to be worth the spread.
    const minTrade = Math.max(nav * 0.0075, 200);
    if (action !== "EXIT" && action !== "WATCH" && Math.abs(deltaValue) > 0 && Math.abs(deltaValue) < minTrade) {
      reasons.push(`Sized at ${money(Math.abs(deltaValue))}, below the minimum worth trading — hold.`);
      action = "HOLD";
      deltaValue = 0;
    }

    // Whole shares, never selling more than is held.
    let deltaShares = 0;
    if (price && price > 0) {
      if (action === "EXIT") deltaShares = -p.shares;
      else if (deltaValue !== 0) {
        deltaShares = Math.trunc(deltaValue / price);
        if (deltaShares < 0) deltaShares = Math.max(deltaShares, -p.shares);
      }
      if (action !== "EXIT" && action !== "WATCH" && action !== "HOLD" && deltaShares === 0) {
        reasons.push("Rounds to zero shares at the current price — hold.");
        action = "HOLD";
        deltaValue = 0;
      } else if (action !== "EXIT") {
        deltaValue = deltaShares * price;
      }
    } else if (action !== "HOLD") {
      reasons.push("No live price — sizing cannot be computed.");
      action = "HOLD";
      deltaValue = 0;
      deltaShares = 0;
    }

    const targetWeightPct = nav > 0 ? ((mv + deltaValue) / nav) * 100 : 0;

    const headline =
      action === "EXIT" ? `Sell all ${p.shares} shares (≈${money(Math.abs(deltaValue || mv))})`
      : action === "TRIM" ? `Trim ${Math.abs(deltaShares)} shares (≈${money(Math.abs(deltaValue))})`
      : action === "ADD" ? `Add ${deltaShares} shares (≈${money(deltaValue)})`
      : action === "WATCH" ? `Hold the overweight — trim${trimTrigger ? ` above ${money(trimTrigger)}` : " on the trigger"}`
      : "Hold — no change";

    const priority =
      action === "EXIT" ? 0
      : action === "TRIM" ? 1
      : action === "WATCH" ? 2
      : action === "ADD" ? 3
      : 4;

    return {
      ticker: p.ticker,
      sleeve: p.sleeve,
      price,
      marketValue: round2(mv),
      weightPct: round2(weightPct),
      targetWeightPct: round2(targetWeightPct),
      fairValue: v.fairValue,
      deviationPct: dev,
      verdict: v.verdict,
      confidence: v.confidence,
      buyBelow: v.buyBelow,
      anchors: v.anchors,
      valuationNote: v.note,
      conviction: p.conviction,
      theme: p.theme ?? null,
      zone,
      action,
      deltaShares,
      deltaValue: round2(deltaValue),
      trimTrigger,
      headline,
      reasons,
      guard,
      priority,
    };
  });

  plans.sort((a, b) => a.priority - b.priority || Math.abs(b.deltaValue) - Math.abs(a.deltaValue));

  notes.push(
    `Sizing is governed by the ${NAME_CAP_PCT}% single-name cap (Rule #3). A position may sit between ${NAME_CAP_PCT}% and ${WATCH_CAP_PCT}% as WATCH only while it is still at or below fair value and running with a leading theme; that overweight carries a trim trigger so the gain is capped rather than left open.`
  );
  notes.push(
    "Inside the cap the desk holds by default. An add needs a cheap price, sleeve-appropriate conviction and a regime that permits deployment; a trim needs a rich price and a position large enough for the trim to matter."
  );
  if (regime) {
    notes.push(`${regime.icon} ${regime.regime} regime (${regime.score}/100) — ${regime.deployRule}. Cash floor ${regime.cashMinPct}%.`);
  }

  return { plans, notes };
}

function money(v: number): string {
  return `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
