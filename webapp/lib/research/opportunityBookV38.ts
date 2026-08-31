export const INV_RESEARCH_V38 = "38.0" as const;

export type OpportunityStateV38 = "DISCOVERED" | "WATCH" | "READY" | "INVALIDATED" | "ARCHIVED";
export type OpportunityReviewStateV38 = "CONFIRMED" | "COOLING" | "INVALIDATED" | "EXPIRED";

export type OpportunityInputV38 = {
  ticker: string;
  sector: string;
  sectorLeadershipScore: number | null;
  sectorLeadershipStatus: string | null;
  sectorRank: number | null;
  sectorRelative1m?: number | null;
  sectorRelative3m?: number | null;
  stockRs3m?: number | null;
  expectedReturnPct: number | null;
  lifecycleStage: string;
  lifecycleScore: number | null;
  preferredEntryStage?: boolean;
  marketFitScore?: number | null;
  factors?: {
    momentum?: number | null;
    growth?: number | null;
    quality?: number | null;
    value?: number | null;
    dividend?: number | null;
    institutional?: number | null;
    ai?: number | null;
    composite?: number | null;
  } | null;
  researchEvidence?: any;
  sourceModels?: string[];
  isProposal: boolean;
  source?: string | null;
};

export type OpportunityScoreV38 = {
  opportunityScore: number;
  confidenceScore: number;
  theme: string;
  horizonDays: number;
  reviewCadenceDays: number;
  hardInvalidation: boolean;
  hardBlocks: string[];
  components: {
    sectorTheme: number;
    thesisCatalyst: number;
    momentum: number;
    relativeStrength: number;
    growthQuality: number;
    valuationAlpha: number;
    entryQuality: number;
  };
};

export type OpportunityBookRowV38 = OpportunityScoreV38 & {
  version: typeof INV_RESEARCH_V38;
  ticker: string;
  sector: string;
  sectorLeadershipStatus: string | null;
  sectorLeadershipScore: number | null;
  sectorRank: number | null;
  lifecycleStage: string;
  expectedReturnPct: number | null;
  state: OpportunityStateV38;
  reviewState: OpportunityReviewStateV38;
  firstDiscoveredAt: string;
  lastReviewedAt: string;
  nextReviewAt: string;
  expiresAt: string;
  thesisAgeDays: number;
  daysRemaining: number;
  belowThresholdCount: number;
  consecutiveMisses: number;
  scoreDelta: number | null;
  winnerRank: number | null;
  winnerCount: number | null;
  thesis: string;
  catalyst: string;
  whyNow: string;
  invalidation: string;
  source: string | null;
};

export type ThemeSummaryV38 = {
  theme: string;
  sector: string;
  state: "LEADING" | "IMPROVING" | "ACTIVE" | "COOLING";
  opportunityScore: number;
  confidenceScore: number;
  leaders: string[];
  ready: number;
  watch: number;
  horizonMinDays: number;
  horizonMaxDays: number;
};

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const avg = (values: Array<number | null | undefined>, fallback = 0) => {
  const clean = values.map(finite).filter((value): value is number => value != null);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : fallback;
};
const addDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString();
const daysBetween = (fromIso: string, toIso: string) => Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000));

export function deriveThemeV38(input: Pick<OpportunityInputV38, "sector" | "researchEvidence">): string {
  const evidence = input.researchEvidence ?? {};
  const text = `${evidence?.thesis?.base ?? ""} ${evidence?.thesis?.whyNow ?? ""} ${evidence?.catalyst?.note ?? ""}`.toUpperCase();
  if (/AI|ARTIFICIAL INTELLIGENCE|DATA[ -]?CENTER|GPU|SEMICONDUCT|CHIP|ACCELERATOR/.test(text)) return "AI Infrastructure";
  if (/GRID|POWER|ELECTRIC|NUCLEAR|UTILITY|DATACENTER POWER|ENERGY DEMAND/.test(text)) return "Power & Grid Capex";
  if (/DEFEN[CS]E|AEROSPACE|MISSILE|MILITARY/.test(text)) return "Defense & Aerospace";
  if (/RATE CUT|INTEREST RATE|CAPITAL MARKET|BROKER|BANK|CREDIT|M&A|IPO/.test(text)) return "Capital Markets & Rates";
  if (/GOLD|COPPER|METAL|MINING|COMMODIT/.test(text)) return "Metals Cycle";
  if (/OBESITY|GLP-1|DRUG|BIOTECH|PHARMA|HEALTHCARE|MEDICAL/.test(text)) return "Healthcare Innovation";
  if (/CYBER|CLOUD|SOFTWARE|SAAS|SUBSCRIPTION/.test(text)) return "Software / Cloud";
  if (/CONSUMER|RETAIL|TRAVEL|BOOKING|APPAREL/.test(text)) return "Consumer Strength";
  const sector = String(input.sector || "Market").trim();
  return `${sector || "Market"} Leadership`;
}

