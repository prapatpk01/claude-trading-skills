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
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const row = {
    ticker,
    shares: Number(body.shares) || 0,
    avg_cost: Number(body.avg_cost) || 0,
    notes: body.notes ?? null,
    thesis: body.thesis ?? null,
    target_price: body.target_price != null ? Number(body.target_price) : null,
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").insert(row).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ holding: data });
  }
  return NextResponse.json({ holding: memStore.addHolding(row) });
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
