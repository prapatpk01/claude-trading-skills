import type { Candle } from "../types";

export type McdxFlowStateV40 =
  | "STRONG_ACCUMULATION"
  | "ACCUMULATION"
  | "EARLY_ACCUMULATION"
  | "NEUTRAL"
  | "EARLY_DISTRIBUTION"
  | "DISTRIBUTION"
  | "STRONG_DISTRIBUTION";

export type McdxLegacyState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type McdxFlowSignalV40 = "BUY_PRESSURE" | "SELL_PRESSURE" | "MIXED";
export type McdxSponsorStateV40 = "BULL_SPONSORED" | "BEAR_SPONSORED" | "NONE";
export type McdxHtfDirectionV40 = "BULL" | "BEAR" | "NEUTRAL" | "UNAVAILABLE";

export interface McdxV40Options {
  /** Real higher-timeframe flow computed by the caller. Never synthesized. */
  htfFlowPower?: number | null;
  confirmGate?: number;
  vetoGate?: number;
  /** Pine exposes 34/50/100/Manual. Fund weekly horizon uses 34 when history is shorter. */
  mcdxLength?: number;
  /** Pine default is 80; caller may use a shorter valid window on weekly aggregation. */
  vfiLength?: number;
}

export interface McdxV40Output {
  version: "4.0";
  engine: "MCDX Sentinel v4.0 · Institutional Flow Companion";
  methodology: "HYBRID_PRICE_VOLUME_PROXY";
  flowPower: number;
  flowIndex: number;
  flowSignalIndex: number;
  flowDelta: number;
  flowAccel: number;
  flowState: McdxFlowStateV40;
  state: McdxLegacyState;
  smartMoney: number;
  hotMoney: number;
  retail: number;
  smartRising: boolean;
  smartFalling: boolean;
  components: {
    legacyMcdx: number;
    vfi: number;
    obv: number;
    adPressure: number;
    mfi: number;
  };
  liquidity: {
    activeBSL: number | null;
    activeSSL: number | null;
    bslSweep: boolean;
    sslSweep: boolean;
    bullAbsorption: boolean;
    bearAbsorption: boolean;
    recentBSL: boolean;
    recentSSL: boolean;
  };
  htf: {
    available: boolean;
    flowPower: number | null;
    direction: McdxHtfDirectionV40;
  };
  bullConfirm: boolean;
  bearConfirm: boolean;
  strongBullFlow: boolean;
  strongBearFlow: boolean;
  verdict: "BULL_CONFIRM" | "BEAR_CONFIRM" | "BULL_FLOW" | "BEAR_FLOW" | "NEUTRAL";

  // Backward-compatible aliases for existing fund forecast/UI consumers.
  smartMoneyProxy: number;
  hotMoneyProxy: number;
  retailProxy: number;
  smartFlow: number;
  flowScore: number;
  flowSignalValue: number;
  flowSignal: McdxFlowSignalV40;
  sponsor: McdxSponsorStateV40;
  contextScore: number;
  longScore: number;
  shortScore: number;
  reason: string;
}

const clamp = (value: number, min = -100, max = 100) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stdev = (values: number[]) => {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length);
};

function smaAt(values: Array<number | null>, index: number, length: number): number | null {
  if (index + 1 < length) return null;
  const window = values.slice(index + 1 - length, index + 1);
  if (window.some(value => value == null || !Number.isFinite(value))) return null;
  return mean(window as number[]);
}

function emaSeries(values: Array<number | null>, length: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  const seed: number[] = [];
  let prev: number | null = null;
  const alpha = 2 / (length + 1);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    if (prev == null) {
      seed.push(value);
      if (seed.length < length) continue;
      if (seed.length === length) {
        prev = mean(seed);
        output[i] = prev;
      }
      continue;
    }
    prev = value * alpha + prev * (1 - alpha);
    output[i] = prev;
  }
  return output;
}

function rollingStd(values: number[], index: number, length: number): number | null {
  if (index + 1 < length) return null;
  return stdev(values.slice(index + 1 - length, index + 1));
}

