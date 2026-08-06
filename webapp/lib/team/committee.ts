// Sentinel Global Fund — the investment committee meeting itself.
//
// This module turns measured evidence into the artefacts a real fund meeting
// produces: an agenda, an attendance record with a quorum test, one motion per
// position and per new idea, recorded advisory evidence, four authority gates, a capital
// plan whose sources must actually fund its uses, resolutions with an owner and
// a review date, and a trade blotter a human types into the ledger.
//
// Three rules shape everything here.
//
//   1. A specialist that cannot measure its own input ABSTAINS and says why.
//      Specialist ballots are an auditable evidence register, not decision
//      authority. Only Sofia, Lena, Miriam and James sign sequential gates.
//   2. Uses may not exceed sources. A meeting that approves more buying than it
//      has funded has not made a decision, it has made a wish. When the plan
//      does not balance the engine cuts the lowest-conviction uses and names
//      every one it cut.
//   3. Nothing executes. Every carried motion becomes a proposal line for a
//      human to enter. The engine has no path to a broker and never will.
//
// Pure functions only — no network, no clock beyond the asOf it is given.

import { ROSTER, type Member } from "./roster";
import {
  TRIM_REQUIRES_REPLACEMENT, POSITION_ZONES, RISK_LIMITS,
  winRatePresentation, permittedDeployFraction, WIN_RATE_DISCLOSURE, DATA_INTEGRITY,
  SLEEVE_DRIFT_ALERT_PCT, DUAL_OBJECTIVE, FUND_CONSTITUTION_VERSION,
} from "./constitution";
import type { RegimeAssessment } from "./governance";
import type { ZoneAssessment } from "./risk";
import type { BookReview } from "./book";

/* ────────────────────────────── inputs ────────────────────────────── */

/** What each desk measured about one held position. Any of it may be null. */
export interface PositionEvidence {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number | null;
  marketValue: number | null;
  weightPct: number | null;
  /** Reserve assets fund the book; they are not risk positions to be judged. */
  isReserve: boolean;
  sleeve: string;
  pnlPct: number | null;
  /** Kai Tanaka — concentration zone and the trim it implies. */
  zone: ZoneAssessment | null;
  /** Maya Chen — momentum v3.0. */
  momentum: { total: number; signal: string; hardBlocks: string[]; dataQualityPct: number } | null;
  /** Thomas Eriksson — fair value read. */
  valuation: { verdict: string; deviationPct: number | null; confidence: string } | null;
  /** Trend structure, shared evidence for several seats. */
  trend: { aboveSma50: boolean | null; aboveSma200: boolean | null; return1m: number | null; return3m: number | null } | null;
  /** Ryan Blackwood — sessions to exit at 20% of median ADV. */
  liquidity: { sessionsToExit: number | null } | null;
  /** Leo Tanaka — how old the price is. */
  priceAsOf: string | null;
  /** Lena Müller — forward yield from the name's own distribution history. */
  yieldPct: number | null;
}

/** A name research has referred to the committee. */
export interface IdeaEvidence {
  ticker: string;
  rating: string;
  conviction: number | null;
  source: string;
  price: number | null;
  target: number | null;
  upsidePct: number | null;
  submittedAt: string | null;
  note: string | null;
  /** Already held? Then it is an ADD to an existing line, not a new position. */
  alreadyHeld: boolean;
  /** Which sleeve the money would land in, when it could be classified. */
  sleeve: string | null;
  /** Days since research referred it. A paper has a shelf life. */
  ageDays: number | null;
  /** The price the thesis was written at, when the referral recorded one. */
  referencePrice: number | null;
  /** How far the price has moved since. Positive = it ran without us. */
  priceDriftPct: number | null;
  /** The scanner's own coverage read on the name, when it reported one. */
  dataQuality: string | null;
}

export interface CommitteeInput {
  asOf: string;
  nav: number;
  cashBalance: number;
  deployableCash: number;
  cashBufferPct: number | null;
  targetCashPct: number | null;
  regime: RegimeAssessment | null;
  positions: PositionEvidence[];
  ideas: IdeaEvidence[];
  /** Lena/Kai/Miriam/James's book-level review, including the round table. */
  book: BookReview | null;
  /** Priya Nair — the fund's own recorded hit rate. */
  track: { completed: number; winRatePct: number | null; averageReturnPct: number | null } | null;
  /**
   * Rule #2 — days until the next Tier-1 macro event (FOMC, CPI, NFP), when
   * one is known. Inside the five-day window, deployment is capped at a third.
   */
  daysToTierOneEvent?: number | null;
  /**
   * Rule #3 — names research has put forward as replacements for a trimmed
   * position. **A trim may not be executed until one is named.** Keyed by the
   * ticker being trimmed.
   */
  replacements?: Record<string, { ticker: string; note: string }[]>;
  /** Sources that could not be reached, named so the minutes can say so. */
  unavailable: string[];
}

/* ────────────────────────────── outputs ───────────────────────────── */

export type MotionKind = "ADD" | "HOLD" | "TRIM" | "EXIT" | "NEW BUY" | "RAISE CASH";
export type Ballot = "FOR" | "AGAINST" | "ABSTAIN";
export type MotionOutcome = "CARRIED" | "FAILED" | "DEFERRED";

export interface Vote {
  member: string;
  role: string;
  desk: string;
  ballot: Ballot;
  /** Why — the measurement, or the reason there wasn't one. */
  rationale: string;
}

export type DecisionGateStatus = "PASS" | "DEFER" | "VETO";

export interface DecisionGate {
  stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO";
  owner: string;
  title: string;
  status: DecisionGateStatus;
  rationale: string;
}

export interface Reason {
  desk: string;
  member: string;
  finding: string;
}

export interface Motion {
  id: string;
  ticker: string;
  kind: MotionKind;
  /** Signed dollars: positive buys, negative sells, zero for HOLD. */
  sizeUsd: number;
  approxShares: number | null;
  proposedBy: string;
  reasons: Reason[];
  /** Share of the six evidence slots that were actually measured. */
  evidenceCoveragePct: number;
  missingEvidence: string[];
  votes: Vote[];
  /** The four signatures with actual decision authority. Desk ballots are advisory evidence only. */
  decisionGates: DecisionGate[];
  tally: { for: number; against: number; abstain: number };
  outcome: MotionOutcome;
  outcomeReason: string;
  /** A veto names the seat that cast it. Vetoes defer, they do not reject. */
  veto: { member: string; reason: string } | null;
}

export interface DeskReportRow {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad" | "neutral";
  note?: string;
}

/**
 * What a desk actually measured, as opposed to what it is responsible for.
 *
 * The attendance table says Maya brought momentum scores. This says what those
 * scores were. A meeting where every seat states its remit and none states its
 * findings is a meeting nobody can act on — the fund manager reads the numbers,
 * not the job descriptions.
 */
export interface DeskReport {
  member: string;
  role: string;
  desk: string;
  /** The single figure this desk brought, or null when it measured nothing. */
  headline: string | null;
  /** The measurements themselves, usually one row per holding. */
  rows: DeskReportRow[];
  /** What the desk reads into it — its own conclusion, not a restatement. */
  finding: string;
  /** What this desk could not measure, named rather than left blank. */
  gaps: string[];
}

export interface Attendee {
  member: string;
  role: string;
  desk: string;
  present: boolean;
  /** What the seat brought, or what it was missing. */
  contribution: string;
}

export interface CapitalPlan {
  sourcesUsd: number;
  sourceLines: { label: string; amountUsd: number }[];
  usesUsd: number;
  useLines: { label: string; amountUsd: number }[];
  balanceUsd: number;
  funded: boolean;
  /** Motions cut because the plan did not balance, lowest conviction first. */
  cutForFunding: { ticker: string; requestedUsd: number; reason: string }[];
  cashAfterPct: number | null;
  /**
   * Sale proceeds earmarked for the liquidity buffer. Ring-fenced: this money
   * is not available to fund a purchase, because it is the purchase.
   */
  earmarkedForCashUsd: number;
  note: string;
}

export interface BlotterLine {
  side: "BUY" | "SELL";
  ticker: string;
  approxShares: number | null;
  approxUsd: number;
  referencePrice: number | null;
  reason: string;
}

export interface Resolution {
  id: string;
  text: string;
  owner: string;
  reviewBy: string;
  status: "APPROVED" | "DEFERRED" | "REJECTED";
}

export interface AgendaItem {
  n: number;
  title: string;
  covered: boolean;
  summary: string;
}

export interface CommitteeMeeting {
  meetingId: string;
  asOf: string;
  nav: number;
  agenda: AgendaItem[];
  attendance: Attendee[];
  quorum: { present: number; required: number; met: boolean; note: string };
  regime: RegimeAssessment | null;
  /** Every seat's measured output across the whole book. */
  deskReports: DeskReport[];
  motions: Motion[];
  capitalPlan: CapitalPlan;
  blotter: BlotterLine[];
  resolutions: Resolution[];
  /** Every opposing specialist opinion on a carried motion, kept on the record. */
  dissent: { ticker: string; member: string; rationale: string }[];
  riskRegister: BookReview["riskRegister"];
  roundTable: BookReview["roundTable"];
  minutes: string[];
  disclosures: string[];
}

/* ───────────────────────────── helpers ────────────────────────────── */

const money = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const pct1 = (v: number | null | undefined) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const plain = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : v.toFixed(d));
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Hard single-name cap and the review threshold below it. */
const HARD_CAP_PCT = 20;
const REVIEW_PCT = 15;
/** Each team head needs at least two measurable contributions before signing. */
const MIN_TEAM_EVIDENCE = 2;
/**
 * Gate 7 — the fund's data-quality floor. Below it the CRO defers rather than
 * letting a vote stand. This is the document's number, not a house choice: a
 * motion decided on less evidence than the fund's own gate admits is a decision
 * the pre-trade checklist would refuse anyway.
 */
const MIN_COVERAGE_PCT = DATA_INTEGRITY.minDataQualityPct;
/** A referral older than this is a paper, not a live idea. */
const STALE_REFERRAL_DAYS = 21;
/**
 * How far the price may move from the referral before the thesis has to be
 * written again. A target and an upside computed at one price do not survive
 * the stock running 20% — the work was done on a different security.
 */
const MAX_REFERRAL_DRIFT_PCT = 15;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The liquidity motion.
 *
 * When broker cash sits below the regime's floor the fund has one job before
 * any other: get back inside policy. Saying "raise the buffer" without naming
 * what to sell is not an instruction, and leaving out where the proceeds go
 * invites the obvious wrong answer — that the money is there to buy something.
 * It is not. Restoring the buffer IS the destination.
 *
 * Reserves are sold first: that is what they are for. Only when reserves cannot
 * cover the shortfall does the motion say a risk position has to go, and it
 * names the smallest line that closes the gap rather than leaving it unstated.
 */
