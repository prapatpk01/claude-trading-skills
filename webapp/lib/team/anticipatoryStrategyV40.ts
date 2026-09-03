export const ANTICIPATORY_STRATEGY_V40 = "40.0" as const;

export type AnticipatoryPhaseV40 = "PRE_POSITION" | "SCALE" | "WATCH" | "BLOCKED";

export const ORGANIZATION_STRATEGY_V40 = {
  version: ANTICIPATORY_STRATEGY_V40,
  name: "Anticipatory Smart-Flow",
  doctrine: "POSITION_BEFORE_CONFIRMATION",
  objective: "Build asymmetric positions before the consensus narrative is fully resolved, then scale or cut as observable flow and thesis evidence evolve.",
  newsRole: "UPDATE_PROBABILITY_NOT_ENTRY_TRIGGER",
  confirmationRole: "SCALE_OR_INVALIDATE_NOT_INITIATE",
  smartMoneyDefinition: "Observable price/volume sponsorship proxy only; never assumed insider knowledge.",
  automaticTrading: false,
  humanApprovalRequired: true,
  sizing: {
    starterFractionOfPlannedPosition: 1 / 3,
    confirmationAddFractionOfPlannedPosition: 1 / 3,
    finalScaleFractionOfPlannedPosition: 1 / 3,
    defensiveStarterFractionOfPlannedPosition: 0.25,
  },
  thresholds: {
    minDataQualityPct: 70,
    minOwnershipScore: 55,
    minMomentumForEarlyPosition: 52,
    minSmartFlowScore: 55,
    minFutureBetScore: 62,
    defensiveMinSmartFlowScore: 67,
    defensiveMinFutureBetScore: 72,
    fullScaleFutureBetScore: 70,
  },
  teamMandates: {
    CIO: "Choose the most probable future path and allocate before consensus confirmation; confirmation changes size, not the existence of the thesis.",
    INVESTMENT: "Build bull/base/bear scenarios, seek early leadership and accumulation, and surface future winners before headlines become obvious.",
    ASSET_MANAGEMENT: "Use starter -> confirm -> scale sequencing. Preserve deployable liquidity so the fund can add when the thesis proves itself.",
    RISK: "Control the size of uncertainty rather than banning uncertainty. Crisis, broken structure, persistent distribution and liquidity violations remain hard blocks.",
    RESEARCH: "Treat news as evidence that updates probabilities. Never require a resolved narrative before a candidate can enter research or an approved starter path.",
  },
} as const;

export type AnticipatoryInputV40 = {
  marketState: string;
  marketScore: number;
  momentumScore: number;
  ownershipScore: number;
  entryScore: number;
  flowScore: number;
  relativeStrengthScore: number;
  dataQualityPct: number;
  hardBlockCount: number;
  baseAction: string;
};

export type AnticipatoryDecisionV40 = {
  version: typeof ANTICIPATORY_STRATEGY_V40;
  phase: AnticipatoryPhaseV40;
  futureBetScore: number;
  smartFlowScore: number;
  starterAllowed: boolean;
  scaleAllowed: boolean;
  sizeFraction: number;
  reason: string;
  newsRequired: false;
  confirmationRequiredToInitiate: false;
  methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY";
};

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));

