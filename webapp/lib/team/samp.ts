// Sentinel Adaptive Market Pressure (SAMP) — Precision v2
//
// A faithful TypeScript port of §0 of "Sentinel Adaptive Structure v1.6"
// (Pine v6), the indicator the quant desk trades from. Every constant,
// weight, threshold and gate below mirrors the Pine source; the port exists
// so the same signal can be evaluated server-side over the app's own candle
// data instead of only inside TradingView.
//
// The design principle carried over from the original: a signal must clear
// context, location, trigger AND pressure. Pressure crossing a threshold is
// never sufficient on its own.

import type { Candle } from "../types";

export type SampProfile = "Responsive" | "Precision" | "Ultra";

export interface SampSignal {
  index: number;
  date: string;
  type: "BUY" | "SELL";
  price: number;
  quality: number;
  samp: number;
  trigger: string;
}

export interface SampResult {
  profile: SampProfile;
  /** Layer 1 — regime-adaptive market direction, smoothed. */
  direction: number;
  /** Layer 2 — signed magnitude with directional persistence, 0-100 scale. */
  strength: number;
  /** Layer 3 — normalised change in direction. */
  acceleration: number;
  samp: number;
  sampSlope: number;
  longQuality: number;
  shortQuality: number;
  /** Component readings behind the current bar. */
  components: { trend: number; direction: number; structure: number; priceAction: number; flow: number };
  weights: { trend: number; dir: number; struct: number; pa: number; flow: number };
  regime: "Strong trend" | "Transition" | "Range";
  contextLong: boolean;
  contextShort: boolean;
  roomOkLong: boolean;
  chaseOkLong: boolean;
  watchLong: boolean;
  watchShort: boolean;
  earlyBull: boolean;
  earlyBear: boolean;
  strongBull: boolean;
  strongBear: boolean;
  state: number;
  /** Every confirmed signal across the loaded history, oldest first. */
  signals: SampSignal[];
  lastSignal: SampSignal | null;
  barsSinceLastSignal: number | null;
  thresholds: { buy: number; sell: number; quality: number; cooldown: number };
  bars: number;
}

// ── Series helpers (Pine ta.* equivalents over a full array) ──────────

function emaSeriesFull(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function smaSeriesFull(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function rsiSeriesFull(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NaN);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / period, al = loss / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function atrSeriesFull(c: Candle[], period = 14): number[] {
  const out = new Array<number>(c.length).fill(NaN);
  if (c.length <= period) return out;
  const tr: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < c.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period; // Wilder / Pine RMA
    out[i] = prev;
  }
  return out;
}

/** Pine ta.dmi(len, adxSmoothing) → [adx, di+, di-] as full series. */
function dmiSeriesFull(c: Candle[], len = 14, adxLen = 14): { adx: number[]; dip: number[]; dim: number[] } {
  const n = c.length;
  const adx = new Array<number>(n).fill(NaN);
  const dip = new Array<number>(n).fill(NaN);
  const dim = new Array<number>(n).fill(NaN);
  if (n <= len + 1) return { adx, dip, dim };

  const tr: number[] = [0], pDM: number[] = [0], mDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = c[i].high - c[i - 1].high;
    const dn = c[i - 1].low - c[i].low;
    pDM.push(up > dn && up > 0 ? up : 0);
    mDM.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  // Wilder RMA smoothing
  const rma = (arr: number[]): number[] => {
    const o = new Array<number>(n).fill(NaN);
    let acc = arr.slice(1, len + 1).reduce((a, b) => a + b, 0) / len;
    o[len] = acc;
    for (let i = len + 1; i < n; i++) {
      acc = (acc * (len - 1) + arr[i]) / len;
      o[i] = acc;
    }
    return o;
  };
  const trS = rma(tr), pS = rma(pDM), mS = rma(mDM);
  const dx = new Array<number>(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(trS[i]) || trS[i] === 0) continue;
    dip[i] = (pS[i] / trS[i]) * 100;
    dim[i] = (mS[i] / trS[i]) * 100;
    const sum = dip[i] + dim[i];
    dx[i] = sum === 0 ? 0 : (Math.abs(dip[i] - dim[i]) / sum) * 100;
  }
  const first = dx.findIndex((v) => Number.isFinite(v));
  if (first >= 0 && first + adxLen < n) {
    let acc = 0, cnt = 0;
    for (let i = first; i < first + adxLen; i++) { acc += dx[i]; cnt++; }
    let a = acc / cnt;
    adx[first + adxLen - 1] = a;
    for (let i = first + adxLen; i < n; i++) {
      a = (a * (adxLen - 1) + dx[i]) / adxLen;
      adx[i] = a;
    }
  }
  return { adx, dip, dim };
}

