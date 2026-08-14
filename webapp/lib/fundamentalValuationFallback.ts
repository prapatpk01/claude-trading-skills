import type { MarketData } from "./types";

export type FundamentalValuationAnchor = {
  label: string;
  target: number;
  weight: number;
  detail: string;
};

export type FundamentalValuationFallback = {
  targetPrice: number;
  bearPrice: number;
  bullPrice: number;
  upsidePct: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  anchors: FundamentalValuationAnchor[];
  method: string;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | null => Number.isFinite(Number(value)) ? Number(value) : null;
const round2 = (value: number) => Math.round(value * 100) / 100;

function pctValue(value: number | null) {
  if (value == null) return null;
  return Math.abs(value) <= 1.5 ? value * 100 : value;
}

function cagrNewestFirst(values: number[]) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  if (usable.length < 2) return null;
  const newest = usable[0];
  const oldest = usable[usable.length - 1];
  const years = usable.length - 1;
  return (Math.pow(newest / oldest, 1 / years) - 1) * 100;
}

function average(values: Array<number | null>, fallback: number) {
  const usable = values.filter((value): value is number => value != null && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : fallback;
}

function weightedAverage(anchors: FundamentalValuationAnchor[]) {
  const totalWeight = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
  return totalWeight > 0
    ? anchors.reduce((sum, anchor) => sum + anchor.target * anchor.weight, 0) / totalWeight
    : 0;
}

/**
 * Thomas fallback valuation for cases where DCF / historical P-E cannot be
 * established from the primary analysis path. This never uses spot as the
 * valuation anchor. Spot is used only to reject obvious per-share/basis errors.
 *
 * Independent anchors, when available:
 * - analyst consensus target (secondary evidence, never required),
 * - filing-derived forward EPS × growth/quality-adjusted fair P/E,
 * - filing-derived revenue/share × growth/margin-adjusted fair P/S,
 * - filing-derived FCF/share capitalized at a growth-adjusted FCF yield.
 */
export function fundamentalValuationFallback(data: MarketData): FundamentalValuationFallback | null {
  const price = finite(data.quote?.price);
  const overview = data.overview;
  const shares = finite(overview?.sharesOutstanding);
  const annualRevenue = data.financials.income
    .slice(0, 4)
    .map((row) => finite(row.totalRevenue))
    .filter((value): value is number => value != null && value > 0);
  const annualEps = data.annualEps
    .slice(0, 5)
    .map((row) => finite(row.eps))
    .filter((value): value is number => value != null && value > 0);

  const quarterGrowthPct = data.quarters
    .map((row) => row.revenueYoY == null ? null : row.revenueYoY * 100)
    .find((value) => value != null && Number.isFinite(value)) ?? null;
  const revenueGrowthPct = quarterGrowthPct ?? cagrNewestFirst(annualRevenue);
  const epsGrowthPct = cagrNewestFirst(annualEps);
  const growthPct = clamp(average([revenueGrowthPct, epsGrowthPct], 8), -10, 45);

  const revenue = finite(data.ttm?.revenue) ?? finite(overview?.revenueTTM) ?? annualRevenue[0] ?? null;
  const operatingIncome = finite(data.ttm?.operatingIncome) ?? finite(data.financials.income[0]?.operatingIncome);
  const operatingMarginPct = revenue && operatingIncome != null
    ? (operatingIncome / revenue) * 100
    : pctValue(finite(overview?.operatingMargin));
  const roePct = pctValue(finite(overview?.roe));

  const latestCashFlow = data.financials.cashflow[0];
  const operatingCashFlow = finite(latestCashFlow?.operatingCashflow);
  const capex = Math.abs(finite(latestCashFlow?.capitalExpenditures) ?? 0);
  const freeCashFlow = operatingCashFlow != null ? operatingCashFlow - capex : null;

  const anchors: FundamentalValuationAnchor[] = [];
  const analystTarget = finite(overview?.analystTargetPrice);
  if (analystTarget != null && analystTarget > 0) {
    anchors.push({
      label: "Analyst consensus",
      target: analystTarget,
      weight: 1.1,
      detail: `Published analyst target $${round2(analystTarget).toFixed(2)} used as secondary evidence.`,
    });
  }

  const eps = finite(overview?.eps) ?? annualEps[0] ?? null;
  if (eps != null && eps > 0) {
    const forwardGrowth = clamp(epsGrowthPct ?? growthPct, -10, 30) / 100;
    const forwardEps = eps * (1 + forwardGrowth);
    const qualityAdjustment = (operatingMarginPct ?? 0) >= 25 ? 3 : (operatingMarginPct ?? 0) >= 15 ? 1.5 : 0;
    const roeAdjustment = (roePct ?? 0) >= 25 ? 2 : (roePct ?? 0) >= 15 ? 1 : 0;
    const fairPe = clamp(16 + Math.max(0, growthPct) * 0.65 + qualityAdjustment + roeAdjustment, 13, 45);
    const target = forwardEps * fairPe;
    if (target > 0) anchors.push({
      label: "Forward EPS × fair P/E",
      target,
      weight: 1.15,
      detail: `Forward EPS $${round2(forwardEps).toFixed(2)} × ${round2(fairPe).toFixed(1)}x fair P/E; growth ${round2(growthPct).toFixed(1)}%.`,
    });
  }

  if (revenue != null && revenue > 0 && shares != null && shares > 0) {
    const revenuePerShare = revenue / shares;
    const margin = clamp(operatingMarginPct ?? 10, -10, 50);
    const fairPs = clamp(1.5 + Math.max(0, growthPct) * 0.16 + Math.max(0, margin) * 0.10, 1.5, 15);
    const target = revenuePerShare * fairPs;
    if (target > 0) anchors.push({
      label: "Revenue/share × fair P/S",
      target,
      weight: 0.9,
      detail: `Revenue/share $${round2(revenuePerShare).toFixed(2)} × ${round2(fairPs).toFixed(1)}x fair P/S; operating margin ${round2(margin).toFixed(1)}%.`,
    });
  }

  if (freeCashFlow != null && freeCashFlow > 0 && shares != null && shares > 0) {
    const fcfPerShare = freeCashFlow / shares;
    const fairYieldPct = clamp(6.2 - Math.max(0, growthPct) * 0.075 - Math.max(0, operatingMarginPct ?? 0) * 0.025, 2.5, 7.0);
    const target = fcfPerShare / (fairYieldPct / 100);
    if (target > 0) anchors.push({
      label: "FCF/share capitalization",
      target,
      weight: 1.0,
      detail: `FCF/share $${round2(fcfPerShare).toFixed(2)} capitalized at ${round2(fairYieldPct).toFixed(2)}% fair FCF yield.`,
    });
  }

  if (!anchors.length) return null;

  // Spot is a sanity rail only: reject targets that almost certainly represent
  // an unadjusted split/share basis. It never determines the fair value.
  const basisSafe = price != null && price > 0
    ? anchors.filter((anchor) => anchor.target >= price * 0.15 && anchor.target <= price * 5)
    : anchors;
  const usable = basisSafe.length ? basisSafe : anchors;
  const base = weightedAverage(usable);
  if (!(base > 0)) return null;

  const values = usable.map((anchor) => anchor.target);
  const dispersion = values.length > 1 ? (Math.max(...values) - Math.min(...values)) / base : 0.22;
  const band = clamp(Math.max(0.15, dispersion * 0.55), 0.15, 0.35);
  const targetPrice = round2(base);
  const bearPrice = round2(base * (1 - band));
  const bullPrice = round2(base * (1 + band));
  const upsidePct = price != null && price > 0 ? round2((targetPrice / price - 1) * 100) : null;
  const confidence = usable.length >= 3 ? "HIGH" : usable.length === 2 ? "MEDIUM" : "LOW";
  const anchorNames = usable.map((anchor) => anchor.label).join(" + ");

  return {
    targetPrice,
    bearPrice,
    bullPrice,
    upsidePct,
    confidence,
    anchors: usable.map((anchor) => ({ ...anchor, target: round2(anchor.target) })),
    method: `Thomas filing-based fundamental range (${anchorNames}). Spot is used only for basis sanity checks, never as the fair-value anchor.`,
  };
}
