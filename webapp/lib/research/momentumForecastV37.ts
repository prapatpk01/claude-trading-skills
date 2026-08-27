import type { Candle } from "../types";
import type { PortfolioTechnicalOverlay } from "../portfolioTechnicalOverlay";
import { buildMomentumForecast, type MomentumForecastOptions } from "./momentumForecast";

export type ForecastHorizonKey = "5D" | "20D" | "60D";

export type ForecastHorizonRead = {
  tradingDays: number;
  expectedReturnPct: number;
  expectedAlphaPct: number | null;
  benchmarkExpectedReturnPct: number | null;
  probabilityPositivePct: number;
  probabilityGain5Pct: number;
  probabilityLoss5Pct: number;
  rangeP10Pct: number;
  medianReturnPct: number;
  rangeP90Pct: number;
  sampleSize: number;
};

export type MomentumForecastV37Options = MomentumForecastOptions & {
  benchmarkCandles?: Candle[] | null;
  benchmarkTicker?: string | null;
};

type ComponentKey = "lifecycle" | "sentinelX" | "quantMomentum" | "mcdxProxy" | "catalyst" | "valuationRoom" | "marketFit";
type WeightMap = Record<ComponentKey, number>;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function cleanCandles(rows: Candle[] | null | undefined) {
  return (rows ?? []).filter(row => Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
}

function pctMove(from: number | null, to: number | null) {
  return from != null && to != null && from > 0 ? (to / from - 1) * 100 : null;
}

function recentReturn(candles: Candle[], bars: number) {
  if (candles.length < 2) return 0;
  const last = candles.at(-1)!.close;
  const prior = candles[Math.max(0, candles.length - 1 - bars)]?.close ?? null;
  return pctMove(prior, last) ?? 0;
}

function forwardReturns(candles: Candle[], horizon: number) {
  const values: number[] = [];
  for (let i = 0; i + horizon < candles.length; i += 1) {
    const from = candles[i].close;
    const to = candles[i + horizon].close;
    if (from > 0 && Number.isFinite(to)) values.push((to / from - 1) * 100);
  }
  return values;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function deviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  return Math.sqrt(variance);
}

function quantile(values: number[], q: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * q));
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function marketFitFromBenchmark(stock: Candle[], benchmark: Candle[]) {
  if (stock.length < 60 || benchmark.length < 60) return null;
  const rel20 = recentReturn(stock, 20) - recentReturn(benchmark, 20);
  const rel60 = recentReturn(stock, 60) - recentReturn(benchmark, 60);
  return clamp(50 + rel20 * 2.1 + rel60 * 0.7);
}

function weightsFor(stage: string): WeightMap {
  if (stage === "EARLY_MARKUP" || stage === "MOMENTUM_EXPANSION") {
    return { lifecycle: .25, sentinelX: .21, quantMomentum: .22, mcdxProxy: .13, catalyst: .05, valuationRoom: .05, marketFit: .09 };
  }
  if (stage === "MATURE") {
    return { lifecycle: .18, sentinelX: .17, quantMomentum: .16, mcdxProxy: .13, catalyst: .07, valuationRoom: .17, marketFit: .12 };
  }
  if (stage === "WEAKENING" || stage === "BROKEN") {
    return { lifecycle: .22, sentinelX: .22, quantMomentum: .16, mcdxProxy: .20, catalyst: .04, valuationRoom: .05, marketFit: .11 };
  }
  return { lifecycle: .23, sentinelX: .20, quantMomentum: .20, mcdxProxy: .15, catalyst: .05, valuationRoom: .07, marketFit: .10 };
}

function effectiveDirectionalScore(
  components: Record<ComponentKey, number>,
  weights: WeightMap,
  measured: Record<ComponentKey, boolean>,
) {
  let numerator = 0;
  let denominator = 0;
  for (const key of Object.keys(weights) as ComponentKey[]) {
    if (!measured[key]) continue;
    numerator += components[key] * weights[key];
    denominator += weights[key];
  }
  return denominator > 0 ? clamp(numerator / denominator) : 50;
}

function agreementScore(components: Record<ComponentKey, number>, measured: Record<ComponentKey, boolean>, directionalScore: number) {
  const values = (Object.keys(components) as ComponentKey[]).filter(key => measured[key]).map(key => components[key]);
  if (!values.length) return 50;
  const direction = directionalScore >= 50 ? 1 : -1;
  const aligned = values.filter(value => (value - 50) * direction >= 0).length;
  const voteAgreement = aligned / values.length * 100;
  const spreadPenalty = Math.min(35, deviation(values) * 1.25);
  return Math.round(clamp(voteAgreement * .75 + (100 - spreadPenalty) * .25));
}

