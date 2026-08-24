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
import {
  buildUnifiedTechnicalDecisionV34,
  type UnifiedTechnicalAction,
  type UnifiedTechnicalDecisionV34,
} from "./research/unifiedTechnicalDecisionV34";

export type PortfolioTechnicalAction = UnifiedTechnicalAction;
export type FlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type { PulseBandState, PulseDriveState, SentinelPulseSnapshot };

export interface PortfolioTechnicalOverlay {
  /** Compatibility mirror for legacy Research evidence contracts. The canonical
   * typed V34 action is decision.action and both values are identical at runtime. */
  action: any;
  confidence: number;
  reason: string;
  target1: number | null;
  target2: number | null;
  support1: number | null;
  roomAtr: number | null;
  decision: UnifiedTechnicalDecisionV34;
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
    version: "34.0";
    timeframe: "WEEKLY DECISION · DAILY EXECUTION";
    requiresFundamentalExitGate: true;
    syntheticFlowProxy: true;
    sentinelVersion: "5.6.2";
    mcdxVersion: "3.3";
    mcdxMethodology: "PRICE_VOLUME_PROXY";
    mcdxSeparated: true;
    unifiedDecision: true;
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
 * V34 unified technical overlay.
 * Sentinel X owns Trend; MCDX owns Flow; ATR room owns Location; one governed
 * policy combines those three layers into the same Action for Holdings,
 * Watchlist and CIO. Location alone never forces a trim.
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
  const rawRoomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;
  const roomAtr = rawRoomAtr == null ? null : Math.round(rawRoomAtr * 100) / 100;

  const dailyPositive = sentinelX.trend === "BULL"
    && sentinelX.direction >= 10
    && (positiveTrigger(sentinelX.trigger) || sentinelX.rsiState === "ABOVE_SMA" || pulse.driveState === "BULL DRIVE");
  const dailyNegative = sentinelX.trend === "BEAR"
    && sentinelX.direction <= -10
    && (negativeTrigger(sentinelX.trigger) || sentinelX.rsiState === "BELOW_SMA" || pulse.driveState === "BEAR DRIVE");
  const mcdxBullConfirm = mcdx.state === "ACCUMULATION" || mcdx.sponsor === "BULL_SPONSORED" || mcdx.flowSignal === "BUY_PRESSURE" && mcdx.contextScore >= 55;
  const mcdxBearConfirm = mcdx.state === "DISTRIBUTION" || mcdx.sponsor === "BEAR_SPONSORED" || mcdx.flowSignal === "SELL_PRESSURE" && mcdx.contextScore >= 55;

  const decision = buildUnifiedTechnicalDecisionV34({
    roomAtr,
    sentinel: {
      trend,
      coreState: sentinelX.coreState,
      momentumStrength: sentinelX.momentumStrength,
      structure,
      structurePattern: sentinelX.structure,
      regime: sentinelX.regime,
      trigger: sentinelX.trigger,
      rsiState: sentinelX.rsiState,
      fastImpulse: sentinelX.fastImpulse,
      hma16State: sentinelX.hma16State,
    },
    mcdx: {
      state: mcdx.state,
      sponsor: mcdx.sponsor,
      flowSignal: mcdx.flowSignal,
      contextScore: mcdx.contextScore,
      smartFlow: mcdx.smartFlow,
    },
  });

  const directionAgreement = trend === "BULL" && sentinelX.direction > 0 || trend === "BEAR" && sentinelX.direction < 0 ? 10 : trend === "NEUTRAL" ? 4 : 1;
  const structureAgreement = trend === "BULL" && structure === "BULL" || trend === "BEAR" && structure === "BEAR" ? 10 : structure === "NEUTRAL" ? 4 : 1;
  const strengthEvidence = Math.min(18, sentinelX.momentumStrength * .18);
  const energyEvidence = Math.min(12, sentinelX.energy * .12);
  const triggerEvidence = sentinelX.trigger !== "NONE" ? 8 : 3;
  const mcdxAgreement = (dailyPositive && mcdxBullConfirm) || (dailyNegative && mcdxBearConfirm) ? 14 : mcdx.state === "NEUTRAL" ? 5 : 2;
  const confidence = Math.round(clamp(28 + directionAgreement + structureAgreement + strengthEvidence + energyEvidence + triggerEvidence + mcdxAgreement));
  const reason = `V34 ${decision.trendLabel} · Flow ${decision.flowLabel} · Location ${decision.location}. ${decision.summary}`;

  return {
    action: decision.action,
    confidence,
    reason,
    target1,
    target2: confidence >= 70 && trend === "BULL" && dailyPositive && mcdxBullConfirm ? target2 : null,
    support1,
    roomAtr,
    decision,
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
      version: "34.0",
      timeframe: "WEEKLY DECISION · DAILY EXECUTION",
      requiresFundamentalExitGate: true,
      syntheticFlowProxy: true,
      sentinelVersion: "5.6.2",
      mcdxVersion: "3.3",
      mcdxMethodology: "PRICE_VOLUME_PROXY",
      mcdxSeparated: true,
      unifiedDecision: true,
    },
  };
}