function rollingMinMax(values: Array<number | null>, index: number, length: number) {
  const window = values.slice(Math.max(0, index + 1 - length), index + 1).filter((value): value is number => value != null && Number.isFinite(value));
  if (!window.length) return null;
  return { min: Math.min(...window), max: Math.max(...window) };
}

function rollingMfi(candles: Candle[], index: number, length = 14): number | null {
  if (index < length) return null;
  let positive = 0;
  let negative = 0;
  for (let i = index - length + 1; i <= index; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    const tp = (current.high + current.low + current.close) / 3;
    const prevTp = (previous.high + previous.low + previous.close) / 3;
    const flow = tp * Math.max(0, current.volume);
    if (tp > prevTp) positive += flow;
    else if (tp < prevTp) negative += flow;
  }
  if (positive + negative === 0) return 50;
  if (negative === 0) return 100;
  return 100 - 100 / (1 + positive / negative);
}

function atrSeries(candles: Candle[], length = 14): Array<number | null> {
  const tr: Array<number | null> = Array(candles.length).fill(null);
  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i];
    const prev = candles[i - 1];
    tr[i] = Math.max(bar.high - bar.low, Math.abs(bar.high - prev.close), Math.abs(bar.low - prev.close));
  }
  return emaSeries(tr, length);
}

function confirmedPivot(candles: Candle[], center: number, left: number, right: number, side: "HIGH" | "LOW") {
  if (center - left < 0 || center + right >= candles.length) return null;
  const value = side === "HIGH" ? candles[center].high : candles[center].low;
  for (let i = center - left; i <= center + right; i += 1) {
    if (i === center) continue;
    if (side === "HIGH" && candles[i].high > value) return null;
    if (side === "LOW" && candles[i].low < value) return null;
  }
  return value;
}

/**
 * TypeScript port of MCDX Sentinel v4.0 for the fund webapp.
 *
 * This engine intentionally does NOT decide price trend, BOS/CHOCH or a trade.
 * It is a synthetic price/volume participation proxy used only as Sentinel X
 * conviction/confirmation. It is not exchange order-flow or verified holdings data.
 */
