export type FastMomentumStage = "ACCUMULATION" | "EARLY_MARKUP" | "MOMENTUM_EXPANSION" | "MATURE" | "WEAKENING" | "UNCONFIRMED";

export type FastUniverseRow = {
  ticker: string;
  score: number;
  stage: FastMomentumStage;
  price: number;
  return1w: number;
  return1m: number;
  return3m: number;
  rs3m: number;
  aboveEma20: boolean;
  aboveEma50: boolean;
  ema20Above50: boolean;
  distanceEma20Pct: number;
  volumeRatio: number | null;
  liquidityScore: number;
};

export type FastUniverseScan = {
  provider: string;
  requested: number;
  scanned: number;
  failed: number;
  coveragePct: number;
  rows: FastUniverseRow[];
  warnings: string[];
  asOf: string;
};

// Stage A must not depend on one market-data route. Railway has repeatedly
// returned 0 rows from Yahoo's multi-symbol Spark endpoint even while the
// per-symbol chart endpoint remained healthy. V36.2 therefore uses the
// TradingView America screener for the broad, keyless snapshot and keeps Yahoo
// Spark only as a rescue path for names that TradingView did not return.
const TV_SCANNER_URL = "https://scanner.tradingview.com/america/scan";
const TV_COLUMNS = [
  "name",
  "close",
  "Perf.W",
  "Perf.1M",
  "Perf.3M",
  "relative_volume_10d_calc",
  "EMA20",
  "EMA50",
  "volume",
  "average_volume_30d_calc",
] as const;
const TV_PAGE_SIZE = 5_000;
const TV_MAX_ROWS = 15_000;
const TV_TIMEOUT_MS = 12_000;

const SPARK_HOSTS = ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"] as const;
const SPARK_PATH = "/v7/finance/spark";
const CACHE_MS = 15 * 60 * 1000;
const MAX_CACHE_KEYS = 12;
const CHUNK_SIZE = 50;
const CONCURRENCY = 8;
const TIMEOUT_MS = 5_500;
const MIN_BARS = 55;
const MIN_SPLIT_CHUNK = 12;

// Different pages can request the 2,000+ stock master universe, sector ETFs and
// a 10–30 name portfolio at the same time. Cache/in-flight work must therefore
// be keyed by the requested ticker set. A single global promise can hand one
// caller the result of an unrelated scan and corrupt downstream data quality.
const cache = new Map<string, { expiresAt: number; value: FastUniverseScan }>();
const inflight = new Map<string, Promise<FastUniverseScan>>();

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (now: number, prior: number) => prior > 0 ? (now / prior - 1) * 100 : 0;
const round1 = (value: number) => Math.round(value * 10) / 10;

function ema(values: number[], length: number) {
  if (!values.length) return 0;
  const alpha = 2 / (length + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) current = values[index] * alpha + current * (1 - alpha);
  return current;
}

function normalizeTickerKey(value: string) {
  return String(value).trim().toUpperCase().replace(/[-/]/g, ".");
}

