// Assertions for the investment committee engine. Fixtures only — the egress
// allowlist blocks the market data hosts from this container, so every case
// feeds constructed evidence through the real module.
//
//   npx tsc lib/team/committee.ts lib/team/book.ts lib/team/roster.ts \
//     --outDir <dir> --module commonjs --target es2020 --skipLibCheck
//   node scripts/test-committee.mjs <dir>

import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-committee.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { runCommitteeMeeting } = require_(path.resolve(outDir, "team/committee.js"));

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { passed++; }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ─────────────────────────── fixture builders ─────────────────────── */

const regime = {
  score: 62, regime: "RISK-ON", icon: "🟢", cashMinPct: 10,
  deployRule: "Deploy selectively into leadership.", components: [], realizedVol: 14.2,
  note: "SPY above both averages.",
};

const zone = (weightPct, marketValue, nav) => {
  if (weightPct > 25) return { zone: "EMERGENCY", icon: "🚨", weightPct, action: "Trim immediately", trimToTarget: Math.round((marketValue - 0.185 * nav) * 100) / 100 };
  if (weightPct >= 23) return { zone: "TRIM", icon: "🔴", weightPct, action: "Mandatory trim to 18-19%", trimToTarget: Math.round((marketValue - 0.185 * nav) * 100) / 100 };
  if (weightPct >= 15) return { zone: "REVIEW", icon: "🟡", weightPct, action: "Above the review threshold", trimToTarget: null };
  return { zone: "HEALTHY", icon: "🟢", weightPct, action: "Within policy", trimToTarget: null };
};

const NAV = 200_000;

function position(over = {}) {
  const shares = over.shares ?? 100;
  const price = over.price ?? 100;
  const marketValue = shares * price;
  const weightPct = (marketValue / NAV) * 100;
  return {
    ticker: "AAA", shares, avgCost: 80, price, marketValue, weightPct,
    isReserve: false, sleeve: "growth", pnlPct: 25,
    zone: zone(weightPct, marketValue, NAV),
    momentum: { total: 55, signal: "WATCH", hardBlocks: [], dataQualityPct: 92 },
    valuation: { verdict: "FAIR", deviationPct: 2, confidence: "medium" },
    trend: { aboveSma50: true, aboveSma200: true, return1m: 4, return3m: 11 },
    liquidity: { sessionsToExit: 0.4 },
    priceAsOf: "2026-08-03",
    yieldPct: 0.8,
    ...over,
  };
}

function input(over = {}) {
  return {
    asOf: "2026-08-04T00:00:00.000Z",
    nav: NAV, cashBalance: 30_000, deployableCash: 20_000,
    cashBufferPct: 15, targetCashPct: 10,
    regime, positions: [position()], ideas: [],
    book: { sleeves: [{ sleeve: "growth", value: 100_000, actualPct: 50, targetPct: 55, driftPct: -5, alert: false, tickers: ["AAA"] }], riskRegister: [], roundTable: [] },
    track: { completed: 24, winRatePct: 58, averageReturnPct: 7.4 },
    unavailable: [],
    ...over,
  };
}

/* ─────────────────────────────── motions ──────────────────────────── */

