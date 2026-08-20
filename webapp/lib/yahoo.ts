import YahooFinance from "yahoo-finance2";
import type { Quote, Overview, Financials, FinancialRow, EarningsRow, Candle, MarketData } from "./types";

// Production policy: Yahoo's public chart endpoint is the reliable keyless path
// on cloud hosts. quote()/quoteSummary() require cookie/crumb behavior that is
// frequently blocked or changes between yahoo-finance2 versions. Full company
// fundamentals are therefore supplied by SEC EDGAR in marketData.enrich().
const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const DIRECT_CHART_HOSTS = ["https://query1.finance.yahoo.com", "https://query2.finance.yahoo.com"] as const;
const DIRECT_TIMEOUT_MS = 7_000;

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 250 * (i + 1))); }
  }
  throw lastErr;
}

function emptyOverview(ticker: string, meta?: any): Overview {
  return {
    symbol: ticker,
    name: meta?.longName ?? meta?.shortName ?? ticker,
    description: "",
    sector: "n/a",
    industry: "n/a",
    currency: meta?.currency ?? "USD",
    country: "n/a",
    marketCap: null,
    peRatio: null,
    forwardPE: null,
    pegRatio: null,
    priceToSales: null,
    priceToBook: null,
    eps: null,
    dividendYield: null,
    profitMargin: null,
    operatingMargin: null,
    roe: null,
    roa: null,
    revenueTTM: null,
    grossProfitTTM: null,
    ebitda: null,
    beta: null,
    week52High: num(meta?.fiftyTwoWeekHigh),
    week52Low: num(meta?.fiftyTwoWeekLow),
    sma50: null,
    sma200: null,
    analystTargetPrice: null,
    sharesOutstanding: null,
  };
}

function candlesFromChart(res: any): Candle[] {
  const rows: any[] = res?.quotes ?? [];
  return rows.filter(r => r?.close != null).map(r => ({
    date: (r.date instanceof Date ? r.date : new Date(r.date)).toISOString().slice(0, 10),
    open: num(r.open) ?? 0,
    high: num(r.high) ?? 0,
    low: num(r.low) ?? 0,
    close: num(r.close) ?? 0,
    volume: num(r.volume) ?? 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function quoteFromChart(ticker: string, res: any, candles: Candle[]): Quote | null {
  const meta = res?.meta ?? {};
  const last = candles.at(-1);
  if (!last) return null;
  const prev = candles.at(-2) ?? last;
  const px = num(meta.regularMarketPrice) ?? last.close;
  const prevClose = num(meta.chartPreviousClose) ?? num(meta.previousClose) ?? prev.close;
  return {
    symbol: ticker,
    price: px,
    change: px - prevClose,
    changePercent: prevClose ? ((px - prevClose) / prevClose) * 100 : 0,
    high: num(meta.regularMarketDayHigh) ?? last.high,
    low: num(meta.regularMarketDayLow) ?? last.low,
    open: num(meta.regularMarketOpen) ?? last.open,
    prevClose,
    volume: num(meta.regularMarketVolume) ?? last.volume,
    asOf: meta.regularMarketTime ? new Date(Number(meta.regularMarketTime) * 1000).toISOString().slice(0, 10) : last.date,
  };
}

async function directChartFromHost(host: string, ticker: string, opts: { period1: Date; interval?: string; includePrePost?: boolean }) {
  const period1 = Math.max(0, Math.floor(opts.period1.getTime() / 1000));
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const interval = opts.interval ?? "1d";
  const url = `${host}/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=${encodeURIComponent(interval)}&includePrePost=${opts.includePrePost ? "true" : "false"}&events=history&includeAdjustedClose=true`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "user-agent": "Mozilla/5.0 SentinelInvestment/29.0",
        referer: "https://finance.yahoo.com/",
      },
    });
    if (!response.ok) throw new Error(`Yahoo direct chart ${response.status}`);
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    if (!result) throw new Error(payload?.chart?.error?.description ?? "Yahoo direct chart returned no result");
    const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result?.indicators?.quote?.[0] ?? {};
    const quotes = timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000),
      open: quote?.open?.[index] ?? null,
      high: quote?.high?.[index] ?? null,
      low: quote?.low?.[index] ?? null,
      close: quote?.close?.[index] ?? null,
      volume: quote?.volume?.[index] ?? null,
    }));
    return { meta: result.meta ?? {}, quotes };
  } finally {
    clearTimeout(timeout);
  }
}

