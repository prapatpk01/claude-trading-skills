import type { CommitteeInput, CommitteeMeeting, Motion } from "./committeeLegacy";

export type AuthorityV22Status = "PASS" | "CONDITIONAL" | "DEFER" | "VETO";
export type CIOV22Action = "BUY NOW" | "ADD NOW" | "WAIT FOR TRIGGER" | "ROTATE / REPLACE" | "TRIM / EXIT" | "HOLD" | "HOLD CASH/SGOV";

export type AuthorityV22Row = {
  ticker: string;
  kind: Motion["kind"];
  sofia: { status: AuthorityV22Status; finding: string };
  lena: { status: AuthorityV22Status; finding: string };
  miriam: { status: AuthorityV22Status; finding: string };
  james: { status: AuthorityV22Status; action: CIOV22Action; finding: string; trigger: string | null };
};

export type AuthorityV22Summary = {
  version: "22.0";
  mandate: string;
  authorities: {
    owner: string;
    role: string;
    question: string;
    upgradedCapabilities: string[];
  }[];
  rows: AuthorityV22Row[];
  finalPlan: {
    buyAddNow: string[];
    waitForTrigger: string[];
    rotateReplace: string[];
    trimExit: string[];
    hold: string[];
    holdCashSgov: string[];
  };
};

const MIN_TECHNICAL_BUY = 65;
const CONDITIONAL_TECHNICAL_MIN = 62;
const MIN_UPSIDE_FOR_INVESTMENT = 8;
const MIN_CONVICTION = 65;
const MIN_EVIDENCE = 80;

function gate(motion: Motion, stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO") {
  return motion.decisionGates.find((row) => row.stage === stage) as any;
}

function technicalFor(motion: Motion, input: CommitteeInput) {
  const idea = input.ideas.find((row) => row.ticker === motion.ticker);
  const position = input.positions.find((row) => row.ticker === motion.ticker);
  return idea?.technical ?? position?.momentum ?? null;
}

function ideaFor(motion: Motion, input: CommitteeInput) {
  return input.ideas.find((row) => row.ticker === motion.ticker) ?? null;
}

function positionFor(motion: Motion, input: CommitteeInput) {
  return input.positions.find((row) => row.ticker === motion.ticker) ?? null;
}

function normalizeNewIdeaLanguage(text: string, motion: Motion) {
  if (motion.kind !== "NEW BUY") return text;
  return text
    .replace(/HOLDINGS GATE UNAVAILABLE/gi, "NEW IDEA TECHNICAL GATE UNAVAILABLE")
    .replace(/HOLDINGS ([A-Z ]+)/gi, "NEW IDEA TECHNICAL $1")
    .replace(/shared Holdings technical gate/gi, "new-idea technical gate")
    .replace(/shared technical gate/gi, "new-idea technical gate");
}

function hasHardRisk(motion: Motion, input: CommitteeInput) {
  const technical = technicalFor(motion, input);
  const position = positionFor(motion, input);
  const concentrationBreach = position?.zone?.zone === "EMERGENCY";
  const lowCoverage = motion.evidenceCoveragePct < MIN_EVIDENCE;
  return {
    technical,
    hardBlock: Boolean(technical?.hardBlocks?.length),
    concentrationBreach,
    lowCoverage,
  };
}

function sofiaDecision(motion: Motion, input: CommitteeInput): AuthorityV22Row["sofia"] {
  const idea = ideaFor(motion, input);
  const current = gate(motion, "INVESTMENT");
  if (motion.kind === "RAISE CASH") return { status: "PASS", finding: "Liquidity restoration is policy implementation, not security selection." };
  if (current?.status === "VETO") return { status: "VETO", finding: current.rationale };

  if (idea && (motion.kind === "NEW BUY" || motion.kind === "ADD")) {
    const conviction = idea.conviction ?? 0;
    const upside = idea.upsidePct ?? null;
    const coverage = motion.evidenceCoveragePct;
    const qualityPass = conviction >= MIN_CONVICTION && coverage >= MIN_EVIDENCE && (upside == null || upside >= MIN_UPSIDE_FOR_INVESTMENT);
    if (qualityPass) {
      return {
        status: "PASS",
        finding: `Investment underwriting passes: conviction ${conviction}/100, evidence ${coverage}%${upside == null ? "" : `, expected upside ${upside.toFixed(1)}%`}. Technical timing is owned by the risk/execution gates rather than being mistaken for business quality.`,
      };
    }
    return {
      status: "DEFER",
      finding: `Investment underwriting is incomplete: conviction ${conviction}/100, evidence ${coverage}%${upside == null ? ", target upside unavailable" : `, upside ${upside.toFixed(1)}%`}. Re-underwrite fundamentals, valuation and catalysts before ownership approval.`,
    };
  }

  return {
    status: current?.status === "PASS" ? "PASS" : "DEFER",
    finding: current?.rationale ?? "Sofia could not establish a complete ownership case from the evidence tabled.",
  };
}

