import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { sanitizeResearch } from "@/lib/sanitizeResearch";
import { buildUnderwritingPack } from "@/lib/stockUnderwriting";
import { governThomasSnapshot, resolveThomasValuationForMarketData } from "@/lib/thomasValuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

async function applyEvidenceGate(result: any) {
  const data = result?.data ?? {};
  const financials = data.financials ?? {};
  const income = Array.isArray(financials.income) ? financials.income : [];
  const cashflow = Array.isArray(financials.cashflow) ? financials.cashflow : [];
  const balance = Array.isArray(financials.balance) ? financials.balance : [];
  const quarters = Array.isArray(data.quarters) ? data.quarters : [];
  const externalPeers = Array.isArray(result?.research?.peers)
    ? result.research.peers.filter((p: any) => p && !p.isSubject && p.ticker)
    : [];

  const checks = {
    currentPrice: finite(data.quote?.price),
    annualIncome: income.length >= 2 && finite(income[0]?.totalRevenue),
    cashflow: cashflow.length >= 1 && finite(cashflow[0]?.operatingCashflow),
    balance: balance.length >= 1 && [balance[0]?.cashAndEquivalents, balance[0]?.totalAssets, balance[0]?.totalShareholderEquity].some(finite),
    quarterlyTrend: quarters.length >= 2,
    peerEvidence: externalPeers.length >= 2,
    valuationEvidence: Boolean(result?.dcf || result?.multiples),
  };

  const evidenceCount = Object.values(checks).filter(Boolean).length;
  const evidenceTotal = Object.keys(checks).length;
  const evidencePct = Math.round((evidenceCount / evidenceTotal) * 100);
  const hardBlocks: string[] = [];

  if (!checks.currentPrice) hardBlocks.push("current price is unavailable");
  if (!checks.annualIncome) hardBlocks.push("annual income statement history is insufficient");
  if (!checks.cashflow) hardBlocks.push("cash-flow statement history is insufficient");
  if (!checks.balance) hardBlocks.push("balance-sheet evidence is insufficient");
  if (evidenceCount < 4) hardBlocks.push("verified evidence coverage is below the institutional minimum");

  const snapshot = await resolveThomasValuationForMarketData(data, { dividends: [] }).catch(() => null);
  const governed = governThomasSnapshot(snapshot, data.quote?.price ?? null);
  if (!governed.decisionReady) hardBlocks.push(`governed valuation is not decision-ready: ${governed.reason}`);

  result.valuationGovernance = {
    status: governed.status,
    decisionReady: governed.decisionReady,
    fairValue: governed.fairValue,
    bearValue: governed.bearValue,
    bullValue: governed.bullValue,
    valuationGapPct: governed.valuationGapPct,
    confidence: snapshot?.confidence ?? "LOW",
    anchors: snapshot?.anchors ?? [],
    source: snapshot?.source ?? "UNAVAILABLE",
    modelRoute: snapshot?.modelRoute ?? null,
    asOf: snapshot?.asOf ?? null,
    expiresAt: snapshot?.expiresAt ?? null,
    reason: governed.reason,
  };
  if (governed.decisionReady && governed.fairValue != null) {
    const fairValue = governed.fairValue;
    result.targetPrice = fairValue;
    result.upsidePct = governed.valuationGapPct;
    result.expectedReturnPct = governed.valuationGapPct;
    result.valuationNote = governed.reason;
    result.valuationReady = true;
    result.valuationSource = "THOMAS_GOVERNED";
    result.thesis = (result.thesis ?? []).map((scenario: any) => ({
      ...scenario,
      ...(() => {
        const targetPrice = scenario.label === "Bear"
          ? governed.bearValue ?? fairValue
          : scenario.label === "Bull"
            ? governed.bullValue ?? fairValue
            : fairValue;
        const gap = data.quote?.price > 0 ? (targetPrice / data.quote.price - 1) * 100 : null;
        const gapText = gap == null
          ? "return versus spot unavailable"
          : Math.abs(gap) < 0.5
            ? "approximately fully valued; no margin of safety at spot"
            : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}% versus spot`;
        const caseText = scenario.label === "Bear"
          ? "Downside case from Thomas's governed valuation range"
          : scenario.label === "Bull"
            ? "Upside case from Thomas's governed valuation range"
            : "Thomas governed Fair Value";
        return { targetPrice, narrative: `${caseText}: $${targetPrice.toFixed(2)} (${gapText}). Source: ${snapshot?.source ?? "governed valuation"}.` };
      })(),
    }));
  } else {
    result.valuationReady = false;
    result.valuationSource = "PENDING";
  }

  const committee = result.committee ?? {};
  const deskScores = { ...(committee.deskScores ?? {}), data: evidencePct };
  const priorDissent = Array.isArray(committee.dissent) ? committee.dissent : [];
  const priorReasons = Array.isArray(committee.reasons) ? committee.reasons : [];

  if (hardBlocks.length) {
    result.committee = {
      ...committee,
      decision: "REJECT",
      conviction: Math.min(Number(committee.conviction) || 0, 35),
      confidence: "LOW",
      deskScores,
      reasons: priorReasons.filter((x: string) => !x.toLowerCase().startsWith("data ")).slice(0, 3),
      dissent: [...hardBlocks.map((x) => `Hard block: ${x}`), ...priorDissent].slice(0, 8),
      hardBlocks,
      sizeMultiplier: 0,
    };
    result.targetPrice = null;
    result.upsidePct = null;
    result.expectedReturnPct = null;
    result.signal = "HOLD";
    result.signalReasons = ["Evidence gate: research is incomplete and is not investment-ready."];
  } else {
    result.committee = {
      ...committee,
      deskScores,
      hardBlocks: [],
      confidence: evidencePct >= 86 && committee.confidence === "HIGH" ? "HIGH" : committee.confidence ?? "MEDIUM",
    };
  }

  result.evidenceCoverage = {
    checks,
    passed: evidenceCount,
    total: evidenceTotal,
    percent: evidencePct,
    hardBlocks,
  };

  return result;
}

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker")?.trim().toUpperCase();
  const engine = req.nextUrl.searchParams.get("engine")?.trim().toLowerCase() || null;
  const horizon = req.nextUrl.searchParams.get("horizon")?.trim() || null;
  if (!ticker || !/^[A-Z.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: "Provide a valid ticker (?ticker=NVDA)" }, { status: 400 });
  }

  try {
    const result = await buildAnalysis(ticker);
    if (!result.data.quote && result.data.candles.length === 0) {
      return NextResponse.json(
        { error: `No data returned for ${ticker}. Check that the symbol is a valid US-listed ticker.`, warnings: result.data.warnings },
        { status: 404 }
      );
    }

    if (result.research) result.research = await sanitizeResearch(result.research);
    const gated = await applyEvidenceGate(result);
    gated.underwriting = buildUnderwritingPack(gated, { engine, horizon });
    gated.analysisVersion = "12.1-institutional-equity-research";
    return NextResponse.json(gated, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Analysis failed" }, { status: 500 });
  }
}