function parseSeries(entry: any): { closes: number[]; volumes: number[] } | null {
  const response = entry?.response?.[0] ?? entry?.response ?? entry;
  const quote = response?.indicators?.quote?.[0] ?? response?.indicators?.quote ?? {};
  const closesRaw = Array.isArray(quote?.close) ? quote.close : Array.isArray(response?.close) ? response.close : [];
  const volumesRaw = Array.isArray(quote?.volume) ? quote.volume : Array.isArray(response?.volume) ? response.volume : [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (let index = 0; index < closesRaw.length; index += 1) {
    const close = finite(closesRaw[index]);
    if (close == null || close <= 0) continue;
    closes.push(close);
    const volume = finite(volumesRaw[index]);
    volumes.push(volume != null && volume >= 0 ? volume : 0);
  }
  return closes.length >= MIN_BARS ? { closes, volumes } : null;
}

function classifyStage(input: {
  ret1m: number;
  ret3m: number;
  rs3m: number;
  above20: boolean;
  above50: boolean;
  ema20Above50: boolean;
  distance20: number;
  volumeRatio: number | null;
}): FastMomentumStage {
  const { ret1m, ret3m, rs3m, above20, above50, ema20Above50, distance20, volumeRatio } = input;
  if (!above50 || (!above20 && ret1m < -2)) return "WEAKENING";
  if (ret3m >= 32 || ret1m >= 18 || distance20 >= 14) return "MATURE";
  if (above20 && above50 && ema20Above50 && rs3m >= 4 && ret3m >= 12 && ret1m >= 4) return "MOMENTUM_EXPANSION";
  if (above20 && above50 && ema20Above50 && rs3m >= 0 && ret3m >= 4 && ret1m >= 0) return "EARLY_MARKUP";
  if (above50 && Math.abs(ret1m) <= 5 && ret3m > -4 && (volumeRatio ?? 1) >= 1.05) return "ACCUMULATION";
  return "UNCONFIRMED";
}

function scoreSnapshot(input: {
  ticker: string;
  price: number;
  return1w: number;
  return1m: number;
  return3m: number;
  benchmarkReturn3m: number;
  ema20: number;
  ema50: number;
  volumeRatio: number | null;
  averageVolume: number | null;
}): FastUniverseRow | null {
  const { ticker, price, return1w, return1m, return3m, benchmarkReturn3m, ema20, ema50, volumeRatio, averageVolume } = input;
  if (!(price > 0) || !(ema20 > 0) || !(ema50 > 0)) return null;
  const rs3m = return3m - benchmarkReturn3m;
  const aboveEma20 = price >= ema20;
  const aboveEma50 = price >= ema50;
  const ema20Above50 = ema20 >= ema50;
  const distanceEma20Pct = (price / ema20 - 1) * 100;
  const liquidityScore = clamp(Math.log10(Math.max(1, averageVolume ?? 1)) * 10, 0, 100);
  const stage = classifyStage({ ret1m: return1m, ret3m: return3m, rs3m, above20: aboveEma20, above50: aboveEma50, ema20Above50, distance20: distanceEma20Pct, volumeRatio });

  let score = 35;
  score += clamp(return1m, -12, 18) * 1.1;
  score += clamp(return3m, -20, 35) * .65;
  score += clamp(rs3m, -15, 20) * .85;
  score += aboveEma20 ? 8 : -8;
  score += aboveEma50 ? 8 : -10;
  score += ema20Above50 ? 7 : -5;
  score += volumeRatio == null ? 0 : clamp((volumeRatio - 1) * 14, -7, 12);
  score += liquidityScore * .08;
  if (stage === "ACCUMULATION") score += 8;
  if (stage === "EARLY_MARKUP") score += 14;
  if (stage === "MOMENTUM_EXPANSION") score += 12;
  if (stage === "MATURE") score -= 8;
  if (stage === "WEAKENING") score -= 24;

  return {
    ticker,
    score: Math.round(clamp(score, 0, 100)),
    stage,
    price,
    return1w: round1(return1w),
    return1m: round1(return1m),
    return3m: round1(return3m),
    rs3m: round1(rs3m),
    aboveEma20,
    aboveEma50,
    ema20Above50,
    distanceEma20Pct: round1(distanceEma20Pct),
    volumeRatio: volumeRatio == null ? null : Math.round(volumeRatio * 100) / 100,
    liquidityScore: Math.round(liquidityScore),
  };
}

function scoreSeries(ticker: string, series: { closes: number[]; volumes: number[] }, benchmarkReturn3m: number): FastUniverseRow | null {
  const closes = series.closes;
  const volumes = series.volumes;
  const price = closes.at(-1) ?? 0;
  if (!(price > 0)) return null;
  const oneWeekIndex = Math.max(0, closes.length - 6);
  const oneMonthIndex = Math.max(0, closes.length - 22);
  const threeMonthIndex = Math.max(0, closes.length - 64);
  const recentVolume = volumes.slice(-5).filter(value => value > 0);
  const baseVolume = volumes.slice(-25, -5).filter(value => value > 0);
  return scoreSnapshot({
    ticker,
    price,
    return1w: pct(price, closes[oneWeekIndex] ?? price),
    return1m: pct(price, closes[oneMonthIndex] ?? price),
    return3m: pct(price, closes[threeMonthIndex] ?? price),
    benchmarkReturn3m,
    ema20: ema(closes.slice(-80), 20),
    ema50: ema(closes.slice(-120), 50),
    volumeRatio: recentVolume.length >= 3 && baseVolume.length >= 10 && avg(baseVolume) > 0 ? avg(recentVolume) / avg(baseVolume) : null,
    averageVolume: avg(volumes.slice(-20)),
  });
}

/* ───────────────────── TradingView broad provider ───────────────────── */

type TradingViewPayload = { totalCount?: number; data?: Array<{ s?: string; d?: unknown[] }> };

async function fetchTradingViewPage(start: number, end: number): Promise<TradingViewPayload> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TV_TIMEOUT_MS);
  try {
    const response = await fetch(TV_SCANNER_URL, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 SentinelInvestmentResearch/36.2",
        referer: "https://www.tradingview.com/",
      },
      body: JSON.stringify({
        filter: [
          { left: "exchange", operation: "in_range", right: ["NYSE", "NASDAQ", "AMEX"] },
        ],
        options: { lang: "en" },
        markets: ["america"],
        symbols: { query: { types: [] }, tickers: [] },
        columns: TV_COLUMNS,
        sort: { sortBy: "volume", sortOrder: "desc" },
        range: [start, end],
      }),
    });
    if (!response.ok) throw new Error(`TradingView scanner ${response.status}`);
    const payload = await response.json() as TradingViewPayload;
    if (!Array.isArray(payload?.data)) throw new Error("TradingView scanner returned no data array");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

