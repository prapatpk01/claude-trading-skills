import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { buildAuthoritativeCashBufferSnapshot as buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";
import { runActivePortfolioIntelligenceV21 } from "@/lib/activePortfolioIntelligenceV21";
import { applyCommitteeCashPool, type CommitteeSnapshot } from "@/lib/activeFundGovernance";
import { dailyCandles } from "@/lib/marketData";
import { computePortfolioTechnicalOverlay, type PortfolioTechnicalOverlay } from "@/lib/portfolioTechnicalOverlay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESERVE_TICKERS = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA", "TBIL", "SHY", "MINT"]);

const cleanTickers = (value: unknown, limit: number) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => /^[A-Z.\-]{1,10}$/.test(x)))).slice(0, limit)
    : [];

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) break;
      out[index] = await fn(items[index]);
    }
  }));
  return out;
}

function cleanCommittee(value: unknown): CommitteeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as any;
  const motions = Array.isArray(raw.motions)
    ? raw.motions
        .map((motion: any) => ({
          ticker: String(motion?.ticker ?? "").trim().toUpperCase(),
          kind: String(motion?.kind ?? ""),
          sizeUsd: finiteOrNull(motion?.sizeUsd),
          approxShares: finiteOrNull(motion?.approxShares),
          outcome: String(motion?.outcome ?? ""),
          outcomeReason: motion?.outcomeReason == null ? null : String(motion.outcomeReason),
          veto: motion?.veto && typeof motion.veto === "object"
            ? { member: String(motion.veto.member ?? ""), reason: String(motion.veto.reason ?? "") }
            : null,
          decisionGates: Array.isArray(motion?.decisionGates)
            ? motion.decisionGates.map((gate: any) => ({
                stage: String(gate?.stage ?? ""),
                status: String(gate?.status ?? ""),
                rationale: String(gate?.rationale ?? ""),
              }))
            : [],
        }))
        .filter((motion: any) => /^[A-Z.\-]{1,10}$/.test(motion.ticker))
        .slice(0, 50)
    : [];
  return {
    meetingId: raw.meetingId == null ? null : String(raw.meetingId),
    asOf: raw.asOf == null ? null : String(raw.asOf),
    motions,
  };
}

function committeeForCurrentBook(committee: CommitteeSnapshot | null, heldTickers: Set<string>) {
  if (!committee) return { committee: null as CommitteeSnapshot | null, ignored: [] as string[] };
  const motions = Array.isArray(committee.motions) ? committee.motions : [];
  const kept: typeof motions = [];
  const ignored: string[] = [];

  for (const motion of motions) {
    const ticker = String(motion.ticker ?? "").trim().toUpperCase();
    const kind = String(motion.kind ?? "").trim().toUpperCase();
    const isHeld = heldTickers.has(ticker);
    const valid = kind === "NEW BUY" ? !isHeld : ["ADD", "HOLD", "TRIM", "EXIT", "RAISE CASH"].includes(kind) ? isHeld : true;
    if (valid) kept.push(motion);
    else ignored.push(`${kind || "MOTION"} ${ticker}`.trim());
  }

  return {
    committee: { ...committee, motions: kept },
    ignored,
  };
}

async function loadHoldingTechnicalOverlays(rows: { ticker: string }[]) {
  const tickers = Array.from(new Set(rows
    .map((row) => String(row.ticker ?? "").trim().toUpperCase())
    .filter((ticker) => ticker && !RESERVE_TICKERS.has(ticker))));
  const pairs = await mapLimit(tickers, 5, async (ticker) => {
    const candles = await dailyCandles(ticker, 460).catch(() => []);
    return [ticker, computePortfolioTechnicalOverlay(candles)] as const;
  });
  return new Map<string, PortfolioTechnicalOverlay | null>(pairs);
}

function priceLevel(value: number | null | undefined, fallback: string) {
  return value == null ? fallback : `$${value.toFixed(2)}`;
}