function catalystQualityScore(evidence: any): number {
  const quality = String(evidence?.catalyst?.quality ?? "UNAVAILABLE").toUpperCase();
  if (quality === "MEASURED") return 90;
  if (quality === "PARTIAL") return 58;
  return 25;
}

function valuationConfidenceScore(input: OpportunityInputV38): number {
  const text = String((input as any)?.valuationConfidence ?? input?.researchEvidence?.valuationConfidence ?? "").toUpperCase();
  if (text === "HIGH") return 90;
  if (text === "MEDIUM") return 70;
  if (text === "LOW") return 45;
  return 35;
}

function horizonFor(input: OpportunityInputV38, opportunityScore: number, catalystScore: number): number {
  const stage = String(input.lifecycleStage ?? "").toUpperCase();
  const earningsDate = input.researchEvidence?.catalyst?.nextEarningsDate;
  if (earningsDate) {
    const days = daysBetween(new Date().toISOString(), String(earningsDate));
    if (days <= 30) return Math.max(14, Math.min(45, days + 7));
  }
  const sectorHot = ["LEADING", "IMPROVING"].includes(String(input.sectorLeadershipStatus ?? "").toUpperCase());
  if (sectorHot && catalystScore >= 70 && opportunityScore >= 75) return 90;
  if (stage === "ACCUMULATION" || stage === "EARLY_MARKUP") return 60;
  if (stage === "MOMENTUM_EXPANSION") return 45;
  if (stage === "MATURE") return 21;
  return 30;
}

