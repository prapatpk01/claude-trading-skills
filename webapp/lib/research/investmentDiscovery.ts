import { ENGINE_UNIVERSES, FACTOR_UNIVERSE, runFactorDiscovery, type FactorMode, type ResearchCandidate } from "@/lib/factorDiscovery";
import { buildTradePlan } from "@/lib/researchEnginePolicies";

const MODE_ORDER: FactorMode[] = ["multifactor", "growth", "quality", "value", "dividend", "institutional", "ai", "momentum"];
const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);

/**
 * Extra liquid US names that sit outside the legacy model universes. The goal is
 * breadth, not a permanent preference for any one theme. Detailed analysis still
 * runs in a bounded batch, rotated through this pool each research cycle.
 */
const EXPANDED_US_UNIVERSE = [
  "AAPL", "ACN", "ADI", "AMAT", "KLAC", "LRCX", "MCHP", "MPWR", "NXPI", "SNPS", "CDNS", "FTNT", "ZS", "MDB", "TEAM", "HUBS",
  "DIS", "SPOT", "RBLX", "TTWO", "EA", "T", "VZ",
  "BKNG", "ABNB", "RCL", "CCL", "NKE", "SBUX", "TGT", "ROST", "TJX", "ORLY", "AZO", "CVNA",
  "BRK.B", "BLK", "BX", "KKR", "APO", "COF", "AXP", "SCHW", "MS", "CME",
  "MRK", "AMGN", "GILD", "TMO", "DHR", "BSX", "SYK", "MDT", "ELV", "CI", "ZTS",
  "PH", "PWR", "URI", "GEV", "CARR", "TT", "HON", "WM", "RSG", "FAST", "PCAR",
  "SLB", "EOG", "MPC", "VLO", "OXY", "KMI", "WMB", "OKE",
  "PM", "MO", "CL", "MDLZ", "KMB", "GIS", "COST",
  "CEG", "VST", "NEE", "SO", "DUK",
  "PLD", "AMT", "EQIX", "WELL", "NNN",
  "LIN", "FCX", "NUE", "SHW",
  "DECK", "LULU", "ULTA", "CMG", "DPZ", "MAR", "HLT",
  "ALAB", "NBIS", "CRWV", "HWM", "PANW", "ADSK", "WDAY", "INTU", "ADP", "FI", "CTAS", "FICO",
];

export type InvestmentResearchProposal = {
  ticker: string; setupType: string; score: number; coveragePct: number; price: number;
  entryLow: number; entryHigh: number; stop: number; target: number; riskReward: number;
  expectedReturnPct: number; thesis: string; catalyst: string; unmeasured: string[];
  sourceModels: string[]; sourceKind: "RESEARCH_OS_PHASE_1";
  factors: {
    momentum: number; growth: number; quality: number; value: number;
    dividend: number; institutional: number; ai: number; composite: number;
  };
};

function balancedUniverse(limit = 240) {
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
  for (const ticker of [...FACTOR_UNIVERSE, ...EXPANDED_US_UNIVERSE]) {
    if (output.length >= limit) break;
    if (!seen.has(ticker)) { seen.add(ticker); output.push(ticker); }
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

/** Rotate the expensive detailed pass through the full US pool instead of re-reading the same first names forever. */
function rotatingDetailedUniverse(universe: string[], limit: number) {
  if (universe.length <= limit) return universe;
  const now = new Date();
  const dayKey = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const block = Math.floor(now.getUTCHours() / 6);
  const start = Math.abs((dayKey * 17 + block * 11) % universe.length);
  const out: string[] = [];
  for (let i = 0; i < universe.length && out.length < limit; i++) out.push(universe[(start + i) % universe.length]);
  return out;
}

export async function runInvestmentResearchOS(options: { exclude?: Iterable<string>; topN?: number; universeLimit?: number } = {}) {
  const excluded = new Set(Array.from(options.exclude ?? [], value => String(value).toUpperCase()));
  const broadUniverse = balancedUniverse(240).filter(ticker => !excluded.has(ticker) && !RESERVES.has(ticker));
  const detailedLimit = Math.max(16, Math.min(40, options.universeLimit ?? 40));
  const universe = rotatingDetailedUniverse(broadUniverse, detailedLimit);
  const result = await runFactorDiscovery("multifactor", universe, universe.length);
  const eligible = result.candidates
    .filter(candidate => (candidate.passed || (candidate.consensusCount ?? 0) >= 2) && candidate.price != null && candidate.price > 0)
    .filter(candidate => candidate.targetPrice != null && candidate.targetPrice > candidate.price! && (candidate.expectedReturnPct ?? -Infinity) >= 5)
    .sort((left, right) => rank(right) - rank(left))
    .slice(0, options.topN ?? 10);

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
      factors: {
        momentum: candidate.momentum,
        growth: candidate.growth,
        quality: candidate.quality,
        value: candidate.value,
        dividend: candidate.dividend,
        institutional: candidate.institutional,
        ai: candidate.ai,
        composite: candidate.composite,
      },
    }];
  });

  return {
    proposals,
    universeSize: broadUniverse.length,
    detailedUniverseSize: universe.length,
    analyzed: result.stats.analyzed,
    qualified: eligible.length,
    rejected: result.candidates.length - eligible.length,
    warnings: result.warnings,
    models: MODE_ORDER,
    rotationCoverageCycles: Math.max(1, Math.ceil(broadUniverse.length / Math.max(1, universe.length))),
    methodology: `Sentinel Research OS V21 maintains a broad US pool of ${broadUniverse.length} names and rotates a ${universe.length}-name institutional deep-dive through every factor lens each cycle. At the current cadence the full pool is revisited in roughly ${Math.max(1, Math.ceil(broadUniverse.length / Math.max(1, universe.length)))} rotations. It ranks by multi-engine consensus and positive valuation upside; Swing timing remains a separate tactical lens.`,
  };
}
