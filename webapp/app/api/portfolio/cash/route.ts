import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin, supabaseAdminConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set(["DEPOSIT", "WITHDRAWAL", "FEE", "ADJUSTMENT"]);
const DIVIDEND_WITHDRAWAL_TAG = "[DIVIDEND_WITHDRAWAL]";
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isDividendWithdrawal = (row: { entry_type?: string | null; notes?: string | null }) =>
  row.entry_type === "WITHDRAWAL" && String(row.notes ?? "").includes(DIVIDEND_WITHDRAWAL_TAG);

function classifyCash(rows: Array<{ entry_type?: string | null; amount?: unknown; notes?: string | null }>) {
  let investmentCash = 0;
  let dividendGrossCash = 0;
  let dividendTax = 0;
  let dividendWithdrawn = 0;
  let ledgerBalance = 0;

  for (const row of rows) {
    const amount = finite(row.amount) ?? 0;
    ledgerBalance += amount;
    if (row.entry_type === "DIVIDEND") {
      dividendGrossCash += Math.max(0, amount);
      continue;
    }
    if (row.entry_type === "TAX") {
      dividendTax += Math.abs(Math.min(0, amount));
      continue;
    }
    if (isDividendWithdrawal(row)) {
      dividendWithdrawn += Math.abs(Math.min(0, amount));
      continue;
    }
    investmentCash += amount;
  }

  const dividendNet = Math.max(0, dividendGrossCash - dividendTax);
  const dividendAvailable = Math.max(0, dividendNet - dividendWithdrawn);
  return {
    ledgerBalance,
    investmentCash,
    dividendGrossCash,
    dividendTax,
    dividendNet,
    dividendWithdrawn,
    dividendAvailable,
    realizedInvestmentProfit: dividendWithdrawn,
  };
}

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
  const cash = classifyCash(entries);
  const byType = entries.reduce<Record<string, number>>((acc, row) => {
    acc[row.entry_type] = (acc[row.entry_type] ?? 0) + (finite(row.amount) ?? 0);
    return acc;
  }, {});
  const unlinkedTrades = entries.filter((row) => ["BUY", "SELL"].includes(row.entry_type) && !row.transaction_id).length;
  const unlinkedDividends = entries.filter((row) => row.entry_type === "DIVIDEND" && !row.dividend_id).length;
  return NextResponse.json({ version: "v8.7", balance: cash.ledgerBalance, ...cash, count: entries.length, byType, unlinkedTrades, unlinkedDividends, entries });
}

export async function POST(req: NextRequest) {
  if (!supabaseAdminConfigured()) return NextResponse.json({ error: "Secure cash writes require a configured server admin key." }, { status: 503 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Admin database client unavailable." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode ?? "").trim().toUpperCase();

  if (mode === "SET_BALANCE") {
    const target = finite(body.balance);
    if (target == null || target < 0) return NextResponse.json({ error: "Broker USD cash must be zero or greater." }, { status: 400 });
    const { data: rows, error: readError } = await sb.from("cash_ledger").select("entry_type,amount,notes");
    if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
    const current = classifyCash(rows ?? []).investmentCash;
    const delta = Number((target - current).toFixed(8));
    if (Math.abs(delta) < 0.00000001) return NextResponse.json({ balance: target, investmentCash: target, changed: false });
    const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.entry_date ?? "")) ? body.entry_date : new Date().toISOString().slice(0, 10);
    const { data, error } = await sb.from("cash_ledger").insert({
      entry_type: "ADJUSTMENT", amount: delta, entry_date: entryDate, currency: "USD",
      notes: String(body.notes ?? "Broker USD investment cash reconciliation").trim() || "Broker USD investment cash reconciliation",
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ entry: data, balance: target, investmentCash: target, previousBalance: current, adjustment: delta, changed: true }, { status: 201 });
  }

  if (mode === "WITHDRAW_DIVIDEND") {
    const rawAmount = finite(body.amount);
    if (rawAmount == null || rawAmount <= 0) return NextResponse.json({ error: "Dividend withdrawal amount must be greater than zero." }, { status: 400 });
    const { data: rows, error: readError } = await sb.from("cash_ledger").select("entry_type,amount,notes");
    if (readError) return NextResponse.json({ error: readError.message }, { status: 400 });
    const cash = classifyCash(rows ?? []);
    const amount = Number(rawAmount.toFixed(8));
    if (amount > cash.dividendAvailable + 0.00000001) {
      return NextResponse.json({ error: `Only $${cash.dividendAvailable.toFixed(2)} of dividend cash is available to withdraw.` }, { status: 409 });
    }
    const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.entry_date ?? "")) ? body.entry_date : new Date().toISOString().slice(0, 10);
    const note = String(body.notes ?? "").trim();
    const { data, error } = await sb.from("cash_ledger").insert({
      entry_type: "WITHDRAWAL",
      amount: -Math.abs(amount),
      entry_date: entryDate,
      currency: "USD",
      notes: `${DIVIDEND_WITHDRAWAL_TAG}${note ? ` ${note}` : " Withdrawn dividend recognized as realized investment profit"}`,
    }).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({
      entry: data,
      withdrawn: amount,
      dividendAvailable: Number((cash.dividendAvailable - amount).toFixed(8)),
      realizedInvestmentProfit: Number((cash.realizedInvestmentProfit + amount).toFixed(8)),
    }, { status: 201 });
  }

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
  if (!supabaseAdminConfigured()) return NextResponse.json({ error: "Secure cash writes require a configured server admin key." }, { status: 503 });
  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });
  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ error: "Admin database client unavailable." }, { status: 503 });
  const { data: row, error: readError } = await sb.from("cash_ledger").select("entry_type,transaction_id,dividend_id,notes").eq("id", id).single();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 404 });
  if (row.transaction_id || row.dividend_id || ["BUY", "SELL", "DIVIDEND", "TAX"].includes(row.entry_type)) {
    return NextResponse.json({ error: "System-generated ledger entries must be removed through their source transaction." }, { status: 409 });
  }
  const { error } = await sb.from("cash_ledger").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ deleted: true });
}
