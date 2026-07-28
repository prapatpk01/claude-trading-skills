import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";

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
        { error: `No data returned for ${ticker}. Check the symbol or your ALPHA_VANTAGE_API_KEY (the public "demo" key only serves IBM).`, warnings: result.data.warnings },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Analysis failed" }, { status: 500 });
  }
}
