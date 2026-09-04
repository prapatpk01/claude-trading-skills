import type { McdxV40Output } from "./mcdxV40";
import type { SentinelX64Snapshot, SentinelCompanionStatus } from "./sentinelX64";

export type UnifiedTechnicalAction = "ADD" | "HOLD" | "PROFIT WATCH" | "TRIM REVIEW" | "EXIT REVIEW";
export type TechnicalLocation = "GOOD ROOM" | "NORMAL ROOM" | "EXTENDED" | "TARGET ZONE" | "UNKNOWN";
export type FundCompanionStatus = SentinelCompanionStatus;

export interface UnifiedTechnicalDecisionV40Input {
  roomAtr: number | null;
  weeklySentinel: SentinelX64Snapshot;
  dailySentinel: SentinelX64Snapshot;
  weeklyMcdx: McdxV40Output | null;
  dailyMcdx: McdxV40Output;
}

export interface UnifiedTechnicalDecisionV40 {
  version: "40.0";
  action: UnifiedTechnicalAction;
  location: TechnicalLocation;
  trendLabel: string;
  flowLabel: string;
  addEligible: boolean;
  reduceReview: boolean;
  direction: "BULL" | "NEUTRAL" | "BEAR";
  executionDirection: "BULL" | "NEUTRAL" | "BEAR";
  companionStatus: FundCompanionStatus;
  weeklyCompanionStatus: FundCompanionStatus;
  dailyCompanionStatus: FundCompanionStatus;
  confidence: number;
  positiveEvidence: string[];
  riskEvidence: string[];
  summary: string;
  policy: {
    sentinelOwnsDirection: true;
    mcdxOwnsConviction: true;
    mcdxNeverCreatesDirection: true;
    volumeDoubleCountPrevented: true;
    roomAloneNeverForcesTrim: true;
    requiresMultipleRiskEvidenceForTrim: true;
    exitRequiresFundamentalGate: true;
    samePolicyAcrossHoldingsWatchlistCio: true;
    automaticTrading: false;
  };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function technicalLocationV40(roomAtr: number | null): TechnicalLocation {
  if (roomAtr == null || !Number.isFinite(roomAtr)) return "UNKNOWN";
  if (roomAtr >= 1.5) return "GOOD ROOM";
  if (roomAtr >= 1) return "NORMAL ROOM";
  if (roomAtr >= .5) return "EXTENDED";
  return "TARGET ZONE";
}

function sideFromSentinel(sentinel: SentinelX64Snapshot): "BULL" | "NEUTRAL" | "BEAR" {
  if (sentinel.forecast.valid && sentinel.forecast.direction === "BULLISH") return "BULL";
  if (sentinel.forecast.valid && sentinel.forecast.direction === "BEARISH") return "BEAR";
  return sentinel.trend;
}

function flowStatusFor(side: "BULL" | "NEUTRAL" | "BEAR", mcdx: McdxV40Output): FundCompanionStatus {
  if (side === "NEUTRAL") return "NEUTRAL";
  if (side === "BULL") {
    if (mcdx.flowPower <= -45) return "VETO";
    if (mcdx.flowPower <= -25) return "OPPOSITE";
    if (mcdx.flowPower >= 25 && mcdx.flowDelta >= 0) return "CONFIRM";
    return "NEUTRAL";
  }
  if (mcdx.flowPower >= 45) return "VETO";
  if (mcdx.flowPower >= 25) return "OPPOSITE";
  if (mcdx.flowPower <= -25 && mcdx.flowDelta <= 0) return "CONFIRM";
  return "NEUTRAL";
}

function statusSeverity(status: FundCompanionStatus) {
  return status === "VETO" ? 3 : status === "OPPOSITE" ? 2 : status === "CONFIRM" ? 1 : 0;
}

/**
 * V40 fund decision policy.
 *
 * This is deliberately asymmetric: Sentinel X supplies direction/setup/forecast;
 * MCDX only changes conviction (confirm/neutral/opposite/veto). MCDX cannot create
 * a bullish/bearish direction by itself. Reviews are advisory fund actions and an
 * EXIT REVIEW still requires the separate thesis/fundamental exit gate.
 */
export function buildUnifiedTechnicalDecisionV40(input: UnifiedTechnicalDecisionV40Input): UnifiedTechnicalDecisionV40 {
  const { weeklySentinel, dailySentinel, weeklyMcdx, dailyMcdx } = input;
  const location = technicalLocationV40(input.roomAtr);
  const direction = sideFromSentinel(weeklySentinel);
  const executionDirection = sideFromSentinel(dailySentinel);
  const weeklyStatus: FundCompanionStatus = weeklyMcdx ? flowStatusFor(direction, weeklyMcdx) : "OFF";
  const dailyStatus = flowStatusFor(direction, dailyMcdx);
  const companionStatus = statusSeverity(weeklyStatus) >= statusSeverity(dailyStatus) ? weeklyStatus : dailyStatus;

  const positiveEvidence: string[] = [];
  const riskEvidence: string[] = [];
  if (direction === "BULL") positiveEvidence.push(`weekly Sentinel ${weeklySentinel.trendLabel}`);
  if (direction === "BEAR") riskEvidence.push(`weekly Sentinel ${weeklySentinel.trendLabel}`);
  if (weeklySentinel.structureBias === "BULL") positiveEvidence.push(`weekly structure ${weeklySentinel.structure}`);
  if (weeklySentinel.structureBias === "BEAR") riskEvidence.push(`weekly structure ${weeklySentinel.structure}`);
  if (executionDirection === "BULL") positiveEvidence.push(`daily timing ${dailySentinel.setup}/${dailySentinel.setupState}`);
  if (executionDirection === "BEAR") riskEvidence.push(`daily timing ${dailySentinel.setup}/${dailySentinel.setupState}`);
  if (dailySentinel.trigger !== "NONE" && dailySentinel.trigger.includes("UP")) positiveEvidence.push(`daily trigger ${dailySentinel.trigger}`);
  if (dailySentinel.trigger !== "NONE" && (dailySentinel.trigger.includes("DOWN") || dailySentinel.trigger.includes("LOSS") || dailySentinel.trigger.includes("REJECT"))) riskEvidence.push(`daily trigger ${dailySentinel.trigger}`);

  if (weeklyMcdx && weeklyStatus === "CONFIRM") positiveEvidence.push(`weekly MCDX confirms ${weeklyMcdx.flowPower.toFixed(1)}`);
  if (dailyStatus === "CONFIRM") positiveEvidence.push(`daily MCDX confirms ${dailyMcdx.flowPower.toFixed(1)}`);
  if (weeklyMcdx && weeklyStatus === "OPPOSITE") riskEvidence.push(`weekly MCDX opposite ${weeklyMcdx.flowPower.toFixed(1)}`);
  if (dailyStatus === "OPPOSITE") riskEvidence.push(`daily MCDX opposite ${dailyMcdx.flowPower.toFixed(1)}`);
  if (weeklyMcdx && weeklyStatus === "VETO") riskEvidence.push(`weekly MCDX VETO ${weeklyMcdx.flowPower.toFixed(1)}`);
  if (dailyStatus === "VETO") riskEvidence.push(`daily MCDX VETO ${dailyMcdx.flowPower.toFixed(1)}`);
  if (weeklyMcdx?.flowState.includes("DISTRIBUTION")) riskEvidence.push(`weekly flow ${weeklyMcdx.flowState}`);
  if (dailyMcdx.liquidity.bearAbsorption) riskEvidence.push("daily BSL absorption / supply response");
  if (dailyMcdx.liquidity.bullAbsorption) positiveEvidence.push("daily SSL absorption / demand response");
  if (weeklySentinel.regime === "RANGE" || dailySentinel.regime === "RANGE") riskEvidence.push("range/chop regime");

  const locationPressure = location === "EXTENDED" || location === "TARGET ZONE";
  const weeklyBull = direction === "BULL";
  const weeklyBear = direction === "BEAR";
  const dailyBull = executionDirection === "BULL";
  const dailyBear = executionDirection === "BEAR";
  const setupReady = dailySentinel.setupState === "READY" || dailySentinel.setupState === "SIGNAL";
  const flowSupportsBull = weeklyStatus !== "VETO" && weeklyStatus !== "OPPOSITE" && dailyStatus !== "VETO" && (weeklyStatus === "CONFIRM" || dailyStatus === "CONFIRM");
  const flowSupportsBear = weeklyBear && weeklyStatus === "CONFIRM" && (dailyStatus === "CONFIRM" || dailyMcdx.flowPower <= -18);

  const weeklyForecastConfidence = weeklySentinel.forecast.confidence;
  const dailyForecastConfidence = dailySentinel.forecast.confidence;
  let confidence = weeklyForecastConfidence * .52 + dailyForecastConfidence * .28 + Math.min(100, Math.abs(weeklySentinel.degreesOfPower)) * .10 + Math.min(100, Math.abs(weeklyMcdx?.flowPower ?? dailyMcdx.flowPower)) * .10;
  if (weeklyStatus === "CONFIRM") confidence += 4;
  if (dailyStatus === "CONFIRM") confidence += 2;
  if (weeklyStatus === "OPPOSITE") confidence -= 7;
  if (dailyStatus === "OPPOSITE") confidence -= 4;
  if (weeklyStatus === "VETO") confidence -= 14;
  if (dailyStatus === "VETO") confidence -= 8;
  confidence = Math.round(clamp(confidence, 5, 95));

  let action: UnifiedTechnicalAction = "HOLD";
  if (weeklyBear && dailyBear && flowSupportsBear && weeklySentinel.qualityScore >= 6 && dailySentinel.qualityScore >= 5 && riskEvidence.length >= 4 && confidence >= 65) {
    action = "EXIT REVIEW";
  } else if ((weeklyBear && (weeklyStatus === "CONFIRM" || dailyStatus === "CONFIRM") && riskEvidence.length >= 3)
    || (weeklyBear && dailyBear && riskEvidence.length >= 3)
    || (direction === "NEUTRAL" && dailyBear && dailyMcdx.flowPower <= -25 && riskEvidence.length >= 3)) {
    action = "TRIM REVIEW";
  } else if (weeklyBull && locationPressure && weeklyStatus !== "VETO" && dailyStatus !== "VETO" && riskEvidence.filter(item => !item.includes("range/chop")).length < 2) {
    action = "PROFIT WATCH";
  } else if (weeklyBull && dailyBull && setupReady && flowSupportsBull
    && (location === "GOOD ROOM" || location === "NORMAL ROOM")
    && dailySentinel.longScore >= 7 && weeklySentinel.qualityScore >= 5 && confidence >= 58) {
    action = "ADD";
  }

  // Strong opposite flow is a conviction veto, not an automatic sell. It blocks ADD.
  if (weeklyBull && (weeklyStatus === "VETO" || dailyStatus === "VETO") && action === "ADD") action = "HOLD";
  if (direction === "NEUTRAL" && action === "ADD") action = "HOLD";

  const flowLabel = `W ${weeklyMcdx ? weeklyMcdx.flowPower.toFixed(1) : "N/A"} ${weeklyStatus} · D ${dailyMcdx.flowPower.toFixed(1)} ${dailyStatus}`;
  const trendLabel = `W ${weeklySentinel.trendLabel} · D ${dailySentinel.trendLabel}`;
  const summary = action === "ADD"
    ? `Sentinel weekly direction and daily execution timing align; MCDX confirms participation and ${location.toLowerCase()} remains available. ADD is still an approval action, not a broker order.`
    : action === "PROFIT WATCH"
      ? `Sentinel remains constructive but price is ${location.toLowerCase()}. Protect gains and avoid chasing; MCDX is used only to judge conviction.`
      : action === "TRIM REVIEW"
        ? `Sentinel price evidence is weakening and multiple risk signals are clustering (${riskEvidence.join(", ")}). Review a partial reduction; no single MCDX reading can force a sale.`
        : action === "EXIT REVIEW"
          ? `Weekly/daily Sentinel bearish evidence and MCDX distribution confirm each other. Escalate to the thesis/fundamental exit gate; this is not an automatic sell.`
          : weeklyBull && (weeklyStatus === "VETO" || dailyStatus === "VETO")
            ? `Sentinel remains bullish, but MCDX strong opposite flow vetoes new ADD conviction. HOLD/WAIT rather than reversing direction from flow alone.`
            : weeklyBull
              ? `Sentinel is constructive, but execution timing, location or MCDX conviction is not strong enough for ADD.`
              : weeklyBear
                ? `Sentinel is defensive, but the evidence has not met the governed reduction/exit-review threshold.`
                : `Weekly Sentinel direction is mixed; HOLD until price direction and flow conviction align.`;

  return {
    version: "40.0",
    action,
    location,
    trendLabel,
    flowLabel,
    addEligible: action === "ADD",
    reduceReview: action === "TRIM REVIEW" || action === "EXIT REVIEW",
    direction,
    executionDirection,
    companionStatus,
    weeklyCompanionStatus: weeklyStatus,
    dailyCompanionStatus: dailyStatus,
    confidence,
    positiveEvidence,
    riskEvidence,
    summary,
    policy: {
      sentinelOwnsDirection: true,
      mcdxOwnsConviction: true,
      mcdxNeverCreatesDirection: true,
      volumeDoubleCountPrevented: true,
      roomAloneNeverForcesTrim: true,
      requiresMultipleRiskEvidenceForTrim: true,
      exitRequiresFundamentalGate: true,
      samePolicyAcrossHoldingsWatchlistCio: true,
      automaticTrading: false,
    },
  };
}
