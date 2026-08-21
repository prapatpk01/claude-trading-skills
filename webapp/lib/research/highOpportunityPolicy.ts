export const HIGH_OPPORTUNITY_POLICY = {
  version: "32.0",
  minMomentum: 68,
  minResearchUpsidePct: 12,
  preferredUpsidePct: 15,
  minFastScore: 58,
  primaryStages: ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"] as const,
} as const;

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function researchOpportunityScore(input: {
  momentum?: number | null;
  institutional?: number | null;
  growth?: number | null;
  quality?: number | null;
  value?: number | null;
  ai?: number | null;
  expectedReturnPct?: number | null;
}) {
  const upsideScore = clamp(finite(input.expectedReturnPct) * 3.4, 0, 100);
  return Math.round(clamp(
    finite(input.momentum) * .30 +
    upsideScore * .25 +
    finite(input.institutional) * .15 +
    finite(input.growth) * .12 +
    finite(input.quality) * .08 +
    finite(input.value) * .07 +
    finite(input.ai) * .03,
    0,
    100,
  ));
}

export function passesHighOpportunityResearchGate(input: {
  momentum?: number | null;
  expectedReturnPct?: number | null;
  lifecycleEntryEligible?: boolean | null;
  valuationReady?: boolean | null;
}) {
  return finite(input.momentum) >= HIGH_OPPORTUNITY_POLICY.minMomentum
    && finite(input.expectedReturnPct, -999) >= HIGH_OPPORTUNITY_POLICY.minResearchUpsidePct
    && input.lifecycleEntryEligible === true
    && input.valuationReady === true;
}
