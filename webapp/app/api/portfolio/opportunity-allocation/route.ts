import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getLightQuote } from "@/lib/marketData";
import { openOnly } from "@/lib/openPositions";
import { runActiveFund, LIQUIDITY_TICKERS, type PositionValue } from "@/lib/activeFund";
import { GET as getCashBufferResponse } from "@/app/api/portfolio/cash-buffer/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const finite = (value: unknown): number | null => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

async function loadCashBuffer() {
  const response = await getCashBufferResponse();
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error ?? `Cash buffer returned ${response.status}`);
  return json;
}

export async function GET() {
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

    const [holdingsResult, watchResult, buffer] = await Promise.all([
      sb.from("holdings").select("ticker,shares,avg_cost,closed_at"),
      sb.from("watchlist").select("ticker,source,target_price,entry_price,stop_price,reason"),
      loadCashBuffer(),
    ]);

    if (holdingsResult.error) throw new Error(holdingsResult.error.message);
    if (watchResult.error) throw new Error(watchResult.error.message);

    if (!buffer.verified || finite(buffer.totalNav) == null) {
      return NextResponse.json({
        version: "v8.4",
        status: "BLOCKED",
        reason: "Portfolio NAV is not verified. Opportunity capital cannot be allocated.",
        missingPrices: buffer.missingPrices ?? [],
        allocations: [],
      });
    }

    const holdings = openOnly((holdingsResult.data ?? []) as any[])
      .map((h: any) => ({ ticker: String(h.ticker ?? "").trim().toUpperCase(), shares: finite(h.shares) }))
      .filter((h): h is { ticker: string; shares: number } => Boolean(h.ticker) && h.shares != null && h.shares > 0);

    const quotes = await Promise.all(holdings.map(async (holding) => {
      const quote = await getLightQuote(holding.ticker).catch(() => null);
      return [holding.ticker, quote] as const;
    }));
    const quoteMap = new Map(quotes);
    const missingPrices = holdings.filter((h) => {
      const price = finite(quoteMap.get(h.ticker)?.price);
      return price == null || price <= 0;
    }).map((h) => h.ticker);

    if (missingPrices.length) {
      return NextResponse.json({
        version: "v8.4",
        status: "BLOCKED",
        reason: "At least one holding lacks a verified market price.",
        missingPrices,
        allocations: [],
      });
    }

    const positionValues: PositionValue[] = holdings.map((h) => ({
      ticker: h.ticker,
      marketValue: h.shares * (finite(quoteMap.get(h.ticker)?.price) as number),
    }));
    const heldTickers = positionValues.map((p) => p.ticker);
    const watchTickers = Array.from(new Set((watchResult.data ?? [])
      .map((w: any) => String(w.ticker ?? "").trim().toUpperCase())
      .filter((ticker: string) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) && !heldTickers.includes(ticker) && !LIQUIDITY_TICKERS.has(ticker))))
      .slice(0, 20);

    const nav = finite(buffer.totalNav) as number;
    const review = await runActiveFund(heldTickers, nav, watchTickers, positionValues);
    const deployable = buffer.posture === "OVERFUNDED" ? Math.max(0, finite(buffer.gapValue) ?? 0) : 0;
    const blockers: string[] = [];
    if (buffer.posture === "UNDERFUNDED") blockers.push("Liquidity reserve is below the policy floor.");
    if (buffer.posture !== "OVERFUNDED") blockers.push("No verified liquidity excess is currently available for new risk positions.");

    let remaining = deployable;
    const allocations = (review.newIdeas ?? [])
      .filter((idea) => {
        const current = finite(idea.currentPrice);
        const target = finite(idea.targetPrice);
        const expected = finite(idea.expectedReturnPct);
        return idea.action === "INITIATE" &&
          idea.committee === "APPROVE" &&
          idea.confidence !== "LOW" &&
          current != null && current > 0 &&
          target != null && target > current &&
          expected != null && expected >= 8;
      })
      .map((idea) => {
        const requested = Math.max(0, Math.min(finite(idea.capitalUsd) ?? 0, nav * 0.08));
        const approved = Math.min(requested, remaining);
        remaining -= approved;
        return {
          ticker: idea.ticker,
          decision: approved > 0 ? "COMMITTEE_APPROVED_ALLOCATION" : "APPROVED_WAITING_FOR_CAPITAL",
          approvedCapitalUsd: Math.round(approved * 100) / 100,
          requestedCapitalUsd: Math.round(requested * 100) / 100,
          proposedWeightPct: finite(idea.targetWeightPct),
          currentPrice: finite(idea.currentPrice),
          targetPrice: finite(idea.targetPrice),
          expectedReturnPct: finite(idea.expectedReturnPct),
          conviction: finite(idea.conviction),
          confidence: idea.confidence,
          sources: idea.source,
          thesis: idea.thesis,
          evidenceGate: "PASS",
          committee: "APPROVE",
          execution: "HUMAN_REQUIRED",
        };
      });

    const rejected = (review.newIdeas ?? []).filter((idea) => !allocations.some((a) => a.ticker === idea.ticker)).map((idea) => ({
      ticker: idea.ticker,
      action: idea.action,
      committee: idea.committee,
      confidence: idea.confidence,
      expectedReturnPct: finite(idea.expectedReturnPct),
      reason: idea.reasons?.[0] ?? "Candidate did not clear the allocation evidence gate.",
    }));

    return NextResponse.json({
      version: "v8.4",
      status: blockers.length ? "WAIT" : allocations.some((a) => a.approvedCapitalUsd > 0) ? "READY_FOR_HUMAN_REVIEW" : "NO_APPROVED_ALLOCATION",
      asOf: new Date().toISOString(),
      policy: {
        verifiedNavRequired: true,
        cashBufferFloorProtected: true,
        committeeApprovalRequired: true,
        minimumExpectedReturnPct: 8,
        maximumNewPositionPct: 8,
        automaticExecution: false,
      },
      portfolio: {
        nav,
        regime: buffer.regime?.classification ?? null,
        bufferPosture: buffer.posture,
        bufferPct: finite(buffer.bufferPct),
        targetBufferPct: finite(buffer.targetPct),
        deployableCapitalUsd: deployable,
        allocatedCapitalUsd: Math.round((deployable - remaining) * 100) / 100,
        remainingCapitalUsd: Math.round(remaining * 100) / 100,
      },
      sources: {
        watchlistCandidates: watchTickers.length,
        discoveredCandidates: review.discovery,
      },
      blockers,
      allocations,
      rejected,
      note: "Decision support only. Approved allocations require a final human price check and manual execution.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Opportunity allocation failed." }, { status: 500 });
  }
}