export function scoreOpportunityV38(input: OpportunityInputV38): OpportunityScoreV38 {
  const evidence = input.researchEvidence ?? {};
  const sectorRaw = clamp(finite(input.sectorLeadershipScore) ?? 50);
  const catalystRaw = finite(evidence?.catalyst?.score);
  const fundFit = clamp(finite(evidence?.fundFit?.score) ?? 50);
  const thesisRaw = clamp((catalystRaw ?? 45) * .65 + fundFit * .35);
  const momentumRaw = clamp(finite(input.factors?.momentum) ?? finite(evidence?.quant?.momentum) ?? 50);
  const stockRs = finite(input.stockRs3m);
  const sectorRs = avg([input.sectorRelative1m, input.sectorRelative3m], 0);
  const relativeRaw = clamp(50 + (stockRs ?? 0) * 1.8 + sectorRs * .7);
  const growthQualityRaw = clamp(avg([input.factors?.growth, input.factors?.quality], 50));
  const expected = finite(input.expectedReturnPct);
  const valuationRoomRaw = clamp(45 + (expected ?? 0) * 2.1);
  const valueRaw = clamp(finite(input.factors?.value) ?? 50);
  const valuationAlphaRaw = clamp(valueRaw * .45 + valuationRoomRaw * .55);
  const structureScore = finite(evidence?.structure?.score) ?? 50;
  const lifecycle = clamp(finite(input.lifecycleScore) ?? 50);
  const entryRaw = clamp(structureScore * .55 + lifecycle * .45 + (input.preferredEntryStage ? 8 : 0));

  const components = {
    sectorTheme: sectorRaw / 100 * 20,
    thesisCatalyst: thesisRaw / 100 * 20,
    momentum: momentumRaw / 100 * 20,
    relativeStrength: relativeRaw / 100 * 15,
    growthQuality: growthQualityRaw / 100 * 10,
    valuationAlpha: valuationAlphaRaw / 100 * 10,
    entryQuality: entryRaw / 100 * 5,
  };
  const opportunityScore = Math.round(clamp(Object.values(components).reduce((sum, value) => sum + value, 0)));

  const models = Array.isArray(input.sourceModels) ? input.sourceModels.length : 0;
  const modelCoverage = clamp(models / 7 * 100);
  const catalystCoverage = catalystQualityScore(evidence);
  const valuationCoverage = valuationConfidenceScore(input);
  const evidenceCoverage = clamp(
    fundFit * .25 +
    lifecycle * .15 +
    structureScore * .15 +
    catalystCoverage * .15 +
    valuationCoverage * .15 +
    modelCoverage * .10 +
    (finite(input.sectorLeadershipScore) != null ? 100 : 30) * .05,
  );
  const hardBlocks = Array.isArray(evidence?.fundFit?.hardBlocks) ? evidence.fundFit.hardBlocks.map(String) : [];
  const hardInvalidation = hardBlocks.length > 0 || ["WEAKENING", "BROKEN"].includes(String(input.lifecycleStage ?? "").toUpperCase());
  const confidenceScore = Math.round(hardInvalidation ? Math.min(49, evidenceCoverage) : evidenceCoverage);
  const horizonDays = horizonFor(input, opportunityScore, catalystRaw ?? 45);
  const reviewCadenceDays = opportunityScore >= 75 ? 3 : opportunityScore >= 60 ? 7 : 14;

  return {
    opportunityScore,
    confidenceScore,
    theme: deriveThemeV38(input),
    horizonDays: Math.max(14, Math.min(90, horizonDays)),
    reviewCadenceDays,
    hardInvalidation,
    hardBlocks,
    components,
  };
}

function desiredState(input: OpportunityInputV38, score: OpportunityScoreV38): OpportunityStateV38 {
  if (score.hardInvalidation) return "INVALIDATED";
  if (input.isProposal && score.opportunityScore >= 72 && score.confidenceScore >= 60) return "READY";
  if (score.opportunityScore >= 58 && score.confidenceScore >= 50) return "WATCH";
  return "DISCOVERED";
}

function stateRank(state: OpportunityStateV38) {
  return state === "READY" ? 4 : state === "WATCH" ? 3 : state === "DISCOVERED" ? 2 : state === "INVALIDATED" ? 1 : 0;
}

function nextStateWithHysteresis(previous: OpportunityBookRowV38 | undefined, desired: OpportunityStateV38, belowCount: number): OpportunityStateV38 {
  if (!previous || desired === "INVALIDATED" || desired === "ARCHIVED") return desired;
  if (stateRank(desired) >= stateRank(previous.state)) return desired;
  // One weak review is not enough to erase a thesis. Require two consecutive
  // below-threshold reviews before a downgrade.
  return belowCount < 2 ? previous.state : desired;
}

