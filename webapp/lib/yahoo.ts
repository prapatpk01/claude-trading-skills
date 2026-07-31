import YahooFinance from "yahoo-finance2";
import type { Quote, Overview, Financials, FinancialRow, EarningsRow, Candle, MarketData } from "./types";

// Production policy: Yahoo's public chart endpoint is the reliable keyless path
// on cloud hosts. quote()/quoteSummary() require cookie/crumb behavior that is
// frequently blocked or changes between yahoo-finance2 versions. Full company
// fundamentals are therefore supplied by SEC EDGAR in marketData.enrich().
const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

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
  const price = num(meta?.regularMarketPrice);
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

export async function yahooChartRaw(ticker: string, opts: { period1: Date; interval?: string; includePrePost?: boolean }): Promise<any> {
  return retry<any>(() => yf.chart(ticker, opts as any));
}

export async function yahooCandles(ticker: string, days = 400): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 86400000);
  const res = await yahooChartRaw(ticker, { period1, interval: "1d" });
  return candlesFromChart(res);
}

/**
 * Lightweight quote deliberately uses chart(), not quote(). This avoids the
 * yahoo-finance2 option/schema mismatch and Yahoo crumb restrictions seen on
 * Vercel while retaining a current/last-session market price.
 */
export async function yahooQuote(ticker: string): Promise<Quote | null> {
  const period1 = new Date(Date.now() - 14 * 86400000);
  const res = await yahooChartRaw(ticker, { period1, interval: "1d" });
  const candles = candlesFromChart(res);
  return quoteFromChart(ticker.trim().toUpperCase(), res, candles);
}

// Kept for provider-agnostic callers. Yahoo fundamentals are intentionally not
// treated as authoritative in production; SEC EDGAR fills these structures.
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
    if (candles.length) sources.add("Yahoo Finance public chart endpoint");
  } catch (e: any) {
    warnings.push(`Price history unavailable: ${e?.message ?? "Yahoo chart failed"}`);
  }

  const benchmarkCandles = await yahooCandles("SPY", 220).catch(() => [] as Candle[]);
  if (benchmarkCandles.length) sources.add("Yahoo Finance public chart endpoint (SPY benchmark)");

  const quote = quoteFromChart(t, chart, candles);
  const overview = emptyOverview(t, chart?.meta);
  const financials: Financials = { income: [], balance: [], cashflow: [] };
  const earnings: EarningsRow[] = [];

  // No warnings are emitted for quoteSummary/fundamental modules because they
  // are no longer requested. marketData.enrich() now decides whether missing
  // fundamentals are a real data-quality problem after SEC/AV fallbacks run.
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
// empty data rather than hitting blocked quoteSummary modules.
export async function yahooOverview(ticker: string): Promise<Overview | null> {
  const q = await yahooQuote(ticker).catch(() => null);
  return q ? emptyOverview(ticker.trim().toUpperCase()) : null;
}
export async function yahooFinancials(_ticker: string): Promise<Financials> {
  return { income: [], balance: [], cashflow: [] };
}
export async function yahooEarnings(_ticker: string): Promise<EarningsRow[]> { return []; }

// Types referenced by older imports in downstream branches.
export type { FinancialRow };