section("Motion selection");
{
  const m = runCommitteeMeeting(input()).motions[0];
  ok("a healthy, fairly valued, mid-weight position holds", m.kind === "HOLD", `got ${m.kind}`);
  ok("a HOLD moves no money", m.sizeUsd === 0, `got ${m.sizeUsd}`);
}
{
  // 26% weight — above the emergency line.
  const p = position({ shares: 520, price: 100 });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("an emergency-zone position is trimmed", m.kind === "TRIM", `got ${m.kind}`);
  ok("the trim is a sale", m.sizeUsd < 0, `got ${m.sizeUsd}`);
  ok("the trim restores the 18.5% band", Math.abs(Math.abs(m.sizeUsd) - (52_000 - 0.185 * NAV)) < 1, `got ${m.sizeUsd}`);
}
{
  const p = position({
    momentum: { total: 22, signal: "REJECT", hardBlocks: ["Below 200-day average"], dataQualityPct: 88 },
    trend: { aboveSma50: false, aboveSma200: false, return1m: -9, return3m: -21 },
  });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a hard block plus a broken trend exits", m.kind === "EXIT", `got ${m.kind}`);
  ok("the exit sells the whole line", Math.abs(m.sizeUsd) === p.marketValue, `got ${m.sizeUsd} vs ${p.marketValue}`);
  ok("the exit sells every share", m.approxShares === p.shares);
}
{
  // Broken trend and a deep loss, but no hard block — still an exit.
  const p = position({
    momentum: { total: 41, signal: "WATCH", hardBlocks: [], dataQualityPct: 90 },
    trend: { aboveSma50: false, aboveSma200: false, return1m: -6, return3m: -18 },
  });
  ok("trend break plus a deep loss exits without a hard block", runCommitteeMeeting(input({ positions: [p] })).motions[0].kind === "EXIT");
}
{
  // Broken trend but a shallow loss — not yet an exit.
  const p = position({
    momentum: { total: 45, signal: "WATCH", hardBlocks: [], dataQualityPct: 90 },
    trend: { aboveSma50: false, aboveSma200: false, return1m: -2, return3m: -4 },
  });
  ok("a shallow drawdown does not force an exit", runCommitteeMeeting(input({ positions: [p] })).motions[0].kind !== "EXIT");
}
{
  const p = position({ shares: 100, price: 100, momentum: { total: 78, signal: "BUY", hardBlocks: [], dataQualityPct: 95 } });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a strong, small, cheap position is added to", m.kind === "ADD", `got ${m.kind}`);
  ok("the add is a purchase", m.sizeUsd > 0);
  ok("the add is capped by deployable cash", m.sizeUsd <= 20_000);
}
{
  const p = position({ shares: 100, price: 100, momentum: { total: 78, signal: "BUY", hardBlocks: [], dataQualityPct: 95 } });
  const m = runCommitteeMeeting(input({ positions: [p], deployableCash: 0 })).motions[0];
  ok("no deployable cash means no add is proposed", m.kind !== "ADD", `got ${m.kind}`);
}
{
  const p = position({ shares: 340, price: 100, valuation: { verdict: "PREMIUM", deviationPct: 34, confidence: "high" } });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a premium valuation above the review threshold trims to 15%", m.kind === "TRIM", `got ${m.kind}`);
}
{
  const p = position({ ticker: "SGOV", isReserve: true, shares: 300, price: 100, sleeve: "cash",
    momentum: { total: 12, signal: "REJECT", hardBlocks: ["No trend"], dataQualityPct: 60 },
    trend: { aboveSma50: false, aboveSma200: false, return1m: -0.1, return3m: -0.2 } });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a reserve asset is never exited on a trend read", m.kind === "HOLD", `got ${m.kind}`);
  ok("the reserve motion says it is a funding source", /funding source/i.test(m.reasons[0].finding));
}

/* ──────────────────────────────── votes ───────────────────────────── */

section("Voting and abstention");
{
  const m = runCommitteeMeeting(input()).motions[0];
  ok("every seat is polled", m.votes.length === 14, `got ${m.votes.length}`);
  ok("the chair votes last", /James Hartwell/.test(m.votes[m.votes.length - 1].member));
  ok("the tally adds up to the seats polled", m.tally.for + m.tally.against + m.tally.abstain === m.votes.length);
  ok("fundamental seats abstain when nothing was tabled",
    m.votes.filter((v) => /Sofia|Marcus/.test(v.member)).every((v) => v.ballot === "ABSTAIN"));
  ok("every abstention gives a reason",
    m.votes.filter((v) => v.ballot === "ABSTAIN").every((v) => v.rationale.length > 20));
}
{
  const p = position({ momentum: null, valuation: null, trend: null, liquidity: null });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("seats without their own input abstain",
    m.votes.filter((v) => /Maya|Thomas|Ryan/.test(v.member)).every((v) => v.ballot === "ABSTAIN"));
  ok("the abstention names the missing measurement",
    m.votes.find((v) => /Maya/.test(v.member)).rationale.toLowerCase().includes("momentum"));
}
{
  const p = position({ momentum: null, valuation: null, trend: null, liquidity: null, price: null, marketValue: null, weightPct: null, zone: null });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a position with no evidence at all still produces a motion", m.kind === "HOLD");
  ok("its coverage reads zero", m.evidenceCoveragePct === 0, `got ${m.evidenceCoveragePct}`);
  ok("the missing evidence is named, not summarised away", m.missingEvidence.length === 6, `got ${m.missingEvidence.length}`);
}
{
  const p = position({ shares: 520, price: 100, valuation: null, liquidity: null, trend: null, momentum: null });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("the CRO vetoes a sized motion below the coverage floor", m.veto?.member === "Miriam Osei", `coverage ${m.evidenceCoveragePct}`);
  ok("a veto defers rather than rejects", m.outcome === "DEFERRED", `got ${m.outcome}`);
}

