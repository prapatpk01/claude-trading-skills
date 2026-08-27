import type { Candle } from "../types";
import {
  adx,
  atrPercent,
  avgVolume,
  bollinger,
  dollarVolume,
  ema,
  macd,
  mfi,
  obv,
  pctReturn,
  rsi,
  sma,
} from "../indicators";

export const SENTINEL_INVESTMENT_V36 = "36.0" as const;

export type MomentumStateV36 = "RISING" | "MIXED" | "FALLING";
export type SentinelActionV36 = "BUY" | "STARTER BUY" | "WATCH · NEAR READY" | "WATCH · MOMENTUM BUILDING" | "NO ENTRY" | "BLOCKED";

export type ScorePillarV36 = {
  key: "trend" | "acceleration" | "relativeStrength" | "flow" | "entry" | "quality" | "freshness";
  label: string;
  points: number;
  max: number;
  detail: string;
};

export type BlockV36 = { code: string; reason: string };

export type MarketScoreV36 = {
  score: number;
  state: "RISK ON" | "SELECTIVE RISK ON" | "NEUTRAL" | "DEFENSIVE" | "CRISIS";
  regimeScore: number;
  tapeScore: number;
  sentimentScore: number | null;
  sentimentAdjusted: number | null;
  risingPermission: "FULL" | "STARTER" | "SELECTIVE" | "BLOCK";
  note: string;
};

export type OwnershipInputV36 = {
  researchConviction?: number | null;
  upsidePct?: number | null;
  evidencePct?: number | null;
  growthScore?: number | null;
  earningsScore?: number | null;
  qualityScore?: number | null;
  valuationScore?: number | null;
  catalystScore?: number | null;
};

export type OwnershipScoreV36 = {
  score: number;
  coveragePct: number;
  components: Array<{ label: string; score: number; weight: number }>;
  note: string;
};

export type NewIdeaScoreV36 = {
  version: typeof SENTINEL_INVESTMENT_V36;
  /** Compatibility field consumed by the legacy committee. In V36 this is the final Sentinel Conviction score, not the old Holdings technical score. */
  total: number;
  convictionScore: number;
  momentumScore: number;
  marketScore: number;
  ownershipScore: number;
  entryScore: number;
  signal: SentinelActionV36;
  action: SentinelActionV36;
  momentumState: MomentumStateV36;
  rising: boolean;
  pillars: ScorePillarV36[];
  hardBlocks: string[];
  hardBlockCodes: string[];
  softBlocks: string[];
  dataQualityPct: number;
  sizingMultiplier: number;
  /** Maps the V36 action onto the old sizing bands without weakening underwriting. */
  sizingConviction: number;
  market: MarketScoreV36;
  ownership: OwnershipScoreV36;
  note: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function scoreBand(value: number, bands: Array<[number, number]>): number {
  for (let i = 0; i < bands.length; i += 1) if (value >= bands[i][0]) return bands[i][1];
  return 0;
}

function sentimentMomentumScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  // Momentum likes constructive risk appetite, but extreme greed is crowded and
  // therefore earns less than a healthy 60–75 reading.
  if (value < 15) return 35;
  if (value < 25) return 45;
  if (value < 45) return 55;
  if (value <= 55) return 65;
  if (value <= 75) return 85;
  if (value <= 90) return 75;
  return 60;
}

