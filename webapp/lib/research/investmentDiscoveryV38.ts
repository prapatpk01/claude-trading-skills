import { getSupabaseAdmin } from "@/lib/supabase";
import { runInvestmentResearchOS as runLegacyInvestmentResearchOS } from "./investmentDiscovery";
import {
  INV_RESEARCH_V38,
  buildThemeSummaryV38,
  reconcileOpportunityBookV38,
  selectSectorThesisWinnersV38,
  type OpportunityBookRowV38,
  type OpportunityInputV38,
} from "./opportunityBookV38";

const CYCLE_SIGNAL = "INV_V38_CYCLE";
const BOOK_SIGNAL = "INV_V38_OPPORTUNITY";
const CYCLE_TICKER = "INV38_CYCLE";
const CYCLE_TTL_MS = 18 * 60 * 60 * 1000;
const BOOK_LOOKBACK_DAYS = 120;
const DEFAULT_BOOK_LIMIT = 20;

let memoryCycle: { createdAt: string; snapshot: any } | null = null;
let memoryBook: OpportunityBookRowV38[] = [];

type LegacyResult = Awaited<ReturnType<typeof runLegacyInvestmentResearchOS>>;
export type InvestmentResearchV38Result = LegacyResult & {
  version: string;
  legacyVersion: string | null;
  cycleMode: "FRESH" | "REUSED";
  cycleAsOf: string;
  cycleAgeHours: number;
  nextFullDiscoveryAt: string;
  methodology: string;
  opportunityBook: OpportunityBookRowV38[];
  activeThemes: ReturnType<typeof buildThemeSummaryV38>;
  researchFunnel: {
    architecture: "SECTOR_THESIS_WINNER";
    sectorThemeTargetPct: 80;
    fullUniverseRadarPct: 20;
    thesisHorizonDays: "14-90";
    fullDiscoveryCadence: "DAILY";
    openingWebsiteTriggersFullScan: false;
    hysteresisReviews: 2;
    removalAfterMisses: 3;
    focusSectors: string[];
  };
};

type Options = {
  exclude?: Iterable<string>;
  topN?: number;
  universeLimit?: number;
  forceRefresh?: boolean;
};

const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const addMs = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString();
const ageHours = (iso: string) => Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);

async function loadLatestCycle(): Promise<{ createdAt: string; snapshot: InvestmentResearchV38Result } | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return memoryCycle as any;
  const { data, error } = await sb
    .from("analysis_snapshots")
    .select("snapshot,created_at")
    .eq("ticker", CYCLE_TICKER)
    .eq("signal", CYCLE_SIGNAL)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.snapshot || !data?.created_at) return memoryCycle as any;
  return { createdAt: String(data.created_at), snapshot: data.snapshot as InvestmentResearchV38Result };
}

export async function readOpportunityBookV38(limit = DEFAULT_BOOK_LIMIT): Promise<OpportunityBookRowV38[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return memoryBook.slice(0, limit);
  const cutoff = new Date(Date.now() - BOOK_LOOKBACK_DAYS * 86400000).toISOString();
  const { data, error } = await sb
    .from("analysis_snapshots")
    .select("ticker,snapshot,created_at")
    .eq("signal", BOOK_SIGNAL)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error || !Array.isArray(data)) return memoryBook.slice(0, limit);
  const seen = new Set<string>();
  const rows: OpportunityBookRowV38[] = [];
  for (const raw of data) {
    const ticker = cleanTicker(raw?.ticker);
    if (!ticker || seen.has(ticker) || !raw?.snapshot) continue;
    seen.add(ticker);
    rows.push(raw.snapshot as OpportunityBookRowV38);
  }
  memoryBook = rows;
  return rows.slice(0, limit);
}

