// One place the whole app asks "what does the fund own right now?".
//
// Since v13 the preferred answer is derived from portfolio_transactions and
// exposed as the live_holdings_ledger view. The broker-reconciled holdings table
// is still read as an independent safety check. A current fund screen must never
// silently become a zero-dollar portfolio because a ledger view is temporarily
// invisible to the runtime, and a closed broker position must never leak back
// into the Investment Committee from an older ledger snapshot.

export interface OpenHolding {
  id?: string;
  ticker: string;
  shares: number;
  avg_cost: number;
}

export type HoldingsOrigin =
  | "portfolio_transactions (ledger)"
  | "holdings table (pre-ledger fallback)"
  | "holdings table (ledger visibility fallback)";

export interface HoldingsRead {
  rows: OpenHolding[];
  origin: HoldingsOrigin;
  /**
   * Tickers the `holdings` table still carries that the transaction ledger does
   * not back. They are excluded from NAV when the ledger is otherwise healthy,
   * and named so the gap is visible.
   */
  unbacked: string[];
  /**
   * Tickers whose stored share count disagrees with the count derived from
   * transactions. The derived number wins while the ledger is healthy.
   */
  shareMismatches: { ticker: string; stored: number; derived: number }[];
  /** Human-readable note for the response, empty when everything agrees. */
  note: string;
}

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalise = (row: any, shares: number): OpenHolding => ({
  id: row?.id,
  ticker: String(row?.ticker ?? "").toUpperCase(),
  shares,
  avg_cost: Math.max(0, finite(row?.avg_cost) ?? 0),
});

async function readHoldingsTable(sb: any) {
  let { data, error } = await sb.from("holdings").select("id,ticker,shares,avg_cost,closed_at");
  if (error && /closed_at/i.test(error.message ?? "")) {
    ({ data, error } = await sb.from("holdings").select("id,ticker,shares,avg_cost"));
  }
  if (error) return { rows: [] as OpenHolding[], error };
  const rows = (data ?? [])
    .filter((row: any) => !row?.closed_at && (finite(row?.shares) ?? 0) > 0)
    .map((row: any) => normalise(row, finite(row.shares) ?? 0));
  return { rows, error: null };
}

/**
 * Open positions as the fund sees them now.
 *
 * The transaction ledger remains preferred. The holdings table is used for two
 * safety duties:
 *  1) a broker-closed row (shares=0 / closed_at set) can never re-enter the
 *     current book through a stale ledger response;
 *  2) if the ledger view returns *zero* rows while the broker-reconciled table
 *     has live positions, treat that as a visibility/runtime failure rather
 *     than declaring the fund NAV to be zero.
 */
export async function loadOpenHoldings(sb: any): Promise<HoldingsRead> {
  const [ledger, tableRead] = await Promise.all([
    sb
      .from("live_holdings_ledger")
      .select("id,ticker,shares,avg_cost,ledger_shares,closed_at")
      .then((r: any) => r, () => ({ data: null, error: { message: "view unavailable" } })),
    readHoldingsTable(sb),
  ]);

  // Pre-migration deployments have no view. Fall back and say which source ran.
  if (ledger.error || !Array.isArray(ledger.data)) {
    if (tableRead.error) throw new Error(tableRead.error.message);
    return {
      rows: tableRead.rows,
      origin: "holdings table (pre-ledger fallback)",
      unbacked: [],
      shareMismatches: [],
      note: "The transaction ledger view is not available on this database, so positions were read from the current broker-reconciled holdings table. Run the v13 migration to restore ledger-derived positions.",
    };
  }

  const tableOpen = tableRead.error ? [] : tableRead.rows;
  const tableOpenTickers = new Set(tableOpen.map((row) => row.ticker));
  const shareMismatches: HoldingsRead["shareMismatches"] = [];
  const rows: OpenHolding[] = [];

  for (const row of ledger.data) {
    const ticker = String(row?.ticker ?? "").toUpperCase();
    // When the table comparison succeeded, its closed state is the broker
    // reconciliation guardrail. This explicitly keeps sold-out names such as a
    // newly closed position out of a stale meeting snapshot.
    if (!tableRead.error && !tableOpenTickers.has(ticker)) continue;

    const derived = finite(row?.ledger_shares);
    const stored = finite(row?.shares);
    const shares = derived ?? stored ?? 0;
    if (shares <= 0 || row?.closed_at) continue;
    if (derived != null && stored != null && Math.abs(derived - stored) > 1e-6) {
      shareMismatches.push({ ticker, stored, derived });
    }
    rows.push(normalise(row, shares));
  }

  // A zero-row ledger paired with a non-empty, broker-reconciled table is not a
  // real empty portfolio. It is almost always view/RLS/runtime visibility. Use
  // the current holdings table rather than letting downstream NAV/quorum become
  // a plausible-looking $0 meeting.
  if (rows.length === 0 && tableOpen.length > 0) {
    return {
      rows: tableOpen,
      origin: "holdings table (ledger visibility fallback)",
      unbacked: tableOpen.map((row) => row.ticker),
      shareMismatches: [],
      note: `The ledger view returned zero open positions while the broker-reconciled holdings table contains ${tableOpen.length}. The current holdings table is being used for this snapshot so the fund is not misreported as empty; ledger visibility should be reviewed.`,
    };
  }

  const inLedger = new Set(rows.map((row) => row.ticker));
  const unbacked = tableOpen.map((row) => row.ticker).filter((ticker) => !inLedger.has(ticker));

  const parts: string[] = [];
  if (unbacked.length) {
    parts.push(
      `${unbacked.join(", ")} ${unbacked.length === 1 ? "is" : "are"} recorded as open in the holdings table with no live ledger position behind ${unbacked.length === 1 ? "it" : "them"}, so ${unbacked.length === 1 ? "it is" : "they are"} excluded from NAV while the ledger is otherwise healthy. Reconcile the broker balance or record the opening trade.`
    );
  }
  if (shareMismatches.length) {
    parts.push(
      `Stored share counts disagree with the ledger for ${shareMismatches.map((m) => `${m.ticker} (${m.stored} stored vs ${m.derived} from transactions)`).join(", ")}. The transaction count is used.`
    );
  }

  return {
    rows,
    origin: "portfolio_transactions (ledger)",
    unbacked,
    shareMismatches,
    note: parts.join(" "),
  };
}
