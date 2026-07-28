import type { Candle } from "./types";

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  // seed with SMA of first `period` values
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number; signal: number; hist: number } | null {
  if (values.length < slow + signal) return null;
  // Build full MACD line series to derive the signal line
  const emaFast = emaSeries(values, fast);
  const emaSlow = emaSeries(values, slow);
  // align tails
  const n = Math.min(emaFast.length, emaSlow.length);
  const fastTail = emaFast.slice(emaFast.length - n);
  const slowTail = emaSlow.slice(emaSlow.length - n);
  const macdLine = fastTail.map((f, i) => f - slowTail[i]);
  const signalSeries = emaSeries(macdLine, signal);
  if (signalSeries.length === 0) return null;
  const macdVal = macdLine[macdLine.length - 1];
  const signalVal = signalSeries[signalSeries.length - 1];
  return { macd: macdVal, signal: signalVal, hist: macdVal - signalVal };
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  return sma(trs, period);
}

export function pctReturn(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const now = candles[candles.length - 1].close;
  const then = candles[candles.length - 1 - lookback].close;
  if (!then) return null;
  return ((now - then) / then) * 100;
}

/** Relative strength ratio vs benchmark over `lookback` days (1.0 = inline). */
export function relativeStrength(
  candles: Candle[],
  benchmark: Candle[],
  lookback: number
): number | null {
  const r = pctReturn(candles, lookback);
  const b = pctReturn(benchmark, lookback);
  if (r === null || b === null) return null;
  return (1 + r / 100) / (1 + b / 100);
}

/** Up/down volume ratio: sum of volume on up days / down days over lookback. */
export function upDownVolumeRatio(candles: Candle[], lookback: number): number | null {
  if (candles.length < lookback + 1) return null;
  const slice = candles.slice(-lookback);
  let up = 0;
  let down = 0;
  for (let i = 1; i < slice.length; i++) {
    if (slice[i].close >= slice[i - 1].close) up += slice[i].volume;
    else down += slice[i].volume;
  }
  if (down === 0) return up > 0 ? 99 : null;
  return up / down;
}

export function avgVolume(candles: Candle[], period: number): number | null {
  if (candles.length < period) return null;
  return sma(candles.slice(-period).map((c) => c.volume), period);
}
