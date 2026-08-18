import { ENGINE_UNIVERSES, type FactorMode } from "@/lib/factorDiscovery";

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
  { cadence: "3D", days: 3, weight: .30, label: "3-day fast rotation", purpose: "Liquid leaders, fresh relative strength, volume accumulation and early markup." },
  { cadence: "7D", days: 7, weight: .30, label: "7-day cross-sectional rotation", purpose: "Cross-sectional ranking across S&P 500, Nasdaq-100 and Russell 2000 members." },
  { cadence: "1M", days: 30, weight: .24, label: "Monthly fundamental rotation", purpose: "Growth, quality, estimate, filing and valuation evidence refresh inside the approved index universe." },
  { cadence: "3M", days: 90, weight: .16, label: "Quarterly index-universe rotation", purpose: "Refresh stale names across the three approved indexes, especially Russell 2000 small caps, without opening the search to the full US market." },
];

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const INDEX_CACHE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7_000;

const INDEX_SOURCES = {
  SP500: "https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv",
  NASDAQ100: "https://api.nasdaq.com/api/quote/list-type/nasdaq100",
  RUSSELL2000: "https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/latest-holdings.csv",
} as const;

const PROVIDER_TICKER_ALIASES: Record<string, string> = {
  BRKB: "BRK-B",
  BFB: "BF-B",
};

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
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function windowEpoch(days: number, now: Date) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / (days * 86400000));
}

function windowDates(days: number, now: Date) {
  const epoch = windowEpoch(days, now);
  return {
    epoch,
    lastRotationAt: new Date(epoch * days * 86400000).toISOString(),
    nextRotationAt: new Date((epoch + 1) * days * 86400000).toISOString(),
  };
}

function rankedSample(values: string[], count: number, salt: string, blocked: Set<string>) {
  return values
    .filter(ticker => !blocked.has(ticker))
    .map(ticker => ({ ticker, rank: stableHash(`${salt}:${ticker}`) }))
    .sort((left, right) => left.rank - right.rank || left.ticker.localeCompare(right.ticker))
    .slice(0, Math.max(0, count))
    .map(row => row.ticker);
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
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      out.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field.trim());
  return out;
}

/** Exported for deterministic parser tests; only Equity rows become research names. */
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

/** Exported for deterministic parser tests against Nasdaq's official JSON shape. */
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
        "user-agent": "Mozilla/5.0 SentinelInvestmentResearch/1.0",
        ...(url.includes("api.nasdaq.com") ? { referer: "https://www.nasdaq.com/" } : {}),
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
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
    masterSource: `APPROVED INDEX UNIVERSE ONLY — S&P 500 + Nasdaq-100 + Russell 2000${counts ? ` (${counts})` : ""}. No SEC/full-market discovery.`,
    families,
    warnings,
  };
}

/**
 * Canonical CIO Investment Research universe. Nothing outside these three index
 * families is admitted by automatic discovery. Failure is explicit and never
 * falls back to the several-thousand-name SEC registrant universe.
 */
export async function loadThreeIndexUniverse(): Promise<ThreeIndexUniverse> {
  const now = Date.now();
  if (universeCache && universeCache.expiresAt > now) return universeCache.value;
  if (!universeLoad) {
    universeLoad = loadFreshThreeIndexUniverse()
      .then(value => {
        universeCache = { expiresAt: Date.now() + INDEX_CACHE_MS, value };
        return value;
      })
      .finally(() => { universeLoad = null; });
  }
  return universeLoad;
}

function balancedIndexSample(families: ResearchIndexFamily[], count: number, salt: string, blocked: Set<string>) {
  if (count <= 0) return [] as string[];
  const pools = families.map((family, index) => rankedSample(family.tickers, family.tickers.length, `${salt}:${family.id}:${index}`, blocked));
  const familyOffset = pools.length ? stableHash(salt) % pools.length : 0;
  const ordered = [...pools.slice(familyOffset), ...pools.slice(0, familyOffset)];
  const cursors = ordered.map(() => 0);
  const out: string[] = [];
  const used = new Set(blocked);
  while (out.length < count) {
    let added = false;
    for (let familyIndex = 0; familyIndex < ordered.length && out.length < count; familyIndex += 1) {
      const pool = ordered[familyIndex];
      while (cursors[familyIndex] < pool.length && used.has(pool[cursors[familyIndex]])) cursors[familyIndex] += 1;
      const ticker = pool[cursors[familyIndex]++];
      if (!ticker || used.has(ticker)) continue;
      used.add(ticker);
      out.push(ticker);
      added = true;
    }
    if (!added) break;
  }
  return out;
}

