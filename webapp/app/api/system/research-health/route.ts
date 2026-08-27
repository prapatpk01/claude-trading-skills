import { NextResponse } from "next/server";
import { fastScanApprovedUniverse } from "@/lib/research/universeFastScan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Small, diversified, read-only sample. This proves that the same provider
// chain used by Stage A works from the deployed Railway runtime without
// triggering a 2,400-name research meeting or touching portfolio state.
const SAMPLE = ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "JPM", "XOM", "BRK-B", "PLTR"];

export async function GET() {
  const startedAt = Date.now();
  try {
    const scan = await fastScanApprovedUniverse(SAMPLE);
    const ok = scan.coveragePct >= 80;
    const partial = !ok && scan.scanned > 0;
    return NextResponse.json({
      ok,
      partial,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      provider: scan.provider,
      sampleRequested: scan.requested,
      sampleScanned: scan.scanned,
      coveragePct: scan.coveragePct,
      warnings: scan.warnings,
      rows: scan.rows.map(row => ({
        ticker: row.ticker,
        score: row.score,
        stage: row.stage,
        return1m: row.return1m,
        return3m: row.return3m,
        rs3m: row.rs3m,
      })),
      policy: "TradingView bulk -> Yahoo Spark -> yahoo-finance2 chart -> DATA_LIMITED; no fabricated market data",
    }, {
      status: ok ? 200 : partial ? 206 : 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      partial: false,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      provider: null,
      sampleRequested: SAMPLE.length,
      sampleScanned: 0,
      coveragePct: 0,
      warnings: [error instanceof Error ? error.message : "Research provider health check failed"],
      policy: "TradingView bulk -> Yahoo Spark -> yahoo-finance2 chart -> DATA_LIMITED; no fabricated market data",
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
