import { ENGINE_UNIVERSES, FACTOR_UNIVERSE, runFactorDiscovery, type FactorMode, type ResearchCandidate } from "@/lib/factorDiscovery";
import { buildTradePlan } from "@/lib/researchEnginePolicies";
import { classifyMomentumLifecycle, type MomentumLifecycleRead, type MomentumLifecycleStage } from "@/lib/research/momentumLifecycle";
import { researchMandate } from "@/lib/research/researchMandates";

const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);
const EXPANDED_US_UNIVERSE = [
  "AAPL", "ACN", "ADI", "AMAT", "KLAC", "LRCX", "MCHP", "MPWR", "NXPI", "SNPS", "CDNS", "FTNT", "ZS", "MDB", "TEAM", "HUBS",
  "DIS", "SPOT", "RBLX", "TTWO", "EA", "T", "VZ", "BKNG", "ABNB", "RCL", "CCL", "NKE", "SBUX", "TGT", "ROST", "TJX", "ORLY", "AZO", "CVNA",
  "BRK.B", "BLK", "BX", "KKR", "APO", "COF", "AXP", "SCHW", "MS", "CME", "MRK", "AMGN", "GILD", "TMO", "DHR", "BSX", "SYK", "MDT", "ELV", "CI", "ZTS",
  "PH", "PWR", "URI", "GEV", "CARR", "TT", "HON", "WM", "RSG", "FAST", "PCAR", "SLB", "EOG", "MPC", "VLO", "OXY", "KMI", "WMB", "OKE",
  "PM", "MO", "CL", "MDLZ", "KMB", "GIS", "COST", "CEG", "VST", "NEE", "SO", "DUK", "PLD", "AMT", "EQIX", "WELL", "NNN",
  "LIN", "FCX", "NUE", "SHW", "DECK", "LULU", "ULTA", "CMG", "DPZ", "MAR", "HLT", "ALAB", "NBIS", "CRWV", "HWM", "PANW", "ADSK", "WDAY", "INTU", "ADP", "FI", "CTAS", "FICO",
];

export type ResearchEngineId =
  | "MOMENTUM_LIFECYCLE"
  | "INSTITUTIONAL_ACCUMULATION"
  | "GROWTH_ACCELERATION"
  | "QUALITY_LEADERSHIP"
  | "VALUATION_ROOM"
  | "CATALYST_AI"
  | "INCOME_MOMENTUM";

type SearchEngine = {
  id: ResearchEngineId;
  label: string;
  mode: FactorMode;
  purpose: string;
  priority: number;
};

export const RESEARCH_ENGINES: SearchEngine[] = [
  { id: "MOMENTUM_LIFECYCLE", label: "Momentum Lifecycle", mode: "momentum", priority: 1, purpose: "Find accumulation, early markup and healthy momentum expansion before the move becomes mature." },
  { id: "INSTITUTIONAL_ACCUMULATION", label: "Institutional Accumulation", mode: "institutional", priority: 2, purpose: "Find multi-day volume/relative-strength accumulation rather than one-day spikes." },
  { id: "GROWTH_ACCELERATION", label: "Growth Acceleration", mode: "growth", priority: 3, purpose: "Find revenue, earnings and margin acceleration that can sustain a momentum run." },
  { id: "QUALITY_LEADERSHIP", label: "Quality Leadership", mode: "quality", priority: 4, purpose: "Find profitable, cash-generative leaders with balance-sheet support." },
  { id: "VALUATION_ROOM", label: "Valuation Room-to-Run", mode: "value", priority: 5, purpose: "Find names where defensible fair value still leaves enough upside to justify new risk." },
  { id: "CATALYST_AI", label: "Catalyst / AI Theme", mode: "ai", priority: 6, purpose: "Find innovation and secular-theme leaders where catalysts can reinforce price momentum." },
  { id: "INCOME_MOMENTUM", label: "Income Momentum", mode: "dividend", priority: 7, purpose: "Find income names with sustainable distributions without ignoring trend and total return." },
];

export type InvestmentResearchProposal = {
  ticker: string; setupType: string; score: number; coveragePct: number; price: number;
  entryLow: number; entryHigh: number; stop: number; target: number; riskReward: number;
  expectedReturnPct: number; thesis: string; catalyst: string; unmeasured: string[];
  sourceModels: string[]; sourceKind: "RESEARCH_OS_PHASE_1";
  researchEngine: ResearchEngineId;
  researchEngineLabel: string;
  lifecycleStage: MomentumLifecycleStage;
  lifecycleScore: number;
  lifecycleReason: string;
  preferredEntryStage: boolean;
  selectionReason: string;
  searchBasis: string; searchBasisTh: string;
  investmentHorizon: string; investmentHorizonTh: string;
  reviewCadence: string; reviewCadenceTh: string;
  primaryEngine: string; discoveryEngines: string[];
  lifecycleEvidence: string[];
  valuationSource: string; valuationGapPct: number; researchStatus: "COMPLETE";
  factors: {
    momentum: number; growth: number; quality: number; value: number;
    dividend: number; institutional: number; ai: number; composite: number;
  };
};

