import type { Candle } from "../types";

export type McdxFlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";
export type McdxSponsorState = "BULL_SPONSORED" | "BEAR_SPONSORED" | "NONE";
export type McdxFlowSignal = "BUY_PRESSURE" | "SELL_PRESSURE" | "MIXED";

export type McdxV33Snapshot = {
  version: "3.3";
  methodology: "PRICE_VOLUME_PROXY";
  state: McdxFlowState;
  smartMoneyProxy: number;
  hotMoneyProxy: number;
  retailProxy: number;
  volumeFlow: number;
  smartFlow: number;
  flowScore: number;
  flowSignalValue: number;
  flowSignal: McdxFlowSignal;
  sponsor: McdxSponsorState;
  contextScore: number;
  longScore: number;
  shortScore: number;
  longReady: boolean;
  shortReady: boolean;
  reason: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stdev = (values: number[]) => {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map(value => (value - mean) ** 2)));
};

function emaSeries(values: number[], length: number) {
  if (!values.length) return [] as number[];
  const alpha = 2 / (length + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] * alpha + out[i - 1] * (1 - alpha));
  return out;
}

function rollingNorm(values: number[], lookback = 200) {
  return values.map((value, index) => {
    const slice = values.slice(Math.max(0, index - lookback + 1), index + 1).filter(Number.isFinite);
    const low = Math.min(...slice);
    const high = Math.max(...slice);
    return high > low ? clamp((value - low) / (high - low) * 100) : 50;
  });
}

function mcdxSeries(candles: Candle[], multiplier: number, length = 50) {
  return candles.map((row, index) => {
    const slice = candles.slice(Math.max(0, index - length + 1), index + 1);
    const low = Math.min(...slice.map(item => item.low));
    const high = Math.max(...slice.map(item => item.high));
    return high > low ? clamp((row.close * multiplier - low) / (high - low) * 100) : 50;
  });
}

function obvSeries(candles: Candle[]) {
  const out = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const direction = candles[i].close > candles[i - 1].close ? 1 : candles[i].close < candles[i - 1].close ? -1 : 0;
    out.push(out[i - 1] + candles[i].volume * direction);
  }
  return out;
}

function buildVolumeFlow(candles: Candle[], vfiLen = 80, obvLen = 20) {
  const typical = candles.map(row => (row.high + row.low + row.close) / 3);
  const vfiRaw = candles.map((row, index) => {
    if (index < Math.max(vfiLen, 30)) return 0;
    const logMoves: number[] = [];
    for (let j = Math.max(1, index - 29); j <= index; j += 1) logMoves.push(Math.log(Math.max(typical[j], 1e-9)) - Math.log(Math.max(typical[j - 1], 1e-9)));
    const cutoff = .20 * stdev(logMoves) * row.close;
    const volWindow = candles.slice(index - vfiLen + 1, index + 1).map(item => item.volume);
    const vave = Math.max(avg(volWindow), 1);
    const vmax = vave * 2;
    let signed = 0;
    for (let j = index - vfiLen + 1; j <= index; j += 1) {
      const flow = typical[j] - typical[Math.max(0, j - 1)];
      const adjusted = Math.min(candles[j].volume, vmax);
      signed += flow > cutoff ? adjusted : flow < -cutoff ? -adjusted : 0;
    }
    return signed / vave;
  });
  const vfiSmooth = emaSeries(vfiRaw, 3);
  const vfiNorm = rollingNorm(vfiSmooth, 200);

  const obv = obvSeries(candles);
  const obvNorm = obv.map((value, index) => {
    const slice = obv.slice(Math.max(0, index - obvLen + 1), index + 1);
    const mean = avg(slice);
    const sd = stdev(slice);
    const z = sd > 0 ? (value - mean) / sd : 0;
    return clamp((z + 3) / 6 * 100);
  });
  return emaSeries(vfiNorm.map((value, index) => value * .60 + obvNorm[index] * .40), 4);
}

function vote2of3(values: boolean[], end = values.length - 1) {
  let votes = 0;
  for (let i = Math.max(0, end - 2); i <= end; i += 1) if (values[i]) votes += 1;
  return votes >= 2;
}

function recentSweepContext(candles: Candle[]) {
  const rows = candles.slice(-45);
  if (rows.length < 20) return { recentSSL: false, recentBSL: false };
  const prior = rows.slice(0, -8);
  const recent = rows.slice(-8);
  const priorLow = Math.min(...prior.map(row => row.low));
  const priorHigh = Math.max(...prior.map(row => row.high));
  const recentSSL = recent.some(row => row.low < priorLow && row.close > priorLow);
  const recentBSL = recent.some(row => row.high > priorHigh && row.close < priorHigh);
  return { recentSSL, recentBSL };
}

/**
 * Server-side MCDX Sentinel v3.3 equivalent based on the uploaded Pine.
 * IMPORTANT: all Smart Money / Hot Money values are synthetic price-volume
 * proxies. They are not institutional ownership, filing, dark-pool or broker
 * flow evidence. RSI/MACD/EMA/ADX are intentionally excluded from sponsorship.
 */
