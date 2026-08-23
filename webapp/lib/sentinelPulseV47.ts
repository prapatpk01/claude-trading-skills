import type { Candle } from "./types";

export type PulseBandState = "LOW RECLAIM" | "HIGH REJECT" | "LOW EXTREME" | "HIGH EXTREME" | "IN BAND";
export type PulseDriveState = "BULL DRIVE" | "BEAR DRIVE" | "NEUTRAL";
export type PulseContinuationState = "BULL CONT" | "BEAR CONT" | "NO CONT";

export interface SentinelPulseSnapshot {
  score: number;
  drive: number;
  flowLine: number;
  bbUpper: number;
  bbCenter: number;
  bbLower: number;
  bandPosition: number;
  bandState: PulseBandState;
  driveState: PulseDriveState;
  continuation: PulseContinuationState;
  state: string;
  acceleration: string;
  quality: number;
  /** Compatibility alias for older UI/forecast plumbing. */
  efficiency: number;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const signedClamp = (value: number) => clamp(value, -100, 100);
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value: number, digits = 0) => Number(value.toFixed(digits));

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  return out;
}

function rmaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 1 / period;
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  return out;
}

function rollingMean(values: number[], length: number, index: number): number {
  const start = Math.max(0, index - length + 1);
  return avg(values.slice(start, index + 1));
}

function rollingSum(values: number[], length: number, index: number): number {
  const start = Math.max(0, index - length + 1);
  let sum = 0;
  for (let i = start; i <= index; i++) sum += values[i] ?? 0;
  return sum;
}

function rollingStdev(values: number[], length: number, index: number): number {
  const start = Math.max(0, index - length + 1);
  const window = values.slice(start, index + 1);
  if (!window.length) return 0;
  const mean = avg(window);
  return Math.sqrt(window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length);
}

function atrSeries(candles: Candle[], period = 14): number[] {
  if (!candles.length) return [];
  const tr = candles.map((candle, index) => {
    if (index === 0) return Math.max(candle.high - candle.low, Number.EPSILON);
    const prevClose = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - prevClose), Math.abs(candle.low - prevClose));
  });
  return rmaSeries(tr, period);
}

function rsiSeries(closes: number[], period = 14): number[] {
  if (!closes.length) return [];
  const gains = closes.map((close, index) => index ? Math.max(close - closes[index - 1], 0) : 0);
  const losses = closes.map((close, index) => index ? Math.max(closes[index - 1] - close, 0) : 0);
  const avgGain = rmaSeries(gains, period);
  const avgLoss = rmaSeries(losses, period);
  return closes.map((_, index) => {
    if (avgLoss[index] <= Number.EPSILON) return avgGain[index] > 0 ? 100 : 50;
    const rs = avgGain[index] / avgLoss[index];
    return 100 - 100 / (1 + rs);
  });
}

function adxSeries(candles: Candle[], period = 14): number[] {
  if (!candles.length) return [];
  const tr: number[] = new Array(candles.length).fill(0);
  const plusDm: number[] = new Array(candles.length).fill(0);
  const minusDm: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const up = current.high - prev.high;
    const down = prev.low - current.low;
    tr[i] = Math.max(current.high - current.low, Math.abs(current.high - prev.close), Math.abs(current.low - prev.close));
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
  }
  const trRma = rmaSeries(tr, period);
  const plusRma = rmaSeries(plusDm, period);
  const minusRma = rmaSeries(minusDm, period);
  const dx = candles.map((_, index) => {
    const base = Math.max(trRma[index], Number.EPSILON);
    const plusDi = plusRma[index] / base * 100;
    const minusDi = minusRma[index] / base * 100;
    const sum = plusDi + minusDi;
    return sum > Number.EPSILON ? Math.abs(plusDi - minusDi) / sum * 100 : 0;
  });
  return rmaSeries(dx, period);
}

function neutralSnapshot(): SentinelPulseSnapshot {
  return {
    score: 50,
    drive: 0,
    flowLine: 0,
    bbUpper: 55,
    bbCenter: 50,
    bbLower: 45,
    bandPosition: 50,
    bandState: "IN BAND",
    driveState: "NEUTRAL",
    continuation: "NO CONT",
    state: "NEUTRAL",
    acceleration: "QUIET",
    quality: 0,
    efficiency: 0,
  };
}

/**
 * Sentinel X v4.7 Trend Memory Flow BB.
 * Direction: EMA20 + RSI + ROC. Quality: ADX + inverse CHOP.
 * Histogram: MACD directional/cycle + MFI + OBV, with RVOL as participation only.
 */
