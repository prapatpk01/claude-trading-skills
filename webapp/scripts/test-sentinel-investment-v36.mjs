// Sentinel Investment V36 deterministic regression suite.
// Covers the new-idea score, rising-momentum starter path and true-risk veto.

import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-sentinel-investment-v36.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { scoreNewIdeaV36, buildSentinelMarketScoreV36 } = require_(path.resolve(outDir, "team/sentinelInvestmentV36.js"));
const { runCommitteeMeeting } = require_(path.resolve(outDir, "team/committee.js"));

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

function candles({ start = 100, drift = 0.004, volume = 2_000_000, count = 260 } = {}) {
  const rows = [];
  let close = start;
  for (let i = 0; i < count; i += 1) {
    // Mild cyclical pullbacks keep indicators realistic while the long trend rises.
    const pulse = Math.sin(i / 7) * 0.003 + Math.sin(i / 19) * 0.002;
    close *= 1 + drift + pulse;
    const open = close * (1 - 0.002);
    rows.push({
      date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
      open,
      high: close * 1.008,
      low: close * 0.992,
      close,
      volume: Math.round(volume * (1 + Math.max(0, i - count + 15) / 30)),
    });
  }
  return rows;
}

const spy = candles({ drift: 0.0015 });
const leader = candles({ drift: 0.0035 });
const market = buildSentinelMarketScoreV36({
  regime: { score: 72, tapeScore: 75, regime: "Risk-On" },
  sentiment: { value: 67, coveragePct: 100, band: "Greed" },
});

console.log("\nV36 Score — architecture and momentum-rising behavior");
{
  const score = scoreNewIdeaV36({
    candles: leader,
    benchmark: spy,
    market,
    ownership: { researchConviction: 78, upsidePct: 15, evidencePct: 92 },
  });
  ok("score exposes all seven pillars", score.pillars.length === 7, String(score.pillars.length));
  ok("momentum acceleration has 25-point weight", score.pillars.find(row => row.key === "acceleration")?.max === 25);
  ok("relative strength has 20-point weight", score.pillars.find(row => row.key === "relativeStrength")?.max === 20);
  ok("no high-beta pillar exists", !score.pillars.some(row => /beta/i.test(row.label)));
  ok("conviction uses separate market/momentum/ownership/entry scores", [score.marketScore, score.momentumScore, score.ownershipScore, score.entryScore].every(Number.isFinite));
  const expected = Math.round(score.marketScore * .25 + score.momentumScore * .45 + score.ownershipScore * .20 + score.entryScore * .10);
  ok("conviction weighting is 25/45/20/10", score.convictionScore === expected, `${score.convictionScore} vs ${expected}`);
  ok("old ADX_LOW hard veto is absent", !score.hardBlockCodes.includes("ADX_LOW"), score.hardBlockCodes.join(","));
  ok("new idea never emits HOLDINGS gate language", !/HOLDINGS GATE/i.test(JSON.stringify(score)));
}

console.log("\nV36 Score — crisis is a true hard block");
{
  const crisis = buildSentinelMarketScoreV36({ regime: { score: 12, tapeScore: 18, regime: "Crisis" }, sentiment: { value: 20 } });
  const score = scoreNewIdeaV36({ candles: leader, benchmark: spy, market: crisis, ownership: { researchConviction: 90, upsidePct: 25, evidencePct: 95 } });
  ok("crisis action is BLOCKED", score.action === "BLOCKED", score.action);
  ok("crisis block is named", score.hardBlockCodes.includes("CRISIS_REGIME"), score.hardBlockCodes.join(","));
}

const NAV = 200_000;
const regime = {
  score: 72,
  regime: "Risk-On",
  icon: "🟢",
  cashMinPct: 10,
  deployRule: "Deploy into leadership with regime-aware sizing.",
  components: [],
  realizedVol: 13,
  note: "Constructive tape.",
};
const basePosition = {
  ticker: "AAA",
  shares: 100,
  avgCost: 80,
  price: 100,
  marketValue: 10_000,
  weightPct: 5,
  isReserve: false,
  sleeve: "Growth/Momentum",
  pnlPct: 25,
  zone: { zone: "BASE", icon: "🟢", weightPct: 5, action: "Within policy", trimToTarget: null },
  momentum: { total: 70, signal: "BUY", hardBlocks: [], dataQualityPct: 95 },
  valuation: { verdict: "FAIR", deviationPct: 8, confidence: "high" },
  trend: { aboveSma50: true, aboveSma200: true, return1m: 4, return3m: 12 },
  liquidity: { sessionsToExit: 0.2 },
  priceAsOf: "2026-08-27",
  yieldPct: 0.5,
  recentTrade: null,
};

function idea(ticker, technical) {
  return {
    ticker,
    rating: "BUY",
    conviction: technical.sizingConviction ?? 75,
    source: "Sentinel V36 simulation",
    price: 100,
    target: 122,
    upsidePct: 22,
    submittedAt: "2026-08-27",
    note: "Measured ownership case with a live momentum-rising setup.",
    alreadyHeld: false,
    sleeve: "Growth/Momentum",
    ageDays: 0,
    referencePrice: 100,
    priceDriftPct: 0,
    dataQuality: "95% measured",
    technical,
    recentTrade: null,
  };
}

