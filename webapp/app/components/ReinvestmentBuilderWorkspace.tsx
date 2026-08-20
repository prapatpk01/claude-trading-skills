"use client";

import { useEffect, useState } from "react";
import { buildCapitalRecyclingPlan } from "@/lib/research/capitalRecyclingPolicy";
import { forecastActionPolicy } from "@/lib/research/forecastActionPolicy";
import { buildInvCandidatePool } from "@/lib/research/invCandidatePool";
import type { ReinvestmentCandidate } from "@/lib/research/reinvestmentBuilderPolicy";
import ReinvestmentBuilder from "./ReinvestmentBuilder";

const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const safe = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const PRIMARY = new Set(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);
const BLOCKED = new Set(["WEAKENING", "BROKEN"]);
const RISKY = new Set(["DEFENSIVE", "BEARISH"]);

type CapitalSnapshot = {
  totalNav: number | null;
  shortfallValue: number | null;
  deployableCash: number | null;
};

type Position = { ticker: string; shares: number };

async function marketBatch(tickers: string[]) {
  const items: Record<string, any> = {};
  for (let index = 0; index < tickers.length; index += 25) {
    const chunk = tickers.slice(index, index + 25);
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&builder=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({ items: {} }));
    Object.assign(items, payload.items ?? {});
  }
  return items;
}

function positionsFromPortfolio(rows: any[]): Position[] {
  const map = new Map<string, number>();
  for (const row of rows ?? []) {
    if (row?.closed_at) continue;
    const ticker = clean(row?.ticker);
    const shares = safe(row?.shares);
    if (!ticker || shares <= 0) continue;
    map.set(ticker, (map.get(ticker) ?? 0) + shares);
  }
  return Array.from(map.entries()).map(([ticker, shares]) => ({ ticker, shares }));
}

function researchDraftEligible(row: any, forecast: any) {
  const status = clean(row?.status);
  if (["REJECTED", "MOMENTUM_STAGE_REJECTED"].includes(status)) return false;
  const stage = clean(row?.lifecycle?.stage ?? forecast?.lifecycleStage);
  if (BLOCKED.has(stage)) return false;
  const hardBlocks = row?.researchEvidence?.fundFit?.hardBlocks;
  if (Array.isArray(hardBlocks) && hardBlocks.length) return false;
  const valuationReady = Boolean(row?.valuationReady || row?.valuationValid);
  const researchUpside = safe(row?.expectedReturnPct);
  const forecastReturn = safe(forecast?.expectedReturnPct);
  const confidence = safe(forecast?.confidence);
  if (!valuationReady || researchUpside < 8 || confidence < 55 || forecastReturn < 0 || RISKY.has(clean(forecast?.outlook))) return false;
  return PRIMARY.has(stage) || (stage === "MATURE" && researchUpside >= 12);
}

