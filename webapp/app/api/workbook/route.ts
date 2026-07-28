import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { buildWorkbook } from "@/lib/workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Provide a valid ticker (?ticker=NVDA)" }, { status: 400 });
  }
  try {
    const analysis = await buildAnalysis(ticker);
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
