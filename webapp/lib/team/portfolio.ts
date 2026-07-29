// Sentinel Global Fund — portfolio framework (Lena Müller).
// Sleeve targets, Rule #7 drift alerts, dual-objective scorecard.

export type Sleeve = "Growth/Momentum" | "Income/Dividend" | "Cash/Defensive";

/**
 * Team Rules v4 strategic allocation. Cash is a regime variable, not a
 * standing 10% — see REGIME_ALLOCATION.
 */
export const SLEEVE_TARGETS: Record<Sleeve, number> = {
  "Growth/Momentum": 55,
  "Income/Dividend": 35,
  "Cash/Defensive": 10,
};

/** Permitted ranges around the strategic targets (v4 §2). */
export const SLEEVE_RANGES: Record<Sleeve, [number, number]> = {
  "Growth/Momentum": [45, 65],
  "Income/Dividend": [25, 45],
  "Cash/Defensive": [5, 25],
};

/** v4 §2 — the allocation shifts with the regime rather than being held fixed. */
export const REGIME_ALLOCATION: Record<string, Record<Sleeve, number>> = {
  "Risk-On": { "Growth/Momentum": 60, "Income/Dividend": 35, "Cash/Defensive": 5 },
  Neutral: { "Growth/Momentum": 50, "Income/Dividend": 35, "Cash/Defensive": 15 },
  "Risk-Off": { "Growth/Momentum": 30, "Income/Dividend": 45, "Cash/Defensive": 25 },
  Crisis: { "Growth/Momentum": 25, "Income/Dividend": 35, "Cash/Defensive": 40 },
};

/** Targets for the regime in force, falling back to the strategic mix. */
export function allocationFor(regime: string | null | undefined): Record<Sleeve, number> {
  return (regime && REGIME_ALLOCATION[regime]) || SLEEVE_TARGETS;
}

/**
 * Where a regime allocation deliberately sits outside its strategic band.
 *
 * v4 §2 sets the Growth range at 45-65%, but the Risk-Off allocation is 30% —
 * the tactical de-risk is meant to breach the strategic band, not respect it.
 * Reporting the breach as intentional keeps the drift alert from firing on a
 * position the rules explicitly ask for.
 */
export function tacticalBreaches(regime: string | null | undefined): { sleeve: Sleeve; target: number; band: [number, number] }[] {
  const alloc = allocationFor(regime);
  const out: { sleeve: Sleeve; target: number; band: [number, number] }[] = [];
  for (const sleeve of Object.keys(alloc) as Sleeve[]) {
    const [lo, hi] = SLEEVE_RANGES[sleeve];
    const t = alloc[sleeve];
    if (t < lo || t > hi) out.push({ sleeve, target: t, band: [lo, hi] });
  }
  return out;
}

/** Rule #7 — drift beyond this many points raises an alert. */
export const DRIFT_ALERT_PCT = 5;

// Known instruments from the fund's own book and watchlist, so the classifier
// starts from the sleeve the fund actually assigns them.
const CASH_DEFENSIVE = new Set(["SGOV", "JAAA", "BIL", "SHV", "USFR", "ICSH", "TFLO"]);
const INCOME = new Set([
  "BALI", "SCHD", "O", "HSBC", "QDVO", "GPIQ", "JEPI", "JEPQ", "MAIN", "DIVO",
  "VYM", "DGRO", "SPYI", "QYLD", "RYLD", "XYLD", "PFF", "VNQ", "DFIV", "AVDV",
]);

/**
 * Assign a sleeve. Yield is the deciding signal for anything not already
 * known: the fund treats a high distribution rate as income regardless of
 * wrapper, and near-zero-volatility cash instruments as defensive.
 */
export function classifySleeve(ticker: string, yieldPct: number | null, beta: number | null): Sleeve {
  const t = ticker.toUpperCase();
  if (CASH_DEFENSIVE.has(t)) return "Cash/Defensive";
  if (INCOME.has(t)) return "Income/Dividend";
  if (yieldPct != null && yieldPct >= 4) return "Income/Dividend";
  if (yieldPct != null && yieldPct >= 2.5 && (beta ?? 1) < 0.9) return "Income/Dividend";
  return "Growth/Momentum";
}

export interface SleeveRow {
  sleeve: Sleeve;
  value: number;
  actualPct: number;
  targetPct: number;
  driftPct: number;
  alert: boolean;
  tickers: string[];
}

export interface HoldingLike {
  ticker: string;
  shares: number;
  avg_cost: number;
  price: number | null;
  yieldPct?: number | null;
  beta?: number | null;
}

