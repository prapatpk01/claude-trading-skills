import { runFactorDiscovery, type ResearchCandidate } from "@/lib/factorDiscovery";
import { buildFundResearchEvidence } from "@/lib/research/fundResearchEvidence";
import { lifecycleDiscoveryTier } from "@/lib/research/lifecycleDiscoveryPolicy";
import { buildMarketLeadershipMap, sectorLeadershipFor } from "@/lib/research/marketLeadership";
import { loadThreeIndexUniverse, MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT } from "@/lib/research/marketUniverse";
import { fastScanApprovedUniverse, type FastUniverseRow } from "@/lib/research/universeFastScan";
import {
  INV_RESEARCH_V39,
  buildMomentumDiscoveryRowV39,
  buildThesisDiscoveryRowV39,
  mergeDiscoveryRowsV39,
  rankDiscoveryRowsV39,
  type DeepCandidateV39,
  type DiscoveryRowV39,
  type MomentumSeedV39,
  type SectorReadV39,
  type ThesisEvidenceV39,
} from "@/lib/research/dualDiscoveryPolicyV39";

export type DualDiscoveryOptionsV39 = {
  topN?: number;
  allowedTickers?: Iterable<string>;
  thesisTickers?: Iterable<string>;
};

export type DualDiscoveryResultV39 = {
  version: typeof INV_RESEARCH_V39;
  asOf: string;
  status: "READY" | "DATA_LIMITED";
  universe: {
    source: string;
    approvedSize: number;
    requested: number;
    scanned: number;
    coveragePct: number;
    minimumCoveragePct: number;
    provider: string;
  };
  market: Awaited<ReturnType<typeof buildMarketLeadershipMap>>;
  momentum: DiscoveryRowV39[];
  thesis: DiscoveryRowV39[];
  combined: Array<DiscoveryRowV39 & { lanes: Array<"MOMENTUM" | "THESIS"> }>;
  stats: {
    momentumSeeds: number;
    momentumDeepAnalyzed: number;
    thesisSeeds: number;
    thesisDeepAnalyzed: number;
    thesisUnderwritten: number;
    committeeReady: number;
  };
  warnings: string[];
  methodology: string;
};

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);
const MOMENTUM_DEEP_LIMIT = 20;
const THESIS_DEEP_LIMIT = 24;
const THESIS_UNDERWRITE_LIMIT = 14;

const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function uniqueTickers(values: Iterable<string>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ticker = clean(value);
    if (!TICKER.test(ticker) || RESERVES.has(ticker) || seen.has(ticker)) continue;
    seen.add(ticker); out.push(ticker);
  }
  return out;
}

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

function momentumSeedRows(rows: FastUniverseRow[], limit: number) {
  const primary = rows.filter(row => ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(row.stage) && row.score >= 52);
  const mature = rows.filter(row => row.stage === "MATURE" && row.score >= 62 && row.rs3m >= 0);
  const unconfirmed = rows.filter(row => row.stage === "UNCONFIRMED" && row.score >= 62 && row.rs3m >= 2 && row.aboveEma20 && row.aboveEma50);
  return [...primary, ...mature, ...unconfirmed]
    .filter((row, index, all) => all.findIndex(item => item.ticker === row.ticker) === index)
    .sort((a, b) => b.score - a.score || b.rs3m - a.rs3m || b.return1m - a.return1m)
    .slice(0, limit);
}

function asMomentumSeed(row: FastUniverseRow): MomentumSeedV39 {
  return {
    ticker: row.ticker,
    score: row.score,
    stage: row.stage,
    price: row.price,
    return1w: row.return1w,
    return1m: row.return1m,
    return3m: row.return3m,
    rs3m: row.rs3m,
    volumeRatio: row.volumeRatio,
    aboveEma20: row.aboveEma20,
    aboveEma50: row.aboveEma50,
    ema20Above50: row.ema20Above50,
  };
}

