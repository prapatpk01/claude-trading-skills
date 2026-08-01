import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const validStatus = new Set(["PROPOSED","APPROVED","REJECTED","EXECUTED","CANCELLED"]);

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));
  const ticker = String(req.nextUrl.searchParams.get("ticker") ?? "").trim().toUpperCase();
  let query = sb.from("investment_decision_audit").select("*").order("created_at", { ascending: false }).limit(limit);
  if (ticker) query = query.eq("ticker", ticker);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const decisions = data ?? [];
  return NextResponse.json({
    version: "v8.5",
    count: decisions.length,
    humanAuthorized: decisions.filter((x:any)=>x.human_authorized).length,
    pendingHumanReview: decisions.filter((x:any)=>!x.human_authorized && ["PROPOSED","APPROVED"].includes(x.status)).length,
    decisions,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Secure committee writes require SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const decisionKey = String(body.decisionKey ?? "").trim();
  const decisionType = String(body.decisionType ?? "").trim().toUpperCase();
  const status = String(body.status ?? "PROPOSED").trim().toUpperCase();
  const ticker = String(body.ticker ?? "").trim().toUpperCase() || null;
  if (!decisionKey || !decisionType || !validStatus.has(status)) return NextResponse.json({ error: "decisionKey, decisionType and valid status are required." }, { status: 400 });
  if (ticker && !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  const humanAuthorized = body.humanAuthorized === true;
  const row = {
    decision_key: decisionKey,
    ticker,
    decision_type: decisionType,
    status,
    committee: body.committee && typeof body.committee === "object" ? body.committee : {},
    evidence: body.evidence && typeof body.evidence === "object" ? body.evidence : {},
    portfolio_context: body.portfolioContext && typeof body.portfolioContext === "object" ? body.portfolioContext : {},
    dissent: Array.isArray(body.dissent) ? body.dissent : [],
    human_authorized: humanAuthorized,
    authorized_by: humanAuthorized ? String(body.authorizedBy ?? "human-operator") : null,
    authorized_at: humanAuthorized ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await admin.from("investment_decision_audit").upsert(row, { onConflict: "decision_key" }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decision: data }, { status: 201 });
}
