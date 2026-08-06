import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import {
  DEFAULT_RECONCILIATION_TOLERANCE_PCT,
  reconcileCommitteeMotions,
  type PortfolioTransaction,
  type ReconciliationMotion,
} from "@/lib/committeeReconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Stage 5 of the investment meeting: human approval, execution and the record.
 *
 * This is the only route in the app that turns a committee decision into a
 * ledger entry, and it is deliberately narrow.
 *
 *   Nothing is applied that a person did not mark APPROVED. The meeting's own
 *   verdict is not sufficient — a carried motion is a recommendation, and this
 *   route requires a second, explicit human act on each line.
 *
 *   An amendment is a decision too. A human may change the size or the price;
 *   what gets recorded is what they approved, not what the committee proposed,
 *   and the difference is kept in the minutes.
 *
 *   The minutes are written whether or not every fill succeeded. A meeting that
 *   half-executed and left no record is worse than one that failed outright.
 */

type Verdict = "APPROVED" | "REJECTED" | "AMENDED";

interface DecisionInput {
  resolutionId?: string;
  ticker: string;
  kind: string;
  /** What the committee proposed. Signed: positive buys, negative sells. */
  proposedUsd?: number | null;
  proposedShares?: number | null;
  verdict: Verdict;
  /** Set on AMENDED. What the human actually authorises. */
  approvedShares?: number | null;
  approvedPrice?: number | null;
  note?: string | null;
}

async function readTransactionMatches(
  sb: NonNullable<ReturnType<typeof getSupabase>>,
  motions: ReconciliationMotion[],
  sinceDate: string,
  tolerancePct: number,
) {
  const tickers = Array.from(new Set(motions.map((motion) => String(motion.ticker).trim().toUpperCase()).filter(Boolean)));
  if (!tickers.length) return [];
  const { data, error } = await sb
    .from("portfolio_transactions")
    .select("id,ticker,side,shares,price,trade_date,created_at")
    .in("ticker", tickers)
    .gte("trade_date", sinceDate)
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(error.message);
  return reconcileCommitteeMotions(motions, (data ?? []) as PortfolioTransaction[], sinceDate, tolerancePct);
}

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const roundShares = (v: number) => Math.round(v * 1e7) / 1e7;

/** The table this route writes to, and the migration that creates it. */
const MINUTES_TABLE = "committee_minutes";
const MIGRATION_HINT = "supabase/migrations/20260805_committee_minutes.sql";

