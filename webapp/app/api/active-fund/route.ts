import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";
import { runActiveFundV2 } from "@/lib/activeFundV2";
import { applyCommitteeCashPool, type CommitteeSnapshot } from "@/lib/activeFundGovernance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown, limit: number) =>
  Array.isArray(value)
    ? Array.from(new Set(value.map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => /^[A-Z.\-]{1,10}$/.test(x)))).slice(0, limit)
    : [];

const finiteOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

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
    // Existing-position motions are invalid as soon as the live ledger says the
    // line is closed. This prevents a recorded pre-sale meeting from recreating
    // a sold-out name in the fund Action Sheet. Conversely, a NEW BUY is no
    // longer a new-position motion once the name is already held.
    const valid = kind === "NEW BUY" ? !isHeld : ["ADD", "HOLD", "TRIM", "EXIT", "RAISE CASH"].includes(kind) ? isHeld : true;
    if (valid) kept.push(motion);
    else ignored.push(`${kind || "MOTION"} ${ticker}`.trim());
  }

  return {
    committee: { ...committee, motions: kept },
    ignored,
  };
}

async function buildReview(extraCandidates: string[] = [], committee: CommitteeSnapshot | null = null) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase portfolio source is unavailable.");

  const [holdingsRead, cash, watch] = await Promise.all([
    loadOpenHoldings(sb),
    buildCashBufferSnapshot(),
    sb.from("watchlist").select("ticker,stage").then((r: any) => r, () => ({ data: [], error: null })),
  ]);

  const heldTickers = new Set(holdingsRead.rows.map((row) => String(row.ticker).trim().toUpperCase()));
  const committeeSnapshot = committeeForCurrentBook(committee, heldTickers);
  const watchlistTickers = Array.from(new Set([
    ...((watch.data ?? []).map((row: any) => String(row.ticker ?? "").trim().toUpperCase())),
    ...extraCandidates,
  ].filter((ticker: string) => /^[A-Z.\-]{1,10}$/.test(ticker))));

  const totalNav = Number(cash.totalNav ?? 0);
  if (!(totalNav > 0)) throw new Error("Verified or provisional Fund NAV is required before active rotation review.");

  const raw = await runActiveFundV2({
    positions: holdingsRead.rows.map(row => ({ ticker: row.ticker, shares: Number(row.shares), avgCost: Number(row.avg_cost) })),
    watchlistTickers,
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

  const result = applyCommitteeCashPool(raw, committeeSnapshot.committee);
  return {
    ...result,
    sourceOfTruth: holdingsRead.origin,
    reconciliationNote: holdingsRead.note,
    watchlistCount: watchlistTickers.length,
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
