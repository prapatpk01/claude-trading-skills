import type {
  Quote,
  Overview,
  Financials,
  FinancialRow,
  EarningsRow,
  Candle,
  MarketData,
} from "./types";
import { getYahooMarketData, yahooQuote, yahooCandles, overviewHasData, financialsHasData } from "./yahoo";

const AV_BASE = "https://www.alphavantage.co/query";
const FH_BASE = "https://finnhub.io/api/v1";

/**
 * Which data provider to use. Defaults to Yahoo Finance (free, no key,
 * same source as the Python `yfinance` library). Set DATA_PROVIDER=alphavantage
 * to use Alpha Vantage instead (requires ALPHA_VANTAGE_API_KEY).
 */
export function dataProvider(): "yahoo" | "alphavantage" {
  return (process.env.DATA_PROVIDER || "yahoo").toLowerCase() === "alphavantage"
    ? "alphavantage"
    : "yahoo";
}

function avKey() {
  return process.env.ALPHA_VANTAGE_API_KEY || "demo";
}
function fhKey() {
  return process.env.FINNHUB_API_KEY || "";
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  const data = await res.json();
  // Alpha Vantage soft errors
  if (data?.Note) throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  if (data?.Information) throw new Error(`Alpha Vantage: ${data.Information}`);
  if (data?.["Error Message"]) throw new Error(`Alpha Vantage: ${data["Error Message"]}`);
  return data;
}

// ── Alpha Vantage ─────────────────────────────────────────────────────

export async function avOverview(ticker: string): Promise<Overview | null> {
  const url = `${AV_BASE}?function=OVERVIEW&symbol=${ticker}&apikey=${avKey()}`;
  const d = await getJson(url);
  if (!d || !d.Symbol) return null;
  return {
    symbol: d.Symbol,
    name: d.Name ?? ticker,
    description: d.Description ?? "",
    sector: d.Sector ?? "n/a",
    industry: d.Industry ?? "n/a",
    currency: d.Currency ?? "USD",
    country: d.Country ?? "n/a",
    marketCap: num(d.MarketCapitalization),
    peRatio: num(d.PERatio),
    forwardPE: num(d.ForwardPE),
    pegRatio: num(d.PEGRatio),
    priceToSales: num(d.PriceToSalesRatioTTM),
    priceToBook: num(d.PriceToBookRatio),
    eps: num(d.EPS),
    dividendYield: num(d.DividendYield),
    profitMargin: num(d.ProfitMargin),
    operatingMargin: num(d.OperatingMarginTTM),
    roe: num(d.ReturnOnEquityTTM),
    roa: num(d.ReturnOnAssetsTTM),
    revenueTTM: num(d.RevenueTTM),
    grossProfitTTM: num(d.GrossProfitTTM),
    ebitda: num(d.EBITDA),
    beta: num(d.Beta),
    week52High: num(d["52WeekHigh"]),
    week52Low: num(d["52WeekLow"]),
    sma50: num(d["50DayMovingAverage"]),
    sma200: num(d["200DayMovingAverage"]),
    analystTargetPrice: num(d.AnalystTargetPrice),
    sharesOutstanding: num(d.SharesOutstanding),
  };
}

export async function avGlobalQuote(ticker: string): Promise<Quote | null> {
  const url = `${AV_BASE}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${avKey()}`;
  const d = await getJson(url);
  const q = d?.["Global Quote"];
  if (!q || !q["05. price"]) return null;
  return {
    symbol: q["01. symbol"] ?? ticker,
    price: num(q["05. price"]) ?? 0,
    change: num(q["09. change"]) ?? 0,
    changePercent: num(String(q["10. change percent"]).replace("%", "")) ?? 0,
    high: num(q["03. high"]) ?? 0,
    low: num(q["04. low"]) ?? 0,
    open: num(q["02. open"]) ?? 0,
    prevClose: num(q["08. previous close"]) ?? 0,
    volume: num(q["06. volume"]) ?? undefined,
    asOf: q["07. latest trading day"] ?? new Date().toISOString().slice(0, 10),
  };
}

