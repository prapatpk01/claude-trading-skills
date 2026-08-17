import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { governThomasSnapshot, resolveThomasValuationForMarketData } from "@/lib/thomasValuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter((ticker) => /^[A-Z.\-]{1,10}$/.test(ticker))))
      .slice(0, 12)
  : [];

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = cleanTickers(body?.tickers);
    if (!tickers.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });

    const rows = await mapLimit(tickers, 3, async (ticker) => {
      try {
        const data = await getMarketData(ticker);
        const currentPrice = finite(data.quote?.price) ?? finite(data.candles.at(-1)?.close);
        const snapshot = await resolveThomasValuationForMarketData(data);
        const governed = governThomasSnapshot(snapshot, currentPrice);
        const valuation = governed.valid ? {
          targetPrice: governed.fairValue,
          bearPrice: governed.bearValue,
          bullPrice: governed.bullValue,
          upsidePct: governed.valuationGapPct,
          confidence: snapshot.confidence,
          decisionReady: governed.decisionReady,
          anchors: snapshot.anchors.map(anchor => ({ label: anchor.method, target: anchor.fairValue, weight: anchor.weight, detail: anchor.detail })),
          source: snapshot.source,
          modelRoute: snapshot.modelRoute,
          asOf: snapshot.asOf,
          expiresAt: snapshot.expiresAt,
          method: governed.reason,
        } : null;

        return {
          ticker,
          currentPrice,
          valuation,
          analystConsensus: null,
          sources: data.sources,
          warnings: [...data.warnings, ...snapshot.warnings, ...(!governed.valid ? [governed.reason] : [])],
        };
      } catch (error: any) {
        return { ticker, currentPrice: null, valuation: null, analystConsensus: null, sources: [], warnings: [error?.message ?? "valuation fallback failed"] };
      }
    });

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Valuation fallback failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
