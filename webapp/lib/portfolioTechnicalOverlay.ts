import type { Candle } from "./types";
import { adx, atr, ema, mfi, obv, rsi } from "./indicators";

export type PortfolioTechnicalAction = "ADD" | "HOLD" | "TRIM" | "EXIT REVIEW";
export type FlowState = "ACCUMULATION" | "NEUTRAL" | "DISTRIBUTION";

export interface PortfolioTechnicalOverlay {
  action: PortfolioTechnicalAction;
  confidence: number;
  reason: string;
  target1: number | null;
  target2: number | null;
  support1: number | null;
  roomAtr: number | null;
  sentinel: { dailyScore: number; weeklyScore: number; trend: "BULL" | "NEUTRAL" | "BEAR"; structure: "BULL" | "NEUTRAL" | "BEAR" };
  mcdx: { smartMoneyProxy: number; smartFlow: number; contextScore: number; state: FlowState };
  policy: { timeframe: "WEEKLY DECISION · DAILY EXECUTION"; requiresFundamentalExitGate: true; syntheticFlowProxy: true };
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

function weeklyCandles(candles: Candle[]): Candle[] {
  const weeks = new Map<string, Candle>();
  for (const candle of candles) {
    const date = new Date(`${candle.date}T00:00:00Z`);
    const day = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - day + 1);
    const key = date.toISOString().slice(0, 10);
    const existing = weeks.get(key);
    if (!existing) weeks.set(key, { ...candle, date: key });
    else weeks.set(key, { date: key, open: existing.open, high: Math.max(existing.high, candle.high), low: Math.min(existing.low, candle.low), close: candle.close, volume: existing.volume + candle.volume });
  }
  return [...weeks.values()];
}

function recentLevels(candles: Candle[], price: number) {
  const recent = candles.slice(-80);
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const bar = recent[i];
    if (bar.high >= Math.max(...recent.slice(i - 2, i + 3).map((item) => item.high))) highs.push(bar.high);
    if (bar.low <= Math.min(...recent.slice(i - 2, i + 3).map((item) => item.low))) lows.push(bar.low);
  }
  return {
    resistances: [...new Set(highs.filter((level) => level > price * 1.002).sort((a, b) => a - b))],
    supports: [...new Set(lows.filter((level) => level < price * .998).sort((a, b) => b - a))],
  };
}

function rangePosition(candles: Candle[], period = 21): number {
  const slice = candles.slice(-period);
  if (!slice.length) return 50;
  const low = Math.min(...slice.map((candle) => candle.low));
  const high = Math.max(...slice.map((candle) => candle.high));
  return high === low ? 50 : clamp(((slice.at(-1)!.close - low) / (high - low)) * 100);
}

function trendScore(candles: Candle[], weekly = false) {
  const closes = candles.map((candle) => candle.close);
  const price = closes.at(-1) ?? 0;
  const fast = ema(closes, 20);
  const slow = ema(closes, 50);
  const long = weekly ? null : ema(closes, 200);
  const momentum = rsi(closes, 14) ?? 50;
  let score = 0;
  score += fast != null && price > fast ? 25 : 0;
  score += fast != null && slow != null && fast > slow ? 25 : 0;
  score += long == null || slow == null || slow > long ? 15 : 0;
  score += momentum >= 52 && momentum <= 75 ? 20 : momentum > 75 ? 12 : 0;
  score += (adx(candles, 14) ?? 0) >= 20 ? 15 : 5;
  return { score: Math.round(clamp(score)), fast, momentum, price };
}

