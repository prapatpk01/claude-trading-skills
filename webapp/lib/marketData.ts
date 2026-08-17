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
import { getSecFundamentals } from "./sec";
import { week52Range, computeBeta } from "./derive";

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
    await enrich(data);
    return data;
  }
  const data = await getAlphaVantageMarketData(ticker);
  await enrich(data);
  return data;
}

/**
 * Fill gaps left by the primary provider.
 *
 * Yahoo's quote/quoteSummary endpoints need a cookie+crumb handshake that
 * Yahoo blocks for cloud hosts, so on Vercel/Railway only the public chart
 * endpoint succeeds and fundamentals arrive empty. We repair that with:
 *   1. SEC EDGAR  — real statements & share count, free and keyless
 *   2. Alpha Vantage — optional, only if a key is configured
 *   3. Price history — beta and the 52-week range need no provider at all
 * Ratios are then derived from whatever we recovered.
 */
async function enrich(data: MarketData): Promise<void> {
  const t = data.ticker;

  // ── 1. SEC EDGAR fundamentals + statements ──
  if (!financialsHasData(data.financials) || !overviewHasData(data.overview)) {
    try {
      const sec = await getSecFundamentals(t);
      if (sec) {
        if (!financialsHasData(data.financials) && sec.financials.income.length) {
          data.financials = sec.financials;
          data.sources.push("SEC EDGAR (XBRL company facts)");
        }
        const prev = data.overview ?? emptyOverview(t);
        const hasVal = (v: any) => v != null && v !== "n/a" && v !== "";
        data.overview = {
          ...prev,
          name: prev.name && prev.name !== t ? prev.name : sec.entityName || t,
          industry: hasVal(prev.industry) ? prev.industry : sec.industry ?? "n/a",
          sector: hasVal(prev.sector) ? prev.sector : sec.industry ?? "n/a",
          description: prev.description || sec.description || "",
          eps: prev.eps ?? sec.epsTTM,
          sharesOutstanding: prev.sharesOutstanding ?? sec.sharesOutstanding,
          revenueTTM: prev.revenueTTM ?? sec.revenueTTM,
          grossProfitTTM: prev.grossProfitTTM ?? sec.grossProfitTTM,
        };
        if (sec.quarters.length) data.quarters = withYoY(sec.quarters);
        if (sec.annualEps.length) data.annualEps = sec.annualEps;

        // The trailing-twelve-month income statement.
        //
        // Annual filings can be eleven months old, so a report built only on
        // fiscal years describes a company as it was, not as it is. Revenue and
        // net income are summed from the last four filed quarters here, which is
        // both current and checkable against the quarterly table below it; gross
        // and operating income come from the SEC layer's own trailing sums,
        // because those lines are not carried per quarter.
        const q4 = sec.quarters.slice(0, 4);
        const sumOf = (pick: (q: typeof q4[number]) => number | null): number | null => {
          const vals = q4.map(pick).filter((v): v is number => v != null && Number.isFinite(v));
          return vals.length === 4 ? vals.reduce((s, v) => s + v, 0) : null;
        };
        if (q4.length) {
          data.ttm = {
            through: sec.latestQuarterEnd,
            revenue: sumOf((q) => q.revenue) ?? sec.revenueTTM,
            grossProfit: sec.grossProfitTTM,
            operatingIncome: sec.operatingIncomeTTM,
            netIncome: sumOf((q) => q.netIncome) ?? sec.netIncomeTTM,
            quartersUsed: q4.length,
          };
        }

        // Ratios are computed from the latest full fiscal year, which is the
        // most reliable series we have. A TTM sum is only used when it agrees
        // with the annual figure — stitched-together quarterly facts are easy
        // to get wrong (missing or restated filings silently understate them).
        const inc0 = data.financials.income[0];
        const bal0 = data.financials.balance[0];
        const revFY = Number(inc0?.totalRevenue) || 0;
        const niFY = Number(inc0?.netIncome) || 0;
        const opFY = Number(inc0?.operatingIncome) || 0;
        const equityFY = Number(bal0?.totalShareholderEquity) || 0;
        const assetsFY = Number(bal0?.totalAssets) || 0;

        const agrees = (ttmVal: number | null, fyVal: number) =>
          ttmVal != null && fyVal !== 0 && Math.abs(ttmVal - fyVal) / Math.abs(fyVal) < 0.6;
        const revBase = agrees(sec.revenueTTM, revFY) ? sec.revenueTTM! : revFY;
        const niBase = agrees(sec.netIncomeTTM, niFY) ? sec.netIncomeTTM! : niFY;

        if (revBase > 0 && niBase !== 0 && data.overview.profitMargin == null) {
          data.overview.profitMargin = niBase / revBase;
        }
        if (equityFY > 0 && niBase !== 0 && data.overview.roe == null) {
          data.overview.roe = niBase / equityFY;
        }
        if (assetsFY > 0 && niBase !== 0 && data.overview.roa == null) {
          data.overview.roa = niBase / assetsFY;
        }
        if (revFY > 0 && data.overview.operatingMargin == null) {
          data.overview.operatingMargin = opFY / revFY;
        }
        if (data.overview.revenueTTM == null && revBase > 0) data.overview.revenueTTM = revBase;
      }
    } catch (e: any) {
      data.warnings.push(`SEC EDGAR: ${e?.message ?? "unavailable"}`);
    }
  }

  // ── 2. Alpha Vantage (optional, only when a key is present) ──
  if (process.env.ALPHA_VANTAGE_API_KEY) {
    if (!overviewHasData(data.overview)) {
      const ov = await avOverview(t).catch(() => null);
      if (ov) { data.overview = { ...ov, ...stripNulls(data.overview) }; data.sources.push("Alpha Vantage (OVERVIEW fallback)"); }
    }
    if (!financialsHasData(data.financials)) {
      const fin = await avFinancials(t).catch(() => null);
      if (fin && fin.income.length) { data.financials = fin; data.sources.push("Alpha Vantage (statements fallback)"); }
    }
    if (data.earnings.length === 0) {
      const e = await avEarnings(t).catch(() => []);
      if (e.length) { data.earnings = e; data.sources.push("Alpha Vantage (earnings fallback)"); }
    }
  }

  // ── 3. Derived from price history — always available ──
  const price = data.quote?.price ?? 0;
  const ov = (data.overview ??= emptyOverview(t));
  if (data.candles.length) {
    if (ov.week52High == null || ov.week52Low == null) {
      const r = week52Range(data.candles);
      ov.week52High ??= r.high;
      ov.week52Low ??= r.low;
      if (r.high != null) data.sources.push("Derived (52-week range from price history)");
    }
    if (ov.beta == null && data.benchmarkCandles.length) {
      const b = computeBeta(data.candles, data.benchmarkCandles);
      if (b != null) { ov.beta = b; data.sources.push("Derived (beta vs SPY)"); }
    }
  }
  if (ov.marketCap == null && ov.sharesOutstanding && price) {
    ov.marketCap = ov.sharesOutstanding * price;
  }
  if (ov.peRatio == null && ov.eps && ov.eps > 0 && price) {
    ov.peRatio = Math.round((price / ov.eps) * 100) / 100;
  }
  if (ov.priceToSales == null && ov.revenueTTM && ov.marketCap) {
    ov.priceToSales = Math.round((ov.marketCap / ov.revenueTTM) * 100) / 100;
  }
  // Forward P/E: analyst estimates aren't available from the free sources, so
  // when no provider supplied one we estimate next year's EPS by extending the
  // company's own EPS trend. Surfaced as an estimate in the UI, not consensus.
  if (ov.forwardPE == null && price > 0) {
    const fwdEps = forwardEpsEstimate(data.annualEps, ov.eps);
    if (fwdEps && fwdEps > 0) {
      ov.forwardPE = Math.round((price / fwdEps) * 100) / 100;
      data.sources.push("Derived (forward P/E from EPS trend — estimate, not consensus)");
    }
  }
}