/* ────────────────────────────── quorum ────────────────────────────── */

section("Quorum");
{
  const meeting = runCommitteeMeeting(input());
  ok("a full evidence set is quorate", meeting.quorum.met, meeting.quorum.note);
  ok("attendance covers all fourteen seats", meeting.attendance.length === 14);
}
{
  const p = position({ momentum: null, valuation: null, trend: null, liquidity: null, price: null, marketValue: null, weightPct: null, zone: null, priceAsOf: null });
  const meeting = runCommitteeMeeting(input({ positions: [p], regime: null, track: null, unavailable: ["Yahoo chart endpoint", "SEC EDGAR"] }));
  ok("a meeting without evidence is inquorate", !meeting.quorum.met, `present ${meeting.quorum.present}`);
  ok("an inquorate meeting defers every motion", meeting.motions.every((m) => m.outcome === "DEFERRED"));
  ok("the deferral explains itself", meeting.motions[0].outcomeReason.includes("below the"));
}

/* ─────────────────────────── capital plan ─────────────────────────── */

section("Capital plan");
{
  const meeting = runCommitteeMeeting(input({
    positions: [position({ ticker: "AAA", shares: 100, price: 100, momentum: { total: 78, signal: "BUY", hardBlocks: [], dataQualityPct: 95 } })],
    deployableCash: 20_000,
  }));
  const plan = meeting.capitalPlan;
  ok("uses never exceed sources", plan.usesUsd <= plan.sourcesUsd, `${plan.usesUsd} vs ${plan.sourcesUsd}`);
  ok("the plan reports itself funded", plan.funded);
  ok("the balance is sources less uses", Math.abs(plan.balanceUsd - (plan.sourcesUsd - plan.usesUsd)) < 0.01);
}
{
  // Four referrals, each wanting 8% of NAV, against $5,000 of cash.
  const ideas = ["BBB", "CCC", "DDD", "EEE"].map((ticker, i) => ({
    ticker, rating: "BUY", conviction: 85 - i * 10, source: "Stock Analyze",
    price: 50, target: 70, upsidePct: 40, submittedAt: "2026-08-01", note: null, alreadyHeld: false,
  }));
  const meeting = runCommitteeMeeting(input({ ideas, deployableCash: 5_000, cashBalance: 5_000 }));
  const plan = meeting.capitalPlan;
  ok("an overcommitted meeting still balances", plan.usesUsd <= plan.sourcesUsd + 0.01, `${plan.usesUsd} vs ${plan.sourcesUsd}`);
  ok("every unfunded motion is named", plan.cutForFunding.length > 0);
  ok("unfunded motions are deferred, not silently dropped",
    meeting.motions.filter((m) => /IDEA/.test(m.id) && m.outcome === "DEFERRED").length > 0);
  ok("the cut is disclosed", meeting.disclosures.some((d) => /cut or reduced/i.test(d)));
}
{
  // A trim funds a buy: sources should include the sale proceeds.
  const meeting = runCommitteeMeeting(input({
    positions: [position({ ticker: "BIG", shares: 520, price: 100 })],
    deployableCash: 1_000,
  }));
  const trim = meeting.motions.find((m) => m.ticker === "BIG");
  if (trim.outcome === "CARRIED") {
    ok("a carried trim appears as a source", meeting.capitalPlan.sourceLines.some((l) => l.label.includes("BIG")));
  } else {
    ok("a deferred trim is not counted as a source", !meeting.capitalPlan.sourceLines.some((l) => l.label.includes("BIG")));
  }
}

/* ─────────────────────────────── blotter ──────────────────────────── */