export function buildSentinelMarketScoreV36(input: {
  regime?: any | null;
  sentiment?: { value?: number | null; coveragePct?: number | null; band?: string | null } | null;
}): MarketScoreV36 {
  const regimeScore = clamp(finite(input.regime?.score) ?? 50);
  const tapeScore = clamp(finite(input.regime?.tapeScore) ?? regimeScore);
  const sentimentScore = finite(input.sentiment?.value);
  const sentimentAdjusted = sentimentMomentumScore(sentimentScore);

  const raw = sentimentAdjusted == null
    ? regimeScore * 0.7 + tapeScore * 0.3
    : regimeScore * 0.55 + tapeScore * 0.25 + sentimentAdjusted * 0.20;
  const score = Math.round(clamp(raw));
  const regimeName = String(input.regime?.regime ?? "").toUpperCase();
  const state: MarketScoreV36["state"] = regimeName === "CRISIS" || score < 20
    ? "CRISIS"
    : regimeName === "RISK-OFF" || score < 40
      ? "DEFENSIVE"
      : score < 55
        ? "NEUTRAL"
        : score < 70
          ? "SELECTIVE RISK ON"
          : "RISK ON";
  const risingPermission: MarketScoreV36["risingPermission"] = state === "CRISIS"
    ? "BLOCK"
    : state === "DEFENSIVE"
      ? "SELECTIVE"
      : state === "NEUTRAL"
        ? "STARTER"
        : "FULL";
  return {
    score,
    state,
    regimeScore: Math.round(regimeScore),
    tapeScore: Math.round(tapeScore),
    sentimentScore,
    sentimentAdjusted,
    risingPermission,
    note: `Market ${score}/100 · regime ${Math.round(regimeScore)} · tape ${Math.round(tapeScore)}${sentimentScore == null ? " · sentiment unavailable" : ` · sentiment ${Math.round(sentimentScore)} (${Math.round(sentimentAdjusted ?? 50)} momentum-adjusted)`}. ${state} permits ${risingPermission.toLowerCase()} new-risk sizing.`,
  };
}

export function scoreOwnershipV36(input: OwnershipInputV36): OwnershipScoreV36 {
  const components: Array<{ label: string; score: number; weight: number }> = [];
  const add = (label: string, score: number | null | undefined, weight: number) => {
    if (score == null || !Number.isFinite(score)) return;
    components.push({ label, score: clamp(score), weight });
  };

  add("Research conviction", input.researchConviction, 30);
  add("Growth", input.growthScore, 15);
  add("Earnings revisions", input.earningsScore, 10);
  add("Quality", input.qualityScore, 15);
  add("Valuation", input.valuationScore, 10);
  if (input.upsidePct != null && Number.isFinite(input.upsidePct)) {
    // 0% upside = 35, 8% = 60, 12% = 75, 20%+ = 100.
    add("Valuation room", clamp(35 + input.upsidePct * 3.25), 10);
  }
  add("Catalyst", input.catalystScore, 5);
  add("Evidence coverage", input.evidencePct, 15);

  if (!components.length) return { score: 50, coveragePct: 0, components: [], note: "Ownership inputs unavailable; neutral 50 is shown but does not satisfy evidence gates." };
  const weight = components.reduce((sum, row) => sum + row.weight, 0);
  const score = Math.round(components.reduce((sum, row) => sum + row.score * row.weight, 0) / weight);
  const coveragePct = Math.round(clamp((weight / 100) * 100));
  return {
    score,
    coveragePct,
    components,
    note: `Ownership ${score}/100 from ${components.map(row => row.label).join(", ")}. Missing ownership inputs are excluded from the weighted average and remain visible through ${coveragePct}% model coverage.`,
  };
}