function highestPrev(values: number[], i: number, len: number): number {
  // Pine: ta.highest(high, len)[1] — window ending on the previous bar
  const end = i - 1;
  const start = end - len + 1;
  if (start < 0) return NaN;
  let m = -Infinity;
  for (let k = start; k <= end; k++) m = Math.max(m, values[k]);
  return m;
}
function lowestPrev(values: number[], i: number, len: number): number {
  const end = i - 1;
  const start = end - len + 1;
  if (start < 0) return NaN;
  let m = Infinity;
  for (let k = start; k <= end; k++) m = Math.min(m, values[k]);
  return m;
}

const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

export interface SampOptions {
  profile?: SampProfile;
  buyThreshold?: number;
  sellThreshold?: number;
  qualityThreshold?: number;
  cooldownBars?: number;
  requireRetest?: boolean;
  /** Daily bars use the ≥8 adaptive cooldown from the Pine source. */
  dailyTimeframe?: boolean;
}

/**
 * Run the SAMP engine across a candle series.
 * Requires roughly 220+ bars for the EMA200 context to be meaningful.
 */
export function runSAMP(candles: Candle[], opts: SampOptions = {}): SampResult | null {
  const n = candles.length;
  if (n < 60) return null;

  const profile: SampProfile = opts.profile ?? "Precision";
  const buyTh = opts.buyThreshold ?? 32;
  const sellTh = opts.sellThreshold ?? -32;
  const scoreTh = opts.qualityThreshold ?? 78;
  const cdInput = opts.cooldownBars ?? 8;
  const requireRetest = opts.requireRetest ?? true;
  // Pine: daily and above raise the cooldown floor to 8 bars
  const cd = opts.dailyTimeframe === false ? cdInput : Math.max(cdInput, 8);

  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const open = candles.map((c) => c.open);
  const volume = candles.map((c) => c.volume);
  const mintick = 1e-8; // syminfo.mintick stand-in for equities priced in dollars

  const atr = atrSeriesFull(candles, 14);
  const e10 = emaSeriesFull(close, 10);
  const e20 = emaSeriesFull(close, 20);
  const e50 = emaSeriesFull(close, 50);
  const e200 = emaSeriesFull(close, 200);
  const { adx, dip, dim } = dmiSeriesFull(candles, 14, 14);
  const rsi = rsiSeriesFull(close, 14);
  const vma = smaSeriesFull(volume, 20);

  const lb = profile === "Responsive" ? 6 : profile === "Ultra" ? 14 : 9;
  const locLen = profile === "Responsive" ? 24 : profile === "Ultra" ? 60 : 40;
  const sm = profile === "Responsive" ? 2 : profile === "Ultra" ? 5 : 3;
  const dirSm = profile === "Responsive" ? 3 : profile === "Ultra" ? 8 : 5;

  // ── Per-bar component computation ───────────────────────────────
  const sampRaw = new Array<number>(n).fill(NaN);
  const structArr = new Array<number>(n).fill(0);
  const trendArr = new Array<number>(n).fill(NaN);
  const dirArr = new Array<number>(n).fill(NaN);
  const paArr = new Array<number>(n).fill(NaN);
  const flowArr = new Array<number>(n).fill(NaN);
  const bosLArr = new Array<boolean>(n).fill(false);
  const bosSArr = new Array<boolean>(n).fill(false);
  const sweepLArr = new Array<boolean>(n).fill(false);
  const sweepSArr = new Array<boolean>(n).fill(false);
  const hiArr = new Array<number>(n).fill(NaN);
  const loArr = new Array<number>(n).fill(NaN);
  const wArr: { trend: number; dir: number; struct: number; pa: number; flow: number }[] = new Array(n);
  const regimeArr = new Array<"Strong trend" | "Transition" | "Range">(n).fill("Range");

  for (let i = 0; i < n; i++) {
    const a = atr[i];
    if (!Number.isFinite(a) || !Number.isFinite(e20[i]) || i < 5) continue;
    const den = Math.max(a, mintick);
    const rng = Math.max(high[i] - low[i], mintick);
    const body = Math.abs(close[i] - open[i]) / rng;
    const clv = (close[i] - low[i]) / rng;
    const rvol = Number.isFinite(vma[i]) && vma[i] > 0 ? volume[i] / vma[i] : 1;

    const hi = highestPrev(high, i, lb);
    const lo = lowestPrev(low, i, lb);
    hiArr[i] = hi;
    loArr[i] = lo;

    const bosL = Number.isFinite(hi) && close[i] > hi + a * 0.08 && close[i - 1] <= hi && body >= 0.42;
    const bosS = Number.isFinite(lo) && close[i] < lo - a * 0.08 && close[i - 1] >= lo && body >= 0.42;
    const sweepL = Number.isFinite(lo) && low[i] < lo - a * 0.04 && close[i] > lo && clv > 0.62 && close[i] > open[i];
    const sweepS = Number.isFinite(hi) && high[i] > hi + a * 0.04 && close[i] < hi && clv < 0.38 && close[i] < open[i];
    const hhhl = i >= 2 && high[i] > high[i - 2] && low[i] > low[i - 2];
    const lhll = i >= 2 && high[i] < high[i - 2] && low[i] < low[i - 2];
    bosLArr[i] = bosL; bosSArr[i] = bosS; sweepLArr[i] = sweepL; sweepSArr[i] = sweepS;

    // 1) trend velocity
    const vel1 = i >= 3 && Number.isFinite(e10[i - 3]) ? (e10[i] - e10[i - 3]) / den : 0;
    const vel2 = i >= 5 && Number.isFinite(e20[i - 5]) ? (e20[i] - e20[i - 5]) / den : 0;
    const dist = (close[i] - e20[i]) / den;
    const trend = clampN(vel1 * 36 + vel2 * 34 + dist * 9, -100, 100);

    // 2) directional pressure
    const dp = Number.isFinite(dip[i]) ? dip[i] : 0;
    const dm = Number.isFinite(dim[i]) ? dim[i] : 0;
    const adxV = Number.isFinite(adx[i]) ? adx[i] : 0;
    const diDen = Math.max(dp + dm, 1);
    const diBias = ((dp - dm) / diDen) * 100;
    const dirP = clampN(diBias * (0.45 + Math.min(adxV, 45) / 75), -100, 100);

    // 3) structure
    const struct = bosL ? 100 : bosS ? -100 : sweepL ? 82 : sweepS ? -82 : hhhl ? 38 : lhll ? -38 : 0;

    // 4) price action
    const signedBody = close[i] > open[i] ? body : close[i] < open[i] ? -body : 0;
    const closeBias = (clv - 0.5) * 2;
    const pa = clampN(signedBody * 68 + closeBias * 32, -100, 100);

    // 5) flow
    const eff = Math.abs(close[i] - open[i]) / rng;
    const flowDir = close[i] > open[i] ? 1 : close[i] < open[i] ? -1 : 0;
    const flow = flowDir * Math.min(100, Math.max(0, (rvol - 0.8) * 60 + eff * 40));

    // regime-aware weights
    const strongTrend = adxV >= 24 && Math.abs(trend) >= 32;
    const transition = !strongTrend && (adxV >= 16 || bosL || bosS || sweepL || sweepS);
    const w = {
      trend: strongTrend ? 0.31 : transition ? 0.16 : 0.1,
      dir: strongTrend ? 0.24 : transition ? 0.16 : 0.1,
      struct: strongTrend ? 0.2 : transition ? 0.3 : 0.22,
      pa: strongTrend ? 0.1 : transition ? 0.23 : 0.33,
      flow: 0.15,
    };
    wArr[i] = w;
    regimeArr[i] = strongTrend ? "Strong trend" : transition ? "Transition" : "Range";

    trendArr[i] = trend; dirArr[i] = dirP; structArr[i] = struct; paArr[i] = pa; flowArr[i] = flow;
    sampRaw[i] = trend * w.trend + dirP * w.dir + struct * w.struct + pa * w.pa + flow * w.flow;
  }

  // samp = ema(samp_raw, sm) — computed only over the defined tail
  const firstValid = sampRaw.findIndex((v) => Number.isFinite(v));
  if (firstValid < 0) return null;
  const rawTail = sampRaw.slice(firstValid).map((v) => (Number.isFinite(v) ? v : 0));
  const sampTail = emaSeriesFull(rawTail, sm);
  const samp = new Array<number>(n).fill(NaN);
  for (let i = 0; i < sampTail.length; i++) samp[firstValid + i] = sampTail[i];

  // direction = ema(samp, dirSm)
  const sampDefined = samp.map((v) => (Number.isFinite(v) ? v : 0));
  const dirFull = emaSeriesFull(sampDefined.slice(firstValid), dirSm);
  const direction = new Array<number>(n).fill(NaN);
  for (let i = 0; i < dirFull.length; i++) direction[firstValid + i] = dirFull[i];

  // persistence = |ema(sign(direction), 4)|
  const signSeries = direction.map((v) => (Number.isFinite(v) ? sign(v) : 0));
  const persistFull = emaSeriesFull(signSeries.slice(firstValid), 4);
  const persist = new Array<number>(n).fill(NaN);
  for (let i = 0; i < persistFull.length; i++) persist[firstValid + i] = persistFull[i];

  // acceleration = ema(clamp(accRaw*2.8), 3)
  const accRaw = new Array<number>(n).fill(0);
  for (let i = 2; i < n; i++) {
    if (!Number.isFinite(direction[i]) || !Number.isFinite(direction[i - 2])) continue;
    accRaw[i] = clampN(((direction[i] - direction[i - 2]) + (direction[i] - direction[i - 1]) * 0.6) * 2.8, -100, 100);
  }
  const accFull = emaSeriesFull(accRaw.slice(firstValid), 3);
  const acc = new Array<number>(n).fill(NaN);
  for (let i = 0; i < accFull.length; i++) acc[firstValid + i] = accFull[i];

  // ── Gates, quality and the state machine, walked bar by bar ──────
  let state = 0;
  let lastSignalBar: number | null = null;
  let lastSetupBar: number | null = null;
  let bosLBar: number | null = null;
  let bosSBar: number | null = null;
  const signals: SampSignal[] = [];

  // retained for the final bar's report
  let lastCtxL = false, lastCtxS = false, lastRoomOkL = false, lastChaseOkL = false;
  let lastLq = 0, lastSq = 0, lastWatchL = false, lastWatchS = false;

  for (let i = 1; i < n; i++) {
    if (!Number.isFinite(samp[i]) || !Number.isFinite(atr[i]) || !Number.isFinite(e50[i])) continue;
    const a = atr[i];
    const den = Math.max(a, mintick);
    const rng = Math.max(high[i] - low[i], mintick);
    const body = Math.abs(close[i] - open[i]) / rng;
    const clv = (close[i] - low[i]) / rng;
    const rvol = Number.isFinite(vma[i]) && vma[i] > 0 ? volume[i] / vma[i] : 1;
    const rsiV = Number.isFinite(rsi[i]) ? rsi[i] : 50;
    const dp = Number.isFinite(dip[i]) ? dip[i] : 0;
    const dm = Number.isFinite(dim[i]) ? dim[i] : 0;

    if (bosLArr[i]) bosLBar = i;
    if (bosSArr[i]) bosSBar = i;

    const sampSlope = i >= 2 && Number.isFinite(samp[i - 2]) ? samp[i] - samp[i - 2] : 0;
    const sampAccel = i >= 4 && Number.isFinite(samp[i - 4]) ? sampSlope - (samp[i - 2] - samp[i - 4]) : 0;

    // macro context
    const e20Slope = i >= 5 && Number.isFinite(e20[i - 5]) ? (e20[i] - e20[i - 5]) / den : 0;
    const e50Slope = i >= 8 && Number.isFinite(e50[i - 8]) ? (e50[i] - e50[i - 8]) / den : 0;
    const macroL = close[i] > e50[i] && e20Slope > 0 && e50Slope >= -0.05 && dp > dm;
    const macroS = close[i] < e50[i] && e20Slope < 0 && e50Slope <= 0.05 && dm > dp;
    const has200 = Number.isFinite(e200[i]);
    const ultraL = macroL && e20[i] > e50[i] && has200 && e50[i] > e200[i];
    const ultraS = macroS && e20[i] < e50[i] && has200 && e50[i] < e200[i];
    const ctxL = profile === "Responsive" ? close[i] > e20[i] && dp >= dm : profile === "Ultra" ? ultraL : macroL;
    const ctxS = profile === "Responsive" ? close[i] < e20[i] && dm >= dp : profile === "Ultra" ? ultraS : macroS;

    // location / chase
    const res = highestPrev(high, i, locLen);
    const sup = lowestPrev(low, i, locLen);
    const roomL = (res - close[i]) / den;
    const roomS = (close[i] - sup) / den;
    const ext = (close[i] - e20[i]) / den;
    const roomOkL = bosLArr[i] || !Number.isFinite(res) || roomL >= 0.85;
    const roomOkS = bosSArr[i] || !Number.isFinite(sup) || roomS >= 0.85;
    const chaseOkL = ext <= 1.35;
    const chaseOkS = ext >= -1.35;

    // triggers
    const pullL = ctxL && low[i] <= e20[i] + a * 0.2 && close[i] > e10[i] && close[i] > open[i] && clv > 0.58 && body >= 0.3;
    const pullS = ctxS && high[i] >= e20[i] - a * 0.2 && close[i] < e10[i] && close[i] < open[i] && clv < 0.42 && body >= 0.3;
    const revL = sweepLArr[i] && close[i] > e10[i] && sampSlope > 0;
    const revS = sweepSArr[i] && close[i] < e10[i] && sampSlope < 0;
    const hi = hiArr[i], lo = loArr[i];
    const retestL = bosLBar != null && i - bosLBar >= 1 && i - bosLBar <= 4 && Number.isFinite(hi) &&
      low[i] <= hi + a * 0.18 && close[i] > hi && close[i] > open[i];
    const retestS = bosSBar != null && i - bosSBar >= 1 && i - bosSBar <= 4 && Number.isFinite(lo) &&
      high[i] >= lo - a * 0.18 && close[i] < lo && close[i] < open[i];
    const breakL = requireRetest ? retestL : bosLArr[i];
    const breakS = requireRetest ? retestS : bosSArr[i];

    // quality scores
    let lq = 0;
    lq += ctxL ? 18 : 0;
    lq += samp[i] >= buyTh ? 18 : samp[i] >= 18 ? 8 : 0;
    lq += sampSlope > 1.0 ? 12 : 0;
    lq += sampAccel > 0 ? 6 : 0;
    lq += structArr[i] > 0 ? 14 : 0;
    lq += dirArr[i] > 8 ? 10 : 0;
    lq += trendArr[i] > 8 ? 8 : 0;
    lq += rvol >= 1.1 ? 6 : rvol >= 0.9 ? 3 : 0;
    lq += rsiV >= 48 && rsiV <= 68 ? 5 : 0;
    lq += roomOkL ? 7 : 0;
    lq += chaseOkL ? 6 : 0;
    lq -= rsiV > 74 ? 12 : 0;
    lq -= ext > 1.8 ? 15 : 0;
    lq -= close[i] < e20[i] ? 10 : 0;

    let sq = 0;
    sq += ctxS ? 18 : 0;
    sq += samp[i] <= sellTh ? 18 : samp[i] <= -18 ? 8 : 0;
    sq += sampSlope < -1.0 ? 12 : 0;
    sq += sampAccel < 0 ? 6 : 0;
    sq += structArr[i] < 0 ? 14 : 0;
    sq += dirArr[i] < -8 ? 10 : 0;
    sq += trendArr[i] < -8 ? 8 : 0;
    sq += rvol >= 1.1 ? 6 : rvol >= 0.9 ? 3 : 0;
    sq += rsiV <= 52 && rsiV >= 32 ? 5 : 0;
    sq += roomOkS ? 7 : 0;
    sq += chaseOkS ? 6 : 0;
    sq -= rsiV < 26 ? 12 : 0;
    sq -= ext < -1.8 ? 15 : 0;
    sq -= close[i] > e20[i] ? 10 : 0;
    lq = clampN(lq, 0, 100);
    sq = clampN(sq, 0, 100);

    // two-bar pressure persistence
    const prevSamp = Number.isFinite(samp[i - 1]) ? samp[i - 1] : 0;
    const pressL = samp[i] >= buyTh && prevSamp >= buyTh * 0.72 && sampSlope > 0;
    const pressS = samp[i] <= sellTh && prevSamp <= sellTh * 0.72 && sampSlope < 0;
    const triggerL = pullL || revL || breakL;
    const triggerS = pullS || revS || breakS;

    const watchL = ctxL && roomOkL && chaseOkL && samp[i] > 12 && sampSlope > 0 && lq >= scoreTh - 10;
    const watchS = ctxS && roomOkS && chaseOkS && samp[i] < -12 && sampSlope < 0 && sq >= scoreTh - 10;

    // state machine
    const cdok = lastSignalBar == null || i - lastSignalBar >= cd;
    const newSetupL = triggerL && (lastSetupBar == null || i - lastSetupBar > 2);
    const newSetupS = triggerS && (lastSetupBar == null || i - lastSetupBar > 2);
    const buy = cdok && state <= 0 && ctxL && roomOkL && chaseOkL && pressL && newSetupL && lq >= scoreTh;
    const sell = cdok && state >= 0 && ctxS && roomOkS && chaseOkS && pressS && newSetupS && sq >= scoreTh;

    if (buy) {
      state = 1; lastSignalBar = i; lastSetupBar = i;
      signals.push({
        index: i, date: candles[i].date, type: "BUY", price: close[i],
        quality: Math.round(lq), samp: Math.round(samp[i] * 10) / 10,
        trigger: pullL ? "pullback reclaim" : revL ? "sweep reversal" : "breakout" + (requireRetest ? " retest" : ""),
      });
    } else if (sell) {
      state = -1; lastSignalBar = i; lastSetupBar = i;
      signals.push({
        index: i, date: candles[i].date, type: "SELL", price: close[i],
        quality: Math.round(sq), samp: Math.round(samp[i] * 10) / 10,
        trigger: pullS ? "pullback rejection" : revS ? "sweep reversal" : "breakdown" + (requireRetest ? " retest" : ""),
      });
    }

    // re-arm only after pressure leaves the neutral band and price loses the anchor
    if (state === 1 && samp[i] < 5 && close[i] < e20[i]) state = 0;
    if (state === -1 && samp[i] > -5 && close[i] > e20[i]) state = 0;

    if (i === n - 1) {
      lastCtxL = ctxL; lastCtxS = ctxS; lastRoomOkL = roomOkL; lastChaseOkL = chaseOkL;
      lastLq = lq; lastSq = sq; lastWatchL = watchL; lastWatchS = watchS;
    }
  }

  const last = n - 1;
  const dirNow = Number.isFinite(direction[last]) ? direction[last] : 0;
  const adxNow = Number.isFinite(adx[last]) ? adx[last] : 0;
  const persistNow = Math.min(1, Math.abs(Number.isFinite(persist[last]) ? persist[last] : 0));
  const strengthAbs = Math.min(100, Math.abs(dirNow) * 0.78 + Math.min(35, adxNow) * 0.55 + persistNow * 10);
  const accNow = Number.isFinite(acc[last]) ? acc[last] : 0;
  const sampNow = Number.isFinite(samp[last]) ? samp[last] : 0;
  const sampSlopeNow = Number.isFinite(samp[last - 2]) ? sampNow - samp[last - 2] : 0;

  const dirPrev = Number.isFinite(direction[last - 1]) ? direction[last - 1] : dirNow;
  const accPrev = Number.isFinite(acc[last - 1]) ? acc[last - 1] : accNow;
  const earlyBull = dirNow < 20 && dirNow > dirPrev && accNow > 12 && accPrev <= 12 && structArr[last] >= 0 && close[last] >= e20[last];
  const earlyBear = dirNow > -20 && dirNow < dirPrev && accNow < -12 && accPrev >= -12 && structArr[last] <= 0 && close[last] <= e20[last];
  const strongBull = dirNow >= 45 && strengthAbs >= 55 && accNow > 0 && lastCtxL;
  const strongBear = dirNow <= -45 && strengthAbs >= 55 && accNow < 0 && lastCtxS;

  const lastSignal = signals.length ? signals[signals.length - 1] : null;

  return {
    profile,
    direction: Math.round(dirNow * 10) / 10,
    strength: Math.round((dirNow >= 0 ? strengthAbs : -strengthAbs) * 10) / 10,
    acceleration: Math.round(accNow * 10) / 10,
    samp: Math.round(sampNow * 10) / 10,
    sampSlope: Math.round(sampSlopeNow * 10) / 10,
    longQuality: Math.round(lastLq),
    shortQuality: Math.round(lastSq),
    components: {
      trend: Math.round((trendArr[last] || 0) * 10) / 10,
      direction: Math.round((dirArr[last] || 0) * 10) / 10,
      structure: structArr[last] || 0,
      priceAction: Math.round((paArr[last] || 0) * 10) / 10,
      flow: Math.round((flowArr[last] || 0) * 10) / 10,
    },
    weights: wArr[last] ?? { trend: 0.1, dir: 0.1, struct: 0.22, pa: 0.33, flow: 0.15 },
    regime: regimeArr[last],
    contextLong: lastCtxL,
    contextShort: lastCtxS,
    roomOkLong: lastRoomOkL,
    chaseOkLong: lastChaseOkL,
    watchLong: lastWatchL,
    watchShort: lastWatchS,
    earlyBull, earlyBear, strongBull, strongBear,
    state,
    signals,
    lastSignal,
    barsSinceLastSignal: lastSignal ? last - lastSignal.index : null,
    thresholds: { buy: buyTh, sell: sellTh, quality: scoreTh, cooldown: cd },
    bars: n,
  };
}