function membershipSource(ticker: string, families: ResearchIndexFamily[]) {
  const memberships = families.filter(family => family.tickers.includes(ticker)).map(family => family.label);
  return memberships.length ? `INDEX:${memberships.join("+")}` : "INDEX:APPROVED";
}

/**
 * Build a bounded deep-research queue from the approved three-index master
 * universe. We still rotate names so one CIO request does not make thousands of
 * expensive fundamental calls, but every scheduled name is guaranteed to come
 * from S&P 500, Nasdaq-100 or Russell 2000.
 */
export async function buildRotatingMarketUniverse(options: {
  exclude?: Iterable<string>;
  detailedLimit: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const excluded = new Set(unique(options.exclude ?? []));
  const indexUniverse = await loadThreeIndexUniverse();
  const eligibleMaster = indexUniverse.masterTickers.filter(ticker => !excluded.has(ticker));
  const eligibleSet = new Set(eligibleMaster);
  const engineCore = unique(Object.values(ENGINE_UNIVERSES).flat()).filter(ticker => eligibleSet.has(ticker));
  const engineCoreSet = new Set(engineCore);

  const selected = new Set<string>();
  const queue: RotatingResearchName[] = [];
  const windows: RotationWindow[] = [];
  for (const policy of quotas(Math.max(28, Math.min(56, options.detailedLimit)))) {
    const dates = windowDates(policy.days, now);
    const coreCount = policy.cadence === "3D" ? Math.min(policy.count, Math.max(2, Math.round(policy.count * .30))) : 0;
    const core = rankedSample(engineCore, coreCount, `${policy.cadence}:${dates.epoch}:approved-core`, selected);
    for (const ticker of core) selected.add(ticker);

    const broad = balancedIndexSample(
      indexUniverse.families.map(family => ({ ...family, tickers: family.tickers.filter(ticker => eligibleSet.has(ticker)) })),
      policy.count - core.length,
      `${policy.cadence}:${dates.epoch}:three-index`,
      selected,
    );
    for (const ticker of broad) selected.add(ticker);

    const shortfall = Math.max(0, policy.count - core.length - broad.length);
    const fill = rankedSample(eligibleMaster, shortfall, `${policy.cadence}:${dates.epoch}:fill`, selected);
    for (const ticker of fill) selected.add(ticker);

    const tickers = [...core, ...broad, ...fill];
    queue.push(...tickers.map(ticker => ({
      ticker,
      cadence: policy.cadence,
      source: engineCoreSet.has(ticker) ? `${membershipSource(ticker, indexUniverse.families)} · LIQUID_CORE` : membershipSource(ticker, indexUniverse.families),
    })));
    windows.push({
      cadence: policy.cadence,
      label: policy.label,
      purpose: policy.purpose,
      masterUniverse: indexUniverse.masterUniverseSize,
      scheduledThisCycle: tickers.length,
      lastRotationAt: dates.lastRotationAt,
      nextRotationAt: dates.nextRotationAt,
    });
  }

  return {
    masterTickers: indexUniverse.masterTickers,
    masterUniverseSize: indexUniverse.masterUniverseSize,
    masterSource: indexUniverse.masterSource,
    indexFamilies: indexUniverse.families.map(family => ({ id: family.id, label: family.label, count: family.tickers.length, asOf: family.asOf, source: family.source })),
    queue,
    windows,
    warnings: indexUniverse.warnings,
  };
}

/** Engine preference lists are advisory only; callers must intersect them with loadThreeIndexUniverse(). */
export function preferredEngineCore(mode: FactorMode) {
  return unique(ENGINE_UNIVERSES[mode]);
}