function deepCandidate(row: ResearchCandidate | undefined | null): DeepCandidateV39 | null {
  if (!row) return null;
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    price: row.price,
    targetPrice: row.targetPrice,
    expectedReturnPct: row.expectedReturnPct,
    momentum: row.momentum,
    institutional: row.institutional,
    growth: row.growth,
    quality: row.quality,
    composite: row.composite,
    passed: row.passed,
    valuationReady: row.valuationReady,
    lifecycle: row.lifecycle,
    failedGates: row.failedGates,
    reasons: row.reasons,
    thesis: row.thesis,
    dataQuality: row.dataQuality,
  };
}

function sectorRead(candidate: ResearchCandidate, market: Awaited<ReturnType<typeof buildMarketLeadershipMap>>): SectorReadV39 | null {
  const leadership = sectorLeadershipFor(candidate.sector, market);
  if (!leadership) return null;
  return {
    sector: leadership.sector,
    score: leadership.score,
    status: leadership.status,
    rank: leadership.rank,
    relative1m: leadership.relative1m,
    relative3m: leadership.relative3m,
  };
}

function thesisPreRank(candidate: ResearchCandidate, market: Awaited<ReturnType<typeof buildMarketLeadershipMap>>) {
  const leadership = sectorLeadershipFor(candidate.sector, market);
  const sector = leadership?.score ?? 50;
  const stageBonus = ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(String(candidate.lifecycle?.stage ?? "").toUpperCase()) ? 8 : 0;
  return candidate.composite * .28 + candidate.momentum * .24 + candidate.growth * .14 + candidate.quality * .12 + candidate.institutional * .08 + sector * .14 + stageBonus;
}

function committeeReadyCount(rows: DiscoveryRowV39[]) {
  return new Set(rows.filter(row => row.committeeReady).map(row => row.ticker)).size;
}

