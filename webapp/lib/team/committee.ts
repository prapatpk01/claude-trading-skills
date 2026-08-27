// Sentinel Investment V36 committee wrapper.
//
// The legacy committee remains the auditable motion/capital-plan engine. V36
// normalizes portfolio policy to the authoritative deployment regime before
// that engine runs, then applies the V36 ownership / momentum / risk authority
// layer. Human approval and the no-auto-execution rule remain unchanged.

export * from "./committeeLegacy";

import { runCommitteeMeeting as runLegacyCommitteeMeeting } from "./committeeLegacy";
import type { CommitteeInput, CommitteeMeeting, Motion } from "./committeeLegacy";
import { applyDecisionAuthorityV36 } from "./authorityV36";
import { allocationFor, DRIFT_ALERT_PCT } from "./portfolio";

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * V36 policy normalization.
 *
 * 1. Sleeve targets follow the current regime instead of the static 55/35/10
 *    strategic mix.
 * 2. The book's cash read is replaced with the same authoritative Total
 *    Liquidity Buffer used by the Cash Buffer / CIO deployment engine.
 * 3. A sleeve drift, beta warning or trend warning remains visible, but no
 *    longer globally vetoes an unrelated qualifying new idea. Only genuinely
 *    execution-blocking risks remain HIGH.
 */
function normalizeInputV36(input: CommitteeInput): CommitteeInput {
  if (!input.book) return input;

  const targets = allocationFor(input.regime?.regime);
  const sleeves = input.book.sleeves.map((row) => {
    const targetPct = targets[row.sleeve] ?? row.targetPct;
    const driftPct = round2(row.actualPct - targetPct);
    return {
      ...row,
      targetPct,
      driftPct,
      alert: Math.abs(driftPct) > DRIFT_ALERT_PCT,
    };
  });

  const floorPct = input.targetCashPct ?? input.regime?.cashMinPct ?? input.book.cashRequiredPct ?? null;
  const currentPct = input.cashBufferPct ?? input.book.cashPct;

  const riskRegister = input.book.riskRegister
    // Remove the legacy Holdings-only cash-floor read. A fresh authoritative
    // Total Liquidity Buffer item is added below only when it is truly short.
    .filter((row) => !/cash below the regime floor|cash below.*floor/i.test(row.item))
    .map((row) => {
      const evidence = `${row.item} ${row.evidence}`;
      const sleeveDrift = /sleeve off target/i.test(row.item);
      const emergencyConcentration = /concentration/i.test(row.item) && /EMERGENCY/i.test(evidence);
      const navIntegrity = /NAV is computed with unpriced positions|unpriced positions/i.test(row.item);
      const genuineBlocking = emergencyConcentration || navIntegrity;
      if (sleeveDrift) {
        return {
          ...row,
          severity: "medium" as const,
          suggestedAction: `${row.suggestedAction} V36 treats sleeve drift as a regime-aware sizing/rebalance input, not a global veto on an unrelated qualified momentum entry.`,
        };
      }
      // Trend damage, beta concentration and exit-liquidity warnings still
      // matter, but they are portfolio-management evidence unless they map to
      // an explicit per-security hard block / emergency boundary.
      if (row.severity === "high" && !genuineBlocking) {
        return { ...row, severity: "medium" as const };
      }
      return row;
    });

  if (floorPct != null && currentPct != null && currentPct + 0.05 < floorPct) {
    riskRegister.unshift({
      raisedBy: "Daniel Cho",
      role: "Macro & Regime",
      severity: "high",
      item: "Authoritative Total Liquidity Buffer below Cash Floor",
      evidence: `Total Liquidity Buffer ${currentPct.toFixed(2)}% versus the authoritative ${floorPct.toFixed(2)}% Cash Floor. This read includes Broker USD cash, available dividend cash and approved reserve assets.`,
      suggestedAction: "Restore the authoritative Total Liquidity Buffer before opening new risk. Reserve-to-cash conversion alone does not increase the buffer.",
    });
  }

  if (String(input.regime?.regime ?? "").toUpperCase() === "CRISIS") {
    riskRegister.unshift({
      raisedBy: "Daniel Cho",
      role: "Macro & Regime",
      severity: "high",
      item: "Crisis regime blocks new risk",
      evidence: `Authoritative CIO Deployment Regime is Crisis at ${input.regime?.score ?? "—"}/100.`,
      suggestedAction: "Do not open new risk positions. Protect liquidity and reassess when the authoritative regime exits Crisis.",
    });
  }

  return {
    ...input,
    book: {
      ...input.book,
      sleeves,
      cashPct: currentPct,
      cashRequiredPct: floorPct,
      riskRegister,
    },
  };
}

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
  const normalized = normalizeInputV36(input);
  const meeting = runLegacyCommitteeMeeting(normalized);
  const governed = applyDecisionAuthorityV36(meeting, normalized);
  return exposePendingCashFloorRepair(governed, normalized);
}