function mapAnnualReports(reports: any[], fields: Record<string, string>): FinancialRow[] {
  if (!Array.isArray(reports)) return [];
  return reports.slice(0, 5).map((r) => {
    const row: FinancialRow = { fiscalDate: r.fiscalDateEnding ?? "" };
    for (const [key, avField] of Object.entries(fields)) {
      row[key] = num(r[avField]) ?? 0;
    }
    return row;
  });
}

export async function avFinancials(ticker: string): Promise<Financials> {
  const [inc, bal, cf] = await Promise.all([
    getJson(`${AV_BASE}?function=INCOME_STATEMENT&symbol=${ticker}&apikey=${avKey()}`).catch(() => null),
    getJson(`${AV_BASE}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${avKey()}`).catch(() => null),
    getJson(`${AV_BASE}?function=CASH_FLOW&symbol=${ticker}&apikey=${avKey()}`).catch(() => null),
  ]);
  return {
    income: mapAnnualReports(inc?.annualReports ?? [], {
      totalRevenue: "totalRevenue",
      grossProfit: "grossProfit",
      operatingIncome: "operatingIncome",
      ebit: "ebit",
      netIncome: "netIncome",
      interestExpense: "interestExpense",
      incomeTaxExpense: "incomeTaxExpense",
      incomeBeforeTax: "incomeBeforeTax",
    }),
    balance: mapAnnualReports(bal?.annualReports ?? [], {
      totalAssets: "totalAssets",
      totalCurrentAssets: "totalCurrentAssets",
      cashAndEquivalents: "cashAndCashEquivalentsAtCarryingValue",
      totalLiabilities: "totalLiabilities",
      totalCurrentLiabilities: "totalCurrentLiabilities",
      longTermDebt: "longTermDebt",
      shortTermDebt: "shortTermDebt",
      totalShareholderEquity: "totalShareholderEquity",
    }),
    cashflow: mapAnnualReports(cf?.annualReports ?? [], {
      operatingCashflow: "operatingCashflow",
      capitalExpenditures: "capitalExpenditures",
      cashflowFromInvestment: "cashflowFromInvestment",
      cashflowFromFinancing: "cashflowFromFinancing",
      dividendPayout: "dividendPayout",
      changeInCashAndCashEquivalents: "changeInCashAndCashEquivalents",
    }),
  };
}

export async function avEarnings(ticker: string): Promise<EarningsRow[]> {
  const url = `${AV_BASE}?function=EARNINGS&symbol=${ticker}&apikey=${avKey()}`;
  const d = await getJson(url).catch(() => null);
  const q = d?.quarterlyEarnings;
  if (!Array.isArray(q)) return [];
  return q.slice(0, 8).map((r: any) => ({
    fiscalDate: r.fiscalDateEnding ?? "",
    reportedDate: r.reportedDate,
    reportedEPS: num(r.reportedEPS),
    estimatedEPS: num(r.estimatedEPS),
    surprise: num(r.surprise),
    surprisePercent: num(r.surprisePercentage),
  }));
}

export async function avDaily(ticker: string, outputsize: "compact" | "full" = "compact"): Promise<Candle[]> {
  const url = `${AV_BASE}?function=TIME_SERIES_DAILY&symbol=${ticker}&outputsize=${outputsize}&apikey=${avKey()}`;
  const d = await getJson(url).catch(() => null);
  const ts = d?.["Time Series (Daily)"];
  if (!ts) return [];
  const candles: Candle[] = Object.entries(ts).map(([date, v]: [string, any]) => ({
    date,
    open: num(v["1. open"]) ?? 0,
    high: num(v["2. high"]) ?? 0,
    low: num(v["3. low"]) ?? 0,
    close: num(v["4. close"]) ?? 0,
    volume: num(v["5. volume"]) ?? 0,
  }));
  // oldest → newest
  return candles.sort((a, b) => a.date.localeCompare(b.date));
}

// ── Finnhub (optional enrichment / fallback quote) ────────────────────

export async function fhQuote(ticker: string): Promise<Quote | null> {
  if (!fhKey()) return null;
  const url = `${FH_BASE}/quote?symbol=${ticker}&token=${fhKey()}`;
  const d = await getJson(url).catch(() => null);
  if (!d || d.c === undefined || d.c === 0) return null;
  return {
    symbol: ticker,
    price: d.c,
    change: d.d ?? 0,
    changePercent: d.dp ?? 0,
    high: d.h ?? 0,
    low: d.l ?? 0,
    open: d.o ?? 0,
    prevClose: d.pc ?? 0,
    asOf: new Date().toISOString().slice(0, 10),
  };
}

