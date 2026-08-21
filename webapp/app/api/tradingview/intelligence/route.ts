import { NextRequest, NextResponse } from "next/server";
import { getTradingViewIntelligence } from "@/lib/integrations/tradingViewIntelligenceStore";
import { assessTradingViewEarnings } from "@/lib/research/earningsIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticker = String(req.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const limit = Math.max(1, Math.min(25, Number(req.nextUrl.searchParams.get("limit") ?? 10) || 10));
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Valid ticker is required" }, { status: 400 });
  }

  const events = await getTradingViewIntelligence(ticker, limit);
  const latestEarnings = events.find(row => ["EARNINGS", "EARNINGS_FINANCIAL"].includes(row.event_type)) ?? null;
  return NextResponse.json({
    ticker,
    events,
    earningsIntelligence: latestEarnings ? assessTradingViewEarnings(latestEarnings) : assessTradingViewEarnings(null),
    governance: {
      source: "TRADINGVIEW",
      aiSummaryIsProviderTextOnly: true,
      automaticTrading: false,
      decisionPath: "Research -> Forecast -> Funding -> Risk -> CIO",
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
