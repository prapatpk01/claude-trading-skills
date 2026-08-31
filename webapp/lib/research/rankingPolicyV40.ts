import type { DiscoveryRowV39 } from "./dualDiscoveryPolicyV39";

export const INV_RESEARCH_RANKING_V40 = "40.0" as const;

export type ActionBandV40 = "BUY_NOW" | "ACCUMULATE" | "WATCHLIST" | "REJECT";

export type RankingBreakdownV40 = {
  momentum: number;
  growth: number;
  earningsAcceleration: number;
  quality: number;
  relativeStrength: number;
  valuation: number;
  catalyst: number;
};

export type RankedIdeaV40 = DiscoveryRowV39 & {
  rank: number;
  totalScore: number;
  actionBand: ActionBandV40;
  breakdown: RankingBreakdownV40;
  missingToUpgrade: string[];
  deepResearchReady: boolean;
  hardRejected: boolean;
};

export type RankingResultV40 = {
  version: typeof INV_RESEARCH_RANKING_V40;
  methodology: string;
  poolSize: number;
  finalists: RankedIdeaV40[];
  bestAvailable: RankedIdeaV40[];
  counts: Record<ActionBandV40, number>;
};

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const finite = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function neutralized(value: unknown, fallback = 50) {
  return clamp(finite(value) ?? fallback);
}

function relativeStrengthScore(row: DiscoveryRowV39) {
  const rs3m = finite(row.rs3m);
  if (rs3m != null) return clamp(50 + rs3m * 2.2);
  const fast = finite(row.fastScore);
  return fast == null ? 50 : clamp(35 + fast * .65);
}

function valuationScore(row: DiscoveryRowV39) {
  const upside = finite(row.expectedReturnPct);
  if (upside == null) return 42;
  // 0% upside ~= 45, 8% ~= 61, 15% ~= 75, 25%+ ~= 95.
  return clamp(45 + upside * 2);
}

function catalystScore(row: DiscoveryRowV39) {
  if (row.catalyst) return 82;
  if (row.thesis && row.whyNow) return 72;
  if (row.lane === "THESIS") return 62;
  return 45;
}

function earningsAccelerationScore(row: DiscoveryRowV39) {
  // The current measured dataset does not expose analyst revision breadth reliably.
  // Use the measured Growth factor as an earnings/revenue acceleration proxy rather
  // than fabricating revision data. Missing deep research stays neutral, not zero.
  const growth = finite(row.growthScore);
  const momentum = finite(row.momentumScore);
  if (growth != null && momentum != null) return clamp(growth * .78 + momentum * .22);
  if (growth != null) return clamp(growth);
  return 50;
}

export function rankingBreakdownV40(row: DiscoveryRowV39): RankingBreakdownV40 {
  return {
    momentum: neutralized(row.momentumScore ?? row.fastScore),
    growth: neutralized(row.growthScore),
    earningsAcceleration: earningsAccelerationScore(row),
    quality: neutralized(row.qualityScore),
    relativeStrength: relativeStrengthScore(row),
    valuation: valuationScore(row),
    catalyst: catalystScore(row),
  };
}

export function totalRankingScoreV40(breakdown: RankingBreakdownV40) {
  return Math.round(clamp(
    breakdown.momentum * .25
    + breakdown.growth * .20
    + breakdown.earningsAcceleration * .15
    + breakdown.quality * .15
    + breakdown.relativeStrength * .10
    + breakdown.valuation * .10
    + breakdown.catalyst * .05,
  ));
}

function hardRejected(row: DiscoveryRowV39) {
  const lifecycle = String(row.lifecycleStage ?? "").toUpperCase();
  return lifecycle === "BROKEN" || (row.hardBlocks?.length ?? 0) > 0;
}

function deepResearchReady(row: DiscoveryRowV39) {
  return finite(row.momentumScore) != null
    || finite(row.growthScore) != null
    || finite(row.qualityScore) != null
    || finite(row.compositeScore) != null
    || finite(row.expectedReturnPct) != null
    || Boolean(row.thesis);
}

