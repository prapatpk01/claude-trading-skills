import type { Candle } from "./types";
import { atr } from "./indicators";
import {
  computeSentinelPulseV47,
  type PulseBandState,
  type PulseDriveState,
  type SentinelPulseSnapshot,
} from "./sentinelPulseV47";
import { computeSentinelX64, type SentinelX64Snapshot } from "./research/sentinelX64";
import { computeMcdxV40, type McdxFlowSignalV40, type McdxSponsorStateV40, type McdxV40Output } from "./research/mcdxV40";
import {
  buildUnifiedTechnicalDecisionV40,
  type UnifiedTechnicalAction,
  type UnifiedTechnicalDecisionV40,
} from "./research/unifiedTechnicalDecisionV40";

export type PortfolioTechnicalAction = UnifiedTechnicalAction;
export type FlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type { PulseBandState, PulseDriveState, SentinelPulseSnapshot };

export interface PortfolioTechnicalOverlay {
  /** Compatibility mirror for legacy Research evidence contracts. */
  action: any;
  confidence: number;
  reason: string;
  /** Long-only portfolio target anchors retained for Forecast V37 compatibility. */
  target1: number | null;
  target2: number | null;
  support1: number | null;
  roomAtr: number | null;
  decision: UnifiedTechnicalDecisionV40;
  sentinel: {
    version: "6.4";
    dailyScore: number;
    weeklyScore: number;
    trend: "BULL" | "NEUTRAL" | "BEAR";
    structure: "BULL" | "NEUTRAL" | "BEAR";
    structurePattern: SentinelX64Snapshot["structure"];
    coreState: string;
    direction: number;
    energy: number;
    fastImpulse: number;
    momentumStrength: number;
    rsi: number;
    rsiSma: number;
    rsiState: SentinelX64Snapshot["rsiState"];
    regime: SentinelX64Snapshot["regime"];
    trigger: string;
    hma16State: SentinelX64Snapshot["hma16State"];
    emaStack: SentinelX64Snapshot["emaStack"];
    degreesOfPower: number;
    powerLabel: string;
    qualityScore: number;
    qualityLabel: SentinelX64Snapshot["qualityLabel"];
    chop: number;
    setup: SentinelX64Snapshot["setup"];
    setupState: SentinelX64Snapshot["setupState"];
    setupDirection: SentinelX64Snapshot["setupDirection"];
    setupGrade: SentinelX64Snapshot["setupGrade"];
    forecast: SentinelX64Snapshot["forecast"];
    companion: SentinelX64Snapshot["companion"];
    levels: SentinelX64Snapshot["levels"];
    weekly: {
      trend: SentinelX64Snapshot["trend"];
      trendLabel: SentinelX64Snapshot["trendLabel"];
      degreesOfPower: number;
      powerLabel: string;
      qualityScore: number;
      qualityLabel: SentinelX64Snapshot["qualityLabel"];
      forecast: SentinelX64Snapshot["forecast"];
      companion: SentinelX64Snapshot["companion"];
      setup: SentinelX64Snapshot["setup"];
      setupState: SentinelX64Snapshot["setupState"];
      fallbackRisk: boolean;
    };
    /** Legacy Pulse remains diagnostics-only; it no longer votes on direction. */
    pulse: SentinelPulseSnapshot;
    weeklyPulse: SentinelPulseSnapshot;
  };
  mcdx: {
    version: "4.0";
    methodology: "HYBRID_PRICE_VOLUME_PROXY";
    smartMoneyProxy: number;
    hotMoneyProxy: number;
    retailProxy: number;
    smartFlow: number;
    flowScore: number;
    flowSignalValue: number;
    flowSignal: McdxFlowSignalV40;
    sponsor: McdxSponsorStateV40;
    contextScore: number;
    state: FlowState;
    longScore: number;
    shortScore: number;
    flowPower: number;
    flowDelta: number;
    flowAccel: number;
    flowState: McdxV40Output["flowState"];
    components: McdxV40Output["components"];
    liquidity: McdxV40Output["liquidity"];
    htf: McdxV40Output["htf"];
    verdict: McdxV40Output["verdict"];
    weeklyFlowPower: number | null;
    weeklyFlowState: McdxV40Output["flowState"] | null;
    weeklyVerdict: McdxV40Output["verdict"] | null;
  };
  policy: {
    version: "40.0";
    timeframe: "WEEKLY DECISION · DAILY EXECUTION";
    requiresFundamentalExitGate: true;
    syntheticFlowProxy: true;
    sentinelVersion: "6.4";
    mcdxVersion: "4.0";
    mcdxMethodology: "HYBRID_PRICE_VOLUME_PROXY";
    mcdxSeparated: true;
    unifiedDecision: true;
    companionArchitecture: true;
    sentinelOwnsDirection: true;
    mcdxOwnsConviction: true;
    volumeDoubleCountPrevented: true;
    pulseDiagnosticsOnly: true;
  };
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
  for (let i = 2; i < recent.length - 2; i += 1) {
    const bar = recent[i];
    if (bar.high >= Math.max(...recent.slice(i - 2, i + 3).map(item => item.high))) highs.push(bar.high);
    if (bar.low <= Math.min(...recent.slice(i - 2, i + 3).map(item => item.low))) lows.push(bar.low);
  }
  return {
    resistances: [...new Set(highs.filter(level => level > price * 1.002).sort((a, b) => a - b))],
    supports: [...new Set(lows.filter(level => level < price * .998).sort((a, b) => b - a))],
  };
}

