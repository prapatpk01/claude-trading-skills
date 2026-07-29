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
import { SLEEVE_TARGETS } from "./portfolio";
import { assessPositionZone, type ZoneAssessment } from "./risk";
import { multipleScenarios } from "../valuation";

export type ValuationVerdict = "DEEP VALUE" | "UNDERVALUED" | "FAIR" | "OVERVALUED" | "STRETCHED";
export type PositionAction = "ADD" | "HOLD" | "TRIM" | "EXIT";

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
}

export function assessValuation(input: ValuationInput): ValuationRead {
  const { candles, price } = input;
  const anchors: FairValueAnchor[] = [];

  const eA = input.annualEps?.length
    ? earningsAnchor(candles, input.annualEps, input.epsTTM ?? null, price)
    : null;
  if (eA) anchors.push(eA);

  const yA = input.dividends?.length ? yieldAnchor(candles, input.dividends) : null;
  if (yA) anchors.push(yA);

  const tA = trendAnchor(candles);
  if (tA) anchors.push(tA);

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

// ── Target weight & action ───────────────────────────────────────────────

export interface PositionInput {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number | null;
  sleeve: Sleeve;
  valuation: ValuationRead;
  score: MomentumScoreV3 | null;
  /** ATR stop, used to cap an add against the 1.5%-of-NAV trade risk limit. */
  stop?: number | null;
}

export interface PositionPlan {
  ticker: string;
  sleeve: Sleeve;
  price: number | null;
  marketValue: number;
  weightPct: number;
  targetWeightPct: number;
  fairValue: number | null;
  deviationPct: number | null;
  verdict: ValuationVerdict | null;
  confidence: ValuationRead["confidence"];
  buyBelow: number | null;
  anchors: FairValueAnchor[];
  valuationNote: string;
  momentumScore: number | null;
  signal: string | null;
  zone: ZoneAssessment;
  action: PositionAction;
  /** Positive = buy, negative = sell. */
  deltaShares: number;
  deltaValue: number;
  headline: string;
  reasons: string[];
  /** Policy condition that must be satisfied before acting. */
  guard: string | null;
  priority: number;
}

export interface BookActionInput {
  positions: PositionInput[];
  nav: number;
  regime: RegimeAssessment | null;
  cashPct?: number;
}

export interface BookActionResult {
  plans: PositionPlan[];
  /** Sleeve targets after renormalising over the sleeves actually held. */
  sleeveBudget: { sleeve: Sleeve; budgetPct: number; heldPct: number }[];
  notes: string[];
}

/** Rule #3 — no single name may be targeted above this share of NAV. */
const NAME_CAP_PCT = 20;

/**
 * Split a sleeve's budget across its names by conviction tilt, then hand
 * whatever the single-name cap shaves off a high-conviction name to the names
 * that can still absorb it. Without this pass the capped excess would simply
 * vanish, under-targeting every other name in the sleeve and manufacturing
 * trim instructions that no rule actually calls for.
 */
function allocateSleeve(members: { ticker: string; tilt: number }[], budgetPct: number): Map<string, number> {
  const target = new Map<string, number>(members.map((m) => [m.ticker, 0]));
  let remaining = budgetPct;
  let open = members.slice();

  for (let pass = 0; pass < 10 && open.length && remaining > 0.01; pass++) {
    const tiltSum = open.reduce((s, m) => s + m.tilt, 0);
    if (tiltSum <= 0) break;
    const pot = remaining;
    const nextOpen: typeof open = [];
    for (const m of open) {
      const current = target.get(m.ticker) ?? 0;
      const give = Math.min(NAME_CAP_PCT, current + (pot * m.tilt) / tiltSum);
      remaining -= give - current;
      target.set(m.ticker, give);
      if (give < NAME_CAP_PCT - 1e-9) nextOpen.push(m);
    }
    open = nextOpen;
  }
  return target;
}

/** Conviction tilt: momentum raises the target weight, rich valuation cuts it. */
function convictionTilt(p: PositionInput): number {
  let tilt = 1;

  if (p.score) {
    tilt += clamp((p.score.total - 55) / 45, -1, 1) * 0.25;
    if (p.score.signal === "REJECT") tilt *= 0.5;
    else if (p.score.hardBlocks.length) tilt *= 0.75;
  }

  const dev = p.valuation.deviationPct;
  if (dev != null) tilt -= clamp(dev / 40, -1, 1) * 0.3;

  return clamp(tilt, 0.35, 1.7);
}

export function buildPositionActions(input: BookActionInput): BookActionResult {
  const { positions, nav, regime } = input;
  const notes: string[] = [];

  const valueOf = (p: PositionInput) => (p.price ?? p.avgCost) * p.shares;

  // Sleeve budgets renormalised over the sleeves actually populated. Without
  // this, a book holding no cash instrument would show every name as a large
  // TRIM purely because the 13% cash sleeve is unfilled — a structural gap the
  // sleeve-drift alert already reports, and one that would drown out the
  // per-name valuation signal this desk exists to give.
  const held = new Set(positions.map((p) => p.sleeve));
  const budgetBase = [...held].reduce((s, sl) => s + SLEEVE_TARGETS[sl], 0);
  const budget = new Map<Sleeve, number>();
  for (const sl of held) {
    budget.set(sl, budgetBase > 0 ? (SLEEVE_TARGETS[sl] / budgetBase) * 100 : 0);
  }
  if (!held.has("Cash/Defensive")) {
    notes.push(
      `Sleeve budgets are renormalised across the sleeves actually held, so the ${SLEEVE_TARGETS["Cash/Defensive"]}% cash sleeve is not charged against individual names. Raising cash is a separate allocation decision — see the sleeve drift alerts.`
    );
  }

  // Target weights: sleeve budget split by conviction tilt, capped at Rule #3.
  const tilts = new Map<string, number>();
  positions.forEach((p) => tilts.set(p.ticker, convictionTilt(p)));

  const targetWeight = new Map<string, number>();
  for (const sl of held) {
    const members = positions
      .filter((p) => p.sleeve === sl)
      .map((p) => ({ ticker: p.ticker, tilt: tilts.get(p.ticker) ?? 1 }));
    for (const [ticker, w] of allocateSleeve(members, budget.get(sl) ?? 0)) {
      targetWeight.set(ticker, w);
    }
  }
  const unallocated = 100 - [...targetWeight.values()].reduce((s, w) => s + w, 0);
  if (unallocated > 1) {
    notes.push(
      `${unallocated.toFixed(1)}% of NAV has no target: every name that could take more is already at the ${NAME_CAP_PCT}% single-name cap (Rule #3). That share belongs in a new position, not in a larger existing one.`
    );
  }

  const plans: PositionPlan[] = positions.map((p) => {
    const price = p.price;
    const mv = valueOf(p);
    const weightPct = nav > 0 ? (mv / nav) * 100 : 0;
    const zone = assessPositionZone(weightPct, mv, nav);

    const targetWeightPct = targetWeight.get(p.ticker) ?? 0;

    const v = p.valuation;
    const dev = v.deviationPct;
    const blocks = p.score?.hardBlocks ?? [];
    const brokenTrend = blocks.some((b) => b.code === "BELOW_200SMA");

    const reasons: string[] = [];
    let guard: string | null = null;
    let action: PositionAction = "HOLD";
    let deltaValue = 0;

    if (v.verdict) {
      reasons.push(
        `${v.verdict} — $${price?.toFixed(2) ?? "n/a"} against fair value $${v.fairValue?.toFixed(2)} (${dev != null && dev >= 0 ? "+" : ""}${dev?.toFixed(1)}%, ${v.confidence} confidence).`
      );
    } else {
      reasons.push(v.note);
    }
    if (p.score) {
      reasons.push(`Momentum ${p.score.total}/100 — ${p.score.signal}. ${p.score.signalReason}`);
    }

    // 1 ── Exit conditions take precedence over everything else.
    //
    // Only a fundamental anchor counts as valuation support under a broken
    // trend. A trend regression fitted through a round trip will always call
    // the far side of the fall "cheap" — that is the regression describing the
    // decline, not a reason to keep owning it.
    const hasFundamentalAnchor = v.anchors.some((a) => a.method !== TREND_METHOD);
    const valuationSupport =
      (v.verdict === "DEEP VALUE" || v.verdict === "UNDERVALUED") &&
      hasFundamentalAnchor &&
      v.confidence !== "low";

    const exitReasons: string[] = [];
    if (brokenTrend && !valuationSupport) {
      exitReasons.push(
        hasFundamentalAnchor
          ? "price below the 200-day SMA with no valuation support beneath it"
          : "price below the 200-day SMA, and the only fair-value read available is its own price trend — which offers no support"
      );
    }
    if (blocks.length >= 2 && (v.verdict === "OVERVALUED" || v.verdict === "STRETCHED")) {
      exitReasons.push(`${blocks.length} hard blocks on a name still priced above fair value`);
    }
    if (v.verdict === "STRETCHED" && p.score && p.score.total < 42) {
      exitReasons.push("stretched valuation with momentum already below the 42 floor");
    }

    if (exitReasons.length && p.shares > 0) {
      action = "EXIT";
      deltaValue = -mv;
      reasons.push(`Exit: ${exitReasons.join("; ")}.`);
      guard = "Rule #4 — exit on the stop or into strength, not at the open on a gap.";
    } else if (zone.zone === "EMERGENCY" || zone.zone === "TRIM") {
      // 2 ── Rule #3 concentration overrides the valuation-driven size.
      action = "TRIM";
      deltaValue = -(zone.trimToTarget ?? 0);
      reasons.push(`Rule #3 ${zone.zone} zone at ${weightPct.toFixed(1)}% of NAV — ${zone.action}.`);
      if (zone.zone === "TRIM") guard = "Research must identify a replacement before the trim (Rule #3).";
    } else {
      // 3 ── Otherwise size to the conviction-weighted target.
      const deltaPct = targetWeightPct - weightPct;
      deltaValue = (deltaPct / 100) * nav;
      const minTrade = Math.max(nav * 0.0075, 200);

      if (Math.abs(deltaValue) < minTrade) {
        action = "HOLD";
        deltaValue = 0;
        reasons.push(
          `Weight ${weightPct.toFixed(1)}% is within a trade's-worth of the ${targetWeightPct.toFixed(1)}% target — no action.`
        );
      } else if (deltaValue > 0) {
        action = "ADD";
        reasons.push(`Underweight: ${weightPct.toFixed(1)}% against a ${targetWeightPct.toFixed(1)}% conviction target.`);

        // Add suppressors — conviction may justify the weight while the price does not.
        if (blocks.length) {
          action = "HOLD";
          deltaValue = 0;
          reasons.push(`Add suppressed — ${blocks.map((b) => b.reason).join("; ")}.`);
        } else if (v.verdict === "OVERVALUED" || v.verdict === "STRETCHED") {
          action = "HOLD";
          deltaValue = 0;
          reasons.push(
            `Add suppressed — the weight is justified but the price is not. Revisit below $${v.buyBelow?.toFixed(2)}.`
          );
          guard = v.buyBelow ? `Buy limit $${v.buyBelow.toFixed(2)} — top of the fair band.` : null;
        } else if (regime?.regime === "Crisis") {
          action = "HOLD";
          deltaValue = 0;
          reasons.push("Add suppressed — Crisis regime, no new capital deployed.");
        } else if (regime?.regime === "Risk-Off" && p.sleeve === "Growth/Momentum") {
          action = "HOLD";
          deltaValue = 0;
          reasons.push("Add suppressed — Risk-Off regime permits adds only to income and defensive sleeves.");
        } else if (price && p.stop != null && p.stop > 0 && p.stop < price) {
          // Rule #4 — cap the add so the incremental trade risks ≤ 1.5% of NAV.
          const maxShares = Math.floor((nav * 0.015) / (price - p.stop));
          const maxValue = maxShares * price;
          if (maxValue < deltaValue) {
            reasons.push(
              `Add capped at ${maxShares} shares by the 1.5%-of-NAV trade risk limit (stop $${p.stop.toFixed(2)}, $${(price - p.stop).toFixed(2)}/share at risk).`
            );
            deltaValue = maxValue;
            guard = `Stop $${p.stop.toFixed(2)} must be live before adding (Rule #4).`;
          }
        }
        if (action === "ADD" && deltaValue < minTrade) {
          action = "HOLD";
          deltaValue = 0;
          reasons.push("Remaining add is below the minimum trade size — hold.");
        }
      } else {
        action = "TRIM";
        reasons.push(`Overweight: ${weightPct.toFixed(1)}% against a ${targetWeightPct.toFixed(1)}% conviction target.`);
      }
    }

    // Convert to whole shares, never selling more than is held.
    let deltaShares = 0;
    if (price && price > 0) {
      if (action === "EXIT") deltaShares = -p.shares;
      else if (deltaValue !== 0) {
        deltaShares = Math.trunc(deltaValue / price);
        if (deltaShares < 0) deltaShares = Math.max(deltaShares, -p.shares);
      }
      if (action !== "EXIT" && deltaShares === 0) {
        action = "HOLD";
        deltaValue = 0;
        reasons.push("Rounds to zero shares at the current price — hold.");
      } else {
        deltaValue = deltaShares * price;
      }
    } else {
      action = "HOLD";
      deltaValue = 0;
      deltaShares = 0;
      reasons.push("No live price — sizing cannot be computed.");
    }

    const headline =
      action === "EXIT" ? `Sell all ${p.shares} shares (≈$${Math.abs(deltaValue).toFixed(0)})`
      : action === "TRIM" ? `Trim ${Math.abs(deltaShares)} shares (≈$${Math.abs(deltaValue).toFixed(0)})`
      : action === "ADD" ? `Add ${deltaShares} shares (≈$${deltaValue.toFixed(0)})`
      : "Hold — no change";

    const priority =
      action === "EXIT" ? 0
      : zone.zone === "EMERGENCY" ? 1
      : action === "TRIM" ? 2
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
      momentumScore: p.score?.total ?? null,
      signal: p.score?.signal ?? null,
      zone,
      action,
      deltaShares,
      deltaValue: round2(deltaValue),
      headline,
      reasons,
      guard,
      priority,
    };
  });

  plans.sort((a, b) => a.priority - b.priority || Math.abs(b.deltaValue) - Math.abs(a.deltaValue));

  const sleeveBudget = [...held].map((sleeve) => ({
    sleeve,
    budgetPct: round2(budget.get(sleeve) ?? 0),
    heldPct: round2(
      positions.filter((p) => p.sleeve === sleeve).reduce((s, p) => s + valueOf(p), 0) / (nav || 1) * 100
    ),
  }));

  if (regime) {
    notes.push(`${regime.icon} ${regime.regime} regime (${regime.score}/100) — ${regime.deployRule}`);
  }
  notes.push(
    "Target weights split each sleeve budget by conviction: momentum score raises the target, a rich price lowers it, and Rule #3 caps any single name at 20% of NAV."
  );

  return { plans, sleeveBudget, notes };
}