section("Blotter and resolutions");
{
  const meeting = runCommitteeMeeting(input({
    positions: [position({ ticker: "AAA", shares: 100, price: 100, momentum: { total: 78, signal: "BUY", hardBlocks: [], dataQualityPct: 95 } })],
  }));
  ok("only carried, sized motions reach the blotter",
    meeting.blotter.every((l) => l.approxUsd > 0));
  ok("a blotter line carries a reference price",
    meeting.blotter.every((l) => l.referencePrice != null));
  ok("sells are listed before buys",
    meeting.blotter.every((l, i, arr) => i === 0 || !(arr[i - 1].side === "BUY" && l.side === "SELL")));
  ok("every motion produces exactly one resolution", meeting.resolutions.length === meeting.motions.length);
  ok("every resolution names an owner", meeting.resolutions.every((r) => r.owner.length > 3));
  ok("every resolution carries a review date", meeting.resolutions.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.reviewBy)));
  ok("deferred resolutions come back soonest",
    meeting.resolutions.filter((r) => r.status === "DEFERRED").every((r) => r.reviewBy <= "2026-08-11"));
}
{
  const meeting = runCommitteeMeeting(input());
  ok("the minutes say no order was placed", meeting.minutes.some((m) => /No order was placed/i.test(m)));
  ok("the disclosures lead with decision-support only", /Decision support only/i.test(meeting.disclosures[0]));
  ok("the agenda has eight items", meeting.agenda.length === 8);
  ok("every agenda item has a summary", meeting.agenda.every((a) => a.summary.length > 10));
}

/* ─────────────────────────────── dissent ──────────────────────────── */

section("Dissent");
{
  // Strong momentum against a mandatory trim: Maya should object, and lose.
  const p = position({ shares: 520, price: 100, momentum: { total: 82, signal: "BUY", hardBlocks: [], dataQualityPct: 96 } });
  const meeting = runCommitteeMeeting(input({ positions: [p] }));
  const m = meeting.motions[0];
  if (m.outcome === "CARRIED") {
    ok("an objection to a carried motion is kept on the record", meeting.dissent.length > 0);
    ok("the dissent names the objector and the reason",
      meeting.dissent.every((d) => d.member.length > 3 && d.rationale.length > 10));
  } else {
    ok("a motion that did not carry records no dissent", meeting.dissent.length === 0);
  }
}

/* ───────────────────────── sleeve discipline ──────────────────────── */

section("Sleeve drift");
{
  const book = { sleeves: [
    { sleeve: "growth", value: 150_000, actualPct: 62, targetPct: 50, driftPct: 12, alert: true, tickers: ["AAA"] },
    { sleeve: "income", value: 14_000, actualPct: 7, targetPct: 30, driftPct: -23, alert: true, tickers: ["III"] },
  ], riskRegister: [], roundTable: [] };
  const idea = { ticker: "BBB", rating: "BUY", conviction: 80, source: "Scanner", price: 50, target: 70, upsidePct: 40, submittedAt: "2026-08-01", note: null, alreadyHeld: false, sleeve: "growth" };
  const m = runCommitteeMeeting(input({ book, ideas: [idea], positions: [] })).motions[0];
  const lena = m.votes.find((v) => /Lena/.test(v.member));
  ok("the PM objects to a buy into an over-target sleeve", lena.ballot === "AGAINST", `got ${lena.ballot}`);
  ok("the objection quotes the drift", /62/.test(lena.rationale) && /50/.test(lena.rationale), lena.rationale);
}
{
  const book = { sleeves: [{ sleeve: "income", value: 14_000, actualPct: 7, targetPct: 30, driftPct: -23, alert: true, tickers: [] }], riskRegister: [], roundTable: [] };
  const idea = { ticker: "III", rating: "BUY", conviction: 80, source: "Scanner", price: 50, target: 70, upsidePct: 40, submittedAt: "2026-08-01", note: null, alreadyHeld: false, sleeve: "income" };
  const lena = runCommitteeMeeting(input({ book, ideas: [idea], positions: [] })).motions[0].votes.find((v) => /Lena/.test(v.member));
  ok("the PM supports a buy into an under-target sleeve", lena.ballot === "FOR", `got ${lena.ballot}`);
}
{
  const idea = { ticker: "CCC", rating: "BUY", conviction: 80, source: "Scanner", price: 50, target: 70, upsidePct: 40, submittedAt: "2026-08-01", note: null, alreadyHeld: false, sleeve: null };
  const lena = runCommitteeMeeting(input({ ideas: [idea], positions: [] })).motions[0].votes.find((v) => /Lena/.test(v.member));
  ok("an unclassified sleeve is named as unmeasured, not assumed", /could not be classified/i.test(lena.rationale), lena.rationale);
}

/* ────────────────────────── track record honesty ──────────────────── */

section("Track record");
{
  const meeting = runCommitteeMeeting(input({ track: { completed: 4, winRatePct: 100, averageReturnPct: 22 } }));
  ok("a win rate on too few trades is not quoted",
    meeting.motions[0].votes.find((v) => /Priya/.test(v.member)).ballot === "ABSTAIN");
  ok("the reason is disclosed", meeting.disclosures.some((d) => /closed decisions/i.test(d)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
