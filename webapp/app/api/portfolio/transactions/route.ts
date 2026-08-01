import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) {
    return NextResponse.json({ error: "Supabase is not configured.", transactions: [] }, { status: 503 });
  }

  const ticker = String(req.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.floor(rawLimit))) : 200;

  if (ticker && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }

  let query = sb
    .from("portfolio_transactions")
    .select("id,holding_id,ticker,side,shares,price,trade_date,realized_pnl,notes,created_at")
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ticker) query = query.eq("ticker", ticker);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const transactions = data ?? [];
  const realizedPnl = transactions.reduce((sum, tx) => {
    const value = typeof tx.realized_pnl === "number" ? tx.realized_pnl : Number(tx.realized_pnl);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);

  return NextResponse.json({
    version: "v8.3",
    ticker: ticker || null,
    count: transactions.length,
    realizedPnl,
    transactions,
  });
}
