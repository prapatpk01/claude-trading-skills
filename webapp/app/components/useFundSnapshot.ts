"use client";

import { useEffect, useMemo, useState } from "react";

export type FundHolding = {
  id?: string;
  ticker: string;
  shares: number;
  avgCost: number;
  price: number;
  marketValue: number;
  costValue: number;
  weightPct: number;
};

type PreliminaryHolding = Omit<FundHolding, "weightPct">;

export type RiskScoreComponents = {
  concentration: number | null;
  diversification: number | null;
  liquidityPolicy: number | null;
  drawdown: number | null;
  volatility: number | null;
  coveragePct: number;
};

export type FundSnapshot = {
  loading: boolean;
  error: string | null;
  verified: boolean;
  holdings: FundHolding[];
  openPositions: number;
  totalNav: number;
  securitiesValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  cashBalance: number;
  reserveMarketValue: number;
  cashAndEquivalents: number;
  cashBufferPct: number;
  targetCashPct: number;
  deployableCash: number;
  macroScore: number;
  macroLabel: string;
  macroVision: string;
  macroConfidence: string;
  bullishPct: number | null;
  neutralPct: number | null;
  bearishPct: number | null;
  ytdReturnPct: number | null;
  benchmarkYtdPct: number | null;
  riskScore: number;
  riskScoreComponents: RiskScoreComponents;
  portfolioHealth: number;
  qualityScore: number;
  liquidityScore: number;
  ledger: any[];
  raw: Record<string, any>;
};

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Portfolio Risk Control is an exposure/risk metric, not a workflow-readiness
 * metric. Only measured portfolio controls enter this score; missing evidence
 * is omitted from the weighted average instead of silently becoming zero.
 */
function buildRiskControlScore(parts: Array<{ score: number | null; weight: number }>) {
  const measured = parts.filter((part): part is { score: number; weight: number } => part.score != null && Number.isFinite(part.score));
  const measuredWeight = measured.reduce((sum, part) => sum + part.weight, 0);
  if (measuredWeight <= 0) return { score: 50, coveragePct: 0 };

  const weighted = measured.reduce((sum, part) => sum + part.score * part.weight, 0) / measuredWeight;
  // When evidence is thin, shrink toward a neutral 60 rather than publishing a
  // high-conviction score from a single factor. This also prevents missing API
  // data from masquerading as a 0/100 risk failure.
  const confidence = Math.min(1, measuredWeight / 0.5);
  const score = clamp(weighted * confidence + 60 * (1 - confidence));
  return { score, coveragePct: clamp(measuredWeight * 100) };
}

async function json(path: string) {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  const payload = await response.json();
  if (!response.ok || payload?.error) throw new Error(payload?.error ?? `${path} failed`);
  return payload;
}

