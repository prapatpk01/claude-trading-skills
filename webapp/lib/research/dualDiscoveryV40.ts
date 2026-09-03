import { runDualDiscoveryV39, type DualDiscoveryOptionsV39 } from "@/lib/research/dualDiscoveryV39";
import { fetchYahooFinance2Fallback, type YahooChartSeries } from "@/lib/research/yahooFinance2Fallback";
import { technicalSnapshotFromSeriesV40 } from "@/lib/research/buyAlertTechnicalV40";
import {
  FORWARD_BET_DOCTRINE_V40,
  ORGANIZATION_STRATEGY_V40,
  anticipatorySizingV40,
  forwardThesisScoreV40,
  smartMoneyFootprintScoreV40,
  technicalBuyGateV40,
} from "@/lib/strategy/organizationStrategyV40";

export type DualDiscoveryOptionsV40 = DualDiscoveryOptionsV39;

type AnyRow = Record<string, any>;

function smartMoney(row: AnyRow) {
  return smartMoneyFootprintScoreV40({
    relativeStrength3m: row.rs3m,
    return1m: row.return1m,
    return3m: row.return3m,
    volumeRatio: row.volumeRatio,
    institutionalScore: row.institutionalScore,
    lifecycleStage: row.lifecycleStage,
    aboveEma20: null,
    aboveEma50: null,
    ema20Above50: null,
  });
}

function forwardScore(row: AnyRow, smartMoneyScore: number) {
  return forwardThesisScoreV40({
    sectorLeadershipScore: row.sectorLeadershipScore,
    catalystScore: row.catalyst ? 65 : null,
    fundFitScore: row.compositeScore,
    growthScore: row.growthScore,
    qualityScore: row.qualityScore,
    smartMoneyScore,
    expectedReturnPct: row.expectedReturnPct,
  });
}

function transform(row: AnyRow, series?: YahooChartSeries): AnyRow {
  const smartMoneyScore = smartMoney(row);
  const forwardThesisScore = forwardScore(row, smartMoneyScore);
  const legacyDiscoveryScore = Number(row.score ?? 0);
  const anticipationScore = Math.round(
    Math.max(0, Math.min(100,
      smartMoneyScore * 0.42 +
      forwardThesisScore * 0.38 +
      legacyDiscoveryScore * 0.20,
    )),
  );

  const thesisInvalidated = Array.isArray(row.hardBlocks) && row.hardBlocks.length > 0;
  const hardRiskBlock = String(row.lifecycleStage ?? "").toUpperCase() === "BROKEN";
  const preliminarySizing = anticipatorySizingV40({
    convictionScore: anticipationScore,
    smartMoneyScore,
    thesisInvalidated,
    hardRiskBlock,
  });
  const technical = series ? technicalSnapshotFromSeriesV40(series) : {};
  const technicalValidation = technicalBuyGateV40(technical);
  const sizing = !technicalValidation.eligible && ["STARTER", "CORE", "SCALE"].includes(preliminarySizing)
    ? "SCOUT"
    : preliminarySizing;
  const buyAlertEligible = !thesisInvalidated && !hardRiskBlock && technicalValidation.eligible;

  const strategicState = thesisInvalidated || hardRiskBlock
    ? "INVALIDATE"
    : sizing === "SCALE" || sizing === "CORE"
      ? "CONFIRM_AND_SCALE"
      : sizing === "STARTER"
        ? "ACCUMULATE_STARTER"
        : sizing === "SCOUT"
          ? "ANTICIPATE_SCOUT"
          : "RESEARCH_ONLY";

  return {
    ...row,
    legacyDiscoveryScore,
    score: anticipationScore,
    smartMoneyScore,
    forwardThesisScore,
    anticipatorySizing: sizing,
    preliminarySizing,
    strategicState,
    alertState: buyAlertEligible ? "BUY_TRIGGER_READY" : "EARLY_WATCH",
    buyAlertEligible,
    technicalTimeframe: "1d",
    technical,
    technicalValidation,
    forwardBet: true,
    newsConfirmationRequired: false,
    whyNow: row.whyNow
      ? `${row.whyNow} · V40 Smart Money ${smartMoneyScore}/100 · Forward Thesis ${forwardThesisScore}/100`
      : `V40 Smart Money ${smartMoneyScore}/100 · Forward Thesis ${forwardThesisScore}/100`,
  };
}

