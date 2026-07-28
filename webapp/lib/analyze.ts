import { getMarketData } from "./marketData";
import {
  computeTechnicals,
  computeMomentumScore,
  buildSwingSetup,
  defaultAssumptions,
  computeDcf,
  signalFrom,
  type DcfAssumptions,
} from "./analysis";
import type {
  MarketData,
  TechnicalSignals,
  MomentumScore,
  DcfResult,
  SwingSetup,
} from "./types";
import { multipleScenarios, scenarioProbabilities, type MultipleScenarios } from "./valuation";

export interface ThesisScenario {
  label: "Bull" | "Base" | "Bear";
  probability: number; // %
  targetPrice: number;
  narrative: string;
}

export interface AnalysisResult {
  ticker: string;
  asOf: string;
  data: MarketData;
  technicals: TechnicalSignals;
  momentum: MomentumScore;
  swing: SwingSetup | null;
  dcf: DcfResult | null;
  assumptions: DcfAssumptions;
  signal: "BUY" | "HOLD" | "SELL";
  signalReasons: string[];
  thesis: ThesisScenario[];
  /** How the scenario targets were derived (method + key inputs). */
  valuationNote: string;
  multiples: MultipleScenarios | null;
  catalysts: { horizon: string; event: string; impact: string }[];
  risks: string[];
  targetPrice: number;
  upsidePct: number;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

function buildThesis(
  data: MarketData,
  dcf: DcfResult | null,
  mult: MultipleScenarios | null,
  momentumScore: number
): { scenarios: ThesisScenario[]; valuationNote: string } {
  const price = data.quote?.price ?? 0;
  const name = data.overview?.name ?? data.ticker;
  const sector = data.overview?.sector ?? "its sector";

  // Prefer the market-anchored multiple method; fall back to the DCF, and to
  // a price-anchored band only when neither is available.
  let bear: number, base: number, bull: number, note: string;
  if (mult) {
    ({ bear, base, bull } = mult);
    note = `${mult.method}. Forward EPS $${mult.forwardEps} (${mult.epsGrowth >= 0 ? "+" : ""}${mult.epsGrowth}% growth); P/E band ${mult.peLow}x / ${mult.peMid}x / ${mult.peHigh}x.`;
    if (dcf) {
      const gap = base > 0 ? ((dcf.fairValue - base) / base) * 100 : 0;
      note += ` DCF cross-check: $${dcf.fairValue} (${gap >= 0 ? "+" : ""}${Math.round(gap)}% vs base) at a ${(dcf.wacc * 100).toFixed(1)}% WACC — a large gap usually means the market is pricing growth beyond the explicit forecast horizon.`;
    }
  } else if (dcf) {
    base = dcf.fairValue;
    bull = round2(base * 1.25);
    bear = round2(base * 0.75);
    note = `DCF-based (no usable EPS history for a multiple approach). WACC ${(dcf.wacc * 100).toFixed(1)}%, terminal growth ${(dcf.terminalGrowth * 100).toFixed(1)}%.`;
  } else {
    base = round2(price);
    bull = round2(price * 1.2);
    bear = round2(price * 0.8);
    note = "Insufficient fundamental data — scenarios are a generic ±20% band around the current price and should not be relied on.";
  }

  const p = scenarioProbabilities(momentumScore, price, base);
  const ret = (t: number) => (price ? ` (${t >= price ? "+" : ""}${Math.round(((t - price) / price) * 100)}% vs spot)` : "");

  return {
    valuationNote: note,
    scenarios: [
      {
        label: "Bull",
        probability: p.bull,
        targetPrice: bull,
        narrative: `${name} sustains above-trend growth in ${sector}, margins expand on operating leverage, and the market pays a premium multiple (upper end of its historical range). Target ~$${bull}${ret(bull)}.`,
      },
      {
        label: "Base",
        probability: p.base,
        targetPrice: base,
        narrative: `Growth moderates toward trend and the shares hold their typical multiple. Target ~$${base}${ret(base)}.`,
      },
      {
        label: "Bear",
        probability: p.bear,
        targetPrice: bear,
        narrative: `Demand softens, competition compresses margins, and the multiple de-rates to the low end of its historical range. Target ~$${bear}${ret(bear)}.`,
      },
    ],
  };
}

function buildCatalysts(data: MarketData) {
  const nextEarnings = data.earnings[0]?.reportedDate
    ? "Next quarterly earnings"
    : "Upcoming earnings report";
  return [
    { horizon: "0–3 months", event: nextEarnings, impact: "Beat/raise vs consensus is the primary near-term driver; watch guidance revision." },
    { horizon: "3–6 months", event: "Product / demand cycle updates", impact: "New product ramp or order pipeline confirms the growth trajectory." },
    { horizon: "6–12 months", event: "Sector rotation & macro", impact: `Rate path and ${data.overview?.sector ?? "sector"} capex cycle drive the multiple.` },
    { horizon: "Ongoing", event: "Analyst estimate revisions (PEAD)", impact: "Post-earnings drift and revision momentum sustain or fade the trend." },
  ];
}

function buildRisks(data: MarketData): string[] {
  const ov = data.overview;
  const risks: string[] = [];
  if (ov?.peRatio && ov.peRatio > 35) risks.push(`Valuation risk — P/E of ${ov.peRatio.toFixed(1)} leaves little room for a miss.`);
  if (ov?.beta && ov.beta > 1.3) risks.push(`High beta (${ov.beta.toFixed(2)}) — amplified drawdowns in risk-off regimes.`);
  risks.push("Competitive/technology risk — share loss or pricing pressure from rivals.");
  risks.push("Macro & rate risk — higher-for-longer rates compress long-duration equity multiples.");
  risks.push("Execution risk — guidance misses, supply constraints, or integration missteps.");
  risks.push("Regulatory risk — antitrust, export controls, or sector-specific policy shifts.");
  return risks;
}

/** Detect a rough catalyst flag from recent earnings surprise + drift. */
function hasCatalystDrift(data: MarketData): boolean {
  const e = data.earnings[0];
  if (e?.surprisePercent != null && e.surprisePercent > 3) return true;
  return false;
}

export async function buildAnalysis(ticker: string): Promise<AnalysisResult> {
  const data = await getMarketData(ticker);
  const technicals = computeTechnicals(data);
  const catalystFlag = hasCatalystDrift(data);
  const momentum = computeMomentumScore(technicals, catalystFlag);
  const assumptions = defaultAssumptions(data);
  const dcf = computeDcf(data, assumptions);
  const catalystNote = catalystFlag
    ? `Post-earnings drift: last quarter beat by ${data.earnings[0]?.surprisePercent?.toFixed(1)}%. Revision momentum positive.`
    : "Sector-rotation / trend-persistence driver; no fresh earnings surprise flagged.";
  const swing = buildSwingSetup(data, technicals, momentum, catalystNote);
  const multiples = multipleScenarios(
    data.candles,
    data.annualEps,
    data.overview?.eps ?? null,
    data.overview?.peRatio ?? null
  );
  const { scenarios: thesis, valuationNote } = buildThesis(data, dcf, multiples, momentum.total);
  const price = data.quote?.price ?? 0;
  const targetPrice = thesis.reduce((acc, s) => acc + (s.targetPrice * s.probability) / 100, 0);
  // The signal follows the blended target (market-anchored) rather than the
  // DCF alone, which can sit far from spot for high-multiple compounders.
  const blendedUpside = price ? ((targetPrice - price) / price) * 100 : null;
  const { signal, reasons } = signalFrom(technicals, blendedUpside);

  return {
    ticker: data.ticker,
    asOf: new Date().toISOString(),
    data,
    technicals,
    momentum,
    swing,
    dcf,
    assumptions,
    signal,
    signalReasons: reasons,
    thesis,
    valuationNote,
    multiples,
    catalysts: buildCatalysts(data),
    risks: buildRisks(data),
    targetPrice: round2(targetPrice),
    upsidePct: price ? round2(((targetPrice - price) / price) * 100) : 0,
  };
}
