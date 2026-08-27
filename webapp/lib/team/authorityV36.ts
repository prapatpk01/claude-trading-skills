import type { CommitteeInput, CommitteeMeeting, Motion } from "./committeeLegacy";

export type AuthorityV36Status = "PASS" | "CONDITIONAL" | "DEFER" | "VETO";
export type CIOV36Action = "BUY NOW" | "STARTER BUY" | "ADD NOW" | "WAIT FOR TRIGGER" | "TRIM / EXIT" | "HOLD" | "HOLD CASH/SGOV";

type AuthorityDecision = { status: AuthorityV36Status; finding: string };
type CIOAuthorityDecision = { status: AuthorityV36Status; action: CIOV36Action; finding: string; trigger: string | null };

type V36Technical = {
  total?: number;
  convictionScore?: number;
  momentumScore?: number;
  marketScore?: number;
  ownershipScore?: number;
  entryScore?: number;
  signal?: string;
  action?: string;
  momentumState?: string;
  rising?: boolean;
  hardBlocks?: string[];
  softBlocks?: string[];
  dataQualityPct?: number;
  sizingMultiplier?: number;
  note?: string;
};

export type AuthorityV36Row = {
  ticker: string;
  kind: Motion["kind"];
  sofia: AuthorityDecision;
  lena: AuthorityDecision;
  miriam: AuthorityDecision;
  james: CIOAuthorityDecision;
  score: {
    conviction: number | null;
    market: number | null;
    momentum: number | null;
    ownership: number | null;
    entry: number | null;
    momentumState: string | null;
    softBlocks: string[];
  };
};

export type AuthorityV36Summary = {
  version: "36.0";
  mandate: string;
  rows: AuthorityV36Row[];
  finalPlan: {
    buyNow: string[];
    starterBuy: string[];
    addNow: string[];
    waitForTrigger: string[];
    trimExit: string[];
    hold: string[];
    holdCashSgov: string[];
  };
};

const MIN_EVIDENCE = 80;
const MIN_OWNERSHIP = 55;
const MIN_CONVICTION_FOR_EXECUTION = 65;
const round2 = (value: number) => Math.round(value * 100) / 100;

const asTechnical = (motion: Motion, input: CommitteeInput): V36Technical | null => {
  const idea = input.ideas.find(row => row.ticker === motion.ticker);
  const position = input.positions.find(row => row.ticker === motion.ticker);
  return ((idea?.technical ?? position?.momentum ?? null) as unknown as V36Technical | null);
};