/** Next-year EPS estimated from the company's own annual EPS trend. */
export function forwardEpsEstimate(
  annualEps: { year: number; eps: number }[],
  epsTTM: number | null
): number | null {
  const base = epsTTM ?? annualEps[0]?.eps ?? null;
  if (!base || base <= 0) return null;
  let growth = 0.08;
  if (annualEps.length >= 2) {
    const newest = annualEps[0].eps;
    const idx = Math.min(annualEps.length - 1, 4);
    const oldest = annualEps[idx].eps;
    if (newest > 0 && oldest > 0 && idx > 0) {
      const cagr = Math.pow(newest / oldest, 1 / idx) - 1;
      growth = Math.max(-0.15, Math.min(0.35, cagr * 0.7)); // damped, capped
    }
  }
  return Math.round(base * (1 + growth) * 100) / 100;
}

/** Attach year-over-year revenue growth to each quarter (vs 4 quarters back). */
function withYoY(quarters: { end: string; revenue: number | null; netIncome: number | null; eps: number | null; netMargin: number | null }[]) {
  return quarters.map((q, i) => {
    const prior = quarters[i + 4];
    const yoy =
      prior?.revenue && q.revenue && prior.revenue !== 0
        ? (q.revenue - prior.revenue) / prior.revenue
        : null;
    return { ...q, revenueYoY: yoy };
  });
}

