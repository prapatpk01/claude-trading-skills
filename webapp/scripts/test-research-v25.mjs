import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-research-v25.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const policy = require_(path.resolve(outDir, "lifecycleDiscoveryPolicy.js"));

let passed = 0, failed = 0;
function ok(name, condition, detail = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\nResearch OS V25 · Lifecycle-first INV underwriting");

const rows = [
  { ticker: "A", stage: "EARLY_MARKUP", score: 70, matureOk: false },
  { ticker: "B", stage: "ACCUMULATION", score: 66, matureOk: false },
  { ticker: "C", stage: "MOMENTUM_EXPANSION", score: 64, matureOk: false },
  { ticker: "M1", stage: "MATURE", score: 99, matureOk: true },
  { ticker: "M2", stage: "MATURE", score: 98, matureOk: false },
  { ticker: "W", stage: "WEAKENING", score: 100, matureOk: false },
  { ticker: "X", stage: "BROKEN", score: 100, matureOk: false },
];

const full = policy.selectLifecycleFirst(rows, {
  topN: 3,
  getStage: row => row.stage,
  getScore: row => row.score,
  matureEligible: row => row.matureOk,
});
ok("primary lifecycle fills the shortlist before any MATURE candidate", full.selected.map(row => row.ticker).join(",") === "A,B,C", full.selected.map(row => row.ticker).join(","));
ok("MATURE is not used when primary stages fill the quota", !full.fallbackUsed && full.matureFallbackSelected === 0);
ok("WEAKENING and BROKEN never enter new-capital discovery", !full.selected.some(row => ["W", "X"].includes(row.ticker)));

const shortPrimary = policy.selectLifecycleFirst(rows, {
  topN: 5,
  getStage: row => row.stage,
  getScore: row => row.score,
  matureEligible: row => row.matureOk,
});
ok("MATURE fills only the unfilled remainder", shortPrimary.selected.map(row => row.ticker).join(",") === "A,B,C,M1", shortPrimary.selected.map(row => row.ticker).join(","));
ok("stricter mature gate can reject a high-scoring MATURE name", !shortPrimary.selected.some(row => row.ticker === "M2"));
ok("fallback is explicit and countable", shortPrimary.fallbackUsed && shortPrimary.matureFallbackSelected === 1);
ok("policy advertises exactly three primary lifecycle stages", policy.LIFECYCLE_DISCOVERY_POLICY_V25.primaryStages.join(",") === "ACCUMULATION,EARLY_MARKUP,MOMENTUM_EXPANSION");
ok("policy names MATURE as fallback only", policy.LIFECYCLE_DISCOVERY_POLICY_V25.fallbackStage === "MATURE" && policy.LIFECYCLE_DISCOVERY_POLICY_V25.rule.includes("only"));

const evidenceSource = fs.readFileSync(path.resolve("lib/research/fundResearchEvidence.ts"), "utf8");
ok("MCDX is permanently labelled a synthetic price/volume proxy", evidenceSource.includes('synthetic: true') && evidenceSource.includes('evidenceType: "PRICE_VOLUME_PROXY"'));
ok("Sentinel X and MCDX cannot authorize automatic trading", evidenceSource.includes("automaticTrading: false") && evidenceSource.includes("evidence layers only"));
ok("MATURE fallback uses stricter valuation and chart controls", evidenceSource.includes(">= 12") && evidenceSource.includes('overlay?.sentinel.trend === "BULL"') && evidenceSource.includes('overlay.mcdx.state !== "DISTRIBUTION"'));

console.log(`\n${passed} passed · ${failed} failed`);
if (failed) process.exit(1);
