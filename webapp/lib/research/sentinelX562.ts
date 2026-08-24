import type { Candle } from "../types";
import { adx, atr, ema, rsi } from "../indicators";

export type SentinelXTrend = "BULL" | "NEUTRAL" | "BEAR";
export type SentinelXCoreState = "STRONG BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG BEAR";
export type SentinelXStructure = "HH/HL" | "BULLISH" | "MIXED" | "BEARISH" | "LH/LL";
export type SentinelXRegime = "BREAKOUT" | "TREND" | "RANGE" | "TRANSITION" | "BALANCED";
export type SentinelXTrigger = "BOS_UP" | "BOS_DOWN" | "CHOCH_UP" | "CHOCH_DOWN" | "RSI_SMA_BULL_SHIFT" | "RSI_SMA_BEAR_SHIFT" | "RSI_LOW_RECLAIM" | "RSI_HIGH_REJECT" | "HMA16_RECLAIM" | "HMA16_LOSS" | "NONE";

export type SentinelX562Snapshot = {
  version: "5.6.2";
  score: number;
  trend: SentinelXTrend;
  coreState: SentinelXCoreState;
  direction: number;
  energy: number;
  fastImpulse: number;
  momentumStrength: number;
  rsi: number;
  rsiSma: number;
  rsiState: "ABOVE_SMA" | "BELOW_SMA" | "AT_SMA";
  structure: SentinelXStructure;
  structureBias: SentinelXTrend;
  regime: SentinelXRegime;
  trigger: SentinelXTrigger;
  hma16State: "BULL" | "BEAR" | "FLAT";
  emaStack: "BULL" | "BEAR" | "MIXED";
  bosUp: boolean;
  bosDown: boolean;
  chochUp: boolean;
  chochDown: boolean;
  reason: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const finite = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function smaAt(values: number[], length: number, end = values.length - 1): number | null {
  if (end < length - 1) return null;
  return avg(values.slice(end - length + 1, end + 1));
}

function emaSeries(values: number[], length: number) {
  if (!values.length) return [] as number[];
  const alpha = 2 / (length + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] * alpha + out[i - 1] * (1 - alpha));
  return out;
}

function wma(values: number[]): number | null {
  if (!values.length) return null;
  const den = values.length * (values.length + 1) / 2;
  return values.reduce((sum, value, index) => sum + value * (index + 1), 0) / den;
}

function hmaSeries(values: number[], length = 16) {
  const half = Math.max(2, Math.round(length / 2));
  const root = Math.max(2, Math.round(Math.sqrt(length)));
  const raw: Array<number | null> = values.map((_, index) => {
    if (index < length - 1) return null;
    const full = wma(values.slice(index - length + 1, index + 1));
    const fast = wma(values.slice(index - half + 1, index + 1));
    return full == null || fast == null ? null : 2 * fast - full;
  });
  return raw.map((value, index) => {
    if (value == null || index < length - 1 + root - 1) return null;
    const slice = raw.slice(index - root + 1, index + 1);
    if (slice.some(item => item == null)) return null;
    return wma(slice as number[]);
  });
}

function rsiSeries(values: number[], length = 14) {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= length) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= length; i += 1) {
    const change = values[i] - values[i - 1];
    gain += Math.max(0, change);
    loss += Math.max(0, -change);
  }
  let avgGain = gain / length;
  let avgLoss = loss / length;
  out[length] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = length + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(0, change)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(0, -change)) / length;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function rsiSmaAt(series: Array<number | null>, length: number, end = series.length - 1) {
  const values: number[] = [];
  for (let i = end; i >= 0 && values.length < length; i -= 1) if (series[i] != null) values.unshift(series[i] as number);
  return values.length === length ? avg(values) : null;
}

