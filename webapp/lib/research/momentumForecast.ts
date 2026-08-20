import { adx, atr, ema, rsi } from "../indicators";
import { computePortfolioTechnicalOverlay, type PortfolioTechnicalOverlay } from "../portfolioTechnicalOverlay";
import type { Candle } from "../types";
import { classifyMomentumLifecycle, type MomentumLifecycleRead, type MomentumLifecycleStage } from "./momentumLifecycle";

export type MomentumForecastOutlook = "BULLISH" | "SELECTIVE_BULLISH" | "NEUTRAL" | "DEFENSIVE" | "BEARISH";
export type MomentumForecastPath = "ACCUMULATION_BUILD" | "PULLBACK_CONTINUATION" | "BREAKOUT_CONTINUATION" | "RANGE_BUILD" | "MATURE_RESET" | "WEAKENING_RISK" | "BREAKDOWN_RISK";
export type ForecastConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

export type MomentumForecastScenario = {
  name: "BEAR" | "BASE" | "BULL";
  target: number | null;
  returnPct: number | null;
  probability: number;
  rationale: string;
};

export type MomentumForecast = {
  version: "26.0";
  horizon: "20–60 TRADING DAYS";
  asOf: string | null;
  outlook: MomentumForecastOutlook;
  confidence: number;
  confidenceBand: ForecastConfidenceBand;
  lifecycleStage: MomentumLifecycleStage;
  lifecycleScore: number;
  path: MomentumForecastPath;
  probabilityWeightedTarget: number | null;
  expectedReturnPct: number | null;
  scenarios: {
    bear: MomentumForecastScenario;
    base: MomentumForecastScenario;
    bull: MomentumForecastScenario;
  };
  trigger: string;
  invalidation: string;
  drivers: string[];
  risks: string[];
  components: {
    lifecycle: number;
    sentinelX: number;
    quantMomentum: number;
    mcdxProxy: number;
    catalyst: number;
    valuationRoom: number;
    marketFit: number;
  };
  evidenceCoveragePct: number;
  policy: {
    probabilityIsScenarioWeight: true;
    confidenceIsEvidenceQuality: true;
    mcdxSyntheticProxy: true;
    notPriceGuarantee: true;
    automaticTrading: false;
  };
};

export type MomentumForecastOptions = {
  technicalOverlay?: PortfolioTechnicalOverlay | null;
  lifecycle?: MomentumLifecycleRead | null;
  valuation?: {
    fairValue?: number | null;
    bear?: number | null;
    bull?: number | null;
    gapPct?: number | null;
    confidence?: string | null;
    decisionReady?: boolean;
  } | null;
  catalyst?: { score?: number | null; measured?: boolean } | null;
  marketFitScore?: number | null;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const pctMove = (from: number | null, to: number | null) => from != null && to != null && from > 0 ? (to / from - 1) * 100 : null;

function returnPct(candles: Candle[], bars: number) {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0);
  if (clean.length < 2) return null;
  const current = clean.at(-1)!.close;
  const prior = clean[Math.max(0, clean.length - 1 - bars)]?.close ?? null;
  return pctMove(prior, current);
}

function volumeEvidence(candles: Candle[]) {
  const clean = candles.filter(row => Number.isFinite(row.volume) && row.volume >= 0 && Number.isFinite(row.close));
  if (clean.length < 21) return { volumeRatio: null, upDownRatio: null };
  const avg = (rows: Candle[]) => rows.length ? rows.reduce((sum, row) => sum + row.volume, 0) / rows.length : 0;
  const v5 = avg(clean.slice(-5));
  const v20 = avg(clean.slice(-20));
  const recent = clean.slice(-11);
  let up = 0, down = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].close >= recent[i - 1].close) up += recent[i].volume;
    else down += recent[i].volume;
  }
  return {
    volumeRatio: v20 > 0 ? v5 / v20 : null,
    upDownRatio: down > 0 ? up / down : up > 0 ? 2 : null,
  };
}

function lifecycleFromMarket(candles: Candle[], overlay: PortfolioTechnicalOverlay | null, valuationGapPct: number | null): MomentumLifecycleRead {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0);
  const closes = clean.map(row => row.close);
  const current = closes.at(-1) ?? null;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r1 = returnPct(clean, 21);
  const r3 = returnPct(clean, 63);
  const flow = volumeEvidence(clean);
  const dailyScore = overlay?.sentinel.dailyScore ?? 50;
  const weeklyScore = overlay?.sentinel.weeklyScore ?? 50;
  const momentum = clamp(dailyScore * .55 + weeklyScore * .45);
  const institutional = clamp((overlay?.mcdx.smartFlow ?? 50) * .55 + (overlay?.mcdx.contextScore ?? 50) * .45);
  return classifyMomentumLifecycle({
    momentum,
    institutional,
    rs30: null,
    volumeRatio: flow.volumeRatio,
    upDownVolume: flow.upDownRatio,
    return1m: r1,
    return3m: r3,
    aboveEma20: current != null && e20 != null ? current >= e20 : null,
    maFanning: e20 != null && e50 != null ? e20 > e50 : null,
    valuationGapPct,
  });
}