// ── Aggregator ────────────────────────────────────────────────────────

/**
 * Fetch everything needed for a full analysis of `ticker`.
 * Degrades gracefully: any failed provider call is recorded as a warning
 * rather than throwing, so partial data still renders.
 */
export async function getMarketData(ticker: string): Promise<MarketData> {
  if (dataProvider() === "yahoo") {
    const data = await getYahooMarketData(ticker);
    // If Yahoo's fundamentals endpoint is blocked from this host, backfill
    // from Alpha Vantage when a key is available (it works from cloud IPs).
    if (process.env.ALPHA_VANTAGE_API_KEY) {
      const t = data.ticker;
      if (!overviewHasData(data.overview)) {
        const ov = await avOverview(t).catch(() => null);
        if (ov) { data.overview = ov; data.sources.push("Alpha Vantage (OVERVIEW fallback)"); }
      }
      if (!financialsHasData(data.financials)) {
        const fin = await avFinancials(t).catch(() => null);
        if (fin && fin.income.length) { data.financials = fin; data.sources.push("Alpha Vantage (statements fallback)"); }
        if (data.earnings.length === 0) {
          const e = await avEarnings(t).catch(() => []);
          if (e.length) { data.earnings = e; }
        }
      }
    }
    return data;
  }
  return getAlphaVantageMarketData(ticker);
}

async function getAlphaVantageMarketData(ticker: string): Promise<MarketData> {
  const t = ticker.trim().toUpperCase();
  const sources = new Set<string>();
  const warnings: string[] = [];

  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const r = await fn();
      sources.add(label);
      return r;
    } catch (e: any) {
      warnings.push(`${label}: ${e?.message ?? "failed"}`);
      return fallback;
    }
  };

  const [overview, avQuote, financials, earnings, candles, benchmarkCandles] = await Promise.all([
    safe("Alpha Vantage (OVERVIEW)", () => avOverview(t), null),
    safe("Alpha Vantage (GLOBAL_QUOTE)", () => avGlobalQuote(t), null),
    safe("Alpha Vantage (statements)", () => avFinancials(t), { income: [], balance: [], cashflow: [] } as Financials),
    safe("Alpha Vantage (EARNINGS)", () => avEarnings(t), [] as EarningsRow[]),
    safe("Alpha Vantage (TIME_SERIES_DAILY)", () => avDaily(t, "full"), [] as Candle[]),
    safe("Alpha Vantage (SPY benchmark)", () => avDaily("SPY", "compact"), [] as Candle[]),
  ]);

  let quote = avQuote;
  if (!quote) {
    quote = await safe("Finnhub (quote)", () => fhQuote(t), null);
  }
  // last resort: derive quote from candles
  if (!quote && candles.length > 0) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] ?? last;
    quote = {
      symbol: t,
      price: last.close,
      change: last.close - prev.close,
      changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
      high: last.high,
      low: last.low,
      open: last.open,
      prevClose: prev.close,
      volume: last.volume,
      asOf: last.date,
    };
    sources.add("Derived (daily candles)");
  }

  return {
    ticker: t,
    quote,
    overview,
    financials,
    earnings,
    candles,
    benchmarkCandles,
    sources: Array.from(sources),
    warnings,
  };
}

// ── Provider-agnostic helpers (used by scan + quote routes) ───────────

/** Daily candles from the active provider (oldest → newest). */
export async function dailyCandles(ticker: string, days = 200): Promise<Candle[]> {
  if (dataProvider() === "yahoo") return yahooCandles(ticker, days);
  return avDaily(ticker, days > 130 ? "full" : "compact");
}

/** Lightweight latest quote from the active provider. */
export async function getLightQuote(ticker: string): Promise<Quote | null> {
  if (dataProvider() === "yahoo") {
    return yahooQuote(ticker).catch(() => null);
  }
  let q = await avGlobalQuote(ticker).catch(() => null);
  if (!q) q = await fhQuote(ticker).catch(() => null);
  return q;
}
