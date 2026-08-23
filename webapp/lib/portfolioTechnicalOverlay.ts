import type { Candle } from "./types";
import { adx, atr, ema, mfi, obv, rsi } from "./indicators";

export type PortfolioTechnicalAction = "ADD" | "HOLD" | "TRIM" | "EXIT REVIEW";
export type FlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type PulseBandState = "LOW RECLAIM" | "HIGH REJECT" | "LOW EXTREME" | "HIGH EXTREME" | "IN BAND";
export type PulseDriveState = "BULL DRIVE" | "BEAR DRIVE" | "NEUTRAL";

export interface SentinelPulseSnapshot {
  score: number;
  drive: number;
  bbUpper: number;
  bbCenter: number;
  bbLower: number;
  bandState: PulseBandState;
  driveState: PulseDriveState;
  state: string;
  acceleration: string;
  efficiency: number;
}

export interface PortfolioTechnicalOverlay {
  action: PortfolioTechnicalAction;
  confidence: number;
  reason: string;
  target1: number | null;
  target2: number | null;
  support1: number | null;
  roomAtr: number | null;
  sentinel: {
    version: "4.3";
    dailyScore: number;
    weeklyScore: number;
    trend: "BULL" | "NEUTRAL" | "BEAR";
    structure: "BULL" | "NEUTRAL" | "BEAR";
    pulse: SentinelPulseSnapshot;
    weeklyPulse: SentinelPulseSnapshot;
  };
  mcdx: { smartMoneyProxy: number; smartFlow: number; contextScore: number; state: FlowState };
  policy: {
    timeframe: "WEEKLY DECISION · DAILY EXECUTION";
    requiresFundamentalExitGate: true;
    syntheticFlowProxy: true;
    sentinelVersion: "4.3";
    mcdxSeparated: true;
  };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const signedClamp = (value: number) => clamp(value, -100, 100);
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = (value: number, digits = 0) => Number(value.toFixed(digits));

function emaContinuous(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  return out;
}

function rmaContinuous(values: number[], period: number): number[] {
  if (!values.length) return [];
  const alpha = 1 / period;
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * alpha + out[i - 1] * (1 - alpha);
  return out;
}

function almaSeries(values: number[], length: number, offset = 0.85, sigma = 6): number[] {
  if (!values.length) return [];
  const out = new Array<number>(values.length);
  const m = offset * (length - 1);
  const s = length / sigma;
  for (let i = 0; i < values.length; i++) {
    if (i < length - 1) {
      out[i] = values[i];
      continue;
    }
    let weighted = 0;
    let weightSum = 0;
    for (let j = 0; j < length; j++) {
      const weight = Math.exp(-((j - m) ** 2) / (2 * s * s));
      weighted += values[i - length + 1 + j] * weight;
      weightSum += weight;
    }
    out[i] = weightSum > 0 ? weighted / weightSum : values[i];
  }
  return out;
}

function rollingMean(values: number[], length: number, index: number): number {
  const start = Math.max(0, index - length + 1);
  const window = values.slice(start, index + 1);
  return avg(window);
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
  return rmaContinuous(tr, period);
}

function weeklyCandles(candles: Candle[]): Candle[] {
  const weeks = new Map<string, Candle>();
  for (const candle of candles) {
    const date = new Date(`${candle.date}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const key = date.toISOString().slice(0, 10);
    const existing = weeks.get(key);
    if (!existing) weeks.set(key, { ...candle, date: key });
    else weeks.set(key, { date: key, open: existing.open, high: Math.max(existing.high, candle.high), low: Math.min(existing.low, candle.low), close: candle.close, volume: existing.volume + candle.volume });
  }
  return [...weeks.values()];
}

function recentLevels(candles: Candle[], price: number) {
  const recent = candles.slice(-80);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const bar = recent[i];
    if (bar.high >= Math.max(...recent.slice(i - 2, i + 3).map((item) => item.high))) highs.push(bar.high);
    if (bar.low <= Math.min(...recent.slice(i - 2, i + 3).map((item) => item.low))) lows.push(bar.low);
  }
  return {
    resistances: [...new Set(highs.filter((level) => level > price * 1.002).sort((a, b) => a - b))],
    supports: [...new Set(lows.filter((level) => level < price * .998).sort((a, b) => b - a))],
  };
}

function rangePosition(candles: Candle[], period = 21): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 50;
  const low = Math.min(...slice.map((candle) => candle.low));
  const high = Math.max(...slice.map((candle) => candle.high));
  return high === low ? 50 : clamp(((slice.at(-1)!.close - low) / (high - low)) * 100);
}

function macroTrendScore(candles: Candle[], weekly = false) {
  const closes = candles.map((candle) => candle.close);
  const price = closes.at(-1) ?? 0;
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const long = weekly ? null : ema(closes, 200);
  const momentum = rsi(closes, 14) ?? 50;
  let score = 0;
  score += fast != null && price > fast ? 25 : 0;
  score += fast != null && slow != null && fast > slow ? 25 : 0;
  score += long == null || slow == null || slow > long ? 15 : 0;
  score += momentum >= 52 && momentum <= 75 ? 20 : momentum > 75 ? 12 : 0;
  score += (adx(candles, 14) ?? 0) >= 20 ? 15 : 5;
  return { score: Math.round(clamp(score)), fast, price };
}

/** TypeScript port of Sentinel X v4.3 Pulse Drive BB lower-pane engine. */
function sentinelPulseV43(candles: Candle[]): SentinelPulseSnapshot {
  const closes = candles.map((candle) => candle.close);
  const n = closes.length;
  if (!n) {
    return { score: 50, drive: 0, bbUpper: 54, bbCenter: 50, bbLower: 46, bandState: "IN BAND", driveState: "NEUTRAL", state: "NEUTRAL", acceleration: "QUIET", efficiency: 0 };
  }

  const TSI_FAST = 5;
  const TSI_SLOW = 8;
  const PULSE_REACT = 3;
  const DRIVE_LEN = 3;
  const DRIVE_SMOOTH = 3;
  const ER_LEN = 10;
  const ATR_REGIME_LEN = 20;
  const NOISE_LEN = 20;
  const NOISE_MULT = 0.68;
  const MIN_EFFICIENCY = 0.18;
  const ENTER_MULT = 1.10;
  const BB_LEN = 18;
  const BB_MULT = 1.60;
  const BB_MIN_WIDTH = 4.0;

  const pc = closes.map((close, index) => index ? close - closes[index - 1] : 0);
  const pcAbs = pc.map(Math.abs);
  const tsiNum1 = emaContinuous(pc, TSI_FAST);
  const tsiNum2 = emaContinuous(tsiNum1, TSI_SLOW);
  const tsiDen1 = emaContinuous(pcAbs, TSI_FAST);
  const tsiDen2 = emaContinuous(tsiDen1, TSI_SLOW);
  const atr14 = atrSeries(candles, 14);

  const pulseRaw = closes.map((close, index) => {
    const tsi = tsiDen2[index] > Number.EPSILON ? 100 * tsiNum2[index] / tsiDen2[index] : 0;
    const den = Math.max(atr14[index] ?? 0, Number.EPSILON);
    const roc3Atr = index >= 3 ? signedClamp((close - closes[index - 3]) / den * 22) : 0;
    const signed = signedClamp(tsi * 0.82 + roc3Atr * 0.18);
    return clamp(50 + signed * 0.5);
  });
  const pulse = almaSeries(pulseRaw, PULSE_REACT, 0.85, 6);
  const pulseSlope = pulse.map((value, index) => index ? value - pulse[index - 1] : 0);

  const bbBasis = pulse.map((_, index) => rollingMean(pulse, BB_LEN, index));
  const bbDev = pulse.map((_, index) => rollingStdev(pulse, BB_LEN, index));
  const bbWidth = bbDev.map((value) => Math.max(BB_MIN_WIDTH, value * BB_MULT));
  const bbUpper = bbBasis.map((value, index) => clamp(value + bbWidth[index]));
  const bbLower = bbBasis.map((value, index) => clamp(value - bbWidth[index]));

  const efficiency = closes.map((close, index) => {
    if (index < ER_LEN) return 0;
    let path = 0;
    for (let j = index - ER_LEN + 1; j <= index; j++) path += Math.abs(closes[j] - closes[j - 1]);
    return path > Number.EPSILON ? clamp(Math.abs(close - closes[index - ER_LEN]) / path, 0, 1) : 0;
  });

  const atrRegimeRef = emaContinuous(atr14, ATR_REGIME_LEN);
  const pulseMove = pulse.map((value, index) => index >= DRIVE_LEN ? value - pulse[index - DRIVE_LEN] : 0);
  const priceDrive = closes.map((close, index) => {
    if (index < DRIVE_LEN) return 0;
    const den = Math.max(atr14[index] ?? 0, Number.EPSILON);
    return signedClamp((close - closes[index - DRIVE_LEN]) / den * 24);
  });
  const driveRaw = closes.map((_, index) => {
    const pulseDrive = signedClamp(pulseMove[index] * 4.2);
    const atrRatio = atrRegimeRef[index] > Number.EPSILON ? clamp(atr14[index] / atrRegimeRef[index], 0.70, 1.45) : 1;
    const qualityMult = clamp((0.62 + efficiency[index] * 0.62) * (0.82 + atrRatio * 0.18), 0.55, 1.45);
    return signedClamp((pulseDrive * 0.64 + priceDrive[index] * 0.36) * qualityMult);
  });
  const drive = almaSeries(driveRaw, DRIVE_SMOOTH, 0.85, 6);

  const noiseFloor = drive.map((_, index) => Math.max(4, rollingStdev(drive, NOISE_LEN, index) * NOISE_MULT));
  const enterFloor = noiseFloor.map((value) => value * ENTER_MULT);
  const driveStates = new Array<number>(n).fill(0);
  let driveState = 0;
  for (let i = 0; i < n; i++) {
    const bullQuality = drive[i] > enterFloor[i] && pulseMove[i] > 0 && priceDrive[i] > 0 && pulse[i] > bbBasis[i] && efficiency[i] >= MIN_EFFICIENCY;
    const bearQuality = drive[i] < -enterFloor[i] && pulseMove[i] < 0 && priceDrive[i] < 0 && pulse[i] < bbBasis[i] && efficiency[i] >= MIN_EFFICIENCY;
    if (driveState <= 0 && bullQuality) driveState = 1;
    else if (driveState >= 0 && bearQuality) driveState = -1;

    const releaseFloor = noiseFloor[i] * 0.38;
    const bullBreak = driveState === 1 && ((drive[i] < releaseFloor && pulseSlope[i] < 0) || (pulse[i] < bbBasis[i] && priceDrive[i] < 0));
    const bearBreak = driveState === -1 && ((drive[i] > -releaseFloor && pulseSlope[i] > 0) || (pulse[i] > bbBasis[i] && priceDrive[i] > 0));
    if (bullBreak || bearBreak) driveState = 0;
    driveStates[i] = driveState;
  }

  const last = n - 1;
  const prev = Math.max(0, last - 1);
  const lowTouch = pulse[last] <= bbLower[last];
  const highTouch = pulse[last] >= bbUpper[last];
  const lowReclaim = pulse[last] > bbLower[last] && pulse[prev] <= bbLower[prev] && pulseSlope[last] > 0;
  const highReject = pulse[last] < bbUpper[last] && pulse[prev] >= bbUpper[prev] && pulseSlope[last] < 0;
  const bandState: PulseBandState = lowReclaim ? "LOW RECLAIM" : highReject ? "HIGH REJECT" : lowTouch ? "LOW EXTREME" : highTouch ? "HIGH EXTREME" : "IN BAND";

  const currentDriveState: PulseDriveState = driveStates[last] === 1 ? "BULL DRIVE" : driveStates[last] === -1 ? "BEAR DRIVE" : "NEUTRAL";
  const driveDelta = drive[last] - drive[prev];
  const bullCandidate = driveStates[last] === 0 && drive[last] > noiseFloor[last] && pulseMove[last] > 0 && priceDrive[last] > 0;
  const bearCandidate = driveStates[last] === 0 && drive[last] < -noiseFloor[last] && pulseMove[last] < 0 && priceDrive[last] < 0;
  const acceleration = driveStates[last] === 1 && driveDelta > 1.2 ? "EXPAND ↑"
    : driveStates[last] === 1 && driveDelta < -1.2 ? "FADE ↓"
    : driveStates[last] === -1 && driveDelta < -1.2 ? "EXPAND ↓"
    : driveStates[last] === -1 && driveDelta > 1.2 ? "FADE ↑"
    : bullCandidate ? "BUILD ↑"
    : bearCandidate ? "BUILD ↓"
    : Math.abs(drive[last]) < noiseFloor[last] ? "QUIET" : "TURN";
  const state = lowReclaim ? "LOW RECLAIM"
    : highReject ? "HIGH REJECT"
    : lowTouch ? "LOW EXTREME"
    : highTouch ? "HIGH EXTREME"
    : driveStates[last] === 1 ? (driveDelta >= 0 ? "BULL DRIVE" : "BULL FADE")
    : driveStates[last] === -1 ? (driveDelta <= 0 ? "BEAR DRIVE" : "BEAR FADE")
    : pulse[last] > bbBasis[last] && pulseSlope[last] > 0 ? "RECOVERY"
    : pulse[last] < bbBasis[last] && pulseSlope[last] < 0 ? "WEAKENING"
    : "NEUTRAL";

  return {
    score: round(pulse[last], 1),
    drive: round(Math.abs(drive[last]) < noiseFloor[last] ? 0 : drive[last], 1),
    bbUpper: round(bbUpper[last], 1),
    bbCenter: round(bbBasis[last], 1),
    bbLower: round(bbLower[last], 1),
    bandState,
    driveState: currentDriveState,
    state,
    acceleration,
    efficiency: round(efficiency[last] * 100, 0),
  };
}

/**
 * Portfolio overlay upgraded to Sentinel X v4.3 Pulse Drive BB.
 * Sentinel and MCDX are intentionally independent: MCDX is displayed as a synthetic
 * price/volume flow proxy, but does not alter Sentinel Pulse, BB, Drive, action, or confidence.
 */
export function computePortfolioTechnicalOverlay(candles: Candle[]): PortfolioTechnicalOverlay | null {
  const clean = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume));
  if (clean.length < 220) return null;
  const weeks = weeklyCandles(clean);
  if (weeks.length < 50) return null;

  const weeklyMacro = macroTrendScore(weeks, true);
  const pulse = sentinelPulseV43(clean);
  const weeklyPulse = sentinelPulseV43(weeks);
  const price = clean.at(-1)!.close;
  const volatility = atr(clean, 14);
  const levels = recentLevels(clean, price);
  const support1 = levels.supports[0] ?? (volatility ? price - 2.2 * volatility : null);
  const target1 = levels.resistances[0] ?? (volatility ? price + 2.2 * volatility : null);
  const target2 = levels.resistances[1] ?? (target1 != null && volatility ? target1 + 1.3 * volatility : null);
  const roomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;

  const previous = clean.slice(-20, -1);
  const structure: "BULL" | "NEUTRAL" | "BEAR" = price > Math.max(...previous.map((candle) => candle.high)) ? "BULL" : price < Math.min(...previous.map((candle) => candle.low)) ? "BEAR" : "NEUTRAL";
  const trend: "BULL" | "NEUTRAL" | "BEAR" = weeklyMacro.score >= 65 ? "BULL" : weeklyMacro.score <= 35 ? "BEAR" : "NEUTRAL";

  const recent = clean.slice(-21);
  const prior = clean.slice(-42, -21);
  const smartMoneyProxy = Math.round(rangePosition(clean));
  const priorProxy = Math.round(rangePosition(prior));
  const moneyFlow = mfi(clean, 14) ?? 50;
  const volumeTrend = obv(clean);
  const typicalVolume = avg(recent.map((candle) => candle.volume));
  const upVolume = recent.filter((candle, index) => index > 0 && candle.close >= recent[index - 1].close).reduce((sum, candle) => sum + candle.volume, 0);
  const downVolume = recent.filter((candle, index) => index > 0 && candle.close < recent[index - 1].close).reduce((sum, candle) => sum + candle.volume, 0);
  const volumeBalance = upVolume + downVolume ? (upVolume / (upVolume + downVolume)) * 100 : 50;
  const relativeVolume = typicalVolume ? clamp((recent.at(-1)!.volume / typicalVolume) * 50) : 50;
  const smartFlow = Math.round(clamp(smartMoneyProxy * .35 + moneyFlow * .25 + volumeBalance * .20 + (volumeTrend?.rising ? 70 : 30) * .15 + relativeVolume * .05));
  const accumulation = smartMoneyProxy >= 55 && smartMoneyProxy >= priorProxy && smartFlow >= 55 && Boolean(volumeTrend?.rising);
  const distribution = smartMoneyProxy <= 45 && smartMoneyProxy <= priorProxy && smartFlow <= 45 && !volumeTrend?.rising;
  const state: FlowState = accumulation ? "ACCUMULATION" : distribution ? "DISTRIBUTION" : "NEUTRAL";
  const contextScore = Math.round(clamp(smartMoneyProxy * .30 + smartFlow * .35 + moneyFlow * .15 + volumeBalance * .15 + relativeVolume * .05));

  const roomOkay = roomAtr == null || roomAtr >= 1;
  const weeklyPositive = weeklyPulse.score >= weeklyPulse.bbCenter && weeklyPulse.driveState !== "BEAR DRIVE";
  const dailyPositive = pulse.driveState === "BULL DRIVE" || (pulse.bandState === "LOW RECLAIM" && pulse.drive > 0 && pulse.efficiency >= 18);
  const dailyNegative = pulse.driveState === "BEAR DRIVE" && pulse.drive < 0 && pulse.score < pulse.bbCenter;

  let action: PortfolioTechnicalAction = "HOLD";
  let reason = `Sentinel X v4.3: Pulse ${pulse.score}, ${pulse.bandState}, Drive ${pulse.drive >= 0 ? "+" : ""}${pulse.drive}; wait for a cleaner add/reduce setup.`;
  if (trend === "BEAR" && structure === "BEAR" && dailyNegative) {
    action = "EXIT REVIEW";
    reason = `Sentinel X v4.3: weekly downtrend, bearish structure and BEAR DRIVE agree. Fundamental/thesis approval is still required before any exit.`;
  } else if (roomAtr != null && roomAtr < .65) {
    action = "TRIM";
    reason = `Sentinel X v4.3: only ${roomAtr.toFixed(2)} ATR remains to Target 1; risk/reward is compressed even if momentum is still positive.`;
  } else if (pulse.bandState === "HIGH REJECT" && pulse.drive <= 0) {
    action = "TRIM";
    reason = `Sentinel X v4.3: Pulse rejected the upper BB and Drive is no longer positive; review a partial trim rather than chasing the extreme.`;
  } else if (trend === "BULL" && weeklyPositive && structure !== "BEAR" && dailyPositive && roomOkay && pulse.bandState !== "HIGH EXTREME") {
    action = "ADD";
    reason = pulse.bandState === "LOW RECLAIM"
      ? `Sentinel X v4.3: Pulse reclaimed the lower BB with improving Drive inside a bullish weekly regime; add setup is technically qualified.`
      : `Sentinel X v4.3: bullish weekly regime and validated BULL DRIVE align with sufficient room to Target 1.`;
  } else if (pulse.bandState === "LOW EXTREME") {
    reason = `Sentinel X v4.3: Pulse is at the lower BB extreme. Treat this as a buy-watch zone, not an automatic ADD; wait for reclaim/Drive confirmation.`;
  } else if (pulse.bandState === "HIGH EXTREME") {
    reason = `Sentinel X v4.3: Pulse is at the upper BB extreme. Momentum is stretched; do not chase, but strong positive Drive is not an automatic sell.`;
  }

  const structureAgreement = trend === "BULL" && structure === "BULL" || trend === "BEAR" && structure === "BEAR" ? 10 : structure === "NEUTRAL" ? 4 : 0;
  const pulseEvidence = Math.min(22, Math.abs(pulse.drive) * .22);
  const weeklyEvidence = weeklyPositive || (weeklyPulse.score < weeklyPulse.bbCenter && weeklyPulse.driveState !== "BULL DRIVE") ? 10 : 4;
  const bandEvidence = pulse.bandState === "LOW RECLAIM" || pulse.bandState === "HIGH REJECT" ? 8 : pulse.bandState === "IN BAND" ? 4 : 6;
  const confidence = Math.round(clamp(36 + pulse.efficiency * .18 + pulseEvidence + weeklyEvidence + structureAgreement + bandEvidence));

  return {
    action,
    confidence,
    reason,
    target1,
    target2: confidence >= 70 && trend === "BULL" && pulse.driveState === "BULL DRIVE" ? target2 : null,
    support1,
    roomAtr: roomAtr == null ? null : Math.round(roomAtr * 100) / 100,
    sentinel: {
      version: "4.3",
      dailyScore: Math.round(pulse.score),
      weeklyScore: Math.round(weeklyPulse.score),
      trend,
      structure,
      pulse,
      weeklyPulse,
    },
    mcdx: { smartMoneyProxy, smartFlow, contextScore, state },
    policy: {
      timeframe: "WEEKLY DECISION · DAILY EXECUTION",
      requiresFundamentalExitGate: true,
      syntheticFlowProxy: true,
      sentinelVersion: "4.3",
      mcdxSeparated: true,
    },
  };
}
