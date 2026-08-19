// Sentinel Decision Authority V22 wrapper.
//
// The original committee engine is preserved byte-for-byte in committeeLegacy.ts.
// This wrapper upgrades the four sequential authority gates without weakening
// the legacy execution safeguards: a CONDITIONAL decision is always DEFERRED
// and never reaches the broker blotter automatically.

export * from "./committeeLegacy";

import { runCommitteeMeeting as runLegacyCommitteeMeeting } from "./committeeLegacy";
import type { CommitteeInput, CommitteeMeeting, Motion } from "./committeeLegacy";
import { applyDecisionAuthorityV22 } from "./authorityV22";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A policy shortfall must never disappear merely because the sale motions are
 * still waiting for human approval. The legacy capital plan intentionally uses
 * CARRIED motions only, which is correct for executable capital, but it made a
 * below-floor meeting look "READY" with $0 sources and $0 destinations.
 *
 * Keep approved/executable accounting untouched. When the Cash Buffer is below
 * its authoritative floor, append the pending RAISE CASH motions as clearly
 * labelled PROPOSED source lines, show their ring-fenced Cash Buffer
 * destination, and lock approval until enough repair capital is actually
 * carried. This tells the fund owner exactly what would be sold and how much
 * without turning a proposal into an automatic broker instruction.
 */
function exposePendingCashFloorRepair<T extends CommitteeMeeting>(meeting: T, input: CommitteeInput): T {
  const targetPct = input.targetCashPct ?? input.regime?.cashMinPct ?? null;
  const currentPct = input.cashBufferPct;
  if (targetPct == null || currentPct == null || input.nav <= 0) return meeting;

  const targetUsd = input.nav * targetPct / 100;
  const currentUsd = input.nav * currentPct / 100;
  const shortfallUsd = round2(Math.max(0, targetUsd - currentUsd));
  if (shortfallUsd <= 0.01) return meeting;

  const repairMotions = meeting.motions.filter((motion: Motion) => motion.kind === "RAISE CASH" && motion.sizeUsd < 0);
  const carriedMotions = repairMotions.filter((motion: Motion) => motion.outcome === "CARRIED");
  const pendingMotions = repairMotions.filter((motion: Motion) => motion.outcome !== "CARRIED");
  const carriedUsd = round2(carriedMotions.reduce((sum: number, motion: Motion) => sum + Math.abs(motion.sizeUsd), 0));
  const remainingUsd = round2(Math.max(0, shortfallUsd - carriedUsd));

  // If approved repairs already cover the floor, the legacy capital plan is
  // complete and remains the source of truth without any projection overlay.
  if (remainingUsd <= 0.01) return meeting;

  let pendingNeeded = remainingUsd;
  const proposedLines: { label: string; amountUsd: number }[] = [];
  let proposedUsd = 0;
  for (const motion of pendingMotions) {
    if (pendingNeeded <= 0.01) break;
    const amountUsd = round2(Math.min(pendingNeeded, Math.abs(motion.sizeUsd)));
    if (amountUsd <= 0) continue;
    const shares = motion.approxShares != null ? ` (~${motion.approxShares.toLocaleString("en-US")} shares)` : "";
    proposedLines.push({
      label: `PROPOSED SELL ${motion.ticker}${shares} · Cash Floor repair · ${motion.outcome}`,
      amountUsd,
    });
    proposedUsd = round2(proposedUsd + amountUsd);
    pendingNeeded = round2(pendingNeeded - amountUsd);
  }

  const projectedBufferPct = round2(Math.min(100, ((currentUsd + carriedUsd + proposedUsd) / input.nav) * 100));
  const sourceLabels = new Set(meeting.capitalPlan.sourceLines.map((line) => line.label));
  const sourceLines = [
    ...meeting.capitalPlan.sourceLines,
    ...proposedLines.filter((line) => !sourceLabels.has(line.label)),
  ];
  const destinationLines = [
    ...meeting.capitalPlan.destinationLines,
    ...(proposedUsd > 0 ? [{
      category: "CASH_RESERVE" as const,
      label: `PROPOSED · restore Cash Buffer ${currentPct.toFixed(1)}% → ${targetPct.toFixed(1)}% (USD / approved reserve)`,
      amountUsd: proposedUsd,
      owner: "Lena Müller",
      reviewBy: null,
    }] : []),
  ];

  meeting.capitalPlan = {
    ...meeting.capitalPlan,
    sourcesUsd: round2(meeting.capitalPlan.sourcesUsd + proposedUsd),
    sourceLines,
    destinationLines,
    cashAfterPct: projectedBufferPct,
    funded: false,
    allocationComplete: false,
    approvalReady: false,
    allocationStatus: "INCOMPLETE",
    note: proposedUsd > 0
      ? `ACTION REQUIRED · Cash Buffer is ${currentPct.toFixed(1)}% versus the ${targetPct.toFixed(1)}% policy floor. Shortfall ${shortfallUsd.toLocaleString("en-US", { style: "currency", currency: "USD" })}. The PROPOSED SELL lines above name the risk assets, approximate shares and dollars required to repair the floor. Their proceeds are ring-fenced for Cash Buffer (USD or an approved reserve such as SGOV/JAAA) and cannot fund a new risk purchase. Human approval is still required before execution.`
      : `ACTION REQUIRED · Cash Buffer is ${currentPct.toFixed(1)}% versus the ${targetPct.toFixed(1)}% policy floor, a shortfall of ${shortfallUsd.toLocaleString("en-US", { style: "currency", currency: "USD" })}. No measurable RAISE CASH source could be produced on this snapshot, so the capital plan is blocked rather than falsely marked READY.`,
  };

  return meeting;
}

export function runCommitteeMeeting(input: CommitteeInput) {
  const meeting = runLegacyCommitteeMeeting(input);
  const governed = applyDecisionAuthorityV22(meeting, input);
  return exposePendingCashFloorRepair(governed, input);
}