function lenaDecision(motion: Motion, input: CommitteeInput, sofia: AuthorityV22Row["sofia"]): AuthorityV22Row["lena"] {
  const current = gate(motion, "ASSET_MANAGEMENT");
  if (current?.status === "VETO") return { status: "VETO", finding: current.rationale };
  if (motion.kind === "RAISE CASH" || motion.kind === "TRIM" || motion.kind === "EXIT" || motion.kind === "HOLD") {
    return { status: current?.status === "PASS" ? "PASS" : "DEFER", finding: current?.rationale ?? "Portfolio impact could not be completed." };
  }

  const floorReady = input.targetCashPct == null || input.cashBufferPct == null || input.cashBufferPct >= input.targetCashPct;
  const fundingReady = input.deployableCash > 0 && floorReady;
  if (sofia.status === "PASS" && fundingReady) {
    return {
      status: "PASS",
      finding: `Portfolio allocation is fundable: deployable capital ${Math.round(input.deployableCash).toLocaleString("en-US")} USD and the Cash Buffer is not below its policy floor. Lena may size the idea, but only after technical/risk timing clears.`,
    };
  }
  if (sofia.status === "PASS" && !fundingReady) {
    return {
      status: "CONDITIONAL",
      finding: "The security may be worth owning, but deployable capital is not yet available above the Cash Floor. Keep it ranked for the next dollar rather than funding it by breaking policy.",
    };
  }
  return { status: "DEFER", finding: "Asset Management will not size or fund a security before Investment underwriting passes." };
}

function miriamDecision(motion: Motion, input: CommitteeInput): AuthorityV22Row["miriam"] {
  const current = gate(motion, "RISK");
  const risk = hasHardRisk(motion, input);
  const addsRisk = motion.kind === "NEW BUY" || motion.kind === "ADD";

  if (risk.lowCoverage) {
    return { status: "VETO", finding: `Evidence coverage ${motion.evidenceCoveragePct}% is below the ${MIN_EVIDENCE}% decision-quality floor.` };
  }
  if (risk.concentrationBreach && addsRisk) {
    return { status: "VETO", finding: "Adding risk would violate the emergency concentration boundary." };
  }
  if (risk.hardBlock && addsRisk) {
    return { status: "VETO", finding: `Technical risk has ${risk.technical?.hardBlocks.length ?? 0} hard block(s): ${(risk.technical?.hardBlocks ?? []).join("; ")}. This is a true veto, not a near-miss.` };
  }
  if (addsRisk && risk.technical) {
    const score = risk.technical.total;
    if (score >= MIN_TECHNICAL_BUY && risk.technical.hardBlocks.length === 0) {
      return { status: "PASS", finding: `Technical risk gate passes at ${score}/100 with no hard block. Downside control remains governed by sizing, concentration and event risk.` };
    }
    if (score >= CONDITIONAL_TECHNICAL_MIN && score < MIN_TECHNICAL_BUY && risk.technical.hardBlocks.length === 0) {
      return {
        status: "CONDITIONAL",
        finding: `Technical score ${score}/100 is within ${MIN_TECHNICAL_BUY - score} point(s) of the ${MIN_TECHNICAL_BUY} entry bar with no hard block. Do not execute yet; automatically reconsider when the entry gate reaches ${MIN_TECHNICAL_BUY}.`,
      };
    }
    return { status: "DEFER", finding: `Technical score ${score}/100 is below the conditional band. Keep the name under research, but it is not close enough to execution readiness.` };
  }

  if (current?.status === "VETO") return { status: "VETO", finding: current.rationale };
  return { status: current?.status === "PASS" ? "PASS" : "DEFER", finding: current?.rationale ?? "Risk evidence is incomplete." };
}

