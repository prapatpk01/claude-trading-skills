import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getLightQuote } from "@/lib/marketData";
import { yahooCandles } from "@/lib/yahoo";
import { loadOpenHoldings } from "@/lib/portfolioSource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Holding = { ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type ReserveRule = { label: string; haircut: number; tier: "cash" | "treasury" | "credit" };
const DIVIDEND_WITHDRAWAL_TAG = "[DIVIDEND_WITHDRAWAL]";
const RESERVE_RULES: Record<string, ReserveRule> = {
  SGOV: { label: "0–3 Month US Treasury", haircut: 1.0, tier: "treasury" },
  BIL: { label: "1–3 Month US Treasury", haircut: 1.0, tier: "treasury" },
  SHV: { label: "Short Treasury", haircut: 0.99, tier: "treasury" },
  USFR: { label: "Floating Rate Treasury", haircut: 0.99, tier: "treasury" },
  TFLO: { label: "Floating Rate Treasury", haircut: 0.99, tier: "treasury" },
  ICSH: { label: "Ultra Short Bond", haircut: 0.95, tier: "credit" },
  JPST: { label: "Ultra Short Income", haircut: 0.94, tier: "credit" },
  JAAA: { label: "AAA CLO Income", haircut: 0.9, tier: "credit" },
};

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function classifyCash(rows: Array<{ entry_type?: string | null; amount?: unknown; notes?: string | null }>) {
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
  const dividendNet = Math.max(0, dividendGrossCash - dividendTax);
  const dividendAvailable = Math.max(0, dividendNet - dividendWithdrawn);
  return { investmentCash, dividendGrossCash, dividendTax, dividendNet, dividendWithdrawn, dividendAvailable, realizedInvestmentProfit: dividendWithdrawn };
}

const sma = (values: number[], length: number): number | null => {
  if (values.length < length) return null;
  const slice = values.slice(-length);
  return slice.reduce((sum, value) => sum + value, 0) / length;
};

async function marketRegime() {
  const [spy, qqq, vix] = await Promise.all([
    yahooCandles("SPY", 90).catch(() => []),
    yahooCandles("QQQ", 90).catch(() => []),
    yahooCandles("^VIX", 45).catch(() => []),
  ]);
  const scoreIndex = (rows: typeof spy) => {
    const closes = rows.map((row) => row.close).filter((value) => Number.isFinite(value) && value > 0);
    const last = closes.at(-1) ?? null;
    const ma20 = sma(closes, 20);
    const ma50 = sma(closes, 50);
    if (last == null || ma20 == null || ma50 == null) return { score: 50, last, ma20, ma50, complete: false };
    let score = 50;
    score += last > ma20 ? 15 : -15;
    score += ma20 > ma50 ? 15 : -15;
    score += last > ma50 ? 10 : -10;
    return { score, last, ma20, ma50, complete: true };
  };
  const spyState = scoreIndex(spy);
  const qqqState = scoreIndex(qqq);
  const vixLast = vix.at(-1)?.close ?? null;
  let score = Math.round((spyState.score + qqqState.score) / 2);
  if (vixLast != null) score += vixLast < 18 ? 5 : vixLast > 25 ? -10 : 0;
  score = Math.max(0, Math.min(100, score));
  const classification = score >= 65 ? "RISK_ON" : score <= 40 ? "RISK_OFF" : "NEUTRAL";
  const targetPct = classification === "RISK_ON" ? 8 : classification === "RISK_OFF" ? 30 : 15;
  return { score, classification, targetPct, tolerancePct: 2, spy: spyState, qqq: qqqState, vix: vixLast, complete: spyState.complete && qqqState.complete };
}