export function computeMcdxV33(candles: Candle[]): McdxV33Snapshot | null {
  const clean = candles.filter(row => Number.isFinite(row.close) && row.close > 0 && Number.isFinite(row.volume) && row.volume >= 0).sort((a, b) => a.date.localeCompare(b.date));
  if (clean.length < 100) return null;
  const smart = mcdxSeries(clean, clean.length <= 100 ? .98 : .96, 50);
  const floatTotal = mcdxSeries(clean, clean.length <= 100 ? 1.02 : 1.04, 50);
  const hot = floatTotal.map((value, index) => clamp(value - smart[index]));
  const retail = floatTotal.map(value => clamp(100 - value));
  const smartSma = smart.map((_, index) => avg(smart.slice(Math.max(0, index - 4), index + 1)));
  const retailSma = retail.map((_, index) => avg(retail.slice(Math.max(0, index - 4), index + 1)));
  const volumeFlow = buildVolumeFlow(clean, Math.min(80, Math.max(20, clean.length - 20)), 20);
  const smartFlowRaw = smart.map((value, index) => value * .45 + (volumeFlow[index] ?? 50) * .40 + clamp(100 - retail[index]) * .15);
  const smartFlow = emaSeries(smartFlowRaw, 4).map(value => clamp(value));
  const flowSignalLine = emaSeries(smartFlow, 5);

  const bullSponsorRaw = smart.map((value, index) => {
    const priorSmart = smart[Math.max(0, index - 1)];
    const retailRising = retail[index] > retailSma[index] && retail[index] > retail[Math.max(0, index - 1)];
    return value > smartSma[index] && value >= 50 && value >= priorSmart && smartFlow[index] >= 55 && smartFlow[index] > flowSignalLine[index] && (volumeFlow[index] ?? 50) >= 50 && !retailRising;
  });
  const bearSponsorRaw = smart.map((value, index) => {
    const priorSmart = smart[Math.max(0, index - 1)];
    const retailFalling = retail[index] < retailSma[index] && retail[index] < retail[Math.max(0, index - 1)];
    return value < smartSma[index] && value <= 50 && value <= priorSmart && smartFlow[index] <= 45 && smartFlow[index] < flowSignalLine[index] && (volumeFlow[index] ?? 50) <= 50 && !retailFalling;
  });

  const accRaw = smart.map((value, index) => {
    const retailFalling = retail[index] < retailSma[index] && retail[index] < retail[Math.max(0, index - 1)];
    return bullSponsorRaw[index] && value >= 55 && retailFalling;
  });
  const distRaw = smart.map((value, index) => {
    const retailRising = retail[index] > retailSma[index] && retail[index] > retail[Math.max(0, index - 1)];
    return bearSponsorRaw[index] && value <= 45 && retailRising;
  });

  const last = clean.length - 1;
  const accumulation = vote2of3(accRaw, last);
  const distribution = vote2of3(distRaw, last);
  const state: McdxFlowState = accumulation ? "ACCUMULATION" : distribution ? "DISTRIBUTION" : "NEUTRAL";
  const bullPreSponsored = last >= 3 && [bullSponsorRaw[last - 1], bullSponsorRaw[last - 2], bullSponsorRaw[last - 3]].filter(Boolean).length >= 2;
  const bearPreSponsored = last >= 3 && [bearSponsorRaw[last - 1], bearSponsorRaw[last - 2], bearSponsorRaw[last - 3]].filter(Boolean).length >= 2;
  const sponsor: McdxSponsorState = bullPreSponsored ? "BULL_SPONSORED" : bearPreSponsored ? "BEAR_SPONSORED" : "NONE";

  const smartNow = smart[last];
  const hotNow = hot[last];
  const retailNow = retail[last];
  const volumeFlowNow = volumeFlow[last] ?? 50;
  const smartFlowNow = smartFlow[last] ?? 50;
  const flowSignalValue = flowSignalLine[last] ?? 50;
  const flowSignal: McdxFlowSignal = smartFlowNow >= 55 && smartFlowNow > flowSignalValue ? "BUY_PRESSURE" : smartFlowNow <= 45 && smartFlowNow < flowSignalValue ? "SELL_PRESSURE" : "MIXED";
  const sweep = recentSweepContext(clean);
  const longScore = Math.round(clamp(
    (smartNow >= 55 ? 35 : smartNow >= 50 ? 20 : 0) +
    (smartFlowNow >= 60 ? 30 : smartFlowNow >= 52 ? 18 : 0) +
    (sweep.recentSSL ? 12 : 0) +
    (sponsor === "BULL_SPONSORED" ? 10 : 0),
  ));
  const shortScore = Math.round(clamp(
    (smartNow <= 45 ? 35 : smartNow <= 50 ? 20 : 0) +
    (smartFlowNow <= 40 ? 30 : smartFlowNow <= 48 ? 18 : 0) +
    (sweep.recentBSL ? 12 : 0) +
    (sponsor === "BEAR_SPONSORED" ? 10 : 0),
  ));
  const contextScore = state === "ACCUMULATION" ? longScore : state === "DISTRIBUTION" ? shortScore : Math.max(longScore, shortScore, Math.round(Math.abs(smartFlowNow - 50) * 1.2 + 40));
  const reason = `MCDX v3.3 ${state} · Smart proxy ${Math.round(smartNow)} · Flow ${Math.round(smartFlowNow)}/${Math.round(flowSignalValue)} · ${sponsor} · ${flowSignal}. PRICE_VOLUME_PROXY only; not ownership/filing evidence.`;

  return {
    version: "3.3",
    methodology: "PRICE_VOLUME_PROXY",
    state,
    smartMoneyProxy: Math.round(smartNow),
    hotMoneyProxy: Math.round(hotNow),
    retailProxy: Math.round(retailNow),
    volumeFlow: Math.round(volumeFlowNow),
    smartFlow: Math.round(smartFlowNow),
    flowScore: Math.round(smartFlowNow),
    flowSignalValue: Math.round(flowSignalValue),
    flowSignal,
    sponsor,
    contextScore: Math.round(clamp(contextScore)),
    longScore,
    shortScore,
    longReady: longScore >= 65,
    shortReady: shortScore >= 65,
    reason,
  };
}