/**
 * Fund technical overlay V40.
 *
 * Architecture:
 *   WEEKLY Sentinel X v6.4 = strategic price direction / forecast
 *   DAILY  Sentinel X v6.4 = execution timing / setup
 *   WEEKLY MCDX v4.0      = strategic participation conviction
 *   DAILY  MCDX v4.0      = execution participation + liquidity absorption
 *
 * MCDX never creates price direction. Sentinel receives MCDX Flow Power as a
 * companion input, which disables Sentinel's own relative-volume score booster.
 */
export function computePortfolioTechnicalOverlay(candles: Candle[]): PortfolioTechnicalOverlay | null {
  const clean = candles
    .filter(candle => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume) && candle.volume >= 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (clean.length < 220) return null;
  const weeks = weeklyCandles(clean);
  if (weeks.length < 50) return null;

  // The Pine script exposes 34/50/100 MCDX lookbacks. Weekly fund history is
  // intentionally run with the valid 34-bar profile so we do not fabricate a
  // higher timeframe or withhold the whole fund monitor solely for EMA200-like age.
  const weeklyMcdx = computeMcdxV40(weeks, { mcdxLength: 34, vfiLength: 20 });
  const dailyMcdx = computeMcdxV40(clean, { htfFlowPower: weeklyMcdx?.flowPower ?? null, mcdxLength: 50, vfiLength: 80 });
  if (!dailyMcdx) return null;

  const weeklySentinel = computeSentinelX64(weeks, { companionFlowPower: weeklyMcdx?.flowPower ?? null, useCompanion: Boolean(weeklyMcdx) });
  const dailySentinel = computeSentinelX64(clean, { companionFlowPower: dailyMcdx.flowPower, useCompanion: true });
  if (!weeklySentinel || !dailySentinel) return null;

  // Kept only so existing UI panels can continue rendering Pulse diagnostics.
  // V40 does not use Pulse to vote on trend/action because Sentinel X now owns it.
  const pulse = computeSentinelPulseV47(clean);
  const weeklyPulse = computeSentinelPulseV47(weeks);

  const price = clean.at(-1)!.close;
  const volatility = atr(clean, 14);
  const levels = recentLevels(clean, price);
  const support1 = dailySentinel.levels.support1 ?? levels.supports[0] ?? (volatility ? price - 2.2 * volatility : null);
  const target1 = dailySentinel.levels.resistance1 ?? levels.resistances[0] ?? (volatility ? price + 2.2 * volatility : null);
  const target2 = levels.resistances.find(level => target1 != null && level > target1 * 1.002)
    ?? (target1 != null && volatility ? target1 + 1.3 * volatility : null);
  const rawRoomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;
  const roomAtr = rawRoomAtr == null ? null : Math.round(rawRoomAtr * 100) / 100;

  const decision = buildUnifiedTechnicalDecisionV40({
    roomAtr,
    weeklySentinel,
    dailySentinel,
    weeklyMcdx,
    dailyMcdx,
  });

  const confidence = decision.confidence;
  const reason = `V40 ${decision.trendLabel} · Flow ${decision.flowLabel} · Location ${decision.location}. ${decision.summary}`;
  const state: FlowState = dailyMcdx.state;

  return {
    action: decision.action,
    confidence,
    reason,
    // Keep these long-only portfolio anchors stable for Momentum Forecast V37.
    // Directional bearish/bullish projections live under sentinel.forecast.
    target1,
    target2: confidence >= 70 && decision.direction === "BULL" && dailySentinel.forecast.direction === "BULLISH" && decision.dailyCompanionStatus !== "VETO" ? target2 : null,
    support1,
    roomAtr,
    decision,
    sentinel: {
      version: "6.4",
      dailyScore: dailySentinel.score,
      weeklyScore: weeklySentinel.score,
      trend: weeklySentinel.trend,
      structure: dailySentinel.structureBias,
      structurePattern: dailySentinel.structure,
      coreState: weeklySentinel.coreState,
      direction: dailySentinel.direction,
      energy: dailySentinel.energy,
      fastImpulse: dailySentinel.fastImpulse,
      momentumStrength: dailySentinel.momentumStrength,
      rsi: dailySentinel.rsi,
      rsiSma: dailySentinel.rsiSma,
      rsiState: dailySentinel.rsiState,
      regime: dailySentinel.regime,
      trigger: dailySentinel.trigger,
      hma16State: dailySentinel.hma16State,
      emaStack: dailySentinel.emaStack,
      degreesOfPower: dailySentinel.degreesOfPower,
      powerLabel: dailySentinel.powerLabel,
      qualityScore: dailySentinel.qualityScore,
      qualityLabel: dailySentinel.qualityLabel,
      chop: dailySentinel.chop,
      setup: dailySentinel.setup,
      setupState: dailySentinel.setupState,
      setupDirection: dailySentinel.setupDirection,
      setupGrade: dailySentinel.setupGrade,
      forecast: dailySentinel.forecast,
      companion: dailySentinel.companion,
      levels: dailySentinel.levels,
      weekly: {
        trend: weeklySentinel.trend,
        trendLabel: weeklySentinel.trendLabel,
        degreesOfPower: weeklySentinel.degreesOfPower,
        powerLabel: weeklySentinel.powerLabel,
        qualityScore: weeklySentinel.qualityScore,
        qualityLabel: weeklySentinel.qualityLabel,
        forecast: weeklySentinel.forecast,
        companion: weeklySentinel.companion,
        setup: weeklySentinel.setup,
        setupState: weeklySentinel.setupState,
        fallbackRisk: weeklySentinel.fallbackRisk,
      },
      pulse,
      weeklyPulse,
    },
    mcdx: {
      version: "4.0",
      methodology: "HYBRID_PRICE_VOLUME_PROXY",
      smartMoneyProxy: dailyMcdx.smartMoneyProxy,
      hotMoneyProxy: dailyMcdx.hotMoneyProxy,
      retailProxy: dailyMcdx.retailProxy,
      smartFlow: dailyMcdx.smartFlow,
      flowScore: dailyMcdx.flowScore,
      flowSignalValue: dailyMcdx.flowSignalValue,
      flowSignal: dailyMcdx.flowSignal,
      sponsor: dailyMcdx.sponsor,
      contextScore: dailyMcdx.contextScore,
      state,
      longScore: dailyMcdx.longScore,
      shortScore: dailyMcdx.shortScore,
      flowPower: dailyMcdx.flowPower,
      flowDelta: dailyMcdx.flowDelta,
      flowAccel: dailyMcdx.flowAccel,
      flowState: dailyMcdx.flowState,
      components: dailyMcdx.components,
      liquidity: dailyMcdx.liquidity,
      htf: dailyMcdx.htf,
      verdict: dailyMcdx.verdict,
      weeklyFlowPower: weeklyMcdx?.flowPower ?? null,
      weeklyFlowState: weeklyMcdx?.flowState ?? null,
      weeklyVerdict: weeklyMcdx?.verdict ?? null,
    },
    policy: {
      version: "40.0",
      timeframe: "WEEKLY DECISION · DAILY EXECUTION",
      requiresFundamentalExitGate: true,
      syntheticFlowProxy: true,
      sentinelVersion: "6.4",
      mcdxVersion: "4.0",
      mcdxMethodology: "HYBRID_PRICE_VOLUME_PROXY",
      mcdxSeparated: true,
      unifiedDecision: true,
      companionArchitecture: true,
      sentinelOwnsDirection: true,
      mcdxOwnsConviction: true,
      volumeDoubleCountPrevented: true,
      pulseDiagnosticsOnly: true,
    },
  };
}
