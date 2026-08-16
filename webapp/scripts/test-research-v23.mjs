import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-research-v23.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { classifyMomentumLifecycle } = require_(path.resolve(outDir, "momentumLifecycle.js"));

let passed = 0, failed = 0;
function ok(name, condition, detail = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\nResearch OS V23 · Active Momentum Lifecycle");

const accumulation = classifyMomentumLifecycle({
  momentum: 58, institutional: 74, rs30: 1.01, volumeRatio: 1.18, upDownVolume: 1.35,
  return1m: 2, return3m: 6, aboveEma20: true, maFanning: false, valuationGapPct: 18,
});
ok("round 1: accumulation is a preferred discovery stage", accumulation.stage === "ACCUMULATION" && accumulation.preferredEntry, accumulation.stage);

const early = classifyMomentumLifecycle({
  momentum: 68, institutional: 70, rs30: 1.08, volumeRatio: 1.22, upDownVolume: 1.5,
  return1m: 5, return3m: 12, aboveEma20: true, maFanning: true, valuationGapPct: 16,
});
ok("round 2: early markup is buy-research eligible", early.stage === "EARLY_MARKUP" && early.preferredEntry, early.stage);

const expansion = classifyMomentumLifecycle({
  momentum: 82, institutional: 79, rs30: 1.14, volumeRatio: 1.35, upDownVolume: 1.7,
  return1m: 10, return3m: 24, aboveEma20: true, maFanning: true, valuationGapPct: 14,
});
ok("round 3: healthy momentum expansion can still participate", expansion.stage === "MOMENTUM_EXPANSION" && expansion.preferredEntry, expansion.stage);

const fullValue = classifyMomentumLifecycle({
  momentum: 81, institutional: 76, rs30: 1.10, volumeRatio: 1.15, upDownVolume: 1.4,
  return1m: 9, return3m: 25, aboveEma20: true, maFanning: true, valuationGapPct: 3,
});
ok("near fair value becomes mature even with strong momentum", fullValue.stage === "MATURE" && !fullValue.preferredEntry && fullValue.nearFairValue, fullValue.stage);

const weak = classifyMomentumLifecycle({
  momentum: 46, institutional: 51, rs30: .92, volumeRatio: .8, upDownVolume: .72,
  return1m: -8, return3m: -11, aboveEma20: false, maFanning: false, valuationGapPct: 22,
});
ok("weakening momentum is not a new-entry stage", weak.stage === "WEAKENING" && !weak.preferredEntry && weak.weakening, weak.stage);

const partial = classifyMomentumLifecycle({
  momentum: 69, institutional: 68, rs30: null, volumeRatio: null, upDownVolume: null,
  return1m: null, return3m: null, aboveEma20: null, maFanning: null, valuationGapPct: 12,
});
ok("downstream aggregate evidence still produces a lifecycle read", partial.stage === "EARLY_MARKUP", partial.stage);

console.log(`\n${passed} passed · ${failed} failed`);
if (failed) process.exit(1);
