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

export function useFundSnapshot(refreshKey = 0): FundSnapshot {
  const [raw, setRaw] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const portfolio = await fetch("/api/portfolio", { cache: "no-store" }).then((response) => response.json());
        const open = (Array.isArray(portfolio?.holdings) ? portfolio.holdings : []).filter((row: any) => !row?.closed_at);
        const tickers = Array.from(new Set(open.map((row: any) => String(row?.ticker ?? "").toUpperCase()).filter(Boolean)));
        const marketPromise = tickers.length
          ? fetch(`/api/holding-market?tickers=${encodeURIComponent(tickers.join(","))}`, { cache: "no-store" }).then((response) => response.json())
          : Promise.resolve({ items: {} });

        const results = await Promise.allSettled([
          marketPromise,
          fetch("/api/portfolio/cash-buffer", { cache: "no-store" }).then((response) => response.json()),
          fetch("/api/macro/intelligence", { cache: "no-store" }).then((response) => response.json()),
          fetch("/api/portfolio/analytics?days=365", { cache: "no-store" }).then((response) => response.json()),
          fetch("/api/v10/cio", { cache: "no-store" }).then((response) => response.json()),
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
  }, [refreshKey]);

  return useMemo(() => {
    const sourceHoldings = (Array.isArray(raw?.portfolio?.holdings) ? raw.portfolio.holdings : []).filter((row: any) => !row?.closed_at);
    const marketItems = raw?.market?.items ?? {};
    const preliminary: PreliminaryHolding[] = sourceHoldings.map((row: any): PreliminaryHolding => {
      const ticker = String(row?.ticker ?? "").toUpperCase();
      const shares = Math.max(0, finite(row?.shares) ?? 0);
      const avgCost = Math.max(0, finite(row?.avg_cost) ?? 0);
      const marketPrice = finite(marketItems?.[ticker]?.price);
      const price = marketPrice != null && marketPrice > 0 ? marketPrice : avgCost;
      return { id: row?.id, ticker, shares, avgCost, price, marketValue: shares * price, costValue: shares * avgCost };
    });
    const calculatedSecurities = preliminary.reduce((sum: number, row: PreliminaryHolding) => sum + row.marketValue, 0);
    const costBasis = preliminary.reduce((sum: number, row: PreliminaryHolding) => sum + row.costValue, 0);
    const verifiedNav = finite(raw?.buffer?.totalNav);
    const cashBalance = finite(raw?.buffer?.cashBalance) ?? 0;
    const securitiesValue = finite(raw?.buffer?.securitiesValue) ?? calculatedSecurities;
    const totalNav = verifiedNav ?? securitiesValue + cashBalance;
    const holdings: FundHolding[] = preliminary.map((row: PreliminaryHolding): FundHolding => ({ ...row, weightPct: totalNav > 0 ? row.marketValue / totalNav * 100 : 0 }));
    const reserveMarketValue = finite(raw?.buffer?.reserveMarketValue) ?? 0;
    const cashAndEquivalents = cashBalance + reserveMarketValue;
    const targetCashPct = finite(raw?.buffer?.targetPct) ?? 15;
    const cashBufferPct = finite(raw?.buffer?.bufferPct) ?? (totalNav > 0 ? cashAndEquivalents / totalNav * 100 : 0);
    const gapValue = finite(raw?.buffer?.gapValue);
    const deployableCash = Math.max(0, gapValue ?? 0);
    const unrealizedPnl = securitiesValue - costBasis;
    const unrealizedPnlPct = costBasis > 0 ? unrealizedPnl / costBasis * 100 : 0;
    const macroScore = finite(raw?.macro?.regime?.score) ?? finite(raw?.buffer?.regime?.score) ?? 50;
    const horizon = Array.isArray(raw?.macro?.horizons) ? raw.macro.horizons[0] : null;
    const probabilities = horizon?.probabilities ?? {};
    const ytdReturnPct = finite(raw?.analytics?.performance?.changePct);
    const benchmarkYtdPct = finite(raw?.analytics?.performance?.benchmarkChangePct);
    const riskScore = clamp(finite(raw?.cio?.readinessPct) ?? (100 - Math.abs(50 - macroScore) * .55));
    const concentration = holdings.reduce((max: number, holding: FundHolding) => Math.max(max, holding.weightPct), 0);
    const diversificationScore = clamp(100 - Math.max(0, concentration - 10) * 2.4);
    const portfolioHealth = clamp(55 + diversificationScore * .22 + macroScore * .18 + Math.min(10, holdings.length * .45));
    const qualityScore = clamp(62 + diversificationScore * .18 + macroScore * .2);
    const liquidityScore = clamp(55 + Math.min(35, cashBufferPct * 1.7));

    return {
      loading,
      error,
      verified: Boolean(raw?.buffer?.verified && verifiedNav != null),
      holdings,
      openPositions: holdings.length,
      totalNav,
      securitiesValue,
      costBasis,
      unrealizedPnl,
      unrealizedPnlPct,
      cashBalance,
      reserveMarketValue,
      cashAndEquivalents,
      cashBufferPct,
      targetCashPct,
      deployableCash,
      macroScore,
      macroLabel: String(raw?.macro?.regime?.label ?? raw?.buffer?.regime?.classification ?? "NEUTRAL"),
      macroVision: String(raw?.macro?.vision?.en ?? "Market evidence is mixed. Maintain balanced risk and deploy selectively."),
      macroConfidence: String(raw?.macro?.confidence ?? "LOW"),
      bullishPct: finite(probabilities?.bull),
      neutralPct: finite(probabilities?.base),
      bearishPct: finite(probabilities?.bear),
      ytdReturnPct,
      benchmarkYtdPct,
      riskScore,
      portfolioHealth,
      qualityScore,
      liquidityScore,
      ledger: Array.isArray(raw?.portfolio?.ledger) ? raw.portfolio.ledger : [],
      raw,
    };
  }, [raw, loading, error]);
}