export async function GET() {
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    const [ledgerRead, { data: cashRows, error: cashError }, regime] = await Promise.all([
      loadOpenHoldings(sb),
      sb.from("cash_ledger").select("entry_type,amount,notes"),
      marketRegime(),
    ]);
    if (cashError) throw new Error(cashError.message);

    const holdings: Holding[] = ledgerRead.rows
      .map((row) => ({ ticker: row.ticker, shares: Number(row.shares), avg_cost: Number(row.avg_cost), closed_at: null }))
      .filter((row) => Number.isFinite(row.shares) && row.shares > 0);
    const cash = classifyCash(cashRows ?? []);
    const tickers = Array.from(new Set(holdings.map((row) => row.ticker)));
    const quotePairs = await Promise.all(tickers.map(async (ticker) => [ticker, await getLightQuote(ticker).catch(() => null)] as const));
    const quotes = new Map(quotePairs);

    const missingPrices: string[] = [];
    let securitiesValue = 0;
    let reserveMarketValue = 0;
    let reserveLiquidityValue = 0;
    const reserveHoldings: Array<Record<string, unknown>> = [];
    for (const holding of holdings) {
      const price = finite(quotes.get(holding.ticker)?.price);
      if (price == null || price <= 0) {
        missingPrices.push(holding.ticker);
        continue;
      }
      const value = holding.shares * price;
      securitiesValue += value;
      const rule = RESERVE_RULES[holding.ticker];
      if (rule) {
        const liquidityValue = value * rule.haircut;
        reserveMarketValue += value;
        reserveLiquidityValue += liquidityValue;
        reserveHoldings.push({ ticker: holding.ticker, shares: holding.shares, price, marketValue: value, liquidityValue, haircut: rule.haircut, tier: rule.tier, label: rule.label });
      }
    }

    const verified = missingPrices.length === 0;
    // Fund NAV / Holdings value intentionally excludes broker USD cash and dividend cash.
    const totalNav = verified ? securitiesValue : null;

    // Policy Cash Buffer = investment USD cash + available net dividends + approved reserve holdings.
    // Withdrawn dividends leave the fund and become realized investment profit; they are not deployable capital.
    const liquidCash = cash.investmentCash + cash.dividendAvailable;
    const totalReserveAssets = liquidCash + reserveMarketValue;
    const haircutAdjustedReserveAssets = liquidCash + reserveLiquidityValue;
    const liquidityBuffer = totalReserveAssets;
    const riskAdjustedLiquidityBuffer = haircutAdjustedReserveAssets;
    const bufferPct = totalNav != null && totalNav > 0 ? (liquidityBuffer / totalNav) * 100 : null;
    const targetValue = totalNav != null ? totalNav * regime.targetPct / 100 : null;
    const gapValue = targetValue != null ? liquidityBuffer - targetValue : null;
    const deployableCash = gapValue != null ? Math.max(0, gapValue) : null;
    const lower = regime.targetPct - regime.tolerancePct;
    const upper = regime.targetPct + regime.tolerancePct;
    const posture = bufferPct == null ? "UNVERIFIED" : bufferPct < lower ? "UNDERFUNDED" : bufferPct > upper ? "OVERFUNDED" : "ON_TARGET";
    const action = posture === "UNDERFUNDED" ? "RAISE_BUFFER" : posture === "OVERFUNDED" ? "DEPLOY_EXCESS" : posture === "ON_TARGET" ? "MAINTAIN" : "VERIFY_PRICES";

    return NextResponse.json({
      version: "v8.7",
      verified,
      missingPrices,
      holdingsSource: ledgerRead.origin,
      unbackedPositions: ledgerRead.unbacked,
      shareMismatches: ledgerRead.shareMismatches,
      reconciliationNote: ledgerRead.note,
      regime,
      cashBalance: cash.investmentCash,
      investmentCash: cash.investmentCash,
      dividendGrossCash: cash.dividendGrossCash,
      dividendTax: cash.dividendTax,
      dividendNet: cash.dividendNet,
      dividendAvailable: cash.dividendAvailable,
      dividendWithdrawn: cash.dividendWithdrawn,
      realizedInvestmentProfit: cash.realizedInvestmentProfit,
      liquidCash,
      securitiesValue: verified ? securitiesValue : null,
      totalNav,
      reserveMarketValue,
      reserveLiquidityValue,
      totalReserveAssets,
      haircutAdjustedReserveAssets,
      grossBuffer: totalReserveAssets,
      liquidityBuffer,
      riskAdjustedLiquidityBuffer,
      bufferPct,
      targetPct: regime.targetPct,
      targetValue,
      gapValue,
      deployableCash,
      posture,
      action,
      reserveHoldings,
      policy: {
        cashOnlyPolicy: false,
        combinedBufferPolicy: true,
        reserveTickers: Object.keys(RESERVE_RULES),
        dividendWithholdingRate: 0.15,
        principle: "Cash Buffer equals investment USD cash plus available net dividend cash plus full market value of approved reserve instruments. Withdrawn dividends are realized investment profit and are excluded from deployable capital and Fund NAV.",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Cash buffer analysis failed." }, { status: 500 });
  }
}
