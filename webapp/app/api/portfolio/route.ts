import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { mergeLot, findOpenLot } from "@/lib/mergeLot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONAL_COLUMNS = ["opened_at", "closed_at"];
const roundShares = (v: number) => Math.round(v * 1e7) / 1e7;

function isMissingColumn(msg: string): boolean {
  const m = msg.toLowerCase();
  return OPTIONAL_COLUMNS.some((c) => m.includes(c)) &&
    (m.includes("column") || m.includes("schema cache") || m.includes("does not exist"));
}

function withoutOptional<T extends Record<string, unknown>>(row: T): T {
  const copy: Record<string, unknown> = { ...row };
  for (const c of OPTIONAL_COLUMNS) delete copy[c];
  return copy as T;
}

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

function writeClientOrResponse() {
  const admin = getSupabaseAdmin();
  if (admin) return { admin, error: null as NextResponse | null };
  if (supabaseConfigured()) {
    return {
      admin: null,
      error: NextResponse.json(
        { error: "Secure portfolio writes are unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured." },
        { status: 503 },
      ),
    };
  }
  return { admin: null, error: null as NextResponse | null };
}

function rpcStatus(message: string): number {
  const m = message.toLowerCase();
  if (
    m.includes("invalid ticker") ||
    m.includes("shares must") ||
    m.includes("price must") ||
    m.includes("side must") ||
    m.includes("no open holding") ||
    m.includes("cannot sell")
  ) return 400;
  return 500;
}

export async function GET() {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").select("*").order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ holdings: data, backend: "supabase" });
  }
  return NextResponse.json({ holdings: memStore.holdings, backend: "memory" });
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
  if (shares === null || shares <= 0) {
    return NextResponse.json({ error: "Shares must be a number greater than zero." }, { status: 400 });
  }
  if (tradePrice === null || tradePrice < 0) {
    return NextResponse.json(
      { error: action === "sell" ? "Sell price must be a valid number." : "Average cost must be a valid number." },
      { status: 400 },
    );
  }
  if (Math.abs(shares - roundShares(shares)) > 1e-10) {
    return NextResponse.json({ error: "Shares support up to 7 decimal places." }, { status: 400 });
  }

  const txDate = optDate(body.transaction_date) ?? optDate(body.opened_at) ?? new Date().toISOString().slice(0, 10);
  const { admin: sb, error: writeError } = writeClientOrResponse();
  if (writeError) return writeError;

  if (sb) {
    const { data, error } = await sb.rpc("execute_portfolio_trade", {
      p_ticker: ticker,
      p_side: action.toUpperCase(),
      p_shares: roundShares(shares),
      p_price: tradePrice,
      p_trade_date: txDate,
      p_notes: String(body.notes ?? body.thesis ?? "").trim() || null,
      p_thesis: String(body.thesis ?? "").trim() || null,
      p_target_price: optNum(body.target_price),
    });

    if (error) {
      return NextResponse.json(
        { error: `Supabase transaction: ${error.message}` },
        { status: rpcStatus(error.message) },
      );
    }

    return NextResponse.json({
      ...(data as Record<string, unknown>),
      action,
      backend: "supabase",
      atomic: true,
    });
  }

  // Local development fallback only. Production writes never fall back to memory
  // when Supabase is configured because that would create a split-brain portfolio.
  if (action === "sell") {
    const existing = findOpenLot(memStore.holdings, ticker);
    if (!existing) return NextResponse.json({ error: `${ticker} has no open holding to sell.` }, { status: 400 });
    const held = Number(existing.shares) || 0;
    if (shares > held + 1e-7) {
      return NextResponse.json({ error: `Cannot sell ${shares} shares; only ${held} are held.` }, { status: 400 });
    }
    const remaining = roundShares(Math.max(0, held - shares));
    const closed = remaining <= 0;
    const updated = memStore.updateHolding(
      existing.id,
      closed
        ? { closed_at: txDate, notes: String(body.thesis ?? "").trim() || existing.notes || null }
        : { shares: remaining, notes: String(body.thesis ?? "").trim() || existing.notes || null },
    );
    return NextResponse.json({ holding: updated, action, remainingShares: remaining, closed, backend: "memory", atomic: false });
  }

  const row = {
    ticker,
    shares: roundShares(shares),
    avg_cost: tradePrice,
    notes: String(body.notes ?? "").trim() || null,
    thesis: String(body.thesis ?? "").trim() || null,
    target_price: optNum(body.target_price),
    opened_at: txDate,
    closed_at: null,
  };
  const existing = findOpenLot(memStore.holdings, ticker);
  if (existing) {
    const merged = mergeLot(existing, row);
    const updated = memStore.updateHolding(existing.id, {
      shares: roundShares(merged.shares),
      avg_cost: merged.avg_cost,
      target_price: merged.target_price,
      thesis: merged.thesis,
      notes: merged.notes,
      opened_at: merged.opened_at,
    });
    return NextResponse.json({ holding: updated, action, merged: true, mergeSummary: merged.summary, backend: "memory", atomic: false });
  }
  return NextResponse.json({ holding: memStore.addHolding(row), action, backend: "memory", atomic: false });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (body.ticker !== undefined) {
    const t = String(body.ticker).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)) return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });
    patch.ticker = t;
  }
  if (body.shares !== undefined) {
    const n = optNum(body.shares);
    if (n === null || n <= 0) return NextResponse.json({ error: "Shares must be greater than zero." }, { status: 400 });
    if (Math.abs(n - roundShares(n)) > 1e-10) return NextResponse.json({ error: "Shares support up to 7 decimal places." }, { status: 400 });
    patch.shares = roundShares(n);
  }
  if (body.avg_cost !== undefined) {
    const n = optNum(body.avg_cost);
    if (n === null || n < 0) return NextResponse.json({ error: "Average cost must be a valid number." }, { status: 400 });
    patch.avg_cost = n;
  }
  if (body.target_price !== undefined) patch.target_price = optNum(body.target_price);
  if (body.thesis !== undefined) patch.thesis = String(body.thesis).trim() || null;
  if (body.notes !== undefined) patch.notes = String(body.notes).trim() || null;
  if (body.opened_at !== undefined) patch.opened_at = optDate(body.opened_at);
  if (body.closed_at !== undefined) patch.closed_at = optDate(body.closed_at);
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const { admin: sb, error: writeError } = writeClientOrResponse();
  if (writeError) return writeError;
  if (sb) {
    let { data, error } = await sb.from("holdings").update(patch).eq("id", id).select().single();
    if (error && isMissingColumn(error.message)) {
      const reduced = withoutOptional(patch);
      if (!Object.keys(reduced).length) {
        return NextResponse.json({ error: "Position dates need the migration in supabase/schema.sql." }, { status: 400 });
      }
      ({ data, error } = await sb.from("holdings").update(reduced).eq("id", id).select().single());
    }
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }

  const updated = memStore.updateHolding(id, patch as never);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ holding: updated, backend: "memory" });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { admin: sb, error: writeError } = writeClientOrResponse();
  if (writeError) return writeError;
  if (sb) {
    const { error } = await sb.from("holdings").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: memStore.deleteHolding(id), backend: "memory" });
}