function stripNulls(o: any): any {
  if (!o) return {};
  const out: any = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined) out[k] = v;
  return out;
}

function emptyOverview(ticker: string): Overview {
  return {
    symbol: ticker, name: ticker, description: "", sector: "n/a", industry: "n/a",
    currency: "USD", country: "n/a", marketCap: null, peRatio: null, forwardPE: null,
    pegRatio: null, priceToSales: null, priceToBook: null, eps: null, dividendYield: null,
    profitMargin: null, operatingMargin: null, roe: null, roa: null, revenueTTM: null,
    grossProfitTTM: null, ebitda: null, beta: null, week52High: null, week52Low: null,
    sma50: null, sma200: null, analystTargetPrice: null, sharesOutstanding: null,
  };
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
    quarters: [],
    ttm: null,
    annualEps: [],
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

/**
 * Price history for portfolio screens with a provider fallback and provenance.
 * The monitor calls this once per ticker and derives the displayed price from
 * the last bar, avoiding the previous duplicate history + quote request burst.
 */
export async function dailyCandlesWithFallback(ticker: string, days = 460): Promise<{ candles: Candle[]; source: string | null; warnings: string[] }> {
  const active = dataProvider();
  const warnings: string[] = [];
  const attempt = async (label: string, fn: () => Promise<Candle[]>) => {
    try {
      const candles = await fn();
      if (candles.length) return { candles, source: label };
      warnings.push(`${label} returned no history.`);
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : "history request failed"}`);
    }
    return null;
  };

  const primary = active === "yahoo"
    ? await attempt("Yahoo Finance chart", () => yahooCandles(ticker, days))
    : await attempt("Alpha Vantage daily", () => avDaily(ticker, days > 130 ? "full" : "compact"));
  if (primary) return { ...primary, warnings };

  if (active === "alphavantage") {
    const yahooFallback = await attempt("Yahoo Finance chart fallback", () => yahooCandles(ticker, days));
    if (yahooFallback) return { ...yahooFallback, warnings };
  } else if (process.env.ALPHA_VANTAGE_API_KEY) {
    const alphaFallback = await attempt("Alpha Vantage daily fallback", () => avDaily(ticker, days > 130 ? "full" : "compact"));
    if (alphaFallback) return { ...alphaFallback, warnings };
  }

  return { candles: [], source: null, warnings };
}

/**
 * Lightweight latest quote from the active provider.
 *
 * Yahoo's `quote` endpoint needs the cookie+crumb handshake that Yahoo blocks
 * for datacenter IPs, so on Vercel/Railway it returns nothing and every
 * portfolio row would show an empty price. The public chart endpoint keeps
 * working, so we derive the last close (and day change) from it — that is the
 * path that actually succeeds in production.
 */
export async function getLightQuote(ticker: string): Promise<Quote | null> {
  if (dataProvider() === "yahoo") {
    const fromCandles = await yahooCandles(ticker, 12)
      .then((candles) => {
        if (candles.length === 0) return null;
        const last = candles[candles.length - 1];
        const prev = candles[candles.length - 2] ?? last;
        return {
          symbol: ticker,
          price: last.close,
          change: last.close - prev.close,
          changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
          high: last.high,
          low: last.low,
          open: last.open,
          prevClose: prev.close,
          volume: last.volume,
          asOf: last.date,
        } as Quote;
      })
      .catch(() => null);
    if (fromCandles) return fromCandles;
    // last resort: the authenticated endpoint, in case it is reachable here
    return yahooQuote(ticker).catch(() => null);
  }
  let q = await avGlobalQuote(ticker).catch(() => null);
  if (!q) q = await fhQuote(ticker).catch(() => null);
  return q;
}
