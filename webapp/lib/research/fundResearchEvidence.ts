import { dailyCandles } from "@/lib/marketData";
import { getSecFundamentals } from "@/lib/sec";
import { assessCatalyst } from "@/lib/team/catalyst";
import { projectEarningsDates } from "@/lib/research";
import { computePortfolioTechnicalOverlay } from "@/lib/portfolioTechnicalOverlay";
import { adx, atr, ema, rsi } from "@/lib/indicators";
import type { Candle } from "@/lib/types";
import type { MomentumLifecycleRead, MomentumLifecycleStage } from "@/lib/research/momentumLifecycle";
import type { LifecycleDiscoveryTier } from "@/lib/research/lifecycleDiscoveryPolicy";

export type ResearchStructureState =
  | "BASE"
  | "BREAKOUT"
  | "RETEST"
  | "TREND"
  | "EXTENDED"
  | "BROKEN"
  | "UNCONFIRMED";

export type FundResearchEvidence = {
  version: "25.0";
  asOf: string;
  structure: {
    state: ResearchStructureState;
    score: number;
    support: number | null;
    resistance: number | null;
    atrRoom: number | null;
    adx14: number | null;
    rsi14: number | null;
    evidence: string[];
    risks: string[];
  };
  quant: {
    score: number;
    momentum: number;
    growth: number;
    quality: number;
    valuation: number;
    accumulation: number;
    composite: number;
    evidence: string[];
  };
  chart: {
    sentinelX: {
      dailyScore: number;
      weeklyScore: number;
      trend: "BULL" | "NEUTRAL" | "BEAR";
      structure: "BULL" | "NEUTRAL" | "BEAR";
      action: "ADD" | "HOLD" | "TRIM" | "EXIT REVIEW";
      confidence: number;
      target1: number | null;
      target2: number | null;
      support1: number | null;
      roomAtr: number | null;
    } | null;
    mcdxProxy: {
      state: "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
      smartMoneyProxy: number;
      smartFlow: number;
      contextScore: number;
      synthetic: true;
      evidenceType: "PRICE_VOLUME_PROXY";
    } | null;
    executionBias: "READY" | "WAIT_PULLBACK" | "WAIT_CONFIRMATION" | "AVOID_CHASE" | "RISK_REVIEW";
  };
  thesis: {
    base: string;
    bull: string;
    bear: string;
    whyNow: string;
    invalidation: string;
    fundRole: string;
  };
  catalyst: {
    score: number | null;
    band: string;
    quality: "MEASURED" | "PARTIAL" | "UNAVAILABLE";
    nextEarningsDate: string | null;
    note: string;
    risks: string[];
  };
  fundFit: {
    score: number;
    decision: "HIGH_PRIORITY" | "RESEARCH" | "WATCH" | "REJECT";
    hardBlocks: string[];
    reasons: string[];
    matureFallbackEligible: boolean;
  };
  governance: {
    discoveryTier: LifecycleDiscoveryTier;
    sentinelXIsExecutionEvidence: true;
    mcdxIsSyntheticProxy: true;
    automaticTrading: false;
    rule: string;
  };
};

type CandidateLike = {
  ticker: string;
  sector?: string;
  price: number | null;
  targetPrice?: number | null;
  expectedReturnPct?: number | null;
  momentum: number;
  growth: number;
  quality: number;
  value: number;
  institutional: number;
  composite: number;
  thesis: string;
  lifecycle: MomentumLifecycleRead;
  metrics?: Record<string, number | null>;
  valuationConfidence?: string;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function recentLevels(candles: Candle[], price: number) {
  const prior = candles.slice(-81, -1);
  if (!prior.length) return { support: null, resistance: null };
  const lows = prior.map(row => row.low).filter(Number.isFinite).sort((a, b) => b - a);
  const highs = prior.map(row => row.high).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    support: lows.find(level => level < price * .997) ?? null,
    resistance: highs.find(level => level > price * 1.003) ?? null,
  };
}