export async function runDualDiscoveryV39(options: DualDiscoveryOptionsV39 = {}): Promise<DualDiscoveryResultV39> {
  const topN = Math.max(3, Math.min(20, options.topN ?? 10));
  const approved = await loadThreeIndexUniverse();
  const approvedSet = new Set(approved.masterTickers);
  const requestedTickers = options.allowedTickers
    ? uniqueTickers(options.allowedTickers).filter(ticker => approvedSet.has(ticker))
    : approved.masterTickers.filter(ticker => !RESERVES.has(ticker));
  if (!requestedTickers.length) throw new Error("No securities remain inside the CIO-approved S&P 500 + Nasdaq-100 + Russell 2000 research universe.");

  const [fast, market] = await Promise.all([
    fastScanApprovedUniverse(requestedTickers),
    buildMarketLeadershipMap(),
  ]);
  const coverageReady = fast.coveragePct >= MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT;
  const warnings = [
    ...approved.warnings,
    ...fast.warnings.map(warning => `Momentum Radar: ${warning}`),
    ...market.warnings.map(warning => `Thesis Radar: ${warning}`),
  ];
  if (!coverageReady) warnings.push(`Full-universe measured coverage is ${fast.coveragePct}%, below the ${MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT}% decision floor. Discovery results remain visible, but committee readiness is data-limited.`);

  const momentumSeeds = momentumSeedRows(fast.rows, Math.max(MOMENTUM_DEEP_LIMIT, topN * 2));
  const momentumDeepTickers = momentumSeeds.slice(0, MOMENTUM_DEEP_LIMIT).map(row => row.ticker);
  const momentumDeepResult = momentumDeepTickers.length
    ? await runFactorDiscovery("momentum", momentumDeepTickers, momentumDeepTickers.length)
    : { candidates: [] as ResearchCandidate[], warnings: [] as string[] };
  warnings.push(...(momentumDeepResult.warnings ?? []).map(warning => `Momentum deep research: ${warning}`));
  const momentumDeepByTicker = new Map<string, ResearchCandidate>(
    (momentumDeepResult.candidates ?? []).map((row): [string, ResearchCandidate] => [row.ticker, row]),
  );
  const momentumRows = rankDiscoveryRowsV39(momentumSeeds.map(seed => buildMomentumDiscoveryRowV39({
    seed: asMomentumSeed(seed),
    candidate: deepCandidate(momentumDeepByTicker.get(seed.ticker)),
    coverageReady,
  })), topN);

  const optionThesis = uniqueTickers(options.thesisTickers ?? []).filter(ticker => approvedSet.has(ticker) && requestedTickers.includes(ticker));
  const focusTickers = market.focusTickers.filter(ticker => requestedTickers.includes(ticker));
  const thesisSeeds = uniqueTickers([
    ...optionThesis,
    ...focusTickers,
    ...momentumSeeds.slice(0, Math.max(12, topN)).map(row => row.ticker),
  ]).slice(0, THESIS_DEEP_LIMIT);
  const thesisDeepResult = thesisSeeds.length
    ? await runFactorDiscovery("multifactor", thesisSeeds, thesisSeeds.length)
    : { candidates: [] as ResearchCandidate[], warnings: [] as string[] };
  warnings.push(...(thesisDeepResult.warnings ?? []).map(warning => `Thesis deep research: ${warning}`));
  const thesisCandidates: ResearchCandidate[] = [...(thesisDeepResult.candidates ?? [])]
    .sort((a, b) => thesisPreRank(b, market) - thesisPreRank(a, market))
    .slice(0, THESIS_UNDERWRITE_LIMIT);

  const underwritten = await mapLimit(thesisCandidates, 3, async candidate => {
    try {
      const evidence = await buildFundResearchEvidence(candidate, {
        discoveryTier: lifecycleDiscoveryTier(candidate.lifecycle.stage),
        marketFitScore: sectorLeadershipFor(candidate.sector, market)?.score ?? 50,
      });
      return { candidate, evidence: evidence as ThesisEvidenceV39 };
    } catch (error: any) {
      warnings.push(`Thesis underwriting ${candidate.ticker}: ${error?.message ?? "evidence unavailable"}`);
      return { candidate, evidence: null as ThesisEvidenceV39 | null };
    }
  });

  const thesisRows = rankDiscoveryRowsV39(underwritten.map(({ candidate, evidence }) => buildThesisDiscoveryRowV39({
    candidate: deepCandidate(candidate)!,
    sector: sectorRead(candidate, market),
    evidence,
    coverageReady,
  })), topN);

  const combined = mergeDiscoveryRowsV39(momentumRows, thesisRows, Math.max(topN, 12));
  return {
    version: INV_RESEARCH_V39,
    asOf: new Date().toISOString(),
    status: coverageReady ? "READY" : "DATA_LIMITED",
    universe: {
      source: approved.masterSource,
      approvedSize: approved.masterUniverseSize,
      requested: fast.requested,
      scanned: fast.scanned,
      coveragePct: fast.coveragePct,
      minimumCoveragePct: MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT,
      provider: fast.provider,
    },
    market,
    momentum: momentumRows,
    thesis: thesisRows,
    combined,
    stats: {
      momentumSeeds: momentumSeeds.length,
      momentumDeepAnalyzed: momentumDeepResult.candidates?.length ?? 0,
      thesisSeeds: thesisSeeds.length,
      thesisDeepAnalyzed: thesisDeepResult.candidates?.length ?? 0,
      thesisUnderwritten: underwritten.length,
      committeeReady: committeeReadyCount([...momentumRows, ...thesisRows]),
    },
    warnings: Array.from(new Set(warnings)),
    methodology: "INV Research V39 uses two independent discovery lanes. Momentum Hunt searches the measured approved three-index universe by price/volume momentum, relative strength, EMA trend and lifecycle and does NOT require valuation or the strict factor gate merely to surface a candidate. Thesis Hunt starts from leading/improving sectors, user-selected themes and strong Momentum Radar names, then deep-researches catalyst, fund fit, growth/quality and lifecycle. Valuation and strict underwriting are required only for COMMITTEE_READY, not for discovery visibility. Research remains limited to S&P 500 + Nasdaq-100 + Russell 2000 and never executes trades.",
  };
}
