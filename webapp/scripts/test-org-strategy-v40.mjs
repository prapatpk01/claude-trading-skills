import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, ".test-build-org-v40");
fs.rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["tsc", "lib/strategy/organizationStrategyV40.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
const mod = await import(path.join(out, "organizationStrategyV40.js"));

assert.equal(mod.FORWARD_BET_DOCTRINE_V40.operatingSequence.join("→"), "ANTICIPATE→ACCUMULATE→CONFIRM→SCALE");
assert.equal(mod.FORWARD_BET_DOCTRINE_V40.desks.RISK.notAVeto.includes("HEADLINE_UNCERTAINTY"), true);
assert.equal(mod.FORWARD_BET_DOCTRINE_V40.desks.RISK.notAVeto.includes("MACRO_UNRESOLVED"), true);

const early = mod.smartMoneyFootprintScoreV40({
  relativeStrength3m: 12,
  return1m: 9,
  return3m: 15,
  volumeRatio: 1.7,
  institutionalScore: 78,
  lifecycleStage: "ACCUMULATION",
  aboveEma20: true,
  aboveEma50: true,
  ema20Above50: true,
});
const weak = mod.smartMoneyFootprintScoreV40({
  relativeStrength3m: -8,
  return1m: -5,
  return3m: -12,
  volumeRatio: 0.7,
  institutionalScore: 35,
  lifecycleStage: "WEAKENING",
  aboveEma20: false,
  aboveEma50: false,
  ema20Above50: false,
});
assert.ok(early > weak + 30, `expected smart-money separation, got ${early} vs ${weak}`);

const forwardWithoutHeadline = mod.forwardThesisScoreV40({
  sectorLeadershipScore: 82,
  catalystScore: null,
  fundFitScore: 78,
  growthScore: 80,
  qualityScore: 74,
  smartMoneyScore: early,
  expectedReturnPct: 18,
});
assert.ok(forwardWithoutHeadline >= 70, `forward thesis should work without published catalyst; got ${forwardWithoutHeadline}`);
assert.equal(mod.anticipatorySizingV40({ convictionScore: 68, smartMoneyScore: 66 }), "STARTER");
assert.equal(mod.anticipatorySizingV40({ convictionScore: 88, smartMoneyScore: 80 }), "SCALE");
assert.equal(mod.anticipatorySizingV40({ convictionScore: 88, smartMoneyScore: 80, thesisInvalidated: true }), "NO_RISK");

console.log(`Organization Strategy V40 PASS · smart money ${early} vs ${weak} · forward-no-headline ${forwardWithoutHeadline}`);
fs.rmSync(out, { recursive: true, force: true });
