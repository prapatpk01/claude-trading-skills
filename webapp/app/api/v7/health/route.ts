import { NextResponse } from "next/server";
import { AGENT_PROFILES, runV7SelfTest } from "@/lib/institutional/v7";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const selfTest = runV7SelfTest();
    const requiredDesks = ["Executive", "Macro", "Research", "Quant", "Valuation", "Risk", "Portfolio", "Liquidity", "Execution", "Data"];
    const presentDesks = new Set(AGENT_PROFILES.map((agent) => agent.desk));
    const missingDesks = requiredDesks.filter((desk) => !presentDesks.has(desk as any));
    const ok = selfTest.ok && missingDesks.length === 0;

    return NextResponse.json(
      {
        ok,
        system: "Sentinel Capital v7.0",
        governance: "institutional-ai-fund-operating-system",
        selfTest,
        roster: {
          agents: AGENT_PROFILES.length,
          desks: [...presentDesks],
          missingDesks,
        },
        controls: {
          evidenceLineage: true,
          freshnessGates: true,
          confidenceFloors: true,
          deskVetoes: true,
          liquidityFloor: true,
          positionCap: true,
          dissentLog: true,
          auditTrail: true,
          humanApprovalRequired: true,
        },
        checkedAt: new Date().toISOString(),
      },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, system: "Sentinel Capital v7.0", error: error?.message ?? "Institutional self-test failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
