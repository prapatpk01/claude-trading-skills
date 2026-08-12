import { NextResponse } from "next/server";
import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function reconcileFreshCash(snapshot: Awaited<ReturnType<typeof buildCashBufferSnapshot>>) {
  const sb = getSupabaseAdmin() ?? getSupabase();
  if (!sb) return snapshot;

  const { data, error } = await sb.rpc("sentinel_cash_summary");
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return snapshot;

  const investmentCash = finite(row.investment_cash) ?? snapshot.investmentCash;
  const dividendGrossCash = finite(row.dividend_gross_cash) ?? snapshot.dividendGrossCash;
  const dividendTax = finite(row.dividend_tax) ?? snapshot.dividendTax;
  const dividendNet = finite(row.dividend_net) ?? snapshot.dividendNet;
  const dividendWithdrawn = finite(row.dividend_withdrawn) ?? snapshot.dividendWithdrawn;
  const dividendAvailable = finite(row.dividend_available) ?? snapshot.dividendAvailable;
  const realizedInvestmentProfit = finite(row.realized_investment_profit) ?? snapshot.realizedInvestmentProfit;

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
    cashFreshness: "DATABASE_AGGREGATE_RPC",
  };
}

export async function GET() {
  try {
    const snapshot = await buildCashBufferSnapshot();
    const reconciled = await reconcileFreshCash(snapshot);
    return NextResponse.json(reconciled, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
  } catch (error: any) {
    const message = error?.message ?? "Cash buffer analysis failed.";
    return NextResponse.json({ error: message }, { status: message === "Supabase is not configured." ? 503 : 500 });
  }
}
