// Growth inputs for Engine A, assembled from SEC XBRL annual filings.
//
// Only what the filings actually support. Forward estimates and analyst
// revisions are not in any free, keyless feed, so they are returned as null and
// the engine excludes them from the score rather than guessing (Rule #5).

import type { SecFundamentals } from "../sec";
import type { GrowthInput } from "./engines";

const pctChange = (now: number, prior: number): number | null =>
  prior > 0 ? ((now - prior) / prior) * 100 : null;

const cagr = (now: number, then: number, years: number): number | null =>
  then > 0 && now > 0 && years > 0 ? (Math.pow(now / then, 1 / years) - 1) * 100 : null;

/**
 * Build the growth picture from annual revenue and EPS series.
 *
 * A negative base year makes a percentage change meaningless — a company that
 * lost money and now earns money has not grown by "-400%" — so those pairs are
 * dropped rather than reported.
 */
export function buildGrowthInput(sec: SecFundamentals | null, isFund: boolean): GrowthInput {
  if (!sec || isFund) {
    return {
      revenueGrowthPct: null, epsGrowthPct: null,
      revenueCagr3yPct: null, epsCagr3yPct: null,
      forwardRevenueGrowthPct: null, forwardEpsGrowthPct: null,
      epsRevisionPositive: null, marginTrend: null, fcfPositive: null,
      isFund,
    };
  }

  const income = sec.financials?.income ?? [];
  const revenues = income
    .map((r) => Number(r.totalRevenue))
    .filter((v) => Number.isFinite(v) && v > 0);

  const eps = (sec.annualEps ?? []).map((e) => e.eps);

  const revenueGrowthPct = revenues.length >= 2 ? pctChange(revenues[0], revenues[1]) : null;
  const epsGrowthPct = eps.length >= 2 && eps[1] > 0 ? pctChange(eps[0], eps[1]) : null;

  const revIdx = Math.min(3, revenues.length - 1);
  const revenueCagr3yPct = revIdx >= 2 ? cagr(revenues[0], revenues[revIdx], revIdx) : null;
  const epsIdx = Math.min(3, eps.length - 1);
  const epsCagr3yPct = epsIdx >= 2 && eps[epsIdx] > 0 && eps[0] > 0 ? cagr(eps[0], eps[epsIdx], epsIdx) : null;

  // Margin direction from the last two full years of net margin.
  let marginTrend: GrowthInput["marginTrend"] = null;
  const margins = income
    .map((r) => {
      const rev = Number(r.totalRevenue);
      const ni = Number(r.netIncome);
      return Number.isFinite(rev) && rev > 0 && Number.isFinite(ni) ? (ni / rev) * 100 : null;
    })
    .filter((v): v is number => v != null);
  if (margins.length >= 2) {
    const delta = margins[0] - margins[1];
    marginTrend = delta > 0.5 ? "rising" : delta < -0.5 ? "falling" : "stable";
  }

  // Free cash flow from the most recent cash-flow year.
  let fcfPositive: boolean | null = null;
  const cf = sec.financials?.cashflow?.[0];
  if (cf) {
    const ocf = Number(cf.operatingCashflow);
    const capex = Math.abs(Number(cf.capitalExpenditures) || 0);
    if (Number.isFinite(ocf)) fcfPositive = ocf - capex > 0;
  }

  return {
    revenueGrowthPct,
    epsGrowthPct,
    revenueCagr3yPct,
    epsCagr3yPct,
    // Not available from SEC filings — the engine excludes them and says so.
    forwardRevenueGrowthPct: null,
    forwardEpsGrowthPct: null,
    epsRevisionPositive: null,
    marginTrend,
    fcfPositive,
    isFund: false,
  };
}

/** The single number the growth thesis test uses. */
export function bestGrowthPct(g: GrowthInput): number | null {
  const vals = [g.revenueGrowthPct, g.epsGrowthPct, g.revenueCagr3yPct, g.epsCagr3yPct]
    .filter((v): v is number => v != null && Number.isFinite(v));
  return vals.length ? Math.max(...vals) : null;
}
