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
import { buildResearch, type ResearchPack } from "./research";
import { getPriceMoves, type PriceMoves } from "./priceMoves";
import { macroCalendar } from "./news/calendar";
import { fetchDividends, inferFrequency, projectNextExDate } from "./dividends";

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
  /** Price change over 1D / 1W plus any extended-hours trade. */
  moves: PriceMoves | null;
  /**
   * Peers, market sizing, returns on capital, moat and the dated catalyst
   * timeline. Null when none of it could be built — the workbook then says so
   * rather than printing empty tables.
   */
  research: ResearchPack | null;
  /** Probability-weighted expected return across the three scenarios. */
  expectedReturnPct: number | null;
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

/**
 * The old thematic catalyst list, kept as a fallback for the summary view.
 * The dated 12-month timeline lives in the research pack; this is what the app
 * says when that could not be built.
 */
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

/**
 * The next few projected ex-dividend dates, for the catalyst timeline. One date
 * is not a calendar, so the engine's single projection is stepped forward by the
 * payment period.
 */
async function projectedExDates(ticker: string): Promise<{ date: string; amount: number }[]> {
  try {
    const { events } = await fetchDividends(ticker, 3);
    if (!events.length) return [];
    const { perYear } = inferFrequency(events);
    const first = projectNextExDate(events, perYear);
    if (!first || !perYear) return [];
    const amount = events[events.length - 1].amount;
    const monthStep = Math.max(1, Math.round(12 / perYear));
    const out: { date: string; amount: number }[] = [];
    const d = new Date(first + "T00:00:00Z");
    for (let i = 0; i < 4; i++) {
      out.push({ date: d.toISOString().slice(0, 10), amount });
      d.setUTCMonth(d.getUTCMonth() + monthStep);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Risks, measured first and generic second.
 *
 * A risk section that lists only the four things true of every equity is
 * decoration. The measured findings come first, each with the number that
 * produced it, so a reader can tell which risks this company actually carries
 * from which are the price of owning equities at all.
 */
function buildRisks(data: MarketData): string[] {
  const ov = data.overview;
  const inc = data.financials.income;
  const bal = data.financials.balance;
  const cf = data.financials.cashflow;
  const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const measured: string[] = [];

  if (ov?.peRatio && ov.peRatio > 35) {
    measured.push(`Valuation risk — a P/E of ${ov.peRatio.toFixed(1)} prices in execution. At that multiple a single guidance cut re-rates the shares before earnings even fall.`);
  }
  if (ov?.beta && ov.beta > 1.3) {
    measured.push(`High beta (${ov.beta.toFixed(2)}) — a 10% index drawdown implies roughly ${(ov.beta * 10).toFixed(0)}% here. Sizing, not conviction, is what controls this.`);
  }

  // Leverage, measured against the balance sheet rather than asserted.
  const b0 = bal[0];
  if (b0) {
    const debt = (num(b0.longTermDebt) ?? 0) + (num(b0.shortTermDebt) ?? 0);
    const equity = num(b0.totalShareholderEquity);
    const cash = num(b0.cashAndEquivalents) ?? 0;
    if (equity && equity > 0) {
      const de = debt / equity;
      if (de > 1.5) measured.push(`Leverage risk — debt of $${(debt / 1e9).toFixed(1)}B against $${(equity / 1e9).toFixed(1)}B of equity (D/E ${de.toFixed(2)}). Refinancing at higher rates transfers value from equity to lenders.`);
      else if (debt > 0 && cash > debt) measured.push(`Net cash of $${((cash - debt) / 1e9).toFixed(1)}B — the balance sheet is a buffer, not a risk. It also means buybacks or acquisitions are the capital-allocation question.`);
    }
  }

  // Margin direction: a compressing margin is the earliest visible crack.
  const gm = inc
    .map((r) => {
      const rev = num(r.totalRevenue), gp = num(r.grossProfit);
      return rev && gp != null ? (gp / rev) * 100 : null;
    })
    .filter((v): v is number => v != null);
  if (gm.length >= 3) {
    const drop = gm[gm.length - 1] - gm[0]; // oldest − newest
    if (drop > 3) measured.push(`Margin compression — gross margin has fallen ${drop.toFixed(1)} points over ${gm.length} years, from ${gm[gm.length - 1].toFixed(1)}% to ${gm[0].toFixed(1)}%. Either pricing or input costs are moving against the business.`);
  }

  // Dilution: shares outstanding rising materially is a real cost to owners.
  const shares = inc.map((r) => num(r.dilutedShares) ?? num((r as any).weightedAverageShares)).filter((v): v is number => v != null && v > 0);
  if (shares.length >= 3) {
    const growth = ((shares[0] - shares[shares.length - 1]) / shares[shares.length - 1]) * 100;
    if (growth > 5) measured.push(`Dilution — the diluted share count has risen ${growth.toFixed(1)}% over ${shares.length} years, so per-share growth lags company growth by roughly ${(growth / (shares.length - 1)).toFixed(1)} points a year.`);
  }

  // Cash conversion: earnings the business cannot turn into cash.
  const cf0 = cf[0], i0 = inc[0];
  const ocf = cf0 ? num(cf0.operatingCashflow) : null;
  const ni = i0 ? num(i0.netIncome) : null;
  if (ocf != null && ni != null && ni > 0 && ocf < ni * 0.8) {
    measured.push(`Cash conversion — operating cash flow of $${(ocf / 1e9).toFixed(1)}B against $${(ni / 1e9).toFixed(1)}B of reported net income (${((ocf / ni) * 100).toFixed(0)}%). Earnings that do not become cash are the most common precursor to a restatement or a write-down.`);
  }

  const generic = [
    "Competitive and technology risk — share loss or pricing pressure from rivals, which shows up in the gross margin before it shows up in revenue.",
    "Macro and rate risk — a higher-for-longer path compresses long-duration equity multiples regardless of execution.",
    "Execution risk — guidance misses, supply constraints, or integration missteps.",
    "Regulatory risk — antitrust, export controls, or sector-specific policy shifts.",
  ];
  return measured.length
    ? [...measured, "— Below: risks common to the asset class rather than specific to this company —", ...generic]
    : ["No company-specific risk could be measured from the filings available, so only the risks common to every equity are listed.", ...generic];
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

  // The research pack, the price windows and the dividend calendar are all
  // independent of the model above and of each other, so they run together and
  // each degrades on its own. A peer table that could not be built must not cost
  // the reader the valuation.
  const [moves, exDates] = await Promise.all([
    getPriceMoves(ticker).catch(() => null),
    projectedExDates(ticker),
  ]);
  const macro = macroCalendar(new Date(), 400).map((e) => ({
    label: e.label, date: e.date, window: e.window, daysAway: e.daysAway,
  }));
  const research = await buildResearch({
    data,
    waccPct: dcf ? round2(dcf.wacc * 100) : null,
    projectedExDates: exDates,
    macro,
  }).catch(() => null);

  // Probability-weighted return, which is what the scenario table is for. The
  // blended target already weights the prices; this states the return it implies
  // rather than leaving the reader to compute it.
  const expectedReturnPct =
    price > 0
      ? round2(
          thesis.reduce((acc, s) => acc + ((s.targetPrice - price) / price) * 100 * (s.probability / 100), 0)
        )
      : null;

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
    moves,
    research,
    expectedReturnPct,
  };
}