function motionForLiquidity(input: CommitteeInput): Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto">[] {
  const floorPct = input.regime?.cashMinPct ?? input.targetCashPct;
  if (floorPct == null || input.nav <= 0) return [];
  const targetCash = (floorPct / 100) * input.nav;
  const shortfall = round2(targetCash - input.cashBalance);
  if (shortfall <= 0) return [];

  const reasons: Reason[] = [];
  if (input.cashBalance < 0) {
    reasons.push({
      desk: "Portfolio", member: ROSTER.lena.name,
      finding: `Broker cash is −${money(input.cashBalance)} — the account is overdrawn. Until it is positive the fund is carrying its own positions on credit, and nothing else at this meeting matters more.`,
    });
  }
  reasons.push({
    desk: "Macro", member: ROSTER.daniel.name,
    finding: `The ${input.regime?.regime ?? "current"} regime sets a ${plain(floorPct)}% cash floor — ${money(targetCash)} on ${money(input.nav)} of NAV. Cash is ${input.cashBalance < 0 ? "−" : ""}${money(input.cashBalance)}, a shortfall of ${money(shortfall)}.`,
  });

  const reserves = input.positions
    .filter((p) => p.isReserve && (p.marketValue ?? 0) > 0)
    .sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0));
  const reserveTotal = reserves.reduce((s, p) => s + (p.marketValue ?? 0), 0);
  if (!reserves.length) {
    reasons.push({
      desk: "Risk", member: ROSTER.kai.name,
      finding: "The fund holds no reserve asset, so the shortfall has to come out of a risk position. That is a decision the meeting must take explicitly rather than leave to whoever places the order.",
    });
  }

  // Produce one executable motion per real security. Reserves fund the gap
  // first; only the remaining shortfall reaches risk positions. A synthetic
  // ticker such as "LIQUIDITY" cannot be approved or written to the ledger.
  const risk = input.positions
    .filter((p) => !p.isReserve && (p.marketValue ?? 0) > 0)
    .sort((a, b) => (a.marketValue ?? 0) - (b.marketValue ?? 0));
  const reserveQueue = [...reserves];
  const riskQueue = [...risk];
  const drafts: Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto">[] = [];
  let remaining = shortfall;

  while (remaining > 0.01 && (reserveQueue.length || riskQueue.length)) {
    // Exhaust real reserve assets before touching a risk position. Within the
    // active pool use the smallest line that covers the gap; otherwise use the
    // largest available line and continue with another executable motion.
    const pool = reserveQueue.length ? reserveQueue : riskQueue;
    const coveringIndex = pool.findIndex((p) => (p.marketValue ?? 0) >= remaining);
    const index = coveringIndex >= 0 ? coveringIndex : pool.reduce((best, p, i, rows) => (p.marketValue ?? 0) > (rows[best].marketValue ?? 0) ? i : best, 0);
    const source = pool.splice(index, 1)[0];
    const available = Math.max(0, source.marketValue ?? 0);
    const size = round2(Math.min(remaining, available));
    if (size <= 0) continue;
    const px = source.price ?? null;
    const sourceReasons: Reason[] = [
      ...reasons,
      {
        desk: source.isReserve ? "Risk" : "Portfolio",
        member: source.isReserve ? ROSTER.kai.name : ROSTER.lena.name,
        finding: source.isReserve
          ? `Sell ${money(size)} of ${source.ticker}. Reserves total ${money(reserveTotal)} across ${reserves.length} line(s) — this is exactly what they are held for.`
          : `${source.ticker} is the ${coveringIndex >= 0 ? "smallest" : "largest available"} risk position selected to raise ${money(size)} of the remaining cash shortfall.`,
      },
      {
        desk: "Executive", member: ROSTER.miriam.name,
        finding: "The proceeds stay as settled cash. This is not a reallocation and it does not fund a purchase — restoring the buffer is the purchase. No new risk position may be opened until the floor is met.",
      },
    ];
    drafts.push({
      id: `LIQ-BUFFER-${source.ticker}`,
      ticker: source.ticker,
      kind: "RAISE CASH",
      sizeUsd: -size,
      approxShares: px && px > 0 ? Math.min(source.shares, Math.max(1, Math.ceil(size / px))) : null,
      proposedBy: ROSTER.lena.name,
      reasons: sourceReasons,
      evidenceCoveragePct: px && px > 0 ? 100 : 75,
      missingEvidence: px && px > 0 ? [] : [`execution price for ${source.ticker}`],
    });
    remaining = round2(remaining - size);
  }

  return drafts;
}

/* ──────────────────────── motion construction ─────────────────────── */

/**
 * One position, one motion. The rules are ordered by severity: the first that
 * fires wins, so an emergency concentration is never quietly downgraded to a
 * hold because the trend also happened to look fine.
 */
function motionForPosition(p: PositionEvidence, input: CommitteeInput): Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto"> {
  const reasons: Reason[] = [];
  const missing: string[] = [];

  const slots: [string, unknown][] = [
    ["concentration zone (Kai Tanaka)", p.zone],
    ["momentum score (Maya Chen)", p.momentum],
    ["valuation read (Thomas Eriksson)", p.valuation],
    ["trend structure", p.trend],
    ["liquidity (Ryan Blackwood)", p.liquidity],
    ["current price (Leo Tanaka)", p.price],
  ];
  for (const [label, value] of slots) if (value == null) missing.push(label);
  const coverage = Math.round(((slots.length - missing.length) / slots.length) * 100);

  const mv = p.marketValue ?? 0;
  const weight = p.weightPct;
  const px = p.price;
  const shares = (usd: number) => (px && px > 0 ? Math.max(1, Math.round(Math.abs(usd) / px)) : null);

  // Reserve assets are the fund's dry powder. They are sold to fund decisions,
  // never exited on a trend read — a T-bill ETF does not have a thesis.
  if (p.isReserve) {
    reasons.push({
      desk: "Portfolio", member: ROSTER.lena.name,
      finding: `${p.ticker} is a reserve asset held at ${plain(weight)}% of NAV. It is a funding source for approved decisions, not a risk position under review.`,
    });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "HOLD", sizeUsd: 0, approxShares: null, proposedBy: ROSTER.lena.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }

  const blocks = p.momentum?.hardBlocks ?? [];
  const trendBroken = p.trend?.aboveSma50 === false && p.trend?.aboveSma200 === false;
  const deepLoss = p.trend?.return3m != null && p.trend.return3m < -15;
  const momentumNegative = p.momentum != null && /REJECT|AVOID|EXIT|SELL/i.test(p.momentum.signal);

  // ── EXIT: the thesis, not the price, has failed ──
  if (blocks.length > 0 && (trendBroken || momentumNegative)) {
    reasons.push({ desk: "Research", member: ROSTER.maya.name, finding: `Hard block${blocks.length > 1 ? "s" : ""} on the momentum model: ${blocks.join("; ")}.` });
    if (trendBroken) reasons.push({ desk: "Research", member: ROSTER.maya.name, finding: "Price is below both the 50- and 200-day averages — the trend structure that justified the position is gone." });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "EXIT", sizeUsd: -mv, approxShares: p.shares, proposedBy: ROSTER.maya.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }
  if (trendBroken && deepLoss) {
    reasons.push({ desk: "Research", member: ROSTER.maya.name, finding: `Below the 50- and 200-day averages with a ${pct1(p.trend?.return3m)} three-month return. Trend and time both say the entry reason has expired.` });
    if (p.pnlPct != null) reasons.push({ desk: "Portfolio", member: ROSTER.lena.name, finding: `Position is ${pct1(p.pnlPct)} against cost.` });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "EXIT", sizeUsd: -mv, approxShares: p.shares, proposedBy: ROSTER.maya.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }

  // ── TRIM: the position is too big, whatever its merits ──
  if (p.zone && (p.zone.zone === "EMERGENCY" || p.zone.zone === "TRIM") && p.zone.trimToTarget != null && p.zone.trimToTarget > 0) {
    reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `${p.zone.icon} ${p.zone.zone} zone at ${plain(weight)}% of NAV. ${p.zone.action}.` });
    reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `Trimming ${money(p.zone.trimToTarget)} restores the 18–19% target band.` });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "TRIM", sizeUsd: -p.zone.trimToTarget, approxShares: shares(p.zone.trimToTarget), proposedBy: ROSTER.kai.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }
  if (weight != null && weight > HARD_CAP_PCT) {
    const excess = ((weight - HARD_CAP_PCT) / 100) * input.nav;
    reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `${plain(weight)}% of NAV is above the ${HARD_CAP_PCT}% hard single-name cap.` });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "TRIM", sizeUsd: -excess, approxShares: shares(excess), proposedBy: ROSTER.kai.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }
  if (p.valuation && /PREMIUM|EXPENSIVE|OVERVALUED/i.test(p.valuation.verdict) && weight != null && weight > REVIEW_PCT) {
    const excess = ((weight - REVIEW_PCT) / 100) * input.nav;
    reasons.push({ desk: "Quant", member: ROSTER.thomas.name, finding: `Valuation reads ${p.valuation.verdict}${p.valuation.deviationPct == null ? "" : ` (${pct1(p.valuation.deviationPct)} from fair value)`}, confidence ${p.valuation.confidence}.` });
    reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `At ${plain(weight)}% the position is above the ${REVIEW_PCT}% review threshold, so a premium valuation is a sizing question rather than a sell signal.` });
    return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "TRIM", sizeUsd: -excess, approxShares: shares(excess), proposedBy: ROSTER.thomas.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
  }

  // ── ADD: room to size up, and a measured reason to ──
  const strong = p.momentum != null && p.momentum.total >= 65 && blocks.length === 0;
  const room = weight != null && weight < REVIEW_PCT;
  const notExpensive = !p.valuation || !/PREMIUM|EXPENSIVE|OVERVALUED/i.test(p.valuation.verdict);
  const regimeAllows = !input.regime || input.regime.score >= 45;
  if (strong && room && notExpensive && regimeAllows && input.deployableCash > 0) {
    const targetPct = Math.min(REVIEW_PCT, (weight ?? 0) + 5);
    const step = Math.min(input.deployableCash, ((targetPct - (weight ?? 0)) / 100) * input.nav);
    if (step > 0) {
      reasons.push({ desk: "Research", member: ROSTER.maya.name, finding: `Momentum ${p.momentum!.total}/100 with no hard blocks; signal reads ${p.momentum!.signal}.` });
      reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `At ${plain(weight)}% there is room to ${plain(targetPct)}% before the review threshold.` });
      if (input.regime) reasons.push({ desk: "Macro", member: ROSTER.daniel.name, finding: `Regime ${input.regime.regime} at ${input.regime.score}/100 permits deployment. ${input.regime.deployRule}` });
      return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "ADD", sizeUsd: step, approxShares: shares(step), proposedBy: ROSTER.maya.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
    }
  }

  // ── HOLD: the default, and it needs a reason too ──
  if (p.momentum) reasons.push({ desk: "Research", member: ROSTER.maya.name, finding: `Momentum ${p.momentum.total}/100, signal ${p.momentum.signal}${blocks.length ? `, blocks: ${blocks.join("; ")}` : ", no hard blocks"}.` });
  if (p.zone) reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `${p.zone.icon} ${p.zone.zone} zone at ${plain(weight)}% of NAV.` });
  if (p.valuation) reasons.push({ desk: "Quant", member: ROSTER.thomas.name, finding: `Valuation ${p.valuation.verdict}, confidence ${p.valuation.confidence}.` });
  if (!reasons.length) reasons.push({ desk: "Executive", member: ROSTER.miriam.name, finding: "No desk produced a measurement for this position, so no change can be justified. Holding is the only defensible action." });
  return { id: `POS-${p.ticker}`, ticker: p.ticker, kind: "HOLD", sizeUsd: 0, approxShares: null, proposedBy: ROSTER.lena.name, reasons, evidenceCoveragePct: coverage, missingEvidence: missing };
}