export function buildSleeves(holdings: HoldingLike[]): { rows: SleeveRow[]; nav: number } {
  const nav = holdings.reduce((s, h) => s + (h.price ?? h.avg_cost) * h.shares, 0);
  const byS = new Map<Sleeve, { value: number; tickers: string[] }>();
  for (const s of Object.keys(SLEEVE_TARGETS) as Sleeve[]) byS.set(s, { value: 0, tickers: [] });

  for (const h of holdings) {
    const sleeve = classifySleeve(h.ticker, h.yieldPct ?? null, h.beta ?? null);
    const entry = byS.get(sleeve)!;
    entry.value += (h.price ?? h.avg_cost) * h.shares;
    entry.tickers.push(h.ticker);
  }

  const rows: SleeveRow[] = (Object.keys(SLEEVE_TARGETS) as Sleeve[]).map((sleeve) => {
    const e = byS.get(sleeve)!;
    const actualPct = nav > 0 ? (e.value / nav) * 100 : 0;
    const targetPct = SLEEVE_TARGETS[sleeve];
    const driftPct = actualPct - targetPct;
    return {
      sleeve,
      value: Math.round(e.value * 100) / 100,
      actualPct: Math.round(actualPct * 100) / 100,
      targetPct,
      driftPct: Math.round(driftPct * 100) / 100,
      alert: Math.abs(driftPct) > DRIFT_ALERT_PCT,
      tickers: e.tickers,
    };
  });

  return { rows, nav: Math.round(nav * 100) / 100 };
}

export interface DualObjective {
  label: string;
  target: string;
  actual: string;
  pass: boolean | null;
  note: string;
}

/**
 * Objective 1: total return ≥ 1.3 × SPY.
 * Objective 2: blended yield ≥ 5%.
 */
export function dualObjectiveScorecard(
  portfolioReturnPct: number | null,
  spyReturnPct: number | null,
  blendedYieldPct: number | null
): DualObjective[] {
  const required = spyReturnPct != null ? spyReturnPct * 1.3 : null;
  return [
    {
      label: "Objective 1 — Total return ≥ 1.3× SPY",
      target: required != null ? `${required >= 0 ? "+" : ""}${required.toFixed(2)}%` : "n/a",
      actual: portfolioReturnPct != null ? `${portfolioReturnPct >= 0 ? "+" : ""}${portfolioReturnPct.toFixed(2)}%` : "n/a",
      pass: portfolioReturnPct != null && required != null ? portfolioReturnPct >= required : null,
      note:
        spyReturnPct != null
          ? `SPY over the same window ${spyReturnPct >= 0 ? "+" : ""}${spyReturnPct.toFixed(2)}%`
          : "Benchmark unavailable",
    },
    {
      label: "Objective 2 — Blended yield ≥ 5%",
      target: "5.00%",
      actual: blendedYieldPct != null ? `${blendedYieldPct.toFixed(2)}%` : "n/a",
      pass: blendedYieldPct != null ? blendedYieldPct >= 5 : null,
      note: "Weighted by position value, from forward income estimates",
    },
  ];
}

/** Blended portfolio yield: each position's yield weighted by its value. */
export function blendedYield(holdings: HoldingLike[]): { blended: number | null; rows: { ticker: string; weightPct: number; yieldPct: number; contribution: number }[] } {
  const nav = holdings.reduce((s, h) => s + (h.price ?? h.avg_cost) * h.shares, 0);
  if (nav <= 0) return { blended: null, rows: [] };
  const rows = holdings.map((h) => {
    const value = (h.price ?? h.avg_cost) * h.shares;
    const weightPct = (value / nav) * 100;
    const yieldPct = h.yieldPct ?? 0;
    return {
      ticker: h.ticker,
      weightPct: Math.round(weightPct * 100) / 100,
      yieldPct: Math.round(yieldPct * 100) / 100,
      contribution: Math.round((weightPct * yieldPct) / 100 * 100) / 100,
    };
  });
  const blended = rows.reduce((s, r) => s + r.contribution, 0);
  return { blended: Math.round(blended * 100) / 100, rows };
}

export interface CorrelationFlag {
  a: string;
  b: string;
  correlation: number;
}

/** Flag pairs above 0.7 correlation, per the risk section. */
export function correlationFlags(
  series: Record<string, number[]>,
  threshold = 0.7
): CorrelationFlag[] {
  const tickers = Object.keys(series);
  const flags: CorrelationFlag[] = [];
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      const a = series[tickers[i]];
      const b = series[tickers[j]];
      const n = Math.min(a.length, b.length);
      if (n < 30) continue;
      const av = a.slice(-n);
      const bv = b.slice(-n);
      const ma = av.reduce((s, x) => s + x, 0) / n;
      const mb = bv.reduce((s, x) => s + x, 0) / n;
      let num = 0, da = 0, db = 0;
      for (let k = 0; k < n; k++) {
        num += (av[k] - ma) * (bv[k] - mb);
        da += (av[k] - ma) ** 2;
        db += (bv[k] - mb) ** 2;
      }
      if (da === 0 || db === 0) continue;
      const corr = num / Math.sqrt(da * db);
      if (corr > threshold) {
        flags.push({ a: tickers[i], b: tickers[j], correlation: Math.round(corr * 100) / 100 });
      }
    }
  }
  return flags.sort((x, y) => y.correlation - x.correlation);
}
