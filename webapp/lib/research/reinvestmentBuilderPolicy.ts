export type ReinvestmentSizingMode = "EQUAL" | "CONVICTION" | "CORE_SATELLITE";
export type ReinvestmentReadiness = "READY" | "CIO_REVIEW";

export type ReinvestmentCandidate = {
  ticker: string;
  action: "BUY CANDIDATE" | "ADD" | "BUY DRAFT";
  readiness: ReinvestmentReadiness;
  price: number;
  confidence: number;
  expectedReturnPct: number;
  priority: number;
  lifecycleStage?: string | null;
  sourceStage?: string | null;
  reason?: string | null;
};

export type ReinvestmentDraftOrder = ReinvestmentCandidate & {
  suggestedUsd: number;
  estimatedShares: number;
  portfolioPct: number;
  poolPct: number;
  maxPolicyUsd: number;
};

export type ReinvestmentDraft = {
  mode: ReinvestmentSizingMode;
  deployableUsd: number;
  selectedCount: number;
  allocatedUsd: number;
  unallocatedUsd: number;
  orders: ReinvestmentDraftOrder[];
  automaticTrading: false;
  requiresFundingRiskCioApproval: true;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const money = (value: number) => Math.round(value * 100) / 100;
const shares = (value: number) => Math.round(value * 1e7) / 1e7;

function convictionScore(row: ReinvestmentCandidate) {
  const readinessBonus = row.readiness === "READY" ? 18 : 0;
  return Math.max(1,
    clamp(row.confidence, 0, 100) * .55 +
    clamp(row.expectedReturnPct, -10, 35) * 1.6 +
    clamp(row.priority, 0, 100) * .2 + readinessBonus
  );
}

export function rankReinvestmentCandidates(rows: ReinvestmentCandidate[]) {
  return rows.slice().sort((a, b) => {
    if (a.readiness !== b.readiness) return a.readiness === "READY" ? -1 : 1;
    return convictionScore(b) - convictionScore(a) || b.expectedReturnPct - a.expectedReturnPct || a.ticker.localeCompare(b.ticker);
  });
}

function rawWeights(rows: ReinvestmentCandidate[], mode: ReinvestmentSizingMode) {
  if (!rows.length) return [] as number[];
  if (mode === "EQUAL") return rows.map(() => 1 / rows.length);
  if (mode === "CONVICTION") {
    const scores = rows.map(convictionScore);
    const total = scores.reduce((sum, value) => sum + value, 0) || 1;
    return scores.map(value => value / total);
  }
  if (rows.length <= 3) return rawWeights(rows, "CONVICTION");
  const ranked = rankReinvestmentCandidates(rows);
  const coreTickers = new Set(ranked.slice(0, 3).map(row => row.ticker));
  const core = rows.map(row => coreTickers.has(row.ticker) ? convictionScore(row) : 0);
  const satellite = rows.map(row => coreTickers.has(row.ticker) ? 0 : convictionScore(row));
  const coreTotal = core.reduce((sum, value) => sum + value, 0) || 1;
  const satelliteTotal = satellite.reduce((sum, value) => sum + value, 0) || 1;
  return rows.map((row, index) => coreTickers.has(row.ticker) ? .6 * core[index] / coreTotal : .4 * satellite[index] / satelliteTotal);
}

function policyCap(row: ReinvestmentCandidate, deployableUsd: number, totalNavUsd: number) {
  const navPct = row.action === "ADD" ? .02 : .03;
  const poolPct = row.action === "ADD" ? .25 : .35;
  const navCap = totalNavUsd > 0 ? totalNavUsd * navPct : deployableUsd * poolPct;
  return Math.max(0, Math.min(navCap, deployableUsd * poolPct));
}

export function buildReinvestmentDraft(input: {
  deployableUsd: number;
  totalNavUsd: number;
  selected: ReinvestmentCandidate[];
  mode: ReinvestmentSizingMode;
  maxNames?: number;
  minOrderUsd?: number;
}): ReinvestmentDraft {
  const deployableUsd = Math.max(0, finite(input.deployableUsd));
  const totalNavUsd = Math.max(0, finite(input.totalNavUsd));
  const maxNames = Math.max(1, Math.min(8, Math.round(finite(input.maxNames, 8))));
  const minOrderUsd = Math.max(0, finite(input.minOrderUsd, 100));
  const selected = rankReinvestmentCandidates(input.selected)
    .filter(row => row.ticker && row.price > 0 && row.confidence >= 0)
    .filter((row, index, rows) => rows.findIndex(other => other.ticker === row.ticker) === index)
    .slice(0, maxNames);

  if (!deployableUsd || !selected.length) return {
    mode: input.mode,
    deployableUsd: money(deployableUsd),
    selectedCount: selected.length,
    allocatedUsd: 0,
    unallocatedUsd: money(deployableUsd),
    orders: [],
    automaticTrading: false,
    requiresFundingRiskCioApproval: true,
  };

  const weights = rawWeights(selected, input.mode);
  const caps = selected.map(row => policyCap(row, deployableUsd, totalNavUsd));
  const allocation = selected.map((_, index) => Math.min(deployableUsd * weights[index], caps[index]));

  for (let pass = 0; pass < 8; pass += 1) {
    const used = allocation.reduce((sum, value) => sum + value, 0);
    const residual = Math.max(0, deployableUsd - used);
    if (residual < .01) break;
    const room = allocation.map((value, index) => Math.max(0, caps[index] - value));
    const totalRoom = room.reduce((sum, value) => sum + value, 0);
    if (totalRoom < .01) break;
    for (let index = 0; index < allocation.length; index += 1) {
      if (room[index] <= 0) continue;
      allocation[index] += Math.min(room[index], residual * room[index] / totalRoom);
    }
  }

  const preliminary = selected.map((row, index) => ({ row, usd: money(allocation[index]), cap: money(caps[index]) }));
  const kept = preliminary.filter(item => item.usd >= Math.min(minOrderUsd, deployableUsd));
  const allocatedUsd = money(kept.reduce((sum, item) => sum + item.usd, 0));
  const orders: ReinvestmentDraftOrder[] = kept.map(({ row, usd, cap }) => ({
    ...row,
    suggestedUsd: usd,
    estimatedShares: shares(usd / row.price),
    portfolioPct: totalNavUsd > 0 ? Math.round((usd / totalNavUsd * 100) * 100) / 100 : 0,
    poolPct: deployableUsd > 0 ? Math.round((usd / deployableUsd * 100) * 10) / 10 : 0,
    maxPolicyUsd: cap,
  }));

  return {
    mode: input.mode,
    deployableUsd: money(deployableUsd),
    selectedCount: selected.length,
    allocatedUsd,
    unallocatedUsd: money(Math.max(0, deployableUsd - allocatedUsd)),
    orders,
    automaticTrading: false,
    requiresFundingRiskCioApproval: true,
  };
}