function technicalGateCommittee(committee: CommitteeSnapshot | null, overlays: Map<string, PortfolioTechnicalOverlay | null>) {
  if (!committee) return { committee: null as CommitteeSnapshot | null, blockedAdds: [] as string[] };
  const blockedAdds: string[] = [];
  const motions = (committee.motions ?? []).map((motion: any) => {
    const ticker = String(motion?.ticker ?? "").trim().toUpperCase();
    const kind = String(motion?.kind ?? "").trim().toUpperCase();
    if (kind !== "ADD") return motion;

    const overlay = overlays.get(ticker) ?? null;
    if (overlay?.action === "ADD") return motion;

    const technicalState = overlay?.action ?? "UNAVAILABLE";
    const reason = overlay
      ? `Holdings technical execution gate is ${technicalState} (${overlay.confidence}% confidence), not ADD. T1 ${priceLevel(overlay.target1, "n/a")}, T2 ${priceLevel(overlay.target2, "conditional")}, S1 ${priceLevel(overlay.support1, "n/a")}. Re-run the CIO meeting after the technical gate changes before adding risk.`
      : "Holdings technical execution gate is unavailable, so an ADD cannot be treated as executable. Re-run the CIO meeting after the Holdings technical overlay is measurable.";
    blockedAdds.push(`${ticker}: ${technicalState}`);
    return {
      ...motion,
      outcome: "DEFERRED",
      outcomeReason: reason,
      veto: { member: "Maya Chen · Holdings Technical Gate", reason },
    };
  });
  return { committee: { ...committee, motions }, blockedAdds };
}

function attachTechnicalOverlay(result: any, overlays: Map<string, PortfolioTechnicalOverlay | null>, blockedAdds: string[]) {
  const technicalFields = (tickerValue: unknown) => {
    const ticker = String(tickerValue ?? "").trim().toUpperCase();
    const overlay = overlays.get(ticker) ?? null;
    return {
      technicalDecision: overlay?.action ?? null,
      technicalConfidence: overlay?.confidence ?? null,
      technicalReason: overlay?.reason ?? null,
      technicalTarget1: overlay?.target1 ?? null,
      technicalTarget2: overlay?.target2 ?? null,
      technicalSupport1: overlay?.support1 ?? null,
      technicalRoomAtr: overlay?.roomAtr ?? null,
    };
  };

  return {
    ...result,
    existing: (result?.existing ?? []).map((row: any) => ({ ...row, ...technicalFields(row.ticker) })),
    executionPlans: (result?.executionPlans ?? []).map((row: any) => ({ ...row, ...technicalFields(row.ticker) })),
    technicalSignalAlignment: {
      source: "portfolioTechnicalOverlay · same engine as Holdings",
      rule: "Current holdings may ADD only when the Holdings technical execution gate is also ADD. TRIM/HOLD/EXIT REVIEW or unavailable technical evidence blocks a contradictory ADD.",
      blockedAdds,
    },
  };
}

