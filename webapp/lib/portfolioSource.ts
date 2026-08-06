// One place the whole app asks "what does the fund own right now?".
//
// Since v13 the answer is derived from portfolio_transactions and exposed as
// the live_holdings_ledger view. The older `holdings` table is still there, and
// most routes were still reading it directly — which is how two panels came to
// print two different NAVs for the same portfolio on the same screen.
//
// The difference is not cosmetic. A row that exists in `holdings` with no
// transactions behind it is invisible to the ledger view and counted by
// everything else. Whichever way that lands, one of the two numbers on screen
// is wrong, and nothing tells the reader which.
//
// So: read the ledger, and when the table disagrees, say so by name rather than
// picking a winner silently.

export interface OpenHolding {
  id?: string;
  ticker: string;
  shares: number;
  avg_cost: number;
}

export type HoldingsOrigin =
  | "portfolio_transactions (ledger)"
  | "holdings table (pre-ledger fallback)";

export interface HoldingsRead {
  rows: OpenHolding[];
  origin: HoldingsOrigin;
  /**
   * Tickers the `holdings` table still carries that the transaction ledger does
   * not back. They are excluded from NAV, and named so the gap is visible.
   */
  unbacked: string[];
  /**
   * Tickers whose stored share count disagrees with the count derived from
   * transactions. The derived number wins; the disagreement is reported.
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

/**
 * Open positions as the ledger sees them.
 *
 * `sb` is a Supabase client. Callers that have no client should not call this —
 * the in-memory store has no ledger and its own filter is the whole truth.
 */
export async function loadOpenHoldings(sb: any): Promise<HoldingsRead> {
  const ledger = await sb
    .from("live_holdings_ledger")
    .select("id,ticker,shares,avg_cost,ledger_shares,closed_at")
    .then((r: any) => r, () => ({ data: null, error: { message: "view unavailable" } }));

  // Pre-migration deployments have no view. Fall back and say which source ran.
  if (ledger.error || !Array.isArray(ledger.data)) {
    let { data, error } = await sb.from("holdings").select("id,ticker,shares,avg_cost,closed_at");
    if (error && /closed_at/i.test(error.message ?? "")) {
      ({ data, error } = await sb.from("holdings").select("id,ticker,shares,avg_cost"));
    }
    if (error) throw new Error(error.message);
    const rows = (data ?? [])
      .filter((row: any) => !row?.closed_at && (finite(row?.shares) ?? 0) > 0)
      .map((row: any) => normalise(row, finite(row.shares) ?? 0));
    return {
      rows,
      origin: "holdings table (pre-ledger fallback)",
      unbacked: [],
      shareMismatches: [],
      note: "The transaction ledger view is not available on this database, so positions were read from the holdings table. Run the v13 migration to restore ledger-derived positions.",
    };
  }

  const shareMismatches: HoldingsRead["shareMismatches"] = [];
  const rows: OpenHolding[] = [];
  for (const row of ledger.data) {
    // Derived, not duplicated: the transaction count is the position.
    const derived = finite(row?.ledger_shares);
    const stored = finite(row?.shares);
    const shares = derived ?? stored ?? 0;
    if (shares <= 0) continue;
    if (derived != null && stored != null && Math.abs(derived - stored) > 1e-6) {
      shareMismatches.push({ ticker: String(row.ticker).toUpperCase(), stored, derived });
    }
    rows.push(normalise(row, shares));
  }

  // Anything the old table still shows as open but the ledger does not back.
  let unbacked: string[] = [];
  try {
    const { data: tableRows } = await sb.from("holdings").select("ticker,shares,closed_at");
    if (Array.isArray(tableRows)) {
      const inLedger = new Set(rows.map((r) => r.ticker));
      unbacked = tableRows
        .filter((row: any) => !row?.closed_at && (finite(row?.shares) ?? 0) > 0)
        .map((row: any) => String(row.ticker).toUpperCase())
        .filter((ticker: string) => !inLedger.has(ticker));
    }
  } catch {
    // The comparison is diagnostic. Losing it must not lose the positions.
  }

  const parts: string[] = [];
  if (unbacked.length) {
    parts.push(
      `${unbacked.join(", ")} ${unbacked.length === 1 ? "is" : "are"} recorded in the holdings table with no transactions behind ${unbacked.length === 1 ? "it" : "them"}, so ${unbacked.length === 1 ? "it is" : "they are"} excluded from NAV. Record the opening trade, or close the row.`
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
