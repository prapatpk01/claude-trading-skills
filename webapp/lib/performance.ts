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
  bestDay: { date: string; pct: number } | null;
  worstDay: { date: string; pct: number } | null;
  maxDrawdownPct: number | null;
  missing: string[];
  note: string;
}

export interface PositionInput {
  ticker: string;
  shares: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export async function buildPerformance(
  positions: PositionInput[],
  days = 365
): Promise<PerformanceSeries | null> {
  const valid = positions.filter((p) => p.shares > 0);
  if (!valid.length) return null;

  const missing: string[] = [];
  const seriesByTicker = new Map<string, Map<string, number>>();

  // fetch sequentially-ish with small concurrency to stay polite
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

  // Use the union of trading days, restricted to the requested window, and
  // carry each position's last known close forward so a single missing bar
  // doesn't punch a hole in the portfolio line.
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
    const benchmark =
      spyClose != null && spyStart ? round2((spyClose / spyStart) * startValue) : null;

    points.push({ date, value: round2(value), benchmark });
  }
  if (points.length < 2) return null;

  const endValue = points[points.length - 1].value;
  const changePct = startValue ? ((endValue - startValue) / startValue) * 100 : 0;

  // daily extremes and peak-to-trough drawdown
  let best: { date: string; pct: number } | null = null;
  let worst: { date: string; pct: number } | null = null;
  let peak = points[0].value;
  let maxDd = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const cur = points[i].value;
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100;
      if (!best || pct > best.pct) best = { date: points[i].date, pct: round2(pct) };
      if (!worst || pct < worst.pct) worst = { date: points[i].date, pct: round2(pct) };
    }
    if (cur > peak) peak = cur;
    if (peak > 0) maxDd = Math.min(maxDd, ((cur - peak) / peak) * 100);
  }

  const firstBench = points.find((p) => p.benchmark != null)?.benchmark ?? null;
  const lastBench = [...points].reverse().find((p) => p.benchmark != null)?.benchmark ?? null;
  const benchmarkChangePct =
    firstBench && lastBench ? round2(((lastBench - firstBench) / firstBench) * 100) : null;

  return {
    points,
    startValue: round2(startValue),
    endValue,
    changePct: round2(changePct),
    benchmarkChangePct,
    bestDay: best,
    worstDay: worst,
    maxDrawdownPct: round2(maxDd),
    missing,
    note:
      "Current share counts valued back through time (the app stores positions, not a transaction ledger), so this is a constant-holdings series rather than a time-weighted return.",
  };
}