function momentumPillars(candles: Candle[], benchmark: Candle[]) {
  const pillars: ScorePillarV36[] = [];
  const hard: BlockV36[] = [];
  const soft: BlockV36[] = [];
  const closes = candles.map(row => row.close).filter(value => Number.isFinite(value) && value > 0);
  const price = closes.at(-1) ?? 0;
  const ema20 = ema(closes, 20);
  const ema20Prev5 = ema(closes.slice(0, -5), 20);
  const ema50 = ema(closes, 50);
  const sma200 = sma(closes, 200);

  if (candles.length < 80 || benchmark.length < 60) {
    hard.push({ code: "DATA_INCOMPLETE", reason: `New-idea momentum needs at least 80 stock bars and 60 benchmark bars; received ${candles.length}/${benchmark.length}.` });
  }

  // 1) Trend Quality — 20. Trend direction matters; high beta does not.
  let trend = 0;
  if (ema20 != null && price > ema20) trend += 4;
  if (ema20 != null && ema50 != null && ema20 > ema50) trend += 4;
  if (ema50 != null && sma200 != null && ema50 > sma200) trend += 4;
  if (ema20 != null && ema20Prev5 != null && ema20 > ema20Prev5) trend += 4;
  if (sma200 != null && price > sma200) trend += 4;
  pillars.push({ key: "trend", label: "Trend Quality", points: trend, max: 20, detail: `Price ${ema20 != null && price > ema20 ? ">" : "≤"} EMA20 · EMA20 ${ema50 != null && ema20 != null && ema20 > ema50 ? ">" : "≤"} EMA50 · ${sma200 != null && price > sma200 ? "above" : "below/unavailable"} SMA200 · EMA20 slope ${ema20 != null && ema20Prev5 != null && ema20 > ema20Prev5 ? "rising" : "flat/falling"}.` });
  if (sma200 != null && ema20 != null && ema50 != null && price < sma200 && ema20 < ema50) {
    hard.push({ code: "STRUCTURE_BREAKDOWN", reason: "Price is below SMA200 while EMA20 is below EMA50 — new-risk trend structure is broken." });
  } else if (ema20 != null && price < ema20) {
    soft.push({ code: "BELOW_EMA20", reason: "Price is below EMA20; wait for reclaim or a confirmed support response." });
  }

  // 2) Momentum Acceleration — 25. Level + slope; low ADX is never a hard veto.
  const rNow = rsi(closes, 14);
  const rPrev5 = rsi(closes.slice(0, -5), 14);
  const mNow = macd(closes);
  const mPrev3 = macd(closes.slice(0, -3));
  const aNow = adx(candles, 14);
  const aPrev5 = adx(candles.slice(0, -5), 14);
  let accel = 0;
  if (rNow != null) accel += rNow >= 55 && rNow <= 78 ? 6 : rNow >= 48 ? 4 : rNow >= 42 ? 2 : 0;
  if (rNow != null && rPrev5 != null) accel += rNow > rPrev5 + 2 ? 4 : rNow > rPrev5 ? 2 : 0;
  if (mNow) accel += mNow.hist > 0 ? 4 : mNow.hist > (mPrev3?.hist ?? 0) ? 2 : 0;
  if (mNow && mPrev3) accel += mNow.hist > mPrev3.hist ? 5 : 0;
  if (aNow != null) accel += aNow >= 25 ? 3 : aNow >= 18 ? 2 : 1;
  if (aNow != null && aPrev5 != null) accel += aNow > aPrev5 + 1 ? 3 : aNow > aPrev5 ? 2 : 0;
  accel = Math.min(25, accel);
  const rsiRising = rNow != null && rPrev5 != null && rNow > rPrev5;
  const macdRising = Boolean(mNow && mPrev3 && mNow.hist > mPrev3.hist);
  const adxRising = aNow != null && aPrev5 != null && aNow > aPrev5;
  pillars.push({ key: "acceleration", label: "Momentum Acceleration", points: accel, max: 25, detail: `RSI ${rNow?.toFixed(1) ?? "—"} (${rsiRising ? "rising" : "not rising"}) · MACD hist ${mNow?.hist.toFixed(2) ?? "—"} (${macdRising ? "expanding" : "not expanding"}) · ADX ${aNow?.toFixed(1) ?? "—"} (${adxRising ? "rising" : "not rising"}).` });
  if (aNow != null && aNow < 20 && !adxRising) soft.push({ code: "ADX_DEVELOPING", reason: `ADX ${aNow.toFixed(1)} is below 20 and not yet rising; this is a soft timing block, not a thesis veto.` });
  if (rNow != null && rNow < 45 && !rsiRising) soft.push({ code: "RSI_WEAK", reason: `RSI ${rNow.toFixed(1)} is below 45 and not recovering.` });

  // 3) Relative Strength — 20. 1M + 3M + acceleration versus SPY.
  const stock1m = pctReturn(candles, 21);
  const stock3m = pctReturn(candles, 63);
  const spy1m = pctReturn(benchmark, 21);
  const spy3m = pctReturn(benchmark, 63);
  const rs1m = stock1m != null && spy1m != null ? stock1m - spy1m : null;
  const rs3m = stock3m != null && spy3m != null ? stock3m - spy3m : null;
  const rsAccel = rs1m != null && rs3m != null ? rs1m - rs3m / 3 : null;
  let rsPoints = 0;
  if (rs1m != null) rsPoints += scoreBand(rs1m, [[8, 7], [4, 6], [1, 5], [0, 3], [-3, 1]]);
  if (rs3m != null) rsPoints += scoreBand(rs3m, [[15, 7], [8, 6], [3, 5], [0, 3], [-5, 1]]);
  if (rsAccel != null) rsPoints += scoreBand(rsAccel, [[5, 6], [2, 5], [0, 3], [-2, 1]]);
  rsPoints = Math.min(20, rsPoints);
  const rsRising = rsAccel != null && rsAccel > 0;
  pillars.push({ key: "relativeStrength", label: "Relative Strength", points: rsPoints, max: 20, detail: `RS vs SPY: 1M ${rs1m == null ? "—" : `${rs1m >= 0 ? "+" : ""}${rs1m.toFixed(1)}%`} · 3M ${rs3m == null ? "—" : `${rs3m >= 0 ? "+" : ""}${rs3m.toFixed(1)}%`} · acceleration ${rsAccel == null ? "—" : `${rsAccel >= 0 ? "+" : ""}${rsAccel.toFixed(1)}`}.` });
  if (rs1m != null && rs3m != null && rs1m < 0 && rs3m < 0) soft.push({ code: "RS_LAGGING", reason: "Relative strength trails SPY over both 1M and 3M windows." });

  // 4) Volume / Smart Flow — 15.
  const obvRead = obv(candles);
  const mfiRead = mfi(candles, 14);
  const v5 = avgVolume(candles, 5);
  const v20 = avgVolume(candles, 20);
  const volumeRatio = v5 != null && v20 != null && v20 > 0 ? v5 / v20 : null;
  const priceRising20 = closes.length > 21 && price > closes.at(-21)!;
  let flow = 0;
  if (obvRead?.rising && (mfiRead ?? 0) >= 50) flow += 8;
  else if (obvRead?.rising) flow += 5;
  else if ((mfiRead ?? 0) >= 50) flow += 3;
  if (volumeRatio != null) flow += volumeRatio >= 1.5 ? 5 : volumeRatio >= 1.05 ? 4 : volumeRatio >= 0.9 ? 2 : 0;
  if (priceRising20 && obvRead?.rising) flow += 2;
  flow = Math.min(15, flow);
  pillars.push({ key: "flow", label: "Volume / Smart Flow", points: flow, max: 15, detail: `OBV ${obvRead?.rising ? "rising" : "flat/falling"}${obvRead ? ` ${obvRead.slopePct.toFixed(1)}%` : ""} · MFI ${mfiRead?.toFixed(1) ?? "—"} · 5D/20D volume ${volumeRatio?.toFixed(2) ?? "—"}×.` });
  if (priceRising20 && obvRead && !obvRead.rising && obvRead.slopePct < -3 && (mfiRead ?? 50) < 45) {
    hard.push({ code: "PERSISTENT_DISTRIBUTION", reason: "Price is advancing while OBV is falling materially and MFI is below 45 — persistent distribution blocks new risk." });
  } else if (!obvRead?.rising || (volumeRatio != null && volumeRatio < 0.9)) {
    soft.push({ code: "FLOW_UNCONFIRMED", reason: "Volume/flow has not confirmed the price move yet." });
  }

  // 5) Entry Quality — 10. Prefer fresh/reclaim entries; do not reward a squeeze unless it breaks upward.
  const atrPct = atrPercent(candles, 14);
  const emaDistancePct = ema20 != null && ema20 > 0 ? ((price - ema20) / ema20) * 100 : null;
  const bb = bollinger(candles, 20, 2);
  const previous20High = candles.length > 21 ? Math.max(...candles.slice(-21, -1).map(row => row.high)) : null;
  const bullishBreakout = previous20High != null && price > previous20High;
  let entry = 0;
  if (emaDistancePct != null) {
    const atrUnit = Math.max(1, atrPct ?? 2);
    if (emaDistancePct >= -0.5 * atrUnit && emaDistancePct <= 1.2 * atrUnit) entry += 4;
    else if (emaDistancePct <= 2 * atrUnit && emaDistancePct >= -1.2 * atrUnit) entry += 2;
  }
  if (ema20 != null && ema50 != null && price > ema20 && ema20 > ema50) entry += 3;
  if (bb?.squeeze && bullishBreakout) entry += 3;
  else if (bullishBreakout) entry += 2;
  else if (!bb?.squeeze) entry += 1;
  entry = Math.min(10, entry);
  pillars.push({ key: "entry", label: "Entry Quality", points: entry, max: 10, detail: `Distance to EMA20 ${emaDistancePct == null ? "—" : `${emaDistancePct >= 0 ? "+" : ""}${emaDistancePct.toFixed(1)}%`} · ATR ${atrPct?.toFixed(1) ?? "—"}% · ${bb?.squeeze ? "squeeze" : "normal band"}${bullishBreakout ? " + upside breakout" : ""}.` });
  if (emaDistancePct != null && atrPct != null && emaDistancePct > Math.max(6, atrPct * 2.2)) soft.push({ code: "ENTRY_EXTENDED", reason: `Price is ${emaDistancePct.toFixed(1)}% above EMA20, more than roughly 2.2 ATR units; wait for pullback/reclaim rather than chase.` });

  // 6) Volatility / Liquidity Quality — 5. Volatility is a control, not an alpha bonus.
  const dv = dollarVolume(candles, 20);
  let quality = 0;
  if (dv != null) quality += dv >= 50e6 ? 3 : dv >= 10e6 ? 2 : 0;
  if (atrPct != null) quality += atrPct >= 1.2 && atrPct <= 5 ? 2 : atrPct <= 7 ? 1 : 0;
  quality = Math.min(5, quality);
  pillars.push({ key: "quality", label: "Volatility / Liquidity Quality", points: quality, max: 5, detail: `Dollar volume ${dv == null ? "—" : `$${(dv / 1e6).toFixed(0)}M/day`} · ATR ${atrPct?.toFixed(1) ?? "—"}%. High beta itself earns no points.` });
  if (dv != null && dv < 10e6) hard.push({ code: "ILLIQUID", reason: `20-day dollar volume $${(dv / 1e6).toFixed(1)}M/day is below the $10M new-risk floor.` });

  // 7) Momentum Persistence / Freshness — 5.
  const weeklyWindows = [5, 10, 15, 20].map(days => closes.length > days ? ((price / closes.at(-(days + 1))!) - 1) * 100 : null).filter((v): v is number => v != null);
  const positiveWindows = weeklyWindows.filter(value => value > 0).length;
  let freshness = positiveWindows >= 3 ? 2 : positiveWindows >= 2 ? 1 : 0;
  const risingSignals = [rsiRising, macdRising, adxRising, rsRising].filter(Boolean).length;
  freshness += risingSignals >= 3 ? 3 : risingSignals >= 2 ? 2 : risingSignals >= 1 ? 1 : 0;
  freshness = Math.min(5, freshness);
  pillars.push({ key: "freshness", label: "Momentum Persistence / Freshness", points: freshness, max: 5, detail: `${positiveWindows}/${weeklyWindows.length || 4} recent windows positive · ${risingSignals}/4 acceleration signals rising.` });

  const momentumScore = Math.round(clamp(pillars.reduce((sum, row) => sum + row.points, 0)));
  const momentumState: MomentumStateV36 = risingSignals >= 3 ? "RISING" : risingSignals <= 1 ? "FALLING" : "MIXED";
  const measured = [rNow, rPrev5, mNow?.hist ?? null, aNow, aPrev5, rs1m, rs3m, obvRead?.slopePct ?? null, mfiRead, volumeRatio, ema20, ema50, sma200, atrPct, dv].filter(value => value != null).length;
  const dataQualityPct = Math.round((measured / 15) * 100);
  if (dataQualityPct < 60 && !hard.some(row => row.code === "DATA_INCOMPLETE")) hard.push({ code: "DATA_INCOMPLETE", reason: `Only ${dataQualityPct}% of the V36 momentum inputs are measurable.` });

  return { pillars, hard, soft, momentumScore, momentumState, rising: momentumState === "RISING", entryScore: entry, dataQualityPct };
}

