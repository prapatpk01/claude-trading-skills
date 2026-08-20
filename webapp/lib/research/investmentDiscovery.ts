import { runFactorDiscovery, type FactorMode, type ResearchCandidate } from "@/lib/factorDiscovery";
import { buildTradePlan } from "@/lib/researchEnginePolicies";
import { classifyMomentumLifecycle, type MomentumLifecycleRead, type MomentumLifecycleStage } from "@/lib/research/momentumLifecycle";
import { researchMandate } from "@/lib/research/researchMandates";
import { buildRotatingMarketUniverse, type ResearchRotationCadence, type RotatingResearchName } from "@/lib/research/marketUniverse";
import { buildMarketLeadershipMap, sectorLeadershipFor, type MarketLeadershipMap, type SectorLeadershipRow } from "@/lib/research/marketLeadership";
import {
  LIFECYCLE_DISCOVERY_POLICY_V25,
  lifecycleDiscoveryTier,
  isMatureFallbackStage,
  isPrimaryDiscoveryStage,
  selectLifecycleFirst,
  type LifecycleDiscoveryTier,
} from "@/lib/research/lifecycleDiscoveryPolicy";
import { buildFundResearchEvidence, type FundResearchEvidence } from "@/lib/research/fundResearchEvidence";

const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);
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
  { id: "MOMENTUM_LIFECYCLE", label: "Momentum Lifecycle", mode: "momentum", priority: 1, purpose: "Find ACCUMULATION, EARLY MARKUP and MOMENTUM EXPANSION first; MATURE is a fallback research lane only." },
  { id: "INSTITUTIONAL_ACCUMULATION", label: "Institutional Accumulation", mode: "institutional", priority: 2, purpose: "Find persistent price/volume accumulation rather than one-day spikes; this is a proxy until filing evidence confirms ownership." },
  { id: "GROWTH_ACCELERATION", label: "Growth Acceleration", mode: "growth", priority: 3, purpose: "Find revenue, earnings and margin acceleration capable of supporting the lifecycle move." },
  { id: "QUALITY_LEADERSHIP", label: "Quality Leadership", mode: "quality", priority: 4, purpose: "Find profitable, cash-generative leaders with balance-sheet support and durable underwriting." },
  { id: "VALUATION_ROOM", label: "Valuation Room-to-Run", mode: "value", priority: 5, purpose: "Require defensible Fair Value room before the fund commits new capital." },
  { id: "CATALYST_AI", label: "Catalyst / AI Theme", mode: "ai", priority: 6, purpose: "Measure earnings, event and secular-theme catalysts without substituting narrative for evidence." },
  { id: "INCOME_MOMENTUM", label: "Income Momentum", mode: "dividend", priority: 7, purpose: "Find income names with sustainable distributions, total-return support and healthy lifecycle evidence." },
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
  discoveryTier: Exclude<LifecycleDiscoveryTier, "NOT_ELIGIBLE">;
  researchEvidence: FundResearchEvidence;
  selectionReason: string;
  searchBasis: string; searchBasisTh: string;
  investmentHorizon: string; investmentHorizonTh: string;
  reviewCadence: string; reviewCadenceTh: string;
  primaryEngine: string; discoveryEngines: string[];
  lifecycleEvidence: string[];
  valuationSource: string; valuationGapPct: number; researchStatus: "COMPLETE";
  valuationConfidence: string; valuationBear: number | null; valuationBull: number | null;
  valuationAnchors: Array<{ method: string; fairValue: number; weight: number; detail: string }>;
  valuationAsOf: string | null; valuationExpiresAt: string | null; valuationModelRoute: string | null;
  rotationCadence: ResearchRotationCadence;
  universeSource: string;
  sector: string;
  sectorLeadershipScore: number;
  sectorLeadershipStatus: string;
  sectorRank: number | null;
  marketFitScore: number;
  factors: {
    momentum: number; growth: number; quality: number; value: number;
    dividend: number; institutional: number; ai: number; composite: number;
  };
};

