// SEC EDGAR adapter — free, no API key, works from datacenter IPs.
//
// Yahoo's quote/quoteSummary endpoints require a cookie+crumb handshake that
// Yahoo blocks for cloud hosts (Vercel/Railway), which is why fundamentals
// come back empty there while the public chart endpoint still works. SEC
// EDGAR is an official public API with no such restriction, so we use it as
// the fundamentals/statements source.
//
// Docs: https://www.sec.gov/edgar/sec-api-documentation
// SEC requires a descriptive User-Agent with contact info.

import type { Financials, FinancialRow } from "./types";

const UA = process.env.SEC_USER_AGENT || "EquityResearchWeb/1.0 (contact: research@example.com)";

async function secFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  return res.json();
}

// ── ticker → CIK ──────────────────────────────────────────────────────
let tickerMap: Record<string, string> | null = null;

export async function lookupCik(ticker: string): Promise<string | null> {
  if (!tickerMap) {
    const data = await secFetch("https://www.sec.gov/files/company_tickers.json");
    const map: Record<string, string> = {};
    for (const key of Object.keys(data ?? {})) {
      const row = data[key];
      if (row?.ticker && row?.cik_str != null) {
        map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
      }
    }
    tickerMap = map;
  }
  return tickerMap[ticker.toUpperCase()] ?? null;
}

// ── Fact extraction ───────────────────────────────────────────────────
interface FactEntry {
  end: string;
  start?: string;
  val: number;
  fy?: number;
  fp?: string;
  form?: string;
}

function unitEntries(facts: any, tag: string, unit = "USD"): FactEntry[] {
  const node = facts?.["us-gaap"]?.[tag] ?? facts?.["dei"]?.[tag];
  const units = node?.units ?? {};
  const arr = units[unit] ?? units[Object.keys(units)[0]] ?? [];
  return Array.isArray(arr) ? arr : [];
}

const days = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 86400000;

/** Annual flow figures (revenue, net income, cash flow) from 10-K filings. */
function annualFlow(facts: any, tags: string[], unit = "USD"): Map<number, number> {
  const out = new Map<number, number>();
  for (const tag of tags) {
    for (const e of unitEntries(facts, tag, unit)) {
      if (!e.start || !e.end || e.val == null) continue;
      const span = days(e.start, e.end);
      if (span < 300 || span > 400) continue; // full-year periods only
      if (e.form !== "10-K" || e.fp !== "FY") continue;
      const year = new Date(e.end).getUTCFullYear();
      if (!out.has(year)) out.set(year, e.val);
    }
  }
  return out;
}

/** Annual point-in-time figures (assets, equity, cash) from 10-K filings. */
function annualStock(facts: any, tags: string[], unit = "USD"): Map<number, number> {
  const out = new Map<number, number>();
  for (const tag of tags) {
    for (const e of unitEntries(facts, tag, unit)) {
      if (e.start || !e.end || e.val == null) continue; // instant facts have no start
      if (e.form !== "10-K") continue;
      const year = new Date(e.end).getUTCFullYear();
      if (!out.has(year)) out.set(year, e.val);
    }
  }
  return out;
}

/** Most recent value regardless of period type (used for TTM-ish figures). */
function latest(facts: any, tags: string[], unit = "USD"): number | null {
  let best: FactEntry | null = null;
  for (const tag of tags) {
    for (const e of unitEntries(facts, tag, unit)) {
      if (e.val == null || !e.end) continue;
      if (!best || e.end > best.end) best = e;
    }
  }
  return best ? best.val : null;
}

/** Sum of the last four quarterly values (trailing twelve months). */
function ttm(facts: any, tags: string[], unit = "USD"): number | null {
  const quarters: FactEntry[] = [];
  for (const tag of tags) {
    for (const e of unitEntries(facts, tag, unit)) {
      if (!e.start || !e.end || e.val == null) continue;
      const span = days(e.start, e.end);
      if (span < 80 || span > 100) continue; // ~one quarter
      quarters.push(e);
    }
    if (quarters.length) break; // prefer the first tag that has data
  }
  if (quarters.length < 4) return null;
  const seen = new Set<string>();
  const uniq = quarters
    .sort((a, b) => b.end.localeCompare(a.end))
    .filter((e) => (seen.has(e.end) ? false : (seen.add(e.end), true)));
  if (uniq.length < 4) return null;
  return uniq.slice(0, 4).reduce((s, e) => s + e.val, 0);
}

