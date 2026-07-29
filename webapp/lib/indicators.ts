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

// ── Indicators required by the Sentinel momentum scoring model ────────

/** Average Directional Index — Wilder-smoothed trend strength. */
export function adx(candles: Candle[], period = 14): number | null {
  if (candles.length < period * 2 + 1) return null;
  const trs: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    const up = c.high - p.high;
    const down = p.low - c.low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  // Wilder smoothing
  const smooth = (arr: number[]): number[] => {
    const out: number[] = [];
    let acc = arr.slice(0, period).reduce((a, b) => a + b, 0);
    out.push(acc);
    for (let i = period; i < arr.length; i++) {
      acc = acc - acc / period + arr[i];
      out.push(acc);
    }
    return out;
  };
  const trS = smooth(trs);
  const pS = smooth(plusDM);
  const mS = smooth(minusDM);

  const dx: number[] = [];
  for (let i = 0; i < trS.length; i++) {
    if (trS[i] === 0) continue;
    const pdi = (pS[i] / trS[i]) * 100;
    const mdi = (mS[i] / trS[i]) * 100;
    const sum = pdi + mdi;
    if (sum === 0) continue;
    dx.push((Math.abs(pdi - mdi) / sum) * 100);
  }
  if (dx.length < period) return null;
  // ADX = Wilder average of DX
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period;
  return adxVal;
}

/** On-Balance Volume, plus the slope of its recent trend. */
export function obv(candles: Candle[]): { value: number; rising: boolean; slopePct: number } | null {
  if (candles.length < 25) return null;
  let acc = 0;
  const series: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const p = candles[i - 1];
    if (c.close > p.close) acc += c.volume;
    else if (c.close < p.close) acc -= c.volume;
    series.push(acc);
  }
  const recent = series.slice(-20);
  const first = recent[0];
  const lastVal = recent[recent.length - 1];
  const scale = Math.max(Math.abs(first), 1);
  const slopePct = ((lastVal - first) / scale) * 100;
  return { value: lastVal, rising: lastVal > first, slopePct };
}

/** Money Flow Index — volume-weighted RSI. */
export function mfi(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const slice = candles.slice(-(period + 1));
  let pos = 0;
  let neg = 0;
  for (let i = 1; i < slice.length; i++) {
    const tp = (slice[i].high + slice[i].low + slice[i].close) / 3;
    const prevTp = (slice[i - 1].high + slice[i - 1].low + slice[i - 1].close) / 3;
    const flow = tp * slice[i].volume;
    if (tp > prevTp) pos += flow;
    else if (tp < prevTp) neg += flow;
  }
  if (pos + neg === 0) return 50;
  if (neg === 0) return 100;
  return 100 - 100 / (1 + pos / neg);
}

export interface Bollinger {
  mid: number;
  upper: number;
  lower: number;
  /** 0 = lower band, 0.5 = mid, 1 = upper band. */
  position: number;
  bandwidth: number;
  /** True when bandwidth is in the lowest quintile of the last 60 bars. */
  squeeze: boolean;
}

export function bollinger(candles: Candle[], period = 20, mult = 2): Bollinger | null {
  if (candles.length < period) return null;
  const closes = candles.map((c) => c.close);
  const bandwidthAt = (endIdx: number): number | null => {
    if (endIdx + 1 < period) return null;
    const win = closes.slice(endIdx + 1 - period, endIdx + 1);
    const m = win.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / period);
    return m === 0 ? null : ((mult * sd * 2) / m) * 100;
  };

  const win = closes.slice(-period);
  const mid = win.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + mult * sd;
  const lower = mid - mult * sd;
  const price = closes[closes.length - 1];
  const span = upper - lower;
  const bandwidth = mid === 0 ? 0 : (span / mid) * 100;

  // compare current bandwidth against the recent distribution
  const history: number[] = [];
  for (let i = Math.max(period - 1, closes.length - 60); i < closes.length; i++) {
    const bw = bandwidthAt(i);
    if (bw != null) history.push(bw);
  }
  const sorted = [...history].sort((a, b) => a - b);
  const quintile = sorted[Math.floor(sorted.length * 0.2)] ?? bandwidth;
  const median = sorted[Math.floor(sorted.length * 0.5)] ?? bandwidth;
  // A squeeze means the bands are genuinely narrow for this stock, not merely
  // at the bottom of a flat distribution — require both.
  const isSqueeze = bandwidth <= quintile && bandwidth < median * 0.9;

  return {
    mid,
    upper,
    lower,
    position: span === 0 ? 0.5 : Math.max(0, Math.min(1, (price - lower) / span)),
    bandwidth,
    squeeze: isSqueeze,
  };
}

/**
 * Bars elapsed since price last crossed above the given EMA.
 * Returns null when no cross is found in the window — price has been above
 * the EMA throughout, which callers score as an extended (mature) trend.
 */
export function barsSinceEmaCross(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 5) return null;
  const closes = candles.map((c) => c.close);
  const series = emaSeries(closes, period);
  if (!series.length) return null;
  // emaSeries starts at index (period-1) of closes
  const offset = closes.length - series.length;
  for (let i = series.length - 1; i > 0; i--) {
    const priceNow = closes[offset + i];
    const pricePrev = closes[offset + i - 1];
    if (priceNow > series[i] && pricePrev <= series[i - 1]) {
      return series.length - 1 - i;
    }
  }
  return null;
}

/** Average daily dollar volume over the lookback window. */
export function dollarVolume(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((s, c) => s + c.close * c.volume, 0) / period;
}

/** ATR as a percentage of price. */
export function atrPercent(candles: Candle[], period = 14): number | null {
  const a = atr(candles, period);
  const price = candles[candles.length - 1]?.close;
  if (a == null || !price) return null;
  return (a / price) * 100;
}

/** True when ATR is both above its own longer average and expanding. */
export function atrExpanding(candles: Candle[], period = 14): { above: boolean; expanding: boolean } | null {
  if (candles.length < period * 3) return null;
  const now = atr(candles, period);
  const past = atr(candles.slice(0, -period), period);
  const longRun = atr(candles, period * 2);
  if (now == null || past == null || longRun == null) return null;
  return { above: now > longRun, expanding: now > past };
}
