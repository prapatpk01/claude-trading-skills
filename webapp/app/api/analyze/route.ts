import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { sanitizeResearch } from "@/lib/sanitizeResearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Provide a valid ticker (?ticker=NVDA)" }, { status: 400 });
  }
  try {
    const result = await buildAnalysis(ticker);
    if (!result.data.quote && result.data.candles.length === 0) {
      return NextResponse.json(
        { error: `No data returned for ${ticker}. Check that the symbol is a valid US-listed ticker.`, warnings: result.data.warnings },
        { status: 404 }
      );
    }
    if (result.research) result.research = sanitizeResearch(result.research);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Analysis failed" }, { status: 500 });
  }
}
