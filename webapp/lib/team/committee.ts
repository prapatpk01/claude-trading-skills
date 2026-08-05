// Sentinel Global Fund — the investment committee meeting itself.
//
// This module turns measured evidence into the artefacts a real fund meeting
// produces: an agenda, an attendance record with a quorum test, one motion per
// position and per new idea, a recorded vote per seat with dissent, a capital
// plan whose sources must actually fund its uses, resolutions with an owner and
// a review date, and a trade blotter a human types into the ledger.
//
// Three rules shape everything here.
//
//   1. A seat that cannot measure its own input ABSTAINS and says why. It never
//      votes on someone else's number. This is what makes the tally mean
//      something — six desks agreeing because they all read the same composite
//      score is one opinion wearing six hats.
//   2. Uses may not exceed sources. A meeting that approves more buying than it
//      has funded has not made a decision, it has made a wish. When the plan
//      does not balance the engine cuts the lowest-conviction uses and names
//      every one it cut.
//   3. Nothing executes. Every carried motion becomes a proposal line for a
//      human to enter. The engine has no path to a broker and never will.
//
// Pure functions only — no network, no clock beyond the asOf it is given.

import { ROSTER, type Member } from "./roster";
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
  tally: { for: number; against: number; abstain: number };
  outcome: MotionOutcome;
  outcomeReason: string;
  /** A veto names the seat that cast it. Vetoes defer, they do not reject. */
  veto: { member: string; reason: string } | null;
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
  motions: Motion[];
  capitalPlan: CapitalPlan;
  blotter: BlotterLine[];
  resolutions: Resolution[];
  /** Every AGAINST vote on a carried motion, kept on the record. */
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
/** A motion needs this many non-abstaining seats to be a decision at all. */
const MIN_VOTING_SEATS = 4;
/** Below this evidence coverage the CRO defers rather than lets a vote stand. */
const MIN_COVERAGE_PCT = 50;
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
function motionForLiquidity(input: CommitteeInput): Omit<Motion, "votes" | "tally" | "outcome" | "outcomeReason" | "veto"> | null {
  const floorPct = input.regime?.cashMinPct ?? input.targetCashPct;
  if (floorPct == null || input.nav <= 0) return null;
  const targetCash = (floorPct / 100) * input.nav;
  const shortfall = round2(targetCash - input.cashBalance);
  if (shortfall <= 0) return null;

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
  const source = reserves[0] ?? null;
  const fromReserves = Math.min(shortfall, reserveTotal);
  const remainder = round2(shortfall - fromReserves);

  if (source) {
    reasons.push({
      desk: "Risk", member: ROSTER.kai.name,
      finding: `Sell ${money(Math.min(shortfall, source.marketValue ?? 0))} of ${source.ticker}. Reserves total ${money(reserveTotal)} across ${reserves.length} line(s) — this is exactly what they are held for.`,
    });
  } else {
    reasons.push({
      desk: "Risk", member: ROSTER.kai.name,
      finding: "The fund holds no reserve asset, so the shortfall has to come out of a risk position. That is a decision the meeting must take explicitly rather than leave to whoever places the order.",
    });
  }
  if (remainder > 0) {
    const smallest = input.positions
      .filter((p) => !p.isReserve && (p.marketValue ?? 0) >= remainder)
      .sort((a, b) => (a.marketValue ?? 0) - (b.marketValue ?? 0))[0];
    reasons.push({
      desk: "Portfolio", member: ROSTER.lena.name,
      finding: smallest
        ? `Reserves cover ${money(fromReserves)} of it. The remaining ${money(remainder)} has to come from a risk position — ${smallest.ticker} is the smallest line that closes the gap in one ticket.`
        : `Reserves cover ${money(fromReserves)} of it. The remaining ${money(remainder)} is larger than any single position, so it needs more than one sale.`,
    });
  }
  reasons.push({
    desk: "Executive", member: ROSTER.miriam.name,
    finding: "The proceeds stay as settled cash. This is not a reallocation and it does not fund a purchase — restoring the buffer is the purchase. No new risk position may be opened until the floor is met.",
  });

  const px = source?.price ?? null;
  const size = Math.min(shortfall, source?.marketValue ?? shortfall);
  return {
    id: "LIQ-BUFFER",
    ticker: source?.ticker ?? "LIQUIDITY",
    kind: "RAISE CASH",
    sizeUsd: -round2(size),
    approxShares: px && px > 0 ? Math.max(1, Math.round(size / px)) : null,
    proposedBy: ROSTER.lena.name,
    reasons,
    evidenceCoveragePct: 100,
    missingEvidence: [],
  };
}

