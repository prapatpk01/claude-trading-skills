// Metrics computed from price history alone — these always work, even when
// every fundamentals provider is unavailable.

import type { Candle } from "./types";

/** 52-week high/low from daily candles. */
export function week52Range(candles: Candle[]): { high: number | null; low: number | null } {
  if (!candles.length) return { high: null, low: null };
  const window = candles.slice(-252);
  let high = -Infinity;
  let low = Infinity;
  for (const c of window) {
    if (c.high > high) high = c.high;
    if (c.low < low && c.low > 0) low = c.low;
  }
  return {
    high: Number.isFinite(high) ? Math.round(high * 100) / 100 : null,
    low: Number.isFinite(low) ? Math.round(low * 100) / 100 : null,
  };
}

/**
 * Beta vs benchmark: slope of the regression of the stock's daily returns on
 * the benchmark's — cov(stock, bench) / var(bench) over the overlapping dates.
 */
export function computeBeta(candles: Candle[], benchmark: Candle[]): number | null {
  if (candles.length < 60 || benchmark.length < 60) return null;

  const benchByDate = new Map(benchmark.map((c) => [c.date, c.close]));
  const pairs: [number, number][] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1];
    const cur = candles[i];
    const bPrev = benchByDate.get(prev.date);
    const bCur = benchByDate.get(cur.date);
    if (bPrev == null || bCur == null || prev.close <= 0 || bPrev <= 0) continue;
    pairs.push([(cur.close - prev.close) / prev.close, (bCur - bPrev) / bPrev]);
  }
  if (pairs.length < 40) return null;

  const n = pairs.length;
  const meanS = pairs.reduce((s, p) => s + p[0], 0) / n;
  const meanB = pairs.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0;
  let varB = 0;
  for (const [s, b] of pairs) {
    cov += (s - meanS) * (b - meanB);
    varB += (b - meanB) ** 2;
  }
  if (varB === 0) return null;
  return Math.round((cov / varB) * 100) / 100;
}