export function computeMcdxV40(rows: Candle[], options: McdxV40Options = {}): McdxV40Output | null {
  const candles = rows
    .filter(row => Number.isFinite(row.close) && row.close > 0 && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.volume) && row.volume >= 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (candles.length < 45) return null;

  const n = candles.length;
  const mcdxLen = Math.max(20, Math.min(options.mcdxLength ?? 50, n - 8));
  const requestedVfiLen = options.vfiLength ?? 80;
  const vfiLen = Math.max(20, Math.min(requestedVfiLen, Math.max(20, n - 10)));
  const obvLen = 20;
  const adLen = 20;
  const flowSmooth = 4;
  const deltaBars = 3;
  const accelLag = 2;
  const confirmGate = options.confirmGate ?? 25;
  const vetoGate = options.vetoGate ?? 45;

  const smart: Array<number | null> = Array(n).fill(null);
  const floatTotal: Array<number | null> = Array(n).fill(null);
  const hot: Array<number | null> = Array(n).fill(null);
  const retail: Array<number | null> = Array(n).fill(null);
  for (let i = mcdxLen - 1; i < n; i += 1) {
    const window = candles.slice(i + 1 - mcdxLen, i + 1);
    const lo = Math.min(...window.map(bar => bar.low));
    const hi = Math.max(...window.map(bar => bar.high));
    const span = Math.max(hi - lo, 1e-9);
    const profitFactor = i <= 100 ? .98 : .96;
    const floatFactor = i <= 100 ? 1.02 : 1.04;
    const smartValue = clamp((candles[i].close * profitFactor - lo) / span * 100, 0, 100);
    const totalValue = clamp((candles[i].close * floatFactor - lo) / span * 100, 0, 100);
    smart[i] = smartValue;
    floatTotal[i] = totalValue;
    hot[i] = clamp(totalValue - smartValue, 0, 100);
    retail[i] = clamp(100 - totalValue, 0, 100);
  }

  const legacySigned = smart.map(value => value == null ? null : clamp((value - 50) * 2));
  const typical = candles.map(bar => (bar.high + bar.low + bar.close) / 3);
  const logChange = typical.map((value, i) => i === 0 ? 0 : Math.log(Math.max(value, 1e-9)) - Math.log(Math.max(typical[i - 1], 1e-9)));
  const volumes = candles.map(bar => Math.max(0, bar.volume));
  const vcp: Array<number | null> = Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    const sigma = rollingStd(logChange, i, 30);
    const vave = i + 1 >= vfiLen ? mean(volumes.slice(i + 1 - vfiLen, i + 1)) : null;
    if (sigma == null || vave == null) continue;
    const cutoff = .20 * sigma * candles[i].close;
    const capped = Math.min(volumes[i], Math.max(vave * 2, 1));
    const mf = i === 0 ? 0 : typical[i] - typical[i - 1];
    vcp[i] = mf > cutoff ? capped : mf < -cutoff ? -capped : 0;
  }
  const vfiRaw: Array<number | null> = Array(n).fill(null);
  for (let i = vfiLen - 1; i < n; i += 1) {
    const vave = mean(volumes.slice(i + 1 - vfiLen, i + 1));
    const window = vcp.slice(i + 1 - vfiLen, i + 1);
    if (window.some(value => value == null)) continue;
    vfiRaw[i] = (window as number[]).reduce((sum, value) => sum + value, 0) / Math.max(vave, 1);
  }
  const vfiSmooth = emaSeries(vfiRaw, 3);
  const vfiSigned: Array<number | null> = Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    const value = vfiSmooth[i];
    const range = rollingMinMax(vfiSmooth, i, 200);
    if (value == null || !range) continue;
    const normalized = range.max === range.min ? 50 : clamp((value - range.min) / (range.max - range.min) * 100, 0, 100);
    vfiSigned[i] = clamp((normalized - 50) * 2);
  }

  const obv: number[] = Array(n).fill(0);
  for (let i = 1; i < n; i += 1) {
    obv[i] = obv[i - 1] + (candles[i].close > candles[i - 1].close ? volumes[i] : candles[i].close < candles[i - 1].close ? -volumes[i] : 0);
  }
  const obvSigned: Array<number | null> = Array(n).fill(null);
  for (let i = obvLen - 1; i < n; i += 1) {
    const window = obv.slice(i + 1 - obvLen, i + 1);
    const sd = stdev(window);
    const z = sd > 0 ? (obv[i] - mean(window)) / sd : 0;
    obvSigned[i] = clamp(z / 3 * 100);
  }

  const adRaw = candles.map(bar => {
    const range = Math.max(bar.high - bar.low, 1e-9);
    const clv = ((bar.close - bar.low) - (bar.high - bar.close)) / range;
    return clv * Math.max(0, bar.volume);
  });
  const adPressure = emaSeries(adRaw, 3);
  const adSigned: Array<number | null> = Array(n).fill(null);
  for (let i = adLen - 1; i < n; i += 1) {
    const base = mean(volumes.slice(i + 1 - adLen, i + 1));
    if (adPressure[i] == null) continue;
    adSigned[i] = clamp((adPressure[i] as number) / Math.max(base, 1) * 130);
  }

  const mfiSigned: Array<number | null> = Array(n).fill(null);
  for (let i = 14; i < n; i += 1) {
    const value = rollingMfi(candles, i, 14);
    if (value != null) mfiSigned[i] = clamp((value - 50) * 2);
  }

  const flowRaw: Array<number | null> = Array(n).fill(null);
  for (let i = 0; i < n; i += 1) {
    const parts = [legacySigned[i], vfiSigned[i], obvSigned[i], adSigned[i], mfiSigned[i]];
    if (parts.some(value => value == null)) continue;
    flowRaw[i] = (parts[0] as number) * .25 + (parts[1] as number) * .30 + (parts[2] as number) * .20 + (parts[3] as number) * .15 + (parts[4] as number) * .10;
  }
  const flowPowerSeries = emaSeries(flowRaw, flowSmooth).map(value => value == null ? null : clamp(value));
  const flowIndexSeries = flowPowerSeries.map(value => value == null ? null : (value + 100) * .5);
  const flowSignalSeries = emaSeries(flowIndexSeries, 5);
  const deltaSeries: Array<number | null> = flowPowerSeries.map((value, i) => value == null || i < deltaBars || flowPowerSeries[i - deltaBars] == null ? null : value - (flowPowerSeries[i - deltaBars] as number));
  const accelSeries: Array<number | null> = deltaSeries.map((value, i) => value == null || i < accelLag || deltaSeries[i - accelLag] == null ? null : value - (deltaSeries[i - accelLag] as number));

  const last = n - 1;
  const flowPower = finite(flowPowerSeries[last]);
  const flowIndex = finite(flowIndexSeries[last]);
  const flowSignalIndex = finite(flowSignalSeries[last]);
  const flowDelta = finite(deltaSeries[last]);
  const flowAccel = finite(accelSeries[last]);
  const smartMoney = finite(smart[last]);
  const hotMoney = finite(hot[last]);
  const retailMoney = finite(retail[last]);
  if ([flowPower, flowIndex, flowSignalIndex, flowDelta, flowAccel, smartMoney, hotMoney, retailMoney].some(value => value == null)) return null;

  const smartSma = smaAt(smart, last, 5) ?? smartMoney!;
  const retailSma = smaAt(retail, last, 5) ?? retailMoney!;
  const previousSmart = finite(smart[last - 1]) ?? smartMoney!;
  const smartRising = smartMoney! > smartSma && smartMoney! > previousSmart;
  const smartFalling = smartMoney! < smartSma && smartMoney! < previousSmart;

  const earlyAccSeries: boolean[] = Array(n).fill(false);
  const earlyDistSeries: boolean[] = Array(n).fill(false);
  const accRawSeries: boolean[] = Array(n).fill(false);
  const distRawSeries: boolean[] = Array(n).fill(false);
  for (let i = 1; i < n; i += 1) {
    const fp = finite(flowPowerSeries[i]);
    const fd = finite(deltaSeries[i]);
    const fa = finite(accelSeries[i]);
    const sm = finite(smart[i]);
    const prevSm = finite(smart[i - 1]);
    const rt = finite(retail[i]);
    const rtSma = smaAt(retail, i, 5);
    if ([fp, fd, fa, sm, prevSm, rt, rtSma].some(value => value == null)) continue;
    earlyAccSeries[i] = fp! > -15 && fd! >= 5 && fa! > 0 && sm! >= prevSm!;
    earlyDistSeries[i] = fp! < 15 && fd! <= -5 && fa! < 0 && sm! <= prevSm!;
    accRawSeries[i] = fp! >= 18 && fd! > 0 && sm! >= 45 && rt! <= rtSma!;
    distRawSeries[i] = fp! <= -18 && fd! < 0 && sm! <= 55 && rt! >= rtSma!;
  }
  const votes = (series: boolean[]) => series.slice(Math.max(0, n - 3)).filter(Boolean).length;
  const accumulation = votes(accRawSeries) >= 2;
  const distribution = votes(distRawSeries) >= 2;
  const earlyAccumulation = earlyAccSeries[last];
  const earlyDistribution = earlyDistSeries[last];
  const strongAccumulation = flowPower! >= vetoGate && flowDelta! >= 0;
  const strongDistribution = flowPower! <= -vetoGate && flowDelta! <= 0;
  const flowState: McdxFlowStateV40 = strongAccumulation ? "STRONG_ACCUMULATION"
    : strongDistribution ? "STRONG_DISTRIBUTION"
      : accumulation ? "ACCUMULATION"
        : distribution ? "DISTRIBUTION"
          : earlyAccumulation ? "EARLY_ACCUMULATION"
            : earlyDistribution ? "EARLY_DISTRIBUTION"
              : "NEUTRAL";
  const state: McdxLegacyState = ["STRONG_ACCUMULATION", "ACCUMULATION", "EARLY_ACCUMULATION"].includes(flowState)
    ? "ACCUMULATION"
    : ["STRONG_DISTRIBUTION", "DISTRIBUTION", "EARLY_DISTRIBUTION"].includes(flowState)
      ? "DISTRIBUTION"
      : "NEUTRAL";

  // Liquidity/absorption scanner. Pivots are only liquidity references; MCDX never
  // interprets them as BOS/CHOCH because Sentinel X owns price structure.
  const pivotLeft = 3;
  const pivotRight = 3;
  const sweepWickAtr = .10;
  const absorbBars = 3;
  const liqMemory = 8;
  const atrs = atrSeries(candles, 14);
  let activeBSL: number | null = null;
  let activeSSL: number | null = null;
  let bslConsumed = true;
  let sslConsumed = true;
  let latestBslSweep = -Infinity;
  let latestSslSweep = -Infinity;
  let lastBsl: { level: number; mid: number; flow: number; index: number; handled: boolean } | null = null;
  let lastSsl: { level: number; mid: number; flow: number; index: number; handled: boolean } | null = null;
  let bslSweepNow = false;
  let sslSweepNow = false;
  let bullAbsorption = false;
  let bearAbsorption = false;
  for (let i = pivotLeft + pivotRight; i < n; i += 1) {
    const center = i - pivotRight;
    const ph = confirmedPivot(candles, center, pivotLeft, pivotRight, "HIGH");
    const pl = confirmedPivot(candles, center, pivotLeft, pivotRight, "LOW");
    if (ph != null) { activeBSL = ph; bslConsumed = false; }
    if (pl != null) { activeSSL = pl; sslConsumed = false; }
    const bar = candles[i];
    const atrValue = finite(atrs[i]);
    const fp = finite(flowPowerSeries[i]);
    const fd = finite(deltaSeries[i]);
    if (atrValue == null || atrValue <= 0 || fp == null) continue;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const bslSweep = !bslConsumed && activeBSL != null && bar.high > activeBSL && bar.close < activeBSL && upperWick / atrValue >= sweepWickAtr;
    const sslSweep = !sslConsumed && activeSSL != null && bar.low < activeSSL && bar.close > activeSSL && lowerWick / atrValue >= sweepWickAtr;
    if (bslSweep) {
      lastBsl = { level: activeBSL!, mid: (bar.high + bar.low) * .5, flow: fp, index: i, handled: false };
      bslConsumed = true;
      latestBslSweep = i;
      if (i === last) bslSweepNow = true;
    } else if (!bslConsumed && activeBSL != null && bar.close > activeBSL) bslConsumed = true;
    if (sslSweep) {
      lastSsl = { level: activeSSL!, mid: (bar.high + bar.low) * .5, flow: fp, index: i, handled: false };
      sslConsumed = true;
      latestSslSweep = i;
      if (i === last) sslSweepNow = true;
    } else if (!sslConsumed && activeSSL != null && bar.close < activeSSL) sslConsumed = true;

    if (lastSsl && !lastSsl.handled && i > lastSsl.index && i - lastSsl.index <= absorbBars && fd != null
      && bar.close > lastSsl.level && bar.close > lastSsl.mid && fp > lastSsl.flow && fd > 0) {
      lastSsl.handled = true;
      if (i === last) bullAbsorption = true;
    }
    if (lastBsl && !lastBsl.handled && i > lastBsl.index && i - lastBsl.index <= absorbBars && fd != null
      && bar.close < lastBsl.level && bar.close < lastBsl.mid && fp < lastBsl.flow && fd < 0) {
      lastBsl.handled = true;
      if (i === last) bearAbsorption = true;
    }
    if (lastSsl && i - lastSsl.index > absorbBars) lastSsl.handled = true;
    if (lastBsl && i - lastBsl.index > absorbBars) lastBsl.handled = true;
  }
  const recentBSL = last - latestBslSweep <= liqMemory;
  const recentSSL = last - latestSslSweep <= liqMemory;

  const htfFlowPower = finite(options.htfFlowPower);
  const htfDirection: McdxHtfDirectionV40 = htfFlowPower == null ? "UNAVAILABLE"
    : htfFlowPower >= confirmGate * .60 ? "BULL"
      : htfFlowPower <= -confirmGate * .60 ? "BEAR"
        : "NEUTRAL";
  const mtfBullOk = htfDirection === "UNAVAILABLE" || htfDirection === "BULL" || htfDirection === "NEUTRAL";
  const mtfBearOk = htfDirection === "UNAVAILABLE" || htfDirection === "BEAR" || htfDirection === "NEUTRAL";
  const bullConfirm = flowPower! >= confirmGate && flowDelta! >= 0 && mtfBullOk;
  const bearConfirm = flowPower! <= -confirmGate && flowDelta! <= 0 && mtfBearOk;
  const strongBullFlow = flowPower! >= vetoGate;
  const strongBearFlow = flowPower! <= -vetoGate;
  const verdict = bullConfirm ? "BULL_CONFIRM"
    : bearConfirm ? "BEAR_CONFIRM"
      : strongBullFlow ? "BULL_FLOW"
        : strongBearFlow ? "BEAR_FLOW"
          : "NEUTRAL";

  const flowSignal: McdxFlowSignalV40 = bullConfirm || flowPower! >= 12 ? "BUY_PRESSURE"
    : bearConfirm || flowPower! <= -12 ? "SELL_PRESSURE"
      : "MIXED";
  const sponsor: McdxSponsorStateV40 = bullConfirm ? "BULL_SPONSORED" : bearConfirm ? "BEAR_SPONSORED" : "NONE";
  const smartFlow = clamp((flowPower! + 100) * .5, 0, 100);
  const contextScore = clamp(50 + Math.abs(flowPower!) * .35 + Math.min(15, Math.abs(flowDelta!) * .6) + (bullAbsorption || bearAbsorption ? 8 : 0), 0, 100);
  const longScore = clamp(50 + flowPower! * .5, 0, 100);
  const shortScore = clamp(50 - flowPower! * .5, 0, 100);

  return {
    version: "4.0",
    engine: "MCDX Sentinel v4.0 · Institutional Flow Companion",
    methodology: "HYBRID_PRICE_VOLUME_PROXY",
    flowPower: Number(flowPower!.toFixed(2)),
    flowIndex: Number(flowIndex!.toFixed(2)),
    flowSignalIndex: Number(flowSignalIndex!.toFixed(2)),
    flowDelta: Number(flowDelta!.toFixed(2)),
    flowAccel: Number(flowAccel!.toFixed(2)),
    flowState,
    state,
    smartMoney: Number(smartMoney!.toFixed(2)),
    hotMoney: Number(hotMoney!.toFixed(2)),
    retail: Number(retailMoney!.toFixed(2)),
    smartRising,
    smartFalling,
    components: {
      legacyMcdx: Number((legacySigned[last] ?? 0).toFixed(2)),
      vfi: Number((vfiSigned[last] ?? 0).toFixed(2)),
      obv: Number((obvSigned[last] ?? 0).toFixed(2)),
      adPressure: Number((adSigned[last] ?? 0).toFixed(2)),
      mfi: Number((mfiSigned[last] ?? 0).toFixed(2)),
    },
    liquidity: {
      activeBSL,
      activeSSL,
      bslSweep: bslSweepNow,
      sslSweep: sslSweepNow,
      bullAbsorption,
      bearAbsorption,
      recentBSL,
      recentSSL,
    },
    htf: { available: htfFlowPower != null, flowPower: htfFlowPower, direction: htfDirection },
    bullConfirm,
    bearConfirm,
    strongBullFlow,
    strongBearFlow,
    verdict,
    smartMoneyProxy: Number(smartMoney!.toFixed(2)),
    hotMoneyProxy: Number(hotMoney!.toFixed(2)),
    retailProxy: Number(retailMoney!.toFixed(2)),
    smartFlow: Number(smartFlow.toFixed(2)),
    flowScore: Number(smartFlow.toFixed(2)),
    flowSignalValue: Number(flowSignalIndex!.toFixed(2)),
    flowSignal,
    sponsor,
    contextScore: Number(contextScore.toFixed(2)),
    longScore: Number(longScore.toFixed(2)),
    shortScore: Number(shortScore.toFixed(2)),
    reason: `MCDX v4 synthetic price/volume companion: Flow Power ${flowPower!.toFixed(1)}, ${flowState}, HTF ${htfDirection}. This is a proxy, not verified institutional order flow.`,
  };
}