function structureRead(candles: Candle[], lifecycleStage: MomentumLifecycleStage) {
  const closes = candles.map(row => row.close);
  const price = closes.at(-1) ?? 0;
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const adx14 = adx(candles, 14);
  const rsi14 = rsi(closes, 14);
  const prior20 = candles.slice(-21, -1);
  const priorHigh = prior20.length ? Math.max(...prior20.map(row => row.high)) : null;
  const priorLow = prior20.length ? Math.min(...prior20.map(row => row.low)) : null;
  const rangePct = priorHigh != null && priorLow != null && price > 0 ? (priorHigh - priorLow) / price * 100 : null;
  const levels = recentLevels(candles, price);
  const resistance = levels.resistance ?? priorHigh;
  const support = levels.support ?? e50;
  const atrRoom = atr14 && resistance != null ? (resistance - price) / atr14 : null;
  const distanceE20Atr = atr14 && e20 != null ? (price - e20) / atr14 : null;
  const bullStack = e20 != null && e50 != null && e200 != null && e20 > e50 && e50 > e200;
  const broken = e20 != null && e50 != null && price < e20 && e20 < e50;
  const breakout = priorHigh != null && price > priorHigh * 1.002;
  const retest = !breakout && e20 != null && e50 != null && atr14 != null && price > e50 && Math.abs(price - e20) <= atr14 * .8;
  const extended = lifecycleStage === "MATURE" || (distanceE20Atr != null && distanceE20Atr >= 2.5) || (rsi14 ?? 0) >= 78;
  const base = !broken && !breakout && !retest && (rangePct ?? Infinity) <= 10 && price > (e50 ?? 0);

  let state: ResearchStructureState = "UNCONFIRMED";
  if (broken) state = "BROKEN";
  else if (breakout) state = "BREAKOUT";
  else if (retest) state = "RETEST";
  else if (extended) state = "EXTENDED";
  else if (base) state = "BASE";
  else if (bullStack && price > (e20 ?? price + 1)) state = "TREND";

  let score = 40;
  if (bullStack) score += 20;
  if (price > (e20 ?? Infinity)) score += 10;
  if ((adx14 ?? 0) >= 20) score += 10;
  if (["BASE", "BREAKOUT", "RETEST", "TREND"].includes(state)) score += 12;
  if (atrRoom != null && atrRoom >= 1) score += 8;
  if (state === "EXTENDED") score -= 18;
  if (state === "BROKEN") score -= 35;

  const evidence = [
    `Structure ${state}`,
    e20 == null || e50 == null ? "EMA structure unavailable" : `EMA20 ${e20.toFixed(2)} / EMA50 ${e50.toFixed(2)}`,
    e200 == null ? "EMA200 unavailable" : `EMA200 ${e200.toFixed(2)}`,
    adx14 == null ? "ADX unavailable" : `ADX14 ${adx14.toFixed(1)}`,
    rsi14 == null ? "RSI unavailable" : `RSI14 ${rsi14.toFixed(1)}`,
    atrRoom == null ? "Resistance room unavailable" : `Room to resistance ${atrRoom.toFixed(2)} ATR`,
  ];
  const risks = [
    ...(state === "EXTENDED" ? ["Price structure is extended; do not chase new capital without enough valuation and ATR room"] : []),
    ...(state === "BROKEN" ? ["Daily structure is broken below the trend stack"] : []),
    ...(atrRoom != null && atrRoom < .75 ? ["Less than 0.75 ATR room to resistance"] : []),
  ];

  return {
    state,
    score: clamp(score),
    support: support == null ? null : round2(support),
    resistance: resistance == null ? null : round2(resistance),
    atrRoom: atrRoom == null ? null : round2(atrRoom),
    adx14: adx14 == null ? null : round2(adx14),
    rsi14: rsi14 == null ? null : round2(rsi14),
    evidence,
    risks,
  };
}

function fundRole(stage: MomentumLifecycleStage) {
  if (stage === "ACCUMULATION") return "Pre-markup research candidate; scale only after structure and valuation confirm.";
  if (stage === "EARLY_MARKUP") return "Preferred new-capital candidate when thesis, valuation and execution evidence agree.";
  if (stage === "MOMENTUM_EXPANSION") return "Leader participation candidate; require room-to-run and avoid late chasing.";
  if (stage === "MATURE") return "Fallback/watch candidate only; prefer a reset or pullback before new capital.";
  return "Not a new-capital candidate on the current lifecycle evidence.";
}

function qualityScore(value: string | undefined) {
  const v = String(value ?? "").toUpperCase();
  return v === "HIGH" ? 85 : v === "MEDIUM" ? 68 : v === "LOW" ? 48 : 55;
}