function horizonRead({
  stock,
  benchmark,
  horizon,
  directionalScore,
  legacyExpected,
}: {
  stock: Candle[];
  benchmark: Candle[];
  horizon: number;
  directionalScore: number;
  legacyExpected: number;
}): ForecastHorizonRead {
  const raw = forwardReturns(stock, horizon);
  const empiricalMean = average(raw);
  const empiricalDeviation = Math.max(1, deviation(raw));
  const recent = recentReturn(stock, Math.min(horizon, 60));
  const horizonScale = Math.sqrt(horizon / 20);
  const technicalAnchor = legacyExpected * horizonScale;
  const directionalEdge = ((directionalScore - 50) / 50) * empiricalDeviation * .78;
  const momentumAnchor = recent * (horizon <= 5 ? .24 : horizon <= 20 ? .20 : .14);
  const expected = clamp(
    technicalAnchor * .44 + directionalEdge * .28 + empiricalMean * .14 + momentumAnchor,
    -25,
    38,
  );

  const benchmarkRaw = benchmark.length ? forwardReturns(benchmark, horizon) : [];
  const benchmarkMean = benchmarkRaw.length ? average(benchmarkRaw) : null;
  const benchmarkRecent = benchmark.length ? recentReturn(benchmark, Math.min(horizon, 60)) : null;
  const benchmarkExpected = benchmarkMean == null || benchmarkRecent == null
    ? null
    : clamp(benchmarkMean * .45 + benchmarkRecent * .22, -18, 24);
  const expectedAlpha = benchmarkExpected == null ? null : expected - benchmarkExpected;

  const shifted = raw.length
    ? raw.map(value => value + (expected - empiricalMean))
    : [expected - empiricalDeviation * 1.3, expected, expected + empiricalDeviation * 1.3];
  const sampleSize = raw.length;
  const positive = shifted.filter(value => value > 0).length / shifted.length * 100;
  const gain5 = shifted.filter(value => value >= 5).length / shifted.length * 100;
  const loss5 = shifted.filter(value => value <= -5).length / shifted.length * 100;

  return {
    tradingDays: horizon,
    expectedReturnPct: round(expected, 1),
    expectedAlphaPct: expectedAlpha == null ? null : round(expectedAlpha, 1),
    benchmarkExpectedReturnPct: benchmarkExpected == null ? null : round(benchmarkExpected, 1),
    probabilityPositivePct: Math.round(clamp(positive)),
    probabilityGain5Pct: Math.round(clamp(gain5)),
    probabilityLoss5Pct: Math.round(clamp(loss5)),
    rangeP10Pct: round(quantile(shifted, .10), 1),
    medianReturnPct: round(quantile(shifted, .50), 1),
    rangeP90Pct: round(quantile(shifted, .90), 1),
    sampleSize,
  };
}

/**
 * Sentinel Forecast V37.
 *
 * The V26 schema is intentionally preserved for existing portfolio/action-policy
 * consumers. V37 adds a regime-adaptive, evidence-aware ensemble, removes neutral
 * placeholder weights when optional evidence is missing, and exposes 5D/20D/60D
 * probabilistic return distributions plus SPY-relative alpha.
 *
 * Probabilities are rolling-forward statistical priors shifted by the current
 * ensemble signal. They are not guarantees and are explicitly not broker orders.
 */
