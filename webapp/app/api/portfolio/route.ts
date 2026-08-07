import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import { callSupabaseWriteGateway } from "@/lib/supabaseWriteGateway";
import { memStore } from "@/lib/store";
import { mergeLot, findOpenLot } from "@/lib/mergeLot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const roundShares = (v: number) => Math.round(v * 1e7) / 1e7;

const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const optDate = (v: unknown): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function rpcStatus(message: string): number {
  const m = message.toLowerCase();
  if (
    m.includes("invalid ticker") ||
    m.includes("shares must") ||
    m.includes("price must") ||
    m.includes("side must") ||
    m.includes("no open holding") ||
    m.includes("cannot sell") ||
    m.includes("holding not found") ||
    m.includes("conflict with recorded trades")
  ) return 400;
  return 500;
}

function gatewayError(result: { status: number; body: any }) {
  const message = String(result.body?.error ?? "Secure portfolio write failed");
  const status = result.status >= 500 ? rpcStatus(message) : result.status;
  return NextResponse.json({ error: message, code: result.body?.code, writeAuth: "vercel-oidc" }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const sb = getSupabase();
  if (sb) {
    const [{ data: live, error: liveError }, { data: closed, error: closedError }] = await Promise.all([
      sb.from("live_holdings_ledger").select("*").order("created_at", { ascending: true }),
      sb.from("closed_positions_ledger").select("*").order("closed_at", { ascending: false }),
    ]);

    if (!liveError) {
      return NextResponse.json({
        holdings: live ?? [],
        closedPositions: closedError ? [] : closed ?? [],
        backend: "supabase",
        sourceOfTruth: "portfolio_transactions",
        ledgerFirst: true,
      });
    }

    const { data, error } = await sb
      .from("holdings")
      .select("*")
      .is("closed_at", null)
      .gt("shares", 0)
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ holdings: data ?? [], closedPositions: [], backend: "supabase", ledgerFirst: false });
  }

  return NextResponse.json({
    holdings: memStore.holdings.filter((h) => Number(h.shares) > 0 && !h.closed_at),
    closedPositions: memStore.holdings.filter((h) => Number(h.shares) <= 0 || Boolean(h.closed_at)),
    backend: "memory",
    sourceOfTruth: "memory",
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "buy").toLowerCase() === "sell" ? "sell" : "buy";
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });
  }

  const shares = optNum(body.shares);
  const tradePrice = optNum(body.avg_cost);
  if (shares === null || shares <= 0) return NextResponse.json({ error: "Shares must be a number greater than zero." }, { status: 400 });
  if (tradePrice === null || tradePrice < 0) return NextResponse.json({ error: action === "sell" ? "Sell price must be a valid number." : "Average cost must be a valid number." }, { status: 400 });
  if (Math.abs(shares - roundShares(shares)) > 1e-10) return NextResponse.json({ error: "Shares support up to 7 decimal places." }, { status: 400 });

  const txDate = optDate(body.transaction_date) ?? optDate(body.opened_at) ?? new Date().toISOString().slice(0, 10);
  const params = {
    p_ticker: ticker,
    p_side: action.toUpperCase(),
    p_shares: roundShares(shares),
    p_price: tradePrice,
    p_trade_date: txDate,
    p_notes: String(body.notes ?? body.thesis ?? "").trim() || null,
    p_thesis: String(body.thesis ?? "").trim() || null,
    p_target_price: optNum(body.target_price),
  };

  const admin = getSupabaseAdmin();
  if (admin) {
    const { data, error } = await admin.rpc("execute_portfolio_trade", params);
    if (error) return NextResponse.json({ error: `Supabase transaction: ${error.message}` }, { status: rpcStatus(error.message) });
    return NextResponse.json({ ...(data as Record<string, unknown>), action, backend: "supabase", atomic: true, sourceOfTruth: "portfolio_transactions", writeAuth: "supabase-secret" });
  }

  if (process.env.NODE_ENV === "production") {
    const result = await callSupabaseWriteGateway(req, { resource: "portfolio", action: "trade", params });
    if (!result.ok) return gatewayError(result);
    return NextResponse.json({ ...(result.body.data as Record<string, unknown>), action, backend: "supabase", atomic: true, sourceOfTruth: "portfolio_transactions", writeAuth: "vercel-oidc" });
  }

  if (action === "sell") {
    const existing = findOpenLot(memStore.holdings, ticker);
    if (!existing) return NextResponse.json({ error: `${ticker} has no open holding to sell.` }, { status: 400 });
    const held = Number(existing.shares) || 0;
    if (shares > held + 1e-7) return NextResponse.json({ error: `Cannot sell ${shares} shares; only ${held} are held.` }, { status: 400 });
    const remaining = roundShares(Math.max(0, held - shares));
    const closed = remaining <= 0;
    const updated = memStore.updateHolding(existing.id, closed ? { shares: 0, closed_at: txDate, notes: String(body.thesis ?? "").trim() || existing.notes || null } : { shares: remaining, notes: String(body.thesis ?? "").trim() || existing.notes || null });
    return NextResponse.json({ holding: updated, action, remainingShares: remaining, closed, backend: "memory", atomic: false });
  }

  const row = { ticker, shares: roundShares(shares), avg_cost: tradePrice, notes: String(body.notes ?? "").trim() || null, thesis: String(body.thesis ?? "").trim() || null, target_price: optNum(body.target_price), opened_at: txDate, closed_at: null };
  const existing = findOpenLot(memStore.holdings, ticker);
  if (existing) {
    const merged = mergeLot(existing, row);
    const updated = memStore.updateHolding(existing.id, { shares: roundShares(merged.shares), avg_cost: merged.avg_cost, target_price: merged.target_price, thesis: merged.thesis, notes: merged.notes, opened_at: merged.opened_at });
    return NextResponse.json({ holding: updated, action, merged: true, mergeSummary: merged.summary, backend: "memory", atomic: false });
  }
  return NextResponse.json({ holding: memStore.addHolding(row), action, backend: "memory", atomic: false });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const shares = optNum(body.shares);
  const avgCost = optNum(body.avg_cost);
  if (shares === null || shares < 0) return NextResponse.json({ error: "Shares must be zero or greater." }, { status: 400 });
  if (Math.abs(shares - roundShares(shares)) > 1e-10) return NextResponse.json({ error: "Shares support up to 7 decimal places." }, { status: 400 });
  if (avgCost === null || avgCost < 0) return NextResponse.json({ error: "Average cost must be a valid number." }, { status: 400 });

  const params = {
    p_holding_id: id,
    p_shares: roundShares(shares),
    p_avg_cost: avgCost,
    p_reason: String(body.reason ?? body.notes ?? "Broker reconciliation override").trim(),
  };

  const admin = getSupabaseAdmin();
  if (admin) {
    const { data, error } = await admin.rpc("reconcile_holding_from_broker", params);
    if (error) return NextResponse.json({ error: `Supabase reconciliation: ${error.message}` }, { status: rpcStatus(error.message) });
    return NextResponse.json({ ...(data as Record<string, unknown>), backend: "supabase", sourceOfTruth: "portfolio_transactions", writeAuth: "supabase-secret" });
  }

  if (process.env.NODE_ENV === "production") {
    const result = await callSupabaseWriteGateway(req, { resource: "portfolio", action: "reconcile", params });
    if (!result.ok) return gatewayError(result);
    return NextResponse.json({ ...(result.body.data as Record<string, unknown>), backend: "supabase", sourceOfTruth: "portfolio_transactions", writeAuth: "vercel-oidc" });
  }

  const updated = memStore.updateHolding(id, { shares: roundShares(shares), avg_cost: avgCost, closed_at: shares === 0 ? new Date().toISOString().slice(0, 10) : null } as never);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ holding: updated, reconciled: true, backend: "memory" });
}

export async function DELETE() {
  return NextResponse.json({ error: "Direct holding deletion is disabled. Record a SELL transaction or reconcile the broker balance to zero." }, { status: 405 });
}