export function useFundSnapshot(refreshKey = 0): FundSnapshot {
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerRevision, setLedgerRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setLedgerRevision((value) => value + 1);
    window.addEventListener("sentinel:portfolio-updated", refresh);
    window.addEventListener("sentinel:cash-ledger-changed", refresh);
    return () => {
      window.removeEventListener("sentinel:portfolio-updated", refresh);
      window.removeEventListener("sentinel:cash-ledger-changed", refresh);
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const portfolio = await json("/api/portfolio");
        const open = (Array.isArray(portfolio?.holdings) ? portfolio.holdings : []).filter((row: any) => !row?.closed_at && Number(row?.shares) > 0);
        const tickers = Array.from(new Set(open.map((row: any) => String(row?.ticker ?? "").toUpperCase()).filter(Boolean)));
        const results = await Promise.allSettled([
          tickers.length ? json(`/api/holding-market?tickers=${encodeURIComponent(tickers.join(","))}`) : Promise.resolve({ items: {} }),
          json("/api/portfolio/cash-buffer"),
          json("/api/macro/intelligence"),
          json("/api/portfolio/analytics?days=365"),
          json("/api/v10/cio"),
        ]);
        const value = (index: number) => results[index]?.status === "fulfilled" ? (results[index] as PromiseFulfilledResult<any>).value : {};
        if (active) setRaw({ portfolio, market: value(0), buffer: value(1), macro: value(2), analytics: value(3), cio: value(4) });
      } catch (cause: any) {
        if (active) setError(cause?.message ?? "Fund snapshot unavailable.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [refreshKey, ledgerRevision]);

  return useMemo(() => {
    const sourceHoldings = (Array.isArray(raw?.portfolio?.holdings) ? raw.portfolio.holdings : []).filter((row: any) => !row?.closed_at && Number(row?.shares) > 0);
    const marketItems = raw?.market?.items ?? {};
    const preliminary: PreliminaryHolding[] = sourceHoldings.map((row: any) => {
      const ticker = String(row?.ticker ?? "").toUpperCase();
      const shares = Math.max(0, finite(row?.shares) ?? 0);
      const avgCost = Math.max(0, finite(row?.avg_cost) ?? 0);
      const marketPrice = finite(marketItems?.[ticker]?.price);
      const price = marketPrice != null && marketPrice > 0 ? marketPrice : 0;
      return { id: row?.id, ticker, shares, avgCost, price, marketValue: shares * price, costValue: shares * avgCost };
    });

    const calculatedSecurities = preliminary.reduce((sum, row) => sum + row.marketValue, 0);
    const costBasis = preliminary.reduce((sum, row) => sum + row.costValue, 0);
    const verified = Boolean(raw?.buffer?.verified && finite(raw?.buffer?.totalNav) != null);
    const cashBalance = finite(raw?.buffer?.cashBalance) ?? 0;
    const securitiesValue = verified ? (finite(raw?.buffer?.securitiesValue) ?? 0) : calculatedSecurities;
    const totalNav = verified ? (finite(raw?.buffer?.totalNav) ?? 0) : securitiesValue + cashBalance;
    const holdings: FundHolding[] = preliminary.map((row) => ({ ...row, weightPct: totalNav > 0 ? row.marketValue / totalNav * 100 : 0 }));
    const reserveMarketValue = finite(raw?.buffer?.reserveMarketValue) ?? 0;

    // Policy liquidity combines USD cash and approved reserve instruments.
    const cashAndEquivalents = finite(raw?.buffer?.liquidityBuffer) ?? cashBalance + (finite(raw?.buffer?.reserveLiquidityValue) ?? 0);
    const targetCashPct = finite(raw?.buffer?.targetPct) ?? 15;
    const cashBufferPct = finite(raw?.buffer?.bufferPct) ?? (totalNav > 0 ? cashBalance / totalNav * 100 : 0);
    const deployableCash = Math.max(0, finite(raw?.buffer?.deployableCash) ?? finite(raw?.buffer?.gapValue) ?? 0);
    const unrealizedPnl = securitiesValue - costBasis;
    const unrealizedPnlPct = costBasis > 0 ? unrealizedPnl / costBasis * 100 : 0;
    const macroScore = finite(raw?.macro?.regime?.score) ?? finite(raw?.buffer?.regime?.score) ?? 50;
    const horizon = Array.isArray(raw?.macro?.horizons) ? raw.macro.horizons[0] : null;
    const probabilities = horizon?.probabilities ?? {};
    const ytdReturnPct = finite(raw?.analytics?.performance?.changePct);
    const benchmarkYtdPct = finite(raw?.analytics?.performance?.benchmarkChangePct);

    const concentration = holdings.reduce((max, holding) => Math.max(max, holding.weightPct), 0);
    const diversificationScore = clamp(100 - Math.max(0, concentration - 10) * 2.4);
    const portfolioHealth = clamp(55 + diversificationScore * .22 + macroScore * .18 + Math.min(10, holdings.length * .45));
    const qualityScore = clamp(62 + diversificationScore * .18 + macroScore * .2);
    const liquidityScore = clamp(55 + Math.min(35, cashBufferPct * 1.7));

    // ── Portfolio Risk Control ───────────────────────────────────────────────
    // This deliberately does NOT use cio.readinessPct. CIO readiness measures
    // whether committee/workflow evidence is complete, not whether portfolio
    // risk is controlled. The old mapping is what could produce a misleading 0.
    const pricedHoldings = holdings.filter((holding) => holding.price > 0 && holding.marketValue > 0);
    const pricingCoverage = holdings.length > 0 ? pricedHoldings.length / holdings.length : 0;
    const structuralRiskMeasured = holdings.length > 0 && pricingCoverage >= .6;

    const concentrationControl = structuralRiskMeasured
      ? clamp(100 - Math.max(0, concentration - 10) * 3.2)
      : null;

    const pricedValue = pricedHoldings.reduce((sum, holding) => sum + holding.marketValue, 0);
    const hhi = pricedValue > 0
      ? pricedHoldings.reduce((sum, holding) => {
          const fraction = holding.marketValue / pricedValue;
          return sum + fraction * fraction;
        }, 0)
      : 0;
    const effectivePositions = hhi > 0 ? 1 / hhi : 0;
    const diversificationControl = structuralRiskMeasured && holdings.length > 0
      ? clamp((effectivePositions / Math.min(10, holdings.length)) * 100)
      : null;

    // Meeting the required cash-buffer floor receives full credit. Being below
    // the floor scales the score proportionally; excess cash is not penalized.
    const liquidityPolicyControl = totalNav > 0 && targetCashPct > 0
      ? clamp(Math.min(1, Math.max(0, cashBufferPct) / targetCashPct) * 100)
      : null;

    const maxDrawdownPct = finite(raw?.analytics?.performance?.maxDrawdownPct);
    const drawdownControl = maxDrawdownPct == null
      ? null
      : clamp(100 - Math.max(0, Math.abs(maxDrawdownPct) - 5) * 3);

    const annualizedVolatilityPct = finite(raw?.analytics?.performance?.annualizedVolatilityPct);
    const volatilityControl = annualizedVolatilityPct == null
      ? null
      : clamp(100 - Math.max(0, annualizedVolatilityPct - 15) * 2.5);

    const risk = buildRiskControlScore([
      { score: concentrationControl, weight: .30 },
      { score: diversificationControl, weight: .20 },
      { score: liquidityPolicyControl, weight: .25 },
      { score: drawdownControl, weight: .15 },
      { score: volatilityControl, weight: .10 },
    ]);
    const riskScoreComponents: RiskScoreComponents = {
      concentration: concentrationControl,
      diversification: diversificationControl,
      liquidityPolicy: liquidityPolicyControl,
      drawdown: drawdownControl,
      volatility: volatilityControl,
      coveragePct: risk.coveragePct,
    };

    return {
      loading, error, verified, holdings, openPositions: holdings.length, totalNav, securitiesValue,
      costBasis, unrealizedPnl, unrealizedPnlPct, cashBalance, reserveMarketValue,
      cashAndEquivalents, cashBufferPct, targetCashPct, deployableCash, macroScore,
      macroLabel: String(raw?.macro?.regime?.label ?? raw?.buffer?.regime?.classification ?? "NEUTRAL"),
      macroVision: String(raw?.macro?.vision?.en ?? "Market evidence is mixed. Maintain balanced risk and deploy selectively."),
      macroConfidence: String(raw?.macro?.confidence ?? "LOW"),
      bullishPct: finite(probabilities?.bull), neutralPct: finite(probabilities?.base), bearishPct: finite(probabilities?.bear),
      ytdReturnPct, benchmarkYtdPct, riskScore: risk.score, riskScoreComponents, portfolioHealth, qualityScore, liquidityScore,
      ledger: Array.isArray(raw?.portfolio?.ledger) ? raw.portfolio.ledger : [], raw,
    };
  }, [raw, loading, error]);
}