/** A referred idea becomes a sized proposal, capped by policy before the vote. */
function motionForIdea(idea: IdeaEvidence, input: CommitteeInput): Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto"> {
  const reasons: Reason[] = [];
  const missing: string[] = [];
  if (idea.conviction == null) missing.push("conviction score (Aisha Fontaine)");
  if (idea.target == null) missing.push("price target (Thomas Eriksson)");
  if (idea.price == null) missing.push("current price (Leo Tanaka)");
  if (idea.upsidePct == null) missing.push("upside to target");
  const coverage = Math.round(((4 - missing.length) / 4) * 100);

  // Conviction sets the size, inside a starter band. An unmeasured conviction
  // gets the floor, not the benefit of the doubt.
  const conviction = idea.conviction ?? 0;
  const targetPct = conviction >= 80 ? 8 : conviction >= 65 ? 6 : conviction >= 50 ? 4 : 3;
  // The size the meeting wants, not the size it can currently afford. Funding
  // is decided once, in the capital plan, where the cut can be named — sizing a
  // motion at $0 because the cash is short reads as a decision nobody made.
  const planned = round2((targetPct / 100) * input.nav);

  // Rule #2, and a hard rule: the regime and any near Tier-1 event both cap
  // what may go in today, and the stricter of the two wins. The full plan stays
  // visible so the meeting can see what it is holding back and why.
  const permitted = permittedDeployFraction(input.regime?.score ?? 50, input.daysToTierOneEvent ?? null);
  const requested = round2(planned * permitted.fraction);

  reasons.push({ desk: "Research", member: ROSTER.aisha.name, finding: `Referred from ${idea.source} rated ${idea.rating}${idea.conviction == null ? " with no conviction score recorded" : ` at conviction ${idea.conviction}/100`}${idea.ageDays == null ? "" : ` ${idea.ageDays} day(s) ago`}.` });
  if (idea.upsidePct != null) reasons.push({ desk: "Quant", member: ROSTER.thomas.name, finding: `Upside to target ${pct1(idea.upsidePct)}${idea.target == null ? "" : ` (target ${money(idea.target)})`}.` });
  if (idea.priceDriftPct != null && Math.abs(idea.priceDriftPct) >= MAX_REFERRAL_DRIFT_PCT) {
    reasons.push({ desk: "Executive", member: ROSTER.leo.name, finding: `The price has moved ${pct1(idea.priceDriftPct)} since the referral was written at ${money(idea.referencePrice ?? 0)}. The target and upside were computed on a different price.` });
  }
  if (idea.ageDays != null && idea.ageDays > STALE_REFERRAL_DAYS) {
    reasons.push({ desk: "Research", member: ROSTER.aisha.name, finding: `The referral is ${idea.ageDays} days old, past the ${STALE_REFERRAL_DAYS}-day shelf life. A paper that has sat this long is a starting point, not a recommendation.` });
  }
  reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `Starter size ${plain(targetPct)}% of NAV — ${money(planned)} at full plan — set by conviction band, well inside the ${HARD_CAP_PCT}% cap.` });
  if (permitted.fraction < 1) {
    reasons.push({
      desk: "Macro", member: ROSTER.daniel.name,
      finding: `Deployment is capped at ${Math.round(permitted.fraction * 100)}% of plan today, so ${money(requested)} goes in and ${money(planned - requested)} is held back. ${permitted.reason}`,
    });
  }
  if (idea.dataQuality) reasons.push({ desk: "Executive", member: ROSTER.nina.name, finding: `The scanner reported data quality ${idea.dataQuality} on this name.` });
  if (idea.note) reasons.push({ desk: "Research", member: ROSTER.sofia.name, finding: idea.note });

  const px = idea.price;
  return {
    id: `IDEA-${idea.ticker}`,
    ticker: idea.ticker,
    kind: idea.alreadyHeld ? "ADD" : "NEW BUY",
    sizeUsd: requested,
    approxShares: px && px > 0 ? Math.max(1, Math.round(requested / px)) : null,
    proposedBy: ROSTER.aisha.name,
    reasons,
    evidenceCoveragePct: coverage,
    missingEvidence: missing,
  };
}

/* ────────────────────────────── voting ────────────────────────────── */

/**
 * The liquidity motion gets its own vote sheet: it is a policy compliance
 * question, not a view on a security, and the desks that would normally have
 * nothing to say about a T-bill sale do have something to say about the fund
 * being outside its own cash floor.
 */
function castLiquidityVotes(m: Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto">, input: CommitteeInput): Vote[] {
  const votes: Vote[] = [];
  const seat = (key: string, ballot: Ballot, rationale: string) => {
    const member = ROSTER[key] as Member;
    votes.push({ member: member.name, role: member.role, desk: member.desk, ballot, rationale });
  };
  const floorPct = input.regime?.cashMinPct ?? input.targetCashPct;
  const overdrawn = input.cashBalance < 0;
  const reserves = input.positions.filter((p) => p.isReserve && (p.marketValue ?? 0) > 0);
  const reserveTotal = reserves.reduce((s, p) => s + (p.marketValue ?? 0), 0);

  seat("daniel", "FOR", `The regime sets a ${plain(floorPct)}% floor and the book is at ${plain(input.cashBufferPct)}%. This is policy, not a judgement call.`);
  seat("lena", "FOR", overdrawn ? `Cash is negative. Restoring it is the first call on any capital raised at this meeting.` : `Cash is ${plain(input.cashBufferPct)}% against a ${plain(floorPct)}% floor. The buffer comes before any new position.`);
  seat("kai", "FOR", reserveTotal > 0 ? `${money(reserveTotal)} of reserves are available, so the buffer can be restored without touching a risk position.` : "No reserve is available, so this has to come out of a risk position — that is the cost of running the buffer short.");
  seat("miriam", "FOR", "Deployment stays blocked until the floor is met. Approving this motion is what unblocks the rest of the book, not what spends it.");
  const source = input.positions.find((p) => p.ticker === m.ticker);
  seat("ryan", source?.price ? "FOR" : "ABSTAIN", source?.price ? `${m.ticker} is priced and the approximate share count is executable.` : `${m.ticker} has no current price, so execution cannot size the order.`);
  seat("james", "FOR", "A fund outside its own liquidity policy has one decision in front of it. Carried.");

  // The desks with no measurement bearing on a cash-floor breach say so.
  seat("maya", "ABSTAIN", "A liquidity motion is not a momentum question. The trend on a T-bill fund is not a reason to hold or sell it.");
  seat("thomas", "ABSTAIN", "Reserve assets are cash-equivalent; there is no fair value to argue about.");
  seat("aisha", "ABSTAIN", "No catalyst bears on a cash-floor breach.");
  seat("sofia", "ABSTAIN", "No fundamental question arises on a reserve sale.");
  seat("marcus", "ABSTAIN", "No earnings-quality question arises on a reserve sale.");
  seat("priya", "ABSTAIN", "Restoring a policy floor is not a trade with an expected hit rate.");
  seat("nina", input.unavailable.length ? "ABSTAIN" : "FOR", input.unavailable.length ? `Source coverage is incomplete this meeting: ${input.unavailable.join("; ")}.` : "The cash balance and every position price came through cleanly.");
  seat("leo", "FOR", `Cash balance read as ${input.cashBalance < 0 ? "−" : ""}${money(input.cashBalance)} against ${money(input.nav)} of NAV.`);

  return votes;
}

/**
 * Each seat votes only on what it measured. The abstention text names the
 * missing input, so a thin tally is visibly thin rather than quietly unanimous.
 */
