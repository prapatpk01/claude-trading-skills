import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/symbols";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(15, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "8", 10) || 8));
  if (q.trim().length < 1) return NextResponse.json({ results: [] });
  try {
    const results = await searchSymbols(q, limit);
    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ results: [], error: e?.message ?? "search failed" });
  }
}