export async function GET(req: NextRequest) {
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured.", minutes: [] }, { status: 503 });

  const limit = Math.min(100, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10) || 20));
  const meetingId = String(req.nextUrl.searchParams.get("meetingId") ?? "").trim();

  let query = sb.from(MINUTES_TABLE).select("*").order("created_at", { ascending: false }).limit(limit);
  if (meetingId) query = query.eq("meeting_id", meetingId);

  const { data, error } = await query;
  if (error) {
    // A missing table is a deployment state, not a failure to report as one.
    if (/does not exist|schema cache|relation/i.test(error.message)) {
      return NextResponse.json({
        minutes: [],
        persistence: "unavailable",
        detail: `The ${MINUTES_TABLE} table has not been created on this database. Run ${MIGRATION_HINT}. Approvals still apply to the ledger; only the meeting record is missing.`,
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ minutes: data ?? [], persistence: "supabase" });
}

/** Preview how the committee motions map to transactions already recorded in Holdings. */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const motions: ReconciliationMotion[] = Array.isArray(body.motions) ? body.motions : [];
  const sinceDate = String(body.tradeDate ?? body.asOf ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const tolerancePct = Math.min(100, Math.max(0, finite(body.tolerancePct) ?? DEFAULT_RECONCILIATION_TOLERANCE_PCT));
  if (!motions.length) return NextResponse.json({ error: "No motions were supplied for reconciliation." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) return NextResponse.json({ error: "A valid reconciliation date is required." }, { status: 400 });
  const sb = getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const matches = await readTransactionMatches(sb, motions, sinceDate, tolerancePct);
    return NextResponse.json({ mode: "RECONCILE_EXISTING", sinceDate, tolerancePct, matches }, { headers: { "Cache-Control": "no-store" } });
  } catch (cause: unknown) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : "Portfolio reconciliation failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));

  // ── Two locks, both explicit, neither inferable from the meeting itself ──
  const approvedBy = String(body.approvedBy ?? "").trim();
  if (body.humanApproved !== true) {
    return NextResponse.json(
      { error: "humanApproved must be exactly true. The committee's own verdict does not authorise a trade; a person does." },
      { status: 400 }
    );
  }
  if (!approvedBy) {
    return NextResponse.json({ error: "approvedBy is required. An approval with no name attached is not an approval." }, { status: 400 });
  }

  const meetingId = String(body.meetingId ?? "").trim();
  if (!/^[A-Za-z0-9_.\-]{3,64}$/.test(meetingId)) {
    return NextResponse.json({ error: "A meetingId is required to record and de-duplicate the minutes." }, { status: 400 });
  }

  const decisions: DecisionInput[] = Array.isArray(body.decisions) ? body.decisions : [];
  if (!decisions.length) {
    return NextResponse.json({ error: "No decisions were submitted." }, { status: 400 });
  }

  const sb = getSupabaseAdmin() ?? getSupabase();
  if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const reconciliationMode = String(body.mode ?? "").toUpperCase() === "RECONCILE_EXISTING";
  const tradeDate = String(body.tradeDate ?? body.asOf ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const tolerancePct = Math.min(100, Math.max(0, finite(body.tolerancePct) ?? DEFAULT_RECONCILIATION_TOLERANCE_PCT));
  let reconciledByResolution = new Map<string, ReturnType<typeof reconcileCommitteeMotions>[number]>();
  if (reconciliationMode) {
    try {
      const matches = await readTransactionMatches(
        sb,
        decisions.map((decision) => ({
          id: String(decision.resolutionId ?? `${decision.kind}-${decision.ticker}`),
          ticker: decision.ticker,
          kind: decision.kind,
          proposedUsd: decision.proposedUsd,
          proposedShares: decision.proposedShares,
        })),
        tradeDate,
        tolerancePct,
      );
      reconciledByResolution = new Map(matches.map((match) => [match.resolutionId, match]));
    } catch (cause: unknown) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Portfolio reconciliation failed." }, { status: 500 });
    }
  }

  // ── Idempotency. A meeting applies once. ──
  let persistence: "supabase" | "unavailable" = "supabase";
  const existing = await sb.from(MINUTES_TABLE).select("meeting_id,created_at").eq("meeting_id", meetingId).limit(1);
  if (existing.error) {
    if (/does not exist|schema cache|relation/i.test(existing.error.message)) persistence = "unavailable";
    else return NextResponse.json({ error: existing.error.message }, { status: 500 });
  } else if ((existing.data ?? []).length && body.supersede !== true) {
    return NextResponse.json(
      {
        error: `Minutes for ${meetingId} were already recorded on ${existing.data![0].created_at}. Applying them twice would double every position. Send supersede: true only if you intend to record a corrected version.`,
        alreadyRecorded: true,
      },
      { status: 409 }
    );
  }

  /* ── Apply only what a person approved, line by line ── */
  const applied: any[] = [];
  const skipped: any[] = [];
  const failed: any[] = [];

  for (const decision of decisions) {
    const ticker = String(decision.ticker ?? "").trim().toUpperCase();
    const kind = String(decision.kind ?? "").trim().toUpperCase();
    const verdict = String(decision.verdict ?? "").trim().toUpperCase() as Verdict;

    if (verdict === "REJECTED") {
      skipped.push({ ticker, kind, reason: "Rejected by the approver.", note: decision.note ?? null });
      continue;
    }
    if (verdict !== "APPROVED" && verdict !== "AMENDED") {
      skipped.push({ ticker, kind, reason: `Unrecognised verdict "${decision.verdict}" — nothing applied.` });
      continue;
    }
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker)) {
      failed.push({ ticker, kind, error: "Invalid ticker; nothing applied for this line." });
      continue;
    }

    if (reconciliationMode) {
      const resolutionId = String(decision.resolutionId ?? `${kind}-${ticker}`);
      const match = reconciledByResolution.get(resolutionId);
      if (!match || match.status === "NOT_FOUND") {
        failed.push({ ticker, kind, error: `No matching ${match?.expectedSide ?? "portfolio"} transaction was found in Holdings on or after ${tradeDate}.` });
        continue;
      }
      applied.push({
        ticker, kind, side: match.expectedSide,
        shares: match.actualShares, price: match.actualPrice,
        valueUsd: match.actualValueUsd, variancePct: match.variancePct,
        verdict, reconciliationStatus: match.status,
        transactionIds: match.transactionIds,
        mode: "RECONCILED_EXISTING",
      });
      continue;
    }

    // HOLD carries no trade. Approving it is a decision, not an instruction.
    const shares = finite(decision.approvedShares) ?? finite(decision.proposedShares);
    if (kind === "HOLD" || !shares) {
      skipped.push({ ticker, kind, reason: kind === "HOLD" ? "Hold approved — reviewed and confirmed, no transaction." : "No share count was authorised, so nothing could be recorded." });
      continue;
    }

    const price = finite(decision.approvedPrice);
    if (price == null || price <= 0) {
      failed.push({ ticker, kind, error: "An execution price is required. The committee's reference price is an estimate, not a fill — record what the trade actually filled at." });
      continue;
    }

    // Sells: EXIT, TRIM and RAISE CASH. Everything else buys.
    const side = kind === "EXIT" || kind === "TRIM" || kind === "RAISE CASH" ? "SELL" : "BUY";
    const notes = [
      `Committee ${meetingId} · ${kind}`,
      verdict === "AMENDED" ? `AMENDED by ${approvedBy} from ${decision.proposedShares ?? "?"} shares` : `approved by ${approvedBy}`,
      kind === "RAISE CASH" ? "proceeds retained in the Cash Buffer as USD or approved reserves — not deployed into risk assets" : "",
      decision.note ?? "",
    ].filter(Boolean).join(" · ");

    const { data, error } = await sb.rpc("execute_portfolio_trade", {
      p_ticker: ticker,
      p_side: side,
      p_shares: roundShares(Math.abs(shares)),
      p_price: price,
      p_trade_date: tradeDate,
      p_notes: notes,
      p_thesis: null,
      p_target_price: null,
    });

    if (error) failed.push({ ticker, kind, side, shares: Math.abs(shares), price, error: error.message });
    else applied.push({ ticker, kind, side, shares: Math.abs(shares), price, verdict, result: data ?? null });
  }

  /* ── Record the meeting, whatever happened above ── */
  const record = {
    meeting_id: meetingId,
    approved_by: approvedBy,
    as_of: String(body.asOf ?? new Date().toISOString()),
    regime: body.regime ?? null,
    quorum: body.quorum ?? null,
    agenda: body.agenda ?? null,
    minutes: body.minutes ?? null,
    resolutions: body.resolutions ?? null,
    dissent: body.dissent ?? null,
    decisions,
    applied,
    skipped,
    failed,
  };

  let recorded = false;
  let recordError: string | null = null;
  if (persistence === "supabase") {
    const { error } = await sb.from(MINUTES_TABLE).insert(record);
    if (error) {
      if (/does not exist|schema cache|relation/i.test(error.message)) persistence = "unavailable";
      else recordError = error.message;
    } else recorded = true;
  }

  const summary = [
    reconciliationMode
      ? `${applied.length} existing portfolio transaction(s) reconciled — no trade was created`
      : `${applied.length} transaction(s) recorded in the ledger`,
    `${skipped.length} line(s) required none`,
    failed.length ? `${failed.length} failed and were NOT recorded` : null,
  ].filter(Boolean).join(", ") + ".";

  return NextResponse.json(
    {
      meetingId,
      approvedBy,
      summary,
      applied,
      skipped,
      failed,
      recorded,
      persistence,
      recordError,
      note:
        persistence === "unavailable"
          ? reconciliationMode
            ? `The Holdings comparison completed and no trade was created, but the checklist could not be stored because the ${MINUTES_TABLE} table does not exist on this database. Run ${MIGRATION_HINT} to keep committee minutes.`
            : `Trades were applied to the ledger, but the meeting record could not be stored: the ${MINUTES_TABLE} table does not exist on this database. Run ${MIGRATION_HINT} to keep minutes. The ledger entries carry the meeting id in their notes, so the audit trail survives either way.`
          : recorded
          ? reconciliationMode
            ? "The checklist is on the record. It references existing Holdings transactions and did not create another trade."
            : "The meeting is on the record. Every applied line carries the meeting id in its ledger note."
          : reconciliationMode
            ? `The Holdings comparison completed and no trade was created, but the checklist failed to save${recordError ? `: ${recordError}` : ""}.`
            : `The meeting record failed to save${recordError ? `: ${recordError}` : ""}. The ledger entries are still there and carry the meeting id in their notes.`,
      disclosures: [
        reconciliationMode
          ? "The portfolio transaction ledger remained the source of truth. This approval only matched and recorded existing Holdings activity; it did not create another trade."
          : "Only lines a person marked APPROVED or AMENDED were applied. A carried motion on its own does nothing.",
        reconciliationMode
          ? `Directional BUY/SELL matches within ${tolerancePct}% of the proposed size were marked as close matches; different sizes were retained as amendments for human review.`
          : "Prices recorded are the ones supplied by the approver, not the committee's reference price.",
        failed.length ? "Failed lines were not recorded and were not retried. Re-submit them individually once the cause is understood." : null,
      ].filter(Boolean),
    },
    { status: failed.length ? 207 : 200, headers: { "Cache-Control": "no-store" } }
  );
}
