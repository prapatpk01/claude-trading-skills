import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker symbol (letters only, e.g. NVDA)." }, { status: 400 });
  }
  // Empty form fields arrive as "" — Number("") is 0, so treat blanks as absent
  // rather than storing a silent zero.
  const optNum = (v: any): number | null => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const shares = optNum(body.shares);
  const avgCost = optNum(body.avg_cost);
  if (shares === null || shares <= 0) {
    return NextResponse.json({ error: "Shares must be a number greater than zero." }, { status: 400 });
  }
  if (avgCost === null || avgCost < 0) {
    return NextResponse.json({ error: "Average cost must be a valid number." }, { status: 400 });
  }
  const row = {
    ticker,
    shares,
    avg_cost: avgCost,
    notes: body.notes?.trim() || null,
    thesis: body.thesis?.trim() || null,
    target_price: optNum(body.target_price),
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").insert(row).select().single();
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ holding: data });
  }
  return NextResponse.json({ holding: memStore.addHolding(row), backend: "memory" });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, any> = {};
  for (const k of ["ticker", "shares", "avg_cost", "notes", "thesis", "target_price"]) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").update(patch).eq("id", id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
