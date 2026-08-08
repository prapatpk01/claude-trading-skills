import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tickerPattern = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const DIVIDEND_WITHHOLDING_RATE = 0.15;

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const dateOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const text = String(value).trim();
  return datePattern.test(text) ? text : null;
};

function writeClientOrResponse() {
  const admin = getSupabaseAdmin();
  if (admin) return { admin, error: null as NextResponse | null };
  if (supabaseConfigured()) {
    return {
      admin: null,
      error: NextResponse.json(
        { error: "Secure dividend writes are unavailable because SUPABASE_SERVICE_ROLE_KEY is not configured." },
        { status: 503 },
      ),
    };
  }
  return { admin: null, error: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) };
}

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured.", dividends: [] }, { status: 503 });

  const ticker = String(req.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(1000, Math.floor(rawLimit))) : 200;

  if (ticker && !tickerPattern.test(ticker)) return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });

  let query = sb
    .from("dividend_ledger")
    .select("id,holding_id,ticker,ex_date,record_date,pay_date,shares_eligible,gross_per_share,gross_amount,withholding_tax,net_amount,currency,source,notes,created_at")
    .order("pay_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ticker) query = query.eq("ticker", ticker);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const dividends = data ?? [];
  const totals = dividends.reduce((acc, row) => {
    const gross = finite(row.gross_amount);
    const tax = finite(row.withholding_tax);
    const net = finite(row.net_amount);
    if (gross != null) acc.gross += gross;
    if (tax != null) acc.tax += tax;
    if (net != null) acc.net += net;
    return acc;
  }, { gross: 0, tax: 0, net: 0 });

  const byYear = new Map<string, { gross: number; tax: number; net: number }>();
  for (const row of dividends) {
    const year = String(row.pay_date).slice(0, 4);
    const current = byYear.get(year) ?? { gross: 0, tax: 0, net: 0 };
    current.gross += finite(row.gross_amount) ?? 0;
    current.tax += finite(row.withholding_tax) ?? 0;
    current.net += finite(row.net_amount) ?? 0;
    byYear.set(year, current);
  }

  return NextResponse.json({
    version: "v8.7",
    withholdingRate: DIVIDEND_WITHHOLDING_RATE,
    ticker: ticker || null,
    count: dividends.length,
    totals,
    byYear: Array.from(byYear.entries()).map(([year, values]) => ({ year, ...values })).sort((a, b) => b.year.localeCompare(a.year)),
    dividends,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker ?? "").trim().toUpperCase();
  const payDate = dateOrNull(body.pay_date);
  const exDate = dateOrNull(body.ex_date);
  const recordDate = dateOrNull(body.record_date);
  const sharesEligible = finite(body.shares_eligible);
  const grossPerShare = finite(body.gross_per_share);
  const currency = String(body.currency ?? "USD").trim().toUpperCase();

  if (!tickerPattern.test(ticker)) return NextResponse.json({ error: "Enter a valid ticker symbol." }, { status: 400 });
  if (!payDate) return NextResponse.json({ error: "A valid pay date is required." }, { status: 400 });
  if (sharesEligible == null || sharesEligible <= 0) return NextResponse.json({ error: "Eligible shares must be greater than zero." }, { status: 400 });
  if (grossPerShare == null || grossPerShare < 0) return NextResponse.json({ error: "Gross dividend per share must be zero or greater." }, { status: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "Currency must be a 3-letter ISO code." }, { status: 400 });

  const grossAmount = Math.round(sharesEligible * grossPerShare * 1e8) / 1e8;
  const withholdingTax = Math.round(grossAmount * DIVIDEND_WITHHOLDING_RATE * 1e8) / 1e8;
  const netAmount = Math.round((grossAmount - withholdingTax) * 1e8) / 1e8;

  const { admin, error: writeError } = writeClientOrResponse();
  if (writeError) return writeError;
  if (!admin) return NextResponse.json({ error: "Secure dividend write client unavailable." }, { status: 503 });

  const holdingId = body.holding_id ? String(body.holding_id) : null;
  if (holdingId) {
    const { data: holding, error: holdingError } = await admin.from("holdings").select("id,ticker").eq("id", holdingId).maybeSingle();
    if (holdingError) return NextResponse.json({ error: holdingError.message }, { status: 500 });
    if (!holding) return NextResponse.json({ error: "Holding not found." }, { status: 400 });
    if (String(holding.ticker).toUpperCase() !== ticker) return NextResponse.json({ error: "Holding ticker does not match dividend ticker." }, { status: 400 });
  }

  const row = {
    holding_id: holdingId,
    ticker,
    ex_date: exDate,
    record_date: recordDate,
    pay_date: payDate,
    shares_eligible: sharesEligible,
    gross_per_share: grossPerShare,
    gross_amount: grossAmount,
    withholding_tax: withholdingTax,
    net_amount: netAmount,
    currency,
    source: String(body.source ?? "").trim() || null,
    notes: String(body.notes ?? "").trim() || null,
  };

  const { data, error } = await admin.from("dividend_ledger").insert(row).select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: "This dividend payment is already recorded." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ dividend: data, withholdingRate: DIVIDEND_WITHHOLDING_RATE, version: "v8.7" }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { admin, error: writeError } = writeClientOrResponse();
  if (writeError) return writeError;
  if (!admin) return NextResponse.json({ error: "Secure dividend write client unavailable." }, { status: 503 });

  const { error } = await admin.from("dividend_ledger").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
