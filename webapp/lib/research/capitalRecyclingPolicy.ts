export type RecyclingCandidate = {
  ticker: string;
  action: "BUY CANDIDATE" | "ADD";
  priority: number;
  confidence: number;
  expectedReturnPct: number;
};

export type RecyclingAllocation = RecyclingCandidate & {
  suggestedUsd: number;
  maxPolicyUsd: number;
};

export type CapitalRecyclingPlan = {
  proposedTrimProceedsUsd: number;
  sellReviewPotentialUsd: number;
  existingDeployableCashUsd: number;
  cashFloorShortfallUsd: number;
  cashFloorRepairUsd: number;
  recyclableAfterFloorUsd: number;
  totalDeployablePoolUsd: number;
  allocations: RecyclingAllocation[];
  allocatedUsd: number;
  unallocatedUsd: number;
  automaticTrading: false;
};

const finite = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const money = (value: number) => Math.round(Math.max(0, value) * 100) / 100;

export function buildCapitalRecyclingPlan(input: {
  proposedTrimProceedsUsd: number;
  sellReviewPotentialUsd?: number;
  existingDeployableCashUsd?: number;
  cashFloorShortfallUsd?: number;
  totalNavUsd?: number;
  candidates: RecyclingCandidate[];
}): CapitalRecyclingPlan {
  const proposedTrimProceedsUsd = money(finite(input.proposedTrimProceedsUsd));
  const sellReviewPotentialUsd = money(finite(input.sellReviewPotentialUsd));
  const existingDeployableCashUsd = money(finite(input.existingDeployableCashUsd));
  const cashFloorShortfallUsd = money(finite(input.cashFloorShortfallUsd));
  const totalNavUsd = Math.max(0, finite(input.totalNavUsd));
  const cashFloorRepairUsd = money(Math.min(proposedTrimProceedsUsd, cashFloorShortfallUsd));
  const recyclableAfterFloorUsd = money(Math.max(0, proposedTrimProceedsUsd - cashFloorRepairUsd));
  const totalDeployablePoolUsd = money(existingDeployableCashUsd + recyclableAfterFloorUsd);

  const candidates = input.candidates
    .filter(row => row.action === "BUY CANDIDATE" || row.action === "ADD")
    .map(row => ({
      ...row,
      priority: finite(row.priority),
      confidence: finite(row.confidence),
      expectedReturnPct: finite(row.expectedReturnPct),
    }))
    .sort((a, b) => b.priority - a.priority || b.confidence - a.confidence || b.expectedReturnPct - a.expectedReturnPct)
    .slice(0, 5);

  const allocations: RecyclingAllocation[] = [];
  let remaining = totalDeployablePoolUsd;
  if (remaining > 0 && candidates.length) {
    const scores = candidates.map(row => Math.max(1, row.priority + row.confidence * .2 + Math.max(0, row.expectedReturnPct) * 1.5));
    const scoreTotal = scores.reduce((sum, score) => sum + score, 0);
    for (let index = 0; index < candidates.length; index += 1) {
      const row = candidates[index];
      const navCap = totalNavUsd > 0 ? totalNavUsd * (row.action === "BUY CANDIDATE" ? .03 : .02) : totalDeployablePoolUsd;
      const poolCap = totalDeployablePoolUsd * (row.action === "BUY CANDIDATE" ? .40 : .30);
      const maxPolicyUsd = money(Math.max(0, Math.min(navCap, poolCap || navCap)));
      const proportional = scoreTotal > 0 ? totalDeployablePoolUsd * scores[index] / scoreTotal : 0;
      const suggestedUsd = money(Math.min(remaining, maxPolicyUsd, proportional));
      if (suggestedUsd <= 0) continue;
      allocations.push({ ...row, suggestedUsd, maxPolicyUsd });
      remaining = money(Math.max(0, remaining - suggestedUsd));
    }
  }

  const allocatedUsd = money(allocations.reduce((sum, row) => sum + row.suggestedUsd, 0));
  return {
    proposedTrimProceedsUsd,
    sellReviewPotentialUsd,
    existingDeployableCashUsd,
    cashFloorShortfallUsd,
    cashFloorRepairUsd,
    recyclableAfterFloorUsd,
    totalDeployablePoolUsd,
    allocations,
    allocatedUsd,
    unallocatedUsd: money(Math.max(0, totalDeployablePoolUsd - allocatedUsd)),
    automaticTrading: false,
  };
}
