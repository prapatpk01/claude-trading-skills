import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin, supabaseAdminConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(["DEPOSIT", "WITHDRAWAL", "FEE", "ADJUSTMENT"]);
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured.", entries: [] }, { status: 503 });
  const rawLimit = finite(req.nextUrl.searchParams.get("limit")) ?? 250;
  const limit = Math.max(1, Math.min(1000, Math.floor(rawLimit)));
  const { data, error } = await sb.from("cash_ledger")
    .select("id,entry_type,amount,currency,entry_date,ticker,transaction_id,dividend_id,notes,created_at")
    .order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const entries = data ?? [];
  const balance = entries.reduce((sum, row) => sum + (finite(row.amount) ?? 0), 0);
  const byType = entries.reduce<Record<string, number>>((acc, row) => {
    acc[row.entry_type] = (acc[row.entry_type] ?? 0) + (finite(row.amount) ?? 0);
    return acc;
  }, {});
  const unlinkedTrades = entries.filter((row) => ["BUY", "SELL"].includes(row.entry_type) && !row.transaction_id).length;
  const unlinkedDividends = entries.filter((row) => row.entry_type === "DIVIDEND" && !row.dividend_id).length;
  return NextResponse.json({ version: "v8.3", balance, count: entries.length, byType, unlinkedTrades, unlinkedDividends, entries });
}

export async function POST(req: NextRequest) {
  if (!supabaseAdminConfigured()) return NextResponse.json({ error: "Secure cash writes require SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Admin database client unavailable." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const entryType = String(body.entry_type ?? "").trim().toUpperCase();
  const rawAmount = finite(body.amount);
  if (!TYPES.has(entryType)) return NextResponse.json({ error: "Manual entries support DEPOSIT, WITHDRAWAL, FEE or ADJUSTMENT." }, { status: 400 });
  if (rawAmount == null || rawAmount === 0) return NextResponse.json({ error: "Amount must be non-zero." }, { status: 400 });
  const amount = entryType === "DEPOSIT" ? Math.abs(rawAmount)
    : entryType === "ADJUSTMENT" ? rawAmount : -Math.abs(rawAmount);
  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.entry_date ?? "")) ? body.entry_date : new Date().toISOString().slice(0, 10);
  const { data, error } = await sb.from("cash_ledger").insert({
    entry_type: entryType, amount, entry_date: entryDate,
    currency: String(body.currency ?? "USD").trim().toUpperCase(),
    notes: String(body.notes ?? "").trim() || null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ entry: data }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  if (!supabaseAdminConfigured()) return NextResponse.json({ error: "Secure cash writes require SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Admin database client unavailable." }, { status: 503 });
  const { data: row, error: readError } = await sb.from("cash_ledger").select("entry_type,transaction_id,dividend_id").eq("id", id).single();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 404 });
  if (row.transaction_id || row.dividend_id || ["BUY", "SELL", "DIVIDEND", "TAX"].includes(row.entry_type)) {
    return NextResponse.json({ error: "System-generated ledger entries must be removed through their source transaction." }, { status: 409 });
  }
  const { error } = await sb.from("cash_ledger").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