function castVotes(m: Omit<Motion, "votes" | "decisionGates" | "tally" | "outcome" | "outcomeReason" | "veto">, p: PositionEvidence | null, idea: IdeaEvidence | null, input: CommitteeInput): Vote[] {
  const votes: Vote[] = [];
  const seat = (key: keyof typeof ROSTER | string, ballot: Ballot, rationale: string) => {
    const member = ROSTER[key as string] as Member;
    votes.push({ member: member.name, role: member.role, desk: member.desk, ballot, rationale });
  };
  const reducesRisk = m.kind === "TRIM" || m.kind === "EXIT";
  const addsRisk = m.kind === "ADD" || m.kind === "NEW BUY";

  // Maya Chen — momentum.
  if (p?.momentum) {
    const strong = p.momentum.total >= 60 && p.momentum.hardBlocks.length === 0;
    seat("maya", reducesRisk ? (strong ? "AGAINST" : "FOR") : addsRisk ? (strong ? "FOR" : "AGAINST") : "FOR",
      `Momentum ${p.momentum.total}/100, ${p.momentum.hardBlocks.length} hard block(s), data quality ${p.momentum.dataQualityPct}%.`);
  } else if (idea) {
    seat("maya", "ABSTAIN", "The referral carries no momentum score; the name has not been run through the v3.0 model on this book.");
  } else {
    seat("maya", "ABSTAIN", "No candle history was available for this name, so no momentum score exists.");
  }

  // Thomas Eriksson — valuation.
  if (p?.valuation) {
    const rich = /PREMIUM|EXPENSIVE|OVERVALUED/i.test(p.valuation.verdict);
    const cheap = /DISCOUNT|CHEAP|UNDERVALUED/i.test(p.valuation.verdict);
    seat("thomas", reducesRisk ? (rich ? "FOR" : cheap ? "AGAINST" : "ABSTAIN") : addsRisk ? (rich ? "AGAINST" : "FOR") : "FOR",
      `Fair value read ${p.valuation.verdict}${p.valuation.deviationPct == null ? "" : ` (${pct1(p.valuation.deviationPct)})`}, confidence ${p.valuation.confidence}.`);
  } else if (idea?.upsidePct != null) {
    seat("thomas", idea.upsidePct > 0 ? "FOR" : "AGAINST", `Upside to the referred target is ${pct1(idea.upsidePct)}.`);
  } else {
    seat("thomas", "ABSTAIN", "No fair-value anchor could be built — the valuation desk has nothing to vote with.");
  }

  // Kai Tanaka — concentration and sizing.
  if (p?.zone) {
    const hot = p.zone.zone === "EMERGENCY" || p.zone.zone === "TRIM";
    seat("kai", reducesRisk ? "FOR" : addsRisk ? (hot ? "AGAINST" : "FOR") : hot ? "AGAINST" : "FOR",
      `${p.zone.icon} ${p.zone.zone} zone at ${plain(p.weightPct)}% of NAV. ${p.zone.action}.`);
  } else if (idea) {
    const after = input.nav > 0 ? (m.sizeUsd / input.nav) * 100 : 0;
    seat("kai", after <= REVIEW_PCT ? "FOR" : "AGAINST", `A ${plain(after)}% starter position sits ${after <= REVIEW_PCT ? "inside" : "outside"} the ${REVIEW_PCT}% review threshold.`);
  } else {
    seat("kai", "ABSTAIN", "The position could not be priced, so its weight and zone are unknown.");
  }

  // Lena Müller — portfolio construction. She votes on sleeve drift, which is
  // the one thing she can actually measure about a proposed change.
  const sleeveRow = p ? (input.book?.sleeves ?? []).find((s) => s.sleeve === p.sleeve) : null;
  if (p && sleeveRow) {
    const overTarget = sleeveRow.actualPct > sleeveRow.targetPct;
    seat("lena", addsRisk && overTarget ? "AGAINST" : "FOR",
      `${p.ticker} sits in the ${sleeveRow.sleeve} sleeve, ${plain(sleeveRow.actualPct)}% against a ${plain(sleeveRow.targetPct)}% target (drift ${pct1(sleeveRow.driftPct)}).${addsRisk && overTarget ? " Adding here widens a sleeve that is already over target." : reducesRisk ? " Releasing capital here narrows the drift." : ""}`);
  } else if (p) {
    seat("lena", "ABSTAIN", "No sleeve breakdown was available this meeting, so the drift effect of this motion could not be measured.");
  } else if (idea) {
    // Deployable cash already has the regime floor taken out of it, so it is
    // the honest test of whether cash alone can pay for this line.
    const needsASale = m.sizeUsd > input.deployableCash;
    // The sleeve the money lands in matters as much as the name it buys — a
    // book already 20 points over target in growth does not need more growth.
    const target = idea.sleeve ? (input.book?.sleeves ?? []).find((s) => s.sleeve === idea.sleeve) : null;
    const widensDrift = target != null && target.actualPct > target.targetPct;
    seat("lena", widensDrift ? "AGAINST" : "FOR",
      [
        needsASale
          ? `${money(m.sizeUsd)} is more than the ${money(input.deployableCash)} of deployable cash, so this line has to be funded by a sale approved at this meeting.`
          : `${money(m.sizeUsd)} sits inside the ${money(input.deployableCash)} of deployable cash, which is already net of the liquidity floor.`,
        target
          ? `${idea.ticker} lands in the ${target.sleeve} sleeve, already ${plain(target.actualPct)}% against a ${plain(target.targetPct)}% target.${widensDrift ? " Buying here widens a gap the book is trying to close." : " There is room in that sleeve."}`
          : idea.sleeve
          ? `${idea.ticker} classifies to the ${idea.sleeve} sleeve; no sleeve breakdown was available to check drift against.`
          : "The sleeve this name lands in could not be classified, so its effect on the barbell is unmeasured.",
      ].join(" "));
  }

  // Ryan Blackwood — can the fund actually get out?
  if (p?.liquidity?.sessionsToExit != null) {
    const slow = p.liquidity.sessionsToExit > 3;
    seat("ryan", m.kind === "EXIT" && slow ? "AGAINST" : "FOR",
      `Exiting the full line at 20% of median volume takes about ${plain(p.liquidity.sessionsToExit)} session(s).${slow ? " A full exit in one order would move the price; work it over several days." : ""}`);
  } else {
    seat("ryan", "ABSTAIN", "Volume history was unavailable, so sessions-to-exit could not be measured.");
  }

  // Daniel Cho — regime.
  if (input.regime) {
    seat("daniel", addsRisk ? (input.regime.score >= 45 ? "FOR" : "AGAINST") : "FOR",
      `Regime ${input.regime.regime} at ${input.regime.score}/100, cash floor ${input.regime.cashMinPct}%. ${input.regime.deployRule}`);
  } else {
    seat("daniel", "ABSTAIN", "The benchmark history needed for the regime read was unavailable.");
  }

  // Priya Nair — does the fund's own record support this kind of decision?
  {
    const wr = winRatePresentation(input.track?.completed ?? 0, input.track?.winRatePct ?? null);
    if (!wr.quotable) {
      seat("priya", "ABSTAIN", wr.label);
    } else {
      // Rule #6: the rate may be quoted at any sample size, but below 100 live
      // trades it must carry the Component Estimate label — an unlabelled hit
      // rate on a small sample is the most persuasive wrong number the fund
      // produces, and the label is what stops it being read as a backtest.
      const verified = (input.track?.completed ?? 0) >= WIN_RATE_DISCLOSURE.liveTradesRequired;
      seat("priya", verified ? "FOR" : "ABSTAIN",
        `Hit rate ${plain(wr.value)}% across ${input.track?.completed ?? 0} closed decision(s), average return ${pct1(input.track?.averageReturnPct)}. ${wr.label}${verified ? "" : " On that basis the quant desk records the number but does not vote on it."}`);
    }
  }

  // Aisha Fontaine — catalyst and theme. A referral has a shelf life: she is
  // the seat that owns the thesis, so she is the one who withdraws a stale one.
  if (idea) {
    const stale = idea.ageDays != null && idea.ageDays > STALE_REFERRAL_DAYS;
    if (idea.conviction == null) {
      seat("aisha", "ABSTAIN", "The referral arrived without a conviction score, so the catalyst read cannot be reconstructed here.");
    } else if (stale) {
      seat("aisha", "AGAINST", `Referral conviction ${idea.conviction}/100 from ${idea.source}, but it is ${idea.ageDays} days old — past the ${STALE_REFERRAL_DAYS}-day shelf life. Re-run the scan before sizing it.`);
    } else {
      seat("aisha", idea.conviction >= 50 ? "FOR" : "ABSTAIN",
        `Referral conviction ${idea.conviction}/100 from ${idea.source}${idea.ageDays == null ? "" : `, ${idea.ageDays} day(s) old`}.`);
    }
  } else {
    seat("aisha", "ABSTAIN", "No catalyst or earnings-event evidence was attached to this holding for the meeting.");
  }

  // Sofia Reyes and Marcus Webb — fundamentals are per-name research, not a
  // book-level fetch. They say so rather than voting on the price chart.
  seat("sofia", "ABSTAIN", "Business-quality and moat work is done in the ticker analysis, not in the book review. No fresh read was tabled for this name.");
  seat("marcus", "ABSTAIN", "No updated earnings-quality or revision reading was tabled for this name at this meeting.");

  // Nina Okonkwo and Leo Tanaka — data integrity.
  if (input.unavailable.length) {
    seat("nina", "ABSTAIN", `Source coverage is incomplete this meeting: ${input.unavailable.join("; ")}.`);
  } else {
    seat("nina", "FOR", "Every source the meeting depends on responded; the evidence chain is complete.");
  }
  if (p?.priceAsOf) {
    seat("leo", "FOR", `Price as of ${p.priceAsOf}.`);
  } else if (idea?.priceDriftPct != null) {
    const drifted = Math.abs(idea.priceDriftPct) >= MAX_REFERRAL_DRIFT_PCT;
    seat("leo", drifted ? "AGAINST" : "FOR",
      `Price has moved ${pct1(idea.priceDriftPct)} since the referral was written at ${money(idea.referencePrice ?? 0)}.${drifted ? ` That is past the ${MAX_REFERRAL_DRIFT_PCT}% limit — the numbers in the paper describe a different price.` : ""}`);
  } else if (idea?.price != null) {
    seat("leo", "FOR", `Referral carries a price of ${money(idea.price)}, with no earlier price to measure drift against.`);
  } else {
    seat("leo", "ABSTAIN", "No timestamped price was available for this name.");
  }

  // Miriam Osei — the CRO votes on the evidence, not the idea.
  if (m.evidenceCoveragePct < MIN_COVERAGE_PCT) {
    seat("miriam", "AGAINST", `Evidence coverage is ${m.evidenceCoveragePct}%, below Gate 7's ${MIN_COVERAGE_PCT}% floor. Missing: ${m.missingEvidence.join("; ")}. A decision on this little is a guess with a vote attached, and the pre-trade checklist would refuse it regardless.`);
  } else {
    seat("miriam", "FOR", `Evidence coverage ${m.evidenceCoveragePct}%${m.missingEvidence.length ? `; unmeasured: ${m.missingEvidence.join("; ")}` : " — every input the rule needs was measured"}.`);
  }

  // James Hartwell votes last and holds the casting vote, so the chair can
  // never be the reason a motion passes without the desks behind it.
  const deskFor = votes.filter((v) => v.ballot === "FOR").length;
  const deskAgainst = votes.filter((v) => v.ballot === "AGAINST").length;
  if (deskFor > deskAgainst) {
    seat("james", "FOR", `The desks that could measure this are ${deskFor}–${deskAgainst} in favour. I am not overruling the evidence.`);
  } else if (deskAgainst > deskFor) {
    seat("james", "AGAINST", `The desks are ${deskFor}–${deskAgainst} against. The chair does not carry a motion the book will not.`);
  } else {
    // A genuine tie. The house rule is to prefer the action that reduces risk.
    seat("james", reducesRisk ? "FOR" : "AGAINST",
      `Tied ${deskFor}–${deskAgainst}. Casting vote goes to the side that reduces exposure: ${reducesRisk ? "the reduction carries" : "the addition waits for a clearer week"}.`);
  }

  return votes;
}

/**
 * Analysts contribute evidence; they do not decide. Authority is deliberately
 * narrow: the two team heads sign their own package, the CRO owns the risk
 * gate, and the CIO owns the final resolution. A failed upstream gate cannot
 * be out-voted downstream.
 */
