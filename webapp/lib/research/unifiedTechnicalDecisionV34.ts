export type UnifiedTechnicalAction = "ADD" | "HOLD" | "PROFIT WATCH" | "TRIM REVIEW" | "EXIT REVIEW";
export type TechnicalLocation = "GOOD ROOM" | "NORMAL ROOM" | "EXTENDED" | "TARGET ZONE" | "UNKNOWN";

export type UnifiedTechnicalDecisionInput = {
  roomAtr: number | null;
  sentinel: {
    trend: "BULL" | "NEUTRAL" | "BEAR";
    coreState: string;
    momentumStrength: number;
    structure: "BULL" | "NEUTRAL" | "BEAR";
    structurePattern: string;
    regime: string;
    trigger: string;
    rsiState: string;
    fastImpulse: number;
    hma16State: string;
  };
  mcdx: {
    state: "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
    sponsor: "BULL_SPONSORED" | "BEAR_SPONSORED" | "NONE";
    flowSignal: "BUY_PRESSURE" | "SELL_PRESSURE" | "MIXED";
    contextScore: number;
    smartFlow: number;
  };
};

export type UnifiedTechnicalDecisionV34 = {
  version: "34.0";
  action: UnifiedTechnicalAction;
  location: TechnicalLocation;
  trendLabel: string;
  flowLabel: string;
  addEligible: boolean;
  reduceReview: boolean;
  positiveEvidence: string[];
  riskEvidence: string[];
  summary: string;
  policy: {
    roomAloneNeverForcesTrim: true;
    requiresMultipleRiskEvidenceForTrim: true;
    exitRequiresFundamentalGate: true;
    samePolicyAcrossHoldingsWatchlistCio: true;
  };
};

const POSITIVE_TRIGGERS = new Set(["BOS_UP", "CHOCH_UP", "RSI_SMA_BULL_SHIFT", "RSI_LOW_RECLAIM", "HMA16_RECLAIM"]);
const NEGATIVE_TRIGGERS = new Set(["BOS_DOWN", "CHOCH_DOWN", "RSI_SMA_BEAR_SHIFT", "RSI_HIGH_REJECT", "HMA16_LOSS"]);

export function technicalLocation(roomAtr: number | null): TechnicalLocation {
  if (roomAtr == null || !Number.isFinite(roomAtr)) return "UNKNOWN";
  if (roomAtr >= 1.5) return "GOOD ROOM";
  if (roomAtr >= 1) return "NORMAL ROOM";
  if (roomAtr >= .5) return "EXTENDED";
  return "TARGET ZONE";
}