function input(ideas, overrides = {}) {
  return {
    asOf: "2026-08-27T12:00:00.000Z",
    nav: NAV,
    cashBalance: 30_000,
    deployableCash: 18_000,
    cashBufferPct: 15,
    targetCashPct: 10,
    regime,
    positions: [basePosition],
    ideas,
    book: {
      asOf: "2026-08-27",
      nav: NAV,
      regime,
      sleeves: [
        { sleeve: "Growth/Momentum", value: 100_000, actualPct: 50, targetPct: 55, driftPct: -5, alert: false, tickers: ["AAA"] },
        { sleeve: "Income/Dividend", value: 70_000, actualPct: 35, targetPct: 35, driftPct: 0, alert: false, tickers: [] },
        { sleeve: "Cash/Defensive", value: 30_000, actualPct: 15, targetPct: 10, driftPct: 5, alert: false, tickers: [] },
      ],
      objectives: [],
      blendedYieldPct: 4.5,
      yieldRows: [],
      zones: [],
      cashPct: 0,
      cashRequiredPct: 10,
      correlations: [],
      desks: [],
      roundTable: [],
      riskRegister: [
        { raisedBy: "Lena Müller", role: "AM", severity: "high", item: "Growth/Momentum sleeve off target", evidence: "legacy static target", suggestedAction: "rebalance" },
        { raisedBy: "Daniel Cho", role: "Macro", severity: "high", item: "Cash below the regime floor", evidence: "legacy Holdings-only cash read", suggestedAction: "raise cash" },
      ],
      actions: [],
      disclosures: [],
    },
    track: { completed: 30, winRatePct: 60, averageReturnPct: 8.5 },
    unavailable: [],
    replacements: {},
    portfolioRevision: "SIM-V36",
    ...overrides,
  };
}

function gate(row, stage) { return row?.decisionGates?.find(g => g.stage === stage); }
function motion(meeting, ticker) { return meeting.motions.find(row => row.ticker === ticker); }

console.log("\nV36 Committee — starter buy and portfolio-policy normalization");
{
  const technical = {
    total: 68,
    convictionScore: 68,
    momentumScore: 63,
    marketScore: 72,
    ownershipScore: 74,
    entryScore: 7,
    signal: "STARTER BUY",
    action: "STARTER BUY",
    momentumState: "RISING",
    rising: true,
    hardBlocks: [],
    softBlocks: ["ADX_DEVELOPING: ADX is rising but not mature"],
    dataQualityPct: 95,
    sizingMultiplier: .5,
    sizingConviction: 50,
  };
  const meeting = runCommitteeMeeting(input([idea("START", technical)]));
  const row = motion(meeting, "START");
  ok("starter motion exists", Boolean(row));
  ok("soft block is not a CRO veto", gate(row, "RISK")?.status === "PASS", gate(row, "RISK")?.status);
  ok("starter motion can carry", row?.outcome === "CARRIED", row?.outcomeReason);
  ok("V36 authority summary is present", meeting.authorityV36?.version === "36.0", meeting.authorityV36?.version);
  ok("CIO labels starter path", meeting.authorityV36?.finalPlan?.starterBuy?.includes("START"));
  ok("legacy sleeve drift was downgraded", !meeting.riskRegister.some(r => r.severity === "high" && /sleeve off target/i.test(r.item)));
  ok("legacy holdings-only cash warning was removed", !meeting.riskRegister.some(r => /cash below the regime floor/i.test(r.item)));
  ok("authoritative 15% buffer vs 10% floor creates no cash blocker", !meeting.riskRegister.some(r => r.severity === "high" && /liquidity buffer below/i.test(r.item)));
}

console.log("\nV36 Committee — true hard block remains non-executable");
{
  const technical = {
    total: 82,
    convictionScore: 82,
    momentumScore: 85,
    marketScore: 80,
    ownershipScore: 82,
    entryScore: 9,
    signal: "BLOCKED",
    action: "BLOCKED",
    momentumState: "RISING",
    rising: true,
    hardBlocks: ["STRUCTURE_BREAKDOWN: price below SMA200 and EMA20 below EMA50"],
    softBlocks: [],
    dataQualityPct: 98,
    sizingMultiplier: 0,
    sizingConviction: 82,
  };
  const meeting = runCommitteeMeeting(input([idea("BLOCK", technical)]));
  const row = motion(meeting, "BLOCK");
  ok("hard block is a VETO at the risk gate", gate(row, "RISK")?.status === "VETO", gate(row, "RISK")?.status);
  ok("hard-blocked buy is not carried", row?.outcome !== "CARRIED", row?.outcome);
  ok("hard-blocked name never reaches BUY blotter", !meeting.blotter.some(line => line.ticker === "BLOCK" && line.side === "BUY"));
}

console.log(`\nSentinel Investment V36 simulation: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
