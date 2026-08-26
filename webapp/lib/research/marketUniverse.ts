import { ENGINE_UNIVERSES, type FactorMode } from "@/lib/factorDiscovery";
import { chooseDeepResearchQueue, fastScanApprovedUniverse, type FastUniverseRow } from "@/lib/research/universeFastScan";

export type ResearchRotationCadence = "3D" | "7D" | "1M" | "3M";
export type ResearchIndexFamilyId = "SP500" | "NASDAQ100" | "RUSSELL2000";

export type RotationWindow = {
  cadence: ResearchRotationCadence;
  label: string;
  purpose: string;
  masterUniverse: number;
  scheduledThisCycle: number;
  lastRotationAt: string;
  nextRotationAt: string;
};

export type RotatingResearchName = {
  ticker: string;
  cadence: ResearchRotationCadence;
  source: string;
};

export type ResearchIndexFamily = {
  id: ResearchIndexFamilyId;
  label: string;
  source: string;
  asOf: string | null;
  tickers: string[];
};

export type ThreeIndexUniverse = {
  masterTickers: string[];
  masterUniverseSize: number;
  masterSource: string;
  families: ResearchIndexFamily[];
  warnings: string[];
};

const CADENCE: Array<{ cadence: ResearchRotationCadence; days: number; weight: number; label: string; purpose: string }> = [
  { cadence: "3D", days: 3, weight: .34, label: "Full-universe fast momentum scan", purpose: "Rank all approved names by relative strength, trend, volume and lifecycle before deep research." },
  { cadence: "7D", days: 7, weight: .28, label: "Cross-sectional deep research", purpose: "Deep-dive the strongest primary lifecycle candidates after the full-universe pre-screen." },
  { cadence: "1M", days: 30, weight: .22, label: "Fundamental refresh", purpose: "Refresh growth, quality, filing and valuation evidence for ranked finalists." },
  { cadence: "3M", days: 90, weight: .16, label: "Breadth and stale-name refresh", purpose: "Keep broad index coverage without allowing stale fixed-core names to dominate discovery." },
];

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const INDEX_CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7_000;
// A NO_BUY conclusion is only defensible when the broad price/volume screen
// covers most of the approved three-index universe. Lower coverage may still
// seed a fallback deep-research queue, but it must be reported as DATA_BLOCKED.
export const MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT = 80;

const INDEX_SOURCES = {
  SP500: "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv",
  NASDAQ100: "https://api.nasdaq.com/api/quote/list-type/nasdaq100",
  RUSSELL2000: "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv",
} as const;

const PROVIDER_TICKER_ALIASES: Record<string, string> = { BRKB: "BRK-B", BFB: "BF-B" };
let universeCache: { expiresAt: number; value: ThreeIndexUniverse } | null = null;
let universeLoad: Promise<ThreeIndexUniverse> | null = null;

function normalizeTicker(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  const ticker = PROVIDER_TICKER_ALIASES[raw] ?? raw;
  return TICKER.test(ticker) ? ticker : null;
}

function unique(values: Iterable<string>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ticker = normalizeTicker(value);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function windowDates(days: number, now: Date) {
  const epoch = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / (days * 86400000));
  return {
    lastRotationAt: new Date(epoch * days * 86400000).toISOString(),
    nextRotationAt: new Date((epoch + 1) * days * 86400000).toISOString(),
  };
}

function quotas(total: number) {
  let assigned = 0;
  return CADENCE.map((policy, index) => {
    const count = index === CADENCE.length - 1 ? Math.max(0, total - assigned) : Math.max(1, Math.round(total * policy.weight));
    assigned += count;
    return { ...policy, count };
  });
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { out.push(field.trim()); field = ""; }
    else field += char;
  }
  out.push(field.trim());
  return out;
}

export function parseIsharesHoldingsCsv(csv: string): { asOf: string | null; tickers: string[] } {
  const lines = String(csv ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const asOfLine = lines.find(line => /^Fund Holdings as of,/i.test(line));
  const asOf = asOfLine ? parseCsvLine(asOfLine)[1] || null : null;
  const headerIndex = lines.findIndex(line => {
    const cells = parseCsvLine(line).map(cell => cell.toUpperCase());
    return cells.includes("TICKER") && cells.includes("ASSET CLASS");
  });
  if (headerIndex < 0) return { asOf, tickers: [] };
  const headers = parseCsvLine(lines[headerIndex]).map(cell => cell.toUpperCase());
  const tickerIndex = headers.indexOf("TICKER");
  const assetClassIndex = headers.indexOf("ASSET CLASS");
  const rows: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = parseCsvLine(line);
    if (tickerIndex < 0 || cells.length <= tickerIndex) continue;
    const assetClass = assetClassIndex >= 0 ? String(cells[assetClassIndex] ?? "").toUpperCase() : "EQUITY";
    if (assetClass !== "EQUITY") continue;
    const ticker = normalizeTicker(cells[tickerIndex]);
    if (ticker) rows.push(ticker);
  }
  return { asOf, tickers: unique(rows) };
}

