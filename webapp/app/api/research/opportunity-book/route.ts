import { NextResponse } from "next/server";
import { getInvResearchV38Status } from "@/lib/research/investmentDiscovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getInvResearchV38Status();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({
      error: error?.message ?? "INV Research V38 opportunity book unavailable",
      version: "38.0",
      automaticTrading: false,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
