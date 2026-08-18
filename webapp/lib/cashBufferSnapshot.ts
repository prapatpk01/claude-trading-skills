import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import { getLightQuote } from "@/lib/marketData";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { buildMacroOutlook } from "@/lib/macroOutlook";

type Holding = { ticker: string; shares: number; avg_cost: number };
type ReserveRule = { label: string; haircut: number; tier: "cash" | "treasury" | "credit" };

const DIVIDEND_WITHDRAWAL_TAG = "[DIVIDEND_WITHDRAWAL]";
const OVERFUNDED_MARGIN_PCT = 2;

export const RESERVE_RULES: Record<string, ReserveRule> = {
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
  if (v === null || v === undefined || v === "") return null;
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
    if (row.entry_type === "DIVIDEND") { dividendGrossCash += Math.max(0, amount); continue; }
    if (row.entry_type === "TAX") { dividendTax += Math.abs(Math.min(0, amount)); continue; }
    if (row.entry_type === "WITHDRAWAL" && String(row.notes ?? "").includes(DIVIDEND_WITHDRAWAL_TAG)) {
      dividendWithdrawn += Math.abs(Math.min(0, amount));
      continue;
    }
    investmentCash += amount;
  }
  if (Math.abs(investmentCash) < 0.005) investmentCash = 0;
  const dividendNet = Math.max(0, dividendGrossCash - dividendTax);
  const dividendAvailable = Math.max(0, dividendNet - dividendWithdrawn);
  return { investmentCash, dividendGrossCash, dividendTax, dividendNet, dividendWithdrawn, dividendAvailable, realizedInvestmentProfit: dividendWithdrawn };
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

export function portfolioHoldingsRevision(rows: Holding[]) {
  return stableHash(rows
    .map((row) => `${row.ticker.toUpperCase()}:${Number(row.shares).toFixed(8)}:${Number(row.avg_cost).toFixed(8)}`)
    .sort()
    .join("|"));
}

function cashRevision(rows: Array<{ entry_type?: string | null; amount?: unknown; notes?: string | null }>) {
  return stableHash(rows
    .map((row) => `${String(row.entry_type ?? "")}:${(finite(row.amount) ?? 0).toFixed(8)}:${String(row.notes ?? "")}`)
    .sort()
    .join("|"));
}

/**
 * Cash Buffer never invents its own market regime. The same authoritative CIO
 * Deployment Regime that controls sizing also owns the minimum reserve floor.
 */
async function marketRegime() {
  const macro = await buildMacroOutlook();
  const deployment = macro.deployment;
  return {
    ...deployment,
    classification: deployment.regime.toUpperCase().replaceAll("-", "_"),
    overfundedMarginPct: OVERFUNDED_MARGIN_PCT,
    complete: true,
    macro: { score: macro.score, regime: macro.regime, regimeTh: macro.regimeTh },
    tape: { score: macro.marketTape.score, label: macro.marketTape.label, labelTh: macro.marketTape.labelTh },
  };
}

