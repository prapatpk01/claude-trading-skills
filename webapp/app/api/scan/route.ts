import { NextRequest, NextResponse } from "next/server";
import { runDividendScan, DIVIDEND_UNIVERSE } from "@/lib/dividendScan";
import { runMomentumV61, MOMENTUM_V61_UNIVERSE } from "@/lib/momentumV61";
import { runThematicPortfolio, type RebalanceCadence } from "@/lib/thematicPortfolio";
import { universeForSector } from "@/lib/sectorUniverse";

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
    if (mode === "thematic") {
      const holdings = Math.min(10, Math.max(5, parseInt(req.nextUrl.searchParams.get("holdings") ?? "8", 10) || 8));
      const cadence: RebalanceCadence = req.nextUrl.searchParams.get("cadence") === "quarterly" ? "quarterly" : "monthly";
      return NextResponse.json(await runThematicPortfolio(holdings, cadence));
    }
    if (mode === "dividend") {
      const universe = explicit?.length ? explicit : sector === "All" ? DIVIDEND_UNIVERSE : universeForSector(sector);
      return NextResponse.json({ ...(await runDividendScan(universe, topN)), universeSource: explicit?.length ? "explicit" : sector === "All" ? "dividend-quality-universe" : "sector", sector });
    }
    const universe = explicit?.length ? explicit : sector === "All" ? MOMENTUM_V61_UNIVERSE : universeForSector(sector);
    return NextResponse.json({ ...(await runMomentumV61(universe, topN)), universeSource: explicit?.length ? "explicit" : sector === "All" ? "high-beta-liquid-universe" : "sector", sector });
  } catch (e:any) {
    return NextResponse.json({ error: e?.message ?? "Scan failed" }, { status: 500 });
  }
}
