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
const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const num = (v: any): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v.raw !== undefined) v = v.raw;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
const pick = (...vals: (number | null | undefined)[]): number | null => {
  for (const v of vals) if (v !== null && v !== undefined && Number.isFinite(v)) return v as number;
  return null;
};

function fiscalDate(v: any): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.fmt) return String(v.fmt);
  const n = num(v);
  if (n && n > 1e9) return new Date(n * 1000).toISOString().slice(0, 10);
  return String(v);
}

async function retry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
  throw lastErr;
}

// ── Raw quote (rich object, used for both Quote and Overview) ─────────
async function rawQuote(ticker: string): Promise<any | null> {
  const q = await retry<any>(() => yf.quote(ticker, { validateResult: false }));
  return q && q.regularMarketPrice !== undefined ? q : null;
}

function toQuote(q: any, ticker: string): Quote | null {
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

export async function yahooQuote(ticker: string): Promise<Quote | null> {
  return toQuote(await rawQuote(ticker), ticker);
}

/**
 * Raw chart response, exposed so callers that need more than closes — the
 * exchange's trading-period bounds, extended-hours bars — can read it without
 * standing up a second client with its own configuration.
 */
export async function yahooChartRaw(
  ticker: string,
  opts: { period1: Date; interval?: string; includePrePost?: boolean }
): Promise<any> {
  return retry<any>(() => yf.chart(ticker, opts as any));
}

// ── Candles (daily) — public chart endpoint, most reliable on cloud ───
export async function yahooCandles(ticker: string, days = 400): Promise<Candle[]> {
  const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const res = await retry<any>(() => yf.chart(ticker, { period1, interval: "1d" }));
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

// ── quoteSummary split into groups so one failing module doesn't nuke all
const PROFILE_MODULES = ["assetProfile", "summaryDetail", "defaultKeyStatistics", "financialData", "price"];
const STATEMENT_MODULES = ["incomeStatementHistory", "balanceSheetHistory", "cashflowStatementHistory", "earningsHistory"];

async function summaryGroup(ticker: string, modules: string[]): Promise<any | null> {
  try {
    return await retry<any>(() => yf.quoteSummary(ticker, { modules, validateResult: false }));
  } catch {
    return null;
  }
}

function buildOverview(ticker: string, q: any, s: any): Overview {
  const ap = s?.assetProfile ?? {};
  const sd = s?.summaryDetail ?? {};
  const ks = s?.defaultKeyStatistics ?? {};
  const fd = s?.financialData ?? {};
  const pr = s?.price ?? {};
  q = q ?? {};
  return {
    symbol: ticker,
    name: pr.longName ?? pr.shortName ?? q.longName ?? q.shortName ?? ticker,
    description: ap.longBusinessSummary ?? "",
    sector: ap.sector ?? "n/a",
    industry: ap.industry ?? "n/a",
    currency: pr.currency ?? q.currency ?? "USD",
    country: ap.country ?? "n/a",
    marketCap: pick(num(pr.marketCap), num(sd.marketCap), num(q.marketCap)),
    peRatio: pick(num(sd.trailingPE), num(q.trailingPE)),
    forwardPE: pick(num(sd.forwardPE), num(ks.forwardPE), num(q.forwardPE)),
    pegRatio: pick(num(ks.pegRatio), num(ks.trailingPegRatio)),
    priceToSales: num(sd.priceToSalesTrailing12Months),
    priceToBook: pick(num(ks.priceToBook), num(q.priceToBook)),
    eps: pick(num(ks.trailingEps), num(q.epsTrailingTwelveMonths)),
    dividendYield: pick(num(sd.dividendYield), num(q.dividendYield), num(q.trailingAnnualDividendYield)),
    profitMargin: num(fd.profitMargins),
    operatingMargin: num(fd.operatingMargins),
    roe: num(fd.returnOnEquity),
    roa: num(fd.returnOnAssets),
    revenueTTM: num(fd.totalRevenue),
    grossProfitTTM: num(fd.grossProfits),
    ebitda: num(fd.ebitda),
    beta: pick(num(sd.beta), num(ks.beta)),
    week52High: pick(num(sd.fiftyTwoWeekHigh), num(q.fiftyTwoWeekHigh)),
    week52Low: pick(num(sd.fiftyTwoWeekLow), num(q.fiftyTwoWeekLow)),
    sma50: pick(num(sd.fiftyDayAverage), num(q.fiftyDayAverage)),
    sma200: pick(num(sd.twoHundredDayAverage), num(q.twoHundredDayAverage)),
    analystTargetPrice: pick(num(fd.targetMeanPrice), num(q.targetPriceMean)),
    sharesOutstanding: pick(num(ks.sharesOutstanding), num(q.sharesOutstanding)),
  };
}

function buildFinancials(s: any): Financials {
  const mapRows = (arr: any[], dateKey: string, fields: Record<string, string>): FinancialRow[] =>
    (arr ?? []).slice(0, 5).map((r) => {
      const row: FinancialRow = { fiscalDate: fiscalDate(r[dateKey]) };
      for (const [key, yKey] of Object.entries(fields)) row[key] = num(r[yKey]) ?? 0;
      return row;
    });
  return {
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
}

function buildEarnings(s: any): EarningsRow[] {
  const hist: any[] = s?.earningsHistory?.history ?? [];
  return hist
    .map((h) => ({
      fiscalDate: fiscalDate(h.quarter),
      reportedEPS: num(h.epsActual),
      estimatedEPS: num(h.epsEstimate),
      surprise: num(h.epsDifference),
      surprisePercent: h.surprisePercent != null ? (num(h.surprisePercent) ?? 0) * 100 : null,
    }))
    .reverse()
    .slice(0, 8);
}

export function overviewHasData(o: Overview | null): boolean {
  if (!o) return false;
  return o.marketCap != null || o.peRatio != null || o.eps != null || o.revenueTTM != null;
}
export function financialsHasData(f: Financials): boolean {
  return f.income.length > 0 && Number(f.income[0].totalRevenue) > 0;
}

// ── Full aggregator ───────────────────────────────────────────────────
export async function getYahooMarketData(ticker: string): Promise<MarketData> {
  const t = ticker.trim().toUpperCase();
  const sources = new Set<string>();
  const warnings: string[] = [];

  const [q, profile, statements, candles, benchmarkCandles] = await Promise.all([
    rawQuote(t).then((r) => { if (r) sources.add("Yahoo Finance (quote)"); return r; }).catch((e) => { warnings.push(`Yahoo quote: ${e?.message ?? "failed"}`); return null; }),
    summaryGroup(t, PROFILE_MODULES).then((r) => { if (r) sources.add("Yahoo Finance (fundamentals)"); return r; }),
    summaryGroup(t, STATEMENT_MODULES).then((r) => { if (r) sources.add("Yahoo Finance (financial statements)"); return r; }),
    // 5 years of daily bars: needed to sample the historical P/E range that
    // the valuation scenarios are built from (400 days only covers one year).
    yahooCandles(t, 1900).then((r) => { sources.add("Yahoo Finance (daily history)"); return r; }).catch((e) => { warnings.push(`Yahoo history: ${e?.message ?? "failed"}`); return [] as Candle[]; }),
    yahooCandles("SPY", 200).catch(() => [] as Candle[]),
  ]);

  const overview = buildOverview(t, q, profile);
  const financials = buildFinancials(statements);
  const earnings = buildEarnings(statements);
  if (!overviewHasData(overview)) warnings.push("Yahoo fundamentals unavailable (endpoint may be blocked from this host).");
  if (!financialsHasData(financials)) warnings.push("Yahoo financial statements unavailable.");

  let quote = toQuote(q, t);
  if (!quote && candles.length > 0) {
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2] ?? last;
    quote = {
      symbol: t, price: last.close, change: last.close - prev.close,
      changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
      high: last.high, low: last.low, open: last.open, prevClose: prev.close, volume: last.volume, asOf: last.date,
    };
    sources.add("Derived (daily candles)");
  }

  return {
    ticker: t, quote, overview, financials, earnings, candles, benchmarkCandles,
    quarters: [], annualEps: [],
    sources: Array.from(sources), warnings,
  };
}
