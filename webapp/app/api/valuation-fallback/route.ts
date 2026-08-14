import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { fetchDividends } from "@/lib/dividends";
import { fundamentalValuationFallback } from "@/lib/fundamentalValuationFallback";
import { assessValuation } from "@/lib/team/positionValuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter((ticker) => /^[A-Z.\-]{1,10}$/.test(ticker))))
      .slice(0, 12)
  : [];

const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) break;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}

function portfolioValuation(data: Awaited<ReturnType<typeof getMarketData>>, dividends: Awaited<ReturnType<typeof fetchDividends>>["events"]) {
  const price = finite(data.quote?.price) ?? finite(data.candles.at(-1)?.close);
  if (price == null || price <= 0) return null;

  const read = assessValuation({
    candles: data.candles,
    price,
    annualEps: data.annualEps,
    epsTTM: finite(data.overview?.eps),
    dividends,
  });
  if (read.fairValue == null || read.fairValue <= 0) return null;

  const nonTrendAnchors = read.anchors.filter((anchor) => anchor.method !== "Trend regression");
  const onlyYahooTrend = read.anchors.length > 0 && nonTrendAnchors.length === 0;
  const band = Math.max(8, finite(read.fairBandPct) ?? 12) / 100;
  const targetPrice = round2(read.fairValue);
  return {
    targetPrice,
    bearPrice: round2(targetPrice * (1 - band)),
    bullPrice: round2(targetPrice * (1 + band)),
    upsidePct: round2((targetPrice / price - 1) * 100),
    confidence: String(read.confidence ?? "low").toUpperCase(),
    anchors: read.anchors.map((anchor) => ({
      label: anchor.method,
      target: round2(anchor.fairValue),
      weight: anchor.weight,
      detail: anchor.detail,
    })),
    source: onlyYahooTrend ? "YAHOO_TREND_FALLBACK" : "THOMAS_PORTFOLIO_MULTI_ANCHOR",
    method: onlyYahooTrend
      ? `Yahoo Finance price-history fallback: ${read.note} This is a low-order valuation anchor used only after the full research/fundamental path could not establish fair value; it is not a spot-price target.`
      : `Thomas institutional multi-anchor valuation: ${read.note}`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = cleanTickers(body?.tickers);
    if (!tickers.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });

    const rows = await mapLimit(tickers, 3, async (ticker) => {
      try {
        const [data, dividendPack] = await Promise.all([
          getMarketData(ticker),
          fetchDividends(ticker, 5).catch(() => ({ events: [], price: null })),
        ]);
        const institutional = portfolioValuation(data, dividendPack.events);
        const filing = fundamentalValuationFallback(data);
        const institutionalUsesFundamentals = institutional?.source === "THOMAS_PORTFOLIO_MULTI_ANCHOR";
        const valuation = institutionalUsesFundamentals
          ? institutional
          : filing
            ? { ...filing, source: "THOMAS_FUNDAMENTAL_RANGE" }
            : institutional;

        return {
          ticker,
          currentPrice: data.quote?.price ?? data.candles.at(-1)?.close ?? null,
          valuation,
          sources: data.sources,
          warnings: data.warnings,
        };
      } catch (error: any) {
        return { ticker, currentPrice: null, valuation: null, sources: [], warnings: [error?.message ?? "valuation fallback failed"] };
      }
    });

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Valuation fallback failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