export function buildUnifiedTechnicalDecisionV34(input: UnifiedTechnicalDecisionInput): UnifiedTechnicalDecisionV34 {
  const { sentinel, mcdx } = input;
  const location = technicalLocation(input.roomAtr);
  const bullishCore = sentinel.coreState.includes("BULL") || sentinel.trend === "BULL";
  const bearishCore = sentinel.coreState.includes("BEAR") || sentinel.trend === "BEAR";
  const strongBull = sentinel.coreState === "STRONG BULL" || bullishCore && sentinel.momentumStrength >= 50;
  const strongBear = sentinel.coreState === "STRONG BEAR" || bearishCore && sentinel.momentumStrength >= 50;
  const positiveTrigger = POSITIVE_TRIGGERS.has(sentinel.trigger);
  const negativeTrigger = NEGATIVE_TRIGGERS.has(sentinel.trigger);
  const bullFlow = mcdx.sponsor === "BULL_SPONSORED"
    || mcdx.state === "ACCUMULATION"
    || mcdx.flowSignal === "BUY_PRESSURE" && mcdx.contextScore >= 55;
  const bearFlow = mcdx.sponsor === "BEAR_SPONSORED"
    || mcdx.state === "DISTRIBUTION"
    || mcdx.flowSignal === "SELL_PRESSURE" && mcdx.contextScore >= 55;
  const locationPressure = location === "EXTENDED" || location === "TARGET ZONE";

  const positiveEvidence: string[] = [];
  const riskEvidence: string[] = [];
  if (strongBull) positiveEvidence.push("strong bullish trend");
  else if (bullishCore) positiveEvidence.push("bullish trend");
  if (sentinel.structure === "BULL") positiveEvidence.push("bullish structure");
  if (positiveTrigger) positiveEvidence.push(`trigger ${sentinel.trigger}`);
  if (sentinel.hma16State === "BULL") positiveEvidence.push("HMA16 bullish");
  if (bullFlow) positiveEvidence.push(`flow ${mcdx.sponsor !== "NONE" ? mcdx.sponsor : mcdx.flowSignal}`);

  if (strongBear) riskEvidence.push("strong bearish trend");
  else if (bearishCore && sentinel.momentumStrength >= 30) riskEvidence.push("bearish trend");
  if (sentinel.structure === "BEAR") riskEvidence.push("bearish structure");
  if (negativeTrigger) riskEvidence.push(`trigger ${sentinel.trigger}`);
  if (sentinel.hma16State === "BEAR") riskEvidence.push("HMA16 bearish");
  if (mcdx.sponsor === "BEAR_SPONSORED") riskEvidence.push("bear-sponsored flow");
  else if (mcdx.state === "DISTRIBUTION") riskEvidence.push("distribution flow");
  else if (mcdx.flowSignal === "SELL_PRESSURE" && mcdx.contextScore >= 55) riskEvidence.push("sell pressure");
  if (sentinel.fastImpulse <= -25) riskEvidence.push("negative fast impulse");

  let action: UnifiedTechnicalAction = "HOLD";
  if (strongBear && sentinel.structure === "BEAR" && bearFlow && riskEvidence.length >= 3) {
    action = "EXIT REVIEW";
  } else if ((bearFlow && locationPressure) || (bearFlow && riskEvidence.length >= 2) || (negativeTrigger && riskEvidence.length >= 2)) {
    action = "TRIM REVIEW";
  } else if (bullishCore && locationPressure && !bearFlow && riskEvidence.length < 2) {
    action = "PROFIT WATCH";
  } else if (bullishCore && bullFlow && (location === "GOOD ROOM" || location === "NORMAL ROOM") && sentinel.momentumStrength >= 30 && sentinel.structure !== "BEAR") {
    action = "ADD";
  }

  const flowLabel = mcdx.sponsor !== "NONE"
    ? mcdx.sponsor.replaceAll("_", " ")
    : mcdx.state !== "NEUTRAL"
      ? mcdx.state
      : mcdx.flowSignal.replaceAll("_", " ");

  const summary = action === "ADD"
    ? `Trend and flow confirm each other with ${location.toLowerCase()} to Target 1.`
    : action === "PROFIT WATCH"
      ? `Trend remains constructive, but price is ${location.toLowerCase()}; do not chase. Hold/protect gains and wait for breakout or weakening evidence.`
      : action === "TRIM REVIEW"
        ? `Risk evidence is clustering (${riskEvidence.join(", ") || "location + flow"}); review a partial reduction rather than treating one indicator as an automatic sell.`
        : action === "EXIT REVIEW"
          ? `Bearish trend, structure and flow agree. Escalate to thesis/fundamental exit review; this is not an automatic sell.`
          : bullFlow && bullishCore
            ? `Trend/flow are constructive but location or strength is not yet sufficient for ADD.`
            : bullishCore && !bullFlow
              ? `Trend is constructive but flow has not confirmed participation; HOLD and wait.`
              : `Evidence is mixed; keep the current position/watch state until trend, flow and location align.`;

  return {
    version: "34.0",
    action,
    location,
    trendLabel: sentinel.coreState,
    flowLabel,
    addEligible: action === "ADD",
    reduceReview: action === "TRIM REVIEW" || action === "EXIT REVIEW",
    positiveEvidence,
    riskEvidence,
    summary,
    policy: {
      roomAloneNeverForcesTrim: true,
      requiresMultipleRiskEvidenceForTrim: true,
      exitRequiresFundamentalGate: true,
      samePolicyAcrossHoldingsWatchlistCio: true,
    },
  };
}
