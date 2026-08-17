import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { buildWorkbook } from "@/lib/workbook";
import { governThomasSnapshot, resolveThomasValuationForMarketData } from "@/lib/thomasValuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Provide a valid ticker (?ticker=NVDA)" }, { status: 400 });
  }
  try {
    const analysis = await buildAnalysis(ticker);
    const snapshot = await resolveThomasValuationForMarketData(analysis.data, { dividends: [] }).catch(() => null);
    const governed = governThomasSnapshot(snapshot, analysis.data.quote?.price ?? null);
    if (!governed.decisionReady || governed.fairValue == null) {
      return NextResponse.json({ error: `Workbook blocked: ${governed.reason}` }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }
    analysis.targetPrice = governed.fairValue;
    analysis.upsidePct = governed.valuationGapPct ?? 0;
    analysis.expectedReturnPct = governed.valuationGapPct;
    analysis.valuationNote = governed.reason;
    analysis.thesis = analysis.thesis.map(scenario => ({ ...scenario, targetPrice: scenario.label === "Bear" ? governed.bearValue ?? governed.fairValue! : scenario.label === "Bull" ? governed.bullValue ?? governed.fairValue! : governed.fairValue! }));
    const buffer = await buildWorkbook(analysis);
    const filename = `${ticker}_Equity_Research_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Workbook generation failed" }, { status: 500 });
  }
}