const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  interestExpense: ["InterestExpense", "InterestExpenseDebt"],
  taxExpense: ["IncomeTaxExpenseBenefit"],
  pretaxIncome: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  assets: ["Assets"],
  currentAssets: ["AssetsCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  liabilities: ["Liabilities"],
  currentLiabilities: ["LiabilitiesCurrent"],
  longTermDebt: ["LongTermDebtNoncurrent", "LongTermDebt"],
  shortTermDebt: ["DebtCurrent", "ShortTermBorrowings", "LongTermDebtCurrent"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  operatingCashflow: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  investingCashflow: ["NetCashProvidedByUsedInInvestingActivities"],
  financingCashflow: ["NetCashProvidedByUsedInFinancingActivities"],
  dividends: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"],
};

export interface SecFundamentals {
  entityName: string;
  financials: Financials;
  epsTTM: number | null;
  sharesOutstanding: number | null;
  revenueTTM: number | null;
  netIncomeTTM: number | null;
  grossProfitTTM: number | null;
  equity: number | null;
  assets: number | null;
  sic: string | null;
  /** SIC description, used as the industry label (e.g. "Semiconductors"). */
  industry: string | null;
  description: string | null;
}

/** Build financial statements + key figures from SEC XBRL company facts. */
export function parseCompanyFacts(data: any): SecFundamentals {
  const facts = data?.facts ?? {};

  const build = (defs: Record<string, { tags: string[]; kind: "flow" | "stock" }>): FinancialRow[] => {
    const maps: Record<string, Map<number, number>> = {};
    for (const [field, d] of Object.entries(defs)) {
      maps[field] = d.kind === "flow" ? annualFlow(facts, d.tags) : annualStock(facts, d.tags);
    }
    const years = new Set<number>();
    Object.values(maps).forEach((m) => m.forEach((_, y) => years.add(y)));
    return Array.from(years)
      .sort((a, b) => b - a)
      .slice(0, 5)
      .map((y) => {
        const row: FinancialRow = { fiscalDate: `${y}-12-31` };
        for (const field of Object.keys(defs)) row[field] = maps[field].get(y) ?? 0;
        return row;
      });
  };

  const income = build({
    totalRevenue: { tags: TAGS.revenue, kind: "flow" },
    grossProfit: { tags: TAGS.grossProfit, kind: "flow" },
    operatingIncome: { tags: TAGS.operatingIncome, kind: "flow" },
    ebit: { tags: TAGS.operatingIncome, kind: "flow" },
    netIncome: { tags: TAGS.netIncome, kind: "flow" },
    interestExpense: { tags: TAGS.interestExpense, kind: "flow" },
    incomeTaxExpense: { tags: TAGS.taxExpense, kind: "flow" },
    incomeBeforeTax: { tags: TAGS.pretaxIncome, kind: "flow" },
  });

  const balance = build({
    totalAssets: { tags: TAGS.assets, kind: "stock" },
    totalCurrentAssets: { tags: TAGS.currentAssets, kind: "stock" },
    cashAndEquivalents: { tags: TAGS.cash, kind: "stock" },
    totalLiabilities: { tags: TAGS.liabilities, kind: "stock" },
    totalCurrentLiabilities: { tags: TAGS.currentLiabilities, kind: "stock" },
    longTermDebt: { tags: TAGS.longTermDebt, kind: "stock" },
    shortTermDebt: { tags: TAGS.shortTermDebt, kind: "stock" },
    totalShareholderEquity: { tags: TAGS.equity, kind: "stock" },
  });

  const cashflow = build({
    operatingCashflow: { tags: TAGS.operatingCashflow, kind: "flow" },
    capitalExpenditures: { tags: TAGS.capex, kind: "flow" },
    cashflowFromInvestment: { tags: TAGS.investingCashflow, kind: "flow" },
    cashflowFromFinancing: { tags: TAGS.financingCashflow, kind: "flow" },
    dividendPayout: { tags: TAGS.dividends, kind: "flow" },
    changeInCashAndCashEquivalents: { tags: TAGS.operatingCashflow, kind: "flow" },
  });

  const epsTTM =
    ttm(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares") ??
    latest(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares");

  const sharesOutstanding =
    latest(facts, ["EntityCommonStockSharesOutstanding"], "shares") ??
    latest(facts, ["CommonStockSharesOutstanding"], "shares") ??
    latest(facts, ["WeightedAverageNumberOfDilutedSharesOutstanding"], "shares");

  const revenueTTM = ttm(facts, TAGS.revenue) ?? (Number(income[0]?.totalRevenue) || null);
  const netIncomeTTM = ttm(facts, TAGS.netIncome) ?? (Number(income[0]?.netIncome) || null);
  const grossProfitTTM = ttm(facts, TAGS.grossProfit) ?? (Number(income[0]?.grossProfit) || null);

  return {
    entityName: data?.entityName ?? "",
    financials: { income, balance, cashflow },
    epsTTM,
    sharesOutstanding,
    revenueTTM,
    netIncomeTTM,
    grossProfitTTM,
    equity: Number(balance[0]?.totalShareholderEquity) || null,
    assets: Number(balance[0]?.totalAssets) || null,
    sic: data?.sic ?? null,
    industry: null,
    description: null,
  };
}

/** Fetch and parse SEC fundamentals for a US-listed ticker. */
export async function getSecFundamentals(ticker: string): Promise<SecFundamentals | null> {
  const cik = await lookupCik(ticker);
  if (!cik) return null;

  const [factsData, submissions] = await Promise.all([
    secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`),
    // company metadata: official name, SIC industry description, exchange
    secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`).catch(() => null),
  ]);

  const parsed = parseCompanyFacts(factsData);
  if (submissions) {
    parsed.industry = submissions.sicDescription ?? null;
    parsed.sic = submissions.sic ?? parsed.sic;
    if (!parsed.entityName && submissions.name) parsed.entityName = submissions.name;
    const biz = submissions.addresses?.business;
    parsed.description = submissions.sicDescription
      ? `${submissions.name ?? ticker} — SEC-registered ${submissions.sicDescription}${biz?.stateOrCountryDescription ? `, based in ${biz.stateOrCountryDescription}` : ""}. Figures below are sourced from the company's XBRL filings (10-K/10-Q).`
      : null;
  }
  return parsed;
}
