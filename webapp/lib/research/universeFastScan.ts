export type FastMomentumStage = "ACCUMULATION" | "EARLY_MARKUP" | "MOMENTUM_EXPANSION" | "MATURE" | "WEAKENING" | "UNCONFIRMED";

export type FastUniverseRow = {
  ticker: string;
  score: number;
  stage: FastMomentumStage;
  price: number;
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

const ENDPOINT = "https://query1.finance.yahoo.com/v7/finance/spark";
const CACHE_MS = 15 * 60 * 1000;
const CHUNK_SIZE = 60;
const CONCURRENCY = 6;
const TIMEOUT_MS = 8_000;
const MIN_BARS = 55;

let cache: { key: string; expiresAt: number; value: FastUniverseScan } | null = null;
let inflight: Promise<FastUniverseScan> | null = null;

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const pct = (now: number, prior: number) => prior > 0 ? (now / prior - 1) * 100 : 0;

function ema(values: number[], length: number) {
  if (!values.length) return 0;
  const alpha = 2 / (length + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) current = values[index] * alpha + current * (1 - alpha);
  return current;
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

function scoreSeries(ticker: string, series: { closes: number[]; volumes: number[] }, benchmarkReturn3m: number): FastUniverseRow | null {
  const closes = series.closes;
  const volumes = series.volumes;
  const price = closes.at(-1) ?? 0;
  if (!(price > 0)) return null;
  const oneMonthIndex = Math.max(0, closes.length - 22);
  const threeMonthIndex = Math.max(0, closes.length - 64);
  const return1m = pct(price, closes[oneMonthIndex] ?? price);
  const return3m = pct(price, closes[threeMonthIndex] ?? price);
  const rs3m = return3m - benchmarkReturn3m;
  const ema20 = ema(closes.slice(-80), 20);
  const ema50 = ema(closes.slice(-120), 50);
  const aboveEma20 = price >= ema20;
  const aboveEma50 = price >= ema50;
  const ema20Above50 = ema20 >= ema50;
  const distanceEma20Pct = ema20 > 0 ? (price / ema20 - 1) * 100 : 0;
  const recentVolume = volumes.slice(-5).filter(value => value > 0);
  const baseVolume = volumes.slice(-25, -5).filter(value => value > 0);
  const volumeRatio = recentVolume.length >= 3 && baseVolume.length >= 10 && avg(baseVolume) > 0 ? avg(recentVolume) / avg(baseVolume) : null;
  const liquidityScore = clamp(Math.log10(Math.max(1, avg(volumes.slice(-20)))) * 10, 0, 100);
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
    return1m: Math.round(return1m * 10) / 10,
    return3m: Math.round(return3m * 10) / 10,
    rs3m: Math.round(rs3m * 10) / 10,
    aboveEma20,
    aboveEma50,
    ema20Above50,
    distanceEma20Pct: Math.round(distanceEma20Pct * 10) / 10,
    volumeRatio: volumeRatio == null ? null : Math.round(volumeRatio * 100) / 100,
    liquidityScore: Math.round(liquidityScore),
  };
}

async function fetchChunk(tickers: string[]) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${ENDPOINT}?symbols=${encodeURIComponent(tickers.join(","))}&range=6mo&interval=1d&indicators=close%2Cvolume`;
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 SentinelInvestmentResearch/2.0",
        referer: "https://finance.yahoo.com/",
      },
    });
    if (!response.ok) throw new Error(`Yahoo spark ${response.status}`);
    const payload = await response.json();
    const rows = payload?.spark?.result ?? payload?.result ?? [];
    const out = new Map<string, { closes: number[]; volumes: number[] }>();
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const ticker = String(row?.symbol ?? row?.meta?.symbol ?? "").trim().toUpperCase();
        if (!ticker) continue;
        const series = parseSeries(row);
        if (series) out.set(ticker, series);
      }
    }
    return out;
  } finally {
    clearTimeout(timeout);
  }
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

function cacheKey(tickers: string[]) {
  return `${tickers.length}:${tickers.slice(0, 12).join(",")}:${tickers.slice(-12).join(",")}`;
}

async function scanFresh(tickers: string[]): Promise<FastUniverseScan> {
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
    provider: "Yahoo Finance multi-symbol spark · price/volume fast screen",
    requested,
    scanned,
    failed: Math.max(0, requested - scanned),
    coveragePct: requested > 0 ? Math.round(scanned / requested * 1000) / 10 : 0,
    rows,
    warnings: Array.from(new Set(warnings)).slice(0, 8),
    asOf: new Date().toISOString(),
  };
}

export async function fastScanApprovedUniverse(tickers: string[]): Promise<FastUniverseScan> {
  const normalized = Array.from(new Set(tickers.map(ticker => String(ticker).trim().toUpperCase()).filter(Boolean)));
  const key = cacheKey(normalized);
  if (cache && cache.key === key && cache.expiresAt > Date.now()) return cache.value;
  if (!inflight) {
    inflight = scanFresh(normalized)
      .then(value => {
        cache = { key, expiresAt: Date.now() + CACHE_MS, value };
        return value;
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function chooseDeepResearchQueue(scan: FastUniverseScan, limit: number) {
  const desired = Math.max(1, Math.min(56, limit));
  const primaryStages = new Set<FastMomentumStage>(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);
  const primary = scan.rows.filter(row => primaryStages.has(row.stage) && row.score >= 55);
  const mature = scan.rows.filter(row => row.stage === "MATURE" && row.score >= 58 && row.rs3m > -2);
  const other = scan.rows.filter(row => row.stage === "UNCONFIRMED" && row.score >= 60);
  const primaryLimit = Math.max(1, Math.round(desired * .82));
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
