import { buildUnderwritingPack as buildBase, type UnderwritingPack } from "./stockUnderwriting";

const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const positive = (value: unknown): number | null => {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
};
const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim() : fallback;

function mergeQuarterEvidence(result: any, pack: UnderwritingPack) {
  const data = result?.data ?? {};
  const secRows = Array.isArray(data?.quarters) ? data.quarters : [];
  const earningsRows = Array.isArray(data?.earnings) ? data.earnings : [];
  const existing = Array.isArray(pack?.earnings?.quarters) ? pack.earnings.quarters : [];
  if (existing.length >= 2) return;

  const byPeriod = new Map<string, any>();
  for (const row of secRows) {
    const period = text(row?.end ?? row?.fiscalDate ?? row?.date, "");
    if (!period) continue;
    byPeriod.set(period, {
      period,
      revenue: finite(row?.revenue ?? row?.totalRevenue),
      eps: finite(row?.eps ?? row?.reportedEPS),
      beatMiss: "Unavailable",
      guidance: "Unavailable",
      kpi: row?.revenueYoY == null ? "Unavailable" : `Revenue YoY ${Number(row.revenueYoY).toFixed(1)}%`,
    });
  }
  for (const row of earningsRows) {
    const period = text(row?.fiscalDate ?? row?.reportedDate ?? row?.date, "");
    if (!period) continue;
    const prior = byPeriod.get(period) ?? { period, revenue: null, eps: null, beatMiss: "Unavailable", guidance: "Unavailable", kpi: "Unavailable" };
    const surprise = finite(row?.surprisePercent ?? row?.surprise);
    prior.eps = prior.eps ?? finite(row?.reportedEPS ?? row?.epsActual ?? row?.eps);
    prior.beatMiss = surprise == null ? prior.beatMiss : `${surprise >= 0 ? "+" : ""}${surprise.toFixed(1)}% surprise`;
    byPeriod.set(period, prior);
  }
  const merged = [...byPeriod.values()].sort((a, b) => String(b.period).localeCompare(String(a.period))).slice(0, 8);
  if (merged.length) pack.earnings.quarters = merged;
}

function repairGovernedValuation(result: any, pack: UnderwritingPack) {
  const governed = result?.valuationGovernance ?? {};
  const governedFair = positive(governed?.fairValue);
  const governedBear = positive(governed?.bearValue);
  const governedBull = positive(governed?.bullValue);
  const governedTarget = positive(result?.targetPrice);

  pack.valuation.price = positive(pack.valuation.price);
  pack.valuation.fairValue = positive(pack.valuation.fairValue) ?? governedFair;
  pack.valuation.targetPrice = positive(pack.valuation.targetPrice) ?? governedTarget ?? governedFair;
  pack.technical.entryZoneLow = positive(pack.technical.entryZoneLow);
  pack.technical.entryZoneHigh = positive(pack.technical.entryZoneHigh);
  pack.technical.stopLoss = positive(pack.technical.stopLoss);

  pack.dcf.fairValue = positive(pack.dcf.fairValue);
  pack.dcf.baseValue = positive(pack.dcf.baseValue);
  pack.dcf.bearValue = positive(pack.dcf.bearValue);
  pack.dcf.bullValue = positive(pack.dcf.bullValue);
  pack.dcf.sensitivity = (pack.dcf.sensitivity ?? []).map((cell) => ({ ...cell, value: positive(cell.value) }));

  if (!pack.dcf.baseValue && governedFair && pack.dcf.status !== "MODEL_AVAILABLE") {
    // Governed valuation may come from multiples/Thomas rather than DCF. Make it
    // available to the price map, but never relabel it as a DCF sensitivity.
    pack.valuation.fairValue = governedFair;
    if (!pack.valuation.targetPrice) pack.valuation.targetPrice = governedFair;
  }

  if (governed.decisionReady && governedFair) {
    pack.valuation.status = "GOVERNED";
    if (governedBear || governedBull) {
      pack.thesis.bear = governedBear ? `${pack.thesis.bear} Governed downside reference: $${governedBear.toFixed(2)}.` : pack.thesis.bear;
      pack.thesis.bull = governedBull ? `${pack.thesis.bull} Governed upside reference: $${governedBull.toFixed(2)}.` : pack.thesis.bull;
    }
  }
}

function scrubScenarioZeros(pack: UnderwritingPack) {
  for (const scenario of pack.forecast.scenarios ?? []) {
    scenario.years = (scenario.years ?? []).map((year) => ({
      ...year,
      revenue: positive(year.revenue),
      operatingIncome: finite(year.operatingIncome),
      netIncome: finite(year.netIncome),
      freeCashFlow: finite(year.freeCashFlow),
    }));
  }
}

/**
 * V12.3 presentation repair layer.
 *
 * The underlying institutional decision logic is unchanged. This layer only:
 * - prevents missing valuation inputs from leaking into the UI as $0.00,
 * - merges EPS-only earnings evidence with SEC quarterly revenue when available,
 * - exposes Thomas-governed fair value to the price map without pretending it is DCF,
 * - keeps modeled scenario revenue unavailable when the starting revenue is not positive.
 */
export function buildUnderwritingPackV123(result: any, context?: { engine?: string | null; horizon?: string | null }): UnderwritingPack {
  const pack = buildBase(result, context);
  mergeQuarterEvidence(result, pack);
  repairGovernedValuation(result, pack);
  scrubScenarioZeros(pack);
  return pack;
}