function lifecycleComponent(stage: MomentumLifecycleStage, score: number) {
  const bias: Record<MomentumLifecycleStage, number> = {
    ACCUMULATION: 66,
    EARLY_MARKUP: 82,
    MOMENTUM_EXPANSION: 86,
    MATURE: 62,
    WEAKENING: 34,
    BROKEN: 14,
    UNCONFIRMED: 48,
  };
  return clamp(bias[stage] * .7 + score * .3);
}

function quantComponent(candles: Candle[]) {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0);
  if (clean.length < 30) return 50;
  const closes = clean.map(row => row.close);
  const r = rsi(closes, 14) ?? 50;
  const a = adx(clean, 14) ?? 15;
  const r1 = returnPct(clean, 21) ?? 0;
  const r3 = returnPct(clean, 63) ?? 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const current = closes.at(-1)!;
  let score = 50;
  score += current > (e20 ?? Infinity) ? 8 : -8;
  score += e20 != null && e50 != null && e20 > e50 ? 10 : -6;
  score += clamp((r1 + 4) * 1.2, -8, 12);
  score += clamp((r3 + 6) * .45, -8, 12);
  score += a >= 25 ? 8 : a >= 18 ? 3 : -3;
  score += r >= 52 && r <= 72 ? 7 : r > 78 ? -4 : r < 40 ? -8 : 0;
  return clamp(score);
}

function valuationComponent(input: MomentumForecastOptions["valuation"]) {
  if (!input) return 50;
  const gap = finite(input.gapPct);
  if (gap == null) return 50;
  if (gap >= 20) return 88;
  if (gap >= 15) return 82;
  if (gap >= 10) return 74;
  if (gap >= 8) return 68;
  if (gap >= 5) return 56;
  if (gap >= 0) return 43;
  return 28;
}

function mcdxComponent(overlay: PortfolioTechnicalOverlay | null) {
  if (!overlay) return 50;
  const stateBias = overlay.mcdx.state === "ACCUMULATION" ? 78 : overlay.mcdx.state === "DISTRIBUTION" ? 24 : 50;
  return clamp(stateBias * .4 + overlay.mcdx.smartFlow * .35 + overlay.mcdx.contextScore * .25);
}

function normalizeProbabilities(rawBear: number, rawBase: number, rawBull: number) {
  const total = Math.max(1, rawBear + rawBase + rawBull);
  let bear = Math.round(rawBear / total * 100);
  let bull = Math.round(rawBull / total * 100);
  let base = 100 - bear - bull;
  if (base < 20) {
    const deficit = 20 - base;
    const moveBull = Math.min(Math.ceil(deficit * .6), Math.max(0, bull - 8));
    bull -= moveBull;
    bear -= Math.min(deficit - moveBull, Math.max(0, bear - 8));
    base = 100 - bear - bull;
  }
  return { bear, base, bull };
}

function scenarioProbabilities(score: number, stage: MomentumLifecycleStage, overlay: PortfolioTechnicalOverlay | null, valuationGap: number | null) {
  let bull = 25 + (score - 50) * .55;
  let bear = 22 + (50 - score) * .42;
  let base = 43;
  if (stage === "ACCUMULATION") { bull += 2; base += 5; }
  if (stage === "EARLY_MARKUP") bull += 7;
  if (stage === "MOMENTUM_EXPANSION") bull += 8;
  if (stage === "MATURE") { bull -= 6; base += 7; }
  if (stage === "WEAKENING") { bull -= 8; bear += 10; }
  if (stage === "BROKEN") { bull -= 14; bear += 18; }
  if (overlay?.mcdx.state === "ACCUMULATION") bull += 5;
  if (overlay?.mcdx.state === "DISTRIBUTION") bear += 8;
  if (valuationGap != null && valuationGap <= 5) { bull -= 5; base += 3; }
  return normalizeProbabilities(clamp(bear, 8, 60), clamp(base, 20, 60), clamp(bull, 8, 60));
}

function boundedTarget(price: number, target: number | null, minPct: number, maxPct: number) {
  if (target == null || !Number.isFinite(target) || target <= 0) return null;
  return clamp(target, price * (1 + minPct / 100), price * (1 + maxPct / 100));
}

