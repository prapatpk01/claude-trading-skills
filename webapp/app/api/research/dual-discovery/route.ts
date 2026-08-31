import { NextRequest, NextResponse } from "next/server";
import { universeForSector } from "@/lib/sectorUniverse";
import { DEFAULT_THEME, isThemeId, THEMATIC_UNIVERSES } from "@/lib/thematicUniverse";
import { runDualDiscoveryV39 } from "@/lib/research/dualDiscoveryV39";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();

export async function GET(req: NextRequest) {
  const topRaw = Number(req.nextUrl.searchParams.get("top") ?? 10);
  const topN = Number.isFinite(topRaw) ? Math.max(3, Math.min(20, Math.round(topRaw))) : 10;
  const sector = String(req.nextUrl.searchParams.get("sector") ?? "All").trim();
  const themeRaw = String(req.nextUrl.searchParams.get("theme") ?? DEFAULT_THEME).trim().toLowerCase();
  const theme = isThemeId(themeRaw) ? themeRaw : DEFAULT_THEME;
  const rawTickers = String(req.nextUrl.searchParams.get("tickers") ?? "");
  const explicit = rawTickers.split(",").map(clean).filter(ticker => TICKER.test(ticker)).slice(0, 80);

  try {
    const allowedTickers = explicit.length ? explicit : sector !== "All" ? universeForSector(sector) : undefined;
    const thesisTickers = THEMATIC_UNIVERSES[theme]?.tickers ?? [];
    const result = await runDualDiscoveryV39({ topN, allowedTickers, thesisTickers });
    return NextResponse.json({
      ...result,
      request: {
        sector,
        theme,
        explicitTickers: explicit,
      },
      policy: {
        researchOnly: true,
        automaticTrading: false,
        approvedAutomaticUniverse: ["S&P 500", "Nasdaq-100", "Russell 2000"],
        discoveryRequiresValuation: false,
        committeeReadyRequiresValuation: true,
        lanes: ["MOMENTUM", "THESIS"],
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({
      error: error?.message ?? "INV Research V39 dual discovery failed",
      version: "39.0",
      policy: { researchOnly: true, automaticTrading: false },
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
