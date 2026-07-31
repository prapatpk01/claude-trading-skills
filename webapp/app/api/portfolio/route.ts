import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { mergeLot, findOpenLot } from "@/lib/mergeLot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONAL_COLUMNS = ["opened_at", "closed_at"];
function isMissingColumn(msg: string): boolean {
  const m = msg.toLowerCase();
  return OPTIONAL_COLUMNS.some((c) => m.includes(c)) && (m.includes("column") || m.includes("schema cache") || m.includes("does not exist"));
}
function withoutOptional<T extends Record<string, any>>(row: T): T {
  const copy: Record<string, any> = { ...row };
  for (const c of OPTIONAL_COLUMNS) delete copy[c];
  return copy as T;
}
const optNum = (v: any): number | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const optDate = (v: any): string | null => {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const roundShares = (v: number) => Math.round(v * 1e7) / 1e7;

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
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });

  const shares = optNum(body.shares);
  const tradePrice = optNum(body.avg_cost);
  if (shares === null || shares <= 0) return NextResponse.json({ error: "Shares must be a number greater than zero." }, { status: 400 });
  if (tradePrice === null || tradePrice < 0) return NextResponse.json({ error: action === "sell" ? "Sell price must be a valid number." : "Average cost must be a valid number." }, { status: 400 });
  if (Math.abs(shares - roundShares(shares)) > 1e-10) return NextResponse.json({ error: "Shares support up to 7 decimal places." }, { status: 400 });

  const txDate = optDate(body.transaction_date) ?? optDate(body.opened_at) ?? new Date().toISOString().slice(0, 10);
  const sb = getSupabase();

  if (action === "sell") {
    if (sb) {
      const { data: rows, error: readError } = await sb.from("holdings").select("*").eq("ticker", ticker);
      if (readError) return NextResponse.json({ error: `Supabase: ${readError.message}` }, { status: 500 });
      const existing = rows ? findOpenLot(rows as any[], ticker) : undefined;
      if (!existing) return NextResponse.json({ error: `${ticker} has no open holding to sell.` }, { status: 400 });
      const held = Number((existing as any).shares) || 0;
      if (shares > held + 1e-7) return NextResponse.json({ error: `Cannot sell ${shares} shares; only ${held} are held.` }, { status: 400 });
      const remaining = roundShares(Math.max(0, held - shares));
      const closed = remaining <= 0;
      const patch: Record<string, any> = closed
        ? { shares: held, closed_at: txDate, notes: body.thesis?.trim() || (existing as any).notes || null }
        : { shares: remaining, notes: body.thesis?.trim() || (existing as any).notes || null };
      let { data, error } = await sb.from("holdings").update(patch).eq("id", (existing as any).id).select().single();
      if (error && isMissingColumn(error.message)) {
        if (closed) {
          return NextResponse.json({ error: "Closing positions requires the closed_at migration in supabase/schema.sql." }, { status: 400 });
        }
        ({ data, error } = await sb.from("holdings").update(withoutOptional(patch)).eq("id", (existing as any).id).select().single());
      }
      if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
      return NextResponse.json({ holding: data, action: "sell", soldShares: shares, sellPrice: tradePrice, remainingShares: remaining, closed });
    }

    const existing = findOpenLot(memStore.holdings, ticker);
    if (!existing) return NextResponse.json({ error: `${ticker} has no open holding to sell.` }, { status: 400 });
    const held = Number(existing.shares) || 0;
    if (shares > held + 1e-7) return NextResponse.json({ error: `Cannot sell ${shares} shares; only ${held} are held.` }, { status: 400 });
    const remaining = roundShares(Math.max(0, held - shares));
    const closed = remaining <= 0;
    const updated = memStore.updateHolding(existing.id, closed
      ? { closed_at: txDate, notes: body.thesis?.trim() || existing.notes || null }
      : { shares: remaining, notes: body.thesis?.trim() || existing.notes || null });
    return NextResponse.json({ holding: updated, action: "sell", soldShares: shares, sellPrice: tradePrice, remainingShares: remaining, closed, backend: "memory" });
  }

  const row = {
    ticker,
    shares: roundShares(shares),
    avg_cost: tradePrice,
    notes: body.notes?.trim() || null,
    thesis: body.thesis?.trim() || null,
    target_price: optNum(body.target_price),
    opened_at: txDate,
    closed_at: optDate(body.closed_at),
  };

  if (sb) {
    const { data: openRows } = await sb.from("holdings").select("*").eq("ticker", ticker);
    const existing = openRows ? findOpenLot(openRows as any[], ticker) : undefined;
    if (existing) {
      const merged = mergeLot(existing as any, row);
      const patch: Record<string, any> = {
        shares: roundShares(merged.shares),
        avg_cost: merged.avg_cost,
        target_price: merged.target_price,
        thesis: merged.thesis,
        notes: merged.notes,
        opened_at: merged.opened_at,
      };
      let { data, error } = await sb.from("holdings").update(patch).eq("id", (existing as any).id).select().single();
      if (error && isMissingColumn(error.message)) ({ data, error } = await sb.from("holdings").update(withoutOptional(patch)).eq("id", (existing as any).id).select().single());
      if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
      return NextResponse.json({ holding: data, merged: true, mergeSummary: merged.summary });
    }
    let { data, error } = await sb.from("holdings").insert(row).select().single();
    if (error && isMissingColumn(error.message)) {
      ({ data, error } = await sb.from("holdings").insert(withoutOptional(row)).select().single());
      if (!error) return NextResponse.json({ holding: data, warning: "Saved without the position dates — run the migration in supabase/schema.sql to enable them." });
    }
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }

  const existingMem = findOpenLot(memStore.holdings, ticker);
  if (existingMem) {
    const merged = mergeLot(existingMem, row);
    const updated = memStore.updateHolding(existingMem.id, {
      shares: roundShares(merged.shares), avg_cost: merged.avg_cost, target_price: merged.target_price,
      thesis: merged.thesis, notes: merged.notes, opened_at: merged.opened_at,
    });
    return NextResponse.json({ holding: updated, merged: true, mergeSummary: merged.summary, backend: "memory" });
  }
  return NextResponse.json({ holding: memStore.addHolding(row), backend: "memory" });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, any> = {};
  if (body.ticker !== undefined) {
    const t = String(body.ticker).trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(t)) return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });
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

  const sb = getSupabase();
  if (sb) {
    let { data, error } = await sb.from("holdings").update(patch).eq("id", id).select().single();
    if (error && isMissingColumn(error.message)) {
      const reduced = withoutOptional(patch);
      if (!Object.keys(reduced).length) return NextResponse.json({ error: "Position dates need the migration in supabase/schema.sql." }, { status: 400 });
      ({ data, error } = await sb.from("holdings").update(reduced).eq("id", id).select().single());
      if (!error) return NextResponse.json({ holding: data, warning: "Saved without the position dates — run the migration in supabase/schema.sql to enable them." });
    }
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }
  const updated = memStore.updateHolding(id, patch as any);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ holding: updated });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from("holdings").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: memStore.deleteHolding(id) });
}