function buildDecisionGates(kind: MotionKind, votes: Vote[], veto: Motion["veto"]): DecisionGate[] {
  const byName = new Map(votes.map((vote) => [vote.member, vote]));
  const summary = (keys: (keyof typeof ROSTER)[]) => {
    const ballots = keys.map((key) => byName.get(ROSTER[key].name)).filter((vote): vote is Vote => Boolean(vote));
    return {
      for: ballots.filter((vote) => vote.ballot === "FOR").length,
      against: ballots.filter((vote) => vote.ballot === "AGAINST").length,
      measured: ballots.filter((vote) => vote.ballot !== "ABSTAIN").length,
    };
  };

  const investment = summary(["daniel", "sofia", "marcus", "thomas", "aisha", "maya", "priya", "leo"]);
  const asset = summary(["lena", "kai", "ryan", "nina"]);
  const investmentVeto = veto?.member === ROSTER.sofia.name;
  const assetVeto = veto?.member === ROSTER.lena.name || veto?.member === ROSTER.kai.name;
  const riskVeto = veto?.member === ROSTER.miriam.name;

  const investmentStatus: DecisionGateStatus = kind === "RAISE CASH"
    ? "PASS"
    : investmentVeto
      ? "VETO"
      : investment.measured >= MIN_TEAM_EVIDENCE && investment.for > investment.against ? "PASS" : "DEFER";
  const investmentGate: DecisionGate = {
    stage: "INVESTMENT",
    owner: ROSTER.sofia.name,
    title: "Head of Investment Research",
    status: investmentStatus,
    rationale: kind === "RAISE CASH"
      ? "Liquidity restoration is a portfolio-policy action; no security-selection endorsement is required."
      : investmentVeto
        ? veto!.reason
        : `Investment Team evidence is ${investment.for} supportive, ${investment.against} opposed, ${investment.measured} measurable. Sofia signs only when the research case has positive support and at least ${MIN_TEAM_EVIDENCE} measurable contributions.`,
  };

  const assetStatus: DecisionGateStatus = assetVeto
    ? "VETO"
    : asset.measured >= MIN_TEAM_EVIDENCE && asset.for > asset.against ? "PASS" : "DEFER";
  const assetGate: DecisionGate = {
    stage: "ASSET_MANAGEMENT",
    owner: ROSTER.lena.name,
    title: "Head of Asset Management",
    status: assetStatus,
    rationale: assetVeto
      ? veto!.reason
      : `Asset Management evidence is ${asset.for} supportive, ${asset.against} opposed, ${asset.measured} measurable. Lena signs the sizing, funding and portfolio-impact package.`,
  };

  const croVote = byName.get(ROSTER.miriam.name);
  const riskStatus: DecisionGateStatus = riskVeto || croVote?.ballot === "AGAINST"
    ? "VETO"
    : croVote?.ballot === "FOR" ? "PASS" : "DEFER";
  const riskGate: DecisionGate = {
    stage: "RISK",
    owner: ROSTER.miriam.name,
    title: "Chief Risk Officer",
    status: riskStatus,
    rationale: riskVeto ? veto!.reason : croVote?.rationale ?? "The CRO could not complete the risk gate.",
  };

  const upstreamPassed = investmentStatus === "PASS" && assetStatus === "PASS" && riskStatus === "PASS";
  const cioVote = byName.get(ROSTER.james.name);
  const cioStatus: DecisionGateStatus = upstreamPassed && cioVote?.ballot === "FOR" ? "PASS" : "DEFER";
  const cioGate: DecisionGate = {
    stage: "CIO",
    owner: ROSTER.james.name,
    title: "Chief Investment Officer",
    status: cioStatus,
    rationale: upstreamPassed
      ? cioVote?.rationale ?? "The CIO could not issue a final resolution."
      : "Final resolution withheld because one or more upstream team-head or CRO gates did not pass.",
  };

  return [investmentGate, assetGate, riskGate, cioGate];
}

/* ───────────────────────── desk reports ───────────────────────────── */

/**
 * Every seat's work, shown rather than described.
 *
 * Each report answers three questions in the same order: what did you measure,
 * what does it mean for this book, and what could you not measure. The third
 * is not optional — a desk that reports only its findings and never its gaps
 * lets the reader mistake a thin measurement for a complete one.
 */