/** Pure parser exported so CI can prove the bulk-provider mapping without network. */
export function parseTradingViewFastPayloads(payloads: TradingViewPayload[], requestedTickers: string[]): FastUniverseRow[] {
  const originals = new Map<string, string>();
  for (const ticker of requestedTickers) originals.set(normalizeTickerKey(ticker), String(ticker).trim().toUpperCase());
  originals.set("SPY", "SPY");

  type Snapshot = {
    ticker: string;
    price: number;
    return1w: number;
    return1m: number;
    return3m: number;
    volumeRatio: number | null;
    ema20: number;
    ema50: number;
    averageVolume: number | null;
  };
  const snapshots = new Map<string, Snapshot>();

  for (const payload of payloads) {
    for (const item of payload.data ?? []) {
      const d = Array.isArray(item?.d) ? item.d : [];
      const rawTicker = String(d[0] ?? item?.s?.split(":").at(-1) ?? "").trim().toUpperCase();
      const key = normalizeTickerKey(rawTicker);
      const ticker = originals.get(key);
      if (!ticker) continue;
      const price = finite(d[1]);
      const return1w = finite(d[2]);
      const return1m = finite(d[3]);
      const return3m = finite(d[4]);
      const volumeRatio = finite(d[5]);
      const ema20 = finite(d[6]);
      const ema50 = finite(d[7]);
      const volume = finite(d[8]);
      const averageVolume = finite(d[9]) ?? volume;
      if (price == null || price <= 0 || return1w == null || return1m == null || return3m == null || ema20 == null || ema20 <= 0 || ema50 == null || ema50 <= 0) continue;
      snapshots.set(ticker, { ticker, price, return1w, return1m, return3m, volumeRatio, ema20, ema50, averageVolume });
    }
  }

  const benchmarkReturn3m = snapshots.get("SPY")?.return3m ?? 0;
  const rows: FastUniverseRow[] = [];
  for (const ticker of requestedTickers) {
    const snapshot = snapshots.get(String(ticker).trim().toUpperCase());
    if (!snapshot) continue;
    const scored = scoreSnapshot({ ...snapshot, benchmarkReturn3m });
    if (scored) rows.push(scored);
  }
  rows.sort((left, right) => right.score - left.score || right.rs3m - left.rs3m || right.return3m - left.return3m || left.ticker.localeCompare(right.ticker));
  return rows;
}

