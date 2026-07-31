import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { fetchDividends, inferFrequency } from "@/lib/dividends";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Fact = {
  ticker: string;
  growthPct: number | null;
  growthSource: string | null;
  yieldPct: number | null;
  yieldSource: string | null;
  sector: string | null;
  industry: string | null;
  warnings: string[];
};

const finite = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const pct = (v: number | null) => v == null ? null : Math.abs(v) < 1 ? v * 100 : v;

function latestQuarterGrowth(data: Awaited<ReturnType<typeof getMarketData>>): number | null {
  for (const q of data.quarters ?? []) {
    const g = finite(q.revenueYoY);
    if (g != null) return pct(g);
  }
  return null;
}

function annualRevenueCagr(data: Awaited<ReturnType<typeof getMarketData>>): number | null {
  const rows = (data.financials?.income ?? [])
    .map(r => ({ date: String(r.fiscalDate ?? ""), revenue: finite(r.totalRevenue) }))
    .filter((r): r is { date: string; revenue: number } => r.revenue != null && r.revenue > 0)
    .sort((a,b) => b.date.localeCompare(a.date));
  if (rows.length < 2) return null;
  const newest = rows[0];
  const oldest = rows[Math.min(4, rows.length - 1)];
  const years = Math.max(1, Math.min(4, Math.abs(new Date(newest.date).getUTCFullYear() - new Date(oldest.date).getUTCFullYear())));
  if (!(oldest.revenue > 0) || !(newest.revenue > 0)) return null;
  return (Math.pow(newest.revenue / oldest.revenue, 1 / years) - 1) * 100;
}

async function dividendYield(ticker: string, fallbackPrice: number | null, overviewYield: number | null) {
  try {
    const { events, price } = await fetchDividends(ticker, 3);
    const currentPrice = fallbackPrice && fallbackPrice > 0 ? fallbackPrice : price;
    if (events.length && currentPrice && currentPrice > 0) {
      const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0,10);
      const ttm = events.filter(e => e.date >= oneYearAgo).reduce((s,e) => s + e.amount, 0);
      const { perYear } = inferFrequency(events);
      const last = events.at(-1);
      const forward = perYear && last ? last.amount * perYear : ttm;
      if (forward > 0) return { value: forward / currentPrice * 100, source: perYear && last ? "dividend history · forward cadence" : "dividend history · trailing 12M" };
    }
  } catch { /* fallback below */ }
  if (overviewYield != null && overviewYield > 0) return { value: pct(overviewYield), source: "company overview" };
  return { value: null, source: null };
}

async function buildFact(ticker: string, suppliedPrice: number | null): Promise<Fact> {
  const warnings: string[] = [];
  try {
    const data = await getMarketData(ticker);
    const qGrowth = latestQuarterGrowth(data);
    const cagr = annualRevenueCagr(data);
    const growthPct = qGrowth ?? cagr;
    const growthSource = qGrowth != null ? "latest reported quarter YoY revenue" : cagr != null ? "annual revenue CAGR" : null;
    const y = await dividendYield(ticker, suppliedPrice ?? data.quote?.price ?? null, finite(data.overview?.dividendYield));
    return {
      ticker,
      growthPct,
      growthSource,
      yieldPct: y.value,
      yieldSource: y.source,
      sector: data.overview?.sector ?? null,
      industry: data.overview?.industry ?? null,
      warnings: [...(data.warnings ?? []), ...warnings],
    };
  } catch (e: any) {
    // Dividend history can still work for ETFs or symbols whose fundamental
    // endpoints fail, so try it independently before giving up.
    const y = await dividendYield(ticker, suppliedPrice, null);
    return { ticker, growthPct: null, growthSource: null, yieldPct: y.value, yieldSource: y.source, sector: null, industry: null, warnings: [e?.message ?? "market data unavailable"] };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const raw: string[] = Array.isArray(body?.tickers) ? body.tickers : [];
    const prices: Record<string, number> = body?.prices && typeof body.prices === "object" ? body.prices : {};
    const tickers = Array.from(new Set(raw.map(t => String(t).trim().toUpperCase()).filter(t => /^[A-Z.\-]{1,10}$/.test(t)))).slice(0, 50);
    const facts: Record<string, Fact> = {};
    const batchSize = 3;
    for (let i=0;i<tickers.length;i+=batchSize) {
      const batch = tickers.slice(i,i+batchSize);
      const rows = await Promise.all(batch.map(t => buildFact(t, finite(prices[t]))));
      rows.forEach(r => { facts[r.ticker] = r; });
    }
    return NextResponse.json({ facts, asOf: new Date().toISOString() });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? "Portfolio facts failed" }, { status: 500 });
  }
}