function chop(candles: Candle[], length = 14) {
  const rows = candles.slice(-length);
  if (rows.length < length) return 50;
  let trSum = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const prevClose = i ? rows[i - 1].close : rows[i].open;
    trSum += Math.max(rows[i].high - rows[i].low, Math.abs(rows[i].high - prevClose), Math.abs(rows[i].low - prevClose));
  }
  const high = Math.max(...rows.map(row => row.high));
  const low = Math.min(...rows.map(row => row.low));
  const range = Math.max(high - low, 1e-9);
  return clamp(100 * Math.log(Math.max(trSum / range, 1)) / Math.log(length));
}

function structure(candles: Candle[], width = 4) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = width; i < candles.length - width; i += 1) {
    const row = candles[i];
    const window = candles.slice(i - width, i + width + 1);
    if (row.high >= Math.max(...window.map(item => item.high))) highs.push(row.high);
    if (row.low <= Math.min(...window.map(item => item.low))) lows.push(row.low);
  }
  const lastHigh = highs.at(-1) ?? null;
  const prevHigh = highs.at(-2) ?? null;
  const lastLow = lows.at(-1) ?? null;
  const prevLow = lows.at(-2) ?? null;
  const hh = lastHigh != null && prevHigh != null && lastHigh > prevHigh;
  const lh = lastHigh != null && prevHigh != null && lastHigh < prevHigh;
  const hl = lastLow != null && prevLow != null && lastLow > prevLow;
  const ll = lastLow != null && prevLow != null && lastLow < prevLow;
  const state = hh && hl ? 2 : lh && ll ? -2 : hh || hl ? 1 : lh || ll ? -1 : 0;
  const label: SentinelXStructure = state === 2 ? "HH/HL" : state === -2 ? "LH/LL" : state === 1 ? "BULLISH" : state === -1 ? "BEARISH" : "MIXED";
  return { state, label, lastHigh, lastLow };
}

function macdHistogram(values: number[]) {
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const line = values.map((_, index) => fast[index] - slow[index]);
  const signal = emaSeries(line, 9);
  return line.map((value, index) => value - signal[index]);
}

/**
 * Server-side decision snapshot based on the uploaded Sentinel X v5.6.2 Pine.
 * It intentionally mirrors the Pine ownership split: trend/momentum/structure
 * live here, while MCDX owns participation/flow. The RSI/SMA pane remains
 * observational and never creates an order by itself.
 */