export function buildMomentumForecastV37(candles: Candle[], options: MomentumForecastV37Options = {}) {
  const stock = cleanCandles(candles);
  if (stock.length < 60) return null;
  const benchmark = cleanCandles(options.benchmarkCandles);
  const derivedMarketFit = finite(options.marketFitScore) ?? marketFitFromBenchmark(stock, benchmark);
  const base = buildMomentumForecast(stock, { ...options, marketFitScore: derivedMarketFit });
  if (!base) return null;

  const components: Record<ComponentKey, number> = {
    lifecycle: base.components.lifecycle,
    sentinelX: base.components.sentinelX,
    quantMomentum: base.components.quantMomentum,
    mcdxProxy: base.components.mcdxProxy,
    catalyst: base.components.catalyst,
    valuationRoom: base.components.valuationRoom,
    marketFit: derivedMarketFit ?? base.components.marketFit,
  };
  const overlayPresent = Boolean(options.technicalOverlay);
  const valuationMeasured = Boolean(options.valuation && (
    finite(options.valuation.gapPct) != null || finite(options.valuation.fairValue) != null || finite(options.valuation.bull) != null || finite(options.valuation.bear) != null
  ));
  const catalystMeasured = Boolean(options.catalyst?.measured && finite(options.catalyst.score) != null);
  const marketMeasured = derivedMarketFit != null;
  const measured: Record<ComponentKey, boolean> = {
    lifecycle: true,
    sentinelX: overlayPresent,
    quantMomentum: true,
    mcdxProxy: overlayPresent,
    catalyst: catalystMeasured,
    valuationRoom: valuationMeasured,
    marketFit: marketMeasured,
  };

  const dynamicWeights = weightsFor(base.lifecycleStage);
  const directionalScore = effectiveDirectionalScore(components, dynamicWeights, measured);
  const modelAgreementPct = agreementScore(components, measured, directionalScore);
  const legacyExpected = finite(base.expectedReturnPct) ?? 0;
  const horizons = {
    "5D": horizonRead({ stock, benchmark, horizon: 5, directionalScore, legacyExpected }),
    "20D": horizonRead({ stock, benchmark, horizon: 20, directionalScore, legacyExpected }),
    "60D": horizonRead({ stock, benchmark, horizon: 60, directionalScore, legacyExpected }),
  } satisfies Record<ForecastHorizonKey, ForecastHorizonRead>;
  const primary = horizons["20D"];
  const price = stock.at(-1)!.close;

  const sampleQuality = clamp(Math.min(100, primary.sampleSize / 2.2));
  let confidence = clamp(base.confidence * .68 + modelAgreementPct * .18 + sampleQuality * .14);
  if (marketMeasured) confidence = clamp(confidence + 3);
  if (!valuationMeasured && !catalystMeasured) confidence = Math.min(confidence, 84);
  if (!overlayPresent) confidence = Math.min(confidence, 52);
  const confidenceBand = confidence >= 75 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";

  const measuredCount = (Object.keys(measured) as ComponentKey[]).filter(key => measured[key]).length;
  const optionalEvidence = [
    valuationMeasured ? "valuation measured" : "valuation not supplied",
    catalystMeasured ? "catalyst measured" : "catalyst not supplied",
    marketMeasured ? `${options.benchmarkTicker ?? "SPY"} relative-strength measured` : "benchmark alpha unavailable",
  ];
  const drivers = [
    `V37 20D expected ${primary.expectedReturnPct >= 0 ? "+" : ""}${primary.expectedReturnPct.toFixed(1)}% · P(positive) ${primary.probabilityPositivePct}%`,
    primary.expectedAlphaPct == null ? "20D benchmark alpha unavailable" : `20D expected alpha ${primary.expectedAlphaPct >= 0 ? "+" : ""}${primary.expectedAlphaPct.toFixed(1)}% vs ${options.benchmarkTicker ?? "SPY"}`,
    `Model agreement ${modelAgreementPct}/100 · directional ensemble ${Math.round(directionalScore)}/100`,
    ...base.drivers,
  ];
  const risks = [
    ...base.risks,
    ...(!valuationMeasured ? ["Valuation is not measured in this market-data request; its weight is excluded rather than neutral-filled."] : []),
    ...(!catalystMeasured ? ["Catalyst evidence is not measured in this market-data request; its weight is excluded rather than neutral-filled."] : []),
    ...(primary.probabilityLoss5Pct >= 30 ? [`20D probability of a -5% or worse outcome is ${primary.probabilityLoss5Pct}%.`] : []),
  ];

  return {
    ...base,
    // Backward-compatible schema marker. Existing V26 consumers/tests keep working.
    version: "26.0" as const,
    engineVersion: "37.0" as const,
    horizon: "20D PRIMARY · 5D/20D/60D" as const,
    expectedReturnPct: primary.expectedReturnPct,
    expectedAlphaPct: primary.expectedAlphaPct,
    probabilityPositivePct: primary.probabilityPositivePct,
    probabilityGain5Pct: primary.probabilityGain5Pct,
    probabilityLoss5Pct: primary.probabilityLoss5Pct,
    rangeP10Pct: primary.rangeP10Pct,
    medianReturnPct: primary.medianReturnPct,
    rangeP90Pct: primary.rangeP90Pct,
    probabilityWeightedTarget: round(price * (1 + primary.expectedReturnPct / 100), 2),
    confidence: Math.round(confidence),
    confidenceBand,
    horizons,
    modelAgreementPct,
    directionalScore: Math.round(directionalScore),
    dynamicWeights,
    measuredComponents: measured,
    measuredComponentCount: measuredCount,
    benchmark: benchmark.length ? (options.benchmarkTicker ?? "SPY") : null,
    calibration: {
      status: "STATISTICAL_PRIOR" as const,
      method: "ROLLING_FORWARD_RETURN_DISTRIBUTION" as const,
      samples: {
        "5D": horizons["5D"].sampleSize,
        "20D": horizons["20D"].sampleSize,
        "60D": horizons["60D"].sampleSize,
      },
      note: "Forward-return distributions are historical priors shifted by the live ensemble. Forecast-vs-realized ledger calibration is a separate future calibration layer.",
    },
    drivers,
    risks: [...new Set(risks)],
    evidenceCoveragePct: Math.round(clamp(base.evidenceCoveragePct + (marketMeasured ? 6 : 0) + (valuationMeasured ? 4 : 0) + (catalystMeasured ? 3 : 0))),
    evidenceNotes: optionalEvidence,
    policy: {
      ...base.policy,
      probabilitiesAreStatisticalPriors: true,
      optionalNeutralPlaceholdersExcluded: true,
      benchmarkRelativeAlpha: marketMeasured,
      calibratedGuarantee: false,
      automaticTrading: false,
    },
  };
}
