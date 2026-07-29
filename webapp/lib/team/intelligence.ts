// Sentinel Global Fund — analytical layers that sit above the single-desk
// outputs: multi-timeframe confirmation, earnings quality, cross-desk
// conflict detection and a conviction score.
//
// The point of these is to catch the cases a single desk misses — a daily
// breakout against a broken weekly trend, reported profit that isn't turning
// into cash, or a momentum desk and a valuation desk pointing opposite ways.

import type { Candle, Financials } from "../types";
import { ema, sma, rsi, atr } from "../indicators";

// ── Multi-timeframe confirmation ──────────────────────────────────────

export interface TimeframeRead {
  timeframe: "Daily" | "Weekly";
  trend: "Up" | "Down" | "Sideways";
  priceVsMa: string;
  rsi: number | null;
  detail: string;
}

export interface MtfResult {
  reads: TimeframeRead[];
  aligned: boolean;
  verdict: string;
}

/** Compress daily candles into weekly bars (Mon–Fri buckets). */
export function toWeekly(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let bucket: Candle[] = [];
  let currentWeek = "";
  const weekKey = (d: string) => {
    const dt = new Date(d + "T00:00:00Z");
    const day = dt.getUTCDay();
    // roll back to Monday so a week is one bucket
    const monday = new Date(dt.getTime() - ((day + 6) % 7) * 86400000);
    return monday.toISOString().slice(0, 10);
  };
  const flush = () => {
    if (!bucket.length) return;
    out.push({
      date: bucket[bucket.length - 1].date,
      open: bucket[0].open,
      high: Math.max(...bucket.map((c) => c.high)),
      low: Math.min(...bucket.map((c) => c.low)),
      close: bucket[bucket.length - 1].close,
      volume: bucket.reduce((s, c) => s + c.volume, 0),
    });
    bucket = [];
  };
  for (const c of candles) {
    const wk = weekKey(c.date);
    if (wk !== currentWeek) {
      flush();
      currentWeek = wk;
    }
    bucket.push(c);
  }
  flush();
  return out;
}

function readTimeframe(candles: Candle[], label: "Daily" | "Weekly", fast: number, slow: number): TimeframeRead | null {
  if (candles.length < slow + 5) return null;
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1];
  const f = ema(closes, fast);
  const s = sma(closes, slow);
  const r = rsi(closes, 14);
  if (f == null || s == null) return null;
  const above = price > f && f > s;
  const below = price < f && f < s;
  const trend: TimeframeRead["trend"] = above ? "Up" : below ? "Down" : "Sideways";
  return {
    timeframe: label,
    trend,
    priceVsMa: `price ${price > s ? "above" : "below"} the ${slow}-period average`,
    rsi: r != null ? Math.round(r * 10) / 10 : null,
    detail: `${label}: ${trend.toLowerCase()} — ${fast}-EMA ${f > s ? "above" : "below"} ${slow}-SMA, RSI ${r?.toFixed(1) ?? "n/a"}`,
  };
}

/**
 * A daily signal that fights the weekly trend is the classic false breakout.
 * Both timeframes are reported so the disagreement is visible.
 */
export function multiTimeframe(daily: Candle[]): MtfResult {
  const reads: TimeframeRead[] = [];
  const d = readTimeframe(daily, "Daily", 20, 50);
  const w = readTimeframe(toWeekly(daily), "Weekly", 10, 30);
  if (d) reads.push(d);
  if (w) reads.push(w);

  if (reads.length < 2) {
    return { reads, aligned: false, verdict: "Not enough history to confirm across timeframes." };
  }
  const aligned = d!.trend === w!.trend;
  const verdict = aligned
    ? `Both timeframes agree (${d!.trend.toLowerCase()}) — the daily read is backed by the weekly structure.`
    : `Timeframes disagree: daily is ${d!.trend.toLowerCase()} while weekly is ${w!.trend.toLowerCase()}. A daily signal against the weekly trend is the classic failed breakout — size down or wait for the weekly to confirm.`;
  return { reads, aligned, verdict };
}

// ── Earnings quality ──────────────────────────────────────────────────

export interface QualityFlag {
  label: string;
  value: string;
  verdict: "good" | "watch" | "poor" | "unknown";
  note: string;
}

/**
 * Reported profit is an opinion; cash is a fact. These checks look for the
 * gap between the two, plus the direction of margins.
 */
