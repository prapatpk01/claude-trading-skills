import type {
  MarketData,
  TechnicalSignals,
  MomentumScore,
  DcfResult,
  SwingSetup,
} from "./types";
import {
  sma,
  ema,
  rsi,
  macd,
  atr,
  pctReturn,
  relativeStrength,
  upDownVolumeRatio,
  avgVolume,
} from "./indicators";

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function computeTechnicals(data: MarketData): TechnicalSignals {
  const c = data.candles;
  const closes = c.map((x) => x.close);
  const m = macd(closes);
  const ema10 = ema(closes, 10);
  const ema20 = ema(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const price = data.quote?.price ?? closes[closes.length - 1] ?? null;
  const vol5 = avgVolume(c, 5);
  const vol20 = avgVolume(c, 20);

  return {
    rsi14: rsi(closes, 14),
    macd: m?.macd ?? null,
    macdSignal: m?.signal ?? null,
    macdHist: m?.hist ?? null,
    ema10,
    ema20,
    sma50,
    sma200,
    atr14: atr(c, 14),
    rs30: relativeStrength(c, data.benchmarkCandles, 21),
    vol5,
    vol20,
    volRatio: vol5 && vol20 ? vol5 / vol20 : null,
    upDownVolRatio: upDownVolumeRatio(c, 10),
    return1m: pctReturn(c, 21),
    return3m: pctReturn(c, 63),
    return6m: pctReturn(c, 126),
    aboveEma10: price != null && ema10 != null ? price > ema10 : false,
    aboveEma20: price != null && ema20 != null ? price > ema20 : false,
    maFanning: ema10 != null && ema20 != null && sma50 != null ? ema10 > ema20 && ema20 > sma50 : false,
  };
}

/**
 * Momentum-Centric Alpha Score (100 pts):
 *  Momentum & Relative Strength 40 | Volume Accumulation 25
 *  Structural Base & Trend 20 | Catalyst Drift 15
 */
export function computeMomentumScore(t: TechnicalSignals, hasCatalyst = false): MomentumScore {
  const breakdown: string[] = [];

  // ── Momentum & RS (40) ──
  let mom = 0;
  if (t.rs30 != null) {
    // RS 1.10 (10% outperformance) → full; 1.00 → half; <0.95 → 0
    const rsPts = clamp(((t.rs30 - 0.95) / 0.15) * 18, 0, 18);
    mom += rsPts;
    breakdown.push(`RS vs SPY (21d): ${t.rs30.toFixed(3)} → ${rsPts.toFixed(1)}/18`);
  }
  if (t.rsi14 != null) {
    // "Power Zone" 60-75 ideal
    let rsiPts = 0;
    if (t.rsi14 >= 60 && t.rsi14 <= 75) rsiPts = 12;
    else if (t.rsi14 > 55 && t.rsi14 < 60) rsiPts = 8;
    else if (t.rsi14 > 75 && t.rsi14 <= 80) rsiPts = 7; // slightly hot
    else if (t.rsi14 >= 50) rsiPts = 5;
    else rsiPts = 2;
    mom += rsiPts;
    breakdown.push(`RSI(14): ${t.rsi14.toFixed(1)} → ${rsiPts}/12`);
  }
  if (t.macd != null && t.macdHist != null) {
    let macdPts = 0;
    if (t.macd > 0 && t.macdHist > 0) macdPts = 10;
    else if (t.macd > 0) macdPts = 6;
    else if (t.macdHist > 0) macdPts = 4;
    mom += macdPts;
    breakdown.push(`MACD ${t.macd.toFixed(2)} / hist ${t.macdHist.toFixed(2)} → ${macdPts}/10`);
  }

  // ── Volume Accumulation (25) ──
  let vol = 0;
  if (t.volRatio != null) {
    // >1.5x → full 15
    const vPts = clamp(((t.volRatio - 0.9) / 0.6) * 15, 0, 15);
    vol += vPts;
    breakdown.push(`Vol 5d/20d: ${t.volRatio.toFixed(2)}x → ${vPts.toFixed(1)}/15`);
  }
  if (t.upDownVolRatio != null) {
    const uPts = clamp(((t.upDownVolRatio - 1.0) / 0.5) * 10, 0, 10);
    vol += uPts;
    breakdown.push(`Up/Down vol: ${t.upDownVolRatio.toFixed(2)} → ${uPts.toFixed(1)}/10`);
  }

  // ── Structure & Trend (20) ──
  let struct = 0;
  if (t.aboveEma10) { struct += 6; breakdown.push("Price > 10 EMA → 6/6"); }
  if (t.aboveEma20) { struct += 6; breakdown.push("Price > 20 EMA → 6/6"); }
  if (t.maFanning) { struct += 8; breakdown.push("MAs fanning up (10>20>50) → 8/8"); }

  // ── Catalyst Drift (15) ──
  let cat = hasCatalyst ? 12 : 6;
  if (t.return1m != null && t.return1m > 8) cat = Math.min(15, cat + 3);
  breakdown.push(`Catalyst drift → ${cat}/15${hasCatalyst ? " (flagged)" : " (baseline)"}`);

  const total = clamp(mom + vol + struct + cat);
  return {
    total: Math.round(total),
    momentumRS: Math.round(mom * 10) / 10,
    volume: Math.round(vol * 10) / 10,
    structure: struct,
    catalyst: cat,
    breakdown,
  };
}

/** Build a 7-15 day swing setup from technicals + score. */
export function buildSwingSetup(
  data: MarketData,
  t: TechnicalSignals,
  score: MomentumScore,
  catalystNote: string
): SwingSetup | null {
  const price = data.quote?.price ?? data.candles[data.candles.length - 1]?.close;
  if (!price) return null;
  const atrVal = t.atr14 ?? price * 0.03;

  // Entry: tight to 10 EMA, capped 3% above breakout pivot (use price)
  const entryLow = t.ema10 ? Math.min(price, t.ema10) : price * 0.985;
  const entryHigh = Math.max(price * 1.005, (t.ema10 ?? price) * 1.02);

  // Stop: below 20 EMA or ~2 ATR under entry, whichever is tighter but valid
  const stop = Math.min(t.ema20 ? t.ema20 - 0.5 * atrVal : entryLow - 2 * atrVal, entryLow - 1.2 * atrVal);

  // Target: measured move / Fib 1.618 → aim 10-25% based on score strength
  const upsidePct = 10 + (score.total / 100) * 15; // 10%..25%
  const target = price * (1 + upsidePct / 100);

  const risk = entryHigh - stop;
  const reward = target - entryHigh;
  const rr = risk > 0 ? reward / risk : 0;

  const setupType = t.maFanning
    ? "Trend Continuation / Flag"
    : t.aboveEma20
    ? "Base Breakout"
    : "Reclaim Attempt";

  return {
    ticker: data.ticker,
    name: data.overview?.name ?? data.ticker,
    setupType,
    momentumScore: score.total,
    expectedReturnPct: Math.round(upsidePct * 10) / 10,
    winProbability: Math.round(clamp(45 + score.total * 0.35)),
    entryLow: round2(entryLow),
    entryHigh: round2(entryHigh),
    target: round2(target),
    stop: round2(stop),
    riskReward: Math.round(rr * 10) / 10,
    momentumNote: `RS ${t.rs30?.toFixed(3) ?? "n/a"} vs SPY · RSI ${t.rsi14?.toFixed(0) ?? "n/a"} · MACD hist ${t.macdHist?.toFixed(2) ?? "n/a"} · ${t.maFanning ? "MAs fanning up" : "MAs mixed"}`,
    volumeNote: `5d/20d vol ${t.volRatio?.toFixed(2) ?? "n/a"}x · Up/Down ${t.upDownVolRatio?.toFixed(2) ?? "n/a"} · ${(t.volRatio ?? 0) > 1.5 ? "sustained accumulation" : "watch for confirmation"}`,
    catalystNote,
    thesis: `${setupType} on ${data.ticker}. Enter ${round2(entryLow)}–${round2(entryHigh)} tight to the 10-EMA; invalidation below ${round2(stop)} (under 20-EMA). Score ${score.total}/100 with ${score.momentumRS}/40 momentum. Target ${round2(target)} (+${Math.round(upsidePct)}%) on a measured move over 7–15 sessions. Trim into strength; trail stop to breakeven after +5%.`,
    price: round2(price),
  };
}

// ── DCF ───────────────────────────────────────────────────────────────

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

export interface DcfAssumptions {
  revenueGrowth: number[]; // 5 yrs, e.g. [0.15,0.13,...]
  fcfMargin: number; // FCF as % of revenue
  wacc: number;
  terminalGrowth: number;
}

/** Default assumptions inferred from fundamentals with sane fallbacks. */
export function defaultAssumptions(data: MarketData): DcfAssumptions {
  const ov = data.overview;
  const beta = ov?.beta ?? 1.1;
  // CAPM-ish WACC: rf 4.3% + beta * ERP 5.0%, floored/capped
  const wacc = clamp((0.043 + beta * 0.05) * 100, 7, 15) / 100;
  // Revenue growth taper from recent history
  const inc = data.financials.income;
  let hist = 0.1;
  if (inc.length >= 2) {
    const r0 = Number(inc[0].totalRevenue) || 0;
    const r1 = Number(inc[1].totalRevenue) || 0;
    if (r1 > 0) hist = clamp(((r0 - r1) / r1) * 100, -10, 40) / 100;
  }
  const g0 = clamp(hist * 100, 3, 30) / 100;
  const revenueGrowth = [g0, g0 * 0.85, g0 * 0.72, g0 * 0.6, g0 * 0.5].map((g) =>
    Math.max(g, 0.03)
  );
  // FCF margin from history
  const cf = data.financials.cashflow[0];
  const rev0 = Number(inc[0]?.totalRevenue) || 0;
  let fcfMargin = 0.12;
  if (cf && rev0 > 0) {
    const ocf = Number(cf.operatingCashflow) || 0;
    const capex = Math.abs(Number(cf.capitalExpenditures) || 0);
    fcfMargin = clamp(((ocf - capex) / rev0) * 100, 3, 40) / 100;
  }
  return { revenueGrowth, fcfMargin, wacc, terminalGrowth: 0.025 };
}

export function computeDcf(data: MarketData, a: DcfAssumptions): DcfResult | null {
  const inc = data.financials.income;
  const baseRevenue = Number(inc[0]?.totalRevenue) || 0;
  const price = data.quote?.price ?? 0;
  const shares =
    data.overview?.sharesOutstanding ||
    (data.overview?.marketCap && price ? data.overview.marketCap / price : 0);
  if (!baseRevenue || !shares) return null;

  const projectedFcf: number[] = [];
  const pvFcf: number[] = [];
  let rev = baseRevenue;
  for (let y = 0; y < 5; y++) {
    rev = rev * (1 + a.revenueGrowth[y]);
    const fcf = rev * a.fcfMargin;
    projectedFcf.push(fcf);
    pvFcf.push(fcf / Math.pow(1 + a.wacc, y + 1));
  }
  const terminalFcf = projectedFcf[4] * (1 + a.terminalGrowth);
  const terminalValue = terminalFcf / (a.wacc - a.terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + a.wacc, 5);
  const enterpriseValue = pvFcf.reduce((s, x) => s + x, 0) + pvTerminal;

  // net debt from balance sheet
  const bal = data.financials.balance[0];
  const cash = Number(bal?.cashAndEquivalents) || 0;
  const debt = (Number(bal?.longTermDebt) || 0) + (Number(bal?.shortTermDebt) || 0);
  const equityValue = enterpriseValue - debt + cash;
  const fairValue = equityValue / shares;

  return {
    wacc: a.wacc,
    terminalGrowth: a.terminalGrowth,
    fairValue: round2(fairValue),
    upsidePct: price ? round2(((fairValue - price) / price) * 100) : 0,
    projectedFcf,
    pvFcf,
    terminalValue,
    pvTerminal,
    enterpriseValue,
    equityValue,
  };
}

// ── Simple Buy/Hold/Sell signal ───────────────────────────────────────

export function signalFrom(t: TechnicalSignals, dcfUpside: number | null): {
  signal: "BUY" | "HOLD" | "SELL";
  reasons: string[];
} {
  let score = 0;
  const reasons: string[] = [];
  if (t.aboveEma20) { score += 1; reasons.push("Above 20-EMA (uptrend)"); } else { score -= 1; reasons.push("Below 20-EMA"); }
  if (t.maFanning) { score += 1; reasons.push("MAs fanning up"); }
  if (t.rsi14 != null) {
    if (t.rsi14 > 70) { score -= 0.5; reasons.push(`RSI ${t.rsi14.toFixed(0)} extended`); }
    else if (t.rsi14 >= 50) { score += 0.5; reasons.push(`RSI ${t.rsi14.toFixed(0)} constructive`); }
    else { score -= 0.5; reasons.push(`RSI ${t.rsi14.toFixed(0)} weak`); }
  }
  if (t.macdHist != null && t.macdHist > 0) { score += 0.5; reasons.push("MACD histogram positive"); }
  if (dcfUpside != null) {
    if (dcfUpside > 15) { score += 1; reasons.push(`DCF upside +${dcfUpside.toFixed(0)}%`); }
    else if (dcfUpside < -15) { score -= 1; reasons.push(`DCF downside ${dcfUpside.toFixed(0)}%`); }
  }
  const signal = score >= 1.5 ? "BUY" : score <= -1 ? "SELL" : "HOLD";
  return { signal, reasons };
}
