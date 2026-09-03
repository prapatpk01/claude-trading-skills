import type { TechnicalBuyGateInputV40 } from "../strategy/organizationStrategyV40";

export type DailyTechnicalSeriesV40 = {
  closes: number[];
  highs: number[];
  lows: number[];
  timestamps: number[];
};

function ema(values: number[], length: number): number | null {
  if (values.length < length || values.some(value => !Number.isFinite(value))) return null;
  const alpha = 2 / (length + 1);
  let current = values[0];
  for (let index = 1; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
  }
  return current;
}

function adx(highs: number[], lows: number[], closes: number[], length = 14): number | null {
  if (closes.length < length * 2 + 1 || highs.length !== closes.length || lows.length !== closes.length) return null;
  if ([...highs, ...lows, ...closes].some(value => !Number.isFinite(value))) return null;

  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    tr.push(Math.max(
      highs[index] - lows[index],
      Math.abs(highs[index] - closes[index - 1]),
      Math.abs(lows[index] - closes[index - 1]),
    ));
    const up = highs[index] - highs[index - 1];
    const down = lows[index - 1] - lows[index];
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
  }

  let smoothTr = tr.slice(0, length).reduce((sum, value) => sum + value, 0);
  let smoothPlus = plusDm.slice(0, length).reduce((sum, value) => sum + value, 0);
  let smoothMinus = minusDm.slice(0, length).reduce((sum, value) => sum + value, 0);
  const dx: number[] = [];
  for (let index = length; index < tr.length; index += 1) {
    smoothTr = smoothTr - smoothTr / length + tr[index];
    smoothPlus = smoothPlus - smoothPlus / length + plusDm[index];
    smoothMinus = smoothMinus - smoothMinus / length + minusDm[index];
    if (smoothTr <= 0) continue;
    const plusDi = 100 * smoothPlus / smoothTr;
    const minusDi = 100 * smoothMinus / smoothTr;
    const denominator = plusDi + minusDi;
    if (denominator > 0) dx.push(100 * Math.abs(plusDi - minusDi) / denominator);
  }
  if (dx.length < length) return null;
  let value = dx.slice(0, length).reduce((sum, item) => sum + item, 0) / length;
  for (let index = length; index < dx.length; index += 1) {
    value = (value * (length - 1) + dx[index]) / length;
  }
  return value;
}

export function technicalSnapshotFromSeriesV40(series: DailyTechnicalSeriesV40): TechnicalBuyGateInputV40 {
  const closes = series.closes.map(Number);
  const macdSeries: number[] = [];
  for (let end = 26; end <= closes.length; end += 1) {
    const prefix = closes.slice(0, end);
    const fast = ema(prefix, 12);
    const slow = ema(prefix, 26);
    if (fast != null && slow != null) macdSeries.push(fast - slow);
  }
  const macd = macdSeries.at(-1) ?? null;
  const macdSignal = ema(macdSeries, 9);
  const latest = series.timestamps.at(-1);
  return {
    asOf: Number.isFinite(latest) ? new Date(latest!).toISOString() : null,
    maxAgeMinutes: 96 * 60,
    ema8: ema(closes, 8),
    ema13: ema(closes, 13),
    ema100: ema(closes, 100),
    ema200: ema(closes, 200),
    adx: adx(series.highs, series.lows, closes),
    macd,
    macdSignal,
    macdHistogram: macd != null && macdSignal != null ? macd - macdSignal : null,
  };
}
