import { NextRequest, NextResponse } from "next/server";
import { getLightQuote } from "@/lib/marketData";
import { getPriceMoves } from "@/lib/priceMoves";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Run tasks with bounded concurrency — fast, without hammering the provider. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers") ?? req.nextUrl.searchParams.get("ticker") ?? "";
  const tickers = Array.from(
    new Set(
      raw
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter((t) => /^[A-Z.\-]{1,10}$/.test(t))
    )
  ).slice(0, 30);
  if (tickers.length === 0) return NextResponse.json({ quotes: {}, failed: [] });

  // `moves=0` keeps the old, cheaper shape for callers that only want a price:
  // the extended-hours read costs a second request per symbol.
  const wantMoves = req.nextUrl.searchParams.get("moves") !== "0";

  const settled = await mapLimit(tickers, 6, async (t) => {
    try {
      if (!wantMoves) {
        const q = await getLightQuote(t);
        return q ? { t, v: { price: q.price, changePercent: q.changePercent, asOf: q.asOf } } : { t, v: null };
      }
      // One pass covers the price and all three windows. The daily series is
      // the same data getLightQuote would have fetched, so this is not an
      // extra round trip for the price — only for extended hours.
      const m = await getPriceMoves(t);
      if (m.price == null) {
        // Last resort: the authenticated quote endpoint, in case this host can
        // reach it even though the chart series came back empty.
        const q = await getLightQuote(t).catch(() => null);
        return q ? { t, v: { price: q.price, changePercent: q.changePercent, asOf: q.asOf } } : { t, v: null };
      }
      return {
        t,
        v: {
          price: m.price,
          // Kept under its original name so existing callers do not break.
          changePercent: m.changePct1D ?? 0,
          changePct1D: m.changePct1D,
          changePct1W: m.changePct1W,
          weekSessions: m.weekSessions,
          prevClose: m.prevClose,
          extended: m.extended,
          asOf: m.asOf ?? undefined,
          priceSource: m.priceSource,
          stale: m.stale,
          staleReason: m.staleReason,
          ageDays: m.ageDays,
        },
      };
    } catch {
      return { t, v: null };
    }
  });

  const quotes: Record<string, any> = {};
  const failed: string[] = [];
  for (const { t, v } of settled) {
    quotes[t] = v;
    if (!v) failed.push(t);
  }
  // `failed` lets the UI say why a price is blank instead of silently showing a dash
  return NextResponse.json({ quotes, failed });
}
