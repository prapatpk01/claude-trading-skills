import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
if (!buildDir) throw new Error("usage: node scripts/test-v36-production-regressions.mjs <compiled-dir>");

const committeePath = path.join(process.cwd(), buildDir, "team", "committee.js");
const fastPath = path.join(process.cwd(), buildDir, "research", "universeFastScan.js");
const { canonicalizeMotionsV36, partiallyFundDeployableExcessAddsV36 } = await import(pathToFileURL(committeePath).href);
const { parseTradingViewFastPayloads } = await import(pathToFileURL(fastPath).href);

console.log("\nV36.2 production regression — one authoritative motion per ticker");
{
  const meeting = {
    motions: [
      { id: "hold-msft", ticker: "MSFT", kind: "HOLD", outcome: "CARRIED" },
      { id: "add-msft", ticker: "MSFT", kind: "ADD", outcome: "DEFERRED" },
      { id: "hold-enb", ticker: "ENB", kind: "HOLD", outcome: "CARRIED" },
    ],
  };
  canonicalizeMotionsV36(meeting);
  assert.equal(meeting.motions.filter(row => row.ticker === "MSFT").length, 1, "MSFT must render as one authoritative motion/card");
  assert.equal(meeting.motions.find(row => row.ticker === "MSFT")?.kind, "ADD", "explicit ADD must replace the redundant zero-dollar HOLD motion");
  assert.equal(meeting.motions.find(row => row.ticker === "ENB")?.kind, "HOLD", "unrelated HOLD motion must remain intact");
}

console.log("V36.2 production regression — risk reduction outranks reinvestment");
{
  const meeting = {
    motions: [
      { id: "add-risk", ticker: "RISK", kind: "ADD", outcome: "CARRIED" },
      { id: "trim-risk", ticker: "RISK", kind: "TRIM", outcome: "DEFERRED" },
    ],
  };
  canonicalizeMotionsV36(meeting);
  assert.equal(meeting.motions.length, 1);
  assert.equal(meeting.motions[0].kind, "TRIM", "risk reduction must outrank adding risk for the same ticker");
}

