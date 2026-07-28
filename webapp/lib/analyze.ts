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
  catalysts: { horizon: string; event: string; impact: string }[];
  risks: string[];
  targetPrice: number;
  upsidePct: number;
}

function round2(x: number) {
  return Math.round(x * 100) / 100;
}

function buildThesis(data: MarketData, dcf: DcfResult | null): ThesisScenario[] {
  const price = data.quote?.price ?? 0;
  const base = dcf?.fairValue ?? (price ? round2(price * 1.1) : 0);
  const name = data.overview?.name ?? data.ticker;
  const sector = data.overview?.sector ?? "its sector";
  return [
    {
      label: "Bull",
      probability: 25,
      targetPrice: round2(base * 1.25),
      narrative: `${name} sustains above-consensus growth in ${sector}, margins expand on operating leverage, and multiple re-rates as execution de-risks the story. Upside to ~${round2(base * 1.25)}.`,
    },
    {
      label: "Base",
      probability: 55,
      targetPrice: round2(base),
      narrative: `Growth decelerates gradually in line with the sector; margins hold. DCF fair value ~${round2(base)} anchors the base case with modest re-rating.`,
    },
    {
      label: "Bear",
      probability: 20,
      targetPrice: round2(base * 0.72),
      narrative: `Demand softens, competition compresses margins, and the multiple contracts on a risk-off tape. Downside to ~${round2(base * 0.72)}.`,
    },
  ];
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
  const { signal, reasons } = signalFrom(technicals, dcf?.upsidePct ?? null);
  const thesis = buildThesis(data, dcf);
  const price = data.quote?.price ?? 0;
  const targetPrice = thesis.reduce((acc, s) => acc + (s.targetPrice * s.probability) / 100, 0);

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
    catalysts: buildCatalysts(data),
    risks: buildRisks(data),
    targetPrice: round2(targetPrice),
    upsidePct: price ? round2(((targetPrice - price) / price) * 100) : 0,
  };
}
