import { NextRequest, NextResponse } from "next/server";
import { runDeskScan, normalizeTickers } from "@/lib/research/deskScan";
import { ROSTER } from "@/lib/team/roster";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stage 2 of the investment meeting: the research desk's swing scan.
 *
 * Maya Chen's momentum model with Aisha Fontaine's catalyst component, run over
 * a universe and filtered by the brief's four hard rules. The fetching and the
 * scan both live in lib/research/deskScan.ts, which the committee meeting runs
 * as well — the names debated in the meeting come from this same scan.
 */
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("tickers");
    const sector = req.nextUrl.searchParams.get("sector") || "All";
    const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));
    const explicit = raw ? normalizeTickers(raw) : null;
    if (raw && !explicit?.length) {
      return NextResponse.json({ error: "No valid US-listed ticker symbols were supplied." }, { status: 400 });
    }

    const { result, warnings, universeSource, funnel } = await runDeskScan({ tickers: explicit, sector, topN });

    return NextResponse.json(
      {
        ...result,
        stage: "2 — Research: swing scan",
        owners: { score: ROSTER.maya.name, catalyst: ROSTER.aisha.name, execution: ROSTER.ryan.name },
        universeSource,
        universePolicy: explicit?.length ? "MANUAL ONE-OFF" : "S&P 500 + Nasdaq-100 + Russell 2000 ONLY",
        funnel,
        sector,
        warnings,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    const message = error?.message ?? "The swing scan failed.";
    const status = /^No (valid|universe)/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message, retryable: /timeout|fetch|network|rate/i.test(message) }, { status });
  }
}
