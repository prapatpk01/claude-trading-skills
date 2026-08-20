"use client";

import { useEffect, useState } from "react";
import { buildCapitalRecyclingPlan } from "@/lib/research/capitalRecyclingPolicy";
import { forecastActionPolicy } from "@/lib/research/forecastActionPolicy";
import { buildInvCandidatePool } from "@/lib/research/invCandidatePool";
import { shouldExpandInvBasket } from "@/lib/research/invBasketCompletionPolicy";
import { buildReinvestmentDraft, curateReinvestmentCandidates, type ReinvestmentCandidate } from "@/lib/research/reinvestmentBuilderPolicy";
import ReinvestmentBuilder from "./ReinvestmentBuilder";

const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const safe = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const PRIMARY = new Set(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);
const BLOCKED = new Set(["WEAKENING", "BROKEN"]);
const RISKY = new Set(["DEFENSIVE", "BEARISH"]);
const MAX_RESEARCH_PASSES = 3;
const MIN_ORDER_USD = 100;

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
    if (!chunk.length) continue;
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

function mergeCandidates(current: ReinvestmentCandidate[], incoming: ReinvestmentCandidate[]) {
  const byTicker = new Map<string, ReinvestmentCandidate>();
  for (const row of [...current, ...incoming]) {
    const prior = byTicker.get(row.ticker);
    if (!prior) { byTicker.set(row.ticker, row); continue; }
    const priorScore = (prior.readiness === "READY" ? 1000 : 0) + prior.priority + prior.confidence + prior.expectedReturnPct;
    const nextScore = (row.readiness === "READY" ? 1000 : 0) + row.priority + row.confidence + row.expectedReturnPct;
    if (nextScore > priorScore) byTicker.set(row.ticker, row);
  }
  return Array.from(byTicker.values());
}

