import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const out = path.join(root, ".test-build-org-v40");
fs.rmSync(out, { recursive: true, force: true });
execFileSync("npx", ["tsc", "lib/strategy/organizationStrategyV40.ts", "lib/research/buyAlertTechnicalV40.ts", "--outDir", out, "--module", "commonjs", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
const mod = await import(path.join(out, "strategy", "organizationStrategyV40.js"));
const technicalMod = await import(path.join(out, "research", "buyAlertTechnicalV40.js"));

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

const nowMs = Date.parse("2026-09-03T16:00:00Z");
const confirmed = mod.technicalBuyGateV40({
  nowMs,
  asOf: "2026-09-03T15:00:00Z",
  ema8: 108,
  ema13: 105,
  ema100: 102,
  ema200: 96,
  adx: 24,
  macd: 1.4,
  macdSignal: 1.1,
  macdHistogram: 0.3,
});
assert.equal(confirmed.eligible, true);

const stale = mod.technicalBuyGateV40({
  ...confirmed,
  nowMs,
  asOf: "2026-08-20T15:00:00Z",
  ema8: 108,
  ema13: 105,
  ema100: 102,
  ema200: 96,
  adx: 24,
  macd: 1.4,
  macdSignal: 1.1,
  macdHistogram: 0.3,
});
assert.equal(stale.eligible, false);
assert.equal(stale.freshness, "STALE");

const missing = mod.technicalBuyGateV40({ nowMs, asOf: "2026-09-03T15:00:00Z" });
assert.equal(missing.eligible, false);
assert.match(missing.reasons.join(" "), /fields missing/);

const weakTrend = mod.technicalBuyGateV40({
  nowMs,
  asOf: "2026-09-03T15:00:00Z",
  ema8: 104,
  ema13: 105,
  ema100: 94,
  ema200: 96,
  adx: 16,
  macd: 0.8,
  macdSignal: 1.1,
  macdHistogram: -0.3,
});
assert.equal(weakTrend.eligible, false);

const closes = Array.from({ length: 240 }, (_, index) => 100 + index * 0.05 + index * index * 0.003);
const snapshot = technicalMod.technicalSnapshotFromSeriesV40({
  closes,
  highs: closes.map(value => value + 1),
  lows: closes.map(value => value - 1),
  timestamps: closes.map((_, index) => nowMs - (239 - index) * 86_400_000),
});
assert.ok(snapshot.ema8 > snapshot.ema13);
assert.ok(snapshot.ema100 > snapshot.ema200);
assert.ok(snapshot.adx >= 20);
assert.ok(snapshot.macd > snapshot.macdSignal);
assert.ok(snapshot.macdHistogram > 0);
assert.equal(mod.technicalBuyGateV40({ ...snapshot, nowMs }).eligible, true);

console.log(`Organization Strategy V40 PASS · smart money ${early} vs ${weak} · forward-no-headline ${forwardWithoutHeadline}`);
fs.rmSync(out, { recursive: true, force: true });