async function persistOpportunityBook(rows: OpportunityBookRowV38[], asOf: string) {
  memoryBook = rows;
  const sb = getSupabaseAdmin();
  if (!sb || !rows.length) return;
  const payload = rows.slice(0, 40).map(row => ({
    ticker: row.ticker,
    snapshot: row,
    target_price: null,
    signal: BOOK_SIGNAL,
    created_at: asOf,
  }));
  const { error } = await sb.from("analysis_snapshots").insert(payload);
  if (error) throw new Error(`Opportunity Book persistence failed: ${error.message}`);
}

async function persistCycle(snapshot: InvestmentResearchV38Result, asOf: string) {
  memoryCycle = { createdAt: asOf, snapshot };
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const { error } = await sb.from("analysis_snapshots").insert({
    ticker: CYCLE_TICKER,
    snapshot,
    target_price: null,
    signal: CYCLE_SIGNAL,
    created_at: asOf,
  });
  if (error) throw new Error(`Research cycle persistence failed: ${error.message}`);
}

function candidateKey(row: any) { return cleanTicker(row?.ticker); }

function inputFromCandidate(row: any, isProposal: boolean, legacy: LegacyResult): OpportunityInputV38 | null {
  const ticker = candidateKey(row);
  if (!ticker) return null;
  // Legacy Research deliberately exposes only the Stage-A summary publicly.
  // Raw rows may exist on an internal implementation but are never required by
  // V38; stock RS therefore remains optional and sector RS + measured momentum
  // carry the relative-strength pillar when raw Stage-A rows are unavailable.
  const fastRows = (legacy.fastScan as any)?.rows as any[] | undefined;
  const fast = fastRows?.find((item: any) => cleanTicker(item?.ticker) === ticker) ?? null;
  const sector = String(row?.sector ?? "Unknown");
  const leadership = legacy.marketLeadership?.sectors?.find((item: any) => String(item?.sector ?? "").toUpperCase() === sector.toUpperCase()) ?? null;
  return {
    ticker,
    sector,
    sectorLeadershipScore: finite(row?.sectorLeadershipScore) ?? finite(leadership?.score),
    sectorLeadershipStatus: String(row?.sectorLeadershipStatus ?? leadership?.status ?? "UNCONFIRMED"),
    sectorRank: finite(row?.sectorRank) ?? finite(leadership?.rank),
    sectorRelative1m: finite(leadership?.relative1m),
    sectorRelative3m: finite(leadership?.relative3m),
    stockRs3m: finite(fast?.rs3m),
    expectedReturnPct: finite(row?.expectedReturnPct),
    lifecycleStage: String(row?.lifecycleStage ?? "UNCONFIRMED"),
    lifecycleScore: finite(row?.lifecycleScore),
    preferredEntryStage: Boolean(row?.preferredEntryStage),
    marketFitScore: finite(row?.marketFitScore),
    factors: row?.factors ?? null,
    researchEvidence: row?.researchEvidence ?? null,
    sourceModels: Array.isArray(row?.sourceModels) ? row.sourceModels : Array.isArray(row?.discoveryEngines) ? row.discoveryEngines : [],
    isProposal,
    source: String(row?.setupType ?? row?.researchEngineLabel ?? row?.source ?? "INV Research V38"),
  };
}

function decorateCandidate(row: any, bookByTicker: Map<string, OpportunityBookRowV38>) {
  const book = bookByTicker.get(candidateKey(row));
  if (!book) return row;
  return {
    ...row,
    opportunityScore: book.opportunityScore,
    confidenceScore: book.confidenceScore,
    persistentState: book.state,
    reviewState: book.reviewState,
    theme: book.theme,
    thesisHorizonDays: book.horizonDays,
    thesisAgeDays: book.thesisAgeDays,
    thesisExpiresAt: book.expiresAt,
    winnerRank: book.winnerRank,
    winnerCount: book.winnerCount,
    scoreDelta: book.scoreDelta,
  };
}

function filterForExcluded<T extends { ticker?: string }>(rows: T[], excluded: Set<string>) {
  return rows.filter(row => !excluded.has(cleanTicker(row?.ticker)));
}