export async function buildFundResearchEvidence(
  candidate: CandidateLike,
  options: { discoveryTier: LifecycleDiscoveryTier; marketFitScore?: number } = { discoveryTier: "NOT_ELIGIBLE" },
): Promise<FundResearchEvidence> {
  const candles = await dailyCandles(candidate.ticker, 460).catch(() => [] as Candle[]);
  const structure = candles.length >= 80
    ? structureRead(candles, candidate.lifecycle.stage)
    : { state: "UNCONFIRMED" as const, score: 35, support: null, resistance: null, atrRoom: null, adx14: null, rsi14: null, evidence: ["Insufficient chart history"], risks: ["Structure cannot be verified"] };
  const overlay = computePortfolioTechnicalOverlay(candles);

  let catalystScore: number | null = null;
  let catalystBand = "UNAVAILABLE";
  let catalystQuality: "MEASURED" | "PARTIAL" | "UNAVAILABLE" = "UNAVAILABLE";
  let nextEarningsDate: string | null = null;
  let catalystNote = "No measured SEC/price catalyst read was available this cycle.";
  const catalystRisks: string[] = [];
  try {
    const sec = await getSecFundamentals(candidate.ticker);
    const quarters = sec?.quarters ?? [];
    const projected = projectEarningsDates(quarters.map((row: any) => String(row?.end ?? row?.date ?? "")).filter(Boolean));
    nextEarningsDate = projected.dates[0] ?? null;
    const read = assessCatalyst({
      earnings: (sec as any)?.earnings ?? [],
      quarters,
      candles,
      benchmark: [],
      nextEarningsDate,
    });
    catalystScore = read.score;
    catalystBand = read.band;
    catalystQuality = read.score == null ? "PARTIAL" : "MEASURED";
    catalystNote = read.score == null
      ? `Catalyst evidence partial${nextEarningsDate ? ` · projected earnings ${nextEarningsDate}` : ""}.`
      : `${read.band} catalyst ${read.score}/100${read.pead?.driftPct == null ? "" : ` · PEAD ${read.pead.driftPct.toFixed(1)}%`}${nextEarningsDate ? ` · projected earnings ${nextEarningsDate}` : ""}.`;
    if (nextEarningsDate) catalystRisks.push(`Earnings event risk around ${nextEarningsDate}; re-underwrite after the release.`);
  } catch {
    // Explicitly degrade confidence; never manufacture a catalyst score.
  }

  const valuationGap = finite(candidate.expectedReturnPct) ?? (candidate.price && candidate.targetPrice ? (candidate.targetPrice / candidate.price - 1) * 100 : null);
  const quantScore = clamp(
    candidate.quality * .22 +
    candidate.growth * .18 +
    candidate.momentum * .20 +
    candidate.value * .12 +
    candidate.institutional * .12 +
    candidate.composite * .10 +
    qualityScore(candidate.valuationConfidence) * .06
  );

  const sentinelScore = overlay ? Math.round((overlay.sentinel.dailyScore + overlay.sentinel.weeklyScore + overlay.confidence) / 3) : 45;
  const mcdxScore = overlay?.mcdx.contextScore ?? 45;
  const valuationScore = clamp(45 + Math.max(-20, Math.min(35, valuationGap ?? 0)) * 1.5);
  const marketFit = clamp(options.marketFitScore ?? 50);
  const lifecycleScore = candidate.lifecycle.score;
  const fundFitScore = clamp(
    lifecycleScore * .20 +
    quantScore * .20 +
    structure.score * .15 +
    sentinelScore * .15 +
    mcdxScore * .10 +
    valuationScore * .10 +
    marketFit * .10
  );

  const hardBlocks = [
    ...(["WEAKENING", "BROKEN"].includes(candidate.lifecycle.stage) ? [`Lifecycle ${candidate.lifecycle.stage} blocks new capital`] : []),
    ...(valuationGap == null || valuationGap < 8 ? ["Defensible valuation room is below the 8% fund hurdle or unavailable"] : []),
    ...(structure.state === "BROKEN" ? ["Chart structure is broken"] : []),
    ...(overlay?.sentinel.trend === "BEAR" && overlay?.mcdx.state === "DISTRIBUTION" ? ["Sentinel X bear trend and MCDX proxy distribution agree"] : []),
  ];

  const matureFallbackEligible = candidate.lifecycle.stage === "MATURE"
    && hardBlocks.length === 0
    && !candidate.lifecycle.nearFairValue
    && (valuationGap ?? -Infinity) >= 12
    && overlay?.sentinel.trend === "BULL"
    && overlay.mcdx.state !== "DISTRIBUTION"
    && (overlay.roomAtr ?? structure.atrRoom ?? 0) >= 1
    && fundFitScore >= 68
    && (structure.state !== "EXTENDED" || ((valuationGap ?? 0) >= 15 && (overlay.roomAtr ?? structure.atrRoom ?? 0) >= 1.5));

  const decision: FundResearchEvidence["fundFit"]["decision"] = hardBlocks.length
    ? "REJECT"
    : fundFitScore >= 76 ? "HIGH_PRIORITY"
    : fundFitScore >= 64 ? "RESEARCH"
    : "WATCH";

  const executionBias: FundResearchEvidence["chart"]["executionBias"] = hardBlocks.length
    ? "RISK_REVIEW"
    : candidate.lifecycle.stage === "MATURE" || structure.state === "EXTENDED"
      ? "AVOID_CHASE"
      : overlay?.action === "ADD" && ["BASE", "BREAKOUT", "RETEST", "TREND"].includes(structure.state)
        ? "READY"
        : overlay?.sentinel.trend === "BULL"
          ? "WAIT_CONFIRMATION"
          : "WAIT_PULLBACK";

  const bull = candidate.targetPrice != null
    ? `Bull case requires execution above the current trend structure with Fair Value room toward $${candidate.targetPrice.toFixed(2)}.`
    : "Bull case requires measurable earnings/FCF upside and a governed Fair Value target.";
  const bear = structure.support != null
    ? `Bear/invalidation case begins if price loses structural support near $${structure.support.toFixed(2)} together with thesis deterioration.`
    : "Bear/invalidation case requires a break in both operating thesis and price structure; chart-only weakness is not a fundamental exit by itself.";

  return {
    version: "25.0",
    asOf: new Date().toISOString(),
    structure,
    quant: {
      score: quantScore,
      momentum: candidate.momentum,
      growth: candidate.growth,
      quality: candidate.quality,
      valuation: candidate.value,
      accumulation: candidate.institutional,
      composite: candidate.composite,
      evidence: [
        `Momentum ${candidate.momentum}/100`,
        `Growth ${candidate.growth}/100`,
        `Quality ${candidate.quality}/100`,
        `Valuation factor ${candidate.value}/100`,
        `Accumulation proxy ${candidate.institutional}/100`,
        valuationGap == null ? "Valuation gap unavailable" : `Fair Value room ${valuationGap.toFixed(1)}%`,
      ],
    },
    chart: {
      sentinelX: overlay ? {
        dailyScore: overlay.sentinel.dailyScore,
        weeklyScore: overlay.sentinel.weeklyScore,
        trend: overlay.sentinel.trend,
        structure: overlay.sentinel.structure,
        action: overlay.action,
        confidence: overlay.confidence,
        target1: overlay.target1,
        target2: overlay.target2,
        support1: overlay.support1,
        roomAtr: overlay.roomAtr,
      } : null,
      mcdxProxy: overlay ? {
        state: overlay.mcdx.state,
        smartMoneyProxy: overlay.mcdx.smartMoneyProxy,
        smartFlow: overlay.mcdx.smartFlow,
        contextScore: overlay.mcdx.contextScore,
        synthetic: true,
        evidenceType: "PRICE_VOLUME_PROXY",
      } : null,
      executionBias,
    },
    thesis: {
      base: candidate.thesis || "Base thesis is under re-underwrite.",
      bull,
      bear,
      whyNow: `${candidate.lifecycle.stage}: ${candidate.lifecycle.reason} Structure ${structure.state}; fund-fit ${fundFitScore}/100.`,
      invalidation: bear,
      fundRole: fundRole(candidate.lifecycle.stage),
    },
    catalyst: {
      score: catalystScore,
      band: catalystBand,
      quality: catalystQuality,
      nextEarningsDate,
      note: catalystNote,
      risks: catalystRisks,
    },
    fundFit: {
      score: fundFitScore,
      decision,
      hardBlocks,
      reasons: [
        `Lifecycle ${candidate.lifecycle.stage} ${candidate.lifecycle.score}/100`,
        `Quant underwriting ${quantScore}/100`,
        `Structure ${structure.state} ${structure.score}/100`,
        `Sentinel X ${overlay ? `${sentinelScore}/100 · ${overlay.sentinel.trend}` : "unavailable"}`,
        `MCDX proxy ${overlay ? `${overlay.mcdx.contextScore}/100 · ${overlay.mcdx.state}` : "unavailable"}`,
        `Market/sector fit ${marketFit}/100`,
      ],
      matureFallbackEligible,
    },
    governance: {
      discoveryTier: options.discoveryTier,
      sentinelXIsExecutionEvidence: true,
      mcdxIsSyntheticProxy: true,
      automaticTrading: false,
      rule: "Sentinel X and MCDX Proxy are evidence layers only. New capital still requires lifecycle policy, thesis, governed valuation, funding, risk and CIO approval.",
    },
  };
}
