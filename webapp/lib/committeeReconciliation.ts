export type ReconciliationStatus = "MATCHED" | "DIFFERENT" | "NOT_FOUND";

export interface ReconciliationMotion {
  id: string;
  ticker: string;
  kind: string;
  proposedUsd?: number | null;
  proposedShares?: number | null;
}

export interface PortfolioTransaction {
  id: string;
  ticker: string;
  side: string;
  shares: number | string;
  price: number | string;
  trade_date: string;
  created_at?: string | null;
}

export interface ReconciliationMatch {
  resolutionId: string;
  ticker: string;
  kind: string;
  expectedSide: "BUY" | "SELL";
  status: ReconciliationStatus;
  actualShares: number | null;
  actualPrice: number | null;
  actualValueUsd: number | null;
  variancePct: number | null;
  transactionIds: string[];
  note: string;
}

export const DEFAULT_RECONCILIATION_TOLERANCE_PCT = 40;

const SELL_KINDS = new Set(["EXIT", "TRIM", "RAISE CASH"]);
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function expectedSide(kind: string): "BUY" | "SELL" {
  return SELL_KINDS.has(String(kind).trim().toUpperCase()) ? "SELL" : "BUY";
}

export function reconcileCommitteeMotions(
  motions: ReconciliationMotion[],
  transactions: PortfolioTransaction[],
  sinceDate: string,
  tolerancePct = DEFAULT_RECONCILIATION_TOLERANCE_PCT,
): ReconciliationMatch[] {
  const floor = /^\d{4}-\d{2}-\d{2}$/.test(sinceDate) ? sinceDate : "0000-00-00";

  return motions.map((motion) => {
    const ticker = String(motion.ticker ?? "").trim().toUpperCase();
    const kind = String(motion.kind ?? "").trim().toUpperCase();
    const side = expectedSide(kind);
    const matches = transactions.filter((transaction) =>
      String(transaction.ticker ?? "").trim().toUpperCase() === ticker &&
      String(transaction.side ?? "").trim().toUpperCase() === side &&
      String(transaction.trade_date ?? "") >= floor
    );

    const totals = matches.reduce((summary, transaction) => {
      const shares = finite(transaction.shares);
      const price = finite(transaction.price);
      if (shares == null || shares <= 0 || price == null || price < 0) return summary;
      summary.shares += shares;
      summary.value += shares * price;
      return summary;
    }, { shares: 0, value: 0 });

    if (!matches.length || totals.shares <= 0) {
      return {
        resolutionId: motion.id, ticker, kind, expectedSide: side,
        status: "NOT_FOUND" as const,
        actualShares: null, actualPrice: null, actualValueUsd: null,
        variancePct: null, transactionIds: [],
        note: `No ${side} transaction for ${ticker} was recorded on or after ${floor}.`,
      };
    }

    const proposedValue = Math.abs(finite(motion.proposedUsd) ?? 0);
    const proposedShares = Math.abs(finite(motion.proposedShares) ?? 0);
    const actualValue = totals.value;
    const actualPrice = totals.value / totals.shares;
    const varianceBase = proposedValue > 0
      ? { actual: actualValue, proposed: proposedValue }
      : proposedShares > 0
      ? { actual: totals.shares, proposed: proposedShares }
      : null;
    const variancePct = varianceBase
      ? ((varianceBase.actual / varianceBase.proposed) - 1) * 100
      : 0;
    const status: ReconciliationStatus = Math.abs(variancePct) <= Math.max(0, tolerancePct) ? "MATCHED" : "DIFFERENT";

    return {
      resolutionId: motion.id, ticker, kind, expectedSide: side, status,
      actualShares: Math.round(totals.shares * 1e7) / 1e7,
      actualPrice: Math.round(actualPrice * 1e4) / 1e4,
      actualValueUsd: Math.round(actualValue * 100) / 100,
      variancePct: Math.round(variancePct * 10) / 10,
      transactionIds: matches.map((transaction) => String(transaction.id)),
      note: status === "MATCHED"
        ? `${side} ${ticker} was found in the portfolio ledger within the ${tolerancePct}% tolerance.`
        : `${side} ${ticker} was found, but the recorded size differs from the proposal by ${Math.abs(variancePct).toFixed(1)}%.`,
    };
  });
}