export function computeSentinelX562(candles: Candle[]): SentinelX562Snapshot | null {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 200) return null;
  const closes = clean.map(row => row.close);
  const current = clean.at(-1)!;
  const previous = clean.at(-2)!;
  const volatility = atr(clean, 14) ?? Math.max(current.high - current.low, current.close * .01);
  const den = Math.max(volatility, current.close * .0001);
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const e200 = emaSeries(closes, 200);
  const hma = hmaSeries(closes, 16);
  const hNow = hma.at(-1) ?? current.close;
  const h3 = hma.at(-4) ?? hNow;
  const e20Now = e20.at(-1)!;
  const e50Now = e50.at(-1)!;
  const e200Now = e200.at(-1)!;
  const hmaSlope = (hNow - h3) / den;
  const e20Slope = (e20Now - (e20.at(-5) ?? e20Now)) / den;
  const e50Slope = (e50Now - (e50.at(-9) ?? e50Now)) / den;
  const separation = (e20Now - e50Now) / den;
  const trendRaw = Math.max(-100, Math.min(100, hmaSlope * 10 + e20Slope * 23 + e50Slope * 31 + separation * 16 + (current.close - e20Now) / den * 8));

  const rsiValues = rsiSeries(closes, 14);
  const rsiNow = rsiValues.at(-1) ?? rsi(closes, 14) ?? 50;
  const rsiPrev = rsiValues.at(-2) ?? rsiNow;
  const rsiSma = rsiSmaAt(rsiValues, 14) ?? 50;
  const rsiSmaPrev = rsiSmaAt(rsiValues, 14, rsiValues.length - 2) ?? rsiSma;
  const rsiState = rsiNow > rsiSma + .05 ? "ABOVE_SMA" : rsiNow < rsiSma - .05 ? "BELOW_SMA" : "AT_SMA";

  const adxNow = adx(clean, 14) ?? 15;
  const chopNow = chop(clean, 14);
  const labelAdxQuality = clamp((adxNow - 12) / 23 * 100);
  const labelChopQuality = clamp((62 - chopNow) / 24 * 100);
  const labelRsiStrength = clamp(Math.abs(rsiNow - 50) * 2);
  const labelSpreadStrength = clamp(Math.abs(rsiNow - rsiSma) * 6);
  const momentumStrength = Math.round(clamp(labelRsiStrength * .35 + labelSpreadStrength * .25 + labelAdxQuality * .25 + labelChopQuality * .15));

  const volume20 = avg(clean.slice(-20).map(row => row.volume));
  const rvol = volume20 > 0 ? current.volume / volume20 : 1;
  const bodyEfficiency = Math.abs(current.close - current.open) / Math.max(current.high - current.low, current.close * .0001);
  const clv = (current.close - current.low) / Math.max(current.high - current.low, current.close * .0001);
  const paPressure = Math.max(-100, Math.min(100, (current.close > current.open ? 1 : -1) * bodyEfficiency * 60 + (clv - .5) * 65));
  const flowPressure = Math.max(-100, Math.min(100, (current.close > current.open ? 1 : -1) * ((rvol - .75) * 48 + bodyEfficiency * 42)));

  const hist = macdHistogram(closes);
  const roc1 = (current.close - previous.close) / den * 35;
  const roc3 = (current.close - (closes.at(-4) ?? current.close)) / den * 18;
  const rsiVel = (rsiNow - (rsiValues.at(-3) ?? rsiNow)) * 2.2;
  const histAccel = ((hist.at(-1) ?? 0) - (hist.at(-3) ?? 0)) / den * 120;
  const displacement = Math.max(-100, Math.min(100, (current.close - current.open) / den * 42));
  const fastImpulse = Math.max(-100, Math.min(100, roc1 * .24 + roc3 * .16 + rsiVel * .16 + histAccel * .24 + displacement * .20));
  const direction = Math.max(-100, Math.min(100, trendRaw * .48 + paPressure * .26 + flowPressure * .26));
  const trendCoherence = Math.min(100, Math.abs(separation) * 18 + Math.abs(e20Slope) * 22 + adxNow * 1.15);
  const moveEfficiency = Math.min(100, bodyEfficiency * 50 + Math.max(0, rvol - .7) * 40);
  const energy = clamp(Math.abs(direction) * .38 + Math.abs(fastImpulse) * .26 + trendCoherence * .20 + moveEfficiency * .16);
  const coreState: SentinelXCoreState = direction >= 42 && energy >= 52 ? "STRONG BULL" : direction >= 14 ? "BULL" : direction <= -42 && energy >= 52 ? "STRONG BEAR" : direction <= -14 ? "BEAR" : "NEUTRAL";

  const s = structure(clean, 4);
  const structureBias: SentinelXTrend = s.state > 0 ? "BULL" : s.state < 0 ? "BEAR" : "NEUTRAL";
  const bosUp = s.lastHigh != null && current.close > s.lastHigh + volatility * .06 && previous.close <= s.lastHigh && bodyEfficiency >= .42;
  const bosDown = s.lastLow != null && current.close < s.lastLow - volatility * .06 && previous.close >= s.lastLow && bodyEfficiency >= .42;
  const chochUp = s.state <= 0 && bosUp;
  const chochDown = s.state >= 0 && bosDown;
  const atrRecent = clean.slice(-5).map((row, index, rows) => index ? Math.max(row.high - row.low, Math.abs(row.high - rows[index - 1].close), Math.abs(row.low - rows[index - 1].close)) : row.high - row.low);
  const atrBase = clean.slice(-30).map((row, index, rows) => index ? Math.max(row.high - row.low, Math.abs(row.high - rows[index - 1].close), Math.abs(row.low - rows[index - 1].close)) : row.high - row.low);
  const volExpand = avg(atrRecent) > avg(atrBase) * 1.08;
  const breakout = (bosUp || bosDown) && volExpand && rvol >= 1.05;
  const strongTrend = adxNow >= 25 && Math.abs(direction) >= 30;
  const range = adxNow < 17 && Math.abs(direction) < 22 && !breakout;
  const transition = chochUp || chochDown || (adxNow >= 16 && adxNow < 25 && Math.abs(direction) < 35);
  const regime: SentinelXRegime = breakout ? "BREAKOUT" : strongTrend ? "TREND" : range ? "RANGE" : transition ? "TRANSITION" : "BALANCED";

  const hma16State = hmaSlope > .04 ? "BULL" : hmaSlope < -.04 ? "BEAR" : "FLAT";
  const emaStack = current.close > e20Now && e20Now > e50Now && e50Now > e200Now ? "BULL" : current.close < e20Now && e20Now < e50Now && e50Now < e200Now ? "BEAR" : "MIXED";
  const rsiBullShift = rsiPrev <= rsiSmaPrev && rsiNow > rsiSma;
  const rsiBearShift = rsiPrev >= rsiSmaPrev && rsiNow < rsiSma;
  const rsiLowReclaim = rsiPrev <= 30 && rsiNow > 30 && rsiNow >= rsiSma;
  const rsiHighReject = rsiPrev >= 70 && rsiNow < 70 && rsiNow <= rsiSma;
  const hmaReclaim = current.close > hNow && previous.close <= (hma.at(-2) ?? hNow) && hmaSlope > 0;
  const hmaLoss = current.close < hNow && previous.close >= (hma.at(-2) ?? hNow) && hmaSlope < 0;
  const trigger: SentinelXTrigger = chochUp ? "CHOCH_UP" : chochDown ? "CHOCH_DOWN" : bosUp ? "BOS_UP" : bosDown ? "BOS_DOWN" : rsiLowReclaim ? "RSI_LOW_RECLAIM" : rsiHighReject ? "RSI_HIGH_REJECT" : rsiBullShift ? "RSI_SMA_BULL_SHIFT" : rsiBearShift ? "RSI_SMA_BEAR_SHIFT" : hmaReclaim ? "HMA16_RECLAIM" : hmaLoss ? "HMA16_LOSS" : "NONE";

  const score = Math.round(clamp(50 + direction * .32 + (rsiNow - 50) * .22 + s.state * 4 + (emaStack === "BULL" ? 7 : emaStack === "BEAR" ? -7 : 0)));
  const trend: SentinelXTrend = coreState.includes("BULL") && score >= 54 ? "BULL" : coreState.includes("BEAR") && score <= 46 ? "BEAR" : score >= 60 ? "BULL" : score <= 40 ? "BEAR" : "NEUTRAL";
  const reason = `Sentinel X v5.6.2 ${coreState} · RSI ${rsiNow.toFixed(1)}/${rsiSma.toFixed(1)} SMA · strength ${momentumStrength}/100 · ${s.label} · ${regime}${trigger !== "NONE" ? ` · ${trigger}` : ""}.`;

  return {
    version: "5.6.2",
    score,
    trend,
    coreState,
    direction: Math.round(direction),
    energy: Math.round(energy),
    fastImpulse: Math.round(fastImpulse),
    momentumStrength,
    rsi: Math.round(rsiNow * 10) / 10,
    rsiSma: Math.round(rsiSma * 10) / 10,
    rsiState,
    structure: s.label,
    structureBias,
    regime,
    trigger,
    hma16State,
    emaStack,
    bosUp,
    bosDown,
    chochUp,
    chochDown,
    reason,
  };
}