function jamesDecision(
  motion: Motion,
  sofia: AuthorityV22Row["sofia"],
  lena: AuthorityV22Row["lena"],
  miriam: AuthorityV22Row["miriam"],
): AuthorityV22Row["james"] {
  const statuses = [sofia.status, lena.status, miriam.status];
  const hasVeto = statuses.includes("VETO");
  const hasConditional = statuses.includes("CONDITIONAL");
  const allPass = statuses.every((status) => status === "PASS");

  if (motion.kind === "HOLD") {
    return { status: hasVeto ? "DEFER" : "PASS", action: "HOLD", finding: "No executable change is superior to holding on the current evidence.", trigger: null };
  }
  if (motion.kind === "TRIM" || motion.kind === "EXIT" || motion.kind === "RAISE CASH") {
    return {
      status: hasVeto ? "DEFER" : allPass ? "PASS" : "DEFER",
      action: "TRIM / EXIT",
      finding: hasVeto ? "Risk or upstream authority blocks the reduction package until the contradiction is resolved." : "Risk-reduction action remains subject to the same funding, replacement and human-approval controls as the legacy committee.",
      trigger: hasVeto ? "Resolve the blocking authority evidence." : null,
    };
  }
  if (hasVeto) {
    return { status: "DEFER", action: "WAIT FOR TRIGGER", finding: "The CIO does not overrule a true upstream veto. The idea stays in research until the veto condition is cleared.", trigger: "Clear the named veto and rerun the same-snapshot authority gates." };
  }
  if (hasConditional) {
    return { status: "CONDITIONAL", action: "WAIT FOR TRIGGER", finding: "The ownership case is constructive, but one or more execution conditions are not ready. Preserve the candidate rather than rejecting the thesis.", trigger: "Re-run automatically when the conditional technical/funding gate clears." };
  }
  if (allPass && motion.outcome === "CARRIED") {
    return { status: "PASS", action: motion.kind === "ADD" ? "ADD NOW" : "BUY NOW", finding: "Investment, portfolio and risk authority all pass on the same snapshot and the legacy committee carried the funded motion.", trigger: null };
  }
  return { status: "DEFER", action: "WAIT FOR TRIGGER", finding: "The CIO sees no veto, but the full executable package is not yet complete on this snapshot.", trigger: "Complete the remaining upstream evidence/funding gate and rerun the meeting." };
}

function rewriteMotionLanguage(motion: Motion) {
  motion.reasons = motion.reasons.map((reason) => ({ ...reason, finding: normalizeNewIdeaLanguage(reason.finding, motion) }));
  motion.votes = motion.votes.map((vote) => ({ ...vote, rationale: normalizeNewIdeaLanguage(vote.rationale, motion) }));
  motion.outcomeReason = normalizeNewIdeaLanguage(motion.outcomeReason, motion);
  if (motion.veto) motion.veto = { ...motion.veto, reason: normalizeNewIdeaLanguage(motion.veto.reason, motion) };
  motion.decisionGates = motion.decisionGates.map((row) => ({ ...row, rationale: normalizeNewIdeaLanguage(row.rationale, motion) }));
}

