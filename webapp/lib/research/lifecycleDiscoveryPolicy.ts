import type { MomentumLifecycleStage } from "@/lib/research/momentumLifecycle";

export const PRIMARY_DISCOVERY_STAGES = [
  "ACCUMULATION",
  "EARLY_MARKUP",
  "MOMENTUM_EXPANSION",
] as const satisfies readonly MomentumLifecycleStage[];

export const MATURE_FALLBACK_STAGE = "MATURE" as const satisfies MomentumLifecycleStage;

export type LifecycleDiscoveryTier = "PRIMARY" | "MATURE_FALLBACK" | "NOT_ELIGIBLE";

const PRIMARY = new Set<MomentumLifecycleStage>(PRIMARY_DISCOVERY_STAGES);

export function lifecycleDiscoveryTier(stage: MomentumLifecycleStage | string | null | undefined): LifecycleDiscoveryTier {
  if (PRIMARY.has(stage as MomentumLifecycleStage)) return "PRIMARY";
  if (stage === MATURE_FALLBACK_STAGE) return "MATURE_FALLBACK";
  return "NOT_ELIGIBLE";
}

export function isPrimaryDiscoveryStage(stage: MomentumLifecycleStage | string | null | undefined) {
  return lifecycleDiscoveryTier(stage) === "PRIMARY";
}

export function isMatureFallbackStage(stage: MomentumLifecycleStage | string | null | undefined) {
  return stage === MATURE_FALLBACK_STAGE;
}

export type LifecycleSelection<T> = {
  selected: Array<T & { discoveryTier: Exclude<LifecycleDiscoveryTier, "NOT_ELIGIBLE"> }>;
  primaryAvailable: number;
  matureFallbackAvailable: number;
  primarySelected: number;
  matureFallbackSelected: number;
  fallbackUsed: boolean;
};

/**
 * CIO/INV V25 lifecycle policy.
 *
 * New discovery always exhausts ACCUMULATION / EARLY_MARKUP /
 * MOMENTUM_EXPANSION first. MATURE is a reserve research lane only: it can fill
 * an unfilled shortlist after the primary stages have been exhausted and only
 * when the caller's stricter mature gate passes. WEAKENING, BROKEN and
 * UNCONFIRMED are never promoted into the new-capital shortlist.
 */
export function selectLifecycleFirst<T>(
  rows: T[],
  options: {
    topN: number;
    getStage: (row: T) => MomentumLifecycleStage | string | null | undefined;
    getScore: (row: T) => number;
    matureEligible?: (row: T) => boolean;
  },
): LifecycleSelection<T> {
  const topN = Math.max(0, Math.floor(options.topN));
  const sort = (a: T, b: T) => options.getScore(b) - options.getScore(a);
  const primary = rows.filter(row => isPrimaryDiscoveryStage(options.getStage(row))).sort(sort);
  const mature = rows
    .filter(row => isMatureFallbackStage(options.getStage(row)))
    .filter(row => options.matureEligible ? options.matureEligible(row) : true)
    .sort(sort);

  const primarySelected = primary.slice(0, topN);
  const remaining = Math.max(0, topN - primarySelected.length);
  const matureSelected = remaining > 0 ? mature.slice(0, remaining) : [];

  return {
    selected: [
      ...primarySelected.map(row => ({ ...row, discoveryTier: "PRIMARY" as const })),
      ...matureSelected.map(row => ({ ...row, discoveryTier: "MATURE_FALLBACK" as const })),
    ],
    primaryAvailable: primary.length,
    matureFallbackAvailable: mature.length,
    primarySelected: primarySelected.length,
    matureFallbackSelected: matureSelected.length,
    fallbackUsed: matureSelected.length > 0,
  };
}

export const LIFECYCLE_DISCOVERY_POLICY_V25 = {
  version: "25.0",
  primaryStages: PRIMARY_DISCOVERY_STAGES,
  fallbackStage: MATURE_FALLBACK_STAGE,
  excludedForNewCapital: ["WEAKENING", "BROKEN", "UNCONFIRMED"] as const,
  rule: "Search primary lifecycle stages first. Use MATURE only to fill an otherwise unfilled shortlist after stricter valuation, trend-room and distribution checks.",
} as const;
