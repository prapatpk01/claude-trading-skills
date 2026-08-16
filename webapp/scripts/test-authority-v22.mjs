// Three-round simulation for Sentinel Decision Authority V22.
// Uses the real committee wrapper with deterministic evidence fixtures.

import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-authority-v22.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { runCommitteeMeeting } = require_(path.resolve(outDir, "team/committee.js"));

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const NAV = 200_000;
const regime = {
  score: 68,
  regime: "RISK-ON SELECTIVE",
  icon: "🟢",
  cashMinPct: 10,
  deployRule: "Deploy selectively into high-quality leadership.",
  components: [],
  realizedVol: 13,
  note: "Constructive but selective.",
};

const basePosition = {
  ticker: "AAA",
  shares: 100,
  avgCost: 80,
  price: 100,
  marketValue: 10_000,
  weightPct: 5,
  isReserve: false,
  sleeve: "growth",
  pnlPct: 25,
  zone: { zone: "HEALTHY", icon: "🟢", weightPct: 5, action: "Within policy", trimToTarget: null },
  momentum: { total: 70, signal: "BUY", hardBlocks: [], dataQualityPct: 95 },
  valuation: { verdict: "FAIR", deviationPct: 8, confidence: "high" },
  trend: { aboveSma50: true, aboveSma200: true, return1m: 4, return3m: 12 },
  liquidity: { sessionsToExit: 0.2 },
  priceAsOf: "2026-08-16",
  yieldPct: 0.5,
  recentTrade: null,
};

function idea(ticker, technical) {
  return {
    ticker,
    rating: "BUY",
    conviction: 82,
    source: "V22 simulation research",
    price: 100,
    target: 122,
    upsidePct: 22,
    submittedAt: "2026-08-16",
    note: "Strong business quality, positive revisions, defensible valuation and identifiable catalysts.",
    alreadyHeld: false,
    sleeve: "growth",
    ageDays: 0,
    referencePrice: 100,
    priceDriftPct: 0,
    dataQuality: "95% measured",
    technical,
    recentTrade: null,
  };
}

function input(ideas) {
  return {
    asOf: "2026-08-16T12:00:00.000Z",
    nav: NAV,
    cashBalance: 30_000,
    deployableCash: 18_000,
    cashBufferPct: 15,
    targetCashPct: 10,
    regime,
    positions: [basePosition],
    ideas,
    book: {
      sleeves: [{ sleeve: "growth", value: 100_000, actualPct: 50, targetPct: 55, driftPct: -5, alert: false, tickers: ["AAA"] }],
      blendedYieldPct: 4.5,
      objectives: [],
      riskRegister: [],
      roundTable: [],
    },
    track: { completed: 30, winRatePct: 60, averageReturnPct: 8.5 },
    unavailable: [],
    replacements: {},
    portfolioRevision: "SIM-V22",
  };
}

function motion(meeting, ticker) {
  return meeting.motions.find((row) => row.ticker === ticker);
}

function gate(row, stage) {
  return row?.decisionGates?.find((g) => g.stage === stage);
}

console.log("\nRound 1 — near-miss technical gate should become CONDITIONAL, not a false VETO");
{
  const meeting = runCommitteeMeeting(input([
    idea("NEAR", { total: 64, signal: "WATCH", hardBlocks: [], dataQualityPct: 96 }),
  ]));
  const row = motion(meeting, "NEAR");
  ok("motion exists", Boolean(row));
  ok("Sofia separates ownership quality from timing", gate(row, "INVESTMENT")?.status === "PASS", gate(row, "INVESTMENT")?.status);
  ok("Miriam marks 64/65 with no hard block CONDITIONAL", gate(row, "RISK")?.status === "CONDITIONAL", gate(row, "RISK")?.status);
  ok("James returns a conditional wait, not executable approval", gate(row, "CIO")?.status === "CONDITIONAL", gate(row, "CIO")?.status);
  ok("conditional motion remains DEFERRED", row?.outcome === "DEFERRED", row?.outcome);
  ok("conditional motion cannot retain a veto object", row?.veto == null, JSON.stringify(row?.veto));
  ok("trigger is explicit", /WAIT FOR TRIGGER/i.test(row?.outcomeReason ?? ""), row?.outcomeReason);
  const text = JSON.stringify(row);
  ok("new idea language no longer says HOLDINGS gate", !/HOLDINGS GATE/i.test(text), text.match(/HOLDINGS[^\"]*/i)?.[0] ?? "");
}

console.log("\nRound 2 — true hard block must remain a VETO");
{
  const meeting = runCommitteeMeeting(input([
    idea("BLOCK", { total: 64, signal: "REJECT", hardBlocks: ["Price below 200-day trend"], dataQualityPct: 96 }),
  ]));
  const row = motion(meeting, "BLOCK");
  ok("motion exists", Boolean(row));
  ok("Miriam preserves a true VETO", gate(row, "RISK")?.status === "VETO", gate(row, "RISK")?.status);
  ok("James does not overrule upstream veto", gate(row, "CIO")?.status === "DEFER", gate(row, "CIO")?.status);
  ok("hard-blocked buy is not carried", row?.outcome !== "CARRIED", row?.outcome);
  ok("no BUY blotter line is created", !meeting.blotter.some((line) => line.ticker === "BLOCK" && line.side === "BUY"));
}

console.log("\nRound 3 — fully cleared idea should produce a complete decision package");
{
  const meeting = runCommitteeMeeting(input([
    idea("PASS", { total: 74, signal: "BUY", hardBlocks: [], dataQualityPct: 97 }),
  ]));
  const row = motion(meeting, "PASS");
  ok("motion exists", Boolean(row));
  ok("Sofia passes ownership underwriting", gate(row, "INVESTMENT")?.status === "PASS", gate(row, "INVESTMENT")?.status);
  ok("Lena passes funded allocation", gate(row, "ASSET_MANAGEMENT")?.status === "PASS", gate(row, "ASSET_MANAGEMENT")?.status);
  ok("Miriam passes clean technical/risk evidence", gate(row, "RISK")?.status === "PASS", gate(row, "RISK")?.status);
  ok("authority summary is present", meeting.authorityV22?.version === "22.0", meeting.authorityV22?.version);
  ok("all four upgraded authority roles are exposed", meeting.authorityV22?.authorities?.length === 4, String(meeting.authorityV22?.authorities?.length));
  ok("final plan is never blank", Object.values(meeting.authorityV22?.finalPlan ?? {}).some((rows) => Array.isArray(rows) && rows.length > 0));
  ok("meeting minutes carry V22 decision intelligence", meeting.minutes.some((line) => /Decision Authority V22/i.test(line)));
}

console.log(`\nDecision Authority V22 simulation: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
