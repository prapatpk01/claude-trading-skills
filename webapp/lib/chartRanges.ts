export type ChartRange = "1M" | "3M" | "6M" | "YTD" | "1Y";

export const CHART_RANGES: ChartRange[] = ["1M", "3M", "6M", "YTD", "1Y"];

export const RANGE_SESSIONS: Record<Exclude<ChartRange, "YTD">, number> = {
  "1M": 21,
  "3M": 63,
  "6M": 126,
  "1Y": 252,
};
