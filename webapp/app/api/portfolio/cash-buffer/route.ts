import { NextResponse } from "next/server";
import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await buildCashBufferSnapshot();
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    const message = error?.message ?? "Cash buffer analysis failed.";
    return NextResponse.json({ error: message }, { status: message === "Supabase is not configured." ? 503 : 500 });
  }
}
