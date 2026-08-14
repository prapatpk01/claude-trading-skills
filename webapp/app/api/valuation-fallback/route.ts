import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { fundamentalValuationFallback } from "@/lib/fundamentalValuationFallback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter((ticker) => /^[A-Z.\-]{1,10}$/.test(ticker))))
      .slice(0, 12)
  : [];

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = cleanTickers(body?.tickers);
    if (!tickers.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });

    const rows = await mapLimit(tickers, 3, async (ticker) => {
      try {
        const data = await getMarketData(ticker);
        const valuation = fundamentalValuationFallback(data);
        return {
          ticker,
          currentPrice: data.quote?.price ?? null,
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
