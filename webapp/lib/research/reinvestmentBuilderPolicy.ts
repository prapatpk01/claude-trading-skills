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

export type ReinvestmentCuration = {
  owner: "INV_RESEARCH";
  selected: ReinvestmentCandidate[];
  availableCount: number;
  targetMinNames: number;
  targetMaxNames: number;
  capitalCapacityNames: number;
  qualityLimited: boolean;
  rationale: string;
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

const PRIMARY_STAGES = new Set(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const money = (value: number) => Math.round(value * 100) / 100;
const shares = (value: number) => Math.round(value * 1e7) / 1e7;

// V31 Opportunity Efficiency Floor for actual capital deployment.
// Research can keep lower-upside names on WATCH, but the reinvestment basket
// must not consume capital merely to fill a 5-name target.
export function meetsReinvestmentOpportunityFloor(row: ReinvestmentCandidate) {
  const stage = String(row.lifecycleStage ?? "UNCONFIRMED").toUpperCase();
  const expected = finite(row.expectedReturnPct, -999);
  const confidence = finite(row.confidence, 0);

  if (row.action === "ADD") return expected >= 5 && confidence >= 70;
  if (PRIMARY_STAGES.has(stage)) return expected >= 6 && confidence >= 62;
  if (stage === "MATURE") return expected >= 8 && confidence >= 68;
  return expected >= 8 && confidence >= 68;
}

function meetsExtensionFloor(row: ReinvestmentCandidate) {
  const stage = String(row.lifecycleStage ?? "UNCONFIRMED").toUpperCase();
  const expected = finite(row.expectedReturnPct, -999);
  const confidence = finite(row.confidence, 0);
  if (row.action === "ADD") return expected >= 7 && confidence >= 72;
  if (PRIMARY_STAGES.has(stage)) return expected >= 8 && confidence >= 68;
  return expected >= 10 && confidence >= 72;
}

function convictionScore(row: ReinvestmentCandidate) {
  const stage = String(row.lifecycleStage ?? "UNCONFIRMED").toUpperCase();
  const readinessBonus = row.readiness === "READY" ? 8 : 0;
  const stageBonus = PRIMARY_STAGES.has(stage) ? 8 : stage === "MATURE" ? -8 : 0;
  return Math.max(1,
    clamp(row.confidence, 0, 100) * .35 +
    clamp(row.expectedReturnPct, -10, 35) * 3.2 +
    clamp(row.priority, 0, 100) * .12 +
    readinessBonus + stageBonus
  );
}

export function rankReinvestmentCandidates(rows: ReinvestmentCandidate[]) {
  return rows.slice().sort((a, b) => {
    const scoreDiff = convictionScore(b) - convictionScore(a);
    if (Math.abs(scoreDiff) > .001) return scoreDiff;
    if (a.readiness !== b.readiness) return a.readiness === "READY" ? -1 : 1;
    return b.expectedReturnPct - a.expectedReturnPct || a.ticker.localeCompare(b.ticker);
  });
}

export function curateReinvestmentCandidates(input: {
  candidates: ReinvestmentCandidate[];
  deployableUsd: number;
  minNames?: number;
  maxNames?: number;
  minOrderUsd?: number;
}): ReinvestmentCuration {
  const minNames = Math.max(1, Math.min(8, Math.round(finite(input.minNames, 5))));
  const maxNames = Math.max(minNames, Math.min(8, Math.round(finite(input.maxNames, 8))));
  const minOrderUsd = Math.max(1, finite(input.minOrderUsd, 100));
  const deployableUsd = Math.max(0, finite(input.deployableUsd));
  const rawRanked = rankReinvestmentCandidates(input.candidates)
    .filter(row => row.ticker && row.price > 0)
    .filter((row, index, rows) => rows.findIndex(other => other.ticker === row.ticker) === index);
  const ranked = rawRanked.filter(meetsReinvestmentOpportunityFloor);

  const capitalCapacityNames = deployableUsd > 0 ? Math.min(maxNames, Math.floor(deployableUsd / minOrderUsd)) : 0;
  const maximumSelectable = Math.min(maxNames, capitalCapacityNames, ranked.length);
  if (maximumSelectable <= 0) return {
    owner: "INV_RESEARCH",
    selected: [],
    availableCount: ranked.length,
    targetMinNames: minNames,
    targetMaxNames: maxNames,
    capitalCapacityNames,
    qualityLimited: rawRanked.length > 0,
    rationale: deployableUsd <= 0
      ? "INV has no deployable capital to curate this cycle."
      : rawRanked.length > 0
        ? "INV found research candidates, but none cleared the V31 opportunity-efficiency floor. Keep capital in Buffer and continue the approved-universe research passes."
        : "Available capital is below the minimum draft-order threshold or no governed candidates are available.",
  };

  // The first five are selected only from names that already passed the capital
  // efficiency floor. We never force a 0–3% weighted-return name into the basket.
  const selected = ranked.slice(0, Math.min(minNames, maximumSelectable));
  for (let index = selected.length; index < maximumSelectable; index += 1) {
    const row = ranked[index];
    if (!meetsExtensionFloor(row)) break;
    selected.push(row);
  }

  const qualityLimited = selected.length < Math.min(maxNames, capitalCapacityNames, rawRanked.length);
  const rationale = selected.length < minNames
    ? `INV found only ${selected.length} names that clear the V31 opportunity floor; the 5-name floor is intentionally not forced and the next approved-universe pass should search for stronger destinations.`
    : selected.length === maxNames
      ? `INV filled the full ${maxNames}-name basket with opportunity-efficient Research/Forecast candidates.`
      : `INV selected ${selected.length} opportunity-efficient names; lower-ranked candidates remain standby because they did not clear the stronger extension threshold.`;

  return {
    owner: "INV_RESEARCH",
    selected,
    availableCount: ranked.length,
    targetMinNames: minNames,
    targetMaxNames: maxNames,
    capitalCapacityNames,
    qualityLimited,
    rationale,
  };
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
    .filter(meetsReinvestmentOpportunityFloor)
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
