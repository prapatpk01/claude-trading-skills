import { computePortfolioTechnicalOverlay } from "./portfolioTechnicalOverlay";
import type { Candle, Quote } from "./types";

export type ChartRange = "1M" | "3M" | "6M" | "YTD" | "1Y";
export type MarketDataStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

const TICKER_PATTERN = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function cleanMarketTicker(value: unknown): string | null {
  const ticker = String(value ?? "").trim().toUpperCase();
  return TICKER_PATTERN.test(ticker) ? ticker : null;
}

export function uniqueMarketTickers(values: Iterable<unknown>, limit = 30): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ticker = cleanMarketTicker(value);
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    output.push(ticker);
    if (output.length >= limit) break;
  }
  return output;
}

const pct = (from: number | null, to: number | null) => from != null && to != null && from > 0 ? ((to - from) / from) * 100 : null;

function sample<T>(rows: T[], max = 32): T[] {
  if (rows.length <= max) return rows;
  const step = (rows.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, index) => rows[Math.round(index * step)]);
}

function rangePayload(rows: Array<{ date: string; close: number }>, price: number | null) {
  const series = sample(rows.filter(row => Number.isFinite(row.close) && row.close > 0), 36);
  return { series, changePct: pct(series[0]?.close ?? null, price) };
}

export function buildHoldingMarketItem(
  candles: Candle[],
  quote: Quote | null,
  source: string | null,
  warnings: string[] = [],
) {
  const clean = candles.filter(candle => Number.isFinite(candle.close) && candle.close > 0).sort((left, right) => left.date.localeCompare(right.date));
  const price = quote?.price ?? clean.at(-1)?.close ?? null;
  const closes = clean.map(candle => candle.close);
  const weekStart = closes.length >= 6 ? closes.at(-6)! : closes.length >= 2 ? closes[0] : null;
  const nowYear = new Date().getUTCFullYear();
  let ytd = clean.filter(candle => new Date(`${candle.date}T00:00:00Z`).getUTCFullYear() === nowYear);
  if (!ytd.length) ytd = clean.slice(-Math.min(120, clean.length));
  const asSeries = (rows: Candle[]) => rows.map(candle => ({ date: candle.date, close: candle.close }));
  const chartRanges: Record<ChartRange, { series: Array<{ date: string; close: number }>; changePct: number | null }> = {
    "1M": rangePayload(asSeries(clean.slice(-Math.min(21, clean.length))), price),
    "3M": rangePayload(asSeries(clean.slice(-Math.min(63, clean.length))), price),
    "6M": rangePayload(asSeries(clean.slice(-Math.min(126, clean.length))), price),
    "YTD": rangePayload(asSeries(ytd), price),
    "1Y": rangePayload(asSeries(clean.slice(-Math.min(252, clean.length))), price),
  };
  const year = clean.slice(-Math.min(252, clean.length));
  const low52 = year.length ? Math.min(...year.map(candle => candle.low)) : null;
  const high52 = year.length ? Math.max(...year.map(candle => candle.high)) : null;
  const pos52 = price != null && low52 != null && high52 != null && high52 > low52
    ? Math.max(0, Math.min(100, (price - low52) / (high52 - low52) * 100))
    : null;
  const technicalOverlay = computePortfolioTechnicalOverlay(clean);
  const status: MarketDataStatus = technicalOverlay ? "COMPLETE" : price != null || clean.length ? "PARTIAL" : "UNAVAILABLE";
  const reason = status === "COMPLETE"
    ? `Technical overlay calculated from ${clean.length} trading days.`
    : clean.length > 0
      ? `Only ${clean.length}/220 trading days are available; price and chart can display but the technical overlay is withheld.`
      : price != null
        ? "Current price is available, but price history is unavailable; the technical overlay is withheld."
        : warnings[0] ?? "The market-data provider returned no price or history.";

  return {
    price,
    change1w: pct(weekStart, price),
    ytdChangePct: chartRanges.YTD.changePct,
    ytdSeries: chartRanges.YTD.series,
    chartRanges,
    low52,
    high52,
    pos52,
    technicalOverlay,
    asOf: quote?.asOf ?? clean.at(-1)?.date ?? null,
    dataQuality: {
      status,
      source,
      historyBars: clean.length,
      requiredBars: 220,
      reason,
      warnings,
    },
  };
}
