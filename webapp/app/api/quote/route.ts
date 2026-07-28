import { NextRequest, NextResponse } from "next/server";
import { getLightQuote } from "@/lib/marketData";

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

  const settled = await mapLimit(tickers, 6, async (t) => {
    try {
      const q = await getLightQuote(t);
      return q ? { t, v: { price: q.price, changePercent: q.changePercent, asOf: q.asOf } } : { t, v: null };
    } catch {
      return { t, v: null };
    }
  });

  const quotes: Record<string, { price: number; changePercent: number; asOf?: string } | null> = {};
  const failed: string[] = [];
  for (const { t, v } of settled) {
    quotes[t] = v;
    if (!v) failed.push(t);
  }
  // `failed` lets the UI say why a price is blank instead of silently showing a dash
  return NextResponse.json({ quotes, failed });
}