console.log("V36.2 production regression — $148 excess partially funds the qualified $360 MSFT ADD");
{
  const passGates = ["INVESTMENT", "ASSET_MANAGEMENT", "RISK", "CIO"].map((stage) => ({ stage, owner: stage, title: stage, status: "PASS", rationale: "pass" }));
  const add = {
    id: "add-msft",
    ticker: "MSFT",
    kind: "ADD",
    sizeUsd: 360,
    approxShares: 1,
    proposedBy: "Investment",
    reasons: [],
    evidenceCoveragePct: 100,
    missingEvidence: [],
    votes: [],
    decisionGates: passGates,
    tally: { for: 9, against: 0, abstain: 5 },
    outcome: "DEFERRED",
    outcomeReason: "All four authority gates passed, then the motion was deferred because the portfolio funding plan ran out of sources.",
    veto: null,
  };
  const meeting = {
    quorum: { met: true },
    motions: [add],
    capitalPlan: {
      sourcesUsd: 148,
      deployableSourcesUsd: 148,
      sourceLines: [{ label: "Deployable Cash Buffer excess (USD/reserves as needed)", amountUsd: 148 }],
      usesUsd: 0,
      useLines: [],
      balanceUsd: 0,
      funded: true,
      cutForFunding: [{ ticker: "MSFT", requestedUsd: 360, reason: "Not funded — $360 requested against $148 remaining." }],
      cashAfterPct: 16.2,
      earmarkedForCashUsd: 0,
      temporaryParkingUsd: 148,
      unallocatedUsd: 0,
      allocationComplete: true,
      approvalReady: true,
      allocationStatus: "READY",
      reviewOwner: "Lena Müller",
      reviewBy: "2026-09-03",
      destinationLines: [{ category: "TEMPORARY_PARKING", label: "Temporary reserve pending ranked allocation review", amountUsd: 148, owner: "Lena Müller", reviewBy: "2026-09-03" }],
      fallbackOptions: [{ ticker: "CASH / SGOV", action: "KEEP RESERVE", maxUsd: 148, rationale: "temporary" }],
      note: "temporary parking",
    },
    blotter: [],
    resolutions: [{ id: "R-1", text: "ADD MSFT deferred. funding", owner: "Miriam Osei", reviewBy: "2026-09-03", status: "DEFERRED" }],
    dissent: [],
    agenda: [
      { n: 6, title: "Capital allocation", covered: true, summary: "temporary" },
      { n: 7, title: "Authority", covered: true, summary: "deferred" },
      { n: 8, title: "Execution", covered: false, summary: "none" },
    ],
    minutes: [],
  };
  const input = {
    nav: 9_000,
    ideas: [{ ticker: "MSFT", source: "V36 Deployable Excess Reinvestment Ladder", price: 496.37 }],
    positions: [{ ticker: "MSFT", price: 496.37 }],
  };
  partiallyFundDeployableExcessAddsV36(meeting, input);
  assert.equal(add.outcome, "CARRIED", "funding-only defer must become a carried partial ADD");
  assert.equal(add.sizeUsd, 148, "the ADD must be resized to the actual deployable excess");
  assert.ok(Math.abs(add.approxShares - 148 / 496.37) < 0.0001, "fractional shares must reflect the resized dollars");
  assert.equal(meeting.capitalPlan.temporaryParkingUsd, 0, "$148 must no longer remain parked");
  assert.equal(meeting.capitalPlan.usesUsd, 148);
  assert.equal(meeting.capitalPlan.destinationLines.some(row => row.category === "ADD_HOLDING" && row.amountUsd === 148), true);
  assert.equal(meeting.blotter.some(row => row.side === "BUY" && row.ticker === "MSFT" && row.approxUsd === 148), true, "manual blotter must receive the resized ADD");
  assert.equal(meeting.resolutions[0].status, "APPROVED", "resolution must be updated from deferred to approved");
}

console.log("V36.2 production regression — TradingView Stage A bulk parser");
{
  // d[] follows TV_COLUMNS in universeFastScan.ts:
  // name, close, Perf.W, Perf.1M, Perf.3M, relative_volume, EMA20, EMA50, volume, avg_volume_30d.
  const payload = {
    totalCount: 3,
    data: [
      { s: "AMEX:SPY", d: ["SPY", 650, 1.5, 4.0, 10.0, 1.05, 640, 620, 70_000_000, 65_000_000] },
      { s: "NASDAQ:MSFT", d: ["MSFT", 500, 2.0, 8.0, 20.0, 1.30, 480, 455, 24_000_000, 22_000_000] },
      { s: "NASDAQ:NVDA", d: ["NVDA", 210, 3.0, 12.0, 28.0, 1.55, 198, 184, 180_000_000, 160_000_000] },
    ],
  };
  const rows = parseTradingViewFastPayloads([payload], ["MSFT", "NVDA"]);
  assert.equal(rows.length, 2, "bulk payload should cover both approved test tickers");
  const msft = rows.find(row => row.ticker === "MSFT");
  assert.ok(msft);
  assert.equal(msft.return1m, 8);
  assert.equal(msft.return3m, 20);
  assert.equal(msft.rs3m, 10, "RS 3M must subtract the SPY 3M performance");
  assert.equal(msft.aboveEma20, true);
  assert.equal(msft.ema20Above50, true);
  assert.equal(msft.volumeRatio, 1.3);
}

console.log("V36.2 production regression — class-share ticker normalization");
{
  const payload = {
    data: [
      { s: "NYSE:BRK.B", d: ["BRK.B", 510, 1, 4, 12, 1.0, 500, 480, 5_000_000, 4_500_000] },
    ],
  };
  const rows = parseTradingViewFastPayloads([payload], ["BRK-B"]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ticker, "BRK-B", "provider dot notation must map back to the approved-universe ticker spelling");
}

console.log("\nSentinel V36.2 production regressions passed");
