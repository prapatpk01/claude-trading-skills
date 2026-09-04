import type { Candle } from "../types";

export type SentinelTrend = "BULL" | "NEUTRAL" | "BEAR";
export type SentinelStructurePattern = "HH/HL" | "LH/LL" | "BULLISH" | "BEARISH" | "MIXED";
export type SentinelRegime = "TREND" | "RANGE" | "TRANSITION" | "BALANCED";
export type SentinelSetup = "PB" | "LQ" | "REV" | "BO" | "NONE";
export type SentinelSetupState = "WAIT" | "ARMED" | "READY" | "SIGNAL";
export type SentinelForecastDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SentinelCompanionStatus = "CONFIRM" | "NEUTRAL" | "OPPOSITE" | "VETO" | "OFF";
export type SentinelGrade = "A+" | "A" | "B" | "C";

export interface SentinelX64Options {
  companionFlowPower?: number | null;
  companionConfirmGate?: number;
  companionVetoGate?: number;
  useCompanion?: boolean;
}

export interface SentinelX64Snapshot {
  version: "6.4";
  engine: "Sentinel X v6.4 · EMA Hybrid + MCDX Companion";
  status: "READY" | "FALLBACK";
  price: number;
  score: number;
  longScore: number;
  shortScore: number;
  grade: SentinelGrade;
  trend: SentinelTrend;
  trendLabel: "STRONG BULL" | "BULL" | "NEUTRAL" | "BEAR" | "STRONG BEAR";
  trendDirection: -2 | -1 | 0 | 1 | 2;
  structureBias: SentinelTrend;
  structure: SentinelStructurePattern;
  structureState: -2 | -1 | 0 | 1 | 2;
  coreState: string;
  direction: number;
  degreesOfPower: number;
  powerLabel: string;
  energy: number;
  fastImpulse: number;
  momentumStrength: number;
  ema: { ema20: number; ema50: number; ema200: number | null; macroAvailable: boolean };
  emaStack: "BULL" | "BEAR" | "MIXED";
  hma16: number;
  hma16State: "BULL" | "BEAR" | "FLAT";
  rsi: number;
  rsiSma: number;
  rsiState: "ABOVE_SMA" | "BELOW_SMA" | "AT_SMA";
  adx: number;
  plusDi: number;
  minusDi: number;
  chop: number;
  qualityScore: number;
  qualityLabel: "STRONG" | "HEALTHY" | "DEVELOPING" | "WEAK";
  regime: SentinelRegime;
  trigger: string;
  setup: SentinelSetup;
  setupDirection: "LONG" | "SHORT" | "NONE";
  setupState: SentinelSetupState;
  setupGrade: SentinelGrade;
  levels: {
    support1: number | null;
    resistance1: number | null;
    roomLongAtr: number;
    roomShortAtr: number;
    location: "SUPPORT" | "RESISTANCE" | "FIB 50-61.8" | "FIB 38.2-61.8" | "EMA VALUE" | "MID";
    fib38: number | null;
    fib50: number | null;
    fib62: number | null;
  };
  forecast: {
    direction: SentinelForecastDirection;
    score: number;
    confidence: number;
    valid: boolean;
    driver: string;
    target1: number | null;
    target2: number | null;
    invalidation: number | null;
  };
  companion: {
    active: boolean;
    flowPower: number;
    longStatus: SentinelCompanionStatus;
    shortStatus: SentinelCompanionStatus;
    forecastStatus: SentinelCompanionStatus;
    volumeBoosterDisabled: boolean;
  };
  fallbackRisk: boolean;
  diagnostics: string[];
}

const clamp = (value: number, min = -100, max = 100) => Math.max(min, Math.min(max, value));
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function emaSeries(values: number[], length: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < length) return out;
  let prev = mean(values.slice(0, length));
  out[length - 1] = prev;
  const alpha = 2 / (length + 1);
  for (let i = length; i < values.length; i += 1) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

function rmaSeries(values: Array<number | null>, length: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  const seed: number[] = [];
  let prev: number | null = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    if (prev == null) {
      seed.push(value);
      if (seed.length < length) continue;
      prev = mean(seed);
      out[i] = prev;
      continue;
    }
    prev = (prev * (length - 1) + value) / length;
    out[i] = prev;
  }
  return out;
}

function wmaAt(values: number[], end: number, length: number): number | null {
  if (end + 1 < length) return null;
  let numerator = 0;
  let denominator = 0;
  for (let j = 0; j < length; j += 1) {
    const weight = j + 1;
    numerator += values[end - length + 1 + j] * weight;
    denominator += weight;
  }
  return denominator ? numerator / denominator : null;
}

function hmaSeries(values: number[], length = 16): Array<number | null> {
  const half = Math.max(1, Math.round(length / 2));
  const root = Math.max(1, Math.round(Math.sqrt(length)));
  const raw: number[] = Array(values.length).fill(Number.NaN);
  for (let i = 0; i < values.length; i += 1) {
    const fast = wmaAt(values, i, half);
    const slow = wmaAt(values, i, length);
    if (fast != null && slow != null) raw[i] = 2 * fast - slow;
  }
  const out: Array<number | null> = Array(values.length).fill(null);
  for (let i = 0; i < values.length; i += 1) {
    if (i + 1 < root) continue;
    const window = raw.slice(i + 1 - root, i + 1);
    if (window.some(value => !Number.isFinite(value))) continue;
    out[i] = wmaAt(window, window.length - 1, root);
  }
  return out;
}

