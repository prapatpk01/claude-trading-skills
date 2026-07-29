import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Added by the trade-idea migration — the app must work either way. */
const OPTIONAL_COLUMNS = ["target_price", "stop_price", "entry_price", "source"];

function isMissingColumn(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    OPTIONAL_COLUMNS.some((c) => m.includes(c)) &&
    (m.includes("column") || m.includes("schema cache") || m.includes("does not exist"))
  );
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
  const target = optNum(body.target_price);
  const row = {
    ticker,
    reason: body.reason?.trim() || null,
    // alert_price mirrors the target so existing installs keep working
    alert_price: optNum(body.alert_price) ?? target,
    target_price: target,
    stop_price: optNum(body.stop_price),
    entry_price: optNum(body.entry_price),
    source: body.source?.trim() || null,
  };

  const sb = getSupabase();
  if (sb) {
    let { data, error } = await sb.from("watchlist").upsert(row, { onConflict: "ticker" }).select().single();
    if (error && isMissingColumn(error.message)) {
      ({ data, error } = await sb.from("watchlist").upsert(withoutOptional(row), { onConflict: "ticker" }).select().single());
      if (!error) {
        return NextResponse.json({
          item: data,
          warning:
            "Saved without the target/stop levels — run the watchlist migration at the end of supabase/schema.sql to track outcomes.",
        });
      }
    }
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
