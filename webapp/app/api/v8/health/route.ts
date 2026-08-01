import { NextResponse } from "next/server";
import { runV8ReleaseSelfTest } from "../../../../lib/institutional/v8";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = runV8ReleaseSelfTest();
  return NextResponse.json(
    {
      ok: result.passed,
      release: result.release,
      status: result.passed ? "READY_FOR_VALIDATION" : "BLOCKED",
      checkedAt: result.checkedAt,
      agents: result.agents,
      controls: result.controls,
      failures: result.failures,
      humanApprovalRequired: true,
      productionReady: false,
      note: "Production readiness requires typecheck, build, Supabase migration, API smoke tests and end-to-end validation.",
    },
    {
      status: result.passed ? 200 : 503,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
