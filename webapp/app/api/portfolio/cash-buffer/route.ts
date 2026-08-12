import { NextResponse } from "next/server";
import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export const maxDuration = 60;

const DIVIDEND_WITHDRAWAL_TAG = "[DIVIDEND_WITHDRAWAL]";

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function classifyFreshCash(rows: Array<{ entry_type?: string | null; amount?: unknown; notes?: string | null }>) {
  let investmentCash = 0;
  let dividendGrossCash = 0;
  let dividendTax = 0;
  let dividendWithdrawn = 0;

  for (const row of rows) {
    const amount = finite(row.amount) ?? 0;
    if (row.entry_type === "DIVIDEND") {
      dividendGrossCash += Math.max(0, amount);
      continue;
    }
    if (row.entry_type === "TAX") {
      dividendTax += Math.abs(Math.min(0, amount));
      continue;
    }
    if (row.entry_type === "WITHDRAWAL" && String(row.notes ?? "").includes(DIVIDEND_WITHDRAWAL_TAG)) {
      dividendWithdrawn += Math.abs(Math.min(0, amount));
      continue;
    }
    investmentCash += amount;
  }

  if (Math.abs(investmentCash) < 0.005) investmentCash = 0;
  const dividendNet = Math.max(0, dividendGrossCash - dividendTax);
  const dividendAvailable = Math.max(0, dividendNet - dividendWithdrawn);

  return {
    investmentCash,
    dividendGrossCash,
    dividendTax,
    dividendNet,
    dividendWithdrawn,
    dividendAvailable,
    realizedInvestmentProfit: dividendWithdrawn,
  };
}

async function reconcileFreshCash(snapshot: Awaited<ReturnType<typeof buildCashBufferSnapshot>>) {
  // IMPORTANT: read the ledger again *after* the slower market/holding snapshot
  // has finished. A manual SET_BALANCE can happen while buildCashBufferSnapshot
  // is fetching quotes. Reading cash only at the beginning let an older request
  // overwrite a just-saved broker balance in the UI. The admin client is used
  // when available so this final read is the authoritative database state.
  const sb = getSupabaseAdmin() ?? getSupabase();
  if (!sb) return snapshot;

  const { data: rows, error } = await sb
    .from("cash_ledger")
    .select("entry_type,amount,notes");

  if (error || !rows) {
    return {
      ...snapshot,
      cashFreshness: "SNAPSHOT_FALLBACK",
      cashFreshnessError: error?.message ?? "Fresh cash ledger read returned no rows.",
    };
  }

  const cash = classifyFreshCash(rows);
  const investmentCash = cash.investmentCash;
  const dividendGrossCash = cash.dividendGrossCash;
  const dividendTax = cash.dividendTax;
  const dividendNet = cash.dividendNet;
  const dividendWithdrawn = cash.dividendWithdrawn;
  const dividendAvailable = cash.dividendAvailable;
  const realizedInvestmentProfit = cash.realizedInvestmentProfit;

  const liquidCash = investmentCash + dividendAvailable;
  const totalReserveAssets = liquidCash + snapshot.reserveMarketValue;
  const haircutAdjustedReserveAssets = liquidCash + snapshot.reserveLiquidityValue;
  const totalNav = snapshot.totalNav;
  const bufferPct = totalNav != null && totalNav > 0 ? (totalReserveAssets / totalNav) * 100 : null;
  const targetValue = totalNav != null ? totalNav * snapshot.targetPct / 100 : null;
  const gapValue = targetValue != null ? totalReserveAssets - targetValue : null;
  const shortfallValue = gapValue != null ? Math.max(0, -gapValue) : null;
  const deployableCash = gapValue != null ? Math.max(0, gapValue) : null;
  const posture = bufferPct == null
    ? "UNVERIFIED"
    : bufferPct < snapshot.targetPct
      ? "UNDERFUNDED"
      : bufferPct > snapshot.overfundedThresholdPct
        ? "OVERFUNDED"
        : "ON_TARGET";
  const action = posture === "UNDERFUNDED"
    ? "RAISE_BUFFER"
    : posture === "OVERFUNDED"
      ? "DEPLOY_EXCESS"
      : posture === "ON_TARGET"
        ? "MAINTAIN"
        : "VERIFY_PRICES";

  return {
    ...snapshot,
    cashBalance: investmentCash,
    investmentCash,
    dividendGrossCash,
    dividendTax,
    dividendNet,
    dividendWithdrawn,
    dividendAvailable,
    realizedInvestmentProfit,
    liquidCash,
    totalReserveAssets,
    haircutAdjustedReserveAssets,
    grossBuffer: totalReserveAssets,
    liquidityBuffer: totalReserveAssets,
    riskAdjustedLiquidityBuffer: haircutAdjustedReserveAssets,
    bufferPct,
    targetValue,
    gapValue,
    shortfallValue,
    deployableCash,
    posture,
    action,
    cashFreshness: "DIRECT_DATABASE_FINAL_READ",
  };
}

export async function GET() {
  try {
    const snapshot = await buildCashBufferSnapshot();
    const reconciled = await reconcileFreshCash(snapshot);
    return NextResponse.json(reconciled, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      },
    });
  } catch (error: any) {
    const message = error?.message ?? "Cash buffer analysis failed.";
    return NextResponse.json(
      { error: message },
      {
        status: message === "Supabase is not configured." ? 503 : 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      },
    );
  }
}