function blendTarget(price: number, technical: number | null, fundamental: number | null, fundamentalWeight: number, minPct: number, maxPct: number) {
  const t = boundedTarget(price, technical, minPct, maxPct);
  const f = boundedTarget(price, fundamental, minPct, maxPct);
  if (t != null && f != null) return round(t * (1 - fundamentalWeight) + f * fundamentalWeight);
  if (t != null) return round(t);
  if (f != null) return round(f);
  return null;
}

function pathFor(stage: MomentumLifecycleStage, overlay: PortfolioTechnicalOverlay | null): MomentumForecastPath {
  if (stage === "BROKEN") return "BREAKDOWN_RISK";
  if (stage === "WEAKENING") return "WEAKENING_RISK";
  if (stage === "MATURE") return "MATURE_RESET";
  if (stage === "ACCUMULATION") return "ACCUMULATION_BUILD";
  if (overlay?.sentinel.structure === "BULL") return "BREAKOUT_CONTINUATION";
  if (stage === "EARLY_MARKUP" || stage === "MOMENTUM_EXPANSION") return "PULLBACK_CONTINUATION";
  return "RANGE_BUILD";
}

function outlookFor(score: number, stage: MomentumLifecycleStage): MomentumForecastOutlook {
  if (stage === "BROKEN" || score < 34) return "BEARISH";
  if (stage === "WEAKENING" || score < 44) return "DEFENSIVE";
  if (score >= 70 && stage !== "MATURE") return "BULLISH";
  if (score >= 60) return "SELECTIVE_BULLISH";
  return "NEUTRAL";
}

/**
 * Sentinel Momentum Forecast V26.
 * Scenario probabilities are model weights, not calibrated guarantees. Confidence
 * measures evidence coverage/agreement and is deliberately separate from probability.
 */