function cachedForCaller(cached: InvestmentResearchV38Result, excluded: Set<string>, createdAt: string): InvestmentResearchV38Result {
  const proposals = filterForExcluded([...(cached.proposals ?? [])], excluded);
  const researchQueue = filterForExcluded([...(cached.researchQueue ?? [])], excluded);
  const opportunityBook = filterForExcluded([...(cached.opportunityBook ?? [])], excluded);
  const cycleAgeHours = Math.round(ageHours(createdAt) * 10) / 10;
  return {
    ...cached,
    proposals,
    researchQueue,
    opportunityBook,
    activeThemes: buildThemeSummaryV38(opportunityBook),
    qualified: proposals.length,
    cycleMode: "REUSED",
    cycleAsOf: createdAt,
    cycleAgeHours,
    nextFullDiscoveryAt: addMs(createdAt, CYCLE_TTL_MS),
  };
}

function persistenceBonus(previous: OpportunityBookRowV38 | undefined) {
  if (!previous) return 0;
  if (previous.state === "READY") return 6;
  if (previous.state === "WATCH") return 3;
  return 0;
}

export async function runInvestmentResearchOS(options: Options = {}): Promise<InvestmentResearchV38Result> {
  const excluded = new Set(Array.from(options.exclude ?? [], value => cleanTicker(value)));
  const topN = Math.max(1, options.topN ?? 10);

  if (!options.forceRefresh) {
    const latest = await loadLatestCycle().catch(() => null);
    if (latest && ageHours(latest.createdAt) < CYCLE_TTL_MS / 3600000 && String(latest.snapshot?.version ?? "").startsWith("38.")) {
      return cachedForCaller(latest.snapshot, excluded, latest.createdAt);
    }
  }

  const previousBook = await readOpportunityBookV38(40).catch(() => [] as OpportunityBookRowV38[]);
  const previousByTicker = new Map(previousBook.map(row => [row.ticker, row]));

  // Ask the legacy engine for a wider research pool than the final CIO shortlist.
  // V38 then applies the persistent Sector -> Thesis -> Winner funnel.
  const legacy = await runLegacyInvestmentResearchOS({
    exclude: options.exclude,
    topN: Math.max(10, topN * 2),
    universeLimit: options.universeLimit,
  });

  const currentInputs: OpportunityInputV38[] = [];
  const seen = new Set<string>();
  for (const row of legacy.proposals ?? []) {
    const input = inputFromCandidate(row, true, legacy);
    if (!input || seen.has(input.ticker)) continue;
    seen.add(input.ticker); currentInputs.push(input);
  }
  for (const row of legacy.researchQueue ?? []) {
    const input = inputFromCandidate(row, false, legacy);
    if (!input || seen.has(input.ticker)) continue;
    seen.add(input.ticker); currentInputs.push(input);
  }

  const asOf = new Date().toISOString();
  const opportunityBook = reconcileOpportunityBookV38(currentInputs, previousBook, asOf);
  const bookByTicker = new Map(opportunityBook.map(row => [row.ticker, row]));
  const focusSectors = Array.isArray(legacy.marketLeadership?.focusSectors) ? legacy.marketLeadership.focusSectors : [];

  const decoratedProposals = (legacy.proposals ?? [])
    .map(row => decorateCandidate(row, bookByTicker))
    .filter((row: any) => row.persistentState === "READY")
    .map((row: any) => ({ ...row, v38RankScore: Number(row.opportunityScore ?? 0) * .7 + Number(row.confidenceScore ?? 0) * .3 + persistenceBonus(previousByTicker.get(candidateKey(row))) }));
  const proposals = selectSectorThesisWinnersV38(decoratedProposals, focusSectors, topN)
    .sort((a: any, b: any) => Number(b.v38RankScore ?? 0) - Number(a.v38RankScore ?? 0));

  const researchQueue = (legacy.researchQueue ?? [])
    .map(row => decorateCandidate(row, bookByTicker))
    .sort((a: any, b: any) => {
      const aState = a.persistentState === "READY" ? 3 : a.persistentState === "WATCH" ? 2 : 1;
      const bState = b.persistentState === "READY" ? 3 : b.persistentState === "WATCH" ? 2 : 1;
      return bState - aState || Number(b.opportunityScore ?? 0) - Number(a.opportunityScore ?? 0) || Number(b.confidenceScore ?? 0) - Number(a.confidenceScore ?? 0);
    });

  const activeThemes = buildThemeSummaryV38(opportunityBook);
  const warnings = [...(legacy.warnings ?? [])];
  const result: InvestmentResearchV38Result = {
    ...legacy,
    version: `${INV_RESEARCH_V38}-persistent-sector-thesis-winner`,
    legacyVersion: String(legacy.version ?? "") || null,
    proposals,
    researchQueue,
    qualified: proposals.length,
    rejected: Math.max(0, Number(legacy.analyzed ?? 0) - proposals.length),
    warnings,
    cycleMode: "FRESH",
    cycleAsOf: asOf,
    cycleAgeHours: 0,
    nextFullDiscoveryAt: addMs(asOf, CYCLE_TTL_MS),
    opportunityBook,
    activeThemes,
    researchFunnel: {
      architecture: "SECTOR_THESIS_WINNER",
      sectorThemeTargetPct: 80,
      fullUniverseRadarPct: 20,
      thesisHorizonDays: "14-90",
      fullDiscoveryCadence: "DAILY",
      openingWebsiteTriggersFullScan: false,
      hysteresisReviews: 2,
      removalAfterMisses: 3,
      focusSectors,
    },
    methodology: "INV Research V38 · Persistent Sector → Thesis/Catalyst → Winner funnel. Full approved-universe scan remains a 20% discovery radar; decision priority is concentrated in LEADING/IMPROVING sectors and active 14–90 day theses. Opportunity Score = Sector/Theme 20 + Thesis/Catalyst 20 + Momentum 20 + Relative Strength 15 + Growth/Quality 10 + Valuation/Alpha 10 + Entry 5. Confidence is separate. READY/WATCH states use two-review hysteresis and three-miss archival. Opening the website reuses the latest daily research cycle instead of launching a new full scan. Human approval remains mandatory and Research cannot execute trades.",
  };

  try {
    await persistOpportunityBook(opportunityBook, asOf);
    await persistCycle(result, asOf);
  } catch (error: any) {
    result.warnings = [...result.warnings, `V38 persistence degraded: ${error?.message ?? "unknown persistence error"}. The live cycle remains usable, but cross-session thesis continuity may be incomplete.`];
  }
  memoryCycle = { createdAt: asOf, snapshot: result };
  return result;
}

