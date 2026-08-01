import { NextRequest, NextResponse } from "next/server";
import { runDividendScan, DIVIDEND_UNIVERSE } from "@/lib/dividendScan";
import { runMomentumV62, MOMENTUM_V62_UNIVERSE } from "@/lib/momentumV62";
import { runThematicPortfolio, type RebalanceCadence } from "@/lib/thematicPortfolio";
import { universeForSector } from "@/lib/sectorUniverse";
import { guardScanResult } from "@/lib/scanGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("tickers");
  const rawMode = req.nextUrl.searchParams.get("mode");
  const mode: "momentum"|"dividend"|"thematic" = rawMode === "dividend" ? "dividend" : rawMode === "thematic" ? "thematic" : "momentum";
  const sector = req.nextUrl.searchParams.get("sector") || "All";
  const topN = Math.min(10, Math.max(1, parseInt(req.nextUrl.searchParams.get("top") ?? "5", 10) || 5));
  try {
    const explicit = raw ? raw.split(",").map(t=>t.trim().toUpperCase()).filter(t=>/^[A-Z.\-]{1,10}$/.test(t)).slice(0,30) : null;
    if (raw && !explicit?.length) {
      return NextResponse.json({ error: "No valid US-listed ticker symbols were supplied." }, { status: 400 });
    }

    if (mode === "thematic") {
      const holdings = Math.min(10, Math.max(5, parseInt(req.nextUrl.searchParams.get("holdings") ?? "8", 10) || 8));
      const cadence: RebalanceCadence = req.nextUrl.searchParams.get("cadence") === "quarterly" ? "quarterly" : "monthly";
      const rawResult = await runThematicPortfolio(holdings, cadence);
      return NextResponse.json(guardScanResult("thematic", rawResult as any).result);
    }

    if (mode === "dividend") {
      const universe = explicit?.length ? explicit : sector === "All" ? DIVIDEND_UNIVERSE : universeForSector(sector);
      if (!universe.length) return NextResponse.json({ error: `No dividend universe is configured for sector ${sector}.` }, { status: 422 });
      const rawResult = { ...(await runDividendScan(universe, topN)), universeSource: explicit?.length ? "explicit" : sector === "All" ? "dividend-quality-universe" : "sector", sector };
      return NextResponse.json(guardScanResult("dividend", rawResult as any).result);
    }

    const universe = explicit?.length ? explicit : sector === "All" ? MOMENTUM_V62_UNIVERSE : universeForSector(sector);
    if (!universe.length) return NextResponse.json({ error: `No momentum universe is configured for sector ${sector}.` }, { status: 422 });
    const rawResult = { ...(await runMomentumV62(universe, topN)), universeSource: explicit?.length ? "explicit" : sector === "All" ? "high-beta-liquid-universe" : "sector", sector };
    return NextResponse.json(guardScanResult("momentum", rawResult as any).result);
  } catch (e:any) {
    const message = e?.message ?? "Scan failed";
    return NextResponse.json({ error: message, mode, sector, retryable: /timeout|fetch|network|rate/i.test(message) }, { status: 500 });
  }
}