export function buildCurrentOpportunityRowV38(input: OpportunityInputV38, previous: OpportunityBookRowV38 | undefined, asOf: string): OpportunityBookRowV38 {
  const score = scoreOpportunityV38(input);
  const desired = desiredState(input, score);
  const previousScore = previous?.opportunityScore ?? null;
  const belowThresholdCount = previous && stateRank(desired) < stateRank(previous.state)
    ? (previous.belowThresholdCount ?? 0) + 1
    : 0;
  const state = nextStateWithHysteresis(previous, desired, belowThresholdCount);
  const firstDiscoveredAt = previous?.firstDiscoveredAt ?? asOf;
  const expiresAt = previous && previous.theme === score.theme && new Date(previous.expiresAt).getTime() > new Date(asOf).getTime()
    ? previous.expiresAt
    : addDays(asOf, score.horizonDays);
  const thesisAgeDays = daysBetween(firstDiscoveredAt, asOf);
  const daysRemaining = Math.max(0, daysBetween(asOf, expiresAt));
  const evidence = input.researchEvidence ?? {};
  return {
    ...score,
    version: INV_RESEARCH_V38,
    ticker: input.ticker,
    sector: input.sector,
    sectorLeadershipStatus: input.sectorLeadershipStatus,
    sectorLeadershipScore: input.sectorLeadershipScore,
    sectorRank: input.sectorRank,
    lifecycleStage: input.lifecycleStage,
    expectedReturnPct: input.expectedReturnPct,
    state,
    reviewState: score.hardInvalidation ? "INVALIDATED" : belowThresholdCount > 0 ? "COOLING" : "CONFIRMED",
    firstDiscoveredAt,
    lastReviewedAt: asOf,
    nextReviewAt: addDays(asOf, score.reviewCadenceDays),
    expiresAt,
    thesisAgeDays,
    daysRemaining,
    belowThresholdCount,
    consecutiveMisses: 0,
    scoreDelta: previousScore == null ? null : score.opportunityScore - previousScore,
    winnerRank: null,
    winnerCount: null,
    thesis: String(evidence?.thesis?.base ?? "Thesis under review."),
    catalyst: String(evidence?.catalyst?.note ?? "Catalyst evidence unavailable."),
    whyNow: String(evidence?.thesis?.whyNow ?? `${input.lifecycleStage} within ${input.sector || "market"} leadership.`),
    invalidation: String(evidence?.thesis?.invalidation ?? score.hardBlocks[0] ?? "Re-underwrite if sector leadership or momentum structure breaks."),
    source: input.source ?? null,
  };
}

export function carryMissingOpportunityV38(previous: OpportunityBookRowV38, asOf: string): OpportunityBookRowV38 {
  const expired = new Date(previous.expiresAt).getTime() <= new Date(asOf).getTime();
  const misses = (previous.consecutiveMisses ?? 0) + 1;
  let state: OpportunityStateV38 = previous.state;
  let reviewState: OpportunityReviewStateV38 = "COOLING";
  if (expired) { state = "ARCHIVED"; reviewState = "EXPIRED"; }
  else if (misses >= 3) state = "ARCHIVED";
  else if (misses >= 2 && state === "READY") state = "WATCH";
  else if (misses >= 2 && state === "WATCH") state = "DISCOVERED";
  return {
    ...previous,
    state,
    reviewState,
    lastReviewedAt: asOf,
    nextReviewAt: addDays(asOf, state === "READY" ? 3 : state === "WATCH" ? 7 : 14),
    thesisAgeDays: daysBetween(previous.firstDiscoveredAt, asOf),
    daysRemaining: Math.max(0, daysBetween(asOf, previous.expiresAt)),
    consecutiveMisses: misses,
    belowThresholdCount: (previous.belowThresholdCount ?? 0) + 1,
  };
}

export function assignWinnerRanksV38(rows: OpportunityBookRowV38[]): OpportunityBookRowV38[] {
  const active = rows.filter(row => !["INVALIDATED", "ARCHIVED"].includes(row.state));
  const groups = new Map<string, OpportunityBookRowV38[]>();
  for (const row of active) {
    const group = groups.get(row.theme) ?? [];
    group.push(row);
    groups.set(row.theme, group);
  }
  const rankByTicker = new Map<string, { rank: number; count: number }>();
  for (const group of groups.values()) {
    group.sort((a, b) => (b.opportunityScore * .7 + b.confidenceScore * .3) - (a.opportunityScore * .7 + a.confidenceScore * .3) || a.ticker.localeCompare(b.ticker));
    group.forEach((row, index) => rankByTicker.set(row.ticker, { rank: index + 1, count: group.length }));
  }
  return rows.map(row => {
    const winner = rankByTicker.get(row.ticker);
    return { ...row, winnerRank: winner?.rank ?? null, winnerCount: winner?.count ?? null };
  });
}

