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
  score: 62, regime: "NEUTRAL", icon: "🟡", cashMinPct: 15,
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
  ok("only four sequential authority gates decide the motion", m.decisionGates.length === 4, `got ${m.decisionGates.length}`);
  ok("authority belongs only to the two heads, CRO and CIO",
    m.decisionGates.map((g) => g.owner).join("|") === "Sofia Reyes|Lena Müller|Miriam Osei|James Hartwell",
    m.decisionGates.map((g) => g.owner).join("|"));
  ok("a carried motion has all four authority gates passed",
    m.outcome !== "CARRIED" || m.decisionGates.every((g) => g.status === "PASS"));
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
  ok("uses never exceed deployable sources", plan.usesUsd <= plan.deployableSourcesUsd, `${plan.usesUsd} vs ${plan.deployableSourcesUsd}`);
  ok("the plan reports itself funded", plan.funded);
  ok("every dollar has a named destination", plan.unallocatedUsd === 0 && plan.allocationComplete);
  ok("unused deployable capital is explicitly parked", Math.abs(plan.temporaryParkingUsd - (plan.deployableSourcesUsd - plan.usesUsd)) < 0.01);
  ok("the source and destination totals balance", Math.abs(plan.sourcesUsd - plan.destinationLines.reduce((sum, line) => sum + line.amountUsd, 0)) < 0.01);
  ok("the temporary reserve has an owner and review date", plan.destinationLines.filter((line) => line.category === "TEMPORARY_PARKING").every((line) => line.owner && line.reviewBy));
}
{
  // Four referrals, each wanting 8% of NAV, against $5,000 of cash.
  const ideas = ["BBB", "CCC", "DDD", "EEE"].map((ticker, i) => ({
    ticker, rating: "BUY", conviction: 85 - i * 10, source: "Stock Analyze",
    price: 50, target: 70, upsidePct: 40, submittedAt: "2026-08-01", note: null, alreadyHeld: false,
  }));
  // Cash sits above the 10% floor (20,000 on 200,000 NAV) with 5,000 spare, so
  // the constraint under test is funding, not the liquidity buffer.
  const meeting = runCommitteeMeeting(input({ ideas, deployableCash: 5_000, cashBalance: 35_000 }));
  const plan = meeting.capitalPlan;
  ok("an overcommitted meeting still balances", plan.usesUsd <= plan.deployableSourcesUsd + 0.01, `${plan.usesUsd} vs ${plan.deployableSourcesUsd}`);
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
  ok("the disclosures name the rulebook the meeting ran against", /investment-system/.test(meeting.disclosures[0]), meeting.disclosures[0]);
  ok("and state decision-support only", meeting.disclosures.some((d) => /Decision support only/i.test(d)));
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

/* ─────────────────────── the liquidity motion ─────────────────────── */

section("Liquidity buffer");

// The shape the real book was in: broker cash negative, a reserve line held.
const overdrawn = (over = {}) => input({
  cashBalance: -125.65,
  deployableCash: 0,
  cashBufferPct: -1,
  targetCashPct: 8,
  regime: { ...regime, cashMinPct: 8 },
  positions: [
    position({ ticker: "GPIQ", shares: 200, price: 100 }),
    position({ ticker: "SGOV", shares: 15, price: 100, isReserve: true, sleeve: "cash", zone: null, momentum: null, valuation: { verdict: "CASH EQUIVALENT", deviationPct: 0, confidence: "high" }, trend: null }),
  ],
  ...over,
});

{
  const meeting = runCommitteeMeeting(overdrawn());
  const liq = meeting.motions.find((m) => m.kind === "RAISE CASH");
  ok("a cash floor breach produces a liquidity motion", liq != null);
  ok("it is taken first", meeting.motions[0].kind === "RAISE CASH");
  ok("it names the reserve to sell, not just 'raise the buffer'", liq.ticker === "SGOV", liq.ticker);
  ok("it is a sale", liq.sizeUsd < 0);
  ok("it is sized to the shortfall, capped by the reserve",
    Math.abs(liq.sizeUsd) <= 1500 + 0.01 && Math.abs(liq.sizeUsd) > 0, `${liq.sizeUsd}`);
  ok("an overdraft is called an overdraft",
    liq.reasons.some((r) => /overdrawn/i.test(r.finding)));
  ok("the destination is stated explicitly",
    liq.reasons.some((r) => /proceeds stay as settled cash/i.test(r.finding)));
  ok("it says it is not a reallocation",
    liq.reasons.some((r) => /not a reallocation/i.test(r.finding)));
  ok("it carries", liq.outcome === "CARRIED", liq.outcomeReason);
}
{
  const meeting = runCommitteeMeeting(overdrawn({
    ideas: [{ ticker: "BBB", rating: "BUY", conviction: 90, source: "Scan", price: 50, target: 80, upsidePct: 60, submittedAt: "2026-08-03", note: null, alreadyHeld: false, sleeve: "growth", ageDays: 1, referencePrice: 50, priceDriftPct: 0, dataQuality: "HIGH" }],
  }));
  const buy = meeting.motions.find((m) => m.ticker === "BBB");
  ok("no new position opens while the fund is below its cash floor", buy.outcome === "DEFERRED", buy.outcomeReason);
  ok("the block names the CRO and the floor", /Miriam/.test(buy.veto.member) && /floor/i.test(buy.veto.reason));
}
{
  const meeting = runCommitteeMeeting(overdrawn());
  const plan = meeting.capitalPlan;
  ok("the raised cash is visible but ring-fenced from deployable funding",
    plan.earmarkedForCashUsd > 0 && plan.deployableSourcesUsd === plan.sourcesUsd - plan.earmarkedForCashUsd, JSON.stringify(plan.sourceLines));
  ok("the broker-cash floor is a named destination",
    plan.destinationLines.some((line) => line.category === "CASH_RESERVE" && line.amountUsd === plan.earmarkedForCashUsd));
  ok("the plan says the money stays as cash", /ring-fenced/i.test(plan.note));
  ok("the blotter line warns against reinvesting the proceeds",
    meeting.blotter.some((l) => l.ticker === "SGOV" && /Do not reinvest/i.test(l.reason)));
  ok("the resolution says leave the proceeds in cash",
    meeting.resolutions.some((r) => /leave the proceeds in settled cash/i.test(r.text)));
  ok("the minutes record the breach and the fix",
    meeting.minutes.some((line) => /Liquidity:/.test(line) && /below the/.test(line)));
}
{
  // A book already inside policy raises nothing.
  const meeting = runCommitteeMeeting(input({ cashBalance: 40_000, cashBufferPct: 20 }));
  ok("a funded book has no liquidity motion", !meeting.motions.some((m) => m.kind === "RAISE CASH"));
  ok("and new positions are not blocked",
    !meeting.motions.some((m) => m.veto && /floor/i.test(m.veto.reason)));
}
{
  // No reserve to sell, and a $1,500 gap: GPIQ ($20,000) would cover it but
  // SPMO ($2,000) is the smallest line that does, so SPMO is the one to name.
  const meeting = runCommitteeMeeting(overdrawn({
    cashBalance: 14_500,
    positions: [position({ ticker: "GPIQ", shares: 200, price: 100 }), position({ ticker: "SPMO", shares: 20, price: 100 })],
  }));
  const liq = meeting.motions.find((m) => m.kind === "RAISE CASH");
  ok("with no reserve the motion still names a source", liq != null && /risk position/i.test(liq.reasons.map((r) => r.finding).join(" ")));
  ok("the executable motion uses the real source ticker", liq.ticker === "SPMO", liq.ticker);
  ok("the executable motion includes an approximate share count", liq.approxShares === 15, String(liq.approxShares));
  ok("and it names the smallest line that closes the gap",
    liq.reasons.some((r) => /SPMO is the smallest risk position/.test(r.finding)), liq.reasons.map((r) => r.finding).join(" | "));
}

/* ─────────────────── the fund's own rules, enforced ───────────────── */

section("Rule #3 — a trim needs a replacement first");
{
  // 26% weight forces a mandatory trim.
  const p = position({ ticker: "BIG", shares: 520, price: 100 });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("a trim with no replacement named is vetoed", m.veto != null, JSON.stringify(m.veto));
  ok("the veto cites Rule #3", /Rule #3/.test(m.veto.reason), m.veto.reason);
  ok("the missing replacement stops Sofia's Investment Head gate",
    m.decisionGates.find((g) => g.stage === "INVESTMENT")?.status === "VETO");
  ok("it is deferred, not rejected", m.outcome === "DEFERRED");
  ok("it says where the proceeds park meanwhile", /SGOV\/JAAA/.test(m.veto.reason));
}
{
  const p = position({ ticker: "BIG", shares: 520, price: 100 });
  const m = runCommitteeMeeting(input({ positions: [p], replacements: { BIG: [{ ticker: "QDVO", note: "yield 10.5% vs 9.8%" }] } })).motions[0];
  ok("naming a replacement clears the veto", m.veto === null, JSON.stringify(m.veto));
  ok("and the trim can carry", m.outcome === "CARRIED", m.outcomeReason);
  ok("a carried trim is signed by all four authorities", m.decisionGates.every((g) => g.status === "PASS"));
}
{
  // An exit needs no replacement — requiring one would trap the fund in a
  // broken thesis.
  const p = position({
    ticker: "BRK", shares: 100, price: 100,
    momentum: { total: 22, signal: "REJECT", hardBlocks: ["Below 200-day average"], dataQualityPct: 88 },
    trend: { aboveSma50: false, aboveSma200: false, return1m: -9, return3m: -21 },
  });
  const m = runCommitteeMeeting(input({ positions: [p] })).motions[0];
  ok("an exit is not blocked by the replacement rule", m.kind === "EXIT" && m.veto === null, `${m.kind} ${JSON.stringify(m.veto)}`);
}

section("Rule #2 — staggered deploy before a Tier-1 event");
{
  const idea = { ticker: "AVDV", rating: "BUY", conviction: 82, source: "Scan", price: 50, target: 65, upsidePct: 30, submittedAt: "2026-08-03", note: null, alreadyHeld: false, sleeve: "income", ageDays: 1, referencePrice: 50, priceDriftPct: 0, dataQuality: "HIGH" };
  const full = runCommitteeMeeting(input({ ideas: [idea], positions: [] })).motions[0];
  const near = runCommitteeMeeting(input({ ideas: [idea], positions: [], daysToTierOneEvent: 3 })).motions[0];
  ok("a Tier-1 event within five days cuts the size", near.sizeUsd < full.sizeUsd, `${near.sizeUsd} vs ${full.sizeUsd}`);
  const plan = 0.08 * NAV;
  ok("to one third of the planned size", Math.abs(near.sizeUsd - plan / 3) < 1, `${near.sizeUsd} vs plan ${plan}`);
  ok("the meeting is told what was held back", near.reasons.some((r) => /held back/.test(r.finding)), JSON.stringify(near.reasons.map((r) => r.finding)));
  ok("and why", near.reasons.some((r) => /Tier-1 event/.test(r.finding)));
}
{
  const idea = { ticker: "AVDV", rating: "BUY", conviction: 82, source: "Scan", price: 50, target: 65, upsidePct: 30, submittedAt: "2026-08-03", note: null, alreadyHeld: false, sleeve: "income", ageDays: 1, referencePrice: 50, priceDriftPct: 0, dataQuality: "HIGH" };
  const m = runCommitteeMeeting(input({ ideas: [idea], positions: [], daysToTierOneEvent: 20 })).motions[0];
  // The regime still applies: 62/100 is Neutral, which permits 75% of plan.
  ok("an event outside the window leaves only the regime cap", Math.abs(m.sizeUsd - 0.08 * NAV * 0.75) < 1, `${m.sizeUsd}`);
}
{
  const idea = { ticker: "AVDV", rating: "BUY", conviction: 82, source: "Scan", price: 50, target: 65, upsidePct: 30, submittedAt: "2026-08-03", note: null, alreadyHeld: false, sleeve: "income", ageDays: 1, referencePrice: 50, priceDriftPct: 0, dataQuality: "HIGH" };
  const riskOn = { ...regime, score: 78, regime: "RISK-ON", icon: "🟢", cashMinPct: 10 };
  const m = runCommitteeMeeting(input({ ideas: [idea], positions: [], regime: riskOn })).motions[0];
  ok("a Risk-On regime deploys the full plan", Math.abs(m.sizeUsd - 0.08 * NAV) < 1, `${m.sizeUsd}`);
}
{
  const idea = { ticker: "AVDV", rating: "BUY", conviction: 82, source: "Scan", price: 50, target: 65, upsidePct: 30, submittedAt: "2026-08-03", note: null, alreadyHeld: false, sleeve: "income", ageDays: 1, referencePrice: 50, priceDriftPct: 0, dataQuality: "HIGH" };
  const crisis = { ...regime, score: 12, regime: "CRISIS", icon: "⚫", cashMinPct: 40 };
  const meeting = runCommitteeMeeting(input({ ideas: [idea], positions: [], regime: crisis, cashBalance: 90_000, cashBufferPct: 45 }));
  const m = meeting.motions.find((x) => x.ticker === "AVDV");
  ok("a Crisis regime freezes deployment entirely", m.sizeUsd === 0, `${m.sizeUsd}`);
  ok("and the reason names the freeze", m.reasons.some((r) => /frozen|0% of plan/i.test(r.finding)), JSON.stringify(m.reasons.map((r) => r.finding)));
}

section("Rule #6 — win-rate disclosure");
{
  const m = runCommitteeMeeting(input({ track: { completed: 24, winRatePct: 58, averageReturnPct: 7.4 } })).motions[0];
  const priya = m.votes.find((v) => /Priya/.test(v.member));
  ok("a rate below 100 trades still shows", /58/.test(priya.rationale), priya.rationale);
  ok("but carries the Component Estimate label", /Component Estimate/.test(priya.rationale), priya.rationale);
  ok("and the desk does not vote on it", priya.ballot === "ABSTAIN", priya.ballot);
}
{
  const m = runCommitteeMeeting(input({ track: { completed: 140, winRatePct: 61, averageReturnPct: 8.2 } })).motions[0];
  const priya = m.votes.find((v) => /Priya/.test(v.member));
  ok("past 100 live trades the rate stands on its own", priya.ballot === "FOR", priya.ballot);
  ok("and drops the estimate label", !/Component Estimate/.test(priya.rationale), priya.rationale);
  ok("citing the sample size", /140 live trades/.test(priya.rationale), priya.rationale);
}

/* ──────────────────── referrals from the scanner ──────────────────── */

section("Referral shelf life and price drift");

const idea = (over = {}) => ({
  ticker: "BBB", rating: "BUY", conviction: 78, source: "Momentum scan · Technology",
  price: 100, target: 130, upsidePct: 30, submittedAt: "2026-08-01", note: null,
  alreadyHeld: false, sleeve: "growth", ageDays: 2, referencePrice: 100, priceDriftPct: 0,
  dataQuality: "HIGH", ...over,
});

{
  // A meeting convened to review new ideas is a normal meeting: the desks that
  // scored, valued and sized the referral are present even with no holdings.
  const meeting = runCommitteeMeeting(input({ ideas: [idea()], positions: [] }));
  ok("a referral-only meeting is quorate", meeting.quorum.met, meeting.quorum.note);
  ok("the seats that measured the referral are marked present",
    ["Maya Chen", "Thomas Eriksson", "Kai Tanaka", "Lena Müller", "Leo Tanaka"]
      .every((name) => meeting.attendance.find((a) => a.member === name)?.present));
  ok("the execution desk still abstains on an unheld name",
    !meeting.attendance.find((a) => a.member === "Ryan Blackwood").present);
}
{
  const m = runCommitteeMeeting(input({ ideas: [idea()], positions: [] })).motions[0];
  ok("a fresh, undrifted referral becomes a sized new buy", m.kind === "NEW BUY" && m.sizeUsd > 0, `${m.kind} ${m.sizeUsd}`);
  ok("it carries", m.outcome === "CARRIED", m.outcomeReason);
  ok("the engine that found it is named in the reasons",
    m.reasons.some((r) => /Momentum scan · Technology/.test(r.finding)));
  ok("the scanner's data-quality read is on the record",
    m.reasons.some((r) => /data quality HIGH/i.test(r.finding)));
}
{
  // Price ran 22% since the paper was written.
  const m = runCommitteeMeeting(input({ ideas: [idea({ price: 122, priceDriftPct: 22 })], positions: [] })).motions[0];
  ok("a referral whose price has run past the limit is vetoed", m.veto?.member === "Miriam Osei", JSON.stringify(m.veto));
  ok("the veto defers rather than rejects", m.outcome === "DEFERRED", m.outcome);
  ok("the veto quotes the drift and the price it was written at", /22/.test(m.veto.reason) && /100/.test(m.veto.reason));
  ok("the real-time desk votes against it",
    m.votes.find((v) => /Leo Tanaka/.test(v.member)).ballot === "AGAINST");
}
{
  const m = runCommitteeMeeting(input({ ideas: [idea({ price: 88, priceDriftPct: -12 })], positions: [] })).motions[0];
  ok("a drift inside the limit does not veto", m.veto === null, JSON.stringify(m.veto));
  ok("but the drift is still shown to the meeting",
    m.votes.find((v) => /Leo Tanaka/.test(v.member)).rationale.includes("12"));
}
{
  const m = runCommitteeMeeting(input({ ideas: [idea({ ageDays: 40 })], positions: [] })).motions[0];
  const aisha = m.votes.find((v) => /Aisha/.test(v.member));
  ok("the catalyst desk withdraws its own stale referral", aisha.ballot === "AGAINST", aisha.rationale);
  ok("the age is quoted", /40 days old/.test(aisha.rationale), aisha.rationale);
  ok("the staleness is in the motion's reasons",
    m.reasons.some((r) => /shelf life/i.test(r.finding)));
}
{
  const m = runCommitteeMeeting(input({ ideas: [idea({ ageDays: 21 })], positions: [] })).motions[0];
  ok("a referral exactly at the shelf life is still live",
    m.votes.find((v) => /Aisha/.test(v.member)).ballot === "FOR");
}
{
  const m = runCommitteeMeeting(input({ ideas: [idea({ referencePrice: null, priceDriftPct: null })], positions: [] })).motions[0];
  ok("a referral with no reference price is not vetoed for drift", m.veto === null);
  ok("the missing reference price is named, not assumed",
    m.votes.find((v) => /Leo Tanaka/.test(v.member)).rationale.includes("no earlier price"));
}
{
  // A held name referred again is an addition to the line, not a new position.
  const held = position({ ticker: "BBB", shares: 100, price: 100 });
  const m = runCommitteeMeeting(input({ ideas: [idea()], positions: [held] })).motions.find((x) => x.id === "IDEA-BBB");
  ok("a referral for a name already held is an ADD, not a NEW BUY", m.kind === "ADD", m.kind);
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

/* ──────────────────────────── desk reports ────────────────────────── */

// The attendance table states what a seat is responsible for. The desk report
// is the work: what it measured on this book, what it concluded, and what it
// could not measure. A meeting that publishes only the first is a staff list.

section("Desk reports");
{
  const meeting = runCommitteeMeeting(input());
  const reports = meeting.deskReports;
  ok("every seat files a report", reports.length === meeting.attendance.length, `${reports.length} vs ${meeting.attendance.length} seats`);
  ok("each report names the person and the desk", reports.every((r) => r.member.length > 3 && r.desk.length > 3));
  ok("each report carries a finding, never an empty one", reports.every((r) => r.finding.length > 30));

  const maya = reports.find((r) => /Maya/.test(r.member));
  ok("the momentum desk shows a reading per holding", maya.rows.length === 1, JSON.stringify(maya.rows));
  ok("and the reading is the score, not the remit", /55\/100/.test(maya.rows[0].value), maya.rows[0].value);

  const daniel = reports.find((r) => /Daniel/.test(r.member));
  ok("the macro desk shows the regime it read", /NEUTRAL/.test(daniel.headline ?? ""), daniel.headline);
  ok("and the cash floor beside the cash held", daniel.rows.some((row) => /Cash floor/i.test(row.label)) && daniel.rows.some((row) => /Cash held/i.test(row.label)));

  const kai = reports.find((r) => /Kai/.test(r.member));
  ok("the risk desk shows the weight and the zone", /%/.test(kai.rows[0].value), kai.rows[0].value);

  const james = reports.find((r) => /James/.test(r.member));
  ok("the chair totals the book", james.rows.some((row) => row.label === "NAV"));
}
{
  // A desk with nothing tabled must say so rather than filing an empty card.
  const sofia = runCommitteeMeeting(input()).deskReports.find((r) => /Sofia/.test(r.member));
  ok("an untabled desk states the absence", /none was carried into this meeting/i.test(sofia.finding), sofia.finding);
  ok("and names the gap it leaves", sofia.gaps.length > 0, JSON.stringify(sofia.gaps));
}
{
  // Rule #5's discipline applied to the reports themselves: an unmeasured
  // holding is listed as unmeasured, not silently missing from the desk's rows.
  const blind = position({ momentum: null, valuation: null, liquidity: {}, priceAsOf: null, price: 100 });
  const reports = runCommitteeMeeting(input({ positions: [blind] })).deskReports;
  const maya = reports.find((r) => /Maya/.test(r.member));
  ok("an unscored holding leaves the rows empty rather than inventing one", maya.rows.length === 0);
  ok("and is named in the gaps", maya.gaps.some((g) => /AAA/.test(g)), JSON.stringify(maya.gaps));
  const leo = reports.find((r) => /Leo/.test(r.member));
  ok("an untimestamped price is called out by the data desk", leo.gaps.some((g) => /AAA/.test(g)), JSON.stringify(leo.gaps));
  const ryan = reports.find((r) => /Ryan/.test(r.member));
  ok("unmeasured liquidity is a gap, not a pass", ryan.gaps.length === 1, JSON.stringify(ryan.gaps));
}
{
  const meeting = runCommitteeMeeting(input({ unavailable: ["Yahoo chart endpoint", "SEC EDGAR"] }));
  const miriam = meeting.deskReports.find((r) => /Miriam/.test(r.member));
  ok("source gaps appear on the evidence desk's own report", miriam.rows.filter((row) => /unavailable/i.test(row.label)).length === 2);
  ok("and the finding says motions are deferred rather than decided", /deferred rather than decided/i.test(miriam.finding), miriam.finding);
}
{
  const meeting = runCommitteeMeeting(input({ track: { completed: 4, winRatePct: 100, averageReturnPct: 22 } }));
  const priya = meeting.deskReports.find((r) => /Priya/.test(r.member));
  ok("a short record is reported as short on the desk's own card", /Rule #6/.test(priya.finding), priya.finding);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