export function earningsQuality(fin: Financials): { flags: QualityFlag[]; score: number | null; summary: string } {
  const inc = fin.income;
  const cf = fin.cashflow;
  const bal = fin.balance;
  const flags: QualityFlag[] = [];
  const n = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

  if (!inc.length || !cf.length) {
    return {
      flags: [{ label: "Earnings quality", value: "n/a", verdict: "unknown", note: "Statements unavailable from the filing feed [U]" }],
      score: null,
      summary: "Earnings quality cannot be graded without statements.",
    };
  }

  // 1) Cash conversion — operating cash flow against reported net income
  const ni = n(inc[0].netIncome);
  const ocf = n(cf[0].operatingCashflow);
  if (ni > 0 && ocf !== 0) {
    const conv = ocf / ni;
    flags.push({
      label: "Cash conversion (OCF / net income)",
      value: `${conv.toFixed(2)}×`,
      verdict: conv >= 1.1 ? "good" : conv >= 0.8 ? "watch" : "poor",
      note:
        conv >= 1.1
          ? "Profit is converting to cash at better than face value."
          : conv >= 0.8
          ? "Conversion is adequate but not comfortable."
          : "Reported profit is not turning into cash — check receivables and accruals.",
    });
  }

  // 2) Free cash flow margin
  const rev = n(inc[0].totalRevenue);
  const capex = Math.abs(n(cf[0].capitalExpenditures));
  if (rev > 0) {
    const fcfM = ((ocf - capex) / rev) * 100;
    flags.push({
      label: "Free cash flow margin",
      value: `${fcfM.toFixed(1)}%`,
      verdict: fcfM >= 15 ? "good" : fcfM >= 5 ? "watch" : "poor",
      note: fcfM >= 15 ? "Strong self-funding." : fcfM >= 5 ? "Modest cash generation." : "Little or no free cash after capital spending.",
    });
  }

  // 3) Accruals — the share of assets made up by non-cash earnings
  const assets = n(bal[0]?.totalAssets);
  if (assets > 0 && ni !== 0) {
    const accrual = ((ni - ocf) / assets) * 100;
    flags.push({
      label: "Accrual ratio",
      value: `${accrual.toFixed(1)}%`,
      verdict: accrual <= 5 ? "good" : accrual <= 10 ? "watch" : "poor",
      note:
        accrual <= 5
          ? "Earnings are cash-backed."
          : "A high accrual ratio has historically preceded weaker forward returns — earnings lean on non-cash items.",
    });
  }

  // 4) Margin trend across the reported years
  if (inc.length >= 3) {
    const m = inc.slice(0, 3).map((r) => {
      const rv = n(r.totalRevenue);
      return rv > 0 ? (n(r.operatingIncome) / rv) * 100 : 0;
    });
    const improving = m[0] > m[1] && m[1] > m[2];
    const deteriorating = m[0] < m[1] && m[1] < m[2];
    flags.push({
      label: "Operating margin trend (3y)",
      value: m.map((x) => `${x.toFixed(1)}%`).join(" ← "),
      verdict: improving ? "good" : deteriorating ? "poor" : "watch",
      note: improving ? "Margins expanding year over year." : deteriorating ? "Margins compressing for two consecutive years." : "Margins are mixed.",
    });
  }

  // 5) Balance-sheet leverage
  const equity = n(bal[0]?.totalShareholderEquity);
  const debt = n(bal[0]?.longTermDebt) + n(bal[0]?.shortTermDebt);
  if (equity > 0) {
    const de = debt / equity;
    flags.push({
      label: "Debt / equity",
      value: de.toFixed(2),
      verdict: de <= 1 ? "good" : de <= 2 ? "watch" : "poor",
      note: de <= 1 ? "Conservatively financed." : de <= 2 ? "Leverage is meaningful." : "Highly levered — earnings are sensitive to rates and downturns.",
    });
  }

  const graded = flags.filter((f) => f.verdict !== "unknown");
  const score = graded.length
    ? Math.round(
        (graded.reduce((s, f) => s + (f.verdict === "good" ? 1 : f.verdict === "watch" ? 0.5 : 0), 0) / graded.length) * 100
      )
    : null;

  const poor = graded.filter((f) => f.verdict === "poor").length;
  return {
    flags,
    score,
    summary:
      score == null
        ? "Not gradable."
        : poor === 0
        ? `Earnings quality ${score}/100 — no red flags in the cash, accrual or leverage checks.`
        : `Earnings quality ${score}/100 with ${poor} red flag${poor > 1 ? "s" : ""} — treat the reported numbers with care.`,
  };
}

// ── Cross-desk conflict detection ─────────────────────────────────────

export interface Conflict {
  between: string;
  issue: string;
  implication: string;
}

export interface ConvictionResult {
  score: number;
  label: "High" | "Moderate" | "Low" | "Conflicted";
  agreements: string[];
  conflicts: Conflict[];
  note: string;
}