function classify(row: DiscoveryRowV39, score: number, deep: boolean, hardBlock: boolean): ActionBandV40 {
  if (hardBlock) return "REJECT";
  // BUY NOW remains a strict capital-quality label: it can only be emitted after
  // the existing V39 committee-ready gate has passed. Ranking never bypasses it.
  if (score >= 82 && row.committeeReady) return "BUY_NOW";
  // ACCUMULATE is a research/action-prep band, not broker authorization.
  if (score >= 75 && deep) return "ACCUMULATE";
  if (score >= 68 || row.score >= 62) return "WATCHLIST";
  return "REJECT";
}

function missingToUpgrade(row: DiscoveryRowV39, actionBand: ActionBandV40, deep: boolean) {
  const missing: string[] = [];
  if (!deep) missing.push("Deep research confirmation");
  if (finite(row.expectedReturnPct) == null) missing.push("Decision-grade valuation / upside");
  if (!row.committeeReady && actionBand !== "REJECT") missing.push("Strict Committee Ready gate");
  if (row.failedGates?.length) missing.push(...row.failedGates.slice(0, 2));
  if (row.hardBlocks?.length) missing.push(...row.hardBlocks.slice(0, 2));
  return Array.from(new Set(missing));
}

export function buildRankingV40(rows: DiscoveryRowV39[], finalistLimit = 20): RankingResultV40 {
  const deduped = new Map<string, DiscoveryRowV39>();
  for (const row of rows) {
    const previous = deduped.get(row.ticker);
    if (!previous) {
      deduped.set(row.ticker, row);
      continue;
    }
    const currentEdge = row.score * .72 + row.confidenceScore * .28;
    const previousEdge = previous.score * .72 + previous.confidenceScore * .28;
    if (currentEdge > previousEdge) deduped.set(row.ticker, row);
  }

  const ranked = Array.from(deduped.values()).map(row => {
    const breakdown = rankingBreakdownV40(row);
    const totalScore = totalRankingScoreV40(breakdown);
    const deep = deepResearchReady(row);
    const blocked = hardRejected(row);
    const actionBand = classify(row, totalScore, deep, blocked);
    return {
      ...row,
      rank: 0,
      totalScore,
      actionBand,
      breakdown,
      missingToUpgrade: missingToUpgrade(row, actionBand, deep),
      deepResearchReady: deep,
      hardRejected: blocked,
    } satisfies RankedIdeaV40;
  }).sort((a, b) => {
    const bandBonus = (band: ActionBandV40) => band === "BUY_NOW" ? 12 : band === "ACCUMULATE" ? 8 : band === "WATCHLIST" ? 4 : 0;
    return (b.totalScore + bandBonus(b.actionBand)) - (a.totalScore + bandBonus(a.actionBand))
      || b.score - a.score
      || a.ticker.localeCompare(b.ticker);
  }).map((row, index) => ({ ...row, rank: index + 1 }));

  const counts: Record<ActionBandV40, number> = { BUY_NOW: 0, ACCUMULATE: 0, WATCHLIST: 0, REJECT: 0 };
  for (const row of ranked) counts[row.actionBand] += 1;

  const finalists = ranked
    .filter(row => row.actionBand !== "REJECT")
    .slice(0, Math.max(5, finalistLimit));
  const bestAvailable = (finalists.length ? finalists : ranked).slice(0, 10);

  return {
    version: INV_RESEARCH_RANKING_V40,
    methodology: "V40 ranks the measured discovery pool instead of requiring every factor to pass as a binary gate. Weights: Momentum 25%, Growth 20%, measured Earnings/Revenue Acceleration proxy 15%, Quality 15%, Relative Strength 10%, Valuation 10%, Catalyst 5%. Coverage measures data quality only. Missing deep-research inputs remain neutral/unknown rather than being coerced to zero. BUY NOW still requires the existing strict Committee Ready gate; ranking cannot authorize capital or execution.",
    poolSize: ranked.length,
    finalists,
    bestAvailable,
    counts,
  };
}