type EngineCandidate = { engine: SearchEngine; candidate: ResearchCandidate; lifecycle: MomentumLifecycleRead };

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      out[index] = await fn(items[index]);
    }
  }));
  return out;
}

function balancedUniverse(limit = 240) {
  const modes: FactorMode[] = ["momentum", "institutional", "growth", "quality", "value", "ai", "dividend", "multifactor"];
  const output: string[] = [];
  const seen = new Set<string>();
  for (let row = 0; output.length < limit; row++) {
    let added = false;
    for (const mode of modes) {
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

function rotationKey() {
  const now = new Date();
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  return day * 4 + Math.floor(now.getUTCHours() / 6);
}

/** Give every discovery engine its own actual search list while keeping the total deep-dive budget bounded. */
function buildEngineUniverses(broad: string[], perEngine: number) {
  const assigned = new Set<string>();
  const key = rotationKey();
  return RESEARCH_ENGINES.map((engine, engineIndex) => {
    const preferred = [...ENGINE_UNIVERSES[engine.mode], ...broad];
    const unique = Array.from(new Set(preferred));
    const start = unique.length ? Math.abs((key * 11 + engineIndex * 17) % unique.length) : 0;
    const tickers: string[] = [];
    for (let i = 0; i < unique.length && tickers.length < perEngine; i++) {
      const ticker = unique[(start + i) % unique.length];
      if (assigned.has(ticker)) continue;
      assigned.add(ticker);
      tickers.push(ticker);
    }
    return { engine, tickers };
  });
}

function lifecycleFor(candidate: ResearchCandidate): MomentumLifecycleRead {
  const price = finite(candidate.price);
  const target = finite(candidate.targetPrice);
  const valuationGapPct = price != null && price > 0 && target != null && target > 0 ? (target / price - 1) * 100 : null;
  return classifyMomentumLifecycle({
    momentum: candidate.momentum,
    institutional: candidate.institutional,
    rs30: finite(candidate.metrics.rs30),
    volumeRatio: finite(candidate.metrics.volumeRatio),
    upDownVolume: finite(candidate.metrics.upDownVolume),
    return1m: finite(candidate.metrics.return1m),
    return3m: finite(candidate.metrics.return3m),
    aboveEma20: finite(candidate.metrics.aboveEma20) === 1,
    maFanning: finite(candidate.metrics.maFanning) === 1,
    valuationGapPct,
  });
}

function rank(row: EngineCandidate) {
  const c = row.candidate;
  const stageBonus: Record<MomentumLifecycleStage, number> = {
    ACCUMULATION: 28,
    EARLY_MARKUP: 34,
    MOMENTUM_EXPANSION: 24,
    MATURE: -18,
    WEAKENING: -45,
    BROKEN: -60,
    UNCONFIRMED: -12,
  };
  const primaryFactor = Number((c as any)[row.engine.mode] ?? c.composite) || 0;
  return row.lifecycle.score * .34 + c.momentum * .18 + c.institutional * .14 + c.composite * .13 + primaryFactor * .10 + Math.min(20, (c.expectedReturnPct ?? 0)) * .55 + (c.consensusCount ?? 0) * 2 + stageBonus[row.lifecycle.stage] - row.engine.priority * .25;
}

export async function runInvestmentResearchOS(options: { exclude?: Iterable<string>; topN?: number; universeLimit?: number } = {}) {
  const excluded = new Set(Array.from(options.exclude ?? [], value => String(value).toUpperCase()));
  const broadUniverse = balancedUniverse(240).filter(ticker => !excluded.has(ticker) && !RESERVES.has(ticker));
  const detailedLimit = Math.max(28, Math.min(42, options.universeLimit ?? 40));
  const perEngine = Math.max(4, Math.floor(detailedLimit / RESEARCH_ENGINES.length));
  const batches = buildEngineUniverses(broadUniverse, perEngine);

  // Phase 1 factor consensus remains an audit concept, but V23 now earns it from
  // separate discovery engines rather than one multifactor search with labels added later.
  const results = await mapLimit(batches, 2, async ({ engine, tickers }) => {
    const result = await runFactorDiscovery(engine.mode, tickers, tickers.length);
    return { engine, tickers, result };
  });

  const all: EngineCandidate[] = [];
  const warnings: string[] = [];
  for (const run of results) {
    warnings.push(...run.result.warnings.map(warning => `${run.engine.label}: ${warning}`));
    for (const candidate of run.result.candidates) all.push({ engine: run.engine, candidate, lifecycle: lifecycleFor(candidate) });
  }

  const eligible = all
    .filter(({ candidate, lifecycle }) => candidate.passed && lifecycle.preferredEntry && candidate.momentum >= 65 && candidate.price != null && candidate.price > 0)
    .filter(({ candidate }) => candidate.valuationReady && candidate.targetPrice != null && candidate.targetPrice > candidate.price! && (candidate.expectedReturnPct ?? -Infinity) >= 8)
    .sort((left, right) => rank(right) - rank(left))
    .slice(0, options.topN ?? 10);

  const proposals: InvestmentResearchProposal[] = eligible.flatMap(row => {
    const { candidate, engine, lifecycle } = row;
    const plan = buildTradePlan(engine.mode, candidate);
    const price = finite(candidate.price), target = finite(candidate.targetPrice);
    if (price == null || target == null || plan.entryLow == null || plan.entryHigh == null || plan.stopLoss == null) return [];
    const models = Array.from(new Set([engine.mode, ...(candidate.engines ?? [])]));
    const expected = candidate.expectedReturnPct ?? ((target / price) - 1) * 100;
    const mandate = researchMandate(engine.id);
    return [{
      ticker: candidate.ticker,
      setupType: `ACTIVE MOMENTUM · ${engine.label.toUpperCase()} · ${lifecycle.stage.replaceAll("_", " ")}`,
      score: Math.round(rank(row)),
      coveragePct: Math.min(100, Math.round((models.length / 7) * 100)),
      price,
      entryLow: plan.entryLow,
      entryHigh: plan.entryHigh,
      stop: plan.stopLoss,
      target,
      riskReward: plan.rewardRisk ?? Math.max(0, (target - price) / Math.max(.01, price - plan.stopLoss)),
      expectedReturnPct: expected,
      thesis: candidate.thesis,
      catalyst: `Phase 1 factor consensus: ${models.join(", ")}. ${engine.label}: ${engine.purpose} Lifecycle ${lifecycle.stage}; ${lifecycle.reason}`,
      unmeasured: candidate.failedGates ?? [],
      sourceModels: models,
      sourceKind: "RESEARCH_OS_PHASE_1" as const,
      researchEngine: engine.id,
      researchEngineLabel: engine.label,
      lifecycleStage: lifecycle.stage,
      lifecycleScore: lifecycle.score,
      lifecycleReason: lifecycle.reason,
      preferredEntryStage: lifecycle.preferredEntry,
      selectionReason: `${engine.label} selected ${candidate.ticker}; lifecycle ${lifecycle.stage}, momentum ${candidate.momentum}/100, accumulation proxy ${candidate.institutional}/100, expected valuation room ${expected.toFixed(1)}%.`,
      searchBasis: mandate.searchBasis,
      searchBasisTh: mandate.searchBasisTh,
      investmentHorizon: mandate.investmentHorizon,
      investmentHorizonTh: mandate.investmentHorizonTh,
      reviewCadence: mandate.reviewCadence,
      reviewCadenceTh: mandate.reviewCadenceTh,
      primaryEngine: engine.label,
      discoveryEngines: models.map(model => model.toUpperCase()),
      lifecycleEvidence: lifecycle.evidence,
      valuationSource: candidate.valuationSource,
      valuationGapPct: expected,
      researchStatus: "COMPLETE" as const,
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

  const engineReports = results.map(run => ({
    id: run.engine.id,
    label: run.engine.label,
    mode: run.engine.mode,
    purpose: run.engine.purpose,
    universe: run.tickers.length,
    analyzed: run.result.stats.analyzed,
    qualifiedByEngine: run.result.stats.qualified,
    selectedForActiveLifecycle: eligible.filter(row => row.engine.id === run.engine.id).length,
  }));
  const analyzed = results.reduce((sum, run) => sum + run.result.stats.analyzed, 0);
  const qualifiedByEngines = results.reduce((sum, run) => sum + run.result.stats.qualified, 0);

  return {
    proposals,
    universeSize: broadUniverse.length,
    detailedUniverseSize: analyzed,
    analyzed,
    qualified: proposals.length,
    engineQualified: qualifiedByEngines,
    rejected: Math.max(0, analyzed - proposals.length),
    warnings,
    models: RESEARCH_ENGINES.map(engine => engine.label),
    engineReports,
    engineDefinitions: RESEARCH_ENGINES.map(engine => ({ id: engine.id, name: engine.label, role: engine.priority <= 2 ? "PRIMARY" : engine.id === "VALUATION_ROOM" ? "MANDATORY GATE" : "CONFIRM", searches: engine.purpose, ...researchMandate(engine.id) })),
    engineStats: engineReports.map(report => ({ id: report.id, name: report.label, role: report.id === "VALUATION_ROOM" ? "MANDATORY GATE" : "INDEPENDENT", searches: report.purpose, qualified: report.selectedForActiveLifecycle, ...researchMandate(report.id) })),
    rotationCoverageCycles: Math.max(1, Math.ceil(broadUniverse.length / Math.max(1, analyzed))),
    methodology: `Sentinel Research OS V23 runs ${RESEARCH_ENGINES.length} independent engines with separate universes and evidence. The Active Momentum lifecycle prefers ACCUMULATION → EARLY MARKUP → MOMENTUM EXPANSION with Momentum ≥65. MATURE, WEAKENING, BROKEN and valuation-incomplete names are not new-buy candidates. A defensible Fair Value gap of at least 8% is mandatory before Committee review.`,
  };
}
