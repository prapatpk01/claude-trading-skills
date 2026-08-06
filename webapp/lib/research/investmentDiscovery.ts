import { ENGINE_UNIVERSES, runFactorDiscovery, type FactorMode, type ResearchCandidate } from "@/lib/factorDiscovery";
import { buildTradePlan } from "@/lib/researchEnginePolicies";

const MODE_ORDER: FactorMode[] = ["multifactor", "growth", "quality", "value", "dividend", "institutional", "ai", "momentum"];
const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);

export type InvestmentResearchProposal = {
  ticker: string; setupType: string; score: number; coveragePct: number; price: number;
  entryLow: number; entryHigh: number; stop: number; target: number; riskReward: number;
  expectedReturnPct: number; thesis: string; catalyst: string; unmeasured: string[];
  sourceModels: string[]; sourceKind: "RESEARCH_OS_PHASE_1";
};

function balancedUniverse(limit = 32) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (let row = 0; output.length < limit; row++) {
    let added = false;
    for (const mode of MODE_ORDER) {
      const ticker = ENGINE_UNIVERSES[mode][row];
      if (!ticker) continue;
      added = true;
      if (!seen.has(ticker)) { seen.add(ticker); output.push(ticker); }
      if (output.length >= limit) break;
    }
    if (!added) break;
  }
  return output;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rank(candidate: ResearchCandidate) {
  return (candidate.consensusCount ?? 0) * 12 + candidate.composite + Math.max(-15, Math.min(25, candidate.expectedReturnPct ?? 0)) * .4;
}

export async function runInvestmentResearchOS(options: { exclude?: Iterable<string>; topN?: number; universeLimit?: number } = {}) {
  const excluded = new Set(Array.from(options.exclude ?? [], value => String(value).toUpperCase()));
  const universe = balancedUniverse(options.universeLimit ?? 32).filter(ticker => !excluded.has(ticker) && !RESERVES.has(ticker));
  const result = await runFactorDiscovery("multifactor", universe, universe.length);
  const eligible = result.candidates
    .filter(candidate => (candidate.passed || (candidate.consensusCount ?? 0) >= 2) && candidate.price != null && candidate.price > 0)
    .filter(candidate => candidate.targetPrice != null && candidate.targetPrice > candidate.price! && (candidate.expectedReturnPct ?? -Infinity) >= 5)
    .sort((left, right) => rank(right) - rank(left))
    .slice(0, options.topN ?? 6);

  const proposals: InvestmentResearchProposal[] = eligible.flatMap(candidate => {
    const plan = buildTradePlan("multifactor", candidate);
    const price = finite(candidate.price), target = finite(candidate.targetPrice);
    if (price == null || target == null || plan.entryLow == null || plan.entryHigh == null || plan.stopLoss == null) return [];
    const models = candidate.engines?.length ? candidate.engines : ["multifactor"];
    return [{
      ticker: candidate.ticker,
      setupType: `RESEARCH OS · ${models.slice(0, 3).join("+").toUpperCase()}`,
      score: candidate.composite,
      coveragePct: Math.round((models.length / 7) * 100),
      price,
      entryLow: plan.entryLow,
      entryHigh: plan.entryHigh,
      stop: plan.stopLoss,
      target,
      riskReward: plan.rewardRisk ?? Math.max(0, (target - price) / Math.max(.01, price - plan.stopLoss)),
      expectedReturnPct: candidate.expectedReturnPct ?? ((target / price) - 1) * 100,
      thesis: candidate.thesis,
      catalyst: `Phase 1 factor consensus: ${models.join(", ")}. Growth, quality, value, dividend, accumulation and innovation evidence remain visible in the signed research case.`,
      unmeasured: candidate.failedGates ?? [],
      sourceModels: models,
      sourceKind: "RESEARCH_OS_PHASE_1" as const,
    }];
  });

  return {
    proposals,
    universeSize: universe.length,
    analyzed: result.stats.analyzed,
    rejected: result.candidates.length - eligible.length,
    warnings: result.warnings,
    models: MODE_ORDER,
    methodology: "Sentinel Research OS Phase 1 runs a balanced universe through every factor lens, ranks by multi-engine consensus and positive valuation upside, then hands qualified names to the Investment Team. Swing timing is a separate tactical lens.",
  };
}
