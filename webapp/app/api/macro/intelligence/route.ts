import { NextResponse } from "next/server";
import { buildMacroOutlook } from "@/lib/macroOutlook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

function probabilities(score: number, horizonMonths: number) {
  const meanReversion = horizonMonths >= 12 ? 0.55 : horizonMonths >= 6 ? 0.7 : horizonMonths >= 3 ? 0.85 : 1;
  const adjusted = 50 + (score - 50) * meanReversion;
  const bull = clamp(Math.round(18 + adjusted * 0.42), 15, 60);
  const bear = clamp(Math.round(48 - adjusted * 0.34), 12, 50);
  return { bull, base: 100 - bull - bear, bear };
}

export async function GET() {
  try {
    const outlook = await buildMacroOutlook();
    const indicatorEntries = Object.entries(outlook.indicators ?? {});
    const available = indicatorEntries.filter(([, value]) => finite(value) != null).length;
    const completenessPct = indicatorEntries.length ? Math.round(available / indicatorEntries.length * 100) : 0;
    const confidence = completenessPct >= 85 && outlook.warnings.length === 0 ? "HIGH" : completenessPct >= 60 ? "MEDIUM" : "LOW";

    const horizons = [1, 3, 6, 12].map((months) => {
      const p = probabilities(outlook.score, months);
      const riskBudget = months <= 3 ? outlook.riskBudgetPct : Math.round(65 + (outlook.riskBudgetPct - 65) * (months === 6 ? 0.75 : months === 12 ? 0.55 : 0.9));
      const cashFloor = months <= 3 ? outlook.cashFloorPct : Math.round(15 + (outlook.cashFloorPct - 15) * (months === 6 ? 0.75 : months === 12 ? 0.55 : 0.9));
      return {
        months,
        label: `${months}M`,
        probabilities: p,
        riskBudgetPct: clamp(riskBudget, 20, 100),
        cashFloorPct: clamp(cashFloor, 5, 40),
        stance: p.bull >= 45 ? "SELECTIVE_RISK_ON" : p.bear >= 38 ? "DEFENSIVE" : "BALANCED",
      };
    });

    const evidence = indicatorEntries.map(([key, value]) => ({
      key,
      value: finite(value),
      status: finite(value) == null ? "MISSING" : "VERIFIED",
      sourceClass: key.toLowerCase().includes("cpi") || key.toLowerCase().includes("unemployment") || key.toLowerCase().includes("payroll") ? "OFFICIAL_ECONOMIC" : "MARKET_PRICE",
    }));

    return NextResponse.json({
      version: "v8.4",
      asOf: outlook.asOf,
      regime: { score: outlook.score, label: outlook.regime, labelTh: outlook.regimeTh },
      confidence,
      evidenceCompletenessPct: completenessPct,
      evidence,
      horizons,
      vision: { en: outlook.vision, th: outlook.visionTh },
      scenarios: outlook.scenarios,
      allocationTilt: { en: outlook.allocationTilt, th: outlook.allocationTiltTh },
      headlines: outlook.headlines,
      warnings: outlook.warnings,
      policy: {
        missingEvidenceReducesConfidence: true,
        probabilitiesSumTo100: true,
        automaticTrading: false,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Macro intelligence failed." }, { status: 500 });
  }
}
