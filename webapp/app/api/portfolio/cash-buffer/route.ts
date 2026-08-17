import { NextResponse } from "next/server";
import { buildAuthoritativeCashBufferSnapshot as buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function GET() {
  try {
    const snapshot = await buildCashBufferSnapshot();
    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      },
    });
  } catch (error: any) {
    const message = error?.message ?? "Cash buffer analysis failed.";
    return NextResponse.json(
      { error: message },
      {
        status: message === "Supabase is not configured." ? 503 : 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      },
    );
  }
}