async function directYahooChartRaw(ticker: string, opts: { period1: Date; interval?: string; includePrePost?: boolean }) {
  let lastError: unknown = null;
  for (const host of DIRECT_CHART_HOSTS) {
    try { return await directChartFromHost(host, ticker, opts); }
    catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Yahoo direct chart unavailable");
}

/**
 * V29 resilience path: try yahoo-finance2 first for compatibility, then the
 * public chart REST endpoints directly. This avoids turning a library/schema
 * issue or one Yahoo host being throttled into a portfolio-wide data outage.
 */
export async function yahooChartRaw(ticker: string, opts: { period1: Date; interval?: string; includePrePost?: boolean }): Promise<any> {
  try { return await retry<any>(() => yf.chart(ticker, opts as any), 2); }
  catch { return directYahooChartRaw(ticker.trim().toUpperCase(), opts); }
}

export async function yahooCandles(ticker: string, days = 400): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 86400000);
  const res = await yahooChartRaw(ticker, { period1, interval: "1d" });
  return candlesFromChart(res);
}

/** Lightweight quote derived from chart history; no cookie/crumb dependency. */
export async function yahooQuote(ticker: string): Promise<Quote | null> {
  const period1 = new Date(Date.now() - 14 * 86400000);
  const res = await yahooChartRaw(ticker, { period1, interval: "1d" });
  const candles = candlesFromChart(res);
  return quoteFromChart(ticker.trim().toUpperCase(), res, candles);
}

export function overviewHasData(o: Overview | null): boolean {
  if (!o) return false;
  return o.marketCap != null || o.peRatio != null || o.eps != null || o.revenueTTM != null;
}
export function financialsHasData(f: Financials): boolean {
  return f.income.length > 0 && Number(f.income[0]?.totalRevenue) > 0;
}

export async function getYahooMarketData(ticker: string): Promise<MarketData> {
  const t = ticker.trim().toUpperCase();
  const sources = new Set<string>();
  const warnings: string[] = [];

  let chart: any = null;
  let candles: Candle[] = [];
  try {
    chart = await yahooChartRaw(t, { period1: new Date(Date.now() - 1900 * 86400000), interval: "1d" });
    candles = candlesFromChart(chart);
    if (candles.length) sources.add("Yahoo Finance public chart endpoint (library/direct fallback)");
  } catch (e: any) {
    warnings.push(`Price history unavailable: ${e?.message ?? "Yahoo chart failed"}`);
  }

  const benchmarkCandles = await yahooCandles("SPY", 220).catch(() => [] as Candle[]);
  if (benchmarkCandles.length) sources.add("Yahoo Finance public chart endpoint (SPY benchmark)");

  const quote = quoteFromChart(t, chart, candles);
  const overview = emptyOverview(t, chart?.meta);
  const financials: Financials = { income: [], balance: [], cashflow: [] };
  const earnings: EarningsRow[] = [];

  return {
    ticker: t,
    quote,
    overview,
    financials,
    earnings,
    candles,
    benchmarkCandles,
    quarters: [],
    ttm: null,
    annualEps: [],
    sources: Array.from(sources),
    warnings,
  };
}

// Legacy helpers retained for type/API compatibility. They intentionally return
// empty fundamentals rather than hitting blocked quoteSummary modules.
export async function yahooOverview(ticker: string): Promise<Overview | null> {
  const q = await yahooQuote(ticker).catch(() => null);
  return q ? emptyOverview(ticker.trim().toUpperCase()) : null;
}
export async function yahooFinancials(_ticker: string): Promise<Financials> {
  return { income: [], balance: [], cashflow: [] };
}
export async function yahooEarnings(_ticker: string): Promise<EarningsRow[]> { return []; }

export type { FinancialRow };