function watchlistPlaceholder(ticker: string) {
  return {
    ticker,
    source: ["WATCHLIST", "Authoritative Supabase watchlist"],
    held: false,
    action: "RESEARCH INCOMPLETE",
    conviction: 0,
    confidence: "LOW",
    expectedReturnPct: null,
    targetPrice: null,
    currentPrice: null,
    momentum: null,
    pnlPct: null,
    portfolioScore: 0,
    targetWeightPct: 0,
    capitalUsd: 0,
    committee: "WATCHLIST RE-UNDERWRITE",
    thesis: "This ticker is on the authoritative watchlist. Research could not complete all required evidence this cycle, so the name remains visible instead of being silently dropped.",
    dissent: ["Research evidence incomplete this cycle"],
    reasons: ["Authoritative watchlist membership is preserved independently from Research OS ranking."],
    primaryEngine: "Watchlist Re-underwrite",
    discoveryEngines: ["WATCHLIST"],
    lifecycleStage: "BROKEN",
    lifecycleScore: 0,
    lifecycleEvidence: [],
    searchBasis: "Authoritative Supabase watchlist",
    searchBasisTh: "Watchlist จริงจาก Supabase",
    investmentHorizon: "Signal-driven",
    investmentHorizonTh: "ตามสัญญาณ",
    reviewCadence: "Re-underwrite next cycle; do not remove unless the owner removes it from Watchlist.",
    reviewCadenceTh: "วิเคราะห์ใหม่รอบถัดไป และไม่ลบออกจนกว่าเจ้าของพอร์ตจะลบจาก Watchlist จริง",
    researchStatus: "INCOMPLETE",
    valuationGapPct: null,
    valuationStatus: "UNAVAILABLE",
    valuationSource: "UNAVAILABLE",
    valuationNote: "Fair Value evidence is incomplete; no target is manufactured from spot price.",
    valuationDecisionReady: false,
    valuationConfidence: "LOW",
    valuationBear: null,
    valuationBull: null,
    valuationAnchors: [],
    valuationAsOf: null,
    valuationExpiresAt: null,
    valuationModelRoute: null,
    valuationWarnings: ["Authoritative watchlist row retained while underwriting is incomplete"],
    positionShares: null,
    marketValueUsd: null,
    ideaCategory: "WATCHLIST_REUNDERWRITE",
    rotationCadence: "LIVE WATCHLIST",
    universeSource: "SUPABASE WATCHLIST",
  };
}

/**
 * The Watchlist screen and CIO must speak about the same set of names. Research
 * engines may score, rank or fail a ticker, but they are not allowed to add or
 * remove Watchlist membership. This final normalization makes the Supabase
 * watchlist authoritative and keeps a placeholder row when underwriting fails
 * so a tracked name can never silently disappear from the CIO review.
 */
function enforceAuthoritativeWatchlist(result: any, authoritativeTickers: string[]) {
  const authoritative = new Set(authoritativeTickers);
  const candidateRows = [
    ...(result?.watchlistReviews ?? []),
    ...(result?.newIdeas ?? []),
    ...(result?.researchIncomplete ?? []),
  ];
  const byTicker = new Map<string, any>();
  for (const row of candidateRows) {
    const ticker = String(row?.ticker ?? "").trim().toUpperCase();
    if (!ticker || byTicker.has(ticker)) continue;
    byTicker.set(ticker, row);
  }

  const unresolved: string[] = [];
  const watchlistReviews = authoritativeTickers.map((ticker) => {
    const row = byTicker.get(ticker);
    if (!row) {
      unresolved.push(ticker);
      return watchlistPlaceholder(ticker);
    }
    const priorSource = Array.isArray(row.source) ? row.source.map((value: unknown) => String(value)) : [];
    return {
      ...row,
      ticker,
      source: ["WATCHLIST", ...priorSource.filter((value: string) => value.toUpperCase() !== "WATCHLIST")],
      ideaCategory: "WATCHLIST_REUNDERWRITE",
      searchBasis: "Authoritative Supabase watchlist",
      searchBasisTh: "Watchlist จริงจาก Supabase",
      universeSource: "SUPABASE WATCHLIST",
    };
  });

  const removeWatchlistNames = (rows: any[]) => (rows ?? []).filter((row: any) => !authoritative.has(String(row?.ticker ?? "").trim().toUpperCase()));
  const reviewedCount = watchlistReviews.length - unresolved.length;
  return {
    ...result,
    newIdeas: removeWatchlistNames(result?.newIdeas ?? []),
    researchIncomplete: removeWatchlistNames(result?.researchIncomplete ?? []),
    watchlistReviews,
    authoritativeWatchlistTickers: authoritativeTickers,
    watchlistCount: authoritativeTickers.length,
    watchlistReviewedCount: reviewedCount,
    watchlistUnresolved: unresolved,
    discovery: result?.discovery ? { ...result.discovery, watchlist: authoritativeTickers.length } : result?.discovery,
    watchlistSource: "Supabase watchlist · authoritative membership",
  };
}

