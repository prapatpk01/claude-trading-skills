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
  /** Projected next ex-dividend date, extrapolated from cadence. */
  nextExDate: string | null;
  events: DividendEvent[];
}

export interface DividendSummary {
  holdings: HoldingDividend[];
  byYear: DividendPeriod[];
  byMonth: DividendPeriod[]; // last 24 months, oldest → newest
  estAnnualIncome: number;
  estMonthlyAverage: number;
  trailingIncome12m: number;
  portfolioYield: number | null;
  yieldOnCost: number | null;
  calendar: {
    ticker: string;
    exDate: string;
    estAmountPerShare: number;
    estPayout: number;
    projected: boolean;
  }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Fetch dividend events (and the latest close) for a ticker. */
export async function fetchDividends(
  ticker: string,
  years = 5
): Promise<{ events: DividendEvent[]; price: number | null }> {
  const period1 = new Date(Date.now() - years * 365 * 86400000);
  const res = await yf.chart(ticker, { period1, interval: "1d", events: "div" });
  const raw: any[] = res?.events?.dividends ?? [];
  const events: DividendEvent[] = raw
    .map((d) => ({
      date: iso(d.date instanceof Date ? d.date : new Date(d.date)),
      amount: Number(d.amount) || 0,
    }))
    .filter((d) => d.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

  const quotes: any[] = res?.quotes ?? [];
  const lastClose = [...quotes].reverse().find((q) => q.close != null)?.close ?? null;
  return { events, price: lastClose != null ? Number(lastClose) : null };
}

/** Infer payments per year from the spacing of recent ex-dates. */
export function inferFrequency(events: DividendEvent[]): { perYear: number | null; label: string } {
  if (events.length < 2) return { perYear: null, label: "unknown" };
  const recent = events.slice(-9);
  const gaps: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const g =
      (new Date(recent[i].date).getTime() - new Date(recent[i - 1].date).getTime()) / 86400000;
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

/** Project the next ex-dividend date from the last one plus the cadence. */
export function projectNextExDate(events: DividendEvent[], perYear: number | null): string | null {
  if (!events.length || !perYear) return null;
  const last = new Date(events[events.length - 1].date);
  const stepDays = Math.round(365 / perYear);
  let next = new Date(last.getTime() + stepDays * 86400000);
  // if that date has already passed, roll forward until it is in the future
  const now = Date.now();
  let guard = 0;
  while (next.getTime() < now && guard++ < 12) {
    next = new Date(next.getTime() + stepDays * 86400000);
  }
  return iso(next);
}

export interface HoldingInput {
  ticker: string;
  shares: number;
  avg_cost: number;
}

/**
 * Build the full dividend picture for a set of holdings.
 * Income is computed as (shares held now) x (per-share dividend paid), so
 * historical rows show what the *current* position would have earned — the
 * app does not store purchase dates.
 */
export async function buildDividendSummary(
  holdings: HoldingInput[],
  prices: Record<string, number | null> = {}
): Promise<DividendSummary> {
  const results: HoldingDividend[] = [];
  const yearMap = new Map<string, number>();
  const monthMap = new Map<string, number>();

  for (const h of holdings) {
    let events: DividendEvent[] = [];
    let price = prices[h.ticker] ?? null;
    try {
      const fetched = await fetchDividends(h.ticker, 5);
      events = fetched.events;
      price = price ?? fetched.price;
    } catch {
      // a ticker without dividend data simply contributes nothing
    }

    const cutoff = iso(new Date(Date.now() - 365 * 86400000));
    const ttmPerShare = events.filter((e) => e.date >= cutoff).reduce((s, e) => s + e.amount, 0);
    const { perYear, label } = inferFrequency(events);
    const last = events[events.length - 1] ?? null;

    // Forward estimate: prefer cadence x last payment (reflects a recent
    // raise); fall back to the trailing 12-month sum.
    const estPerShare = perYear && last ? last.amount * perYear : ttmPerShare;
    const estAnnualIncome = round2(estPerShare * h.shares);

    for (const e of events) {
      const income = e.amount * h.shares;
      const y = e.date.slice(0, 4);
      const m = e.date.slice(0, 7);
      yearMap.set(y, (yearMap.get(y) ?? 0) + income);
      monthMap.set(m, (monthMap.get(m) ?? 0) + income);
    }

    results.push({
      ticker: h.ticker,
      shares: h.shares,
      ttmPerShare: round2(ttmPerShare),
      lastAmount: last?.amount ?? null,
      lastExDate: last?.date ?? null,
      frequency: perYear,
      frequencyLabel: events.length ? label : "No dividend",
      estAnnualIncome,
      currentYield: price && price > 0 && estPerShare > 0 ? round2((estPerShare / price) * 100) : null,
      yieldOnCost:
        h.avg_cost > 0 && estPerShare > 0 ? round2((estPerShare / h.avg_cost) * 100) : null,
      nextExDate: projectNextExDate(events, perYear),
      events,
    });
  }

  const byYear: DividendPeriod[] = Array.from(yearMap.entries())
    .map(([period, amount]) => ({ period, amount: round2(amount) }))
    .sort((a, b) => b.period.localeCompare(a.period))
    .slice(0, 6);

  // last 24 months, including months with no payment so the chart has a
  // continuous time axis rather than collapsing gaps
  const months: DividendPeriod[] = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = iso(d).slice(0, 7);
    months.push({ period: key, amount: round2(monthMap.get(key) ?? 0) });
  }

  const estAnnualIncome = round2(results.reduce((s, r) => s + r.estAnnualIncome, 0));
  const cutoff12 = iso(new Date(Date.now() - 365 * 86400000)).slice(0, 7);
  const trailingIncome12m = round2(
    months.filter((m) => m.period >= cutoff12).reduce((s, m) => s + m.amount, 0)
  );

  let marketValue = 0;
  let costBasis = 0;
  for (const h of holdings) {
    const p = prices[h.ticker] ?? null;
    marketValue += (p ?? h.avg_cost) * h.shares;
    costBasis += h.avg_cost * h.shares;
  }

  // Upcoming payments, newest cadence projected forward one cycle each
  const calendar = results
    .filter((r) => r.nextExDate && r.lastAmount)
    .map((r) => ({
      ticker: r.ticker,
      exDate: r.nextExDate!,
      estAmountPerShare: r.lastAmount!,
      estPayout: round2(r.lastAmount! * r.shares),
      projected: true,
    }))
    .sort((a, b) => a.exDate.localeCompare(b.exDate));

  return {
    holdings: results,
    byYear,
    byMonth: months,
    estAnnualIncome,
    estMonthlyAverage: round2(estAnnualIncome / 12),
    trailingIncome12m,
    portfolioYield: marketValue > 0 ? round2((estAnnualIncome / marketValue) * 100) : null,
    yieldOnCost: costBasis > 0 ? round2((estAnnualIncome / costBasis) * 100) : null,
    calendar,
  };
}