export type InvestmentResearchQueueItem = {
  ticker: string;
  score: number;
  price: number | null;
  target: number | null;
  expectedReturnPct: number | null;
  thesis: string;
  researchEngine: ResearchEngineId;
  researchEngineLabel: string;
  lifecycleStage: MomentumLifecycleStage;
  lifecycleScore: number;
  lifecycleReason: string;
  lifecycleEvidence: string[];
  preferredEntryStage: boolean;
  discoveryTier: LifecycleDiscoveryTier;
  researchEvidence?: FundResearchEvidence;
  researchStatus: "COMPLETE" | "INCOMPLETE";
  valuationSource: string;
  valuationGapPct: number | null;
  failedGates: string[];
  valuationFailures: string[];
  valuationConfidence: string; valuationBear: number | null; valuationBull: number | null;
  valuationAnchors: Array<{ method: string; fairValue: number; weight: number; detail: string }>;
  valuationAsOf: string | null; valuationExpiresAt: string | null; valuationModelRoute: string | null;
  sourceModels: string[];
  rotationCadence: ResearchRotationCadence;
  universeSource: string;
  sector: string;
  sectorLeadershipScore: number;
  sectorLeadershipStatus: string;
  sectorRank: number | null;
  marketFitScore: number;
  searchBasis: string;
  searchBasisTh: string;
  investmentHorizon: string;
  investmentHorizonTh: string;
  reviewCadence: string;
  reviewCadenceTh: string;
  factors: InvestmentResearchProposal["factors"];
};

type EngineCandidate = {
  engine: SearchEngine;
  candidate: ResearchCandidate;
  lifecycle: MomentumLifecycleRead;
  leadership: SectorLeadershipRow | null;
  marketFitScore: number;
};

type UnderwrittenCandidate = EngineCandidate & {
  researchEvidence: FundResearchEvidence;
};

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