export function applyDecisionAuthorityV22(meeting: CommitteeMeeting, input: CommitteeInput): CommitteeMeeting & { authorityV22: AuthorityV22Summary } {
  const rows: AuthorityV22Row[] = [];

  for (const motion of meeting.motions) {
    rewriteMotionLanguage(motion);
    const sofia = sofiaDecision(motion, input);
    const lena = lenaDecision(motion, input, sofia);
    const miriam = miriamDecision(motion, input);
    const james = jamesDecision(motion, sofia, lena, miriam);

    const investmentGate = gate(motion, "INVESTMENT");
    const assetGate = gate(motion, "ASSET_MANAGEMENT");
    const riskGate = gate(motion, "RISK");
    const cioGate = gate(motion, "CIO");
    if (investmentGate) { investmentGate.status = sofia.status; investmentGate.rationale = sofia.finding; investmentGate.title = "Chief Investment Underwriter"; }
    if (assetGate) { assetGate.status = lena.status; assetGate.rationale = lena.finding; assetGate.title = "Portfolio Capital Allocator"; }
    if (riskGate) { riskGate.status = miriam.status; riskGate.rationale = miriam.finding; riskGate.title = "Forward Risk Officer"; }
    if (cioGate) { cioGate.status = james.status; cioGate.rationale = james.finding; cioGate.title = "Chief Portfolio Decision Maker"; }

    if (james.status === "CONDITIONAL") {
      motion.outcome = "DEFERRED";
      motion.veto = null;
      motion.outcomeReason = `WAIT FOR TRIGGER · ${james.trigger ?? james.finding}`;
    }
    rows.push({ ticker: motion.ticker, kind: motion.kind, sofia, lena, miriam, james });
  }

  const finalPlan = {
    buyAddNow: rows.filter((row) => row.james.action === "BUY NOW" || row.james.action === "ADD NOW").map((row) => `${row.james.action} ${row.ticker}`),
    waitForTrigger: rows.filter((row) => row.james.action === "WAIT FOR TRIGGER").map((row) => `${row.ticker}: ${row.james.trigger ?? row.james.finding}`),
    rotateReplace: [] as string[],
    trimExit: rows.filter((row) => row.james.action === "TRIM / EXIT").map((row) => `${row.kind} ${row.ticker}`),
    hold: rows.filter((row) => row.james.action === "HOLD").map((row) => `HOLD ${row.ticker}`),
    holdCashSgov: [] as string[],
  };

  if (!finalPlan.buyAddNow.length) {
    finalPlan.holdCashSgov.push(`HOLD CASH/SGOV · no risk purchase is executable on meeting ${meeting.meetingId}.`);
  }

  const authorityV22: AuthorityV22Summary = {
    version: "22.0",
    mandate: "Separate ownership quality, capital allocation, downside risk and final portfolio action. A near-miss becomes a trigger, not a false rejection; a true hard block remains a veto.",
    authorities: [
      {
        owner: "Sofia Reyes",
        role: "Chief Investment Underwriter",
        question: "Is this company worth owning?",
        upgradedCapabilities: ["Business quality and moat", "Earnings revisions", "Industry/TAM", "Fair value and 12M expected return", "Catalyst probability", "Separates ownership quality from entry timing"],
      },
      {
        owner: "Lena Müller",
        role: "Portfolio Capital Allocator",
        question: "Is this the best use of the next dollar?",
        upgradedCapabilities: ["Sizing", "Cash-Floor-aware funding", "Sleeve drift", "Replacement sequencing", "Current holding vs candidate opportunity cost", "No forced funding below policy"],
      },
      {
        owner: "Miriam Osei",
        role: "Forward Risk Officer",
        question: "Is the downside acceptable now?",
        upgradedCapabilities: ["PASS / CONDITIONAL / VETO", "Hard-block discrimination", "Near-miss technical trigger", "Concentration and evidence quality", "Event/downside asymmetry", "Does not treat 64 vs 65 as the same as a hard veto"],
      },
      {
        owner: "James Hartwell",
        role: "Chief Portfolio Decision Maker",
        question: "What should the fund actually do now?",
        upgradedCapabilities: ["BUY/ADD NOW", "WAIT FOR TRIGGER", "ROTATE/REPLACE", "TRIM/EXIT", "HOLD CASH/SGOV", "Preserves upstream veto independence"],
      },
    ],
    rows,
    finalPlan,
  };

  meeting.minutes = [
    `Decision Authority V22: ${authorityV22.mandate}`,
    ...authorityV22.finalPlan.buyAddNow,
    ...authorityV22.finalPlan.waitForTrigger.slice(0, 5).map((row) => `WAIT FOR TRIGGER · ${row}`),
    ...authorityV22.finalPlan.trimExit,
    ...authorityV22.finalPlan.holdCashSgov,
    ...meeting.minutes,
  ];
  meeting.disclosures = [
    "Authority V22 does not create broker execution. CONDITIONAL always remains non-executable until the trigger clears and the meeting is rerun.",
    ...meeting.disclosures,
  ];

  return Object.assign(meeting, { authorityV22 });
}