export function computeSentinelPulseV47(candles: Candle[]): SentinelPulseSnapshot {
  const clean = candles.filter(candle => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume));
  const n = clean.length;
  if (n < 35) return neutralSnapshot();

  const ROC_LEN = 5;
  const CHOP_LEN = 14;
  const PULSE_REACT = 2;
  const CONT_MIN_QUALITY = 34;
  const CONT_EMA_GRACE = 0.35;
  const CONT_DECAY = 0.34;
  const FLOW_CARRY = 0.42;
  const BB_CENTER_LEN = 8;
  const BB_DEV_LEN = 18;
  const BB_DEV_MULT = 1.30;
  const BB_VELOCITY_LEN = 8;
  const BB_VELOCITY_MULT = 2.20;
  const BB_MIN_WIDTH = 5.0;
  const BB_EXPAND = 0.78;
  const BB_CONTRACT = 0.14;
  const BB_BUFFER = 0.35;
  const MFI_LEN = 14;
  const OBV_LEN = 10;
  const FLOW_SMOOTH = 3;
  const HIST_SIGNAL = 6;
  const HIST_SMOOTH = 2;
  const HIST_NORM = 30;
  const NOISE_LEN = 24;
  const NOISE_MULT = 0.22;

  const closes = clean.map(candle => candle.close);
  const highs = clean.map(candle => candle.high);
  const lows = clean.map(candle => candle.low);
  const volumes = clean.map(candle => Math.max(0, candle.volume));
  const atr14 = atrSeries(clean, 14);
  const ema20 = emaSeries(closes, 20);
  const rsi14 = rsiSeries(closes, 14);
  const adx14 = adxSeries(clean, 14);

  const trueRange = clean.map((candle, index) => {
    if (!index) return Math.max(candle.high - candle.low, Number.EPSILON);
    return Math.max(candle.high - candle.low, Math.abs(candle.high - closes[index - 1]), Math.abs(candle.low - closes[index - 1]));
  });

  const directionCore = new Array<number>(n).fill(0);
  const trendQuality = new Array<number>(n).fill(0);
  const emaSlopeN = new Array<number>(n).fill(0);
  const rocMomentumN = new Array<number>(n).fill(0);

  for (let i = 0; i < n; i++) {
    const den = Math.max(atr14[i] ?? 0, Number.EPSILON);
    const emaLocationN = signedClamp((closes[i] - ema20[i]) / den * 38);
    emaSlopeN[i] = i >= 3 ? signedClamp((ema20[i] - ema20[i - 3]) / den * 48) : 0;
    const emaMomentumN = signedClamp(emaLocationN * 0.64 + emaSlopeN[i] * 0.36);
    const rsiMomentumN = signedClamp((rsi14[i] - 50) * 2);
    const rocPct = i >= ROC_LEN && closes[i - ROC_LEN] > 0 ? (closes[i] / closes[i - ROC_LEN] - 1) * 100 : 0;
    const atrPct = closes[i] > 0 ? den / closes[i] * 100 : 0;
    const rocScale = Math.max(atrPct * Math.sqrt(ROC_LEN), 0.25);
    rocMomentumN[i] = signedClamp(rocPct / rocScale * 58);
    directionCore[i] = signedClamp(emaMomentumN * 0.40 + rsiMomentumN * 0.35 + rocMomentumN[i] * 0.25);

    const trSum = rollingSum(trueRange, CHOP_LEN, i);
    const start = Math.max(0, i - CHOP_LEN + 1);
    let hh = highs[start];
    let ll = lows[start];
    for (let j = start + 1; j <= i; j++) {
      hh = Math.max(hh, highs[j]);
      ll = Math.min(ll, lows[j]);
    }
    const chopRange = Math.max(hh - ll, Number.EPSILON);
    const chop = i >= CHOP_LEN - 1 && trSum > 0
      ? clamp(100 * Math.log(trSum / chopRange) / Math.log(CHOP_LEN), 0, 100)
      : 50;
    const adxQuality = clamp((adx14[i] - 12) / 23 * 100);
    const chopQuality = clamp((62 - chop) / 24 * 100);
    trendQuality[i] = clamp(adxQuality * 0.55 + chopQuality * 0.45);
  }

  const continuation = new Array<number>(n).fill(0);
  let contState = 0;
  for (let i = 0; i < n; i++) {
    const atrNow = Math.max(atr14[i], Number.EPSILON);
    const bullSeed = emaSlopeN[i] > 0 && closes[i] >= ema20[i] - atrNow * CONT_EMA_GRACE && rsi14[i] >= 49 && trendQuality[i] >= CONT_MIN_QUALITY && directionCore[i] >= 8;
    const bearSeed = emaSlopeN[i] < 0 && closes[i] <= ema20[i] + atrNow * CONT_EMA_GRACE && rsi14[i] <= 51 && trendQuality[i] >= CONT_MIN_QUALITY && directionCore[i] <= -8;
    const bullInvalid = closes[i] < ema20[i] - atrNow * 0.70 || rsi14[i] < 44 || (rocMomentumN[i] < -58 && directionCore[i] < -24) || emaSlopeN[i] < -24;
    const bearInvalid = closes[i] > ema20[i] + atrNow * 0.70 || rsi14[i] > 56 || (rocMomentumN[i] > 58 && directionCore[i] > 24) || emaSlopeN[i] > 24;
    if (contState === 1 && bullInvalid) contState = 0;
    else if (contState === -1 && bearInvalid) contState = 0;
    if (contState === 0) {
      if (bullSeed) contState = 1;
      else if (bearSeed) contState = -1;
    }
    continuation[i] = contState;
  }

  const pulseRaw = new Array<number>(n).fill(50);
  const pulseScore = new Array<number>(n).fill(50);
  const baseAlpha = PULSE_REACT <= 1 ? 1 : 2 / (PULSE_REACT + 1);
  for (let i = 0; i < n; i++) {
    const q = trendQuality[i] / 100;
    const qualityBase = 0.18 + 0.82 * Math.pow(q, 1.20);
    const continuationFloor = 0.44 + q * 0.20;
    const qualityMultiplier = continuation[i] !== 0 ? Math.max(qualityBase, continuationFloor) : qualityBase;
    pulseRaw[i] = clamp(50 + signedClamp(directionCore[i] * qualityMultiplier) * 0.5);
    const prev = i ? pulseScore[i - 1] : pulseRaw[i];
    let alpha = baseAlpha;
    const atrNow = Math.max(atr14[i], Number.EPSILON);
    const bullInvalid = closes[i] < ema20[i] - atrNow * 0.70 || rsi14[i] < 44 || (rocMomentumN[i] < -58 && directionCore[i] < -24) || emaSlopeN[i] < -24;
    const bearInvalid = closes[i] > ema20[i] + atrNow * 0.70 || rsi14[i] > 56 || (rocMomentumN[i] > 58 && directionCore[i] > 24) || emaSlopeN[i] > 24;
    const bullPause = continuation[i] === 1 && pulseRaw[i] < prev && !bullInvalid && pulseRaw[i] >= 43;
    const bearPause = continuation[i] === -1 && pulseRaw[i] > prev && !bearInvalid && pulseRaw[i] <= 57;
    if (bullPause || bearPause) alpha *= CONT_DECAY;
    pulseScore[i] = clamp(prev + alpha * (pulseRaw[i] - prev));
  }

  const pulseSlope = pulseScore.map((value, i) => i ? value - pulseScore[i - 1] : 0);
  const pulseSlopeSm = emaSeries(pulseSlope, 2);
  const bbBasis = emaSeries(pulseScore, BB_CENTER_LEN);
  const scoreVelocity = emaSeries(pulseScore.map((value, i) => i ? Math.abs(value - pulseScore[i - 1]) : 0), BB_VELOCITY_LEN);
  const bbWidth = new Array<number>(n).fill(BB_MIN_WIDTH);
  const bbUpper = new Array<number>(n).fill(55);
  const bbLower = new Array<number>(n).fill(45);
  const bbPosition = new Array<number>(n).fill(0.5);
  let coreWidth = BB_MIN_WIDTH;
  for (let i = 0; i < n; i++) {
    const statWidth = rollingStdev(pulseScore, BB_DEV_LEN, i) * BB_DEV_MULT;
    const velocityWidth = scoreVelocity[i] * BB_VELOCITY_MULT;
    const target = Math.max(BB_MIN_WIDTH, statWidth + velocityWidth);
    coreWidth = target > coreWidth
      ? coreWidth * (1 - BB_EXPAND) + target * BB_EXPAND
      : coreWidth * (1 - BB_CONTRACT) + target * BB_CONTRACT;
    const liveReserve = Math.abs(pulseScore[i] - bbBasis[i]) + BB_BUFFER;
    bbWidth[i] = Math.max(coreWidth, liveReserve);
    bbUpper[i] = clamp(bbBasis[i] + bbWidth[i]);
    bbLower[i] = clamp(bbBasis[i] - bbWidth[i]);
    const span = Math.max(bbUpper[i] - bbLower[i], 0.001);
    bbPosition[i] = clamp((pulseScore[i] - bbLower[i]) / span, 0, 1);
  }

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const macdSignal = emaSeries(macdLine, 9);
  const macdHist = macdLine.map((value, i) => value - macdSignal[i]);

  const typical = clean.map(candle => (candle.high + candle.low + candle.close) / 3);
  const money = typical.map((value, i) => value * volumes[i]);
  const mfiPos = money.map((value, i) => i && typical[i] > typical[i - 1] ? value : 0);
  const mfiNeg = money.map((value, i) => i && typical[i] < typical[i - 1] ? value : 0);
  const mfiValue = new Array<number>(n).fill(50);
  for (let i = 0; i < n; i++) {
    const pos = rollingSum(mfiPos, MFI_LEN, i);
    const neg = rollingSum(mfiNeg, MFI_LEN, i);
    mfiValue[i] = neg > 0 ? 100 - 100 / (1 + pos / neg) : pos > 0 ? 100 : 50;
  }

  const obv = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) obv[i] = obv[i - 1] + (closes[i] > closes[i - 1] ? volumes[i] : closes[i] < closes[i - 1] ? -volumes[i] : 0);
  const volMa20 = volumes.map((_, i) => rollingMean(volumes, 20, i));
  const flowRaw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const den = Math.max(atr14[i], Number.EPSILON);
    const macdBiasN = signedClamp(macdLine[i] / den * 92);
    const macdCycleN = signedClamp(macdHist[i] / den * 180);
    const mfiFlowN = signedClamp((mfiValue[i] - 50) * 2);
    const obvBaseVolume = Math.max(rollingMean(volumes, OBV_LEN, i) * OBV_LEN, 1);
    const obvFlowN = i >= OBV_LEN ? signedClamp((obv[i] - obv[i - OBV_LEN]) / obvBaseVolume * 100) : 0;
    flowRaw[i] = signedClamp(macdBiasN * 0.30 + macdCycleN * 0.20 + mfiFlowN * 0.25 + obvFlowN * 0.25);
  }

  const flowParticipation = flowRaw.map((value, i) => {
    const rvol = volMa20[i] > 0 ? volumes[i] / volMa20[i] : 1;
    const multiplier = clamp(0.75 + rvol * 0.25, 0.85, 1.30);
    return signedClamp(value * multiplier);
  });
  const flowLine = emaSeries(flowParticipation, FLOW_SMOOTH);
  const flowSignal = emaSeries(flowLine, HIST_SIGNAL);
  const cycleBase = flowLine.map((value, i) => value - flowSignal[i]);
  const histMixRaw = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const sigma = Math.max(rollingStdev(cycleBase, HIST_NORM, i), 0.25);
    const cycleNorm = clamp(cycleBase[i] / sigma * 10, -30, 30);
    const levelNorm = clamp(flowLine[i] * 0.28, -24, 24);
    const activeCarry = continuation[i] !== 0 ? FLOW_CARRY : Math.max(0.24, FLOW_CARRY - 0.14);
    histMixRaw[i] = clamp(cycleNorm * (1 - activeCarry) + levelNorm * activeCarry, -30, 30);
  }
  const driveCore = emaSeries(histMixRaw, HIST_SMOOTH);
  const noiseFloor = driveCore.map((_, i) => Math.max(1.8, rollingStdev(driveCore, NOISE_LEN, i) * NOISE_MULT));
  const drive = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const enter = noiseFloor[i];
    const levelNorm = clamp(flowLine[i] * 0.28, -24, 24);
    const contFloor = clamp(Math.abs(levelNorm) * 0.16, 0.8, 3.6);
    drive[i] = driveCore[i];
    if (continuation[i] === 1 && flowLine[i] > 0 && driveCore[i] < contFloor && driveCore[i] > -enter * 1.35) drive[i] = contFloor;
    else if (continuation[i] === -1 && flowLine[i] < 0 && driveCore[i] > -contFloor && driveCore[i] < enter * 1.35) drive[i] = -contFloor;
  }

  const driveStates = new Array<number>(n).fill(0);
  let driveState = 0;
  for (let i = 0; i < n; i++) {
    const enter = noiseFloor[i];
    const release = noiseFloor[i] * 0.42;
    const bullSeed = driveCore[i] > enter && flowLine[i] > 0 && (continuation[i] === 1 || pulseScore[i] >= bbBasis[i]);
    const bearSeed = driveCore[i] < -enter && flowLine[i] < 0 && (continuation[i] === -1 || pulseScore[i] <= bbBasis[i]);
    if (driveState === 1) {
      const hardBear = driveCore[i] < -enter && flowLine[i] < 0 && (continuation[i] === -1 || continuation[i] === 0);
      const releaseBull = continuation[i] !== 1 && driveCore[i] < -release && flowLine[i] <= 0;
      if (hardBear) driveState = -1;
      else if (releaseBull) driveState = 0;
    } else if (driveState === -1) {
      const hardBull = driveCore[i] > enter && flowLine[i] > 0 && (continuation[i] === 1 || continuation[i] === 0);
      const releaseBear = continuation[i] !== -1 && driveCore[i] > release && flowLine[i] >= 0;
      if (hardBull) driveState = 1;
      else if (releaseBear) driveState = 0;
    } else if (bullSeed) driveState = 1;
    else if (bearSeed) driveState = -1;
    driveStates[i] = driveState;
  }

  const last = n - 1;
  const prev = Math.max(0, last - 1);
  const lowTouch = bbPosition[last] <= 0.07;
  const highTouch = bbPosition[last] >= 0.93;
  const lowReclaim = bbPosition[last] > 0.14 && bbPosition[prev] <= 0.07 && pulseSlopeSm[last] > 0;
  const highReject = bbPosition[last] < 0.86 && bbPosition[prev] >= 0.93 && pulseSlopeSm[last] < 0;
  const bandState: PulseBandState = lowReclaim ? "LOW RECLAIM" : highReject ? "HIGH REJECT" : lowTouch ? "LOW EXTREME" : highTouch ? "HIGH EXTREME" : "IN BAND";
  const continuationState: PulseContinuationState = continuation[last] === 1 ? "BULL CONT" : continuation[last] === -1 ? "BEAR CONT" : "NO CONT";
  const currentDriveState: PulseDriveState = driveStates[last] === 1 ? "BULL DRIVE" : driveStates[last] === -1 ? "BEAR DRIVE" : "NEUTRAL";
  const driveDelta = drive[last] - drive[prev];
  const release = noiseFloor[last] * 0.42;
  const bullCandidate = drive[last] > 0 && driveStates[last] !== 1;
  const bearCandidate = drive[last] < 0 && driveStates[last] !== -1;

  const state = lowReclaim ? "LOW RECLAIM"
    : highReject ? "HIGH REJECT"
    : lowTouch ? "LOW EXTREME"
    : highTouch ? "HIGH EXTREME"
    : continuation[last] === 1 ? (drive[last] >= -release ? "BULL CONT" : "BULL PAUSE")
    : continuation[last] === -1 ? (drive[last] <= release ? "BEAR CONT" : "BEAR PAUSE")
    : driveStates[last] === 1 ? (driveDelta >= 0 ? "BULL FLOW" : "BULL FADE")
    : driveStates[last] === -1 ? (driveDelta <= 0 ? "BEAR FLOW" : "BEAR FADE")
    : pulseScore[last] > bbBasis[last] && pulseSlopeSm[last] > 0 ? "RECOVERY"
    : pulseScore[last] < bbBasis[last] && pulseSlopeSm[last] < 0 ? "WEAKENING"
    : "NEUTRAL";

  const acceleration = continuation[last] === 1 && drive[last] < 0 && drive[last] > -noiseFloor[last] ? "PAUSE ↑"
    : continuation[last] === -1 && drive[last] > 0 && drive[last] < noiseFloor[last] ? "PAUSE ↓"
    : driveStates[last] === 1 && driveDelta > 0.7 ? "EXPAND ↑"
    : driveStates[last] === 1 && driveDelta < -0.7 ? "FADE ↓"
    : driveStates[last] === -1 && driveDelta < -0.7 ? "EXPAND ↓"
    : driveStates[last] === -1 && driveDelta > 0.7 ? "FADE ↑"
    : bullCandidate ? "BUILD ↑"
    : bearCandidate ? "BUILD ↓"
    : Math.abs(drive[last]) < noiseFloor[last] ? "QUIET" : "TURN";

  return {
    score: round(pulseScore[last], 1),
    drive: round(drive[last], 1),
    flowLine: round(flowLine[last], 1),
    bbUpper: round(bbUpper[last], 1),
    bbCenter: round(bbBasis[last], 1),
    bbLower: round(bbLower[last], 1),
    bandPosition: round(bbPosition[last] * 100, 0),
    bandState,
    driveState: currentDriveState,
    continuation: continuationState,
    state,
    acceleration,
    quality: round(trendQuality[last], 0),
    efficiency: round(trendQuality[last], 0),
  };
}