export default function ReinvestmentBuilderWorkspace({ lang = "th" }: { lang?: "th" | "en" }) {
  const [state, setState] = useState<{
    loading: boolean;
    error: string | null;
    candidates: ReinvestmentCandidate[];
    deployableUsd: number;
    totalNavUsd: number;
    sellReviewPotentialUsd: number;
    cashFloorRepairUsd: number;
  }>({ loading: true, error: null, candidates: [], deployableUsd: 0, totalNavUsd: 0, sellReviewPotentialUsd: 0, cashFloorRepairUsd: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setState(current => ({ ...current, loading: true, error: null }));
      try {
        const [portfolioResponse, researchResponse, capitalResponse] = await Promise.all([
          fetch(`/api/portfolio?builder=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/alpha-discovery?mode=multifactor&sector=All&top=15&builder=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/capital-recycling?builder=${Date.now()}`, { cache: "no-store" }),
        ]);
        const [portfolio, research, capital] = await Promise.all([
          portfolioResponse.json().catch(() => ({})),
          researchResponse.json().catch(() => ({})),
          capitalResponse.json().catch(() => ({})),
        ]);
        if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Portfolio unavailable");
        if (!researchResponse.ok) throw new Error(research?.error ?? "INV Research unavailable");
        if (!capitalResponse.ok) throw new Error(capital?.error ?? "Capital snapshot unavailable");

        const positions = positionsFromPortfolio(portfolio?.holdings ?? []);
        const invPool = buildInvCandidatePool(research?.stageCandidates, 15).candidates;
        const tickers = Array.from(new Set([...positions.map(row => row.ticker), ...invPool.map(row => clean(row?.ticker)).filter(Boolean)]));
        const market = await marketBatch(tickers);

        let proposedTrimProceedsUsd = 0;
        let sellReviewPotentialUsd = 0;
        const candidates: ReinvestmentCandidate[] = [];

        for (const position of positions) {
          const item = market[position.ticker];
          const forecast = item?.momentumForecast;
          const price = safe(item?.price);
          if (!forecast || price <= 0) continue;
          const decision = forecastActionPolicy({ ticker: position.ticker, owner: "AM_HOLDING", forecast });
          if (decision.action === "TRIM") proposedTrimProceedsUsd += position.shares * price * safe(decision.recommendedTrimPct) / 100;
          if (decision.action === "SELL REVIEW") sellReviewPotentialUsd += position.shares * price;
          if (decision.action === "ADD") candidates.push({
            ticker: position.ticker,
            action: "ADD",
            readiness: "READY",
            price,
            confidence: Math.round(safe(forecast?.confidence)),
            expectedReturnPct: safe(forecast?.expectedReturnPct),
            priority: safe(decision.priority),
            lifecycleStage: clean(forecast?.lifecycleStage),
            sourceStage: "AM HOLDING",
            reason: decision.reason,
          });
        }

        for (const row of invPool) {
          const ticker = clean(row?.ticker);
          const item = market[ticker];
          const forecast = item?.momentumForecast;
          const price = safe(item?.price);
          if (!ticker || !forecast || price <= 0) continue;
          const decision = forecastActionPolicy({ ticker, owner: "INV_RESEARCH", forecast, research: row });
          if (decision.action === "BUY CANDIDATE") candidates.push({
            ticker,
            action: "BUY CANDIDATE",
            readiness: "READY",
            price,
            confidence: Math.round(safe(forecast?.confidence)),
            expectedReturnPct: safe(forecast?.expectedReturnPct),
            priority: safe(decision.priority),
            lifecycleStage: clean(row?.lifecycle?.stage ?? forecast?.lifecycleStage),
            sourceStage: `POOL #${row?.candidatePoolRank ?? "—"} · ${clean(row?.candidatePoolStage || "INV")}`,
            reason: decision.reason,
          });
          else if (researchDraftEligible(row, forecast)) candidates.push({
            ticker,
            action: "BUY DRAFT",
            readiness: "CIO_REVIEW",
            price,
            confidence: Math.round(safe(forecast?.confidence)),
            expectedReturnPct: safe(forecast?.expectedReturnPct),
            priority: Math.max(55, safe(decision.priority)),
            lifecycleStage: clean(row?.lifecycle?.stage ?? forecast?.lifecycleStage),
            sourceStage: `POOL #${row?.candidatePoolRank ?? "—"} · ${clean(row?.candidatePoolStage || "INV")}`,
            reason: "INV valuation/lifecycle minimums are met; CIO may size a draft, but final Funding/Risk/CIO approval is still required.",
          });
        }

        const capitalSnapshot = capital as CapitalSnapshot;
        const recycling = buildCapitalRecyclingPlan({
          proposedTrimProceedsUsd,
          sellReviewPotentialUsd,
          existingDeployableCashUsd: safe(capitalSnapshot?.deployableCash),
          cashFloorShortfallUsd: safe(capitalSnapshot?.shortfallValue),
          totalNavUsd: safe(capitalSnapshot?.totalNav),
          candidates: [],
        });

        if (active) setState({
          loading: false,
          error: null,
          candidates,
          deployableUsd: recycling.totalDeployablePoolUsd,
          totalNavUsd: safe(capitalSnapshot?.totalNav),
          sellReviewPotentialUsd: recycling.sellReviewPotentialUsd,
          cashFloorRepairUsd: recycling.cashFloorRepairUsd,
        });
      } catch (cause) {
        if (active) setState(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "Reinvestment Builder unavailable" }));
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  if (state.loading) return <section style={{ marginTop: 20, padding: 20, border: "1px solid rgba(77,213,160,.25)", borderRadius: 20, color: "#91a4bf" }}>04 · REINVESTMENT BUILDER · กำลังคัด Candidate และคำนวณเงินพร้อมลงทุน…</section>;
  if (state.error) return <section style={{ marginTop: 20, padding: 20, border: "1px solid rgba(241,130,130,.3)", borderRadius: 20, color: "#e7a5a5" }}>⚠ Reinvestment Builder: {state.error} <button type="button" onClick={() => setRefreshKey(value => value + 1)} style={{ marginLeft: 10 }}>Retry</button></section>;

  return <div>
    <ReinvestmentBuilder
      candidates={state.candidates}
      deployableUsd={state.deployableUsd}
      totalNavUsd={state.totalNavUsd}
      sellReviewPotentialUsd={state.sellReviewPotentialUsd}
      cashFloorRepairUsd={state.cashFloorRepairUsd}
      lang={lang}
    />
  </div>;
}