const ideaFor = (motion: Motion, input: CommitteeInput) => input.ideas.find(row => row.ticker === motion.ticker) ?? null;
const positionFor = (motion: Motion, input: CommitteeInput) => input.positions.find(row => row.ticker === motion.ticker) ?? null;
const gate = (motion: Motion, stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO") => motion.decisionGates.find(row => row.stage === stage) as any;

function scoreRow(technical: V36Technical | null) {
  return {
    conviction: technical?.convictionScore ?? technical?.total ?? null,
    market: technical?.marketScore ?? null,
    momentum: technical?.momentumScore ?? null,
    ownership: technical?.ownershipScore ?? null,
    entry: technical?.entryScore ?? null,
    momentumState: technical?.momentumState ?? null,
    softBlocks: technical?.softBlocks ?? [],
  };
}

function sofiaDecision(motion: Motion, input: CommitteeInput): AuthorityDecision {
  if (motion.kind === "RAISE CASH") return { status: "PASS", finding: "Liquidity repair is policy implementation, not security selection." };
  if (motion.kind === "HOLD" || motion.kind === "TRIM" || motion.kind === "EXIT") {
    const current = gate(motion, "INVESTMENT");
    return { status: current?.status === "VETO" ? "VETO" : "PASS", finding: current?.rationale ?? "Existing-position action retains its measured ownership record." };
  }

  const idea = ideaFor(motion, input);
  const technical = asTechnical(motion, input);
  const ownership = technical?.ownershipScore ?? idea?.conviction ?? 0;
  const evidence = motion.evidenceCoveragePct;
  if (evidence < MIN_EVIDENCE) return { status: "VETO", finding: `Evidence coverage ${evidence}% is below the ${MIN_EVIDENCE}% decision-quality floor.` };
  if (ownership < MIN_OWNERSHIP) return { status: "DEFER", finding: `Ownership score ${Math.round(ownership)}/100 is below ${MIN_OWNERSHIP}. Keep the name in research until business quality, valuation or catalyst evidence improves.` };
  return {
    status: "PASS",
    finding: `Ownership underwriting passes at ${Math.round(ownership)}/100 with ${evidence}% evidence coverage. Entry timing is evaluated separately by Sentinel Momentum V36.`,
  };
}

function lenaDecision(motion: Motion, input: CommitteeInput, sofia: AuthorityDecision): AuthorityDecision {
  const current = gate(motion, "ASSET_MANAGEMENT");
  if (current?.status === "VETO") return { status: "VETO", finding: current.rationale };
  if (motion.kind === "RAISE CASH" || motion.kind === "TRIM" || motion.kind === "EXIT" || motion.kind === "HOLD") {
    return { status: "PASS", finding: current?.rationale ?? "Portfolio impact is measured." };
  }

  const floorReady = input.targetCashPct == null || input.cashBufferPct == null || input.cashBufferPct + 0.05 >= input.targetCashPct;
  if (!floorReady) return { status: "VETO", finding: `Total Liquidity Buffer ${input.cashBufferPct?.toFixed(1) ?? "—"}% is below the authoritative ${input.targetCashPct?.toFixed(1) ?? "—"}% Cash Floor.` };
  if (input.deployableCash <= 0) return { status: "CONDITIONAL", finding: "The idea may qualify, but there is no deployable excess above the Cash Floor. Preserve it for the next dollar rather than breaking liquidity policy." };
  if (sofia.status !== "PASS") return { status: "DEFER", finding: "Asset Management does not size a new position before ownership underwriting passes." };

  const idea = ideaFor(motion, input);
  const sleeve = idea?.sleeve ? input.book?.sleeves.find(row => row.sleeve === idea.sleeve) : null;
  const driftNote = sleeve ? ` ${sleeve.sleeve} is ${sleeve.actualPct.toFixed(1)}% vs ${sleeve.targetPct.toFixed(1)}% regime target.` : "";
  return { status: "PASS", finding: `Deployable excess is ${Math.round(input.deployableCash).toLocaleString("en-US")} USD and the Cash Floor is intact.${driftNote} Sleeve drift may reduce size but does not veto a qualifying momentum entry.` };
}

function miriamDecision(motion: Motion, input: CommitteeInput): AuthorityDecision {
  const current = gate(motion, "RISK");
  const technical = asTechnical(motion, input);
  const position = positionFor(motion, input);
  const addsRisk = motion.kind === "NEW BUY" || motion.kind === "ADD";

  if (!addsRisk) return { status: current?.status === "VETO" ? "VETO" : "PASS", finding: current?.rationale ?? "Risk-reduction/hold action does not add new exposure." };
  if (position?.zone?.zone === "EMERGENCY") return { status: "VETO", finding: "Adding risk would violate the emergency concentration boundary." };
  if (!technical) return { status: "VETO", finding: "Sentinel V36 new-idea evidence is unavailable; no new risk can be authorized without a scored entry." };
  if ((technical.hardBlocks ?? []).length) return { status: "VETO", finding: `True hard block(s): ${(technical.hardBlocks ?? []).join("; ")}` };

  const conviction = technical.convictionScore ?? technical.total ?? 0;
  const action = String(technical.action ?? technical.signal ?? "");
  if (conviction >= MIN_CONVICTION_FOR_EXECUTION && (action === "BUY" || action === "STARTER BUY" || action === "ADD")) {
    return {
      status: "PASS",
      finding: `Sentinel Conviction ${Math.round(conviction)}/100 passes. Momentum ${technical.momentumScore ?? "—"}/100 is ${technical.momentumState ?? "—"}; entry ${technical.entryScore ?? "—"}/10. ${(technical.softBlocks ?? []).length ? `Soft timing notes remain (${(technical.softBlocks ?? []).length}) but none is a true veto.` : "No soft timing block remains."}`,
    };
  }
  if (conviction >= 55 || action.includes("WATCH")) {
    return { status: "CONDITIONAL", finding: `Sentinel reads ${action || "WATCH"} at ${Math.round(conviction)}/100. Keep the thesis live and re-run when momentum/entry acceleration clears the trigger.` };
  }
  return { status: "DEFER", finding: `Sentinel Conviction ${Math.round(conviction)}/100 is below the executable band.` };
}

function jamesDecision(
  motion: Motion,
  sofia: AuthorityDecision,
  lena: AuthorityDecision,
  miriam: AuthorityDecision,
  technical: V36Technical | null,
): CIOAuthorityDecision {
  const statuses: AuthorityV36Status[] = [sofia.status, lena.status, miriam.status];
  const hasVeto = statuses.includes("VETO");
  const hasConditional = statuses.includes("CONDITIONAL");
  const allPass = statuses.every(status => status === "PASS");

  if (motion.kind === "HOLD") return { status: hasVeto ? "DEFER" : "PASS", action: "HOLD", finding: "No executable change is superior to holding on the current evidence.", trigger: null };
  if (motion.kind === "TRIM" || motion.kind === "EXIT" || motion.kind === "RAISE CASH") return { status: hasVeto ? "DEFER" : "PASS", action: "TRIM / EXIT", finding: hasVeto ? "Resolve the named policy contradiction before execution." : "Risk-reduction action remains subject to human approval and reconciliation.", trigger: hasVeto ? "Resolve the blocking risk." : null };
  if (hasVeto) return { status: "DEFER", action: "WAIT FOR TRIGGER", finding: "The CIO does not override a true hard block.", trigger: "Clear the named hard block and rerun the meeting." };
  if (hasConditional) return { status: "CONDITIONAL", action: "WAIT FOR TRIGGER", finding: "The ownership case is live but a funding or momentum trigger is not ready.", trigger: "Re-run when the conditional gate clears." };
  if (allPass && motion.outcome === "CARRIED") {
    const action = String(technical?.action ?? technical?.signal ?? "");
    if (motion.kind === "ADD") return { status: "PASS", action: "ADD NOW", finding: "All V36 authorities pass and the funded ADD carried.", trigger: null };
    if (action === "STARTER BUY") return { status: "PASS", action: "STARTER BUY", finding: "Momentum is rising and the V36 starter band passed. Execute only the reduced starter size approved in the capital plan.", trigger: null };
    return { status: "PASS", action: "BUY NOW", finding: "Market, momentum, ownership, entry, portfolio and risk all pass on the same snapshot.", trigger: null };
  }
  return { status: "DEFER", action: "WAIT FOR TRIGGER", finding: "No veto remains, but the legacy funding package did not carry on this snapshot.", trigger: "Complete the remaining funding/evidence requirement and rerun." };
}

function reconcileAuthorityFundingV36(meeting: CommitteeMeeting, input: CommitteeInput) {
  const plan = meeting.capitalPlan;
  const rolledBack: Array<{ ticker: string; kind: Motion["kind"]; amountUsd: number }> = [];

  for (const motion of meeting.motions) {
    if ((motion.kind !== "NEW BUY" && motion.kind !== "ADD") || motion.outcome === "CARRIED") continue;
    const key = motion.ticker.trim().toUpperCase();
    const matched = plan.destinationLines.filter((line) => {
      const categoryMatches = motion.kind === "NEW BUY" ? line.category === "NEW_INVESTMENT" : line.category === "ADD_HOLDING";
      return categoryMatches && /V36\.4 qualified deployable-excess allocation/i.test(line.label) && line.label.toUpperCase().includes(key);
    });
    const amountUsd = round2(matched.reduce((sum, line) => sum + line.amountUsd, 0));
    if (amountUsd <= 0) continue;

    plan.destinationLines = plan.destinationLines.filter((line) => !matched.includes(line));
    plan.usesUsd = round2(Math.max(0, plan.usesUsd - amountUsd));

    let removeAmount = amountUsd;
    plan.useLines = plan.useLines.filter((line) => {
      if (removeAmount <= 0.01) return true;
      const labelMatches = line.label.trim().toUpperCase() === `${motion.kind} ${key}`;
      if (!labelMatches) return true;
      if (Math.abs(line.amountUsd - removeAmount) <= 0.02) {
        removeAmount = 0;
        return false;
      }
      return true;
    });

    plan.temporaryParkingUsd = round2(plan.temporaryParkingUsd + amountUsd);
    const parking = plan.destinationLines.find((line) => line.category === "TEMPORARY_PARKING");
    if (parking) {
      parking.amountUsd = round2(parking.amountUsd + amountUsd);
    } else {
      plan.destinationLines.push({
        category: "TEMPORARY_PARKING",
        label: "Temporary reserve pending next qualified allocation",
        amountUsd,
        owner: plan.reviewOwner,
        reviewBy: plan.reviewBy,
      });
    }

    if (plan.cashAfterPct != null && input.nav > 0) plan.cashAfterPct = round2(Math.min(100, plan.cashAfterPct + (amountUsd / input.nav) * 100));
    meeting.blotter = meeting.blotter.filter((line) => !(line.side === "BUY" && line.ticker.trim().toUpperCase() === key && Math.abs(line.approxUsd - amountUsd) <= 0.02));

    const resolution = meeting.resolutions.find((row) => row.text.startsWith(`${motion.kind} ${motion.ticker} —`) || row.text.startsWith(`${motion.kind} ${motion.ticker} deferred.`));
    if (resolution) {
      resolution.status = "DEFERRED";
      resolution.text = `${motion.kind} ${motion.ticker} deferred. ${motion.outcomeReason}`;
    }
    const cut = plan.cutForFunding.find((row) => row.ticker.trim().toUpperCase() === key);
    if (cut) cut.reason = `V36.5 authority reconciliation: reserved funding was returned to Temporary Parking because the final ${motion.kind} decision is ${motion.outcome}. ${motion.outcomeReason}`;
    rolledBack.push({ ticker: motion.ticker, kind: motion.kind, amountUsd });
  }

  if (!rolledBack.length) return;

  const destinationTotal = round2(plan.destinationLines.reduce((sum, line) => sum + line.amountUsd, 0));
  plan.unallocatedUsd = round2(Math.max(0, plan.sourcesUsd - destinationTotal));
  plan.balanceUsd = plan.unallocatedUsd;
  plan.allocationComplete = plan.unallocatedUsd <= 0.01 && plan.destinationLines.every((line) => Boolean(line.owner) && (line.category !== "TEMPORARY_PARKING" || Boolean(line.reviewBy)));
  plan.funded = plan.usesUsd <= plan.deployableSourcesUsd + 0.01 && plan.allocationComplete;
  plan.approvalReady = meeting.quorum.met && plan.allocationComplete;
  plan.allocationStatus = plan.allocationComplete ? "READY" : "INCOMPLETE";
  if (!plan.fallbackOptions.some((row) => row.ticker === "CASH / SGOV")) {
    plan.fallbackOptions.push({
      ticker: "CASH / SGOV",
      action: "KEEP RESERVE",
      maxUsd: plan.temporaryParkingUsd,
      rationale: "Temporary parking remains available while the next qualified momentum trigger develops.",
    });
  }
  meeting.minutes.push(`V36.5 authority reconciliation returned ${rolledBack.map((row) => `$${row.amountUsd.toFixed(2)} from ${row.kind} ${row.ticker}`).join("; ")} to Temporary Parking because the final authority gate did not authorize execution.`);
}

export function applyDecisionAuthorityV36(meeting: CommitteeMeeting, input: CommitteeInput): CommitteeMeeting & { authorityV36: AuthorityV36Summary } {
  const rows: AuthorityV36Row[] = [];
  for (const motion of meeting.motions) {
    const technical = asTechnical(motion, input);
    const sofia = sofiaDecision(motion, input);
    const lena = lenaDecision(motion, input, sofia);
    const miriam = miriamDecision(motion, input);
    const james = jamesDecision(motion, sofia, lena, miriam, technical);

    const investmentGate = gate(motion, "INVESTMENT");
    const assetGate = gate(motion, "ASSET_MANAGEMENT");
    const riskGate = gate(motion, "RISK");
    const cioGate = gate(motion, "CIO");
    if (investmentGate) { investmentGate.status = sofia.status === "CONDITIONAL" ? "DEFER" : sofia.status; investmentGate.rationale = sofia.finding; investmentGate.title = "Sentinel Ownership Underwriter"; }
    if (assetGate) { assetGate.status = lena.status === "CONDITIONAL" ? "DEFER" : lena.status; assetGate.rationale = lena.finding; assetGate.title = "Regime-Aware Capital Allocator"; }
    if (riskGate) { riskGate.status = miriam.status === "CONDITIONAL" ? "DEFER" : miriam.status; riskGate.rationale = miriam.finding; riskGate.title = "True-Risk / Entry Gate"; }
    if (cioGate) { cioGate.status = james.status === "CONDITIONAL" ? "DEFER" : james.status; cioGate.rationale = james.finding; cioGate.title = "Sentinel CIO"; }

    if (james.status !== "PASS" && motion.outcome === "CARRIED" && (motion.kind === "NEW BUY" || motion.kind === "ADD")) {
      motion.outcome = "DEFERRED";
      const hardRisk = miriam.status === "VETO" ? miriam : lena.status === "VETO" ? lena : sofia.status === "VETO" ? sofia : null;
      motion.veto = hardRisk ? { member: hardRisk === miriam ? "Miriam Osei" : hardRisk === lena ? "Lena Müller" : "Sofia Reyes", reason: hardRisk.finding } : null;
      motion.outcomeReason = `WAIT FOR TRIGGER · ${james.trigger ?? james.finding}`;
    }

    rows.push({ ticker: motion.ticker, kind: motion.kind, sofia, lena, miriam, james, score: scoreRow(technical) });
  }

  reconcileAuthorityFundingV36(meeting, input);

  const finalPlan = {
    buyNow: rows.filter(row => row.james.action === "BUY NOW").map(row => row.ticker),
    starterBuy: rows.filter(row => row.james.action === "STARTER BUY").map(row => row.ticker),
    addNow: rows.filter(row => row.james.action === "ADD NOW").map(row => row.ticker),
    waitForTrigger: rows.filter(row => row.james.action === "WAIT FOR TRIGGER").map(row => row.ticker),
    trimExit: rows.filter(row => row.james.action === "TRIM / EXIT").map(row => `${row.kind} ${row.ticker}`),
    hold: rows.filter(row => row.james.action === "HOLD").map(row => row.ticker),
    holdCashSgov: [] as string[],
  };
  if (!finalPlan.buyNow.length && !finalPlan.starterBuy.length && !finalPlan.addNow.length) finalPlan.holdCashSgov.push(`HOLD CASH/SGOV · no V36 risk purchase is executable on meeting ${meeting.meetingId}.`);

  return Object.assign(meeting, {
    authorityV36: {
      version: "36.0" as const,
      mandate: "Market sentiment/regime sets permission, momentum acceleration sets timing, ownership establishes what is worth owning, entry quality controls price, and only true hard risks veto. Sleeve drift changes size; it does not globally block a qualified momentum entry.",
      rows,
      finalPlan,
    },
  });
}