async function scanTradingView(tickers: string[]): Promise<FastUniverseScan> {
  const starts: number[] = [];
  for (let start = 0; start < TV_MAX_ROWS; start += TV_PAGE_SIZE) starts.push(start);
  const settled = await Promise.allSettled(starts.map(start => fetchTradingViewPage(start, start + TV_PAGE_SIZE)));
  const payloads: TradingViewPayload[] = [];
  const warnings: string[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") payloads.push(result.value);
    else warnings.push(result.reason instanceof Error ? result.reason.message : "TradingView scanner page failed");
  }
  if (!payloads.length) throw new Error(warnings.join(" | ") || "TradingView scanner unavailable");
  const rows = parseTradingViewFastPayloads(payloads, tickers);
  const scanned = rows.length;
  return {
    provider: "TradingView America bulk screener · Perf.W/1M/3M + EMA20/50 + relative volume",
    requested: tickers.length,
    scanned,
    failed: Math.max(0, tickers.length - scanned),
    coveragePct: tickers.length > 0 ? Math.round(scanned / tickers.length * 1000) / 10 : 0,
    rows,
    warnings: Array.from(new Set(warnings)).slice(0, 8),
    asOf: new Date().toISOString(),
  };
}

/* ───────────────────── Yahoo Spark rescue provider ─────────────────── */

function parseSparkPayload(payload: any) {
  const rows = payload?.spark?.result ?? payload?.result ?? [];
  const out = new Map<string, { closes: number[]; volumes: number[] }>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows) {
    const ticker = String(row?.symbol ?? row?.meta?.symbol ?? "").trim().toUpperCase();
    if (!ticker) continue;
    const series = parseSeries(row);
    if (series) out.set(ticker, series);
  }
  return out;
}

async function fetchChunkFromHost(host: string, tickers: string[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${host}${SPARK_PATH}?symbols=${encodeURIComponent(tickers.join(","))}&range=6mo&interval=1d&indicators=close%2Cvolume`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 SentinelInvestmentResearch/36.2",
        referer: "https://finance.yahoo.com/",
      },
    });
    if (!response.ok) throw new Error(`${host.includes("query2") ? "Yahoo query2" : "Yahoo query1"} spark ${response.status}`);
    const out = parseSparkPayload(await response.json());
    if (!out.size) throw new Error(`${host.includes("query2") ? "Yahoo query2" : "Yahoo query1"} spark returned no usable series`);
    return out;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchChunk(tickers: string[]): Promise<Map<string, { closes: number[]; volumes: number[] }>> {
  const errors: string[] = [];
  for (const host of SPARK_HOSTS) {
    try { return await fetchChunkFromHost(host, tickers); }
    catch (error: any) { errors.push(error?.message ?? `${host} failed`); }
  }

  if (tickers.length > MIN_SPLIT_CHUNK) {
    const midpoint = Math.ceil(tickers.length / 2);
    const halves = [tickers.slice(0, midpoint), tickers.slice(midpoint)].filter(chunk => chunk.length);
    const rescued = await Promise.all(halves.map(async chunk => {
      for (const host of SPARK_HOSTS) {
        try { return await fetchChunkFromHost(host, chunk); }
        catch { /* continue to the second host */ }
      }
      return new Map<string, { closes: number[]; volumes: number[] }>();
    }));
    const merged = new Map<string, { closes: number[]; volumes: number[] }>();
    for (const map of rescued) for (const [ticker, row] of map) merged.set(ticker, row);
    if (merged.size) return merged;
  }

  throw new Error(errors.join(" | ") || "Yahoo spark chunk failed");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}

async function scanYahooSpark(tickers: string[]): Promise<FastUniverseScan> {
  const warnings: string[] = [];
  const requested = tickers.length;
  const withBenchmark = Array.from(new Set([...tickers, "SPY"]));
  const chunks: string[][] = [];
  for (let index = 0; index < withBenchmark.length; index += CHUNK_SIZE) chunks.push(withBenchmark.slice(index, index + CHUNK_SIZE));
  const outcomes = await mapLimit(chunks, CONCURRENCY, async chunk => {
    try { return { rows: await fetchChunk(chunk), error: null as string | null }; }
    catch (error: any) { return { rows: new Map<string, { closes: number[]; volumes: number[] }>(), error: error?.message ?? "fast scan chunk failed" }; }
  });
  const series = new Map<string, { closes: number[]; volumes: number[] }>();
  for (const outcome of outcomes) {
    if (outcome.error) warnings.push(outcome.error);
    for (const [ticker, row] of outcome.rows) series.set(ticker, row);
  }
  const spy = series.get("SPY");
  const spyReturn3m = spy && spy.closes.length >= MIN_BARS ? pct(spy.closes.at(-1) ?? 0, spy.closes[Math.max(0, spy.closes.length - 64)] ?? 0) : 0;
  const rows: FastUniverseRow[] = [];
  for (const ticker of tickers) {
    const row = series.get(ticker);
    if (!row) continue;
    const scored = scoreSeries(ticker, row, spyReturn3m);
    if (scored) rows.push(scored);
  }
  rows.sort((left, right) => right.score - left.score || right.rs3m - left.rs3m || right.return3m - left.return3m || left.ticker.localeCompare(right.ticker));
  const scanned = rows.length;
  return {
    provider: "Yahoo Finance multi-symbol Spark rescue · query2 → query1 → split-chunk",
    requested,
    scanned,
    failed: Math.max(0, requested - scanned),
    coveragePct: requested > 0 ? Math.round(scanned / requested * 1000) / 10 : 0,
    rows,
    warnings: Array.from(new Set(warnings)).slice(0, 8),
    asOf: new Date().toISOString(),
  };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(36);
}

export function fastScanRequestKey(tickers: string[]) {
  return `${tickers.length}:${stableHash(tickers.join(","))}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, row] of cache) if (row.expiresAt <= now) cache.delete(key);
  while (cache.size > MAX_CACHE_KEYS) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

