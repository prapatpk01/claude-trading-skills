import { runDualDiscoveryV39, type DualDiscoveryOptionsV39 } from "@/lib/research/dualDiscoveryV39";
import {
  FORWARD_BET_DOCTRINE_V40,
  ORGANIZATION_STRATEGY_V40,
  anticipatorySizingV40,
  forwardThesisScoreV40,
  smartMoneyFootprintScoreV40,
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
    aboveEma20: row.fastScore != null ? Number(row.fastScore) >= 55 : null,
    aboveEma50: row.lifecycleStage && !["BROKEN", "WEAKENING"].includes(String(row.lifecycleStage).toUpperCase()) ? true : null,
    ema20Above50: ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION", "MATURE"].includes(String(row.lifecycleStage ?? "").toUpperCase()) ? true : null,
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

function transform(row: AnyRow): AnyRow {
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
  const sizing = anticipatorySizingV40({
    convictionScore: anticipationScore,
    smartMoneyScore,
    thesisInvalidated,
    hardRiskBlock,
  });

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
    strategicState,
    forwardBet: true,
    newsConfirmationRequired: false,
    whyNow: row.whyNow
      ? `${row.whyNow} · V40 Smart Money ${smartMoneyScore}/100 · Forward Thesis ${forwardThesisScore}/100`
      : `V40 Smart Money ${smartMoneyScore}/100 · Forward Thesis ${forwardThesisScore}/100`,
  };
}

function rank(rows: AnyRow[], topN: number): AnyRow[] {
  return [...rows]
    .map((row): AnyRow => transform(row))
    .sort((a: AnyRow, b: AnyRow) => Number(b.score ?? 0) - Number(a.score ?? 0) || Number(b.smartMoneyScore ?? 0) - Number(a.smartMoneyScore ?? 0) || String(a.ticker).localeCompare(String(b.ticker)))
    .slice(0, Math.max(1, topN));
}

export async function runDualDiscoveryV40(options: DualDiscoveryOptionsV40 = {}) {
  const base = await runDualDiscoveryV39(options);
  const topN = Math.max(3, Math.min(20, Math.round(Number(options.topN ?? 10))));
  const momentum: AnyRow[] = rank(base.momentum as AnyRow[], topN);
  const thesis: AnyRow[] = rank(base.thesis as AnyRow[], topN);

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

  return {
    ...base,
    version: ORGANIZATION_STRATEGY_V40,
    strategyVersion: ORGANIZATION_STRATEGY_V40,
    strategy: FORWARD_BET_DOCTRINE_V40,
    momentum,
    thesis,
    combined,
    methodology: "V40 Forward Bet: Anticipate → Accumulate → Confirm → Scale. Discovery ranks smart-money footprint and forward thesis ahead of headline confirmation; committee authorization and human approval remain separate.",
  };
}