export async function buildCashBufferSnapshot() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");

  const [ledgerRead, { data: cashRows, error: cashError }, regime] = await Promise.all([
    loadOpenHoldings(sb),
    sb.from("cash_ledger").select("entry_type,amount,notes"),
    marketRegime(),
  ]);
  if (cashError) throw new Error(cashError.message);

  const holdings: Holding[] = ledgerRead.rows
    .map((row) => ({ ticker: row.ticker, shares: Number(row.shares), avg_cost: Number(row.avg_cost) }))
    .filter((row) => Number.isFinite(row.shares) && row.shares > 0);
  const cash = classifyCash(cashRows ?? []);
  const tickers = Array.from(new Set(holdings.map((row) => row.ticker)));
  const quotePairs = await Promise.all(tickers.map(async (ticker) => [ticker, await getLightQuote(ticker).catch(() => null)] as const));
  const quotes = new Map(quotePairs);

  const missingPrices: string[] = [];
  const provisionalPrices: string[] = [];
  let securitiesValue = 0;
  let reserveMarketValue = 0;
  let reserveLiquidityValue = 0;
  const reserveHoldings: Array<Record<string, unknown>> = [];

  for (const holding of holdings) {
    const livePrice = finite(quotes.get(holding.ticker)?.price);
    const costBasis = finite(holding.avg_cost);
    const hasLivePrice = livePrice != null && livePrice > 0;
    const fallbackPrice = costBasis != null && costBasis > 0 ? costBasis : null;
    const price = hasLivePrice ? livePrice : fallbackPrice;

    if (!hasLivePrice) missingPrices.push(holding.ticker);
    if (!hasLivePrice && fallbackPrice != null) provisionalPrices.push(holding.ticker);
    // If neither market price nor broker cost basis exists, keep the gap named
    // but do not manufacture a value for the position.
    if (price == null || price <= 0) continue;

    const value = holding.shares * price;
    securitiesValue += value;
    const rule = RESERVE_RULES[holding.ticker];
    if (rule) {
      const liquidityValue = value * rule.haircut;
      reserveMarketValue += value;
      reserveLiquidityValue += liquidityValue;
      reserveHoldings.push({
        ticker: holding.ticker,
        shares: holding.shares,
        price,
        priceSource: hasLivePrice ? "LIVE_MARKET" : "BROKER_COST_BASIS_PROVISIONAL",
        marketValue: value,
        liquidityValue,
        haircut: rule.haircut,
        tier: rule.tier,
        label: rule.label,
      });
    }
  }

  const verified = missingPrices.length === 0;
  // A temporary quote outage must degrade confidence, not erase the fund. If a
  // live quote is missing, broker cost basis provides a conservative provisional
  // mark and the missing ticker remains explicitly flagged. This prevents a
  // single failed quote from propagating null → 0 into the CIO meeting.
  const totalNav = holdings.length > 0 && securitiesValue > 0 ? securitiesValue : null;
  const liquidCash = cash.investmentCash + cash.dividendAvailable;
  const totalReserveAssets = liquidCash + reserveMarketValue;
  const haircutAdjustedReserveAssets = liquidCash + reserveLiquidityValue;
  const liquidityBuffer = totalReserveAssets;
  const riskAdjustedLiquidityBuffer = haircutAdjustedReserveAssets;
  const bufferPct = totalNav != null && totalNav > 0 ? (liquidityBuffer / totalNav) * 100 : null;
  const targetValue = totalNav != null ? totalNav * regime.targetPct / 100 : null;
  const gapValue = targetValue != null ? liquidityBuffer - targetValue : null;
  const shortfallValue = gapValue != null ? Math.max(0, -gapValue) : null;
  const deployableCash = gapValue != null ? Math.max(0, gapValue) : null;
  const overfundedThresholdPct = regime.targetPct + OVERFUNDED_MARGIN_PCT;

  const posture = bufferPct == null
    ? "UNVERIFIED"
    : bufferPct < regime.targetPct
      ? "UNDERFUNDED"
      : bufferPct > overfundedThresholdPct
        ? "OVERFUNDED"
        : "ON_TARGET";
  const action = posture === "UNDERFUNDED" ? "RAISE_BUFFER" : posture === "OVERFUNDED" ? "DEPLOY_EXCESS" : posture === "ON_TARGET" ? "MAINTAIN" : "VERIFY_PRICES";

  return {
    version: "v10.0",
    verified,
    valuationMode: verified ? "LIVE_MARKET" : provisionalPrices.length ? "PROVISIONAL_COST_BASIS_FALLBACK" : "INCOMPLETE",
    missingPrices,
    provisionalPrices,
    holdingsSource: ledgerRead.origin,
    holdingsRevision: portfolioHoldingsRevision(holdings),
    cashRevision: cashRevision(cashRows ?? []),
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
    securitiesValue,
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
    cashFloorPct: regime.cashFloorPct,
    targetValue,
    gapValue,
    shortfallValue,
    deployableCash,
    overfundedThresholdPct,
    posture,
    action,
    reserveHoldings,
    policy: {
      sourceOfTruth: "lib/deploymentRegime.ts + lib/team/constitution.ts::REGIME_BANDS",
      cashOnlyPolicy: false,
      combinedBufferPolicy: true,
      reserveTickers: Object.keys(RESERVE_RULES),
      dividendWithholdingRate: 0.15,
      overfundedMarginPct: OVERFUNDED_MARGIN_PCT,
      provisionalPricingRule: "Live market price first. If unavailable, broker cost basis may be used only as a clearly flagged provisional NAV mark; it never becomes a fair-value target.",
      principle: "Cash Buffer equals investment USD cash plus available net dividend cash plus full market value of approved reserve instruments. Its hard minimum comes only from the CIO Deployment Regime (45% Macro + 35% Market Tape + 20% volatility/risk) mapped through the fund constitution; only the overfunded classification adds a margin above that floor.",
    },
  };
}

