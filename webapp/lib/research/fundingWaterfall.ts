export type FundingWaterfallInput = {
  requestedInvestmentUsd: number;
  cashBufferExcessUsd: number;
  approvedTrimProceedsUsd: number;
  executedSellProceedsUsd?: number;
};

export type FundingWaterfall = {
  requestedInvestmentUsd: number;
  fromCashBufferExcessUsd: number;
  fromApprovedTrimUsd: number;
  fromExecutedSellUsd: number;
  unfundedUsd: number;
  noSaleRequired: boolean;
  trimRequired: boolean;
  sellRequired: boolean;
};

const money = (value: number) => Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 100) / 100;

/**
 * Funding priority for new investment drafts:
 * 1) deploy only the Cash Buffer amount above the CIO target/floor,
 * 2) then use approved TRIM proceeds,
 * 3) then use SELL proceeds only after the sale has actually executed.
 *
 * SELL REVIEW potential is intentionally excluded: a review is not cash.
 */
export function buildFundingWaterfall(input: FundingWaterfallInput): FundingWaterfall {
  const requestedInvestmentUsd = money(input.requestedInvestmentUsd);
  let remaining = requestedInvestmentUsd;

  const fromCashBufferExcessUsd = money(Math.min(remaining, money(input.cashBufferExcessUsd)));
  remaining = money(remaining - fromCashBufferExcessUsd);

  const fromApprovedTrimUsd = money(Math.min(remaining, money(input.approvedTrimProceedsUsd)));
  remaining = money(remaining - fromApprovedTrimUsd);

  const fromExecutedSellUsd = money(Math.min(remaining, money(input.executedSellProceedsUsd ?? 0)));
  remaining = money(remaining - fromExecutedSellUsd);

  return {
    requestedInvestmentUsd,
    fromCashBufferExcessUsd,
    fromApprovedTrimUsd,
    fromExecutedSellUsd,
    unfundedUsd: remaining,
    noSaleRequired: fromApprovedTrimUsd <= 0 && fromExecutedSellUsd <= 0,
    trimRequired: fromApprovedTrimUsd > 0,
    sellRequired: fromExecutedSellUsd > 0,
  };
}
