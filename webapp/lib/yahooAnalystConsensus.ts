import YahooFinance from "yahoo-finance2";

const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

const finite = (value: unknown): number | null => {
  if (value == null) return null;
  const raw = typeof value === "object" && (value as any).raw !== undefined ? (value as any).raw : value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export type YahooAnalystConsensus = {
  ticker: string;
  targetMeanPrice: number;
  targetMedianPrice: number | null;
  targetLowPrice: number | null;
  targetHighPrice: number | null;
  analystCount: number | null;
  recommendationMean: number | null;
  recommendationKey: string | null;
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Yahoo analyst request exceeded ${ms}ms`)), ms)),
  ]);
}

/**
 * Best-effort Yahoo Finance analyst consensus fallback.
 *
 * This is deliberately separate from the normal Yahoo market-data path because
 * quoteSummary can be blocked intermittently on cloud hosts while the chart
 * endpoint remains reliable. A failure here must never break the portfolio
 * review; callers simply continue to the next fallback.
 *
 * The consensus target is third-party analyst evidence. It is never inferred
 * from spot and it is never represented as Sentinel's own intrinsic fair value.
 */
export async function fetchYahooAnalystConsensus(ticker: string): Promise<YahooAnalystConsensus | null> {
  const clean = String(ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(clean)) return null;

  try {
    const response: any = await withTimeout(
      yf.quoteSummary(clean, { modules: ["financialData"] } as any),
      5000,
    );
    const financial = response?.financialData ?? null;
    const mean = finite(financial?.targetMeanPrice);
    if (mean == null || mean <= 0) return null;

    return {
      ticker: clean,
      targetMeanPrice: mean,
      targetMedianPrice: finite(financial?.targetMedianPrice),
      targetLowPrice: finite(financial?.targetLowPrice),
      targetHighPrice: finite(financial?.targetHighPrice),
      analystCount: finite(financial?.numberOfAnalystOpinions),
      recommendationMean: finite(financial?.recommendationMean),
      recommendationKey: financial?.recommendationKey ? String(financial.recommendationKey) : null,
    };
  } catch {
    return null;
  }
}
