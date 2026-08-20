import { NextResponse } from "next/server";
import { buildAuthoritativeCashBufferSnapshot } from "@/lib/cashBufferSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await buildAuthoritativeCashBufferSnapshot();
    return NextResponse.json({
      asOf: new Date().toISOString(),
      totalNav: snapshot.totalNav,
      currentBufferUsd: snapshot.liquidityBuffer,
      currentBufferPct: snapshot.bufferPct,
      cashFloorPct: snapshot.cashFloorPct ?? snapshot.targetPct,
      targetPct: snapshot.targetPct,
      targetValue: snapshot.targetValue,
      shortfallValue: snapshot.shortfallValue,
      deployableCash: snapshot.deployableCash,
      posture: snapshot.posture,
      action: snapshot.action,
      verified: snapshot.verified,
      valuationMode: snapshot.valuationMode,
      policy: {
        proceedsRepairCashFloorFirst: true,
        sellReviewProceedsExcludedUntilApproved: true,
        automaticTrading: false,
        sourceOfTruth: snapshot.policy?.sourceOfTruth ?? "cashBufferSnapshot",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Capital recycling snapshot unavailable" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