export function normalizePillarScore(points: number, max: number) {
  if (!Number.isFinite(points) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.round(clamp((points / max) * 100));
}

export function evaluateAnticipatorySetupV40(input: AnticipatoryInputV40): AnticipatoryDecisionV40 {
  const market = clamp(input.marketScore);
  const momentum = clamp(input.momentumScore);
  const ownership = clamp(input.ownershipScore);
  const entry = clamp(input.entryScore * 10);
  const smartFlow = clamp(input.flowScore);
  const relativeStrength = clamp(input.relativeStrengthScore);
  const dataQuality = clamp(input.dataQualityPct);
  const marketState = String(input.marketState || "").toUpperCase();
  const crisis = marketState === "CRISIS";
  const defensive = marketState === "DEFENSIVE";

  // Future Bet deliberately gives observable sponsorship and relative leadership
  // more weight than headline/catalyst confirmation. Ownership still matters so
  // price/volume alone can never authorize a position.
  const futureBetScore = Math.round(clamp(
    smartFlow * 0.30 +
    relativeStrength * 0.20 +
    momentum * 0.20 +
    market * 0.15 +
    ownership * 0.10 +
    entry * 0.05,
  ));

  if (input.hardBlockCount > 0 || crisis) {
    return {
      version: ANTICIPATORY_STRATEGY_V40,
      phase: "BLOCKED",
      futureBetScore,
      smartFlowScore: smartFlow,
      starterAllowed: false,
      scaleAllowed: false,
      sizeFraction: 0,
      reason: input.hardBlockCount > 0 ? "A true hard block overrides the anticipatory thesis." : "Crisis regime blocks new risk; anticipation never overrides the crisis boundary.",
      newsRequired: false,
      confirmationRequiredToInitiate: false,
      methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY",
    };
  }

  if (dataQuality < ORGANIZATION_STRATEGY_V40.thresholds.minDataQualityPct || ownership < ORGANIZATION_STRATEGY_V40.thresholds.minOwnershipScore) {
    return {
      version: ANTICIPATORY_STRATEGY_V40,
      phase: "WATCH",
      futureBetScore,
      smartFlowScore: smartFlow,
      starterAllowed: false,
      scaleAllowed: false,
      sizeFraction: 0,
      reason: `Evidence/ownership is not strong enough to price uncertainty yet (${dataQuality}% data, ownership ${Math.round(ownership)}/100).`,
      newsRequired: false,
      confirmationRequiredToInitiate: false,
      methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY",
    };
  }

  const baseAction = String(input.baseAction || "").toUpperCase();
  const confirmedScale = baseAction === "BUY"
    && futureBetScore >= ORGANIZATION_STRATEGY_V40.thresholds.fullScaleFutureBetScore
    && smartFlow >= 60;
  if (confirmedScale) {
    return {
      version: ANTICIPATORY_STRATEGY_V40,
      phase: "SCALE",
      futureBetScore,
      smartFlowScore: smartFlow,
      starterAllowed: true,
      scaleAllowed: true,
      sizeFraction: 1,
      reason: `Future Bet ${futureBetScore}/100 and Smart Flow ${smartFlow}/100 agree with the confirmed BUY path; full planned sizing may be considered subject to portfolio/risk gates.`,
      newsRequired: false,
      confirmationRequiredToInitiate: false,
      methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY",
    };
  }

  const starterThreshold = defensive ? ORGANIZATION_STRATEGY_V40.thresholds.defensiveMinFutureBetScore : ORGANIZATION_STRATEGY_V40.thresholds.minFutureBetScore;
  const flowThreshold = defensive ? ORGANIZATION_STRATEGY_V40.thresholds.defensiveMinSmartFlowScore : ORGANIZATION_STRATEGY_V40.thresholds.minSmartFlowScore;
  const starterAllowed = futureBetScore >= starterThreshold
    && smartFlow >= flowThreshold
    && momentum >= ORGANIZATION_STRATEGY_V40.thresholds.minMomentumForEarlyPosition;

  if (starterAllowed) {
    const sizeFraction = defensive
      ? ORGANIZATION_STRATEGY_V40.sizing.defensiveStarterFractionOfPlannedPosition
      : ORGANIZATION_STRATEGY_V40.sizing.starterFractionOfPlannedPosition;
    return {
      version: ANTICIPATORY_STRATEGY_V40,
      phase: "PRE_POSITION",
      futureBetScore,
      smartFlowScore: smartFlow,
      starterAllowed: true,
      scaleAllowed: false,
      sizeFraction,
      reason: `Pre-position before narrative confirmation: Future Bet ${futureBetScore}/100 · Smart Flow ${smartFlow}/100 · Momentum ${Math.round(momentum)}/100. Confirmation is reserved for scaling or invalidation.`,
      newsRequired: false,
      confirmationRequiredToInitiate: false,
      methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY",
    };
  }

  return {
    version: ANTICIPATORY_STRATEGY_V40,
    phase: "WATCH",
    futureBetScore,
    smartFlowScore: smartFlow,
    starterAllowed: false,
    scaleAllowed: false,
    sizeFraction: 0,
    reason: `The future path is not asymmetric enough yet: Future Bet ${futureBetScore}/100 · Smart Flow ${smartFlow}/100. Keep the thesis live and watch sponsorship rather than waiting for headlines alone.`,
    newsRequired: false,
    confirmationRequiredToInitiate: false,
    methodology: "PRICE_VOLUME_SPONSORSHIP_PROXY",
  };
}
