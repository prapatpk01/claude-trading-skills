import { NextRequest, NextResponse } from "next/server";
import { runInstitutionalCommittee, type CommitteeInput } from "@/lib/institutional/v7";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CommitteeInput;
    const decision = runInstitutionalCommittee(body);
    const sb = getSupabase();
    let persistence: "supabase" | "not-configured" | "schema-missing" = sb ? "schema-missing" : "not-configured";
    let persistenceWarning: string | null = null;

    if (sb) {
      const { error } = await sb.from("institutional_decisions").insert({
        ticker: decision.ticker,
        requested_action: body.requestedAction,
        final_action: decision.action,
        approved: decision.approved,
        conviction: decision.conviction,
        confidence: decision.confidence,
        proposed_weight_pct: decision.proposedWeightPct,
        funding_source: decision.fundingSource,
        evidence: body.evidence,
        votes: body.votes,
        issues: decision.issues,
        dissent: decision.dissent,
        portfolio_context: body.portfolio,
        audit: decision.audit,
      });
      if (!error) persistence = "supabase";
      else persistenceWarning = error.message;
    }

    return NextResponse.json(
      { decision, persistence, persistenceWarning },
      { status: decision.issues.some((issue) => issue.severity === "BLOCK") ? 422 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Committee decision failed" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET() {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ decisions: [], backend: "not-configured" });
  const { data, error } = await sb
    .from("institutional_decisions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ decisions: [], backend: "schema-missing", warning: error.message });
  return NextResponse.json({ decisions: data ?? [], backend: "supabase" }, { headers: { "Cache-Control": "no-store" } });
}
