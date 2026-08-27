import YahooFinance from "yahoo-finance2";

export type YahooChartSeries = {
  closes: number[];
  volumes: number[];
};

export type YahooFinance2FallbackResult = {
  provider: string;
  requested: number;
  attempted: number;
  rescued: number;
  capped: boolean;
  series: Map<string, YahooChartSeries>;
  warnings: string[];
};

const MIN_BARS = 55;
const DEFAULT_CONCURRENCY = 12;
const DEFAULT_MAX_SYMBOLS = 600;
const REQUEST_TIMEOUT_MS = 8_000;
const LOOKBACK_DAYS = 230;

const yahooFinance = new YahooFinance();

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * yahoo-finance2 is the Node-side equivalent of the Python yfinance role in
 * Sentinel's production app. Both ultimately read Yahoo Finance endpoints, but
 * this path uses the library's per-symbol chart module instead of Spark.
 *
 * Keeping this parser pure lets CI prove the fallback mapping without making a
 * network call.
 */
export function parseYahooFinance2Chart(result: any): YahooChartSeries | null {
  const quotes = Array.isArray(result?.quotes) ? result.quotes : [];
  const closes: number[] = [];
  const volumes: number[] = [];
  for (const quote of quotes) {
    const close = finite(quote?.close);
    if (close == null || close <= 0) continue;
    closes.push(close);
    const volume = finite(quote?.volume);
    volumes.push(volume != null && volume >= 0 ? volume : 0);
  }
  return closes.length >= MIN_BARS ? { closes, volumes } : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}

export async function fetchYahooFinance2Fallback(
  tickers: string[],
  options: { maxSymbols?: number; concurrency?: number } = {},
): Promise<YahooFinance2FallbackResult> {
  const normalized = Array.from(new Set(tickers.map(ticker => String(ticker).trim().toUpperCase()).filter(Boolean)));
  const maxSymbols = Math.max(1, options.maxSymbols ?? DEFAULT_MAX_SYMBOLS);
  const concurrency = Math.max(1, Math.min(24, options.concurrency ?? DEFAULT_CONCURRENCY));
  const selected = normalized.slice(0, maxSymbols);
  const capped = selected.length < normalized.length;
  const period1 = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const period2 = new Date();
  const warnings: string[] = [];

  const outcomes = await mapLimit(selected, concurrency, async ticker => {
    try {
      const result = await yahooFinance.chart(
        ticker,
        {
          period1,
          period2,
          interval: "1d",
          includePrePost: false,
          events: "history",
        },
        {
          fetchOptions: { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        },
      );
      const series = parseYahooFinance2Chart(result);
      if (!series) return { ticker, series: null as YahooChartSeries | null, warning: `${ticker}: yahoo-finance2 chart returned fewer than ${MIN_BARS} usable bars` };
      return { ticker, series, warning: null as string | null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "yahoo-finance2 chart failed";
      return { ticker, series: null as YahooChartSeries | null, warning: `${ticker}: ${message}` };
    }
  });

  const series = new Map<string, YahooChartSeries>();
  for (const outcome of outcomes) {
    if (outcome.series) series.set(outcome.ticker, outcome.series);
    else if (outcome.warning) warnings.push(outcome.warning);
  }
  if (capped) warnings.unshift(`yahoo-finance2 rescue capped at ${selected.length}/${normalized.length} missing symbols to protect Railway latency and Yahoo rate limits`);

  return {
    provider: "yahoo-finance2 v4 chart rescue · per-symbol Yahoo Finance chart endpoint",
    requested: normalized.length,
    attempted: selected.length,
    rescued: series.size,
    capped,
    series,
    warnings: Array.from(new Set(warnings)).slice(0, 12),
  };
}
