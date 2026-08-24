import type { Candle } from "./types";
import { atr } from "./indicators";
import {
  computeSentinelPulseV47,
  type PulseBandState,
  type PulseDriveState,
  type SentinelPulseSnapshot,
} from "./sentinelPulseV47";
import { computeSentinelX562, type SentinelX562Snapshot } from "./research/sentinelX562";
import { computeMcdxV33, type McdxFlowSignal, type McdxSponsorState } from "./research/mcdxV33";

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
    version: "5.6.2";
    dailyScore: number;
    weeklyScore: number;
    trend: "BULL" | "NEUTRAL" | "BEAR";
    structure: "BULL" | "NEUTRAL" | "BEAR";
    structurePattern: SentinelX562Snapshot["structure"];
    coreState: SentinelX562Snapshot["coreState"];
    direction: number;
    energy: number;
    fastImpulse: number;
    momentumStrength: number;
    rsi: number;
    rsiSma: number;
    rsiState: SentinelX562Snapshot["rsiState"];
    regime: SentinelX562Snapshot["regime"];
    trigger: SentinelX562Snapshot["trigger"];
    hma16State: SentinelX562Snapshot["hma16State"];
    emaStack: SentinelX562Snapshot["emaStack"];
    pulse: SentinelPulseSnapshot;
    weeklyPulse: SentinelPulseSnapshot;
  };
  mcdx: {
    version: "3.3";
    methodology: "PRICE_VOLUME_PROXY";
    smartMoneyProxy: number;
    hotMoneyProxy: number;
    retailProxy: number;
    smartFlow: number;
    flowScore: number;
    flowSignalValue: number;
    flowSignal: McdxFlowSignal;
    sponsor: McdxSponsorState;
    contextScore: number;
    state: FlowState;
    longScore: number;
    shortScore: number;
  };
  policy: {
    timeframe: "WEEKLY DECISION · DAILY EXECUTION";
    requiresFundamentalExitGate: true;
    syntheticFlowProxy: true;
    sentinelVersion: "5.6.2";
    mcdxVersion: "3.3";
    mcdxMethodology: "PRICE_VOLUME_PROXY";
    mcdxSeparated: true;
  };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

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

function legacyWeeklyTrend(pulse: SentinelPulseSnapshot): "BULL" | "NEUTRAL" | "BEAR" {
  if (pulse.continuation === "BULL CONT") return "BULL";
  if (pulse.continuation === "BEAR CONT") return "BEAR";
  if (pulse.score >= 56 && pulse.flowLine >= 0 && pulse.driveState !== "BEAR DRIVE") return "BULL";
  if (pulse.score <= 44 && pulse.flowLine <= 0 && pulse.driveState !== "BULL DRIVE") return "BEAR";
  return "NEUTRAL";
}

const positiveTrigger = (trigger: SentinelX562Snapshot["trigger"]) => ["BOS_UP", "CHOCH_UP", "RSI_SMA_BULL_SHIFT", "RSI_LOW_RECLAIM", "HMA16_RECLAIM"].includes(trigger);
const negativeTrigger = (trigger: SentinelX562Snapshot["trigger"]) => ["BOS_DOWN", "CHOCH_DOWN", "RSI_SMA_BEAR_SHIFT", "RSI_HIGH_REJECT", "HMA16_LOSS"].includes(trigger);

/**
 * V33 portfolio technical overlay.
 * - Sentinel X v5.6.2 owns trend, momentum, RSI/SMA strength and structure.
 * - MCDX Sentinel v3.3 owns synthetic participation / sponsored-flow evidence.
 * - Legacy Pulse v4.7 is retained only as a compatibility BB/drive sub-signal
 *   for V26 Forecast; it no longer labels the user-facing Sentinel version.
 * - MCDX is PRICE_VOLUME_PROXY only, never an institutional-ownership claim.
 */
