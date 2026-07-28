// Scenario valuation anchored in the stock's own trading history.
//
// A bare 5-year DCF systematically undervalues high-multiple compounders:
// with a beta-driven WACC and a fast growth taper it can land 70%+ below the
// market price, which makes a "bull case" print below spot. So the primary
// method here is a relative one — what multiple has the market actually paid
// for this company's earnings? — with the DCF kept as a cross-check.

import type { Candle } from "./types";
import type { AnnualEps } from "./sec";

export interface MultipleScenarios {
  /** P/E percentiles the market has historically assigned. */
  peLow: number;
  peMid: number;
  peHigh: number;
  forwardEps: number;
  epsGrowth: number;
  bear: number;
  base: number;
  bull: number;
  observations: number;
  method: string;
}

const pctile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Closing price on (or just before) a date. */
function priceAt(candles: Candle[], date: string): number | null {
  let best: number | null = null;
  for (const c of candles) {
    if (c.date <= date) best = c.close;
    else break;
  }
  return best;
}

/**
 * Trailing P/E the market assigned over the available price history — sampled
 * monthly against the most recently reported annual EPS at each point.
 */
export function historicalPeSamples(candles: Candle[], annualEps: AnnualEps[]): number[] {
  if (!candles.length || !annualEps.length) return [];

  // Exclude years whose EPS was anomalously depressed (one-off write-downs or
  // acquisition amortization). Those years produce enormous "P/E" readings
  // that reflect a broken denominator, not what investors were willing to pay
  // — left in, they drag the upper percentile to absurd multiples.
  const positives = annualEps.map((e) => e.eps).filter((e) => e > 0).sort((a, b) => a - b);
  const medianEps = positives.length ? pctile(positives, 0.5) : 0;
  const usable = annualEps.filter((e) => e.eps > 0 && (medianEps <= 0 || e.eps >= medianEps * 0.45));

  const epsAsc = [...(usable.length ? usable : annualEps)].sort((a, b) => a.end.localeCompare(b.end));
  const samples: number[] = [];
  for (let i = 0; i < candles.length; i += 21) {
    const c = candles[i];
    // most recent fiscal year that had already been reported by this date
    let eps: number | null = null;
    for (const e of epsAsc) {
      // allow ~2 months for the filing to land
      const reported = new Date(new Date(e.end).getTime() + 60 * 86400000).toISOString().slice(0, 10);
      if (reported <= c.date) eps = e.eps;
    }
    if (eps != null && eps > 0 && c.close > 0) {
      const pe = c.close / eps;
      if (pe > 0 && pe < 400) samples.push(pe);
    }
  }
  return samples.sort((a, b) => a - b);
}

/**
 * Build bear/base/bull price targets from historical multiples applied to a
 * forward EPS estimate. Returns null when there isn't enough EPS history.
 */
export function multipleScenarios(
  candles: Candle[],
  annualEps: AnnualEps[],
  epsTTM: number | null,
  currentPe: number | null
): MultipleScenarios | null {
  const eps0 = epsTTM ?? annualEps[0]?.eps ?? null;
  if (!eps0 || eps0 <= 0) return null;

  // EPS growth from the annual series (CAGR over up to 4 years), damped.
  let growth = 0.08;
  if (annualEps.length >= 2) {
    const newest = annualEps[0].eps;
    const oldest = annualEps[Math.min(annualEps.length - 1, 4)].eps;
    const years = Math.min(annualEps.length - 1, 4);
    if (oldest > 0 && newest > 0 && years > 0) {
      const cagr = Math.pow(newest / oldest, 1 / years) - 1;
      // damp toward a sustainable rate; cap the extremes
      growth = Math.max(-0.15, Math.min(0.35, cagr * 0.7));
    }
  }
  const forwardEps = eps0 * (1 + growth);

  const samples = historicalPeSamples(candles, annualEps);
  let peLow: number, peMid: number, peHigh: number, method: string;

  if (samples.length >= 8) {
    peMid = pctile(samples, 0.5);
    // Clamp the band around the median. Even after filtering depressed-EPS
    // years, a re-rating tail can leave the outer percentiles implying moves
    // of several hundred percent, which is not a usable scenario.
    peLow = Math.max(pctile(samples, 0.25), peMid * 0.65);
    peHigh = Math.min(pctile(samples, 0.75), peMid * 1.5);
    method = `Historical P/E percentiles (${samples.length} monthly observations, band capped at ±50% of the median multiple) applied to forward EPS`;
  } else if (currentPe && currentPe > 0) {
    // not enough history — anchor on today's multiple with a symmetric band
    peMid = currentPe;
    peLow = currentPe * 0.75;
    peHigh = currentPe * 1.25;
    method = "Current P/E with a ±25% re-rating band applied to forward EPS (limited history)";
  } else {
    return null;
  }

  return {
    peLow: round2(peLow),
    peMid: round2(peMid),
    peHigh: round2(peHigh),
    forwardEps: round2(forwardEps),
    epsGrowth: Math.round(growth * 1000) / 10,
    bear: round2(peLow * forwardEps),
    base: round2(peMid * forwardEps),
    bull: round2(peHigh * forwardEps),
    observations: samples.length,
    method,
  };
}

/**
 * Probability weights that respond to momentum and to how stretched the price
 * is against the base case, instead of being fixed at 25/55/20.
 */
export function scenarioProbabilities(
  momentumScore: number,
  price: number,
  base: number
): { bull: number; base: number; bear: number } {
  let bull = 25;
  let bear = 25;

  // Momentum tilt: a strong, confirmed trend raises the odds of the upside case.
  const mom = (momentumScore - 50) / 50; // -1 .. +1
  bull += mom * 12;
  bear -= mom * 12;

  // Valuation tilt: the further price already sits above the base case, the
  // more of the upside is spent and the more room there is to fall.
  if (base > 0 && price > 0) {
    const stretch = Math.max(-0.6, Math.min(0.6, (price - base) / base));
    bull -= stretch * 15;
    bear += stretch * 15;
  }

  bull = Math.max(10, Math.min(50, Math.round(bull)));
  bear = Math.max(10, Math.min(50, Math.round(bear)));
  // keep a floor on the base case so the distribution stays sensible
  if (bull + bear > 80) {
    const scale = 80 / (bull + bear);
    bull = Math.round(bull * scale);
    bear = Math.round(bear * scale);
  }
  return { bull, base: 100 - bull - bear, bear };
}