function rank(rows: AnyRow[], topN: number, technicalByTicker: Map<string, YahooChartSeries>): AnyRow[] {
  return [...rows]
    .map((row): AnyRow => transform(row, technicalByTicker.get(String(row.ticker ?? "").toUpperCase())))
    .sort((a: AnyRow, b: AnyRow) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.smartMoneyScore ?? 0) - Number(a.smartMoneyScore ?? 0) || String(a.ticker).localeCompare(String(b.ticker)))
    .slice(0, Math.max(1, topN));
}

export async function runDualDiscoveryV40(options: DualDiscoveryOptionsV40 = {}) {
  const base = await runDualDiscoveryV39(options);
  const topN = Math.max(3, Math.min(20, Math.round(Number(options.topN ?? 10))));
  const technicalTickers = Array.from(new Set(
    [...base.momentum, ...base.thesis].map(row => String(row.ticker ?? "").toUpperCase()).filter(Boolean),
  ));
  let technicalByTicker = new Map<string, YahooChartSeries>();
  let technicalWarnings: string[] = [];
  try {
    const technicalResult = await fetchYahooFinance2Fallback(technicalTickers, {
      maxSymbols: technicalTickers.length,
      concurrency: 12,
    });
    technicalByTicker = technicalResult.series;
    technicalWarnings = technicalResult.warnings;
  } catch (error) {
    technicalWarnings = [error instanceof Error ? error.message : "technical snapshot provider failed"];
  }
  const momentum: AnyRow[] = rank(base.momentum as AnyRow[], topN, technicalByTicker);
  const thesis: AnyRow[] = rank(base.thesis as AnyRow[], topN, technicalByTicker);

  const byTicker = new Map<string, AnyRow & { lanes: string[] }>();
  for (const row of [...momentum, ...thesis] as AnyRow[]) {
    const ticker = String(row.ticker ?? "").toUpperCase();
    const existing = byTicker.get(ticker);
    if (!existing) {
      byTicker.set(ticker, { ...row, lanes: [String(row.lane)] });
      continue;
    }
    const preferred: AnyRow = Number(row.score ?? 0) > Number(existing.score ?? 0) ? row : existing;
    byTicker.set(ticker, {
      ...preferred,
      lanes: Array.from(new Set([...existing.lanes, String(row.lane)])),
      smartMoneyScore: Math.max(Number(existing.smartMoneyScore ?? 0), Number(row.smartMoneyScore ?? 0)),
      forwardThesisScore: Math.max(Number(existing.forwardThesisScore ?? 0), Number(row.forwardThesisScore ?? 0)),
      score: Math.max(Number(existing.score ?? 0), Number(row.score ?? 0)),
    });
  }

  const combined = [...byTicker.values()]
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.smartMoneyScore ?? 0) - Number(a.smartMoneyScore ?? 0))
    .slice(0, topN * 2);
  const buyAlertReady = combined.filter(row => row.buyAlertEligible);
  const warnings = [...base.warnings, ...technicalWarnings.map(warning => `Buy-alert technical validation: ${warning}`)];
  if (!buyAlertReady.length) warnings.push("No candidate passed the fresh daily technical buy-alert gate; all candidates remain EARLY_WATCH.");

  return {
    ...base,
    version: ORGANIZATION_STRATEGY_V40,
    strategyVersion: ORGANIZATION_STRATEGY_V40,
    strategy: FORWARD_BET_DOCTRINE_V40,
    momentum,
    thesis,
    combined,
    buyAlertReady,
    warnings: Array.from(new Set(warnings)),
    methodology: "V40 discovery ranks smart-money footprint and forward thesis. STARTER-or-higher sizing and buy alerts fail closed unless one fresh daily snapshot confirms EMA8>EMA13, EMA100>EMA200, ADX>=20, MACD>signal and positive MACD histogram. Human approval remains separate.",
  };
}