async function buildReview(extraCandidates: string[] = [], committee: CommitteeSnapshot | null = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase portfolio source is unavailable.");

  const [holdingsRead, cash, watch] = await Promise.all([
    loadOpenHoldings(sb),
    buildCashBufferSnapshot(),
    sb.from("watchlist").select("ticker,stage"),
  ]);
  if (watch.error) throw new Error(`Authoritative watchlist unavailable: ${watch.error.message}`);

  const heldTickers = new Set(holdingsRead.rows.map((row) => String(row.ticker).trim().toUpperCase()));
  const committeeSnapshot = committeeForCurrentBook(committee, heldTickers);
  const authoritativeWatchlistTickers = Array.from(new Set(
    (watch.data ?? [])
      .map((row: any) => String(row.ticker ?? "").trim().toUpperCase())
      .filter((ticker: string) => /^[A-Z.\-]{1,10}$/.test(ticker) && !heldTickers.has(ticker))
  ));
  const analysisTickers = Array.from(new Set([
    ...authoritativeWatchlistTickers,
    ...extraCandidates,
  ].filter((ticker: string) => /^[A-Z.\-]{1,10}$/.test(ticker))));

  const totalNav = Number(cash.totalNav ?? 0);
  if (!(totalNav > 0)) throw new Error("Verified or provisional Fund NAV is required before active rotation review.");

  const technicalPromise = loadHoldingTechnicalOverlays(holdingsRead.rows);
  const activeFundPromise = runActivePortfolioIntelligenceV21({
    positions: holdingsRead.rows.map(row => ({ ticker: row.ticker, shares: Number(row.shares), avgCost: Number(row.avg_cost) })),
    watchlistTickers: analysisTickers,
    cash: {
      totalNav,
      cashBalance: Number(cash.cashBalance ?? 0),
      dividendAvailable: Number(cash.dividendAvailable ?? 0),
      liquidityBuffer: Number(cash.liquidityBuffer ?? 0),
      cashFloorPct: Number(cash.cashFloorPct ?? cash.targetPct ?? 0),
      targetValue: Number(cash.targetValue ?? 0),
      bufferPct: cash.bufferPct == null ? null : Number(cash.bufferPct),
      reserveHoldings: (cash.reserveHoldings ?? []).map((row: any) => ({ ticker: String(row.ticker), marketValue: Number(row.marketValue ?? 0) })),
    },
  });

  const [raw, overlays] = await Promise.all([activeFundPromise, technicalPromise]);
  const technicalGate = technicalGateCommittee(committeeSnapshot.committee, overlays);
  const governed = applyCommitteeCashPool(raw, technicalGate.committee);
  const withTechnical = attachTechnicalOverlay(governed, overlays, technicalGate.blockedAdds);
  const result = enforceAuthoritativeWatchlist(withTechnical, authoritativeWatchlistTickers);

  return {
    ...result,
    sourceOfTruth: holdingsRead.origin,
    reconciliationNote: holdingsRead.note,
    watchlistCount: authoritativeWatchlistTickers.length,
    authoritativeWatchlistTickers,
    ignoredStaleCommitteeMotions: committeeSnapshot.ignored,
    navVerification: {
      verified: Boolean(cash.verified),
      valuationMode: String(cash.valuationMode ?? (cash.verified ? "LIVE_MARKET" : "UNVERIFIED")),
      missingPrices: Array.isArray(cash.missingPrices) ? cash.missingPrices : [],
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await buildReview(), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Active fund review failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const extraCandidates = cleanTickers(body?.candidateTickers, 25);
    const committee = cleanCommittee(body?.committee);
    return NextResponse.json(await buildReview(extraCandidates, committee), { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Active fund review failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
