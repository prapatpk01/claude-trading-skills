import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-inv-research-v39.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const {
  buildMomentumDiscoveryRowV39,
  buildThesisDiscoveryRowV39,
  isCommitteeReadyV39,
  mergeDiscoveryRowsV39,
} = require_(path.resolve(outDir, "dualDiscoveryPolicyV39.js"));

let passed = 0;
let failed = 0;
function ok(name, condition, detail = "") {
  if (condition) { passed += 1; console.log(`  ✓ ${name}`); }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const strongSeed = {
  ticker: "MOMO",
  score: 82,
  stage: "EARLY_MARKUP",
  price: 100,
  return1w: 5,
  return1m: 12,
  return3m: 26,
  rs3m: 14,
  volumeRatio: 1.35,
  aboveEma20: true,
  aboveEma50: true,
  ema20Above50: true,
};
const deep = {
  ticker: "MOMO",
  name: "Momentum Co",
  sector: "Technology",
  price: 100,
  targetPrice: null,
  expectedReturnPct: null,
  momentum: 84,
  institutional: 78,
  growth: 70,
  quality: 68,
  composite: 74,
  passed: false,
  valuationReady: false,
  lifecycle: { stage: "EARLY_MARKUP", score: 82, entryEligible: true },
  failedGates: ["Valuation unavailable"],
  thesis: "Momentum is accelerating before full valuation is ready.",
  dataQuality: "MEDIUM",
};

console.log("\nV39 Momentum Hunt — discovery is not blocked by valuation");
{
  const row = buildMomentumDiscoveryRowV39({ seed: strongSeed, candidate: deep, coverageReady: true });
  ok("strong measured momentum remains visible", row.state === "RESEARCH_READY", row.state);
  ok("strong candidate gets a meaningful discovery score", row.score >= 65, String(row.score));
  ok("missing valuation does not create Committee Ready", row.committeeReady === false);
  ok("momentum evidence keeps RS and volume", row.rs3m === 14 && row.volumeRatio === 1.35);
}

console.log("\nV39 Thesis Hunt — sector + catalyst can surface a research lead");
{
  const candidate = { ...deep, ticker: "THES", name: "Thesis Co", passed: false, valuationReady: false, momentum: 72, growth: 82, quality: 78, composite: 80 };
  const sector = { sector: "Technology", score: 82, status: "LEADING", rank: 1, relative1m: 5, relative3m: 12 };
  const evidence = {
    thesis: { base: "AI data-center demand supports multi-quarter earnings acceleration.", whyNow: "Orders and capacity are inflecting now.", invalidation: "Demand or backlog breaks." },
    catalyst: { score: 86, quality: "MEASURED", note: "Measured AI infrastructure catalyst." },
    fundFit: { score: 79, hardBlocks: [] },
    structure: { score: 72 },
  };
  const row = buildThesisDiscoveryRowV39({ candidate, sector, evidence, coverageReady: true });
  ok("strong thesis is surfaced even before strict factor pass", row.state === "RESEARCH_READY", row.state);
  ok("theme is inferred from thesis evidence", row.theme === "AI Infrastructure", String(row.theme));
  ok("thesis score is high when sector/catalyst/fund fit align", row.score >= 70, String(row.score));
  ok("strict committee gate remains false", row.committeeReady === false);
}

console.log("\nV39 Authorization — strict gate still protects capital");
{
  const ready = {
    ...deep,
    passed: true,
    valuationReady: true,
    expectedReturnPct: 16,
    lifecycle: { stage: "EARLY_MARKUP", score: 82, entryEligible: true },
  };
  const evidence = { fundFit: { score: 80, hardBlocks: [] } };
  ok("fully underwritten primary lifecycle can become Committee Ready", isCommitteeReadyV39(ready, evidence) === true);
  ok("hard block vetoes Committee Ready", isCommitteeReadyV39(ready, { fundFit: { score: 80, hardBlocks: ["THESIS_BROKEN"] } }) === false);
}

console.log("\nV39 Combined Ideas — Momentum + Thesis agreement is preserved");
{
  const momentum = buildMomentumDiscoveryRowV39({ seed: strongSeed, candidate: deep, coverageReady: true });
  const thesis = buildThesisDiscoveryRowV39({
    candidate: { ...deep, ticker: "MOMO", growth: 80, quality: 76 },
    sector: { sector: "Technology", score: 80, status: "LEADING", rank: 1 },
    evidence: {
      thesis: { base: "AI infrastructure demand is accelerating.", whyNow: "Momentum and orders align.", invalidation: "Sector leadership breaks." },
      catalyst: { score: 82, quality: "MEASURED", note: "Measured catalyst." },
      fundFit: { score: 76, hardBlocks: [] },
      structure: { score: 75 },
    },
    coverageReady: true,
  });
  const combined = mergeDiscoveryRowsV39([momentum], [thesis], 10);
  ok("same ticker appears once in combined ideas", combined.length === 1, String(combined.length));
  ok("combined idea records both discovery lanes", combined[0].lanes.includes("MOMENTUM") && combined[0].lanes.includes("THESIS"), combined[0].lanes.join(","));
}

console.log(`\nINV Research V39 simulation: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
