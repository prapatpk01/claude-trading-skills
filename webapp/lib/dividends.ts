// Dividend history, income aggregation, forward estimate and calendar.
//
// Source is Yahoo's public chart endpoint, which returns `events.dividends`
// alongside the price bars. That endpoint works from datacenter IPs (unlike
// quote/quoteSummary), so this keeps working in production.

import YahooFinance from "yahoo-finance2";

const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

export interface DividendEvent {
  date: string; // ex-dividend date
  amount: number; // per share
}

export interface DividendPeriod {
  period: string; // "2025" or "2025-03"
  amount: number; // total income for the portfolio
  perShare?: number;
}

export interface HoldingDividend {
  ticker: string;
  shares: number;
  /** Sum of per-share dividends over the trailing 12 months. */
  ttmPerShare: number;
  /** Regular payment amount (most recent). */
  lastAmount: number | null;
  lastExDate: string | null;
  /** Payments per year inferred from spacing (4 = quarterly). */
  frequency: number | null;
  frequencyLabel: string;
  /** Forward 12-month income estimate for this position. */
  estAnnualIncome: number;
  /** Yield on current price and on the holder's cost basis. */
  currentYield: number | null;
  yieldOnCost: number | null;
  /** Projected next ex-dividend date, extrapolated from the issuer's pattern. */
  nextExDate: string | null;
  /** Estimated payment date for that ex-date. */
  nextPayDate: string | null;
  /** Forward income after the 15% US withholding. */
  estAnnualIncomeNet: number;
  events: DividendEvent[];
}

export interface DividendSummary {
  holdings: HoldingDividend[];
  byYear: DividendPeriod[];
  byMonth: DividendPeriod[];
  estAnnualIncome: number;
  estMonthlyAverage: number;
  trailingIncome12m: number;
  portfolioYield: number | null;
  yieldOnCost: number | null;
  withholdingPct: number;
  estAnnualIncomeNet: number;
  estMonthlyAverageNet: number;
  trailingIncome12mNet: number;
  portfolioYieldNet: number | null;
  yieldOnCostNet: number | null;
  byYearNet: DividendPeriod[];
  byMonthNet: DividendPeriod[];
  calendar: { ticker: string; exDate: string; payDate: string; estAmountPerShare: number; estPayout: number; estPayoutNet: number; projected: boolean }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function normalizeDividendRows(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return Object.values(raw as Record<string, unknown>);
  return [];
}

/** Fetch dividend events (and the latest close) for a ticker. */
export async function fetchDividends(ticker: string, years = 5): Promise<{ events: DividendEvent[]; price: number | null }> {
  const period1 = new Date(Date.now() - years * 365 * 86400000);
  const res = await yf.chart(ticker, { period1, interval: "1d", events: "div" });
  const raw = normalizeDividendRows(res?.events?.dividends);
  const events: DividendEvent[] = raw
    .map((d: any) => {
      const rawDate = d?.date ?? d?.datetime ?? d?.timestamp;
      const parsed = rawDate instanceof Date ? rawDate : new Date(typeof rawDate === "number" && rawDate < 1e12 ? rawDate * 1000 : rawDate);
      return {
        date: Number.isFinite(parsed.getTime()) ? iso(parsed) : "",
        amount: Number(d?.amount ?? d?.dividend ?? d?.value) || 0,
      };
    })
    .filter((d) => d.date && d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const quotesRaw = res?.quotes;
  const quotes: any[] = Array.isArray(quotesRaw) ? quotesRaw : quotesRaw && typeof quotesRaw === "object" ? Object.values(quotesRaw) : [];
  const lastClose = [...quotes].reverse().find((q) => q?.close != null)?.close ?? null;
  return { events, price: lastClose != null ? Number(lastClose) : null };
}

export function inferFrequency(events: DividendEvent[]): { perYear: number | null; label: string } {
  if (events.length < 2) return { perYear: null, label: "unknown" };
  const recent = events.slice(-9);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const g = (new Date(recent[i].date).getTime() - new Date(recent[i - 1].date).getTime()) / 86400000;
    if (g > 10) gaps.push(g);
  }
  if (!gaps.length) return { perYear: null, label: "unknown" };
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 45) return { perYear: 12, label: "Monthly" };
  if (median <= 135) return { perYear: 4, label: "Quarterly" };
  if (median <= 250) return { perYear: 2, label: "Semi-annual" };
  return { perYear: 1, label: "Annual" };
}

export const WITHHOLDING_PCT = 15;
const net = (gross: number, pct = WITHHOLDING_PCT) => gross * (1 - pct / 100);
function toWeekday(d: Date): Date { const day = d.getUTCDay(); if (day === 6) return new Date(d.getTime() + 2 * 86400000); if (day === 0) return new Date(d.getTime() + 86400000); return d; }
export function projectNextExDate(events: DividendEvent[], perYear: number | null): string | null {
  if (!events.length || !perYear) return null;
  const last = new Date(events[events.length - 1].date + "T00:00:00Z"); const now = new Date();
  const days = events.slice(-8).map((e) => new Date(e.date + "T00:00:00Z").getUTCDate()).sort((a, b) => a - b);
  const targetDay = days.length ? days[Math.floor(days.length / 2)] : last.getUTCDate(); const monthStep = Math.max(1, Math.round(12 / perYear));
  let candidate = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + monthStep, targetDay)); let guard = 0;
  while (candidate.getTime() < now.getTime() && guard++ < 24) candidate = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + monthStep, targetDay));
  if (candidate.getUTCDate() !== targetDay) candidate = new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), 0));
  return iso(toWeekday(candidate));
}
export function payLagDays(frequencyLabel: string): number { switch (frequencyLabel) { case "Monthly": return 7; case "Quarterly": return 21; case "Semi-annual": return 30; default: return 30; } }
export function projectPayDate(exDate: string, frequencyLabel: string): string { const d = new Date(exDate + "T00:00:00Z"); return iso(toWeekday(new Date(d.getTime() + payLagDays(frequencyLabel) * 86400000))); }
export interface HoldingInput { ticker: string; shares: number; avg_cost: number; }

