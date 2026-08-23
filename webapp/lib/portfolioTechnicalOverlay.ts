import type { Candle } from "./types";
import { atr, mfi, obv } from "./indicators";
import {
  computeSentinelPulseV47,
  type PulseBandState,
  type PulseDriveState,
  type SentinelPulseSnapshot,
} from "./sentinelPulseV47";

export type PortfolioTechnicalAction = "ADD" | "HOLD" | "TRIM" | "EXIT REVIEW";
export type FlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type { PulseBandState, PulseDriveState, SentinelPulseSnapshot };

export interface PortfolioTechnicalOverlay {
  action: PortfolioTechnicalAction;
  confidence: number;
  reason: string;
  target1: number | null;
  target2: number | null;
  support1: number | null;
  roomAtr: number | null;
  sentinel: {
    version: "4.7";
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
    sentinelVersion: "4.7";
    mcdxSeparated: true;
  };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function weeklyCandles(candles: Candle[]): Candle[] {
  const weeks = new Map<string, Candle>();
  for (const candle of candles) {
    const date = new Date(`${candle.date}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const key = date.toISOString().slice(0, 10);
    const existing = weeks.get(key);
    if (!existing) weeks.set(key, { ...candle, date: key });
    else weeks.set(key, {
      date: key,
      open: existing.open,
      high: Math.max(existing.high, candle.high),
      low: Math.min(existing.low, candle.low),
      close: candle.close,
      volume: existing.volume + candle.volume,
    });
  }
  return [...weeks.values()];
}

function recentLevels(candles: Candle[], price: number) {
  const recent = candles.slice(-80);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const bar = recent[i];
    if (bar.high >= Math.max(...recent.slice(i - 2, i + 3).map(item => item.high))) highs.push(bar.high);
    if (bar.low <= Math.min(...recent.slice(i - 2, i + 3).map(item => item.low))) lows.push(bar.low);
  }
  return {
    resistances: [...new Set(highs.filter(level => level > price * 1.002).sort((a, b) => a - b))],
    supports: [...new Set(lows.filter(level => level < price * .998).sort((a, b) => b - a))],
  };
}

function rangePosition(candles: Candle[], period = 21): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 50;
  const low = Math.min(...slice.map(candle => candle.low));
  const high = Math.max(...slice.map(candle => candle.high));
  return high === low ? 50 : clamp(((slice.at(-1)!.close - low) / (high - low)) * 100);
}

function sentinelTrend(pulse: SentinelPulseSnapshot): "BULL" | "NEUTRAL" | "BEAR" {
  if (pulse.continuation === "BULL CONT") return "BULL";
  if (pulse.continuation === "BEAR CONT") return "BEAR";
  if (pulse.score >= 56 && pulse.flowLine >= 0 && pulse.driveState !== "BEAR DRIVE") return "BULL";
  if (pulse.score <= 44 && pulse.flowLine <= 0 && pulse.driveState !== "BULL DRIVE") return "BEAR";
  return "NEUTRAL";
}

/**
 * Portfolio technical overlay: Sentinel X v4.7 + MCDX confirmation layer.
 * Sentinel and MCDX remain separate engines. MCDX never changes the Sentinel score;
 * the decision layer uses MCDX only to confirm or veto ADD/TRIM/EXIT-review timing.
 */
export function computePortfolioTechnicalOverlay(candles: Candle[]): PortfolioTechnicalOverlay | null {
  const clean = candles
    .filter(candle => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (clean.length < 220) return null;
  const weeks = weeklyCandles(clean);
  if (weeks.length < 50) return null;

  const pulse = computeSentinelPulseV47(clean);
  const weeklyPulse = computeSentinelPulseV47(weeks);
  const trend = sentinelTrend(weeklyPulse);
  const price = clean.at(-1)!.close;
  const volatility = atr(clean, 14);
  const levels = recentLevels(clean, price);
  const support1 = levels.supports[0] ?? (volatility ? price - 2.2 * volatility : null);
  const target1 = levels.resistances[0] ?? (volatility ? price + 2.2 * volatility : null);
  const target2 = levels.resistances[1] ?? (target1 != null && volatility ? target1 + 1.3 * volatility : null);
  const roomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;

  const previous = clean.slice(-20, -1);
  const structure: "BULL" | "NEUTRAL" | "BEAR" = price > Math.max(...previous.map(candle => candle.high))
    ? "BULL"
    : price < Math.min(...previous.map(candle => candle.low))
      ? "BEAR"
      : "NEUTRAL";

  // MCDX synthetic proxy is intentionally independent from Sentinel X v4.7.
  const recent = clean.slice(-21);
  const prior = clean.slice(-42, -21);
  const smartMoneyProxy = Math.round(rangePosition(clean));
  const priorProxy = Math.round(rangePosition(prior));
  const moneyFlow = mfi(clean, 14) ?? 50;
  const volumeTrend = obv(clean);
  const typicalVolume = avg(recent.map(candle => candle.volume));
  const upVolume = recent
    .filter((candle, index) => index > 0 && candle.close >= recent[index - 1].close)
    .reduce((sum, candle) => sum + candle.volume, 0);
  const downVolume = recent
    .filter((candle, index) => index > 0 && candle.close < recent[index - 1].close)
    .reduce((sum, candle) => sum + candle.volume, 0);
  const volumeBalance = upVolume + downVolume ? upVolume / (upVolume + downVolume) * 100 : 50;
  const relativeVolume = typicalVolume ? clamp(recent.at(-1)!.volume / typicalVolume * 50) : 50;
  const smartFlow = Math.round(clamp(
    smartMoneyProxy * .35 +
    moneyFlow * .25 +
    volumeBalance * .20 +
    (volumeTrend?.rising ? 70 : 30) * .15 +
    relativeVolume * .05,
  ));
  const accumulation = smartMoneyProxy >= 55 && smartMoneyProxy >= priorProxy && smartFlow >= 55 && Boolean(volumeTrend?.rising);
  const distribution = smartMoneyProxy <= 45 && smartMoneyProxy <= priorProxy && smartFlow <= 45 && !volumeTrend?.rising;
  const mcdxState: FlowState = accumulation ? "ACCUMULATION" : distribution ? "DISTRIBUTION" : "NEUTRAL";
  const contextScore = Math.round(clamp(
    smartMoneyProxy * .30 + smartFlow * .35 + moneyFlow * .15 + volumeBalance * .15 + relativeVolume * .05,
  ));

  const roomOkay = roomAtr == null || roomAtr >= 1;
  const weeklyPositive = trend === "BULL" && weeklyPulse.driveState !== "BEAR DRIVE" && weeklyPulse.flowLine >= -4;
  const weeklyNegative = trend === "BEAR" && weeklyPulse.driveState !== "BULL DRIVE" && weeklyPulse.flowLine <= 4;
  const dailyPositive = pulse.driveState === "BULL DRIVE"
    || (pulse.continuation === "BULL CONT" && pulse.drive > 0 && pulse.score >= pulse.bbCenter)
    || (pulse.bandState === "LOW RECLAIM" && pulse.drive >= 0);
  const dailyNegative = pulse.driveState === "BEAR DRIVE"
    || (pulse.continuation === "BEAR CONT" && pulse.drive < 0 && pulse.score <= pulse.bbCenter)
    || (pulse.bandState === "HIGH REJECT" && pulse.drive <= 0);
  const mcdxBullConfirm = mcdxState === "ACCUMULATION" || smartFlow >= 56 || contextScore >= 58;
  const mcdxBearConfirm = mcdxState === "DISTRIBUTION" || smartFlow <= 44 || contextScore <= 42;
  const mcdxBullVeto = mcdxState === "DISTRIBUTION" && smartFlow < 45;
  const mcdxBearVeto = mcdxState === "ACCUMULATION" && smartFlow > 55;

  let action: PortfolioTechnicalAction = "HOLD";
  let reason = `Sentinel X v4.7 ${pulse.state}: Momentum ${pulse.score}, Q ${pulse.quality}, Flow ${pulse.drive >= 0 ? "+" : ""}${pulse.drive}; MCDX ${mcdxState}.`;

  if (weeklyNegative && structure === "BEAR" && dailyNegative && mcdxBearConfirm && !mcdxBearVeto) {
    action = "EXIT REVIEW";
    reason = `Sentinel X v4.7 bearish continuation/flow and bearish structure are confirmed by MCDX ${mcdxState}. Fundamental/thesis approval remains mandatory before any exit.`;
  } else if (roomAtr != null && roomAtr < .65) {
    action = "TRIM";
    reason = `Sentinel X v4.7: only ${roomAtr.toFixed(2)} ATR remains to Target 1; upside room is compressed. MCDX is ${mcdxState}.`;
  } else if (pulse.bandState === "HIGH REJECT" && pulse.drive <= 0 && (mcdxBearConfirm || mcdxState !== "ACCUMULATION")) {
    action = "TRIM";
    reason = `Sentinel X v4.7: upper-BB rejection with weakening Flow is not being supported by accumulation; review a partial trim.`;
  } else if (weeklyPositive && structure !== "BEAR" && dailyPositive && roomOkay && pulse.bandState !== "HIGH EXTREME" && mcdxBullConfirm && !mcdxBullVeto) {
    action = "ADD";
    reason = pulse.bandState === "LOW RECLAIM"
      ? `Sentinel X v4.7 lower-BB reclaim with positive Flow inside a bullish continuation regime; MCDX confirms participation.`
      : `Sentinel X v4.7 bullish continuation/Flow aligns with MCDX participation and sufficient room to Target 1.`;
  } else if (weeklyPositive && dailyPositive && !mcdxBullConfirm) {
    reason = `Sentinel X v4.7 is bullish, but MCDX has not confirmed accumulation/participation yet; HOLD rather than chase.`;
  } else if (pulse.bandState === "LOW EXTREME") {
    reason = `Sentinel X v4.7 Momentum is at the lower BB extreme. Treat it as a buy-watch zone; wait for reclaim plus Flow/MCDX confirmation.`;
  } else if (pulse.bandState === "HIGH EXTREME") {
    reason = `Sentinel X v4.7 Momentum is at the upper BB extreme. Do not chase; positive continuation Flow is not an automatic sell.`;
  }

  const directionAligned = trend === "BULL" && pulse.continuation === "BULL CONT"
    || trend === "BEAR" && pulse.continuation === "BEAR CONT";
  const structureAgreement = trend === "BULL" && structure === "BULL" || trend === "BEAR" && structure === "BEAR" ? 9 : structure === "NEUTRAL" ? 4 : 0;
  const pulseEvidence = Math.min(14, Math.abs(pulse.drive) * .45);
  const qualityEvidence = Math.min(18, pulse.quality * .18);
  const weeklyEvidence = directionAligned ? 10 : weeklyPulse.score >= 55 || weeklyPulse.score <= 45 ? 6 : 3;
  const bandEvidence = pulse.bandState === "LOW RECLAIM" || pulse.bandState === "HIGH REJECT" ? 7 : pulse.bandState === "IN BAND" ? 4 : 5;
  const mcdxAgreement = (dailyPositive && mcdxBullConfirm) || (dailyNegative && mcdxBearConfirm) ? 12 : mcdxState === "NEUTRAL" ? 5 : 1;
  const confidence = Math.round(clamp(28 + pulseEvidence + qualityEvidence + weeklyEvidence + structureAgreement + bandEvidence + mcdxAgreement));

  return {
    action,
    confidence,
    reason,
    target1,
    target2: confidence >= 70 && trend === "BULL" && dailyPositive && mcdxBullConfirm ? target2 : null,
    support1,
    roomAtr: roomAtr == null ? null : Math.round(roomAtr * 100) / 100,
    sentinel: {
      version: "4.7",
      dailyScore: Math.round(pulse.score),
      weeklyScore: Math.round(weeklyPulse.score),
      trend,
      structure,
      pulse,
      weeklyPulse,
    },
    mcdx: { smartMoneyProxy, smartFlow, contextScore, state: mcdxState },
    policy: {
      timeframe: "WEEKLY DECISION · DAILY EXECUTION",
      requiresFundamentalExitGate: true,
      syntheticFlowProxy: true,
      sentinelVersion: "4.7",
      mcdxSeparated: true,
    },
  };
}
