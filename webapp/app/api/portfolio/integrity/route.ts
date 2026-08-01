import { NextResponse } from "next/server";
import { getSupabaseAdmin, supabaseAdminConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HoldingRow = {
  id: string;
  ticker: string;
  shares: number | string;
  avg_cost: number | string;
  opened_at?: string | null;
  closed_at?: string | null;
};

type TransactionRow = {
  id: string;
  holding_id?: string | null;
  ticker: string;
  side: "BUY" | "SELL";
  shares: number | string;
  price: number | string;
  realized_pnl?: number | string | null;
};

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET() {
  if (!supabaseAdminConfigured()) {
    return NextResponse.json(
      { status: "BLOCKED", productionReady: false, error: "SUPABASE_SERVICE_ROLE_KEY is required for integrity diagnostics." },
      { status: 503 },
    );
  }

  const sb = getSupabaseAdmin();
  if (!sb) return NextResponse.json({ status: "BLOCKED", productionReady: false }, { status: 503 });

  const [holdingsResult, transactionsResult] = await Promise.all([
    sb.from("holdings").select("id,ticker,shares,avg_cost,opened_at,closed_at"),
    sb.from("portfolio_transactions").select("id,holding_id,ticker,side,shares,price,realized_pnl"),
  ]);

  if (holdingsResult.error || transactionsResult.error) {
    return NextResponse.json(
      {
        status: "ERROR",
        productionReady: false,
        error: holdingsResult.error?.message ?? transactionsResult.error?.message ?? "Integrity query failed.",
      },
      { status: 500 },
    );
  }

  const holdings = (holdingsResult.data ?? []) as HoldingRow[];
  const transactions = (transactionsResult.data ?? []) as TransactionRow[];
  const issues: Array<{ severity: "critical" | "warning"; code: string; ticker?: string; detail: string }> = [];

  const openByTicker = new Map<string, HoldingRow[]>();
  const holdingIds = new Set(holdings.map((h) => h.id));

  for (const holding of holdings) {
    const ticker = String(holding.ticker ?? "").toUpperCase();
    const shares = finite(holding.shares);
    const avgCost = finite(holding.avg_cost);

    if (!ticker) issues.push({ severity: "critical", code: "HOLDING_TICKER_MISSING", detail: `Holding ${holding.id} has no ticker.` });
    if (shares == null || shares <= 0) issues.push({ severity: "critical", code: "HOLDING_SHARES_INVALID", ticker, detail: `Shares are ${String(holding.shares)}.` });
    if (avgCost == null || avgCost < 0) issues.push({ severity: "critical", code: "HOLDING_COST_INVALID", ticker, detail: `Average cost is ${String(holding.avg_cost)}.` });
    if (!holding.opened_at) issues.push({ severity: "warning", code: "OPEN_DATE_MISSING", ticker, detail: "Position has no opened_at date." });

    if (!holding.closed_at) {
      const rows = openByTicker.get(ticker) ?? [];
      rows.push(holding);
      openByTicker.set(ticker, rows);
    }
  }

  for (const [ticker, rows] of openByTicker) {
    if (rows.length > 1) issues.push({ severity: "critical", code: "DUPLICATE_OPEN_LOTS", ticker, detail: `${rows.length} open holdings exist.` });
  }

  const ledgerByHolding = new Map<string, number>();
  for (const tx of transactions) {
    const shares = finite(tx.shares);
    const price = finite(tx.price);
    const ticker = String(tx.ticker ?? "").toUpperCase();

    if (!tx.holding_id || !holdingIds.has(tx.holding_id)) {
      issues.push({ severity: "critical", code: "ORPHAN_TRANSACTION", ticker, detail: `Transaction ${tx.id} has no valid holding.` });
    }
    if (shares == null || shares <= 0) issues.push({ severity: "critical", code: "TRANSACTION_SHARES_INVALID", ticker, detail: `Transaction ${tx.id} has invalid shares.` });
    if (price == null || price < 0) issues.push({ severity: "critical", code: "TRANSACTION_PRICE_INVALID", ticker, detail: `Transaction ${tx.id} has invalid price.` });

    if (tx.holding_id && shares != null) {
      const signed = tx.side === "BUY" ? shares : -shares;
      ledgerByHolding.set(tx.holding_id, (ledgerByHolding.get(tx.holding_id) ?? 0) + signed);
    }
  }

  for (const holding of holdings) {
    if (!ledgerByHolding.has(holding.id)) continue; // Legacy holdings predate the v8.2 ledger.
    const ledgerShares = Math.round((ledgerByHolding.get(holding.id) ?? 0) * 1e7) / 1e7;
    const storedShares = Math.round((finite(holding.shares) ?? 0) * 1e7) / 1e7;
    const expected = holding.closed_at ? 0 : storedShares;
    if (Math.abs(ledgerShares - expected) > 1e-7) {
      issues.push({
        severity: "critical",
        code: "LEDGER_POSITION_MISMATCH",
        ticker: holding.ticker,
        detail: `Ledger=${ledgerShares}, expected=${expected}.`,
      });
    }
  }

  const critical = issues.filter((issue) => issue.severity === "critical");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return NextResponse.json({
    version: "v8.3",
    status: critical.length ? "FAILED" : warnings.length ? "WARNING" : "PASS",
    productionReady: critical.length === 0,
    checkedAt: new Date().toISOString(),
    counts: {
      holdings: holdings.length,
      openHoldings: holdings.filter((h) => !h.closed_at).length,
      transactions: transactions.length,
      critical: critical.length,
      warnings: warnings.length,
    },
    issues,
    legacyNote: "Holdings without ledger rows are treated as legacy positions and are not falsely marked mismatched.",
  });
}