export function computePortfolioTechnicalOverlay(candles: Candle[]): PortfolioTechnicalOverlay | null {
  const clean = candles
    .filter(candle => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume))
    .sort((left, right) => left.date.localeCompare(right.date));
  if (clean.length < 220) return null;
  const weeks = weeklyCandles(clean);
  if (weeks.length < 50) return null;

  const sentinelX = computeSentinelX562(clean);
  const mcdx = computeMcdxV33(clean);
  if (!sentinelX || !mcdx) return null;
  const pulse = computeSentinelPulseV47(clean);
  const weeklyPulse = computeSentinelPulseV47(weeks);
  const weeklyTrend = legacyWeeklyTrend(weeklyPulse);
  const trend: "BULL" | "NEUTRAL" | "BEAR" = weeklyTrend === sentinelX.trend ? sentinelX.trend : sentinelX.trend === "NEUTRAL" ? weeklyTrend : weeklyTrend === "NEUTRAL" ? sentinelX.trend : "NEUTRAL";
  const structure: "BULL" | "NEUTRAL" | "BEAR" = sentinelX.structureBias;

  const price = clean.at(-1)!.close;
  const volatility = atr(clean, 14);
  const levels = recentLevels(clean, price);
  const support1 = levels.supports[0] ?? (volatility ? price - 2.2 * volatility : null);
  const target1 = levels.resistances[0] ?? (volatility ? price + 2.2 * volatility : null);
  const target2 = levels.resistances[1] ?? (target1 != null && volatility ? target1 + 1.3 * volatility : null);
  const roomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;

  const roomOkay = roomAtr == null || roomAtr >= 1;
  const weeklyPositive = (trend === "BULL" || weeklyPulse.score >= 58) && weeklyPulse.driveState !== "BEAR DRIVE";
  const weeklyNegative = (trend === "BEAR" || weeklyPulse.score <= 42) && weeklyPulse.driveState !== "BULL DRIVE";
  const dailyPositive = sentinelX.trend === "BULL"
    && sentinelX.direction >= 10
    && (positiveTrigger(sentinelX.trigger) || sentinelX.rsiState === "ABOVE_SMA" || pulse.driveState === "BULL DRIVE");
  const dailyNegative = sentinelX.trend === "BEAR"
    && sentinelX.direction <= -10
    && (negativeTrigger(sentinelX.trigger) || sentinelX.rsiState === "BELOW_SMA" || pulse.driveState === "BEAR DRIVE");

  const mcdxBullConfirm = mcdx.state === "ACCUMULATION" || mcdx.sponsor === "BULL_SPONSORED" || mcdx.flowSignal === "BUY_PRESSURE" && mcdx.contextScore >= 55;
  const mcdxBearConfirm = mcdx.state === "DISTRIBUTION" || mcdx.sponsor === "BEAR_SPONSORED" || mcdx.flowSignal === "SELL_PRESSURE" && mcdx.contextScore >= 55;
  const mcdxBullVeto = mcdx.state === "DISTRIBUTION" && mcdx.smartFlow < 45;
  const mcdxBearVeto = mcdx.state === "ACCUMULATION" && mcdx.smartFlow > 55;

  let action: PortfolioTechnicalAction = "HOLD";
  let reason = `Sentinel X v5.6.2 ${sentinelX.coreState}, RSI/SMA ${sentinelX.rsi.toFixed(1)}/${sentinelX.rsiSma.toFixed(1)}, strength ${sentinelX.momentumStrength}; MCDX v3.3 ${mcdx.state} (${mcdx.sponsor}).`;

  if (weeklyNegative && structure === "BEAR" && dailyNegative && mcdxBearConfirm && !mcdxBearVeto) {
    action = "EXIT REVIEW";
    reason = `Sentinel X v5.6.2 bearish trend/structure and ${sentinelX.trigger !== "NONE" ? sentinelX.trigger : "negative RSI/SMA state"} are confirmed by MCDX v3.3 ${mcdx.state}. Fundamental/thesis approval remains mandatory before any exit.`;
  } else if (roomAtr != null && roomAtr < .65) {
    action = "TRIM";
    reason = `Only ${roomAtr.toFixed(2)} ATR remains to Target 1; upside room is compressed. Sentinel X strength ${sentinelX.momentumStrength}/100; MCDX is ${mcdx.state}.`;
  } else if ((sentinelX.trigger === "RSI_HIGH_REJECT" || pulse.bandState === "HIGH REJECT") && sentinelX.fastImpulse <= 0 && !mcdxBullConfirm) {
    action = "TRIM";
    reason = `Sentinel X v5.6.2 momentum rejected from a high zone while Fast Impulse is weakening and MCDX v3.3 does not confirm sponsored accumulation; review a partial trim.`;
  } else if (weeklyPositive && structure !== "BEAR" && dailyPositive && roomOkay && pulse.bandState !== "HIGH EXTREME" && mcdxBullConfirm && !mcdxBullVeto) {
    action = "ADD";
    reason = positiveTrigger(sentinelX.trigger)
      ? `Sentinel X v5.6.2 ${sentinelX.trigger} aligns with weekly trend and MCDX v3.3 ${mcdx.sponsor}/${mcdx.flowSignal}; room to Target 1 remains adequate.`
      : `Sentinel X v5.6.2 bullish RSI/SMA + trend strength align with MCDX v3.3 participation and sufficient room to Target 1.`;
  } else if (weeklyPositive && dailyPositive && !mcdxBullConfirm) {
    reason = `Sentinel X v5.6.2 is bullish, but MCDX v3.3 has not confirmed sponsored participation yet; HOLD rather than chase.`;
  } else if (sentinelX.rsi <= 30 || pulse.bandState === "LOW EXTREME") {
    reason = `Sentinel X v5.6.2 is in a lower momentum zone. Treat it as buy-watch only; wait for RSI/SMA reclaim plus MCDX sponsored-flow confirmation.`;
  } else if (sentinelX.rsi >= 70 || pulse.bandState === "HIGH EXTREME") {
    reason = `Sentinel X v5.6.2 is in an upper momentum zone. Do not chase; strong momentum is not an automatic sell without weakening structure/flow.`;
  }

  const directionAgreement = trend === "BULL" && sentinelX.direction > 0 || trend === "BEAR" && sentinelX.direction < 0 ? 10 : trend === "NEUTRAL" ? 4 : 1;
  const structureAgreement = trend === "BULL" && structure === "BULL" || trend === "BEAR" && structure === "BEAR" ? 10 : structure === "NEUTRAL" ? 4 : 1;
  const strengthEvidence = Math.min(18, sentinelX.momentumStrength * .18);
  const energyEvidence = Math.min(12, sentinelX.energy * .12);
  const triggerEvidence = sentinelX.trigger !== "NONE" ? 8 : 3;
  const mcdxAgreement = (dailyPositive && mcdxBullConfirm) || (dailyNegative && mcdxBearConfirm) ? 14 : mcdx.state === "NEUTRAL" ? 5 : 2;
  const confidence = Math.round(clamp(28 + directionAgreement + structureAgreement + strengthEvidence + energyEvidence + triggerEvidence + mcdxAgreement));

  return {
    action,
    confidence,
    reason,
    target1,
    target2: confidence >= 70 && trend === "BULL" && dailyPositive && mcdxBullConfirm ? target2 : null,
    support1,
    roomAtr: roomAtr == null ? null : Math.round(roomAtr * 100) / 100,
    sentinel: {
      version: "5.6.2",
      dailyScore: sentinelX.score,
      weeklyScore: Math.round(weeklyPulse.score),
      trend,
      structure,
      structurePattern: sentinelX.structure,
      coreState: sentinelX.coreState,
      direction: sentinelX.direction,
      energy: sentinelX.energy,
      fastImpulse: sentinelX.fastImpulse,
      momentumStrength: sentinelX.momentumStrength,
      rsi: sentinelX.rsi,
      rsiSma: sentinelX.rsiSma,
      rsiState: sentinelX.rsiState,
      regime: sentinelX.regime,
      trigger: sentinelX.trigger,
      hma16State: sentinelX.hma16State,
      emaStack: sentinelX.emaStack,
      pulse,
      weeklyPulse,
    },
    mcdx: {
      version: "3.3",
      methodology: "PRICE_VOLUME_PROXY",
      smartMoneyProxy: mcdx.smartMoneyProxy,
      hotMoneyProxy: mcdx.hotMoneyProxy,
      retailProxy: mcdx.retailProxy,
      smartFlow: mcdx.smartFlow,
      flowScore: mcdx.flowScore,
      flowSignalValue: mcdx.flowSignalValue,
      flowSignal: mcdx.flowSignal,
      sponsor: mcdx.sponsor,
      contextScore: mcdx.contextScore,
      state: mcdx.state,
      longScore: mcdx.longScore,
      shortScore: mcdx.shortScore,
    },
    policy: {
      timeframe: "WEEKLY DECISION · DAILY EXECUTION",
      requiresFundamentalExitGate: true,
      syntheticFlowProxy: true,
      sentinelVersion: "5.6.2",
      mcdxVersion: "3.3",
      mcdxMethodology: "PRICE_VOLUME_PROXY",
      mcdxSeparated: true,
    },
  };
}
