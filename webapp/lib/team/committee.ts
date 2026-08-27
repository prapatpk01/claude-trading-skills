// Sentinel Investment V36 committee wrapper.
//
// The legacy committee remains the auditable motion/capital-plan engine. V36
// normalizes portfolio policy to the authoritative deployment regime before
// that engine runs, then applies the V36 ownership / momentum / risk authority
// layer. Human approval and the no-auto-execution rule remain unchanged.

export * from "./committeeLegacy";

import { runCommitteeMeeting as runLegacyCommitteeMeeting } from "./committeeLegacy";
import type { CommitteeInput, CommitteeMeeting, IdeaEvidence, Motion, PositionEvidence } from "./committeeLegacy";
import { applyDecisionAuthorityV36 } from "./authorityV36";
import { allocationFor, DRIFT_ALERT_PCT } from "./portfolio";

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const REVIEW_WEIGHT_PCT = 15;

/**
 * New capital should not sit in TEMPORARY_PARKING simply because the new-name
 * scanner has no executable idea on this refresh. When the Cash Floor is met,
 * V36 gets one second job: rank existing positions for a measured ADD.
 *
 * This is deliberately stricter than an ordinary HOLD. We require positive
 * trend acceleration, valuation room, good data quality, no genuine hard risk,
 * room below the review weight and no very recent buy. Legacy ADX/RSI timing
 * blocks are treated as soft only when price momentum is demonstrably rising.
 */