type CashBufferSnapshot = Awaited<ReturnType<typeof buildCashBufferSnapshot>>;

function applyFreshCash(
  snapshot: CashBufferSnapshot,
  rows: Array<{ entry_type?: string | null; amount?: unknown; notes?: string | null }>,
) {
  const cash = classifyCash(rows);
  const liquidCash = cash.investmentCash + cash.dividendAvailable;
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
    cashBalance: cash.investmentCash,
    investmentCash: cash.investmentCash,
    dividendGrossCash: cash.dividendGrossCash,
    dividendTax: cash.dividendTax,
    dividendNet: cash.dividendNet,
    dividendWithdrawn: cash.dividendWithdrawn,
    dividendAvailable: cash.dividendAvailable,
    realizedInvestmentProfit: cash.realizedInvestmentProfit,
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
    cashRevision: cashRevision(rows),
  };
}

/**
 * Build the production portfolio snapshot used by Holdings, Active Fund and CIO.
 *
 * Quotes are slower than ledger reads. A trade or cash edit can therefore land
 * while prices are being gathered. We verify holdings after pricing (and retry
 * once if they changed), then read cash last. This prevents an older in-flight
 * request from becoming a plausible-looking current CIO meeting.
 */
export async function buildAuthoritativeCashBufferSnapshot() {
  const sb = getSupabaseAdmin() ?? getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");

  let snapshot = await buildCashBufferSnapshot();
  let finalHoldings = await loadOpenHoldings(sb);
  let finalRows: Holding[] = finalHoldings.rows.map((row) => ({
    ticker: String(row.ticker).toUpperCase(),
    shares: Number(row.shares),
    avg_cost: Number(row.avg_cost),
  }));
  let finalHoldingsRevision = portfolioHoldingsRevision(finalRows);

  if (finalHoldingsRevision !== snapshot.holdingsRevision) {
    snapshot = await buildCashBufferSnapshot();
    finalHoldings = await loadOpenHoldings(sb);
    finalRows = finalHoldings.rows.map((row) => ({
      ticker: String(row.ticker).toUpperCase(),
      shares: Number(row.shares),
      avg_cost: Number(row.avg_cost),
    }));
    finalHoldingsRevision = portfolioHoldingsRevision(finalRows);
  }

  const holdingsConsistent = finalHoldingsRevision === snapshot.holdingsRevision;
  const { data: cashRows, error: cashError } = await sb
    .from("cash_ledger")
    .select("entry_type,amount,notes");

  const withFreshCash = !cashError && cashRows
    ? applyFreshCash(snapshot, cashRows)
    : snapshot;
  const asOf = new Date().toISOString();
  const portfolioRevision = stableHash(`${finalHoldingsRevision}|${withFreshCash.cashRevision}`);

  return {
    ...withFreshCash,
    verified: withFreshCash.verified && holdingsConsistent,
    asOf,
    snapshotId: `PORT-${portfolioRevision}`,
    portfolioRevision,
    holdingsRevision: finalHoldingsRevision,
    holdingsConsistent,
    cashFreshness: cashError ? "SNAPSHOT_FALLBACK" : "DIRECT_DATABASE_FINAL_READ",
    cashFreshnessError: cashError?.message ?? null,
    consistencyRule: "Holdings are verified after pricing; cash is read after holdings and prices. All fund surfaces use this authoritative builder.",
  };
}
