import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("watchlist").select("*").order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ watchlist: data, backend: "supabase" });
  }
  return NextResponse.json({ watchlist: memStore.watchlist, backend: "memory" });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Enter a valid ticker symbol (letters only, e.g. NVDA)." }, { status: 400 });
  }
  const alertRaw = body.alert_price;
  const alertPrice =
    alertRaw === null || alertRaw === undefined || String(alertRaw).trim() === ""
      ? null
      : Number.isFinite(Number(alertRaw))
      ? Number(alertRaw)
      : null;
  const row = {
    ticker,
    reason: body.reason?.trim() || null,
    alert_price: alertPrice,
  };
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("watchlist").upsert(row, { onConflict: "ticker" }).select().single();
    if (error) return NextResponse.json({ error: `Supabase: ${error.message}` }, { status: 500 });
    return NextResponse.json({ item: data });
  }
  return NextResponse.json({ item: memStore.addWatch(row) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = getSupabase();
  if (sb) {
    const { error } = await sb.from("watchlist").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: memStore.deleteWatch(id) });
}