export async function getInvResearchV38Status() {
  const [cycle, book] = await Promise.all([loadLatestCycle().catch(() => null), readOpportunityBookV38(40).catch(() => [])]);
  const activeBook = book.filter(row => !["INVALIDATED", "ARCHIVED"].includes(row.state));
  return {
    version: INV_RESEARCH_V38,
    cycle: cycle ? {
      asOf: cycle.createdAt,
      ageHours: Math.round(ageHours(cycle.createdAt) * 10) / 10,
      fresh: ageHours(cycle.createdAt) < CYCLE_TTL_MS / 3600000,
      nextFullDiscoveryAt: addMs(cycle.createdAt, CYCLE_TTL_MS),
      mode: "PERSISTED",
    } : null,
    opportunityBook: activeBook.slice(0, DEFAULT_BOOK_LIMIT),
    themes: buildThemeSummaryV38(activeBook),
    policy: {
      fullUniverse: "S&P 500 + Nasdaq-100 + Russell 2000 only",
      architecture: "Sector → Thesis/Catalyst → Winner → 14–90D Opportunity Book → CIO",
      sectorThemeTargetPct: 80,
      radarPct: 20,
      openingWebsiteTriggersFullScan: false,
      hysteresis: "2 below-threshold reviews before downgrade; 3 consecutive misses before archive unless hard invalidated",
      automaticTrading: false,
    },
  };
}