export function buildMomentumForecast(candles: Candle[], options: MomentumForecastOptions = {}): MomentumForecast | null {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 60) return null;
  const price = clean.at(-1)!.close;
  const volatility = atr(clean, 14);
  const overlay = options.technicalOverlay === undefined ? computePortfolioTechnicalOverlay(clean) : options.technicalOverlay;
  const valuationGap = finite(options.valuation?.gapPct) ?? (options.valuation?.fairValue ? pctMove(price, options.valuation.fairValue) : null);
  const lifecycle = options.lifecycle ?? lifecycleFromMarket(clean, overlay, valuationGap);

  const components = {
    lifecycle: lifecycleComponent(lifecycle.stage, lifecycle.score),
    sentinelX: overlay ? clamp(overlay.sentinel.dailyScore * .55 + overlay.sentinel.weeklyScore * .45) : 50,
    quantMomentum: quantComponent(clean),
    mcdxProxy: mcdxComponent(overlay),
    catalyst: finite(options.catalyst?.score) ?? 50,
    valuationRoom: valuationComponent(options.valuation),
    marketFit: finite(options.marketFitScore) ?? 50,
  };
  const directionalScore = clamp(
    components.lifecycle * .25 +
    components.sentinelX * .25 +
    components.quantMomentum * .20 +
    components.mcdxProxy * .15 +
    components.catalyst * .05 +
    components.valuationRoom * .05 +
    components.marketFit * .05,
  );
  const probabilities = scenarioProbabilities(directionalScore, lifecycle.stage, overlay, valuationGap);

  const techBear = overlay?.support1 ?? (volatility ? price - volatility * 1.8 : price * .94);
  const techBase = overlay?.target1 ?? (volatility ? price + volatility * 1.8 : price * 1.06);
  const techBull = overlay?.target2 ?? (volatility ? (techBase ?? price) + volatility * 1.4 : price * 1.11);
  const valWeight = options.valuation?.decisionReady ? .40 : String(options.valuation?.confidence ?? "").toUpperCase() === "MEDIUM" ? .22 : 0;
  const bearTarget = blendTarget(price, techBear, finite(options.valuation?.bear), valWeight, -22, 3);
  let baseTarget = blendTarget(price, techBase, finite(options.valuation?.fairValue), valWeight, -8, 30);
  let bullTarget = blendTarget(price, techBull, finite(options.valuation?.bull), valWeight, -2, 42);
  if (baseTarget != null && bearTarget != null && baseTarget < bearTarget) baseTarget = bearTarget;
  if (bullTarget != null && baseTarget != null && bullTarget < baseTarget) bullTarget = baseTarget;

  const weighted = bearTarget != null && baseTarget != null && bullTarget != null
    ? round(bearTarget * probabilities.bear / 100 + baseTarget * probabilities.base / 100 + bullTarget * probabilities.bull / 100)
    : baseTarget;

  let coverage = 35;
  if (clean.length >= 220) coverage += 20;
  else if (clean.length >= 120) coverage += 10;
  if (overlay) coverage += 20;
  if (options.lifecycle) coverage += 8;
  if (options.valuation?.decisionReady) coverage += 8;
  else if (options.valuation) coverage += 4;
  if (options.catalyst?.measured) coverage += 5;
  if (finite(options.marketFitScore) != null) coverage += 4;
  coverage = clamp(coverage);

  const componentValues = Object.values(components);
  const spread = Math.max(...componentValues) - Math.min(...componentValues);
  let confidence = clamp(coverage * .72 + (100 - spread) * .28);
  if (!overlay) confidence = Math.min(confidence, 52);
  if (lifecycle.stage === "UNCONFIRMED") confidence = Math.min(confidence, 58);
  const confidenceBand: ForecastConfidenceBand = confidence >= 75 ? "HIGH" : confidence >= 55 ? "MEDIUM" : "LOW";

  const scenario = (name: "BEAR" | "BASE" | "BULL", target: number | null, probability: number, rationale: string): MomentumForecastScenario => ({
    name,
    target,
    returnPct: target == null ? null : round((target / price - 1) * 100, 1),
    probability,
    rationale,
  });
  const path = pathFor(lifecycle.stage, overlay);
  const trigger = lifecycle.stage === "ACCUMULATION"
    ? "Confirm breakout/retest with rising Daily score and non-distribution flow."
    : lifecycle.stage === "MATURE"
      ? "Wait for a constructive reset/pullback with at least 1 ATR room before adding new capital."
      : lifecycle.stage === "WEAKENING" || lifecycle.stage === "BROKEN"
        ? "Require trend repair above the Daily trend stack before upgrading the outlook."
        : overlay?.target1 != null
          ? `Continuation remains constructive while price holds support near ${round(overlay.support1 ?? price)} and has room toward ${round(overlay.target1)}.`
          : "Require Weekly trend and Daily momentum to remain aligned.";
  const invalidation = overlay?.support1 != null
    ? `Momentum path is invalidated on a decisive breakdown below support near ${round(overlay.support1)} with weakening/distribution confirmation.`
    : "Momentum path is invalidated if Weekly trend turns bearish and MCDX proxy confirms distribution.";

  const drivers = [
    `Lifecycle ${lifecycle.stage} · ${lifecycle.score}/100`,
    overlay ? `Sentinel X Daily ${overlay.sentinel.dailyScore}/100 · Weekly ${overlay.sentinel.weeklyScore}/100` : "Sentinel X unavailable",
    overlay ? `MCDX proxy ${overlay.mcdx.state} · context ${overlay.mcdx.contextScore}/100` : "MCDX proxy unavailable",
    valuationGap == null ? "Valuation room not supplied to this forecast" : `Valuation room ${round(valuationGap, 1)}%`,
  ];
  const risks = [
    ...lifecycle.risks,
    ...(overlay?.mcdx.state === "DISTRIBUTION" ? ["Price/volume proxy is in distribution"] : []),
    ...(overlay?.roomAtr != null && overlay.roomAtr < .75 ? ["Less than 0.75 ATR room to Target 1"] : []),
    ...(valuationGap != null && valuationGap <= 5 ? ["Fair-value room is 5% or less"] : []),
  ];

  return {
    version: "26.0",
    horizon: "20–60 TRADING DAYS",
    asOf: clean.at(-1)?.date ?? null,
    outlook: outlookFor(directionalScore, lifecycle.stage),
    confidence: Math.round(confidence),
    confidenceBand,
    lifecycleStage: lifecycle.stage,
    lifecycleScore: lifecycle.score,
    path,
    probabilityWeightedTarget: weighted,
    expectedReturnPct: weighted == null ? null : round((weighted / price - 1) * 100, 1),
    scenarios: {
      bear: scenario("BEAR", bearTarget, probabilities.bear, "Support/volatility downside with weakening or distribution confirmation."),
      base: scenario("BASE", baseTarget, probabilities.base, "Most likely continuation or consolidation path under current momentum evidence."),
      bull: scenario("BULL", bullTarget, probabilities.bull, "Momentum expansion with trend persistence, accumulation and sufficient room-to-run."),
    },
    trigger,
    invalidation,
    drivers,
    risks: [...new Set(risks)],
    components,
    evidenceCoveragePct: Math.round(coverage),
    policy: {
      probabilityIsScenarioWeight: true,
      confidenceIsEvidenceQuality: true,
      mcdxSyntheticProxy: true,
      notPriceGuarantee: true,
      automaticTrading: false,
    },
  };
}
