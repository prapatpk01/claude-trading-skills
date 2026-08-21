import { getSupabaseAdmin } from "@/lib/supabase";
import type { NormalizedTradingViewAlert } from "@/lib/integrations/tradingViewWebhook";

export type TradingViewIntelligenceEventRow = {
  id?: string;
  ticker: string;
  event_type: "TECHNICAL" | "EARNINGS" | "FINANCIAL" | "EARNINGS_FINANCIAL";
  timeframe: string | null;
  signal: string | null;
  strategy: string | null;
  price: number | null;
  event_timestamp: string | null;
  source: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  eps_surprise_pct: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  revenue_surprise_pct: number | null;
  next_earnings_at: string | null;
  fiscal_period: string | null;
  ai_summary: string | null;
  guidance: string | null;
  financials: Record<string, unknown>;
  raw_payload?: Record<string, unknown>;
  received_at?: string;
};

function toRow(alert: NormalizedTradingViewAlert): TradingViewIntelligenceEventRow {
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
    raw_payload: alert.raw,
  };
}

export async function saveTradingViewIntelligence(alert: NormalizedTradingViewAlert) {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false as const, error: "Supabase admin is not configured" };
  const { data, error } = await sb
    .from("tradingview_intelligence_events")
    .insert(toRow(alert))
    .select("id,ticker,event_type,received_at")
    .single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, event: data };
}

export async function getTradingViewIntelligence(ticker: string, limit = 10): Promise<TradingViewIntelligenceEventRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const normalized = String(ticker ?? "").trim().toUpperCase();
  if (!normalized) return [];
  const { data, error } = await sb
    .from("tradingview_intelligence_events")
    .select("id,ticker,event_type,timeframe,signal,strategy,price,event_timestamp,source,eps_actual,eps_estimate,eps_surprise_pct,revenue_actual,revenue_estimate,revenue_surprise_pct,next_earnings_at,fiscal_period,ai_summary,guidance,financials,received_at")
    .eq("ticker", normalized)
    .order("received_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, Math.round(limit || 10))));
  if (error) return [];
  return (data ?? []) as TradingViewIntelligenceEventRow[];
}

export async function getLatestTradingViewEarnings(ticker: string, freshnessDays = 45): Promise<TradingViewIntelligenceEventRow | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const normalized = String(ticker ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const cutoff = new Date(Date.now() - Math.max(1, freshnessDays) * 86_400_000).toISOString();
  const { data, error } = await sb
    .from("tradingview_intelligence_events")
    .select("id,ticker,event_type,timeframe,signal,strategy,price,event_timestamp,source,eps_actual,eps_estimate,eps_surprise_pct,revenue_actual,revenue_estimate,revenue_surprise_pct,next_earnings_at,fiscal_period,ai_summary,guidance,financials,received_at")
    .eq("ticker", normalized)
    .in("event_type", ["EARNINGS", "EARNINGS_FINANCIAL"])
    .gte("received_at", cutoff)
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as TradingViewIntelligenceEventRow;
}
