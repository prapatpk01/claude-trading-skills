import { dailyCandles } from "./marketData";
import type { Candle } from "./types";

export type MarketTapeSnapshot = {
  score: number;
  label: "RISK ON" | "SELECTIVE" | "DEFENSIVE" | "RISK OFF";
  labelTh: string;
  asOf: string;
  positiveBreadth: number;
  trendBreadth: number;
  sectorCount: number;
  averageSectorScore: number;
  spy1m: number | null;
  spy3m: number | null;
  warnings: string[];
  methodology: string;
};

const SECTOR_ETFS = ["XLK", "XLC", "XLY", "XLF", "XLI", "XLE", "XLV", "XLP", "XLU", "XLRE", "XLB"] as const;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

const ret = (candles: Candle[], periods: number): number | null => {
  if (candles.length <= periods) return null;
  const start = candles[candles.length - 1 - periods]?.close;
  const end = candles.at(-1)?.close;
  return start && end ? (end / start - 1) * 100 : null;
};

const sma = (candles: Candle[], periods: number): number | null => {
  const values = candles.slice(-periods).map(candle => candle.close).filter(Number.isFinite);
  return values.length === periods ? values.reduce((sum, value) => sum + value, 0) / periods : null;
};

function scoreSector(candles: Candle[], spy: Candle[]) {
  const return1w = ret(candles, 5);
  const return1m = ret(candles, 21);
  const return3m = ret(candles, 63);
  const spy1m = ret(spy, 21);
  const spy3m = ret(spy, 63);
  const relative1m = return1m == null || spy1m == null ? null : return1m - spy1m;
  const relative3m = return3m == null || spy3m == null ? null : return3m - spy3m;
  const close = candles.at(-1)?.close ?? null;
  const average20 = sma(candles, 20);
  const average50 = sma(candles, 50);
  const above20d = close == null || average20 == null ? null : close > average20;
  const above50d = close == null || average50 == null ? null : close > average50;
  const acceleration = return1w == null || return1m == null ? null : return1w - return1m / 4.2;
  const score = clamp(
    50
    + (relative1m ?? 0) * 2.2
    + (relative3m ?? 0) * 0.8
    + (return1w ?? 0) * 1.3
    + (acceleration ?? 0) * 1.1
    + (above20d === true ? 7 : above20d === false ? -7 : 0)
    + (above50d === true ? 8 : above50d === false ? -8 : 0),
  );
  return { score, relative1m, above20d, above50d };
}

/**
 * Lightweight tape engine used by capital controls.
 *
 * It intentionally has no dependency on Research OS, the three-index universe,
 * Factor Discovery or full stock analysis. Research may enrich this same tape
 * read later, but Cash Buffer and CIO sizing never import the research graph.
 */
export async function buildMarketTapeSnapshot(): Promise<MarketTapeSnapshot> {
  const warnings: string[] = [];
  const symbols = ["SPY", ...SECTOR_ETFS];
  const entries = await Promise.all(symbols.map(async symbol => {
    const candles = await dailyCandles(symbol, 150).catch((error: any) => {
      warnings.push(`${symbol}: ${error?.message ?? "price history unavailable"}`);
      return [] as Candle[];
    });
    return [symbol, candles] as const;
  }));

  const histories = new Map(entries);
  const spy = histories.get("SPY") ?? [];
  const sectors = SECTOR_ETFS.map(etf => scoreSector(histories.get(etf) ?? [], spy));
  const spy1m = ret(spy, 21);
  const spy3m = ret(spy, 63);
  const positiveBreadth = sectors.filter(row => (row.relative1m ?? -Infinity) > 0 && row.above50d === true).length;
  const trendBreadth = sectors.filter(row => row.above20d === true).length;
  const averageSectorScore = average(sectors.map(row => row.score)) ?? 50;
  const score = Math.round(clamp(
    42
    + (spy1m ?? 0) * 1.8
    + (spy3m ?? 0) * 0.65
    + positiveBreadth * 2.2
    + trendBreadth * 1.1
    + (averageSectorScore - 50) * 0.35,
  ));
  const label = score >= 70 ? "RISK ON" : score >= 52 ? "SELECTIVE" : score >= 36 ? "DEFENSIVE" : "RISK OFF";
  const labelTh = label === "RISK ON" ? "รับความเสี่ยง" : label === "SELECTIVE" ? "เลือกกลุ่ม/เลือกหุ้น" : label === "DEFENSIVE" ? "เน้นป้องกัน" : "ลดความเสี่ยง";

  return {
    score,
    label,
    labelTh,
    asOf: new Date().toISOString(),
    positiveBreadth,
    trendBreadth,
    sectorCount: sectors.length,
    averageSectorScore: Math.round(averageSectorScore * 10) / 10,
    spy1m,
    spy3m,
    warnings,
    methodology: "SPY plus the 11 GICS sector ETFs; same 1-week acceleration, 1/3-month relative strength and 20/50-day trend formula used by Research tape sentiment, without loading the Research OS or index universe.",
  };
}