function addDeployableExcessReinvestmentV36(input: CommitteeInput): CommitteeInput {
  if (input.deployableCash <= 0 || input.nav <= 0) return input;
  const regimeScore = input.regime?.score ?? 50;
  if (String(input.regime?.regime ?? "").toUpperCase() === "CRISIS" || regimeScore < 50) return input;
  const floorPct = input.targetCashPct ?? input.regime?.cashMinPct ?? null;
  if (floorPct != null && input.cashBufferPct != null && input.cashBufferPct + 0.05 < floorPct) return input;

  // A qualified external research idea keeps first claim on new capital. The
  // reinvestment ladder exists to prevent idle excess when NEW BUY has no live
  // executable trigger; it does not crowd out the Investment Team's best idea.
  const externalExecutable = input.ideas.some((idea) => {
    const technical: any = idea.technical ?? null;
    const action = String(technical?.action ?? technical?.signal ?? "").toUpperCase();
    return (action === "BUY" || action === "STARTER BUY") && (technical?.hardBlocks?.length ?? 0) === 0;
  });
  if (externalExecutable) return input;

  const existingIdeaTickers = new Set(input.ideas.map((idea) => idea.ticker));
  const candidates: Array<{ idea: IdeaEvidence; conviction: number }> = [];

  for (const position of input.positions) {
    if (position.isReserve || existingIdeaTickers.has(position.ticker)) continue;
    if (!position.price || position.price <= 0 || !position.momentum || !position.trend) continue;
    if ((position.weightPct ?? REVIEW_WEIGHT_PCT) >= REVIEW_WEIGHT_PCT) continue;
    if (position.momentum.dataQualityPct < 75 || position.momentum.total < 55) continue;
    if (position.recentTrade?.daysSinceBuy != null && position.recentTrade.daysSinceBuy < 7) continue;
    if (position.recentTrade?.daysSinceSell != null && position.recentTrade.daysSinceSell < 30) continue;
    if (position.trend.aboveSma50 === false || position.trend.aboveSma200 === false) continue;

    const return1m = position.trend.return1m ?? 0;
    const return3m = position.trend.return3m ?? 0;
    const rising = return1m > 0 && return3m > 0 && return1m > return3m / 3;
    if (!rising) continue;

    const valuation = position.valuation;
    if (!valuation || /PREMIUM|EXPENSIVE|OVERVALUED/i.test(valuation.verdict)) continue;
    const denominator = valuation.deviationPct == null ? null : 1 + valuation.deviationPct / 100;
    const fairValue = valuation.fairValue ?? (denominator != null && denominator > 0 ? position.price / denominator : null);
    if (fairValue == null || fairValue <= position.price) continue;
    const upsidePct = (fairValue / position.price - 1) * 100;
    if (upsidePct < 5) continue;

    const legacyBlocks = position.momentum.hardBlocks ?? [];
    const softTiming = legacyBlocks.filter((block) => /ADX|RSI/i.test(block));
    const trueHardBlocks = legacyBlocks.filter((block) => !/ADX|RSI/i.test(block));
    if (trueHardBlocks.length) continue;

    let ownershipScore = 55 + Math.min(30, upsidePct * 1.8);
    if (/DISCOUNT|CHEAP|UNDERVALUED/i.test(valuation.verdict)) ownershipScore += 5;
    if (/high/i.test(valuation.confidence)) ownershipScore += 5;
    ownershipScore = Math.round(clamp(ownershipScore));

    let entryScore = 0;
    if (position.trend.aboveSma50 === true) entryScore += 4;
    if (position.trend.aboveSma200 === true) entryScore += 3;
    if (return1m > 0) entryScore += 2;
    if (return1m > return3m / 3) entryScore += 1;
    entryScore = Math.min(10, entryScore);

    // Entry is a 0-10 pillar, so its 10% contribution is entryScore itself.
    const conviction = Math.round(clamp(
      regimeScore * 0.25 +
      position.momentum.total * 0.45 +
      ownershipScore * 0.20 +
      entryScore,
    ));
    if (conviction < 65) continue;

    const action = conviction >= 75 && position.momentum.total >= 65 ? "BUY" : "STARTER BUY";
    const technical: any = {
      total: conviction,
      convictionScore: conviction,
      marketScore: Math.round(regimeScore),
      momentumScore: position.momentum.total,
      ownershipScore,
      entryScore,
      signal: action,
      action,
      momentumState: "RISING",
      rising: true,
      hardBlocks: [],
      softBlocks: softTiming,
      dataQualityPct: position.momentum.dataQualityPct,
      sizingMultiplier: action === "BUY" ? 1 : 0.5,
      note: `Deployable-excess reinvestment: Market ${Math.round(regimeScore)} + Momentum ${position.momentum.total} + Ownership ${ownershipScore} + Entry ${entryScore}/10 = Conviction ${conviction}/100. Existing holding remains below the ${REVIEW_WEIGHT_PCT}% review weight and fair-value room is ${upsidePct.toFixed(1)}%.`,
    };

    const idea: IdeaEvidence = {
      ticker: position.ticker,
      rating: action === "BUY" ? "ADD" : "STARTER ADD",
      // Legacy sizing bands are intentionally conservative for this fallback:
      // a full ADD uses the 6% band; a starter uses the 4% band. The capital
      // plan can still reduce either to the actual deployable excess.
      conviction: action === "BUY" ? Math.max(65, conviction) : 50,
      source: "V36 Deployable Excess Reinvestment Ladder",
      price: position.price,
      target: fairValue,
      upsidePct: round2(upsidePct),
      submittedAt: input.asOf.slice(0, 10),
      note: technical.note,
      alreadyHeld: true,
      sleeve: position.sleeve,
      ageDays: 0,
      referencePrice: position.price,
      priceDriftPct: 0,
      dataQuality: `${position.momentum.dataQualityPct}% Holdings evidence · V36 reinvestment overlay`,
      technical,
      recentTrade: position.recentTrade ?? null,
    };
    candidates.push({ idea, conviction });
  }

  if (!candidates.length) return input;
  candidates.sort((left, right) => right.conviction - left.conviction || (right.idea.upsidePct ?? 0) - (left.idea.upsidePct ?? 0));
  const reinvestmentIdeas = candidates.slice(0, 2).map((row) => row.idea);
  return { ...input, ideas: [...input.ideas, ...reinvestmentIdeas] };
}

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
  const normalized = addDeployableExcessReinvestmentV36(normalizeInputV36(input));
  const meeting = runLegacyCommitteeMeeting(normalized);
  const governed = applyDecisionAuthorityV36(meeting, normalized);
  return exposePendingCashFloorRepair(governed, normalized);
}