async function scanFresh(tickers: string[]): Promise<FastUniverseScan> {
  const requested = tickers.length;
  const warnings: string[] = [];
  let broad: FastUniverseScan | null = null;
  try {
    broad = await scanTradingView(tickers);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "TradingView broad scan failed");
  }

  const broadRows = broad?.rows ?? [];
  const broadByTicker = new Map(broadRows.map(row => [row.ticker, row]));
  const missing = tickers.filter(ticker => !broadByTicker.has(ticker));

  // 80% is the same evidence floor used by the NO_BUY gate. Do not spend
  // extra provider calls when the broad scan already has sufficient coverage.
  if (broad && broad.coveragePct >= 80) {
    return { ...broad, warnings: Array.from(new Set([...warnings, ...broad.warnings])).slice(0, 8) };
  }

  let rescue: FastUniverseScan | null = null;
  if (missing.length) {
    try { rescue = await scanYahooSpark(missing); }
    catch (error) { warnings.push(error instanceof Error ? error.message : "Yahoo Spark rescue failed"); }
  }

  const merged = new Map<string, FastUniverseRow>();
  for (const row of broadRows) merged.set(row.ticker, row);
  for (const row of rescue?.rows ?? []) if (!merged.has(row.ticker)) merged.set(row.ticker, row);
  const rows = tickers.map(ticker => merged.get(ticker)).filter((row): row is FastUniverseRow => Boolean(row));
  rows.sort((left, right) => right.score - left.score || right.rs3m - left.rs3m || right.return3m - left.return3m || left.ticker.localeCompare(right.ticker));
  const scanned = rows.length;
  return {
    provider: broadRows.length && rescue?.rows.length
      ? `${broad?.provider} + ${rescue.provider}`
      : broadRows.length
        ? broad?.provider ?? "TradingView America bulk screener"
        : rescue?.provider ?? "TradingView + Yahoo market-data providers unavailable",
    requested,
    scanned,
    failed: Math.max(0, requested - scanned),
    coveragePct: requested > 0 ? Math.round(scanned / requested * 1000) / 10 : 0,
    rows,
    warnings: Array.from(new Set([...warnings, ...(broad?.warnings ?? []), ...(rescue?.warnings ?? [])])).slice(0, 8),
    asOf: new Date().toISOString(),
  };
}