async function candidatesFromResearch(research: any): Promise<ReinvestmentCandidate[]> {
  const passNumber = Math.max(1, Math.round(safe(research?.researchPassNumber) || 1));
  const invPool = buildInvCandidatePool(research?.stageCandidates, 15).candidates;
  const tickers = Array.from(new Set(invPool.map(row => clean(row?.ticker)).filter(Boolean)));
  const market = await marketBatch(tickers);
  const out: ReinvestmentCandidate[] = [];

  for (const row of invPool) {
    const ticker = clean(row?.ticker);
    const item = market[ticker];
    const forecast = item?.momentumForecast;
    const price = safe(item?.price);
    if (!ticker || !forecast || price <= 0) continue;
    const decision = forecastActionPolicy({ ticker, owner: "INV_RESEARCH", forecast, research: row });
    const sourceStage = `PASS ${passNumber} · POOL #${row?.candidatePoolRank ?? "—"} · ${clean(row?.candidatePoolStage || "INV")}`;
    if (decision.action === "BUY CANDIDATE") out.push({
      ticker,
      action: "BUY CANDIDATE",
      readiness: "READY",
      price,
      confidence: Math.round(safe(forecast?.confidence)),
      expectedReturnPct: safe(forecast?.expectedReturnPct),
      priority: safe(decision.priority),
      lifecycleStage: clean(row?.lifecycle?.stage ?? forecast?.lifecycleStage),
      sourceStage,
      reason: decision.reason,
    });
    else if (researchDraftEligible(row, forecast)) out.push({
      ticker,
      action: "BUY DRAFT",
      readiness: "CIO_REVIEW",
      price,
      confidence: Math.round(safe(forecast?.confidence)),
      expectedReturnPct: safe(forecast?.expectedReturnPct),
      priority: Math.max(55, safe(decision.priority)),
      lifecycleStage: clean(row?.lifecycle?.stage ?? forecast?.lifecycleStage),
      sourceStage,
      reason: "INV valuation/lifecycle minimums are met; CIO may size a draft, but final Funding/Risk/CIO approval is still required.",
    });
  }
  return out;
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
    researchPassesRun: number;
    completionReason: string;
  }>({ loading: true, error: null, candidates: [], deployableUsd: 0, totalNavUsd: 0, sellReviewPotentialUsd: 0, cashFloorRepairUsd: 0, researchPassesRun: 0, completionReason: "" });
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      setState(current => ({ ...current, loading: true, error: null }));
      try {
        const [portfolioResponse, researchResponse, capitalResponse] = await Promise.all([
          fetch(`/api/portfolio?builder=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/alpha-discovery?mode=multifactor&sector=All&top=15&researchPass=0&builder=${Date.now()}`, { cache: "no-store" }),
          fetch(`/api/capital-recycling?builder=${Date.now()}`, { cache: "no-store" }),
        ]);
        const [portfolio, firstResearch, capital] = await Promise.all([
          portfolioResponse.json().catch(() => ({})),
          researchResponse.json().catch(() => ({})),
          capitalResponse.json().catch(() => ({})),
        ]);
        if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Portfolio unavailable");
        if (!researchResponse.ok) throw new Error(firstResearch?.error ?? "INV Research unavailable");
        if (!capitalResponse.ok) throw new Error(capital?.error ?? "Capital snapshot unavailable");

        const positions = positionsFromPortfolio(portfolio?.holdings ?? []);
        const holdingMarket = await marketBatch(positions.map(row => row.ticker));
        let proposedTrimProceedsUsd = 0;
        let sellReviewPotentialUsd = 0;
        let candidates: ReinvestmentCandidate[] = [];

        for (const position of positions) {
          const item = holdingMarket[position.ticker];
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

        const capitalSnapshot = capital as CapitalSnapshot;
        const recycling = buildCapitalRecyclingPlan({
          proposedTrimProceedsUsd,
          sellReviewPotentialUsd,
          existingDeployableCashUsd: safe(capitalSnapshot?.deployableCash),
          cashFloorShortfallUsd: safe(capitalSnapshot?.shortfallValue),
          totalNavUsd: safe(capitalSnapshot?.totalNav),
          candidates: [],
        });
        const deployableUsd = recycling.totalDeployablePoolUsd;
        const totalNavUsd = safe(capitalSnapshot?.totalNav);

        candidates = mergeCandidates(candidates, await candidatesFromResearch(firstResearch));
        let researchPass = 0;
        let researchPassesRun = 1;
        let completionReason = "INV basket completed from the primary deep-research pass.";

        for (;;) {
          const curation = curateReinvestmentCandidates({ candidates, deployableUsd, minNames: 5, maxNames: 8, minOrderUsd: MIN_ORDER_USD });
          const sizingPreview = buildReinvestmentDraft({ deployableUsd, totalNavUsd, selected: curation.selected, mode: "CONVICTION", maxNames: 8, minOrderUsd: MIN_ORDER_USD });
          const completion = shouldExpandInvBasket({
            selectedCount: curation.selected.length,
            targetMinNames: 5,
            targetMaxNames: 8,
            deployableUsd,
            allocatedUsd: sizingPreview.allocatedUsd,
            unallocatedUsd: sizingPreview.unallocatedUsd,
            minOrderUsd: MIN_ORDER_USD,
            pass: researchPass,
            maxPasses: MAX_RESEARCH_PASSES,
          });
          completionReason = completion.reason;
          if (!completion.shouldExpand || completion.nextPass == null) break;

          const nextPass = completion.nextPass;
          const expansionResponse = await fetch(`/api/alpha-discovery?mode=multifactor&sector=All&top=15&researchPass=${nextPass}&builder=${Date.now()}`, { cache: "no-store" });
          const expansionResearch = await expansionResponse.json().catch(() => ({}));
          if (!expansionResponse.ok) {
            completionReason = expansionResponse.status === 422
              ? "INV exhausted additional approved-universe candidates before filling the target basket. Residual capital remains in Buffer."
              : `INV basket expansion stopped because research pass ${nextPass + 1} was unavailable.`;
            break;
          }
          candidates = mergeCandidates(candidates, await candidatesFromResearch(expansionResearch));
          researchPass = nextPass;
          researchPassesRun += 1;
        }

        if (active) setState({
          loading: false,
          error: null,
          candidates,
          deployableUsd,
          totalNavUsd,
          sellReviewPotentialUsd: recycling.sellReviewPotentialUsd,
          cashFloorRepairUsd: recycling.cashFloorRepairUsd,
          researchPassesRun,
          completionReason,
        });
      } catch (cause) {
        if (active) setState(current => ({ ...current, loading: false, error: cause instanceof Error ? cause.message : "Reinvestment Builder unavailable" }));
      }
    })();
    return () => { active = false; };
  }, [refreshKey]);

  if (state.loading) return <section style={{ marginTop: 20, padding: 20, border: "1px solid rgba(77,213,160,.25)", borderRadius: 20, color: "#91a4bf" }}>04 · REINVESTMENT BUILDER · INV กำลังคัด Candidate และเติม Basket จาก Full-Universe Research…</section>;
  if (state.error) return <section style={{ marginTop: 20, padding: 20, border: "1px solid rgba(241,130,130,.3)", borderRadius: 20, color: "#e7a5a5" }}>⚠ Reinvestment Builder: {state.error} <button type="button" onClick={() => setRefreshKey(value => value + 1)} style={{ marginLeft: 10 }}>Retry</button></section>;

  return <div>
    <ReinvestmentBuilder
      candidates={state.candidates}
      deployableUsd={state.deployableUsd}
      totalNavUsd={state.totalNavUsd}
      sellReviewPotentialUsd={state.sellReviewPotentialUsd}
      cashFloorRepairUsd={state.cashFloorRepairUsd}
      researchPassesRun={state.researchPassesRun}
      completionReason={state.completionReason}
      lang={lang}
    />
  </div>;
}