/** Sentinel X + MCDX-inspired portfolio overlay. MCDX values are synthetic price/volume proxies, not institutional-flow data. */
export function computePortfolioTechnicalOverlay(candles: Candle[]): PortfolioTechnicalOverlay | null {
  const clean = candles.filter((candle) => Number.isFinite(candle.close) && candle.close > 0 && Number.isFinite(candle.volume));
  if (clean.length < 220) return null;
  const weeks = weeklyCandles(clean);
  if (weeks.length < 50) return null;

  const daily = trendScore(clean);
  const weekly = trendScore(weeks, true);
  const price = daily.price;
  const volatility = atr(clean, 14);
  const levels = recentLevels(clean, price);
  const support1 = levels.supports[0] ?? (volatility ? price - 2.2 * volatility : null);
  const target1 = levels.resistances[0] ?? (volatility ? price + 2.2 * volatility : null);
  const target2 = levels.resistances[1] ?? (target1 != null && volatility ? target1 + 1.3 * volatility : null);
  const roomAtr = volatility && target1 != null ? (target1 - price) / volatility : null;

  const recent = clean.slice(-21);
  const prior = clean.slice(-42, -21);
  const smartMoneyProxy = Math.round(rangePosition(clean));
  const priorProxy = Math.round(rangePosition(prior));
  const moneyFlow = mfi(clean, 14) ?? 50;
  const volumeTrend = obv(clean);
  const typicalVolume = avg(recent.map((candle) => candle.volume));
  const upVolume = recent.filter((candle, index) => index > 0 && candle.close >= recent[index - 1].close).reduce((sum, candle) => sum + candle.volume, 0);
  const downVolume = recent.filter((candle, index) => index > 0 && candle.close < recent[index - 1].close).reduce((sum, candle) => sum + candle.volume, 0);
  const volumeBalance = upVolume + downVolume ? (upVolume / (upVolume + downVolume)) * 100 : 50;
  const relativeVolume = typicalVolume ? clamp((recent.at(-1)!.volume / typicalVolume) * 50) : 50;
  const smartFlow = Math.round(clamp(smartMoneyProxy * .35 + moneyFlow * .25 + volumeBalance * .20 + (volumeTrend?.rising ? 70 : 30) * .15 + relativeVolume * .05));

  const previous = clean.slice(-20, -1);
  const structure: "BULL" | "NEUTRAL" | "BEAR" = price > Math.max(...previous.map((candle) => candle.high)) ? "BULL" : price < Math.min(...previous.map((candle) => candle.low)) ? "BEAR" : "NEUTRAL";
  const trend: "BULL" | "NEUTRAL" | "BEAR" = weekly.score >= 65 ? "BULL" : weekly.score <= 35 ? "BEAR" : "NEUTRAL";
  const accumulation = smartMoneyProxy >= 55 && smartMoneyProxy >= priorProxy && smartFlow >= 55 && trend !== "BEAR" && Boolean(volumeTrend?.rising);
  const distribution = smartMoneyProxy <= 45 && smartMoneyProxy <= priorProxy && smartFlow <= 45 && trend !== "BULL" && !volumeTrend?.rising;
  const state: FlowState = accumulation ? "ACCUMULATION" : distribution ? "DISTRIBUTION" : "NEUTRAL";
  const contextScore = Math.round(clamp(smartMoneyProxy * .30 + smartFlow * .25 + daily.score * .20 + weekly.score * .15 + (structure === "BULL" ? 100 : structure === "BEAR" ? 0 : 50) * .10));

  let action: PortfolioTechnicalAction = "HOLD";
  let reason = "Weekly structure remains intact; wait for a clearer add or reduce setup.";
  if (trend === "BEAR" && distribution && daily.fast != null && price < daily.fast) {
    action = "EXIT REVIEW";
    reason = "Weekly downtrend and distribution agree; Asset Management must confirm a broken thesis before exit.";
  } else if (distribution || (roomAtr != null && roomAtr < .65) || (daily.momentum >= 72 && daily.score >= 65)) {
    action = "TRIM";
    reason = distribution ? "MCDX proxy shows distribution; review position size and lock risk down." : "Price is near technical resistance with limited ATR upside; review a partial trim.";
  } else if (trend === "BULL" && daily.score >= 75 && contextScore >= 65 && (accumulation || smartFlow >= 58) && (roomAtr == null || roomAtr >= 1)) {
    action = "ADD";
    reason = "Weekly trend, daily setup and accumulation context align with enough room to Target 1.";
  }

  const confidence = Math.round(clamp((daily.score + weekly.score + contextScore) / 3));
  return {
    action, confidence, reason, target1,
    target2: confidence >= 70 && state === "ACCUMULATION" ? target2 : null,
    support1, roomAtr: roomAtr == null ? null : Math.round(roomAtr * 100) / 100,
    sentinel: { dailyScore: daily.score, weeklyScore: weekly.score, trend, structure },
    mcdx: { smartMoneyProxy, smartFlow, contextScore, state },
    policy: { timeframe: "WEEKLY DECISION · DAILY EXECUTION", requiresFundamentalExitGate: true, syntheticFlowProxy: true },
  };
}
