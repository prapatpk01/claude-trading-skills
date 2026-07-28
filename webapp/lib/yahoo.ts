import YahooFinance from "yahoo-finance2";
import type {
  Quote,
  Overview,
  Financials,
  FinancialRow,
  EarningsRow,
  Candle,
  MarketData,
} from "./types";

// yahoo-finance2 v4 is class-based and must be instantiated.
// Cast to any so we can pass lenient runtime options without type friction.
const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

function fiscalDate(v: any): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.fmt) return String(v.fmt);
  const n = num(v);
  if (n && n > 1e9) return new Date(n * 1000).toISOString().slice(0, 10);
  return String(v);
}

// ── Quote ─────────────────────────────────────────────────────────────
export async function yahooQuote(ticker: string): Promise<Quote | null> {
  const q = await yf.quote(ticker, { validateResult: false });
  if (!q || q.regularMarketPrice === undefined) return null;
  return {
    symbol: q.symbol ?? ticker,
    price: num(q.regularMarketPrice) ?? 0,
    change: num(q.regularMarketChange) ?? 0,
    changePercent: num(q.regularMarketChangePercent) ?? 0,
    high: num(q.regularMarketDayHigh) ?? 0,
    low: num(q.regularMarketDayLow) ?? 0,
    open: num(q.regularMarketOpen) ?? 0,
    prevClose: num(q.regularMarketPreviousClose) ?? 0,
    volume: num(q.regularMarketVolume) ?? undefined,
    asOf: q.regularMarketTime ? new Date(q.regularMarketTime).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

// ── Candles (daily) ───────────────────────────────────────────────────
export async function yahooCandles(ticker: string, days = 400): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await yf.chart(ticker, { period1, interval: "1d" });
  const rows: any[] = res?.quotes ?? [];
  return rows
    .filter((r) => r.close != null)
    .map((r) => ({
      date: (r.date instanceof Date ? r.date : new Date(r.date)).toISOString().slice(0, 10),
      open: num(r.open) ?? 0,
      high: num(r.high) ?? 0,
      low: num(r.low) ?? 0,
      close: num(r.close) ?? 0,
      volume: num(r.volume) ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Overview + financials + earnings from one quoteSummary call ────────
const SUMMARY_MODULES = [
  "assetProfile",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "price",
  "incomeStatementHistory",
  "balanceSheetHistory",
  "cashflowStatementHistory",
  "earningsHistory",
];

interface SummaryBundle {
  overview: Overview | null;
  financials: Financials;
  earnings: EarningsRow[];
}

export async function yahooSummary(ticker: string, quote: Quote | null): Promise<SummaryBundle> {
  const s = await yf.quoteSummary(ticker, { modules: SUMMARY_MODULES, validateResult: false });
  const ap = s?.assetProfile ?? {};
  const sd = s?.summaryDetail ?? {};
  const ks = s?.defaultKeyStatistics ?? {};
  const fd = s?.financialData ?? {};
  const pr = s?.price ?? {};

  const overview: Overview = {
    symbol: ticker,
    name: pr.longName ?? pr.shortName ?? ticker,
    description: ap.longBusinessSummary ?? "",
    sector: ap.sector ?? "n/a",
    industry: ap.industry ?? "n/a",
    currency: pr.currency ?? sd.currency ?? "USD",
    country: ap.country ?? "n/a",
    marketCap: num(pr.marketCap) ?? num(sd.marketCap),
    peRatio: num(sd.trailingPE),
    forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
    pegRatio: num(ks.pegRatio) ?? num(ks.trailingPegRatio),
    priceToSales: num(sd.priceToSalesTrailing12Months),
    priceToBook: num(ks.priceToBook),
    eps: num(ks.trailingEps) ?? (quote ? num((quote as any).eps) : null),
    dividendYield: num(sd.dividendYield),
    profitMargin: num(fd.profitMargins),
    operatingMargin: num(fd.operatingMargins),
    roe: num(fd.returnOnEquity),
    roa: num(fd.returnOnAssets),
    revenueTTM: num(fd.totalRevenue),
    grossProfitTTM: num(fd.grossProfits),
    ebitda: num(fd.ebitda),
    beta: num(sd.beta) ?? num(ks.beta),
    week52High: num(sd.fiftyTwoWeekHigh),
    week52Low: num(sd.fiftyTwoWeekLow),
    sma50: num(sd.fiftyDayAverage),
    sma200: num(sd.twoHundredDayAverage),
    analystTargetPrice: num(fd.targetMeanPrice),
    sharesOutstanding: num(ks.sharesOutstanding),
  };

  const mapRows = (arr: any[], dateKey: string, fields: Record<string, string>): FinancialRow[] =>
    (arr ?? []).slice(0, 5).map((r) => {
      const row: FinancialRow = { fiscalDate: fiscalDate(r[dateKey]) };
      for (const [key, yKey] of Object.entries(fields)) row[key] = num(r[yKey]) ?? 0;
      return row;
    });

  const financials: Financials = {
    income: mapRows(s?.incomeStatementHistory?.incomeStatementHistory, "endDate", {
      totalRevenue: "totalRevenue",
      grossProfit: "grossProfit",
      operatingIncome: "operatingIncome",
      ebit: "ebit",
      netIncome: "netIncome",
      interestExpense: "interestExpense",
      incomeTaxExpense: "incomeTaxExpense",
      incomeBeforeTax: "incomeBeforeTax",
    }),
    balance: mapRows(s?.balanceSheetHistory?.balanceSheetStatements, "endDate", {
      totalAssets: "totalAssets",
      totalCurrentAssets: "totalCurrentAssets",
      cashAndEquivalents: "cash",
      totalLiabilities: "totalLiab",
      totalCurrentLiabilities: "totalCurrentLiabilities",
      longTermDebt: "longTermDebt",
      shortTermDebt: "shortLongTermDebt",
      totalShareholderEquity: "totalStockholderEquity",
    }),
    cashflow: mapRows(s?.cashflowStatementHistory?.cashflowStatements, "endDate", {
      operatingCashflow: "totalCashFromOperatingActivities",
      capitalExpenditures: "capitalExpenditures",
      cashflowFromInvestment: "totalCashflowsFromInvestingActivities",
      cashflowFromFinancing: "totalCashFromFinancingActivities",
      dividendPayout: "dividendsPaid",
      changeInCashAndCashEquivalents: "changeInCash",
    }),
  };

  const hist: any[] = s?.earningsHistory?.history ?? [];
  const earnings: EarningsRow[] = hist
    .map((h) => ({
      fiscalDate: fiscalDate(h.quarter),
      reportedEPS: num(h.epsActual),
      estimatedEPS: num(h.epsEstimate),
      surprise: num(h.epsDifference),
      // Yahoo gives surprisePercent as a ratio (0.05); express as percent (5.0)
      surprisePercent: h.surprisePercent != null ? (num(h.surprisePercent) ?? 0) * 100 : null,
    }))
    .reverse() // newest first
    .slice(0, 8);

  return { overview, financials, earnings };
}

// ── Full aggregator (mirrors marketData.getMarketData) ────────────────
export async function getYahooMarketData(ticker: string): Promise<MarketData> {
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

  const quote = await safe("Yahoo Finance (quote)", () => yahooQuote(t), null);
  const [summary, candles, benchmarkCandles] = await Promise.all([
    safe("Yahoo Finance (fundamentals)", () => yahooSummary(t, quote), {
      overview: null,
      financials: { income: [], balance: [], cashflow: [] },
      earnings: [],
    } as SummaryBundle),
    safe("Yahoo Finance (daily history)", () => yahooCandles(t, 400), [] as Candle[]),
    safe("Yahoo Finance (SPY benchmark)", () => yahooCandles("SPY", 200), [] as Candle[]),
  ]);

  let finalQuote = quote;
  if (!finalQuote && candles.length > 0) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] ?? last;
    finalQuote = {
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
    quote: finalQuote,
    overview: summary.overview,
    financials: summary.financials,
    earnings: summary.earnings,
    candles,
    benchmarkCandles,
    sources: Array.from(sources),
    warnings,
  };
}
