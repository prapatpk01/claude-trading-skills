// Portfolio value over time.
//
// The app stores positions, not a transaction ledger, so this values the
// CURRENT share counts back through history ("what this portfolio would have
// been worth"). That is a constant-holdings series, not a time-weighted
// return — the UI says so, because the distinction matters.

import { dailyCandles } from "./marketData";
import type { Candle } from "./types";

export interface PerfPoint {
  date: string;
  value: number;
  /** Benchmark rebased to the portfolio's starting value. */
  benchmark: number | null;
}

export interface PerformanceSeries {
  points: PerfPoint[];
  startValue: number;
  endValue: number;
  changePct: number;
  benchmarkChangePct: number | null;
  activeReturnPct: number | null;
  bestDay: { date: string; pct: number } | null;
  worstDay: { date: string; pct: number } | null;
  maxDrawdownPct: number | null;
  annualizedVolatilityPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  beta: number | null;
  alphaAnnualizedPct: number | null;
  positiveDayPct: number | null;
  missing: string[];
  note: string;
}

export interface PositionInput {
  ticker: string;
  shares: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const variance = (xs: number[], avg = mean(xs)) => xs.length > 1 ? xs.reduce((s, x) => s + (x - avg) ** 2, 0) / (xs.length - 1) : 0;
const covariance = (a: number[], b: number[], avgA = mean(a), avgB = mean(b)) => {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (a[i] - avgA) * (b[i] - avgB);
  return sum / (n - 1);
};

export async function buildPerformance(
  positions: PositionInput[],
  days = 365
): Promise<PerformanceSeries | null> {
  const valid = positions.filter((p) => p.shares > 0);
  if (!valid.length) return null;

  const missing: string[] = [];
  const seriesByTicker = new Map<string, Map<string, number>>();

  const fetched = await Promise.all(
    valid.map(async (p) => {
      try {
        const candles = await dailyCandles(p.ticker, days + 30);
        return { ticker: p.ticker, candles };
      } catch {
        return { ticker: p.ticker, candles: [] as Candle[] };
      }
    })
  );
  for (const f of fetched) {
    if (!f.candles.length) {
      missing.push(f.ticker);
      continue;
    }
    seriesByTicker.set(f.ticker, new Map(f.candles.map((c) => [c.date, c.close])));
  }
  if (seriesByTicker.size === 0) return null;

  const spy = await dailyCandles("SPY", days + 30).catch(() => [] as Candle[]);
  const spyByDate = new Map(spy.map((c) => [c.date, c.close]));

  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const allDates = new Set<string>();
  seriesByTicker.forEach((m) => m.forEach((_, d) => { if (d >= cutoff) allDates.add(d); }));
  const dates = Array.from(allDates).sort();
  if (dates.length < 2) return null;

  const lastKnown = new Map<string, number>();
  const points: PerfPoint[] = [];
  let spyStart: number | null = null;
  let startValue = 0;

  for (const date of dates) {
    let value = 0;
    let priced = false;
    for (const p of valid) {
      const m = seriesByTicker.get(p.ticker);
      if (!m) continue;
      const close = m.get(date) ?? lastKnown.get(p.ticker);
      if (close == null) continue;
      lastKnown.set(p.ticker, close);
      value += close * p.shares;
      priced = true;
    }
    if (!priced) continue;

    if (!startValue) startValue = value;
    const spyClose = spyByDate.get(date);
    if (spyClose != null && spyStart == null) spyStart = spyClose;
    const benchmark = spyClose != null && spyStart ? round2((spyClose / spyStart) * startValue) : null;
    points.push({ date, value: round2(value), benchmark });
  }
  if (points.length < 2) return null;

  const endValue = points[points.length - 1].value;
  const changePct = startValue ? ((endValue - startValue) / startValue) * 100 : 0;

  let best: { date: string; pct: number } | null = null;
  let worst: { date: string; pct: number } | null = null;
  let peak = points[0].value;
  let maxDd = 0;
  const portfolioReturns: number[] = [];
  const benchmarkReturns: number[] = [];
  let positiveDays = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    if (prev > 0) {
      const r = (cur - prev) / prev;
      const p = r * 100;
      portfolioReturns.push(r);
      if (r > 0) positiveDays++;
      if (!best || p > best.pct) best = { date: points[i].date, pct: round2(p) };
      if (!worst || p < worst.pct) worst = { date: points[i].date, pct: round2(p) };
    }
    const b0 = points[i - 1].benchmark;
    const b1 = points[i].benchmark;
    if (b0 != null && b1 != null && b0 > 0) benchmarkReturns.push((b1 - b0) / b0);
    if (cur > peak) peak = cur;
    if (peak > 0) maxDd = Math.min(maxDd, ((cur - peak) / peak) * 100);
  }

  const firstBench = points.find((p) => p.benchmark != null)?.benchmark ?? null;
  const lastBench = [...points].reverse().find((p) => p.benchmark != null)?.benchmark ?? null;
  const benchmarkChangePct = firstBench && lastBench ? round2(((lastBench - firstBench) / firstBench) * 100) : null;

  const avg = mean(portfolioReturns);
  const volDaily = Math.sqrt(variance(portfolioReturns, avg));
  const annualizedVolatilityPct = portfolioReturns.length > 1 ? round2(volDaily * Math.sqrt(252) * 100) : null;
  const sharpe = volDaily > 0 ? round2((avg / volDaily) * Math.sqrt(252)) : null;
  const downside = portfolioReturns.filter(r => r < 0);
  const downsideDev = downside.length ? Math.sqrt(mean(downside.map(r => r * r))) : 0;
  const sortino = downsideDev > 0 ? round2((avg / downsideDev) * Math.sqrt(252)) : null;
  const positiveDayPct = portfolioReturns.length ? round2((positiveDays / portfolioReturns.length) * 100) : null;

  const paired = Math.min(portfolioReturns.length, benchmarkReturns.length);
  let beta: number | null = null;
  let alphaAnnualizedPct: number | null = null;
  if (paired > 10) {
    const pr = portfolioReturns.slice(-paired);
    const br = benchmarkReturns.slice(-paired);
    const avgP = mean(pr), avgB = mean(br);
    const varB = variance(br, avgB);
    if (varB > 0) {
      beta = round2(covariance(pr, br, avgP, avgB) / varB);
      alphaAnnualizedPct = round2((avgP - beta * avgB) * 252 * 100);
    }
  }

  return {
    points,
    startValue: round2(startValue),
    endValue,
    changePct: round2(changePct),
    benchmarkChangePct,
    activeReturnPct: benchmarkChangePct != null ? round2(changePct - benchmarkChangePct) : null,
    bestDay: best,
    worstDay: worst,
    maxDrawdownPct: round2(maxDd),
    annualizedVolatilityPct,
    sharpe,
    sortino,
    beta,
    alphaAnnualizedPct,
    positiveDayPct,
    missing,
    note:
      "Current share counts valued back through time (the app stores positions, not a transaction ledger), so this is a constant-holdings series rather than a time-weighted return. Sharpe, Sortino, beta and alpha are diagnostic estimates from this same series and are not audited fund-performance statistics.",
  };
}