export interface ConvictionInput {
  momentumScore: number;
  hasHardBlock: boolean;
  sampDirection: number | null;
  sampAcceleration: number | null;
  mtfAligned: boolean | null;
  qualityScore: number | null;
  valuationUpsidePct: number | null;
  regimeScore: number;
  gatesCleared: boolean;
}

/**
 * Combine the desks into one conviction read, and — more usefully — name the
 * places where they disagree. A high score built on desks pointing opposite
 * ways is a worse trade than a moderate score everyone agrees on.
 */
export function buildConviction(i: ConvictionInput): ConvictionResult {
  const agreements: string[] = [];
  const conflicts: Conflict[] = [];

  const momentumBull = i.momentumScore >= 58;
  const sampBull = (i.sampDirection ?? 0) > 8;
  const sampBear = (i.sampDirection ?? 0) < -8;
  const valueCheap = (i.valuationUpsidePct ?? 0) >= 15;
  const valueRich = (i.valuationUpsidePct ?? 0) <= -10;
  const qualityGood = (i.qualityScore ?? 0) >= 60;

  // agreements
  if (momentumBull && sampBull) agreements.push("Momentum scoring and the SAMP pressure engine both read bullish.");
  if (momentumBull && i.mtfAligned) agreements.push("The daily signal is confirmed by the weekly trend.");
  if (valueCheap && qualityGood) agreements.push("Valuation offers upside on a business that passes the quality checks.");
  if (i.regimeScore >= 60 && momentumBull) agreements.push("A constructive regime supports carrying momentum risk.");

  // conflicts
  if (momentumBull && sampBear) {
    conflicts.push({
      between: "Maya Chen (momentum) vs Priya Nair (SAMP)",
      issue: `Momentum scores ${i.momentumScore}/100 while SAMP direction is ${i.sampDirection}.`,
      implication: "The composite score is being carried by components the pressure engine does not confirm — treat as a watch, not an entry.",
    });
  }
  if (momentumBull && i.mtfAligned === false) {
    conflicts.push({
      between: "Daily vs weekly structure",
      issue: "The daily trend is not backed by the weekly.",
      implication: "Classic failed-breakout setup. Size down or wait for the weekly to turn.",
    });
  }
  if (momentumBull && valueRich) {
    conflicts.push({
      between: "Maya Chen (momentum) vs Thomas Eriksson (valuation)",
      issue: `Momentum is constructive but the blended target sits ${Math.abs(i.valuationUpsidePct ?? 0).toFixed(0)}% below spot.`,
      implication: "A momentum trade with no valuation support — keep it in the trading sleeve with a tight stop, not the core.",
    });
  }
  if (valueCheap && !qualityGood && i.qualityScore != null) {
    conflicts.push({
      between: "Thomas Eriksson (valuation) vs Sofia Reyes (quality)",
      issue: `Upside looks attractive but earnings quality scores ${i.qualityScore}/100.`,
      implication: "Cheap for a reason — verify the cash conversion before treating the discount as opportunity.",
    });
  }
  if (i.regimeScore < 40 && momentumBull) {
    conflicts.push({
      between: "Daniel Cho (macro) vs the momentum desks",
      issue: `Regime scores ${i.regimeScore}/100 while the name screens bullish.`,
      implication: "Single-name strength in a risk-off tape — deploy at most a third and hold the cash floor.",
    });
  }

  // score
  let score = 0;
  score += Math.min(35, (i.momentumScore / 100) * 35);
  if (i.sampDirection != null) score += Math.max(0, Math.min(20, ((i.sampDirection + 50) / 100) * 20));
  if (i.mtfAligned) score += 12;
  if (i.qualityScore != null) score += (i.qualityScore / 100) * 15;
  if (i.valuationUpsidePct != null) score += Math.max(0, Math.min(10, (i.valuationUpsidePct / 30) * 10));
  score += (i.regimeScore / 100) * 8;
  if (i.gatesCleared) score += 5;
  if (i.hasHardBlock) score *= 0.4;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const label: ConvictionResult["label"] =
    conflicts.length >= 2 ? "Conflicted" : score >= 70 ? "High" : score >= 45 ? "Moderate" : "Low";

  return {
    score,
    label,
    agreements,
    conflicts,
    note:
      label === "Conflicted"
        ? "Desks disagree in more than one place. The disagreement matters more than the score — resolve it before committing capital."
        : label === "High"
        ? "The desks broadly agree and the gates are clear."
        : label === "Moderate"
        ? "A workable case, but not one to size aggressively."
        : "The evidence does not support a position here.",
  };
}