export function parseNasdaq100Payload(payload: any): { asOf: string | null; tickers: string[] } {
  const rows = payload?.data?.data?.rows ?? payload?.data?.rows ?? [];
  const tickers = Array.isArray(rows) ? unique(rows.map((row: any) => String(row?.symbol ?? ""))) : [];
  return { asOf: payload?.data?.date ? String(payload.data.date) : null, tickers };
}

async function fetchSource(url: string, accept: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept,
        "user-agent": "Mozilla/5.0 SentinelInvestmentResearch/2.0",
        ...(url.includes("api.nasdaq.com") ? { referer: "https://www.nasdaq.com/" } : {}),
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally { clearTimeout(timeout); }
}

async function loadIsharesFamily(id: "SP500" | "RUSSELL2000", label: string, source: string): Promise<ResearchIndexFamily> {
  const response = await fetchSource(source, "text/csv,text/plain;q=0.9,*/*;q=0.8");
  const parsed = parseIsharesHoldingsCsv(await response.text());
  if (parsed.tickers.length < (id === "SP500" ? 450 : 1500)) throw new Error(`${label} constituent response was incomplete (${parsed.tickers.length} equity tickers)`);
  return { id, label, source, asOf: parsed.asOf, tickers: parsed.tickers };
}

async function loadNasdaqFamily(): Promise<ResearchIndexFamily> {
  const response = await fetchSource(INDEX_SOURCES.NASDAQ100, "application/json,text/plain;q=0.9,*/*;q=0.8");
  const parsed = parseNasdaq100Payload(await response.json());
  if (parsed.tickers.length < 90) throw new Error(`Nasdaq-100 constituent response was incomplete (${parsed.tickers.length} symbols)`);
  return { id: "NASDAQ100", label: "Nasdaq-100", source: INDEX_SOURCES.NASDAQ100, asOf: parsed.asOf, tickers: parsed.tickers };
}

async function loadFreshThreeIndexUniverse(): Promise<ThreeIndexUniverse> {
  const jobs = await Promise.allSettled([
    loadIsharesFamily("SP500", "S&P 500", INDEX_SOURCES.SP500),
    loadNasdaqFamily(),
    loadIsharesFamily("RUSSELL2000", "Russell 2000", INDEX_SOURCES.RUSSELL2000),
  ]);
  const warnings: string[] = [];
  const families: ResearchIndexFamily[] = [];
  const labels = ["S&P 500", "Nasdaq-100", "Russell 2000"];
  jobs.forEach((job, index) => {
    if (job.status === "fulfilled") families.push(job.value);
    else warnings.push(`${labels[index]} universe unavailable: ${job.reason instanceof Error ? job.reason.message : String(job.reason)}. No broader-market fallback was used.`);
  });
  const masterTickers = unique(families.flatMap(family => family.tickers));
  if (!masterTickers.length) throw new Error("All three approved index-universe sources are unavailable; research is stopped rather than widening to the full US market.");
  if (families.length < 3) warnings.push(`Only ${families.length}/3 approved index families loaded. Research remains restricted to the successfully loaded approved indexes.`);
  const counts = families.map(family => `${family.label} ${family.tickers.length}`).join(" · ");
  return {
    masterTickers,
    masterUniverseSize: masterTickers.length,
    masterSource: `APPROVED INDEX UNIVERSE ONLY — S&P 500 + Nasdaq-100 + Russell 2000${counts ? ` (${counts})` : ""}. Full-universe price/volume fast screen precedes bounded deep research. No SEC/full-market discovery.`,
    families,
    warnings,
  };
}

export async function loadThreeIndexUniverse(): Promise<ThreeIndexUniverse> {
  const now = Date.now();
  if (universeCache && universeCache.expiresAt > now) return universeCache.value;
  if (!universeLoad) {
    universeLoad = loadFreshThreeIndexUniverse().then(value => {
      universeCache = { expiresAt: Date.now() + INDEX_CACHE_MS, value };
      return value;
    }).finally(() => { universeLoad = null; });
  }
  return universeLoad;
}

function membershipSource(ticker: string, families: ResearchIndexFamily[]) {
  const memberships = families.filter(family => family.tickers.includes(ticker)).map(family => family.label);
  return memberships.length ? `INDEX:${memberships.join("+")}` : "INDEX:APPROVED";
}