export function reconcileOpportunityBookV38(current: OpportunityInputV38[], previousRows: OpportunityBookRowV38[], asOf = new Date().toISOString()): OpportunityBookRowV38[] {
  const previousByTicker = new Map(previousRows.map(row => [row.ticker, row]));
  const currentTickers = new Set<string>();
  const rows: OpportunityBookRowV38[] = [];
  for (const input of current) {
    const ticker = String(input.ticker ?? "").toUpperCase();
    if (!ticker || currentTickers.has(ticker)) continue;
    currentTickers.add(ticker);
    rows.push(buildCurrentOpportunityRowV38({ ...input, ticker }, previousByTicker.get(ticker), asOf));
  }
  for (const previous of previousRows) {
    if (currentTickers.has(previous.ticker)) continue;
    if (["INVALIDATED", "ARCHIVED"].includes(previous.state)) continue;
    rows.push(carryMissingOpportunityV38(previous, asOf));
  }
  return assignWinnerRanksV38(rows)
    .sort((a, b) => stateRank(b.state) - stateRank(a.state) || (b.opportunityScore * .7 + b.confidenceScore * .3) - (a.opportunityScore * .7 + a.confidenceScore * .3) || a.ticker.localeCompare(b.ticker));
}

export function buildThemeSummaryV38(book: OpportunityBookRowV38[]): ThemeSummaryV38[] {
  const active = book.filter(row => !["INVALIDATED", "ARCHIVED"].includes(row.state));
  const groups = new Map<string, OpportunityBookRowV38[]>();
  for (const row of active) {
    const group = groups.get(row.theme) ?? [];
    group.push(row);
    groups.set(row.theme, group);
  }
  return Array.from(groups.entries()).map(([theme, rows]) => {
    const sorted = [...rows].sort((a, b) => (b.opportunityScore * .7 + b.confidenceScore * .3) - (a.opportunityScore * .7 + a.confidenceScore * .3));
    const leader = sorted[0];
    const statuses = rows.map(row => String(row.sectorLeadershipStatus ?? "").toUpperCase());
    const state: ThemeSummaryV38["state"] = statuses.includes("LEADING") ? "LEADING" : statuses.includes("IMPROVING") ? "IMPROVING" : rows.some(row => row.reviewState === "COOLING") ? "COOLING" : "ACTIVE";
    return {
      theme,
      sector: leader?.sector ?? "Unknown",
      state,
      opportunityScore: Math.round(avg(rows.map(row => row.opportunityScore), 0)),
      confidenceScore: Math.round(avg(rows.map(row => row.confidenceScore), 0)),
      leaders: sorted.slice(0, 3).map(row => row.ticker),
      ready: rows.filter(row => row.state === "READY").length,
      watch: rows.filter(row => row.state === "WATCH").length,
      horizonMinDays: Math.min(...rows.map(row => row.horizonDays)),
      horizonMaxDays: Math.max(...rows.map(row => row.horizonDays)),
    };
  }).sort((a, b) => (b.opportunityScore * .7 + b.confidenceScore * .3) - (a.opportunityScore * .7 + a.confidenceScore * .3));
}

export function selectSectorThesisWinnersV38<T extends { ticker: string; sector?: string; opportunityScore?: number; confidenceScore?: number; persistentState?: OpportunityStateV38 }>(rows: T[], focusSectors: string[], topN: number): T[] {
  const focus = new Set(focusSectors.map(value => String(value).toUpperCase()));
  const score = (row: T) => Number(row.opportunityScore ?? 0) * .7 + Number(row.confidenceScore ?? 0) * .3 + (row.persistentState === "READY" ? 5 : row.persistentState === "WATCH" ? 2 : 0);
  const sorted = [...rows].sort((a, b) => score(b) - score(a) || a.ticker.localeCompare(b.ticker));
  const focusRows = sorted.filter(row => focus.has(String(row.sector ?? "").toUpperCase()));
  const radarRows = sorted.filter(row => !focus.has(String(row.sector ?? "").toUpperCase()));
  const focusQuota = Math.max(1, Math.ceil(topN * .8));
  const picked = [...focusRows.slice(0, focusQuota), ...radarRows.slice(0, Math.max(0, topN - Math.min(focusQuota, focusRows.length)))];
  const seen = new Set(picked.map(row => row.ticker));
  for (const row of sorted) {
    if (picked.length >= topN) break;
    if (seen.has(row.ticker)) continue;
    picked.push(row); seen.add(row.ticker);
  }
  return picked;
}