function buildDeskReports(input: CommitteeInput): DeskReport[] {
  const reports: DeskReport[] = [];
  const risk = input.positions.filter((p) => !p.isReserve);
  const priced = input.positions.filter((p) => p.price != null);
  const add = (key: string, headline: string | null, rows: DeskReportRow[], finding: string, gaps: string[]) => {
    const m = ROSTER[key] as Member;
    reports.push({ member: m.name, role: m.role, desk: m.desk, headline, rows, finding, gaps });
  };
  const tone = (good: boolean, bad: boolean): DeskReportRow["tone"] => (bad ? "bad" : good ? "good" : "warn");

  /* ── Daniel Cho — regime and cash policy ── */
  {
    const r = input.regime;
    const rows: DeskReportRow[] = r
      ? [
          { label: "Regime", value: `${r.icon} ${r.regime} · ${r.score}/100`, tone: r.score >= 70 ? "good" : r.score >= 40 ? "warn" : "bad" },
          { label: "Cash floor required", value: `${plain(r.cashMinPct)}%`, note: r.deployRule },
          { label: "Cash held", value: `${plain(input.cashBufferPct)}%`, tone: input.cashBufferPct != null && input.cashBufferPct >= r.cashMinPct ? "good" : "bad" },
          ...r.components.map((c) => ({ label: c.label, value: `${plain(c.points, 0)}/${c.max}`, note: c.detail })),
        ]
      : [];
    add("daniel", r ? `${r.regime} ${r.score}/100` : null, rows,
      r
        ? `${r.note} Cash is ${plain(input.cashBufferPct)}% against a ${plain(r.cashMinPct)}% floor, so the book is ${input.cashBufferPct != null && input.cashBufferPct >= r.cashMinPct ? "inside policy and may deploy on the regime's terms" : "below its own floor and deployment is blocked until that is fixed"}.`
        : "No regime could be read, so the cash floor stands at its last setting and this desk cannot clear any deployment.",
      r ? [] : ["Benchmark history for the regime score"]);
  }

  /* ── Maya Chen — momentum across the book ── */
  {
    const scored = risk.filter((p) => p.momentum != null);
    const rows: DeskReportRow[] = scored.map((p) => ({
      label: p.ticker,
      value: `${p.momentum!.total}/100 · ${p.momentum!.signal}`,
      tone: tone(p.momentum!.total >= 65 && p.momentum!.hardBlocks.length === 0, p.momentum!.hardBlocks.length > 0),
      note: p.momentum!.hardBlocks.length ? `Hard blocks: ${p.momentum!.hardBlocks.join("; ")}` : `Data quality ${p.momentum!.dataQualityPct}%`,
    }));
    const blocked = scored.filter((p) => p.momentum!.hardBlocks.length > 0);
    const strong = scored.filter((p) => p.momentum!.total >= 65);
    add("maya", scored.length ? `${strong.length} of ${scored.length} above the 65 entry bar` : null, rows,
      scored.length
        ? `${strong.length} name(s) score at or above the entry bar and ${blocked.length} carry a hard block${blocked.length ? ` — ${blocked.map((p) => p.ticker).join(", ")}` : ""}. ${blocked.length ? "A blocked name may be held, but nothing new is added to one." : "No hard block stands against the book."}`
        : "No holding could be scored — the model needs price history that did not arrive.",
      risk.filter((p) => p.momentum == null).map((p) => `${p.ticker}: no momentum score`));
  }

  /* ── Aisha Fontaine — catalysts and referrals ── */
  {
    const rows: DeskReportRow[] = input.ideas.map((i) => ({
      label: i.ticker,
      value: i.conviction == null ? "no conviction recorded" : `conviction ${i.conviction}/100`,
      tone: tone((i.conviction ?? 0) >= 65, (i.conviction ?? 0) < 50),
      note: [i.source, i.ageDays == null ? null : `${i.ageDays} day(s) old`, i.upsidePct == null ? null : `upside ${pct1(i.upsidePct)}`].filter(Boolean).join(" · "),
    }));
    add("aisha", input.ideas.length ? `${input.ideas.length} referral(s) carried in` : null, rows,
      input.ideas.length
        ? `${input.ideas.filter((i) => (i.conviction ?? 0) >= 65).length} referral(s) clear the 65 conviction bar. ${input.ideas.filter((i) => i.ageDays != null && i.ageDays > STALE_REFERRAL_DAYS).length} are past the ${STALE_REFERRAL_DAYS}-day shelf life and are withdrawn rather than sized.`
        : "Nothing was referred to this meeting. The new-position sleeve has no candidate, which is a research gap rather than a decision.",
      input.positions.length ? ["No per-holding catalyst or earnings-event read was tabled for the existing book"] : []);
  }

  /* ── Thomas Eriksson — fair value ── */
  {
    const valued = input.positions.filter((p) => p.valuation != null);
    const rows: DeskReportRow[] = valued.map((p) => ({
      label: p.ticker,
      value: `${p.valuation!.verdict}${p.valuation!.deviationPct == null ? "" : ` · ${pct1(p.valuation!.deviationPct)}`}`,
      tone: /PREMIUM|EXPENSIVE|OVERVALUED/i.test(p.valuation!.verdict) ? "bad" : /DISCOUNT|CHEAP|UNDERVALUED/i.test(p.valuation!.verdict) ? "good" : "neutral",
      note: `confidence ${p.valuation!.confidence}`,
    }));
    const rich = valued.filter((p) => /PREMIUM|EXPENSIVE|OVERVALUED/i.test(p.valuation!.verdict));
    const cheap = valued.filter((p) => /DISCOUNT|CHEAP|UNDERVALUED/i.test(p.valuation!.verdict));
    add("thomas", valued.length ? `${rich.length} rich · ${cheap.length} cheap of ${valued.length}` : null, rows,
      valued.length
        ? `${rich.length} holding(s) trade above the anchor stack${rich.length ? ` — ${rich.map((p) => p.ticker).join(", ")}` : ""} and ${cheap.length} below it${cheap.length ? ` — ${cheap.map((p) => p.ticker).join(", ")}` : ""}. A premium is a sizing question here, not a sell signal: it only forces a trim above the ${REVIEW_PCT}% review weight.`
        : "No fair-value anchor could be built for any holding, so valuation carries no weight in today's motions.",
      input.positions.filter((p) => p.valuation == null).map((p) => `${p.ticker}: no fair-value anchor`));
  }

  /* ── Kai Tanaka — concentration and stops ── */
  {
    const zoned = input.positions.filter((p) => p.zone != null);
    const rows: DeskReportRow[] = zoned.map((p) => ({
      label: p.ticker,
      value: `${p.zone!.icon} ${p.zone!.zone} · ${plain(p.weightPct)}%`,
      tone: p.zone!.zone === "BASE" ? "good" : p.zone!.zone === "WATCH" ? "warn" : "bad",
      note: p.zone!.trimToTarget ? `Trim ${money(p.zone!.trimToTarget)} to reach the 18–19% band` : p.zone!.action,
    }));
    const hot = zoned.filter((p) => p.zone!.zone === "TRIM" || p.zone!.zone === "EMERGENCY");
    add("kai", zoned.length ? `${hot.length} name(s) past the trim line` : null, rows,
      zoned.length
        ? hot.length
          ? `${hot.map((p) => p.ticker).join(", ")} sit${hot.length === 1 ? "s" : ""} at or above the ${POSITION_ZONES.trimLowerPct}% mandatory-trim line. Rule #3 holds the trim until research names a replacement — the size is the risk, not the name.`
          : `Every position is inside the ${POSITION_ZONES.basePct}% base zone. Concentration is not the book's live risk today.`
        : "No position could be weighted, so no concentration zone was assessed.",
      input.positions.filter((p) => p.zone == null && !p.isReserve).map((p) => `${p.ticker}: unweighted, no zone`));
  }

  /* ── Lena Müller — sleeves, yield and the dual objective ── */
  {
    const sleeves = input.book?.sleeves ?? [];
    // The sleeve engine already decided what counts as drift. Re-deriving it
    // here from the same threshold invites the two to disagree at the boundary,
    // so this desk reports the flag the engine set rather than its own read.
    const rows: DeskReportRow[] = [
      ...sleeves.map((sl) => ({
        label: `${sl.sleeve} sleeve`,
        value: `${plain(sl.actualPct)}% vs ${plain(sl.targetPct)}% target`,
        tone: (sl.alert ? "bad" : "good") as DeskReportRow["tone"],
        note: `drift ${pct1(sl.driftPct)}${sl.alert ? ` — past the ${SLEEVE_DRIFT_ALERT_PCT}% alert` : ""}`,
      })),
      ...(input.book?.blendedYieldPct != null
        ? [{ label: "Blended yield", value: `${plain(input.book.blendedYieldPct)}%`, tone: (input.book.blendedYieldPct >= DUAL_OBJECTIVE.yieldFloorPct ? "good" : "bad") as DeskReportRow["tone"], note: `against the ${DUAL_OBJECTIVE.yieldFloorPct}% objective` }]
        : []),
      ...(input.book?.objectives ?? []).map((o: any) => ({
        label: String(o.label ?? "Objective"),
        value: String(o.status ?? o.value ?? "—"),
        tone: (/pass|beat|✅/i.test(String(o.status ?? "")) ? "good" : "warn") as DeskReportRow["tone"],
      })),
    ];
    const drifted = sleeves.filter((sl) => sl.alert);
    add("lena", sleeves.length ? `${drifted.length} sleeve(s) past the ${SLEEVE_DRIFT_ALERT_PCT}% drift alert` : null, rows,
      sleeves.length
        ? drifted.length
          ? `${drifted.map((sl) => `${sl.sleeve} is ${pct1(sl.driftPct)} off target`).join("; ")}. Rule #7 makes that an alert, and the next deployments should close the gap rather than widen it.`
          : "Every sleeve is inside its band. Capital can go where conviction points rather than where the barbell needs repairing."
        : "No sleeve breakdown was available, so drift could not be measured.",
      input.book ? [] : ["Sleeve breakdown and the dual-objective scorecard"]);
  }

  /* ── Ryan Blackwood — exit liquidity ── */
  {
    const liquid = input.positions.filter((p) => p.liquidity?.sessionsToExit != null);
    const rows: DeskReportRow[] = liquid.map((p) => ({
      label: p.ticker,
      value: `${plain(p.liquidity!.sessionsToExit)} session(s)`,
      tone: tone((p.liquidity!.sessionsToExit ?? 0) <= 1, (p.liquidity!.sessionsToExit ?? 0) > 3),
      note: "to exit the full line at 20% of median volume",
    }));
    const slow = liquid.filter((p) => (p.liquidity!.sessionsToExit ?? 0) > 3);
    add("ryan", liquid.length ? `${slow.length} name(s) take more than 3 sessions to exit` : null, rows,
      liquid.length
        ? slow.length
          ? `${slow.map((p) => p.ticker).join(", ")} cannot be sold in one order without moving the price. Work those over several days rather than in a single ticket.`
          : "Every line exits inside a session at 20% of median volume. Liquidity does not constrain any motion today."
        : "Volume history was unavailable, so exit liquidity is unmeasured across the book.",
      input.positions.filter((p) => p.liquidity?.sessionsToExit == null).map((p) => `${p.ticker}: no volume history`));
  }

  /* ── Priya Nair — the fund's own record ── */
  {
    const wr = winRatePresentation(input.track?.completed ?? 0, input.track?.winRatePct ?? null);
    const rows: DeskReportRow[] = input.track
      ? [
          { label: "Closed decisions", value: String(input.track.completed), tone: input.track.completed >= WIN_RATE_DISCLOSURE.liveTradesRequired ? "good" : "warn" },
          { label: "Hit rate", value: wr.value == null ? "not measured" : `${plain(wr.value)}%`, note: wr.label },
          { label: "Average return", value: pct1(input.track.averageReturnPct) },
        ]
      : [];
    add("priya", input.track ? `${input.track.completed} closed decisions` : null, rows,
      input.track
        ? input.track.completed >= WIN_RATE_DISCLOSURE.liveTradesRequired
          ? `The record is large enough to quote: ${plain(wr.value)}% across ${input.track.completed} closed decisions.`
          : `Rule #6 applies — ${input.track.completed} closed decisions is short of ${WIN_RATE_DISCLOSURE.liveTradesRequired}, so the rate is shown with the Component Estimate label and this desk does not vote on it.`
        : "No decision record was available, so no hit rate exists to quote.",
      input.track ? [] : ["The closed-decision ledger"]);
  }

  /* ── Miriam Osei — evidence and the gates ── */
  {
    const rows: DeskReportRow[] = [
      { label: "Positions priced", value: `${priced.length} of ${input.positions.length}`, tone: tone(priced.length === input.positions.length, priced.length < input.positions.length) },
      { label: "Data-quality floor", value: `${DATA_INTEGRITY.minDataQualityPct}% (Gate 7)`, note: "A motion below this is deferred, not decided" },
      ...input.unavailable.map((u) => ({ label: "Source unavailable", value: u, tone: "bad" as const })),
    ];
    add("miriam", `${input.unavailable.length} source gap(s)`, rows,
      input.unavailable.length
        ? `${input.unavailable.length} source(s) did not answer. Motions that depend on them are deferred rather than decided, and Rule #5 scores what is missing as zero rather than dropping it from the average.`
        : "Every source the meeting depends on responded. No motion is being decided on absent evidence.",
      []);
  }

  /* ── Nina Okonkwo and Leo Tanaka — data lineage and freshness ── */
  {
    add("nina", `${input.unavailable.length ? "incomplete" : "complete"} coverage`,
      input.unavailable.map((u) => ({ label: "Missing", value: u, tone: "bad" as const })),
      input.unavailable.length
        ? `Feed coverage is incomplete: ${input.unavailable.join("; ")}. Every figure downstream of these is either absent or flagged.`
        : "Every feed the meeting reads responded, and every figure below carries a source.",
      []);

    const stale = input.positions.filter((p) => p.priceAsOf == null);
    add("leo", `${priced.length} of ${input.positions.length} priced`,
      input.positions.map((p) => ({
        label: p.ticker,
        value: p.price == null ? "no price" : `${money(p.price)} as of ${p.priceAsOf ?? "unknown"}`,
        tone: tone(p.price != null && p.priceAsOf != null, p.price == null),
      })),
      stale.length
        ? `${stale.map((p) => p.ticker).join(", ")} carry no timestamped price, so their weights and any motion sized against them are unreliable.`
        : "Every holding carries a timestamped price. Weights and sizes below are measured, not assumed.",
      stale.map((p) => `${p.ticker}: no timestamped price`));
  }

  /* ── Sofia Reyes and Marcus Webb — the seats with nothing tabled ── */
  {
    add("sofia", null, [],
      "No fundamental work was tabled for this book review. Business quality, moat and thesis are produced in the ticker analysis, and none was carried into this meeting — so this desk abstains rather than voting on a price chart.",
      ["Business quality and moat assessment for every holding"]);
    add("marcus", null, [],
      "No updated earnings-quality or revision reading was tabled for any holding. This desk abstains for the same reason: an opinion without a measurement behind it is not evidence.",
      ["Earnings quality, revision momentum and beat/miss history for every holding"]);
  }

  /* ── James Hartwell — what the meeting adds up to ── */
  {
    const rows: DeskReportRow[] = [
      { label: "NAV", value: money(input.nav) },
      { label: "Cash", value: `${money(input.cashBalance)} · ${plain(input.cashBufferPct)}%`, tone: input.cashBalance < 0 ? "bad" : "neutral" },
      { label: "Deployable", value: money(input.deployableCash) },
      { label: "Positions", value: `${input.positions.length} (${risk.length} risk, ${input.positions.length - risk.length} reserve)` },
      { label: "Referrals", value: String(input.ideas.length) },
    ];
    add("james", `${input.positions.length} position(s) · ${money(input.nav)}`, rows,
      `The book is ${money(input.nav)} across ${input.positions.length} position(s) with ${money(input.deployableCash)} deployable. The desks above are the evidence; the motions below are what the meeting does about it.`,
      []);
  }

  return reports;
}

/* ─────────────────────────── the meeting ──────────────────────────── */

