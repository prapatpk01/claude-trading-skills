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

function legacyTicker(ticker: string) {
  return `__TV_${String(ticker ?? "").trim().toUpperCase()}__`;
}

function mapLegacy(row: any): TradingViewIntelligenceEventRow | null {
  const intelligence = row?.audit?.tradingview_intelligence;
  if (!intelligence || typeof intelligence !== "object") return null;
  return {
    ...(intelligence as TradingViewIntelligenceEventRow),
    id: String(row?.id ?? ""),
    received_at: String((intelligence as any)?.received_at ?? row?.created_at ?? "") || undefined,
  };
}

async function saveLegacy(sb: ReturnType<typeof getSupabaseAdmin>, row: TradingViewIntelligenceEventRow) {
  if (!sb) return { ok: false as const, error: "Supabase admin is not configured" };
  const receivedAt = new Date().toISOString();
  const legacyRow = {
    ticker: legacyTicker(row.ticker),
    requested_action: "PORTFOLIO_REBALANCE",
    final_action: "MEETING_MEMORY",
    approved: false,
    conviction: 0,
    confidence: 0,
    proposed_weight_pct: 0,
    funding_source: "MULTI_SOURCE",
    evidence: [],
    votes: [],
    issues: [],
    dissent: [],
    portfolio_context: {},
    audit: { tradingview_intelligence: { ...row, received_at: receivedAt } },
    human_approved: false,
    execution_status: "PENDING",
  };
  const { data, error } = await sb.from("institutional_decisions").insert(legacyRow).select("id,created_at").single();
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, event: { id: data?.id, ticker: row.ticker, event_type: row.event_type, received_at: data?.created_at ?? receivedAt }, backend: "institutional_decisions" as const };
}

export async function saveTradingViewIntelligence(alert: NormalizedTradingViewAlert) {
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false as const, error: "Supabase admin is not configured" };
  const row = toRow(alert);
  const direct = await sb
    .from("tradingview_intelligence_events")
    .insert(row)
    .select("id,ticker,event_type,received_at")
    .single();
  if (!direct.error) return { ok: true as const, event: direct.data, backend: "tradingview_intelligence_events" as const };

  const legacy = await saveLegacy(sb, row);
  if (legacy.ok) return legacy;
  return { ok: false as const, error: `Dedicated store: ${direct.error.message}; legacy store: ${legacy.error}` };
}

async function readLegacy(ticker: string, limit: number): Promise<TradingViewIntelligenceEventRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const { data, error } = await sb
    .from("institutional_decisions")
    .select("id,audit,created_at")
    .eq("ticker", legacyTicker(ticker))
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map(mapLegacy).filter((row): row is TradingViewIntelligenceEventRow => Boolean(row));
}

export async function getTradingViewIntelligence(ticker: string, limit = 10): Promise<TradingViewIntelligenceEventRow[]> {
  const sb = getSupabaseAdmin();
  if (!sb) return [];
  const normalized = String(ticker ?? "").trim().toUpperCase();
  if (!normalized) return [];
  const bounded = Math.max(1, Math.min(50, Math.round(limit || 10)));
  const direct = await sb
    .from("tradingview_intelligence_events")
    .select("id,ticker,event_type,timeframe,signal,strategy,price,event_timestamp,source,eps_actual,eps_estimate,eps_surprise_pct,revenue_actual,revenue_estimate,revenue_surprise_pct,next_earnings_at,fiscal_period,ai_summary,guidance,financials,received_at")
    .eq("ticker", normalized)
    .order("received_at", { ascending: false })
    .limit(bounded);
  if (!direct.error) return (direct.data ?? []) as TradingViewIntelligenceEventRow[];
  return readLegacy(normalized, bounded);
}

export async function getLatestTradingViewEarnings(ticker: string, freshnessDays = 45): Promise<TradingViewIntelligenceEventRow | null> {
  const normalized = String(ticker ?? "").trim().toUpperCase();
  if (!normalized) return null;
  const rows = await getTradingViewIntelligence(normalized, 25);
  const cutoff = Date.now() - Math.max(1, freshnessDays) * 86_400_000;
  return rows.find(row => {
    if (!["EARNINGS", "EARNINGS_FINANCIAL"].includes(row.event_type)) return false;
    const stamp = new Date(row.received_at ?? row.event_timestamp ?? 0).getTime();
    return Number.isFinite(stamp) && stamp >= cutoff;
  }) ?? null;
}