export function scoreNewIdeaV36(input: {
  candles: Candle[];
  benchmark: Candle[];
  market: MarketScoreV36;
  ownership?: OwnershipInputV36;
}): NewIdeaScoreV36 {
  const momentum = momentumPillars(input.candles, input.benchmark);
  const ownership = scoreOwnershipV36(input.ownership ?? {});
  // Entry Quality is a 0–10 pillar. Its full value is already the 10-point
  // contribution to a /100 score; multiplying it by 0.10 again accidentally
  // made Entry worth only 1% and depressed every candidate by up to 9 points.
  const convictionScore = Math.round(clamp(
    input.market.score * 0.25 +
    momentum.momentumScore * 0.45 +
    ownership.score * 0.20 +
    momentum.entryScore,
  ));

  const hard = [...momentum.hard];
  if (input.market.state === "CRISIS") hard.push({ code: "CRISIS_REGIME", reason: "Authoritative market regime is CRISIS; Sentinel does not open new risk." });

  let action: SentinelActionV36;
  if (hard.length) action = "BLOCKED";
  else if (convictionScore >= 75 && momentum.momentumScore >= 65) action = "BUY";
  else if (convictionScore >= 65 && momentum.rising && momentum.momentumScore >= 58 && input.market.risingPermission !== "SELECTIVE") action = "STARTER BUY";
  else if (convictionScore >= 55) action = "WATCH · NEAR READY";
  else if (convictionScore >= 45) action = "WATCH · MOMENTUM BUILDING";
  else action = "NO ENTRY";

  // In a defensive market, a full BUY is deliberately downgraded unless it is
  // an exceptional relative-strength setup. This changes size, not the thesis.
  if (!hard.length && input.market.risingPermission === "SELECTIVE" && action === "BUY") {
    action = momentum.momentumScore >= 80 && momentum.rising ? "STARTER BUY" : "WATCH · NEAR READY";
  }

  const sizingMultiplier = action === "BUY" ? 1 : action === "STARTER BUY" ? 0.5 : 0;
  // committeeLegacy uses 80/65/50 bands to size motions. Feed it a sizing-only
  // conviction while keeping the real underwriting scores in this object.
  const sizingConviction = action === "BUY" ? Math.max(75, convictionScore) : action === "STARTER BUY" ? 50 : Math.min(49, convictionScore);
  const hardBlocks = hard.map(row => `${row.code}: ${row.reason}`);
  const softBlocks = momentum.soft.map(row => `${row.code}: ${row.reason}`);

  return {
    version: SENTINEL_INVESTMENT_V36,
    total: convictionScore,
    convictionScore,
    momentumScore: momentum.momentumScore,
    marketScore: input.market.score,
    ownershipScore: ownership.score,
    entryScore: momentum.entryScore,
    signal: action,
    action,
    momentumState: momentum.momentumState,
    rising: momentum.rising,
    pillars: momentum.pillars,
    hardBlocks,
    hardBlockCodes: hard.map(row => row.code),
    softBlocks,
    dataQualityPct: momentum.dataQualityPct,
    sizingMultiplier,
    sizingConviction,
    market: input.market,
    ownership,
    note: `Sentinel Conviction ${convictionScore}/100 = 25% Market ${input.market.score} + 45% Momentum ${momentum.momentumScore} + 20% Ownership ${ownership.score} + 10% Entry ${momentum.entryScore}. Momentum is ${momentum.momentumState}. ${action}.`,
  };
}