export function runCommitteeMeeting(input: CommitteeInput): CommitteeMeeting {
  const asOf = input.asOf;
  const meetingId = `IC-${asOf.slice(0, 10).replace(/-/g, "")}`;

  /* 1. Attendance. A seat is present when it brought a measurement. */
  // A desk is present when it measured something on this agenda — and the
  // agenda is the holdings *and* the referrals. A meeting convened to review
  // new ideas is a normal meeting, not an inquorate one.
  const priced = input.positions.filter((p) => p.price != null).length;
  const anyMomentum = input.positions.some((p) => p.momentum != null) || input.ideas.some((i) => i.conviction != null);
  const anyValuation = input.positions.some((p) => p.valuation != null) || input.ideas.some((i) => i.target != null || i.upsidePct != null);
  const anyZone = input.positions.some((p) => p.zone != null) || input.ideas.length > 0;
  const anyLiquidity = input.positions.some((p) => p.liquidity?.sessionsToExit != null);
  const anyPrice = priced > 0 || input.ideas.some((i) => i.price != null);
  const trackReady = (input.track?.completed ?? 0) >= WIN_RATE_DISCLOSURE.liveTradesRequired;

  const attendance: Attendee[] = [
    { key: "james", present: true, contribution: "Chairs the meeting and carries the final verdict." },
    { key: "miriam", present: true, contribution: "Evidence coverage and the pre-trade gates on every motion." },
    { key: "daniel", present: input.regime != null, contribution: input.regime ? `Regime ${input.regime.regime} at ${input.regime.score}/100, cash floor ${input.regime.cashMinPct}%.` : "Benchmark history unavailable — no regime read this meeting." },
    { key: "maya", present: anyMomentum, contribution: anyMomentum ? "Momentum v3.0 scores and hard blocks across the book, plus the conviction on each referral." : "No candle history reached the model; no scores tabled." },
    { key: "aisha", present: input.ideas.length > 0, contribution: input.ideas.length ? `${input.ideas.length} referral(s) carried into the meeting.` : "No new referrals this meeting." },
    { key: "sofia", present: false, contribution: "Fundamental work sits in the ticker analysis; none was tabled for this book review." },
    { key: "marcus", present: false, contribution: "No updated earnings-quality readings were tabled for this book review." },
    { key: "thomas", present: anyValuation, contribution: anyValuation ? "Fair-value reads on the priced holdings." : "No fair-value anchor could be built for any holding." },
    { key: "priya", present: trackReady, contribution: trackReady ? `${input.track!.completed} closed decisions in the record — past the ${WIN_RATE_DISCLOSURE.liveTradesRequired}-trade bar, so the hit rate stands on its own.` : `${input.track?.completed ?? 0} closed decisions. Rule #6 requires ${WIN_RATE_DISCLOSURE.liveTradesRequired} before a win rate is quoted without the Component Estimate label.` },
    { key: "kai", present: anyZone, contribution: anyZone ? "Concentration zones, the trims they imply, and the starter size on every referral." : "No position could be weighted and nothing was referred, so there was nothing to size." },
    { key: "lena", present: input.positions.length > 0 || input.ideas.length > 0, contribution: input.positions.length ? "Sleeve balance, yield contribution and the objective scorecard." : input.ideas.length ? "Sleeve effect of each referral against the barbell targets." : "No open positions and no referrals to review." },
    { key: "ryan", present: anyLiquidity, contribution: anyLiquidity ? "Sessions-to-exit at 20% of median volume." : "Volume history unavailable; no execution read." },
    { key: "nina", present: input.unavailable.length === 0, contribution: input.unavailable.length ? `Incomplete source coverage: ${input.unavailable.join("; ")}.` : "Every source responded." },
    { key: "leo", present: anyPrice, contribution: anyPrice ? `${priced} of ${input.positions.length} position(s) carry a timestamped price${input.ideas.length ? `, and ${input.ideas.filter((i) => i.priceDriftPct != null).length} of ${input.ideas.length} referral(s) can be checked for price drift` : ""}.` : "No live prices were available." },
  ].map(({ key, present, contribution }) => {
    const member = ROSTER[key];
    return { member: member.name, role: member.role, desk: member.desk, present, contribution };
  });

  const presentCount = attendance.filter((a) => a.present).length;
  const requiredQuorum = 8;
  const quorumMet = presentCount >= requiredQuorum;
  const quorum = {
    present: presentCount,
    required: requiredQuorum,
    met: quorumMet,
    note: quorumMet
      ? `${presentCount} of ${attendance.length} seats brought a measurement. The meeting is quorate.`
      : `Only ${presentCount} of ${attendance.length} seats brought a measurement, below the ${requiredQuorum} required. Every motion is deferred until the missing evidence is restored.`,
  };

  const deskReports = buildDeskReports(input);

  /* 2. Motions — one per position, one per referred idea. */
  const heldTickers = new Set(input.positions.map((p) => p.ticker));
  const drafts: { draft: ReturnType<typeof motionForPosition>; p: PositionEvidence | null; idea: IdeaEvidence | null }[] = [];
  // The liquidity motion is taken first: while the fund is below its cash floor
  // every other motion is being decided inside a policy breach.
  const liquidity = motionForLiquidity(input);
  for (const draft of liquidity) drafts.push({ draft, p: null, idea: null });
  const liquidityTickers = new Set(liquidity.map((motion) => motion.ticker));
  for (const p of input.positions) {
    // The liquidity motion already supplies the complete instruction for this
    // security. Do not also table a HOLD/TRIM motion for the same line.
    if (liquidityTickers.has(p.ticker)) continue;
    const draft = motionForPosition(p, input);
    drafts.push({ draft, p, idea: null });
  }
  for (const idea of input.ideas) {
    const marked: IdeaEvidence = { ...idea, alreadyHeld: heldTickers.has(idea.ticker) };
    drafts.push({ draft: motionForIdea(marked, input), p: null, idea: marked });
  }

  /* 3. Vote each motion, then resolve it. */
  const motions: Motion[] = drafts.map(({ draft, p, idea }) => {
    const votes = draft.kind === "RAISE CASH" ? castLiquidityVotes(draft, input) : castVotes(draft, p, idea, input);
    const tally = {
      for: votes.filter((v) => v.ballot === "FOR").length,
      against: votes.filter((v) => v.ballot === "AGAINST").length,
      abstain: votes.filter((v) => v.ballot === "ABSTAIN").length,
    };
    // A veto defers, it never rejects: the answer is "not on this evidence",
    // which is a different statement from "no".
    let veto: Motion["veto"] = null;
    if (draft.evidenceCoveragePct < MIN_COVERAGE_PCT && draft.kind !== "HOLD") {
      veto = { member: ROSTER.miriam.name, reason: `Gate 7: evidence coverage ${draft.evidenceCoveragePct}% is below the fund's ${MIN_COVERAGE_PCT}% data-quality floor. Missing: ${draft.missingEvidence.join("; ")}.` };
    }
    // Rule #3, and one of the fund's ten hard rules: research must name a
    // replacement before a trim is executed. Selling a position with nothing
    // identified to take its place is how a sleeve quietly becomes cash.
    // An EXIT is not caught by this — exiting a broken thesis needs no
    // replacement, and requiring one would keep the fund in a failed position.
    if (!veto && draft.kind === "TRIM" && TRIM_REQUIRES_REPLACEMENT) {
      const named = input.replacements?.[draft.ticker] ?? [];
      if (!named.length) {
        veto = {
          member: ROSTER.sofia.name,
          reason: `Rule #3: a trim may not be executed until research names a replacement. ${draft.ticker} sits in the ${p?.sleeve ?? "unclassified"} sleeve — ${p?.sleeve === "income" ? "the replacement's yield must be at least as high" : "the replacement needs comparable return or momentum"}. If nothing qualifies, the proceeds park in SGOV/JAAA and the trim waits.`,
        };
      }
    }

    // A referral priced 20% ago is not a stale opinion, it is arithmetic about
    // a different security. Send it back rather than size it.
    if (!veto && idea?.priceDriftPct != null && Math.abs(idea.priceDriftPct) >= MAX_REFERRAL_DRIFT_PCT) {
      veto = {
        member: ROSTER.miriam.name,
        reason: `${idea.ticker} has moved ${pct1(idea.priceDriftPct)} since the referral was written at ${money(idea.referencePrice ?? 0)}. The target, the upside and the conviction were all computed at that price. Re-run the analysis before this is sized.`,
      };
    }
    // While the fund is below its own cash floor, nothing new opens. This is
    // the rule the optimizer states and nothing used to enforce.
    if (!veto && (draft.kind === "ADD" || draft.kind === "NEW BUY") && liquidity.length) {
      veto = {
        member: ROSTER.miriam.name,
        reason: `Broker cash is ${input.cashBalance < 0 ? "−" : ""}${money(input.cashBalance)} against a ${plain(input.regime?.cashMinPct ?? input.targetCashPct)}% floor. New risk positions stay blocked until the buffer is restored — see the liquidity motion.`,
      };
    }
    if (!veto && (draft.kind === "ADD" || draft.kind === "NEW BUY") && input.nav > 0) {
      const currentPct = p?.weightPct ?? 0;
      const afterPct = currentPct + (draft.sizeUsd / input.nav) * 100;
      if (afterPct > HARD_CAP_PCT) {
        veto = { member: ROSTER.kai.name, reason: `The addition would take ${draft.ticker} to ${plain(afterPct)}% of NAV, past the ${HARD_CAP_PCT}% hard cap.` };
      }
    }

    const decisionGates = buildDecisionGates(draft.kind, votes, veto);
    const blockedGate = decisionGates.find((gate) => gate.status !== "PASS");

    let outcome: MotionOutcome;
    let outcomeReason: string;
    if (!quorumMet) {
      outcome = "DEFERRED";
      outcomeReason = quorum.note;
    } else if (veto || blockedGate) {
      outcome = "DEFERRED";
      outcomeReason = veto
        ? `Vetoed by ${veto.member}: ${veto.reason}`
        : `${blockedGate!.title} gate ${blockedGate!.status.toLowerCase()}: ${blockedGate!.rationale}`;
    } else {
      outcome = "CARRIED";
      outcomeReason = `Signed by ${decisionGates.map((gate) => gate.owner).join(" → ")}. ${tally.for} supportive, ${tally.against} opposed and ${tally.abstain} abstaining desk opinions remain on the evidence record.`;
    }

    return { ...draft, votes, decisionGates, tally, outcome, outcomeReason, veto };
  });

  /* 4. Capital plan. Uses may not exceed sources. */
  const carried = motions.filter((m) => m.outcome === "CARRIED");
  // Proceeds raised to fix the buffer are ring-fenced: that money is the
  // decision, not the funding for one.
  const earmarked = carried.filter((m) => m.kind === "RAISE CASH");
  const earmarkedForCashUsd = round2(earmarked.reduce((s, m) => s + -m.sizeUsd, 0));
  const sells = carried.filter((m) => m.sizeUsd < 0 && m.kind !== "RAISE CASH");
  const buysAll = carried.filter((m) => m.sizeUsd > 0);

  const sourceLines = [
    { label: "Deployable cash (above the regime floor)", amountUsd: round2(input.deployableCash) },
    ...sells.map((m) => ({ label: `${m.kind} ${m.ticker}`, amountUsd: round2(-m.sizeUsd) })),
  ].filter((line) => line.amountUsd > 0);
  const sourcesUsd = round2(sourceLines.reduce((s, l) => s + l.amountUsd, 0));

  // Fund the highest-conviction uses first; cut the rest and say which.
  const ranked = [...buysAll].sort((a, b) => (b.tally.for - b.tally.against) - (a.tally.for - a.tally.against) || b.evidenceCoveragePct - a.evidenceCoveragePct);
  const funded: Motion[] = [];
  const cutForFunding: CapitalPlan["cutForFunding"] = [];
  let remaining = sourcesUsd;
  for (const m of ranked) {
    if (m.sizeUsd <= remaining) {
      funded.push(m);
      remaining = round2(remaining - m.sizeUsd);
    } else if (remaining > 0 && remaining >= m.sizeUsd * 0.5) {
      // A half-size starter is a real decision; a token one is not.
      const requested = m.sizeUsd;
      const granted = round2(remaining);
      cutForFunding.push({ ticker: m.ticker, requestedUsd: round2(requested), reason: `Reduced from ${money(requested)} to ${money(granted)} — that is what the meeting had left after higher-conviction uses.` });
      m.approxShares = m.approxShares != null ? Math.max(1, Math.round(m.approxShares * (granted / requested))) : null;
      m.sizeUsd = granted;
      funded.push(m);
      remaining = 0;
    } else {
      cutForFunding.push({ ticker: m.ticker, requestedUsd: round2(m.sizeUsd), reason: `Not funded — ${money(m.sizeUsd)} requested against ${money(Math.max(0, remaining))} remaining. Carried over to the next meeting.` });
      m.outcome = "DEFERRED";
      m.outcomeReason = "All four authority gates passed, then the motion was deferred because the portfolio funding plan ran out of sources.";
    }
  }

  const useLines = funded.map((m) => ({ label: `${m.kind} ${m.ticker}`, amountUsd: round2(m.sizeUsd) }));
  const usesUsd = round2(useLines.reduce((s, l) => s + l.amountUsd, 0));
  const cashAfter = input.nav > 0
    ? ((input.cashBalance + earmarkedForCashUsd + sells.reduce((s, m) => s + -m.sizeUsd, 0) - usesUsd) / input.nav) * 100
    : null;

  const capitalPlan: CapitalPlan = {
    sourcesUsd,
    sourceLines,
    usesUsd,
    useLines,
    balanceUsd: round2(sourcesUsd - usesUsd),
    funded: usesUsd <= sourcesUsd,
    cutForFunding,
    cashAfterPct: cashAfter == null ? null : round2(cashAfter),
    earmarkedForCashUsd,
    note: [
      earmarkedForCashUsd > 0
        ? `${money(earmarkedForCashUsd)} is being raised to restore the liquidity buffer. That money stays as settled cash — it is ring-fenced and does not fund anything on this agenda.`
        : "",
      usesUsd === 0
        ? "No approved use of capital this meeting. Cash stays where it is."
        : `${money(usesUsd)} of approved buying is funded from ${money(sourcesUsd)} of sources, leaving ${money(Math.max(0, sourcesUsd - usesUsd))} uncommitted.${cutForFunding.length ? ` ${cutForFunding.length} motion(s) were cut or reduced to make the plan balance.` : ""}`,
    ].filter(Boolean).join(" "),
  };

  /* 5. Blotter — what a human types into the ledger, and nothing more. */
  const finalCarried = motions.filter((m) => m.outcome === "CARRIED" && m.sizeUsd !== 0);
  const blotter: BlotterLine[] = finalCarried.map((m) => {
    const p = input.positions.find((x) => x.ticker === m.ticker);
    const idea = input.ideas.find((x) => x.ticker === m.ticker);
    const line: BlotterLine = {
      side: m.sizeUsd > 0 ? "BUY" : "SELL",
      ticker: m.ticker,
      approxShares: m.approxShares,
      approxUsd: round2(Math.abs(m.sizeUsd)),
      referencePrice: p?.price ?? idea?.price ?? null,
      reason: m.kind === "RAISE CASH"
        ? `RAISE CASH — proceeds stay as settled cash to restore the liquidity buffer. Do not reinvest them. ${m.outcomeReason}`
        : `${m.kind} — ${m.outcomeReason}`,
    };
    return line;
  }).sort((a, b) => (a.side === b.side ? b.approxUsd - a.approxUsd : a.side === "SELL" ? -1 : 1));

  /* 6. Resolutions, each with a named owner and a date it comes back. */
  const resolutions: Resolution[] = motions.map((m, i) => {
    const owner = m.outcome === "CARRIED" && m.sizeUsd !== 0 ? ROSTER.ryan.name : m.outcome === "DEFERRED" ? (m.veto?.member ?? ROSTER.miriam.name) : m.proposedBy;
    const text =
      m.outcome === "CARRIED" && m.kind === "RAISE CASH"
        ? `Sell ${money(m.sizeUsd)} of ${m.ticker}${m.approxShares ? ` (~${m.approxShares} shares)` : ""} and leave the proceeds in settled cash. This restores the liquidity buffer; it does not fund a purchase.`
        : m.outcome === "CARRIED" && m.sizeUsd !== 0
        ? `${m.kind} ${m.ticker} — ${money(m.sizeUsd)}${m.approxShares ? ` (~${m.approxShares} shares)` : ""}. Record the transaction in the ledger; the committee does not execute.`
        : m.outcome === "CARRIED"
        ? `Hold ${m.ticker} unchanged. Reviewed and confirmed at this meeting.`
        : m.outcome === "DEFERRED"
        ? `${m.kind} ${m.ticker} deferred. ${m.outcomeReason}`
        : `${m.kind} ${m.ticker} did not carry. ${m.outcomeReason}`;
    return {
      id: `R-${meetingId}-${String(i + 1).padStart(2, "0")}`,
      text,
      owner,
      reviewBy: addDays(asOf, m.outcome === "DEFERRED" ? 7 : m.kind === "HOLD" ? 30 : 14),
      status: m.outcome === "CARRIED" ? "APPROVED" : m.outcome === "DEFERRED" ? "DEFERRED" : "REJECTED",
    };
  });

  /* 7. Dissent stays on the record when a motion carries over an objection. */
  const dissent = motions
    .filter((m) => m.outcome === "CARRIED")
    .flatMap((m) => m.votes.filter((v) => v.ballot === "AGAINST").map((v) => ({ ticker: m.ticker, member: v.member, rationale: v.rationale })));

  /* 8. Agenda and minutes. */
  const exits = motions.filter((m) => m.kind === "EXIT");
  const trims = motions.filter((m) => m.kind === "TRIM");
  const adds = motions.filter((m) => m.kind === "ADD" || m.kind === "NEW BUY");
  const holds = motions.filter((m) => m.kind === "HOLD");

  const agenda: AgendaItem[] = [
    { n: 1, title: "Call to order and quorum", covered: true, summary: quorum.note },
    { n: 2, title: "Macro regime and cash policy", covered: input.regime != null, summary: [
      input.regime ? `${input.regime.icon} ${input.regime.regime} at ${input.regime.score}/100. Cash floor ${input.regime.cashMinPct}%, currently ${plain(input.cashBufferPct)}%. ${input.regime.deployRule}` : "No regime read: the benchmark history the macro desk needs was unavailable. Cash policy stands at its last setting.",
      liquidity.length ? `The buffer is short by ${money(liquidity.reduce((sum, motion) => sum + -motion.sizeUsd, 0))} and ${liquidity.length} executable liquidity motion(s) are on the agenda. New risk positions are blocked until it is met.` : "",
    ].filter(Boolean).join(" ") },
    { n: 3, title: "Portfolio review", covered: input.positions.length > 0, summary: input.positions.length ? `${input.positions.length} position(s) reviewed at ${money(input.nav)} NAV. ${holds.length} hold, ${trims.length} trim, ${exits.length} exit.` : "No open positions to review." },
    { n: 4, title: "Risk register", covered: (input.book?.riskRegister.length ?? 0) > 0, summary: input.book?.riskRegister.length ? `${input.book.riskRegister.length} risk(s) filed, ${input.book.riskRegister.filter((r) => r.severity === "high").length} high severity.` : "No desk filed a risk with evidence behind it this meeting." },
    { n: 5, title: "New ideas from research", covered: input.ideas.length > 0, summary: input.ideas.length ? `${input.ideas.length} referral(s): ${input.ideas.map((i) => i.ticker).join(", ")}.` : "No name was referred to the committee since the last meeting." },
    { n: 6, title: "Capital allocation", covered: true, summary: capitalPlan.note },
    { n: 7, title: "Authority gates and resolutions", covered: true, summary: `${motions.filter((m) => m.outcome === "CARRIED").length} carried and ${motions.filter((m) => m.outcome === "DEFERRED").length} deferred through Investment Head → Asset Management Head → CRO → CIO.${dissent.length ? ` ${dissent.length} opposing desk opinion(s) recorded.` : ""}` },
    { n: 8, title: "Execution handover", covered: blotter.length > 0, summary: blotter.length ? `${blotter.length} line(s) handed to Portfolio Operations for manual entry. The committee approves; a person executes.` : "Nothing to hand over — no motion carried with a size attached." },
  ];

  const liqMotions = motions.filter((m) => m.kind === "RAISE CASH");
  const carriedLiquidity = liqMotions.filter((m) => m.outcome === "CARRIED");
  const minutes: string[] = [
    `${meetingId} · ${asOf.slice(0, 10)} · NAV ${money(input.nav)} · chaired by ${ROSTER.james.name}.`,
    quorum.note,
    ...(liqMotions.length
      ? [`Liquidity: broker cash ${input.cashBalance < 0 ? "−" : ""}${money(input.cashBalance)} is below the ${plain(input.regime?.cashMinPct ?? input.targetCashPct)}% floor. ${carriedLiquidity.length ? `Approved: ${carriedLiquidity.map((m) => `sell ${money(m.sizeUsd)} of ${m.ticker}`).join("; ")}, proceeds held as cash. New risk positions remain blocked until settlement.` : liqMotions.map((m) => m.outcomeReason).join(" ")}`]
      : []),
    input.regime ? `Macro: ${input.regime.regime} at ${input.regime.score}/100. ${input.regime.note}` : "Macro: no regime read available this meeting.",
    exits.length ? `Exits proposed: ${exits.map((m) => `${m.ticker} (${m.outcome.toLowerCase()})`).join(", ")}.` : "No exit was proposed.",
    trims.length ? `Trims proposed: ${trims.map((m) => `${m.ticker} ${money(m.sizeUsd)} (${m.outcome.toLowerCase()})`).join(", ")}.` : "No trim was proposed.",
    adds.length ? `Additions proposed: ${adds.map((m) => `${m.ticker} ${money(m.sizeUsd)} (${m.outcome.toLowerCase()})`).join(", ")}.` : "No addition was proposed.",
    capitalPlan.note,
    dissent.length ? `Dissent recorded on: ${Array.from(new Set(dissent.map((d) => d.ticker))).join(", ")}. Objections are held on the record against the review date.` : "No dissent was recorded against a carried motion.",
    `Resolutions: ${resolutions.filter((r) => r.status === "APPROVED").length} approved, ${resolutions.filter((r) => r.status === "DEFERRED").length} deferred, ${resolutions.filter((r) => r.status === "REJECTED").length} rejected. Earliest review ${resolutions.length ? resolutions.map((r) => r.reviewBy).sort()[0] : "n/a"}.`,
    "No order was placed. Every approved line requires a human to record the transaction in the ledger.",
  ];

  const disclosures: string[] = [
    `Run against the fund's own rules — ${FUND_CONSTITUTION_VERSION}. Thresholds are read from lib/team/constitution.ts, not restated here.`,
    "Decision support only. The committee produces proposals; it has no execution path and never places an order.",
    "The ten specialist seats provide advisory evidence only. Decision authority is limited to Sofia Reyes (Investment), Lena Müller (Asset Management), Miriam Osei (CRO) and James Hartwell (CIO), in that order.",
    "A desk that could not measure its own input abstained and said so. Advisory opinions remain visible but cannot out-vote an authority gate.",
    ...(input.unavailable.length ? [`Sources unavailable this meeting: ${input.unavailable.join("; ")}. Motions depending on them were deferred rather than decided.`] : []),
    ...((input.track?.completed ?? 0) < WIN_RATE_DISCLOSURE.liveTradesRequired
      ? [`Rule #6: the fund has ${input.track?.completed ?? 0} closed decisions on record against the ${WIN_RATE_DISCLOSURE.liveTradesRequired} required. Any win rate shown carries the "${WIN_RATE_DISCLOSURE.label}" label and is not a backtest.`]
      : []),
    ...(capitalPlan.cutForFunding.length ? [`${capitalPlan.cutForFunding.length} approved use(s) were cut or reduced so the plan would balance. They are named in the capital plan, not dropped silently.`] : []),
  ];

  return {
    meetingId,
    asOf,
    nav: input.nav,
    agenda,
    attendance,
    quorum,
    regime: input.regime,
    deskReports,
    motions,
    capitalPlan,
    blotter,
    resolutions,
    dissent,
    riskRegister: input.book?.riskRegister ?? [],
    roundTable: input.book?.roundTable ?? [],
    minutes,
    disclosures,
  };
}