function buildEngineUniverses(queue: RotatingResearchName[]) {
  let cursor = 0;
  return RESEARCH_ENGINES.map((engine, engineIndex) => {
    const enginesLeft = RESEARCH_ENGINES.length - engineIndex;
    const count = Math.ceil((queue.length - cursor) / Math.max(1, enginesLeft));
    const scheduled = queue.slice(cursor, cursor + count);
    cursor += scheduled.length;
    return { engine, scheduled, tickers: scheduled.map(row => row.ticker) };
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
    ACCUMULATION: 30,
    EARLY_MARKUP: 36,
    MOMENTUM_EXPANSION: 25,
    MATURE: -14,
    WEAKENING: -48,
    BROKEN: -65,
    UNCONFIRMED: -16,
  };
  const primaryFactor = Number((c as any)[row.engine.mode] ?? c.composite) || 0;
  return row.lifecycle.score * .27 + c.momentum * .16 + c.institutional * .11 + c.composite * .11
    + primaryFactor * .08 + row.marketFitScore * .15 + Math.min(20, (c.expectedReturnPct ?? 0)) * .60
    + (c.consensusCount ?? 0) * 2 + stageBonus[row.lifecycle.stage] - row.engine.priority * .25;
}

function marketFit(leadership: SectorLeadershipRow | null, map: MarketLeadershipMap) {
  return Math.round((leadership?.score ?? 50) * .72 + map.sentimentScore * .28);
}

function signalPrioritizedQueue(base: RotatingResearchName[], leadership: MarketLeadershipMap, excluded: Set<string>, limit: number) {
  const priority = leadership.focusTickers
    .filter(ticker => !excluded.has(ticker))
    .map((ticker, index): RotatingResearchName => ({
      ticker,
      cadence: index < 10 ? "3D" : "7D",
      source: "MARKET_REGIME + SECTOR_LEADERSHIP",
    }));
  return [...priority, ...base]
    .filter((row, index, all) => all.findIndex(candidate => candidate.ticker === row.ticker) === index)
    .slice(0, limit);
}

function commonFundGate(row: EngineCandidate) {
  const { candidate, leadership } = row;
  return candidate.passed
    && candidate.momentum >= 65
    && candidate.price != null
    && candidate.price > 0
    && candidate.valuationReady
    && candidate.targetPrice != null
    && candidate.targetPrice > candidate.price
    && (candidate.expectedReturnPct ?? -Infinity) >= 8
    && ((leadership?.score ?? 50) >= 45 || candidate.composite >= 82);
}

async function underwrite(rows: EngineCandidate[]) {
  return mapLimit(rows, 3, async row => {
    const tier = lifecycleDiscoveryTier(row.lifecycle.stage);
    const researchEvidence = await buildFundResearchEvidence(row.candidate, {
      discoveryTier: tier,
      marketFitScore: row.marketFitScore,
    });
    return { ...row, researchEvidence } as UnderwrittenCandidate;
  });
}

export async function runInvestmentResearchOS(options: { exclude?: Iterable<string>; topN?: number; universeLimit?: number } = {}) {
  const excluded = new Set(Array.from(options.exclude ?? [], value => String(value).toUpperCase()));
  const topN = Math.max(1, options.topN ?? 10);
  const detailedLimit = Math.max(28, Math.min(42, options.universeLimit ?? 40));
  const [marketUniverse, marketLeadership] = await Promise.all([
    buildRotatingMarketUniverse({ exclude: [...excluded, ...RESERVES], detailedLimit }),
    buildMarketLeadershipMap(),
  ]);
  const researchQueueUniverse = signalPrioritizedQueue(marketUniverse.queue, marketLeadership, excluded, detailedLimit);
  const batches = buildEngineUniverses(researchQueueUniverse);
  const scheduledByTicker = new Map(researchQueueUniverse.map(row => [row.ticker, row]));

  const results = await mapLimit(batches, 2, async ({ engine, tickers, scheduled }) => {
    const result = await runFactorDiscovery(engine.mode, tickers, tickers.length);
    return { engine, tickers, scheduled, result };
  });

  const all: EngineCandidate[] = [];
  const warnings: string[] = [];
  for (const run of results) {
    warnings.push(...run.result.warnings.map(warning => `${run.engine.label}: ${warning}`));
    for (const candidate of run.result.candidates) {
      const leadership = sectorLeadershipFor(candidate.sector, marketLeadership);
      all.push({ engine: run.engine, candidate, lifecycle: lifecycleFor(candidate), leadership, marketFitScore: marketFit(leadership, marketLeadership) });
    }
  }

  const baseEligible = all.filter(commonFundGate).sort((left, right) => rank(right) - rank(left));
  const primaryForUnderwriting = baseEligible
    .filter(row => isPrimaryDiscoveryStage(row.lifecycle.stage))
    .slice(0, Math.max(topN * 2, 16));
  const matureForUnderwriting = baseEligible
    .filter(row => isMatureFallbackStage(row.lifecycle.stage))
    .filter(row => !row.lifecycle.nearFairValue && (row.candidate.expectedReturnPct ?? -Infinity) >= 12)
    .slice(0, Math.max(topN, 8));
  const underwritingTargets = [...primaryForUnderwriting, ...matureForUnderwriting]
    .filter((row, index, rows) => rows.findIndex(other => other.candidate.ticker === row.candidate.ticker) === index);
  const underwritten = await underwrite(underwritingTargets);

  const investable = underwritten.filter(row => {
    if (isPrimaryDiscoveryStage(row.lifecycle.stage)) {
      return row.researchEvidence.fundFit.hardBlocks.length === 0 && row.researchEvidence.fundFit.score >= 60;
    }
    return row.researchEvidence.fundFit.matureFallbackEligible;
  });

  const lifecycleSelection = selectLifecycleFirst(investable, {
    topN,
    getStage: row => row.lifecycle.stage,
    getScore: row => rank(row) + row.researchEvidence.fundFit.score * .25,
    matureEligible: row => row.researchEvidence.fundFit.matureFallbackEligible,
  });
  const eligible = lifecycleSelection.selected;
  const evidenceByTicker = new Map(underwritten.map(row => [row.candidate.ticker, row.researchEvidence]));

  const proposals: InvestmentResearchProposal[] = eligible.flatMap(row => {
    const { candidate, engine, lifecycle, leadership, researchEvidence, discoveryTier } = row;
    const plan = buildTradePlan(engine.mode, candidate);
    const price = finite(candidate.price), target = finite(candidate.targetPrice);
    if (price == null || target == null || plan.entryLow == null || plan.entryHigh == null || plan.stopLoss == null) return [];
    const models = Array.from(new Set([engine.mode, ...(candidate.engines ?? [])]));
    const expected = candidate.expectedReturnPct ?? ((target / price) - 1) * 100;
    const mandate = researchMandate(engine.id);
    const fallbackText = discoveryTier === "MATURE_FALLBACK"
      ? "MATURE fallback selected only because the primary lifecycle shortlist did not fill; this is a research/watch candidate and must not be chased."
      : "Primary lifecycle candidate.";
    return [{
      ticker: candidate.ticker,
      setupType: `ACTIVE MOMENTUM V25 · ${engine.label.toUpperCase()} · ${lifecycle.stage.replaceAll("_", " ")}`,
      score: Math.round(rank(row) + researchEvidence.fundFit.score * .25),
      coveragePct: Math.min(100, Math.round((models.length / 7) * 70 + researchEvidence.fundFit.score * .30)),
      price,
      entryLow: plan.entryLow,
      entryHigh: plan.entryHigh,
      stop: plan.stopLoss,
      target,
      riskReward: plan.rewardRisk ?? Math.max(0, (target - price) / Math.max(.01, price - plan.stopLoss)),
      expectedReturnPct: expected,
      thesis: researchEvidence.thesis.base,
      catalyst: `${researchEvidence.catalyst.note} ${engine.label}: ${engine.purpose}`,
      unmeasured: [...(candidate.failedGates ?? []), ...researchEvidence.fundFit.hardBlocks],
      sourceModels: models,
      sourceKind: "RESEARCH_OS_PHASE_1" as const,
      researchEngine: engine.id,
      researchEngineLabel: engine.label,
      lifecycleStage: lifecycle.stage,
      lifecycleScore: lifecycle.score,
      lifecycleReason: lifecycle.reason,
      preferredEntryStage: lifecycle.preferredEntry,
      discoveryTier,
      researchEvidence,
      selectionReason: `${fallbackText} ${engine.label} selected ${candidate.ticker}; lifecycle ${lifecycle.stage}, fund-fit ${researchEvidence.fundFit.score}/100, structure ${researchEvidence.structure.state}, Sentinel X ${researchEvidence.chart.sentinelX?.trend ?? "unavailable"}, MCDX proxy ${researchEvidence.chart.mcdxProxy?.state ?? "unavailable"}, expected valuation room ${expected.toFixed(1)}%.`,
      searchBasis: mandate.searchBasis,
      searchBasisTh: mandate.searchBasisTh,
      investmentHorizon: mandate.investmentHorizon,
      investmentHorizonTh: mandate.investmentHorizonTh,
      reviewCadence: mandate.reviewCadence,
      reviewCadenceTh: mandate.reviewCadenceTh,
      primaryEngine: engine.label,
      discoveryEngines: [...models.map(model => model.toUpperCase()), "SENTINEL X", "MCDX PROXY", "STRUCTURE", "CATALYST"],
      lifecycleEvidence: [...lifecycle.evidence, ...researchEvidence.structure.evidence.slice(0, 3)],
      valuationSource: candidate.valuationSource,
      valuationGapPct: expected,
      valuationConfidence: candidate.valuationConfidence,
      valuationBear: candidate.valuationBear,
      valuationBull: candidate.valuationBull,
      valuationAnchors: candidate.valuationAnchors,
      valuationAsOf: candidate.valuationAsOf,
      valuationExpiresAt: candidate.valuationExpiresAt,
      valuationModelRoute: candidate.valuationModelRoute,
      researchStatus: "COMPLETE" as const,
      rotationCadence: scheduledByTicker.get(candidate.ticker)?.cadence ?? "7D",
      universeSource: scheduledByTicker.get(candidate.ticker)?.source ?? marketUniverse.masterSource,
      sector: candidate.sector,
      sectorLeadershipScore: leadership?.score ?? 50,
      sectorLeadershipStatus: leadership?.status ?? "UNCONFIRMED",
      sectorRank: leadership?.rank ?? null,
      marketFitScore: row.marketFitScore,
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

  const proposalTickers = new Set(proposals.map(row => row.ticker));
  const researchQueue: InvestmentResearchQueueItem[] = all
    .filter(row => !proposalTickers.has(row.candidate.ticker))
    .filter(row => row.candidate.price != null && row.candidate.price > 0)
    .sort((left, right) => rank(right) - rank(left))
    .slice(0, Math.max(12, topN * 2))
    .map(({ candidate, engine, lifecycle, leadership, marketFitScore }) => {
      const mandate = researchMandate(engine.id);
      const schedule = scheduledByTicker.get(candidate.ticker);
      const target = finite(candidate.targetPrice);
      const expected = target != null && candidate.price != null && candidate.price > 0 ? (target / candidate.price - 1) * 100 : null;
      const sourceModels = Array.from(new Set([engine.mode, ...(candidate.engines ?? [])]));
      return {
        ticker: candidate.ticker,
        score: Math.round(rank({ candidate, engine, lifecycle, leadership, marketFitScore })),
        price: candidate.price,
        target,
        expectedReturnPct: expected,
        thesis: candidate.thesis,
        researchEngine: engine.id,
        researchEngineLabel: engine.label,
        lifecycleStage: lifecycle.stage,
        lifecycleScore: lifecycle.score,
        lifecycleReason: lifecycle.reason,
        lifecycleEvidence: lifecycle.evidence,
        preferredEntryStage: lifecycle.preferredEntry,
        discoveryTier: lifecycleDiscoveryTier(lifecycle.stage),
        researchEvidence: evidenceByTicker.get(candidate.ticker),
        researchStatus: target == null || !candidate.valuationReady ? "INCOMPLETE" as const : "COMPLETE" as const,
        valuationSource: target == null ? "UNAVAILABLE" : candidate.valuationSource,
        valuationGapPct: expected,
        failedGates: candidate.failedGates ?? [],
        valuationFailures: candidate.valuationFailures ?? [],
        valuationConfidence: candidate.valuationConfidence,
        valuationBear: candidate.valuationBear,
        valuationBull: candidate.valuationBull,
        valuationAnchors: candidate.valuationAnchors,
        valuationAsOf: candidate.valuationAsOf,
        valuationExpiresAt: candidate.valuationExpiresAt,
        valuationModelRoute: candidate.valuationModelRoute,
        sourceModels,
        rotationCadence: schedule?.cadence ?? "7D",
        universeSource: schedule?.source ?? marketUniverse.masterSource,
        sector: candidate.sector,
        sectorLeadershipScore: leadership?.score ?? 50,
        sectorLeadershipStatus: leadership?.status ?? "UNCONFIRMED",
        sectorRank: leadership?.rank ?? null,
        marketFitScore,
        searchBasis: mandate.searchBasis,
        searchBasisTh: mandate.searchBasisTh,
        investmentHorizon: mandate.investmentHorizon,
        investmentHorizonTh: mandate.investmentHorizonTh,
        reviewCadence: mandate.reviewCadence,
        reviewCadenceTh: mandate.reviewCadenceTh,
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
      };
    });

  const engineReports = results.map(run => ({
    id: run.engine.id,
    label: run.engine.label,
    mode: run.engine.mode,
    purpose: run.engine.purpose,
    universe: run.tickers.length,
    analyzed: run.result.stats.analyzed,
    qualifiedByEngine: run.result.stats.qualified,
    selectedForActiveLifecycle: proposals.filter(row => row.researchEngine === run.engine.id).length,
    rotationMix: Array.from(new Set(run.scheduled.map(row => row.cadence))),
  }));
  const analyzed = results.reduce((sum, run) => sum + run.result.stats.analyzed, 0);
  const qualifiedByEngines = results.reduce((sum, run) => sum + run.result.stats.qualified, 0);

  return {
    version: "25.0-lifecycle-first-fund-underwriting",
    proposals,
    researchQueue,
    lifecyclePolicy: {
      ...LIFECYCLE_DISCOVERY_POLICY_V25,
      primaryAvailable: lifecycleSelection.primaryAvailable,
      matureFallbackAvailable: lifecycleSelection.matureFallbackAvailable,
      primarySelected: lifecycleSelection.primarySelected,
      matureFallbackSelected: lifecycleSelection.matureFallbackSelected,
      fallbackUsed: lifecycleSelection.fallbackUsed,
    },
    universeSize: marketUniverse.masterUniverseSize,
    universeSource: marketUniverse.masterSource,
    rotationWindows: marketUniverse.windows,
    marketLeadership,
    scheduledUniverse: researchQueueUniverse,
    detailedUniverseSize: analyzed,
    analyzed,
    qualified: proposals.length,
    engineQualified: qualifiedByEngines,
    rejected: Math.max(0, analyzed - proposals.length),
    warnings: [...marketUniverse.warnings, ...marketLeadership.warnings, ...warnings],
    models: RESEARCH_ENGINES.map(engine => engine.label),
    engineReports,
    engineDefinitions: RESEARCH_ENGINES.map(engine => ({ id: engine.id, name: engine.label, role: engine.priority <= 2 ? "PRIMARY" : engine.id === "VALUATION_ROOM" ? "MANDATORY GATE" : "CONFIRM", searches: engine.purpose, ...researchMandate(engine.id) })),
    engineStats: engineReports.map(report => ({ id: report.id, name: report.label, role: report.id === "VALUATION_ROOM" ? "MANDATORY GATE" : "INDEPENDENT", searches: report.purpose, qualified: report.selectedForActiveLifecycle, ...researchMandate(report.id) })),
    rotationCoverageCycles: Math.max(1, Math.ceil(marketUniverse.masterUniverseSize / Math.max(1, analyzed))),
    methodology: `Sentinel Investment Research OS V25 searches the CIO-approved rotating market universe and prioritizes Momentum Lifecycle in this order: ACCUMULATION / EARLY_MARKUP / MOMENTUM_EXPANSION. MATURE is considered only when those primary stages do not fill the shortlist, and only after stricter Fair Value room, Sentinel X trend/room and MCDX price-volume distribution checks. Every shortlisted name receives a fund-aligned evidence pack covering Structure, Quant, Sentinel X, synthetic MCDX Proxy, Thesis, Catalyst and Fund Fit. New capital still requires Momentum ≥65, non-lagging sector alignment or exceptional idiosyncratic strength, defensible Fair Value gap ≥8%, funding, risk and CIO approval.`,
  };
}