function cadenceForRow(row: FastUniverseRow, index: number): ResearchRotationCadence {
  if (["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(row.stage)) return index % 2 === 0 ? "3D" : "7D";
  if (row.stage === "MATURE") return "7D";
  return index % 2 === 0 ? "1M" : "3M";
}

function deterministicFallback(eligibleMaster: string[], count: number, now: Date) {
  const day = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const core = new Set(unique(Object.values(ENGINE_UNIVERSES).flat()));
  return eligibleMaster
    .map(ticker => ({ ticker, core: core.has(ticker), rank: stableHash(`${day}:${ticker}`) }))
    .sort((a, b) => Number(b.core) - Number(a.core) || a.rank - b.rank || a.ticker.localeCompare(b.ticker))
    .slice(0, count)
    .map(row => row.ticker);
}

export async function buildRotatingMarketUniverse(options: { exclude?: Iterable<string>; detailedLimit: number; now?: Date }) {
  const now = options.now ?? new Date();
  const excluded = new Set(unique(options.exclude ?? []));
  const indexUniverse = await loadThreeIndexUniverse();
  const eligibleMaster = indexUniverse.masterTickers.filter(ticker => !excluded.has(ticker));
  const desired = Math.max(28, Math.min(56, options.detailedLimit));
  const warnings = [...indexUniverse.warnings];

  let fastScan: Awaited<ReturnType<typeof fastScanApprovedUniverse>> | null = null;
  let selectedRows: FastUniverseRow[] = [];
  try {
    fastScan = await fastScanApprovedUniverse(eligibleMaster);
    warnings.push(...fastScan.warnings.map(warning => `Fast scan: ${warning}`));
    if (fastScan.coveragePct >= MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT) selectedRows = chooseDeepResearchQueue(fastScan, desired);
    else warnings.push(`Fast scan coverage ${fastScan.coveragePct}% was below the ${MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT}% institutional minimum; deterministic approved-index fallback queue used for this cycle and NO_BUY must remain blocked.`);
  } catch (error: any) {
    warnings.push(`Full-universe fast scan unavailable: ${error?.message ?? "unknown error"}. Deterministic approved-index fallback queue used; automatic discovery did not widen beyond the three approved indexes.`);
  }

  const fallbackTickers = selectedRows.length >= Math.min(desired, 12) ? [] : deterministicFallback(eligibleMaster, desired, now);
  const fastByTicker = new Map(selectedRows.map(row => [row.ticker, row]));
  const tickers = selectedRows.length >= Math.min(desired, 12) ? selectedRows.map(row => row.ticker) : fallbackTickers;
  const queue: RotatingResearchName[] = tickers.slice(0, desired).map((ticker, index) => {
    const row = fastByTicker.get(ticker);
    const cadence = row ? cadenceForRow(row, index) : (CADENCE[index % CADENCE.length]?.cadence ?? "7D");
    const fastEvidence = row ? ` · FAST:${row.stage} ${row.score}/100 · RS3M ${row.rs3m >= 0 ? "+" : ""}${row.rs3m.toFixed(1)}%` : " · FALLBACK_ROTATION";
    return { ticker, cadence, source: `${membershipSource(ticker, indexUniverse.families)}${fastEvidence}` };
  });

  const quotaRows = quotas(queue.length);
  let cursor = 0;
  const windows: RotationWindow[] = quotaRows.map(policy => {
    const dates = windowDates(policy.days, now);
    const scheduledThisCycle = queue.slice(cursor, cursor + policy.count).length;
    cursor += policy.count;
    return {
      cadence: policy.cadence,
      label: policy.label,
      purpose: policy.purpose,
      masterUniverse: indexUniverse.masterUniverseSize,
      scheduledThisCycle,
      lastRotationAt: dates.lastRotationAt,
      nextRotationAt: dates.nextRotationAt,
    };
  });

  return {
    masterTickers: indexUniverse.masterTickers,
    masterUniverseSize: indexUniverse.masterUniverseSize,
    masterSource: indexUniverse.masterSource,
    indexFamilies: indexUniverse.families.map(family => ({ id: family.id, label: family.label, count: family.tickers.length, asOf: family.asOf, source: family.source })),
    queue,
    windows,
    warnings: Array.from(new Set(warnings)),
    fastScan: fastScan ? {
      provider: fastScan.provider,
      requested: fastScan.requested,
      scanned: fastScan.scanned,
      failed: fastScan.failed,
      coveragePct: fastScan.coveragePct,
      minimumCoveragePct: MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT,
      coverageReady: fastScan.coveragePct >= MIN_FULL_UNIVERSE_SCREEN_COVERAGE_PCT,
      asOf: fastScan.asOf,
      deepQueueFromFastScan: selectedRows.length,
      primaryLifecycleFastCandidates: fastScan.rows.filter(row => ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(row.stage)).length,
      matureFallbackFastCandidates: fastScan.rows.filter(row => row.stage === "MATURE").length,
      fallbackUsed: fallbackTickers.length > 0,
    } : null,
  };
}

export function preferredEngineCore(mode: FactorMode) { return unique(ENGINE_UNIVERSES[mode]); }
