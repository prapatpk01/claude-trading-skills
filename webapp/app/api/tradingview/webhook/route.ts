import { NextRequest, NextResponse } from "next/server";
import { normalizeTradingViewAlert, type TradingViewAlertPayload } from "@/lib/integrations/tradingViewWebhook";
import { saveTradingViewIntelligence, type TradingViewIntelligenceEventRow } from "@/lib/integrations/tradingViewIntelligenceStore";
import { assessTradingViewEarnings } from "@/lib/research/earningsIntelligence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expectedSecret() {
  return String(process.env.TRADINGVIEW_WEBHOOK_SECRET ?? "").trim();
}

function intelligenceRow(alert: ReturnType<typeof normalizeTradingViewAlert>): TradingViewIntelligenceEventRow {
  return {
    ticker: alert.ticker,
    event_type: alert.eventType,
    timeframe: alert.timeframe || null,
    signal: alert.signal || null,
    strategy: alert.strategy || null,
    price: alert.price,
    event_timestamp: alert.timestamp,
    source: alert.source,
    eps_actual: alert.earnings.epsActual,
    eps_estimate: alert.earnings.epsEstimate,
    eps_surprise_pct: alert.earnings.epsSurprisePct,
    revenue_actual: alert.earnings.revenueActual,
    revenue_estimate: alert.earnings.revenueEstimate,
    revenue_surprise_pct: alert.earnings.revenueSurprisePct,
    next_earnings_at: alert.earnings.nextEarningsAt,
    fiscal_period: alert.earnings.fiscalPeriod,
    ai_summary: alert.earnings.aiSummary,
    guidance: alert.earnings.guidance,
    financials: alert.financials,
  };
}

export async function POST(req: NextRequest) {
  const configured = expectedSecret();
  if (!configured) {
    return NextResponse.json({ error: "TradingView webhook is not configured" }, { status: 503 });
  }

  let payload: TradingViewAlertPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Webhook body must be valid JSON" }, { status: 400 });
  }

  const supplied = String(req.headers.get("x-sentinel-webhook-secret") ?? payload.secret ?? "").trim();
  if (!supplied || supplied !== configured) {
    return NextResponse.json({ error: "Unauthorized webhook" }, { status: 401 });
  }

  const alert = normalizeTradingViewAlert(payload);
  if (!alert.ticker) {
    return NextResponse.json({ error: "ticker/symbol is required" }, { status: 422 });
  }

  const stored = await saveTradingViewIntelligence(alert);
  if (!stored.ok) {
    return NextResponse.json({
      error: "TradingView intelligence storage unavailable",
      detail: stored.error,
      execution: "BLOCKED_BY_POLICY",
      nextStage: "SENTINEL_SIGNAL_INTAKE_PENDING_STORAGE",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const earningsIntelligence = ["EARNINGS", "EARNINGS_FINANCIAL"].includes(alert.eventType)
    ? assessTradingViewEarnings(intelligenceRow(alert))
    : null;

  // Inbound-only bridge for research/monitoring. It intentionally does not
  // create orders or bypass Sentinel's Funding -> Risk -> CIO approval path.
  return NextResponse.json({
    ok: true,
    stored: true,
    eventId: stored.event?.id ?? null,
    received: alert,
    intelligence: earningsIntelligence,
    execution: "BLOCKED_BY_POLICY",
    nextStage: earningsIntelligence ? "INV_EARNINGS_REUNDERWRITE" : "SENTINEL_SIGNAL_INTAKE",
  }, { headers: { "Cache-Control": "no-store" } });
}
