import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 24)));
  const { data, error } = await sb.from("macro_evidence_snapshots").select("*").order("as_of", { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = data ?? [];
  const latest = rows[0] ?? null;
  const previous = rows[1] ?? null;
  const changes = latest && previous ? {
    score: Number(latest.score) - Number(previous.score),
    completeness: Number(latest.evidence_completeness) - Number(previous.evidence_completeness),
    regimeChanged: latest.regime !== previous.regime,
    confidenceChanged: latest.confidence !== previous.confidence,
  } : null;
  return NextResponse.json({ version: "v8.4", latest, previous, changes, history: rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Secure macro snapshot writes require SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const score = Number(body.score);
  const completeness = Number(body.evidenceCompleteness);
  const regime = String(body.regime ?? "").trim();
  const confidence = String(body.confidence ?? "").toUpperCase();
  if (!regime || !Number.isFinite(score) || score < 0 || score > 100 || !Number.isFinite(completeness) || completeness < 0 || completeness > 100 || !["HIGH","MEDIUM","LOW"].includes(confidence)) {
    return NextResponse.json({ error: "Invalid macro snapshot payload." }, { status: 400 });
  }
  const row = {
    as_of: body.asOf ?? new Date().toISOString(),
    regime,
    score,
    evidence_completeness: completeness,
    confidence,
    horizons: Array.isArray(body.horizons) ? body.horizons : [],
    evidence: body.evidence && typeof body.evidence === "object" ? body.evidence : {},
    warnings: Array.isArray(body.warnings) ? body.warnings : [],
    source: "macro-intelligence-v8.4",
  };
  const { data, error } = await admin.from("macro_evidence_snapshots").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshot: data }, { status: 201 });
}