export async function buildDividendSummary(holdings: HoldingInput[], prices: Record<string, number | null> = {}): Promise<DividendSummary> {
  const results: HoldingDividend[] = []; const yearMap = new Map<string, number>(); const monthMap = new Map<string, number>();
  for (const h of holdings) {
    let events: DividendEvent[] = []; let price = prices[h.ticker] ?? null;
    try { const fetched = await fetchDividends(h.ticker, 5); events = fetched.events; price = price ?? fetched.price; } catch {}
    const cutoff = iso(new Date(Date.now() - 365 * 86400000)); const ttmPerShare = events.filter((e) => e.date >= cutoff).reduce((s, e) => s + e.amount, 0);
    const { perYear, label } = inferFrequency(events); const last = events[events.length - 1] ?? null; const estPerShare = perYear && last ? last.amount * perYear : ttmPerShare;
    const estAnnualIncome = round2(estPerShare * h.shares); const nextEx = projectNextExDate(events, perYear);
    for (const e of events) { const income = e.amount * h.shares, y = e.date.slice(0, 4), m = e.date.slice(0, 7); yearMap.set(y, (yearMap.get(y) ?? 0) + income); monthMap.set(m, (monthMap.get(m) ?? 0) + income); }
    results.push({ ticker: h.ticker, shares: h.shares, ttmPerShare: round2(ttmPerShare), lastAmount: last?.amount ?? null, lastExDate: last?.date ?? null, frequency: perYear, frequencyLabel: events.length ? label : "No dividend", estAnnualIncome, currentYield: price && price > 0 && estPerShare > 0 ? round2((estPerShare / price) * 100) : null, yieldOnCost: h.avg_cost > 0 && estPerShare > 0 ? round2((estPerShare / h.avg_cost) * 100) : null, estAnnualIncomeNet: round2(net(estAnnualIncome)), nextExDate: nextEx, nextPayDate: nextEx ? projectPayDate(nextEx, events.length ? label : "Quarterly") : null, events });
  }
  const byYear = Array.from(yearMap.entries()).map(([period, amount]) => ({ period, amount: round2(amount) })).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6);
  const months: DividendPeriod[] = []; const now = new Date(); for (let i = 23; i >= 0; i--) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); const key = iso(d).slice(0, 7); months.push({ period: key, amount: round2(monthMap.get(key) ?? 0) }); }
  const estAnnualIncome = round2(results.reduce((s, r) => s + r.estAnnualIncome, 0)); const cutoff12 = iso(new Date(Date.now() - 365 * 86400000)).slice(0, 7);
  const trailingIncome12m = round2(months.filter((m) => m.period >= cutoff12).reduce((s, m) => s + m.amount, 0)); let marketValue = 0, costBasis = 0;
  for (const h of holdings) { const p = prices[h.ticker] ?? null; if (p != null && p > 0) marketValue += p * h.shares; costBasis += h.avg_cost * h.shares; }
  const byYearNet = byYear.map((x) => ({ ...x, amount: round2(net(x.amount)) })); const byMonthNet = months.map((x) => ({ ...x, amount: round2(net(x.amount)) }));
  const calendar = results.filter((r) => r.nextExDate && r.lastAmount != null).map((r) => ({ ticker: r.ticker, exDate: r.nextExDate!, payDate: r.nextPayDate!, estAmountPerShare: r.lastAmount!, estPayout: round2(r.lastAmount! * r.shares), estPayoutNet: round2(net(r.lastAmount! * r.shares)), projected: true })).sort((a, b) => a.exDate.localeCompare(b.exDate));
  return { holdings: results, byYear, byMonth: months, estAnnualIncome, estMonthlyAverage: round2(estAnnualIncome / 12), trailingIncome12m, portfolioYield: marketValue > 0 ? round2(estAnnualIncome / marketValue * 100) : null, yieldOnCost: costBasis > 0 ? round2(estAnnualIncome / costBasis * 100) : null, withholdingPct: WITHHOLDING_PCT, estAnnualIncomeNet: round2(net(estAnnualIncome)), estMonthlyAverageNet: round2(net(estAnnualIncome) / 12), trailingIncome12mNet: round2(net(trailingIncome12m)), portfolioYieldNet: marketValue > 0 ? round2(net(estAnnualIncome) / marketValue * 100) : null, yieldOnCostNet: costBasis > 0 ? round2(net(estAnnualIncome) / costBasis * 100) : null, byYearNet, byMonthNet, calendar };
}