function rsiSeries(values: number[], length = 14): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  if (values.length < length + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= length; i += 1) {
    const change = values[i] - values[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let avgGain = gains / length;
  let avgLoss = losses / length;
  const toRsi = () => avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  out[length] = toRsi();
  for (let i = length + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    avgGain = (avgGain * (length - 1) + Math.max(change, 0)) / length;
    avgLoss = (avgLoss * (length - 1) + Math.max(-change, 0)) / length;
    out[i] = toRsi();
  }
  return out;
}

function smaNullable(values: Array<number | null>, length: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null);
  for (let i = length - 1; i < values.length; i += 1) {
    const window = values.slice(i + 1 - length, i + 1);
    if (window.some(value => value == null)) continue;
    out[i] = mean(window as number[]);
  }
  return out;
}

function trueRange(candles: Candle[]) {
  const out: Array<number | null> = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i];
    const previous = candles[i - 1];
    out[i] = Math.max(bar.high - bar.low, Math.abs(bar.high - previous.close), Math.abs(bar.low - previous.close));
  }
  return out;
}

function dmiSeries(candles: Candle[], length = 14) {
  const tr = trueRange(candles);
  const plusDm: Array<number | null> = Array(candles.length).fill(null);
  const minusDm: Array<number | null> = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const trRma = rmaSeries(tr, length);
  const plusRma = rmaSeries(plusDm, length);
  const minusRma = rmaSeries(minusDm, length);
  const plusDi: Array<number | null> = Array(candles.length).fill(null);
  const minusDi: Array<number | null> = Array(candles.length).fill(null);
  const dx: Array<number | null> = Array(candles.length).fill(null);
  for (let i = 0; i < candles.length; i += 1) {
    if (trRma[i] == null || plusRma[i] == null || minusRma[i] == null || trRma[i] === 0) continue;
    plusDi[i] = (plusRma[i] as number) / (trRma[i] as number) * 100;
    minusDi[i] = (minusRma[i] as number) / (trRma[i] as number) * 100;
    const sum = (plusDi[i] as number) + (minusDi[i] as number);
    dx[i] = sum > 0 ? Math.abs((plusDi[i] as number) - (minusDi[i] as number)) / sum * 100 : 0;
  }
  return { plusDi, minusDi, adx: rmaSeries(dx, length), atr: trRma };
}

function grade(score: number): SentinelGrade {
  return score >= 9 ? "A+" : score >= 7 ? "A" : score >= 5 ? "B" : "C";
}

function pivotLists(candles: Candle[], left = 4, right = 4) {
  const highs: Array<{ index: number; value: number }> = [];
  const lows: Array<{ index: number; value: number }> = [];
  for (let center = left; center < candles.length - right; center += 1) {
    const high = candles[center].high;
    const low = candles[center].low;
    let isHigh = true;
    let isLow = true;
    for (let i = center - left; i <= center + right; i += 1) {
      if (i === center) continue;
      if (candles[i].high > high) isHigh = false;
      if (candles[i].low < low) isLow = false;
    }
    if (isHigh) highs.push({ index: center, value: high });
    if (isLow) lows.push({ index: center, value: low });
  }
  return { highs, lows };
}

function latestBefore<T extends { index: number }>(values: T[], index: number): T | null {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i].index < index) return values[i];
  return null;
}

function companionStatus(side: "LONG" | "SHORT", active: boolean, flow: number, confirmGate: number, vetoGate: number): SentinelCompanionStatus {
  if (!active) return "OFF";
  if (side === "LONG") {
    if (flow <= -vetoGate) return "VETO";
    if (flow <= -confirmGate) return "OPPOSITE";
    if (flow >= confirmGate) return "CONFIRM";
    return "NEUTRAL";
  }
  if (flow >= vetoGate) return "VETO";
  if (flow >= confirmGate) return "OPPOSITE";
  if (flow <= -confirmGate) return "CONFIRM";
  return "NEUTRAL";
}

function powerBar(power: number) {
  const p = Math.round(clamp(power, -100, 100) / 25);
  if (p <= -4) return "◆───○────";
  if (p === -3) return "─◆──○────";
  if (p === -2) return "──◆─○────";
  if (p === -1) return "───◆○────";
  if (p === 0) return "────◆────";
  if (p === 1) return "────○◆───";
  if (p === 2) return "────○─◆──";
  if (p === 3) return "────○──◆─";
  return "────○───◆";
}

/**
 * Webapp port of Sentinel X v6.4.
 * Sentinel owns price direction/structure/location/setup/forecast. MCDX is injected
 * only as conviction; when active, relative-volume score boosting is disabled so
 * volume participation is never counted twice.
 */
