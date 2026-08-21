import { NextRequest, NextResponse } from "next/server";
import { normalizeTradingViewAlert, type TradingViewAlertPayload } from "@/lib/integrations/tradingViewWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expectedSecret() {
  return String(process.env.TRADINGVIEW_WEBHOOK_SECRET ?? "").trim();
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

  // Inbound-only bridge for research/monitoring. It intentionally does not
  // create orders or bypass Sentinel's Funding -> Risk -> CIO approval path.
  return NextResponse.json({
    ok: true,
    received: alert,
    execution: "BLOCKED_BY_POLICY",
    nextStage: "SENTINEL_SIGNAL_INTAKE",
  }, { headers: { "Cache-Control": "no-store" } });
}