/* ──────────────────────── motion construction ─────────────────────── */

/**
 * One position, one motion. The rules are ordered by severity: the first that
 * fires wins, so an emergency concentration is never quietly downgraded to a
 * hold because the trend also happened to look fine.
 */
function motionForPosition(p: PositionEvidence, input: CommitteeInput): Omit<Motion, "votes" | "tally" | "outcome" | "outcomeReason" | "veto"> {
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
function motionForIdea(idea: IdeaEvidence, input: CommitteeInput): Omit<Motion, "votes" | "tally" | "outcome" | "outcomeReason" | "veto"> {
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
  const requested = round2((targetPct / 100) * input.nav);

  reasons.push({ desk: "Research", member: ROSTER.aisha.name, finding: `Referred from ${idea.source} rated ${idea.rating}${idea.conviction == null ? " with no conviction score recorded" : ` at conviction ${idea.conviction}/100`}${idea.ageDays == null ? "" : ` ${idea.ageDays} day(s) ago`}.` });
  if (idea.upsidePct != null) reasons.push({ desk: "Quant", member: ROSTER.thomas.name, finding: `Upside to target ${pct1(idea.upsidePct)}${idea.target == null ? "" : ` (target ${money(idea.target)})`}.` });
  if (idea.priceDriftPct != null && Math.abs(idea.priceDriftPct) >= MAX_REFERRAL_DRIFT_PCT) {
    reasons.push({ desk: "Executive", member: ROSTER.leo.name, finding: `The price has moved ${pct1(idea.priceDriftPct)} since the referral was written at ${money(idea.referencePrice ?? 0)}. The target and upside were computed on a different price.` });
  }
  if (idea.ageDays != null && idea.ageDays > STALE_REFERRAL_DAYS) {
    reasons.push({ desk: "Research", member: ROSTER.aisha.name, finding: `The referral is ${idea.ageDays} days old, past the ${STALE_REFERRAL_DAYS}-day shelf life. A paper that has sat this long is a starting point, not a recommendation.` });
  }
  reasons.push({ desk: "Risk", member: ROSTER.kai.name, finding: `Starter size ${plain(targetPct)}% of NAV — ${money(requested)} — set by conviction band, well inside the ${HARD_CAP_PCT}% cap.` });
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
function castLiquidityVotes(m: Omit<Motion, "votes" | "tally" | "outcome" | "outcomeReason" | "veto">, input: CommitteeInput): Vote[] {
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
  seat("ryan", reserves.length ? "FOR" : "ABSTAIN", reserves.length ? `A reserve ETF fills at size without market impact; this can be done in one ticket.` : "Without a reserve line there is nothing here for the execution desk to price.");
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
function castVotes(m: Omit<Motion, "votes" | "tally" | "outcome" | "outcomeReason" | "veto">, p: PositionEvidence | null, idea: IdeaEvidence | null, input: CommitteeInput): Vote[] {
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
  if (input.track && input.track.completed >= 10) {
    seat("priya", "FOR", `${input.track.completed} closed decisions on record, hit rate ${plain(input.track.winRatePct)}%, average return ${pct1(input.track.averageReturnPct)}.`);
  } else {
    seat("priya", "ABSTAIN", `Only ${input.track?.completed ?? 0} closed decisions are on record — too few to quote a win rate that means anything.`);
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
    seat("miriam", "AGAINST", `Evidence coverage is ${m.evidenceCoveragePct}%. Missing: ${m.missingEvidence.join("; ")}. A decision on this little is a guess with a vote attached.`);
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
  const trackReady = (input.track?.completed ?? 0) >= 10;

  const attendance: Attendee[] = [
    { key: "james", present: true, contribution: "Chairs the meeting and carries the final verdict." },
    { key: "miriam", present: true, contribution: "Evidence coverage and the pre-trade gates on every motion." },
    { key: "daniel", present: input.regime != null, contribution: input.regime ? `Regime ${input.regime.regime} at ${input.regime.score}/100, cash floor ${input.regime.cashMinPct}%.` : "Benchmark history unavailable — no regime read this meeting." },
    { key: "maya", present: anyMomentum, contribution: anyMomentum ? "Momentum v3.0 scores and hard blocks across the book, plus the conviction on each referral." : "No candle history reached the model; no scores tabled." },
    { key: "aisha", present: input.ideas.length > 0, contribution: input.ideas.length ? `${input.ideas.length} referral(s) carried into the meeting.` : "No new referrals this meeting." },
    { key: "sofia", present: false, contribution: "Fundamental work sits in the ticker analysis; none was tabled for this book review." },
    { key: "marcus", present: false, contribution: "No updated earnings-quality readings were tabled for this book review." },
    { key: "thomas", present: anyValuation, contribution: anyValuation ? "Fair-value reads on the priced holdings." : "No fair-value anchor could be built for any holding." },
    { key: "priya", present: trackReady, contribution: trackReady ? `${input.track!.completed} closed decisions in the record.` : `Only ${input.track?.completed ?? 0} closed decisions — too few to quote a hit rate.` },
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

  /* 2. Motions — one per position, one per referred idea. */
  const heldTickers = new Set(input.positions.map((p) => p.ticker));
  const drafts: { draft: ReturnType<typeof motionForPosition>; p: PositionEvidence | null; idea: IdeaEvidence | null }[] = [];
  // The liquidity motion is taken first: while the fund is below its cash floor
  // every other motion is being decided inside a policy breach.
  const liquidity = motionForLiquidity(input);
  if (liquidity) drafts.push({ draft: liquidity, p: null, idea: null });
  for (const p of input.positions) {
    const draft = motionForPosition(p, input);
    // A reserve the liquidity motion is already selling should not also appear
    // as an untouched hold. One position, one instruction.
    if (liquidity && p.ticker === liquidity.ticker) {
      draft.reasons = [{
        desk: "Portfolio", member: ROSTER.lena.name,
        finding: `${p.ticker} is the funding source for the liquidity motion above — ${money(liquidity.sizeUsd)} of it is being sold to restore the cash floor. The remainder is held.`,
      }];
    }
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
    const voting = tally.for + tally.against;

    // A veto defers, it never rejects: the answer is "not on this evidence",
    // which is a different statement from "no".
    let veto: Motion["veto"] = null;
    if (draft.evidenceCoveragePct < MIN_COVERAGE_PCT && draft.kind !== "HOLD") {
      veto = { member: ROSTER.miriam.name, reason: `Evidence coverage ${draft.evidenceCoveragePct}% is below the ${MIN_COVERAGE_PCT}% floor. Missing: ${draft.missingEvidence.join("; ")}.` };
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
    if (!veto && (draft.kind === "ADD" || draft.kind === "NEW BUY") && liquidity) {
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

    let outcome: MotionOutcome;
    let outcomeReason: string;
    if (!quorumMet) {
      outcome = "DEFERRED";
      outcomeReason = quorum.note;
    } else if (veto) {
      outcome = "DEFERRED";
      outcomeReason = `Vetoed by ${veto.member}: ${veto.reason}`;
    } else if (voting < MIN_VOTING_SEATS) {
      outcome = "DEFERRED";
      outcomeReason = `Only ${voting} seat(s) could vote on the evidence; ${MIN_VOTING_SEATS} are required for a decision. ${tally.abstain} seat(s) abstained.`;
    } else if (tally.for > tally.against) {
      outcome = "CARRIED";
      outcomeReason = `Carried ${tally.for}–${tally.against} with ${tally.abstain} abstention(s).`;
    } else {
      outcome = "FAILED";
      outcomeReason = `Failed ${tally.for}–${tally.against} with ${tally.abstain} abstention(s). The position stands unchanged.`;
    }

    return { ...draft, votes, tally, outcome, outcomeReason, veto };
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
      m.outcomeReason = `Carried on the merits ${m.tally.for}–${m.tally.against}, then deferred for funding: the meeting ran out of sources.`;
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
      liquidity ? `The buffer is short by ${money(-liquidity.sizeUsd)} and a liquidity motion is on the agenda. New risk positions are blocked until it is met.` : "",
    ].filter(Boolean).join(" ") },
    { n: 3, title: "Portfolio review", covered: input.positions.length > 0, summary: input.positions.length ? `${input.positions.length} position(s) reviewed at ${money(input.nav)} NAV. ${holds.length} hold, ${trims.length} trim, ${exits.length} exit.` : "No open positions to review." },
    { n: 4, title: "Risk register", covered: (input.book?.riskRegister.length ?? 0) > 0, summary: input.book?.riskRegister.length ? `${input.book.riskRegister.length} risk(s) filed, ${input.book.riskRegister.filter((r) => r.severity === "high").length} high severity.` : "No desk filed a risk with evidence behind it this meeting." },
    { n: 5, title: "New ideas from research", covered: input.ideas.length > 0, summary: input.ideas.length ? `${input.ideas.length} referral(s): ${input.ideas.map((i) => i.ticker).join(", ")}.` : "No name was referred to the committee since the last meeting." },
    { n: 6, title: "Capital allocation", covered: true, summary: capitalPlan.note },
    { n: 7, title: "Voting and resolutions", covered: true, summary: `${motions.filter((m) => m.outcome === "CARRIED").length} carried, ${motions.filter((m) => m.outcome === "DEFERRED").length} deferred, ${motions.filter((m) => m.outcome === "FAILED").length} failed.${dissent.length ? ` ${dissent.length} dissenting vote(s) recorded.` : ""}` },
    { n: 8, title: "Execution handover", covered: blotter.length > 0, summary: blotter.length ? `${blotter.length} line(s) handed to Portfolio Operations for manual entry. The committee approves; a person executes.` : "Nothing to hand over — no motion carried with a size attached." },
  ];

  const liqMotion = motions.find((m) => m.kind === "RAISE CASH");
  const minutes: string[] = [
    `${meetingId} · ${asOf.slice(0, 10)} · NAV ${money(input.nav)} · chaired by ${ROSTER.james.name}.`,
    quorum.note,
    ...(liqMotion
      ? [`Liquidity: broker cash ${input.cashBalance < 0 ? "−" : ""}${money(input.cashBalance)} is below the ${plain(input.regime?.cashMinPct ?? input.targetCashPct)}% floor. ${liqMotion.outcome === "CARRIED" ? `Approved: sell ${money(liqMotion.sizeUsd)} of ${liqMotion.ticker}, proceeds held as cash. New risk positions remain blocked until settlement.` : liqMotion.outcomeReason}`]
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
    "Decision support only. The committee produces proposals; it has no execution path and never places an order.",
    "A seat that could not measure its own input abstained and said so. Abstentions are shown in every tally so a thin vote reads as thin.",
    ...(input.unavailable.length ? [`Sources unavailable this meeting: ${input.unavailable.join("; ")}. Motions depending on them were deferred rather than decided.`] : []),
    ...((input.track?.completed ?? 0) < 10 ? [`The fund has ${input.track?.completed ?? 0} closed decisions on record. No win rate is quoted below 10 — a hit rate on a handful of trades is noise with a percentage sign.`] : []),
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