export async function fastScanApprovedUniverse(tickers: string[]): Promise<FastUniverseScan> {
  const normalized = Array.from(new Set(tickers.map(ticker => String(ticker).trim().toUpperCase()).filter(Boolean)));
  const key = fastScanRequestKey(normalized);
  pruneCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const running = inflight.get(key);
  if (running) return running;

  const request = scanFresh(normalized)
    .then(value => {
      cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
      pruneCache();
      return value;
    })
    .finally(() => { inflight.delete(key); });
  inflight.set(key, request);
  return request;
}

// V36 Momentum Hunt score. Fast Scan cannot know fundamental Fair Value yet,
// so its job is to spend scarce deep-research slots on the strongest technical
// leaders that are not already excessively mature. Deep Research then supplies
// the independent valuation/upside gate and Sentinel V36 makes the final entry decision.
export function highOpportunityFastScore(row: FastUniverseRow) {
  const stageBonus = row.stage === "EARLY_MARKUP" ? 18
    : row.stage === "MOMENTUM_EXPANSION" ? 16
      : row.stage === "ACCUMULATION" ? 8
        : row.stage === "MATURE" ? -18
          : row.stage === "WEAKENING" ? -35
            : 0;
  const volumeBonus = row.volumeRatio == null ? 0 : clamp((row.volumeRatio - 1) * 16, -5, 14);
  const extensionPenalty = row.distanceEma20Pct > 10 ? (row.distanceEma20Pct - 10) * 1.8 : 0;
  return Math.round(clamp(
    row.score * .45 +
    clamp(row.rs3m, -10, 25) * 1.2 +
    clamp(row.return1m, -8, 18) * .75 +
    clamp(row.return3m, -15, 35) * .22 +
    volumeBonus + stageBonus - extensionPenalty,
    0,
    100,
  ));
}

function fastPrimaryEligible(row: FastUniverseRow) {
  if (row.stage === "MOMENTUM_EXPANSION") return row.score >= 60 && row.rs3m >= 2 && row.return1m >= 2;
  if (row.stage === "EARLY_MARKUP") return row.score >= 57 && row.rs3m >= 0 && row.return1m >= 0;
  if (row.stage === "ACCUMULATION") return row.score >= 55 && row.rs3m >= -1 && row.return1m >= -2 && (row.volumeRatio ?? 0) >= 1.0;
  return false;
}

export function chooseDeepResearchQueue(scan: FastUniverseScan, limit: number) {
  const desired = Math.max(1, Math.min(56, limit));
  const byOpportunity = (left: FastUniverseRow, right: FastUniverseRow) =>
    highOpportunityFastScore(right) - highOpportunityFastScore(left)
    || right.rs3m - left.rs3m
    || right.return1m - left.return1m
    || left.ticker.localeCompare(right.ticker);

  const primary = scan.rows.filter(fastPrimaryEligible).sort(byOpportunity);
  const mature = scan.rows
    .filter(row => row.stage === "MATURE" && row.score >= 64 && row.rs3m >= 3 && row.return1m >= 3 && row.distanceEma20Pct < 16)
    .sort(byOpportunity);
  const other = scan.rows
    .filter(row => row.stage === "UNCONFIRMED" && row.score >= 64 && row.rs3m >= 2 && row.return1m >= 1)
    .sort(byOpportunity);

  const primaryLimit = Math.max(1, Math.round(desired * .90));
  const matureLimit = Math.max(0, desired - primaryLimit);
  const selected = [...primary.slice(0, primaryLimit), ...mature.slice(0, matureLimit)];
  const used = new Set(selected.map(row => row.ticker));
  for (const row of [...primary.slice(primaryLimit), ...other, ...mature.slice(matureLimit)]) {
    if (selected.length >= desired) break;
    if (used.has(row.ticker)) continue;
    used.add(row.ticker);
    selected.push(row);
  }
  return selected.slice(0, desired);
}