export function computeSentinelX64(rows: Candle[], options: SentinelX64Options = {}): SentinelX64Snapshot | null {
  const candles = rows
    .filter(row => Number.isFinite(row.close) && row.close > 0 && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.open) && Number.isFinite(row.volume))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (candles.length < 55) return null;

  const closes = candles.map(bar => bar.close);
  const volumes = candles.map(bar => Math.max(0, bar.volume));
  const n = candles.length;
  const last = n - 1;
  const bar = candles[last];
  const previousBar = candles[last - 1];

  const ema20Series = emaSeries(closes, 20);
  const ema50Series = emaSeries(closes, 50);
  const ema200Series = emaSeries(closes, 200);
  const hma = hmaSeries(closes, 16);
  const rsiValues = rsiSeries(closes, 14);
  const rsiSmaValues = smaNullable(rsiValues, 14);
  const dmi = dmiSeries(candles, 14);

  const ema20 = ema20Series[last];
  const ema50 = ema50Series[last];
  const ema200 = ema200Series[last];
  const hma16 = hma[last];
  const rsi = rsiValues[last];
  const rsiSma = rsiSmaValues[last];
  const atr = dmi.atr[last];
  const plusDi = dmi.plusDi[last];
  const minusDi = dmi.minusDi[last];
  const adx = dmi.adx[last];
  if ([ema20, ema50, hma16, rsi, rsiSma, atr, plusDi, minusDi, adx].some(value => value == null || !Number.isFinite(value))) return null;
  const den = Math.max(atr as number, 1e-9);

  const ema20Past3 = ema20Series[last - 3] ?? ema20;
  const ema50Past5 = ema50Series[last - 5] ?? ema50;
  const hmaPast2 = hma[last - 2] ?? hma16;
  const ema20Slope = ((ema20 as number) - (ema20Past3 as number)) / den;
  const ema50Slope = ((ema50 as number) - (ema50Past5 as number)) / den;
  const emaSep = Math.abs((ema20 as number) - (ema50 as number)) / den;
  const hmaSlope = ((hma16 as number) - (hmaPast2 as number)) / den;

  const tr = trueRange(candles);
  const chopWindow = 14;
  const trValues = tr.slice(last + 1 - chopWindow, last + 1).filter((value): value is number => value != null);
  const highRange = Math.max(...candles.slice(last + 1 - chopWindow).map(item => item.high));
  const lowRange = Math.min(...candles.slice(last + 1 - chopWindow).map(item => item.low));
  const chopRatio = Math.max(trValues.reduce((sum, value) => sum + value, 0) / Math.max(highRange - lowRange, 1e-9), 1);
  const chop = clamp(100 * Math.log(chopRatio) / Math.log(chopWindow), 0, 100);

  const bullStack = (ema20 as number) > (ema50 as number);
  const bearStack = (ema20 as number) < (ema50 as number);
  const macroAvailable = ema200 != null && Number.isFinite(ema200);
  const macroBull = macroAvailable && (ema50 as number) > (ema200 as number);
  const macroBear = macroAvailable && (ema50 as number) < (ema200 as number);
  const bullTrend = bullStack && bar.close > (ema50 as number) && ema20Slope > 0;
  const bearTrend = bearStack && bar.close < (ema50 as number) && ema20Slope < 0;
  const strongBull = bullTrend && macroBull && bar.close > (ema20 as number) && ema50Slope >= 0;
  const strongBear = bearTrend && macroBear && bar.close < (ema20 as number) && ema50Slope <= 0;
  const trendDirection = (strongBull ? 2 : bullTrend ? 1 : strongBear ? -2 : bearTrend ? -1 : 0) as -2 | -1 | 0 | 1 | 2;
  const trendLabel = trendDirection === 2 ? "STRONG BULL" : trendDirection === 1 ? "BULL" : trendDirection === -2 ? "STRONG BEAR" : trendDirection === -1 ? "BEAR" : "NEUTRAL";
  const trend: SentinelTrend = trendDirection > 0 ? "BULL" : trendDirection < 0 ? "BEAR" : "NEUTRAL";

  const alignBull = bullStack ? (macroBull ? 2 : 1) : 0;
  const alignBear = bearStack ? (macroBear ? 2 : 1) : 0;
  const slopeBull = ema20Slope > .10 ? 2 : ema20Slope > 0 ? 1 : 0;
  const slopeBear = ema20Slope < -.10 ? 2 : ema20Slope < 0 ? 1 : 0;
  const sepScore = emaSep >= .60 ? 2 : emaSep >= .20 ? 1 : 0;
  const adxScore = (adx as number) >= 25 ? 2 : (adx as number) >= 18 ? 1 : 0;
  const chopScore = chop <= 45 ? 2 : chop <= 55 ? 1 : 0;
  const bullQuality = clamp(alignBull + slopeBull + sepScore + adxScore + chopScore, 0, 10);
  const bearQuality = clamp(alignBear + slopeBear + sepScore + adxScore + chopScore, 0, 10);
  const qualityScore = trendDirection > 0 ? bullQuality : trendDirection < 0 ? bearQuality : Math.max(bullQuality, bearQuality);
  const qualityLabel = qualityScore >= 8 ? "STRONG" : qualityScore >= 6 ? "HEALTHY" : qualityScore >= 4 ? "DEVELOPING" : "WEAK";
  const regime: SentinelRegime = (adx as number) >= 25 && chop <= 55 && trendDirection !== 0 ? "TREND" : (adx as number) < 16 && chop > 55 ? "RANGE" : trendDirection === 0 ? "TRANSITION" : "BALANCED";

  const pivots = pivotLists(candles, 4, 4);
  const lastPh = pivots.highs.at(-1) ?? null;
  const prevPh = pivots.highs.at(-2) ?? null;
  const lastPl = pivots.lows.at(-1) ?? null;
  const prevPl = pivots.lows.at(-2) ?? null;
  const hh = Boolean(lastPh && prevPh && lastPh.value > prevPh.value);
  const lh = Boolean(lastPh && prevPh && lastPh.value < prevPh.value);
  const hl = Boolean(lastPl && prevPl && lastPl.value > prevPl.value);
  const ll = Boolean(lastPl && prevPl && lastPl.value < prevPl.value);
  const structureState = (hh && hl ? 2 : lh && ll ? -2 : hh || hl ? 1 : lh || ll ? -1 : 0) as -2 | -1 | 0 | 1 | 2;
  const structure: SentinelStructurePattern = structureState === 2 ? "HH/HL" : structureState === -2 ? "LH/LL" : structureState === 1 ? "BULLISH" : structureState === -1 ? "BEARISH" : "MIXED";
  const structureBias: SentinelTrend = structureState > 0 ? "BULL" : structureState < 0 ? "BEAR" : "NEUTRAL";

  const range = Math.max(bar.high - bar.low, 1e-9);
  const bodyEfficiency = Math.abs(bar.close - bar.open) / range;
  const clv = (bar.close - bar.low) / range;
  const bosUp = Boolean(lastPh && bar.close > lastPh.value + den * .05 && previousBar.close <= lastPh.value && bodyEfficiency >= .40);
  const bosDown = Boolean(lastPl && bar.close < lastPl.value - den * .05 && previousBar.close >= lastPl.value && bodyEfficiency >= .40);
  const chochUp = structureState <= 0 && bosUp;
  const chochDown = structureState >= 0 && bosDown;
  const sweepLow = Boolean(lastPl && bar.low < lastPl.value - den * .05 && bar.close > lastPl.value && bar.close > bar.open && clv >= .58);
  const sweepHigh = Boolean(lastPh && bar.high > lastPh.value + den * .05 && bar.close < lastPh.value && bar.close < bar.open && clv <= .42);
  const microWindow = candles.slice(Math.max(0, last - 4), last);
  const microHigh = Math.max(...microWindow.map(item => item.high));
  const microLow = Math.min(...microWindow.map(item => item.low));
  const microBosUp = bar.close > microHigh && bar.close > bar.open && bodyEfficiency >= .35;
  const microBosDown = bar.close < microLow && bar.close < bar.open && bodyEfficiency >= .35;

  const resistance1 = lastPh?.value != null && lastPh.value > bar.close ? lastPh.value : prevPh?.value != null && prevPh.value > bar.close ? prevPh.value : null;
  const support1 = lastPl?.value != null && lastPl.value < bar.close ? lastPl.value : prevPl?.value != null && prevPl.value < bar.close ? prevPl.value : null;
  const nearResistance = resistance1 != null && Math.abs(bar.close - resistance1) <= den * .50;
  const nearSupport = support1 != null && Math.abs(bar.close - support1) <= den * .50;
  const roomLongAtr = resistance1 == null ? 5 : Math.max(0, (resistance1 - bar.close) / den);
  const roomShortAtr = support1 == null ? 5 : Math.max(0, (bar.close - support1) / den);

  const bullLegHi: { index: number; value: number } | null = lastPh;
  const bullLegLo: { index: number; value: number } | null = bullLegHi ? latestBefore(pivots.lows, bullLegHi.index) : null;
  const bearLegLo: { index: number; value: number } | null = lastPl;
  const bearLegHi: { index: number; value: number } | null = bearLegLo ? latestBefore(pivots.highs, bearLegLo.index) : null;
  const bullLegValid = Boolean(bullLegHi && bullLegLo && bullLegHi.value > bullLegLo.value && bullLegHi.value - bullLegLo.value >= den * 1.5);
  const bearLegValid = Boolean(bearLegHi && bearLegLo && bearLegHi.value > bearLegLo.value && bearLegHi.value - bearLegLo.value >= den * 1.5);
  const fibBull = bullLegValid && (trendDirection > 0 || trendDirection === 0 && structureState > 0);
  const fibBear = bearLegValid && (trendDirection < 0 || trendDirection === 0 && structureState < 0);
  let fib38: number | null = null;
  let fib50: number | null = null;
  let fib62: number | null = null;
  if (fibBull && bullLegHi && bullLegLo) {
    const leg = bullLegHi.value - bullLegLo.value;
    fib38 = bullLegHi.value - leg * .382;
    fib50 = bullLegHi.value - leg * .5;
    fib62 = bullLegHi.value - leg * .618;
  } else if (fibBear && bearLegHi && bearLegLo) {
    const leg = bearLegHi.value - bearLegLo.value;
    fib38 = bearLegLo.value + leg * .382;
    fib50 = bearLegLo.value + leg * .5;
    fib62 = bearLegLo.value + leg * .618;
  }
  const fibValueLong = fibBull && fib38 != null && fib62 != null && bar.close <= fib38 + den * .18 && bar.close >= fib62 - den * .18;
  const fibValueShort = fibBear && fib38 != null && fib62 != null && bar.close >= fib38 - den * .18 && bar.close <= fib62 + den * .18;
  const fibDeepLong = fibBull && fib50 != null && fib62 != null && bar.close <= fib50 + den * .12 && bar.close >= fib62 - den * .12;
  const fibDeepShort = fibBear && fib50 != null && fib62 != null && bar.close >= fib50 - den * .12 && bar.close <= fib62 + den * .12;
  const emaZoneHi = Math.max(ema20 as number, ema50 as number) + den * .28;
  const emaZoneLo = Math.min(ema20 as number, ema50 as number) - den * .28;
  const inEmaValue = bar.low <= emaZoneHi && bar.high >= emaZoneLo;
  const locationLong = nearSupport || fibValueLong || inEmaValue;
  const locationShort = nearResistance || fibValueShort || inEmaValue;
  const location = nearSupport ? "SUPPORT" : nearResistance ? "RESISTANCE" : fibDeepLong || fibDeepShort ? "FIB 50-61.8" : fibValueLong || fibValueShort ? "FIB 38.2-61.8" : inEmaValue ? "EMA VALUE" : "MID";

  const previousRsi = rsiValues[last - 1] ?? rsi;
  const previousRsiSma = rsiSmaValues[last - 1] ?? rsiSma;
  const rsiCrossUp = (rsi as number) > (rsiSma as number) && (previousRsi as number) <= (previousRsiSma as number);
  const rsiCrossDown = (rsi as number) < (rsiSma as number) && (previousRsi as number) >= (previousRsiSma as number);
  const rsiRecoveryLong = rsiCrossUp && (rsi as number) <= 58;
  const rsiRecoveryShort = rsiCrossDown && (rsi as number) >= 42;
  const rsiBull = (rsi as number) > (rsiSma as number) && (rsi as number) >= 45 && (rsi as number) < 72;
  const rsiBear = (rsi as number) < (rsiSma as number) && (rsi as number) <= 55 && (rsi as number) > 28;
  const previousHmaSlope = last >= 3 && hma[last - 1] != null && hma[last - 3] != null ? ((hma[last - 1] as number) - (hma[last - 3] as number)) / den : 0;
  const hmaFlipUp = hmaSlope > 0 && previousHmaSlope <= 0;
  const hmaFlipDown = hmaSlope < 0 && previousHmaSlope >= 0;
  const hmaReclaimUp = bar.close > (hma16 as number) && previousBar.close <= (hma[last - 1] ?? hma16)! && hmaSlope > 0;
  const hmaReclaimDown = bar.close < (hma16 as number) && previousBar.close >= (hma[last - 1] ?? hma16)! && hmaSlope < 0;
  const bullReject = bar.close > bar.open && clv >= .60 && bodyEfficiency >= .32;
  const bearReject = bar.close < bar.open && clv <= .40 && bodyEfficiency >= .32;

  const companionFlow = Number.isFinite(options.companionFlowPower) ? clamp(options.companionFlowPower as number) : 0;
  const companionActive = options.useCompanion !== false && Number.isFinite(options.companionFlowPower);
  const confirmGate = options.companionConfirmGate ?? 25;
  const vetoGate = options.companionVetoGate ?? 45;
  const longCompanion = companionStatus("LONG", companionActive, companionFlow, confirmGate, vetoGate);
  const shortCompanion = companionStatus("SHORT", companionActive, companionFlow, confirmGate, vetoGate);

  const avgVolume20 = mean(volumes.slice(-20));
  const rvol = avgVolume20 > 0 ? bar.volume / avgVolume20 : 1;
  const volumeBoost = !companionActive && rvol >= 1.15;
  const bodyAtr = Math.abs(bar.close - bar.open) / den;
  const priceEma20Distance = Math.abs(bar.close - (ema20 as number)) / den;
  const adxPrevious = dmi.adx[last - 1] ?? adx;
  const adxRising = (adx as number) > (adxPrevious as number);

  const pbArmLong = bullTrend && locationLong && bar.close >= (ema50 as number) && !(nearResistance && roomLongAtr < .45);
  const pbArmShort = bearTrend && locationShort && bar.close <= (ema50 as number) && !(nearSupport && roomShortAtr < .45);
  const pbReadyLong = pbArmLong && ((rsi as number) > (rsiSma as number) || hmaSlope > 0) && (rsi as number) >= 38 && (rsi as number) <= 68;
  const pbReadyShort = pbArmShort && ((rsi as number) < (rsiSma as number) || hmaSlope < 0) && (rsi as number) <= 62 && (rsi as number) >= 32;
  const pbLong = pbArmLong && bar.close >= (ema20 as number) && bullReject && (rsiRecoveryLong || hmaReclaimUp || hmaFlipUp);
  const pbShort = pbArmShort && bar.close <= (ema20 as number) && bearReject && (rsiRecoveryShort || hmaReclaimDown || hmaFlipDown);

  const lqArmLong = sweepLow && trendDirection >= 0;
  const lqArmShort = sweepHigh && trendDirection <= 0;
  const lqReadyLong = lqArmLong && Boolean(lastPl) && bar.close > (lastPl?.value ?? Infinity) && ((rsi as number) >= (rsiSma as number) || hmaSlope > 0);
  const lqReadyShort = lqArmShort && Boolean(lastPh) && bar.close < (lastPh?.value ?? -Infinity) && ((rsi as number) <= (rsiSma as number) || hmaSlope < 0);
  const lqLong = lqReadyLong && bar.close >= (ema20 as number) && (rsiBull || rsiRecoveryLong || hmaReclaimUp);
  const lqShort = lqReadyShort && bar.close <= (ema20 as number) && (rsiBear || rsiRecoveryShort || hmaReclaimDown);

  const boCoreLong = bosUp && bullStack && bar.close > (ema20 as number) && (plusDi as number) >= (minusDi as number) && (rsi as number) > (rsiSma as number);
  const boCoreShort = bosDown && bearStack && bar.close < (ema20 as number) && (minusDi as number) >= (plusDi as number) && (rsi as number) < (rsiSma as number);
  const boLong = boCoreLong && priceEma20Distance <= 1.5 && (rsi as number) <= 68 && bodyAtr >= .45 && roomLongAtr >= 1.2 && ((adx as number) >= 18 || adxRising || volumeBoost);
  const boShort = boCoreShort && priceEma20Distance <= 1.5 && (rsi as number) >= 32 && bodyAtr >= .45 && roomShortAtr >= 1.2 && ((adx as number) >= 18 || adxRising || volumeBoost);
  const boArmLong = boCoreLong && (priceEma20Distance > 1.5 || (rsi as number) > 68 || roomLongAtr < 1.2);
  const boArmShort = boCoreShort && (priceEma20Distance > 1.5 || (rsi as number) < 32 || roomShortAtr < 1.2);

  const revArmLong = (sweepLow || nearSupport || fibValueLong) && trendDirection <= 0 && ema20Slope >= -.10;
  const revArmShort = (sweepHigh || nearResistance || fibValueShort) && trendDirection >= 0 && ema20Slope <= .10;
  const revReadyLong = revArmLong && (chochUp || microBosUp) && ((rsi as number) >= (rsiSma as number) || hmaSlope > 0);
  const revReadyShort = revArmShort && (chochDown || microBosDown) && ((rsi as number) <= (rsiSma as number) || hmaSlope < 0);
  const revLong = chochUp && bar.close > (ema20 as number) && ema20Slope >= 0 && (rsiRecoveryLong || rsiBull) && (hmaReclaimUp || hmaFlipUp);
  const revShort = chochDown && bar.close < (ema20 as number) && ema20Slope <= 0 && (rsiRecoveryShort || rsiBear) && (hmaReclaimDown || hmaFlipDown);

  const setupLong: SentinelSetup = pbLong ? "PB" : lqLong ? "LQ" : revLong ? "REV" : boLong ? "BO" : "NONE";
  const setupShort: SentinelSetup = pbShort ? "PB" : lqShort ? "LQ" : revShort ? "REV" : boShort ? "BO" : "NONE";
  const candidateLong: SentinelSetup = pbArmLong ? "PB" : lqArmLong ? "LQ" : revArmLong ? "REV" : boArmLong ? "BO" : "NONE";
  const candidateShort: SentinelSetup = pbArmShort ? "PB" : lqArmShort ? "LQ" : revArmShort ? "REV" : boArmShort ? "BO" : "NONE";
  const readyLong = pbReadyLong || lqReadyLong || revReadyLong || boLong;
  const readyShort = pbReadyShort || lqReadyShort || revReadyShort || boShort;

  const longTrendPts = strongBull ? 2 : bullTrend ? 1.5 : revLong || lqLong ? 1 : bullStack ? .5 : 0;
  const shortTrendPts = strongBear ? 2 : bearTrend ? 1.5 : revShort || lqShort ? 1 : bearStack ? .5 : 0;
  const longQualityPts = bullQuality >= 8 ? 2 : bullQuality >= 6 ? 1.5 : bullQuality >= 4 ? 1 : .5;
  const shortQualityPts = bearQuality >= 8 ? 2 : bearQuality >= 6 ? 1.5 : bearQuality >= 4 ? 1 : .5;
  const longStructurePts = bosUp || chochUp || sweepLow ? 2 : structureState > 0 ? 1.5 : microBosUp ? 1 : .5;
  const shortStructurePts = bosDown || chochDown || sweepHigh ? 2 : structureState < 0 ? 1.5 : microBosDown ? 1 : .5;
  const longLocationPts = nearSupport || fibDeepLong ? 2 : fibValueLong || inEmaValue ? 1.5 : roomLongAtr >= 1 ? 1 : 0;
  const shortLocationPts = nearResistance || fibDeepShort ? 2 : fibValueShort || inEmaValue ? 1.5 : roomShortAtr >= 1 ? 1 : 0;
  const momentumLong = rsiRecoveryLong || rsiBull && (hmaFlipUp || hmaReclaimUp || microBosUp);
  const momentumShort = rsiRecoveryShort || rsiBear && (hmaFlipDown || hmaReclaimDown || microBosDown);
  const longMomentumPts = rsiRecoveryLong && (hmaFlipUp || hmaReclaimUp) ? 2 : momentumLong ? 1.5 : rsiBull ? 1 : 0;
  const shortMomentumPts = rsiRecoveryShort && (hmaFlipDown || hmaReclaimDown) ? 2 : momentumShort ? 1.5 : rsiBear ? 1 : 0;
  const longCompanionAdj = longCompanion === "VETO" ? -.5 : longCompanion === "CONFIRM" ? .35 : longCompanion === "OPPOSITE" ? -.2 : 0;
  const shortCompanionAdj = shortCompanion === "VETO" ? -.5 : shortCompanion === "CONFIRM" ? .35 : shortCompanion === "OPPOSITE" ? -.2 : 0;
  const longScore = clamp(longTrendPts + longQualityPts + longStructurePts + longLocationPts + longMomentumPts + (volumeBoost ? .25 : 0) + longCompanionAdj, 0, 10);
  const shortScore = clamp(shortTrendPts + shortQualityPts + shortStructurePts + shortLocationPts + shortMomentumPts + (volumeBoost ? .25 : 0) + shortCompanionAdj, 0, 10);

  const rawLongSignal = setupLong !== "NONE" && longScore >= 7 && (roomLongAtr >= .45 || lqLong || revLong) && !(nearResistance && roomLongAtr < .35) && longCompanion !== "VETO";
  const rawShortSignal = setupShort !== "NONE" && shortScore >= 7 && (roomShortAtr >= .45 || lqShort || revShort) && !(nearSupport && roomShortAtr < .35) && shortCompanion !== "VETO";
  const selectedLong = rawLongSignal && (!rawShortSignal || longScore > shortScore);
  const selectedShort = rawShortSignal && (!rawLongSignal || shortScore > longScore);

  const emaPower = trendDirection === 2 ? 30 : trendDirection === 1 ? 18 : trendDirection === -2 ? -30 : trendDirection === -1 ? -18 : 0;
  const structurePower = structureState * 8;
  const dmiDen = Math.max((plusDi as number) + (minusDi as number), 1);
  const dmiPower = clamp(((plusDi as number) - (minusDi as number)) / dmiDen * 28, -28, 28);
  const rsiPower = clamp(((rsi as number) - (rsiSma as number)) * 1.35, -14, 14);
  const hmaPower = clamp(hmaSlope * 8, -12, 12);
  const degreesOfPower = clamp(emaPower + structurePower + dmiPower + rsiPower + hmaPower);

  const scoreSpread = (longScore - shortScore) * 7;
  const trendForecast = trendDirection * 12;
  const structureForecast = structureState * 5;
  const dmiForecast = clamp(((plusDi as number) - (minusDi as number)) * .45, -12, 12);
  const rsiForecast = clamp(((rsi as number) - (rsiSma as number)) * 1.35, -12, 12);
  const mcdxForecast = companionActive ? clamp(companionFlow * .18, -18, 18) : 0;
  const forecastScore = clamp(scoreSpread + trendForecast + structureForecast + dmiForecast + rsiForecast + mcdxForecast);
  const forecastDirection: SentinelForecastDirection = forecastScore >= 12 ? "BULLISH" : forecastScore <= -12 ? "BEARISH" : "NEUTRAL";
  const forecastSide = forecastDirection === "BULLISH" ? 1 : forecastDirection === "BEARISH" ? -1 : 0;
  const liveScore = forecastSide > 0 ? longScore : forecastSide < 0 ? shortScore : Math.max(longScore, shortScore);
  const liveReady = forecastSide > 0 ? readyLong : forecastSide < 0 ? readyShort : false;
  const liveArmed = forecastSide > 0 ? candidateLong !== "NONE" : forecastSide < 0 ? candidateShort !== "NONE" : false;
  const forecastCompanionStatus = forecastSide > 0 ? longCompanion : forecastSide < 0 ? shortCompanion : companionActive ? "NEUTRAL" : "OFF";
  const companionConfidenceAdj = forecastCompanionStatus === "VETO" ? -10 : forecastCompanionStatus === "CONFIRM" ? 4 : forecastCompanionStatus === "OPPOSITE" ? -4 : 0;
  const forecastConfidence = clamp(38 + Math.abs(forecastScore) * .34 + qualityScore * 2.15 + (liveReady ? 7 : liveArmed ? 3 : 0) + (liveScore >= 9 ? 5 : liveScore >= 7 ? 3 : 0) + companionConfidenceAdj - (chop > 60 ? 8 : 0), 5, 95);
  const forecastValid = forecastDirection !== "NEUTRAL" && forecastConfidence >= 55;

  const bullLegRange = bullLegValid && bullLegHi && bullLegLo ? bullLegHi.value - bullLegLo.value : null;
  const bearLegRange = bearLegValid && bearLegHi && bearLegLo ? bearLegHi.value - bearLegLo.value : null;
  const bull127 = bullLegRange != null && bullLegLo ? bullLegLo.value + bullLegRange * 1.272 : null;
  const bull162 = bullLegRange != null && bullLegLo ? bullLegLo.value + bullLegRange * 1.618 : null;
  const bear127 = bearLegRange != null && bearLegHi ? bearLegHi.value - bearLegRange * 1.272 : null;
  const bear162 = bearLegRange != null && bearLegHi ? bearLegHi.value - bearLegRange * 1.618 : null;
  const t1Long = resistance1 != null && resistance1 > bar.close && resistance1 - bar.close >= den * .45 ? resistance1 : bull127 != null && bull127 > bar.close ? bull127 : bar.close + den * 1.8;
  const t1Short = support1 != null && support1 < bar.close && bar.close - support1 >= den * .45 ? support1 : bear127 != null && bear127 < bar.close ? bear127 : bar.close - den * 1.8;
  const t2Long = bull162 != null && bull162 > t1Long + den * .25 ? bull162 : Math.max(t1Long + den, bar.close + den * 3);
  const t2Short = bear162 != null && bear162 < t1Short - den * .25 ? bear162 : Math.min(t1Short - den, bar.close - den * 3);
  const longStructureInvalidation = lastPl?.value != null && lastPl.value < bar.close ? lastPl.value : null;
  const longEmaInvalidation = (ema50 as number) < bar.close ? (ema50 as number) - den * .2 : null;
  const shortStructureInvalidation = lastPh?.value != null && lastPh.value > bar.close ? lastPh.value : null;
  const shortEmaInvalidation = (ema50 as number) > bar.close ? (ema50 as number) + den * .2 : null;
  const longInvalidation = longStructureInvalidation != null && longEmaInvalidation != null ? Math.max(longStructureInvalidation, longEmaInvalidation) : longStructureInvalidation ?? longEmaInvalidation ?? bar.close - den * 1.5;
  const shortInvalidation = shortStructureInvalidation != null && shortEmaInvalidation != null ? Math.min(shortStructureInvalidation, shortEmaInvalidation) : shortStructureInvalidation ?? shortEmaInvalidation ?? bar.close + den * 1.5;
  const forecastTarget1 = forecastSide > 0 ? t1Long : forecastSide < 0 ? t1Short : null;
  const forecastTarget2 = forecastSide > 0 ? t2Long : forecastSide < 0 ? t2Short : null;
  const forecastInvalidation = forecastSide > 0 ? longInvalidation : forecastSide < 0 ? shortInvalidation : null;
  const forecastDriver = forecastSide > 0 ? (candidateLong !== "NONE" ? candidateLong : setupLong !== "NONE" ? setupLong : trendDirection > 0 ? "TREND" : "RECOVERY")
    : forecastSide < 0 ? (candidateShort !== "NONE" ? candidateShort : setupShort !== "NONE" ? setupShort : trendDirection < 0 ? "TREND" : "WEAKNESS") : "MIXED";

  const setupDirection = selectedLong || setupLong !== "NONE" && longScore > shortScore ? "LONG" : selectedShort || setupShort !== "NONE" && shortScore > longScore ? "SHORT" : "NONE";
  const setup = setupDirection === "LONG" ? setupLong : setupDirection === "SHORT" ? setupShort : candidateLong !== "NONE" && longScore >= shortScore ? candidateLong : candidateShort !== "NONE" ? candidateShort : "NONE";
  const setupState: SentinelSetupState = selectedLong || selectedShort ? "SIGNAL" : setupDirection === "LONG" ? readyLong ? "READY" : candidateLong !== "NONE" ? "ARMED" : "WAIT" : setupDirection === "SHORT" ? readyShort ? "READY" : candidateShort !== "NONE" ? "ARMED" : "WAIT" : readyLong || readyShort ? "READY" : candidateLong !== "NONE" || candidateShort !== "NONE" ? "ARMED" : "WAIT";
  const bestScore = setupDirection === "LONG" ? longScore : setupDirection === "SHORT" ? shortScore : Math.max(longScore, shortScore);

  const trigger = chochUp ? "CHOCH_UP" : chochDown ? "CHOCH_DOWN" : bosUp ? "BOS_UP" : bosDown ? "BOS_DOWN" : sweepLow ? "SSL_SWEEP_RECLAIM" : sweepHigh ? "BSL_SWEEP_REJECT" : rsiRecoveryLong ? "RSI_SMA_BULL_SHIFT" : rsiRecoveryShort ? "RSI_SMA_BEAR_SHIFT" : hmaReclaimUp ? "HMA16_RECLAIM" : hmaReclaimDown ? "HMA16_LOSS" : "NONE";
  const rsiState = Math.abs((rsi as number) - (rsiSma as number)) < .15 ? "AT_SMA" : (rsi as number) > (rsiSma as number) ? "ABOVE_SMA" : "BELOW_SMA";
  const hma16State = Math.abs(hmaSlope) < .01 ? "FLAT" : hmaSlope > 0 ? "BULL" : "BEAR";
  const fastImpulse = clamp(((rsi as number) - (rsiSma as number)) * 4 + hmaSlope * 10);
  const momentumStrength = clamp(Math.max(longScore, shortScore) * 10, 0, 100);
  const score = Math.round(momentumStrength);
  const diagnostics = [
    macroAvailable ? "EMA200 macro context available" : "EMA200 macro context unavailable on this horizon; using EMA20/50 fallback",
    companionActive ? `MCDX companion active (${companionFlow.toFixed(1)}); Sentinel relative-volume booster disabled` : "MCDX companion unavailable/off; Sentinel may use relative volume",
    `Forecast ${forecastDirection} ${forecastConfidence.toFixed(0)}% · setup ${setup}/${setupState}`,
  ];

  return {
    version: "6.4",
    engine: "Sentinel X v6.4 · EMA Hybrid + MCDX Companion",
    status: macroAvailable ? "READY" : "FALLBACK",
    price: bar.close,
    score,
    longScore: Number(longScore.toFixed(2)),
    shortScore: Number(shortScore.toFixed(2)),
    grade: grade(bestScore),
    trend,
    trendLabel,
    trendDirection,
    structureBias,
    structure,
    structureState,
    coreState: trendLabel,
    direction: Number(degreesOfPower.toFixed(2)),
    degreesOfPower: Number(degreesOfPower.toFixed(2)),
    powerLabel: `Bear ${powerBar(degreesOfPower)} Bull`,
    energy: Math.round(clamp(qualityScore * 10, 0, 100)),
    fastImpulse: Number(fastImpulse.toFixed(2)),
    momentumStrength: Number(momentumStrength.toFixed(2)),
    ema: { ema20: Number((ema20 as number).toFixed(4)), ema50: Number((ema50 as number).toFixed(4)), ema200: ema200 == null ? null : Number(ema200.toFixed(4)), macroAvailable },
    emaStack: bullStack ? "BULL" : bearStack ? "BEAR" : "MIXED",
    hma16: Number((hma16 as number).toFixed(4)),
    hma16State,
    rsi: Number((rsi as number).toFixed(2)),
    rsiSma: Number((rsiSma as number).toFixed(2)),
    rsiState,
    adx: Number((adx as number).toFixed(2)),
    plusDi: Number((plusDi as number).toFixed(2)),
    minusDi: Number((minusDi as number).toFixed(2)),
    chop: Number(chop.toFixed(2)),
    qualityScore: Number(qualityScore.toFixed(2)),
    qualityLabel,
    regime,
    trigger,
    setup,
    setupDirection,
    setupState,
    setupGrade: grade(bestScore),
    levels: {
      support1,
      resistance1,
      roomLongAtr: Number(roomLongAtr.toFixed(2)),
      roomShortAtr: Number(roomShortAtr.toFixed(2)),
      location,
      fib38,
      fib50,
      fib62,
    },
    forecast: {
      direction: forecastDirection,
      score: Number(forecastScore.toFixed(2)),
      confidence: Math.round(forecastConfidence),
      valid: forecastValid,
      driver: forecastDriver,
      target1: forecastTarget1 == null ? null : Number(forecastTarget1.toFixed(4)),
      target2: forecastTarget2 == null ? null : Number(forecastTarget2.toFixed(4)),
      invalidation: forecastInvalidation == null ? null : Number(forecastInvalidation.toFixed(4)),
    },
    companion: {
      active: companionActive,
      flowPower: Number(companionFlow.toFixed(2)),
      longStatus: longCompanion,
      shortStatus: shortCompanion,
      forecastStatus: forecastCompanionStatus,
      volumeBoosterDisabled: companionActive,
    },
    fallbackRisk: !macroAvailable,
    diagnostics,
  };
}
