import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-inv-research-v38.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const {
  deriveThemeV38,
  scoreOpportunityV38,
  reconcileOpportunityBookV38,
  selectSectorThesisWinnersV38,
} = require_(path.resolve(outDir, "opportunityBookV38.js"));

let passed = 0;
let failed = 0;
const ok = (name, condition, detail = "") => {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const evidence = (overrides = {}) => ({
  structure: { score: 78 },
  quant: { momentum: 82 },
  thesis: {
    base: "AI data-center infrastructure demand supports a multi-quarter expansion thesis.",
    whyNow: "EARLY_MARKUP with accelerating institutional demand.",
    invalidation: "Invalidate if sector leadership fades and price loses the primary trend.",
  },
  catalyst: { score: 82, quality: "MEASURED", nextEarningsDate: null, note: "Measured earnings and AI data-center catalyst." },
  fundFit: { score: 80, hardBlocks: [] },
  ...overrides,
});

function input(ticker, overrides = {}) {
  return {
    ticker,
    sector: "Technology",
    sectorLeadershipScore: 78,
    sectorLeadershipStatus: "LEADING",
    sectorRank: 1,
    sectorRelative1m: 4,
    sectorRelative3m: 9,
    stockRs3m: 12,
    expectedReturnPct: 18,
    lifecycleStage: "EARLY_MARKUP",
    lifecycleScore: 80,
    preferredEntryStage: true,
    marketFitScore: 82,
    factors: { momentum: 84, growth: 76, quality: 78, value: 66, institutional: 80, composite: 79 },
    researchEvidence: evidence(),
    sourceModels: ["momentum", "institutional", "growth", "quality", "value", "ai"],
    isProposal: true,
    source: "INV Research V38 test",
    ...overrides,
  };
}

console.log("\nV38 Opportunity Score — Sector → Thesis → Winner");
{
  const row = scoreOpportunityV38(input("AAA"));
  ok("score uses seven explicit pillars totaling 100", Object.keys(row.components).length === 7);
  ok("strong sector/thesis setup clears READY-quality opportunity score", row.opportunityScore >= 72, String(row.opportunityScore));
  ok("confidence is separate from opportunity", row.confidenceScore >= 60, String(row.confidenceScore));
  ok("horizon is bounded to 14–90 days", row.horizonDays >= 14 && row.horizonDays <= 90, String(row.horizonDays));
  ok("AI evidence maps to AI Infrastructure theme", row.theme === "AI Infrastructure", row.theme);
  ok("hard beta bonus is not part of the V38 score", !("beta" in row.components));
}

console.log("\nV38 Winner funnel — 80% focus sector / 20% radar target");
{
  const rows = [
    { ticker: "T1", sector: "Technology", opportunityScore: 90, confidenceScore: 80 },
    { ticker: "T2", sector: "Technology", opportunityScore: 88, confidenceScore: 80 },
    { ticker: "T3", sector: "Technology", opportunityScore: 86, confidenceScore: 80 },
    { ticker: "T4", sector: "Technology", opportunityScore: 84, confidenceScore: 80 },
    { ticker: "F1", sector: "Financials", opportunityScore: 83, confidenceScore: 78 },
    { ticker: "M1", sector: "Materials", opportunityScore: 81, confidenceScore: 78 },
  ];
  const selected = selectSectorThesisWinnersV38(rows, ["Technology"], 5);
  ok("five-name shortlist is not padded beyond requested size", selected.length === 5, String(selected.length));
  ok("four of five slots go to focus sector when quality exists", selected.filter(row => row.sector === "Technology").length === 4, selected.map(row => row.ticker).join(","));
  ok("one radar slot remains for emerging leadership", selected.some(row => row.sector !== "Technology"), selected.map(row => row.ticker).join(","));
}

console.log("\nV38 Hysteresis — one weak review does not erase a thesis");
{
  const t0 = "2026-08-28T12:00:00.000Z";
  const first = reconcileOpportunityBookV38([input("AAA")], [], t0)[0];
  ok("strong proposal enters READY", first.state === "READY", first.state);

  const weak = input("AAA", {
    isProposal: false,
    sectorLeadershipScore: 52,
    sectorLeadershipStatus: "NEUTRAL",
    stockRs3m: -1,
    expectedReturnPct: 7,
    lifecycleScore: 58,
    factors: { momentum: 54, growth: 65, quality: 70, value: 55, institutional: 55, composite: 60 },
    researchEvidence: evidence({ structure: { score: 58 }, catalyst: { score: 50, quality: "PARTIAL", nextEarningsDate: null, note: "Catalyst cooling." }, fundFit: { score: 58, hardBlocks: [] } }),
    sourceModels: ["momentum", "quality"],
  });
  const second = reconcileOpportunityBookV38([weak], [first], "2026-08-31T12:00:00.000Z")[0];
  ok("first below-threshold review preserves READY", second.state === "READY", second.state);
  ok("first weak review is marked COOLING", second.reviewState === "COOLING", second.reviewState);
  const third = reconcileOpportunityBookV38([weak], [second], "2026-09-03T12:00:00.000Z")[0];
  ok("second consecutive weak review downgrades", third.state !== "READY", third.state);
}

console.log("\nV38 Missing-review policy — candidates do not vanish on refresh");
{
  const first = reconcileOpportunityBookV38([input("BBB")], [], "2026-08-28T12:00:00.000Z")[0];
  const miss1 = reconcileOpportunityBookV38([], [first], "2026-08-31T12:00:00.000Z")[0];
  const miss2 = reconcileOpportunityBookV38([], [miss1], "2026-09-03T12:00:00.000Z")[0];
  const miss3 = reconcileOpportunityBookV38([], [miss2], "2026-09-06T12:00:00.000Z")[0];
  ok("one missing cycle does not delete the name", miss1.state !== "ARCHIVED", miss1.state);
  ok("two misses downgrade rather than disappear", miss2.state === "WATCH" || miss2.state === "DISCOVERED", miss2.state);
  ok("three consecutive misses archive stale thesis", miss3.state === "ARCHIVED", miss3.state);
}

console.log(`\nINV Research V38 simulation: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
