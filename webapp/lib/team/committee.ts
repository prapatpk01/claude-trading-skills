// Sentinel Investment V36 committee wrapper.
//
// The legacy committee remains the auditable motion/capital-plan engine. V36
// normalizes portfolio policy to the authoritative deployment regime before
// that engine runs, then applies the V36 ownership / momentum / risk authority
// layer. Human approval and the no-auto-execution rule remain unchanged.

export * from "./committeeLegacy";

import { runCommitteeMeeting as runLegacyCommitteeMeeting } from "./committeeLegacy";
import type { CommitteeInput, CommitteeMeeting, IdeaEvidence, Motion } from "./committeeLegacy";
import { applyDecisionAuthorityV36 } from "./authorityV36";
import { allocationFor, DRIFT_ALERT_PCT } from "./portfolio";
import { ROSTER } from "./roster";

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const REVIEW_WEIGHT_PCT = 15;
const MIN_PARTIAL_REINVESTMENT_USD = 25;

/**
 * New capital should not sit in TEMPORARY_PARKING simply because the new-name
 * scanner has no executable idea on this refresh. When the Cash Floor is met,
 * V36 gets one second job: rank existing positions for a measured ADD.
 */
function addDeployableExcessReinvestmentV36(input: CommitteeInput): CommitteeInput {
  if (input.deployableCash <= 0 || input.nav <= 0) return input;
  const regimeScore = input.regime?.score ?? 50;
  if (String(input.regime?.regime ?? "").toUpperCase() === "CRISIS" || regimeScore < 50) return input;
  const floorPct = input.targetCashPct ?? input.regime?.cashMinPct ?? null;
  if (floorPct != null && input.cashBufferPct != null && input.cashBufferPct + 0.05 < floorPct) return input;

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
 * The legacy allocator requires at least 50% of a proposed position before it
 * will partially fund it. That made sense for the old fixed-size portfolio,
 * but it created a broken V36 handoff: a qualified NEW BUY could pass all four
 * authority gates, show up as a BUY candidate, leave deployable excess parked,
 * and then disappear from Stage 06 because its outcome was still DEFERRED.
 *
 * V36.4 gives qualified risk purchases one final allocation pass before Human
 * Plan Approval. Deferred NEW BUYs and V36 deployable-excess ADDs may consume
 * actual TEMPORARY_PARKING dollars when every authority gate is already PASS.
 * The amount is capped by the original proposal and available excess, with a
 * $25 minimum. This changes sizing/funding only; it never overrides a gate and
 * never places a broker order.
 */
export function partiallyFundDeployableExcessAddsV36<T extends CommitteeMeeting>(meeting: T, input: CommitteeInput): T {
  const ideaByTicker = new Map(input.ideas.map((idea) => [idea.ticker.trim().toUpperCase(), idea]));
  const ladderTickers = new Set(
    input.ideas
      .filter((idea) => idea.source === "V36 Deployable Excess Reinvestment Ladder")
      .map((idea) => idea.ticker.trim().toUpperCase()),
  );

  let available = round2(Math.max(0, meeting.capitalPlan.temporaryParkingUsd));
  if (available < MIN_PARTIAL_REINVESTMENT_USD) return meeting;

  const eligible = meeting.motions
    .filter((motion) => {
      if (motion.outcome !== "DEFERRED") return false;
      const key = motion.ticker.trim().toUpperCase();
      const isQualifiedNewBuy = motion.kind === "NEW BUY" && ideaByTicker.has(key);
      const isLadderAdd = motion.kind === "ADD" && ladderTickers.has(key);
      if (!isQualifiedNewBuy && !isLadderAdd) return false;
      if (!motion.decisionGates.length || motion.decisionGates.some((gate) => gate.status !== "PASS")) return false;
      return /funding plan ran out of sources|not funded|funding/i.test(motion.outcomeReason);
    })
    .sort((left, right) => {
      const leftIdea: any = ideaByTicker.get(left.ticker.trim().toUpperCase()) ?? null;
      const rightIdea: any = ideaByTicker.get(right.ticker.trim().toUpperCase()) ?? null;
      const leftTech: any = leftIdea?.technical ?? null;
      const rightTech: any = rightIdea?.technical ?? null;
      const leftScore = Number(leftTech?.convictionScore ?? leftTech?.total ?? leftIdea?.conviction ?? 0);
      const rightScore = Number(rightTech?.convictionScore ?? rightTech?.total ?? rightIdea?.conviction ?? 0);
      if (rightScore !== leftScore) return rightScore - leftScore;
      const leftVote = left.tally.for - left.tally.against;
      const rightVote = right.tally.for - right.tally.against;
      if (rightVote !== leftVote) return rightVote - leftVote;
      return right.evidenceCoveragePct - left.evidenceCoveragePct;
    });

  const allocations: Array<{ motion: Motion; requested: number; granted: number; price: number | null }> = [];
  for (const motion of eligible) {
    if (available < MIN_PARTIAL_REINVESTMENT_USD) break;
    const key = motion.ticker.trim().toUpperCase();
    const idea = ideaByTicker.get(key) ?? null;
    const requested = round2(Math.max(0, motion.sizeUsd));
    const granted = round2(Math.min(requested, available));
    if (granted < MIN_PARTIAL_REINVESTMENT_USD) continue;
    const price = idea?.price && idea.price > 0
      ? idea.price
      : input.positions.find((row) => row.ticker.trim().toUpperCase() === key)?.price ?? null;

    motion.sizeUsd = granted;
    motion.approxShares = price && price > 0 ? round4(granted / price) : motion.approxShares;
    motion.outcome = "CARRIED";
    motion.veto = null;
    motion.outcomeReason = `All four authority gates passed. V36.4 funded ${motion.kind} ${motion.ticker} with $${granted.toFixed(2)} of deployable excess above the Cash Floor${granted < requested ? `, reduced from the $${requested.toFixed(2)} standard proposal` : ""}. Human Plan Approval is still required before any broker action.`;
    allocations.push({ motion, requested, granted, price });
    available = round2(available - granted);
  }

  if (!allocations.length) return meeting;
  const allocated = round2(allocations.reduce((sum, row) => sum + row.granted, 0));
  const plan = meeting.capitalPlan;
  plan.usesUsd = round2(plan.usesUsd + allocated);
  plan.useLines = [
    ...plan.useLines,
    ...allocations.map(({ motion, granted }) => ({ label: `${motion.kind} ${motion.ticker}`, amountUsd: granted })),
  ];
  plan.temporaryParkingUsd = available;
  plan.cutForFunding = plan.cutForFunding.map((row) => {
    const allocation = allocations.find((item) => item.motion.ticker === row.ticker);
    return allocation
      ? { ...row, reason: `V36.4 funding: ${allocation.motion.kind} ${allocation.motion.ticker} received $${allocation.granted.toFixed(2)} of the $${allocation.requested.toFixed(2)} requested from deployable excess before Human Plan Approval.` }
      : row;
  });

  const destinations = plan.destinationLines
    .map((line) => line.category === "TEMPORARY_PARKING" ? { ...line, amountUsd: available } : line)
    .filter((line) => line.category !== "TEMPORARY_PARKING" || line.amountUsd > 0.01);
  for (const { motion, granted } of allocations) {
    destinations.push({
      category: motion.kind === "NEW BUY" ? "NEW_INVESTMENT" : "ADD_HOLDING",
      label: `${motion.kind} ${motion.ticker} · V36.4 qualified deployable-excess allocation`,
      amountUsd: granted,
      owner: ROSTER.sofia.name,
      reviewBy: null,
    });
  }
  plan.destinationLines = destinations;
  plan.unallocatedUsd = round2(Math.max(0, plan.sourcesUsd - destinations.reduce((sum, line) => sum + line.amountUsd, 0)));
  plan.balanceUsd = plan.unallocatedUsd;
  plan.allocationComplete = plan.unallocatedUsd <= 0.01 && destinations.every((line) => Boolean(line.owner) && (line.category !== "TEMPORARY_PARKING" || Boolean(line.reviewBy)));
  plan.funded = plan.usesUsd <= plan.deployableSourcesUsd + 0.01 && plan.allocationComplete;
  plan.approvalReady = meeting.quorum.met && plan.allocationComplete;
  plan.allocationStatus = plan.allocationComplete ? "READY" : "INCOMPLETE";
  if (plan.cashAfterPct != null && input.nav > 0) plan.cashAfterPct = round2(Math.max(0, plan.cashAfterPct - (allocated / input.nav) * 100));
  if (available <= 0.01) plan.fallbackOptions = plan.fallbackOptions.filter((row) => row.ticker !== "CASH / SGOV");
  plan.note = `${allocated.toLocaleString("en-US", { style: "currency", currency: "USD" })} of deployable excess is assigned to ${allocations.map((row) => `${row.motion.kind} ${row.motion.ticker}`).join(", ")} after every authority gate passed. These funded lines now proceed to Stage 06 Human Plan Approval; Sentinel still does not execute broker orders.${available > 0.01 ? ` ${available.toLocaleString("en-US", { style: "currency", currency: "USD" })} remains in temporary parking for the next qualified allocation.` : " No deployable excess remains unassigned."}`;

  for (const { motion, granted, price } of allocations) {
    if (!meeting.blotter.some((line) => line.side === "BUY" && line.ticker === motion.ticker)) {
      meeting.blotter.push({
        side: "BUY",
        ticker: motion.ticker,
        approxShares: motion.approxShares,
        approxUsd: granted,
        referencePrice: price,
        reason: `${motion.kind} — ${motion.outcomeReason}`,
      });
    }
    const resolution = meeting.resolutions.find((row) => row.text.startsWith(`${motion.kind} ${motion.ticker} deferred.`));
    if (resolution) {
      resolution.status = "APPROVED";
      resolution.owner = ROSTER.ryan.name;
      resolution.text = `${motion.kind} ${motion.ticker} — $${granted.toFixed(2)}${motion.approxShares != null ? ` (~${motion.approxShares} shares)` : ""}. V36.4 funded the qualified line from deployable excess; record the transaction manually only after Human Plan Approval.`;
    }
    for (const vote of motion.votes.filter((vote) => vote.ballot === "AGAINST")) {
      if (!meeting.dissent.some((row) => row.ticker === motion.ticker && row.member === vote.member)) {
        meeting.dissent.push({ ticker: motion.ticker, member: vote.member, rationale: vote.rationale });
      }
    }
  }
  meeting.blotter.sort((a, b) => (a.side === b.side ? b.approxUsd - a.approxUsd : a.side === "SELL" ? -1 : 1));
  const capitalAgenda = meeting.agenda.find((row) => row.n === 6);
  if (capitalAgenda) capitalAgenda.summary = plan.note;
  const authorityAgenda = meeting.agenda.find((row) => row.n === 7);
  if (authorityAgenda) authorityAgenda.summary = `${meeting.motions.filter((m) => m.outcome === "CARRIED").length} carried and ${meeting.motions.filter((m) => m.outcome === "DEFERRED").length} deferred through Investment Head → Asset Management Head → CRO → CIO.`;
  const handoffAgenda = meeting.agenda.find((row) => row.n === 8);
  if (handoffAgenda) {
    handoffAgenda.covered = meeting.blotter.length > 0;
    handoffAgenda.summary = meeting.blotter.length ? `${meeting.blotter.length} line(s) handed to Portfolio Operations for manual entry. The committee approves; a person executes.` : handoffAgenda.summary;
  }
  meeting.minutes.push(`V36.4 Human Plan funding handoff: ${allocations.map((row) => `${row.motion.kind} ${row.motion.ticker} $${row.granted.toFixed(2)}${row.granted < row.requested ? ` (reduced from $${row.requested.toFixed(2)})` : ""}`).join("; ")}.`);
  return meeting;
}

/** One ticker must expose one authoritative motion/card per meeting. */
export function canonicalizeMotionsV36<T extends CommitteeMeeting>(meeting: T): T {
  const priority: Record<Motion["kind"], number> = {
    EXIT: 60,
    "RAISE CASH": 55,
    TRIM: 50,
    ADD: 40,
    "NEW BUY": 35,
    HOLD: 10,
  };
  const originalMotions = [...meeting.motions];
  const chosen = new Map<string, Motion>();
  for (const motion of originalMotions) {
    const key = motion.ticker.trim().toUpperCase();
    const current = chosen.get(key);
    if (!current) {
      chosen.set(key, motion);
      continue;
    }
    const motionPriority = priority[motion.kind] ?? 0;
    const currentPriority = priority[current.kind] ?? 0;
    if (motionPriority > currentPriority) chosen.set(key, motion);
    else if (motionPriority === currentPriority) {
      const outcomeRank = { CARRIED: 3, DEFERRED: 2, FAILED: 1 } as const;
      if (outcomeRank[motion.outcome] > outcomeRank[current.outcome]) chosen.set(key, motion);
    }
  }
  const keepIds = new Set(Array.from(chosen.values()).map((motion) => motion.id));
  meeting.motions = originalMotions.filter((motion) => keepIds.has(motion.id));
  // Legacy resolutions are positional: exactly one was created for each motion.
  // Remove the paired HOLD resolution when its duplicate HOLD motion is hidden.
  if (Array.isArray(meeting.resolutions) && meeting.resolutions.length === originalMotions.length) {
    meeting.resolutions = meeting.resolutions.filter((_, index) => keepIds.has(originalMotions[index].id));
  }
  return meeting;
}

/** Regime-aware portfolio-policy normalization. */
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
      if (row.severity === "high" && !genuineBlocking) return { ...row, severity: "medium" as const };
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

/** Expose pending Cash-Floor repairs without turning proposals into orders. */
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
  const legacyMeeting = runLegacyCommitteeMeeting(normalized);
  const partiallyFunded = partiallyFundDeployableExcessAddsV36(legacyMeeting, normalized);
  const meeting = canonicalizeMotionsV36(partiallyFunded);
  const governed = applyDecisionAuthorityV36(meeting, normalized);
  return exposePendingCashFloorRepair(governed, normalized);
}