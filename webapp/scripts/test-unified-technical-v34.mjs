// Filename retained for existing CI wiring; this now validates Unified Technical V40.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const policyPath = path.join(process.cwd(), buildDir, "research", "unifiedTechnicalDecisionV40.js");
const { buildUnifiedTechnicalDecisionV40 } = await import(pathToFileURL(policyPath).href);

const sentinel = (side, overrides = {}) => ({
  trend: side,
  trendLabel: side === "BULL" ? "STRONG BULL" : side === "BEAR" ? "STRONG BEAR" : "NEUTRAL",
  structureBias: side,
  structure: side === "BULL" ? "HH/HL" : side === "BEAR" ? "LH/LL" : "MIXED",
  setup: side === "BULL" ? "PB" : side === "BEAR" ? "REV" : "NONE",
  setupState: side === "NEUTRAL" ? "WAIT" : "READY",
  trigger: side === "BULL" ? "BOS_UP" : side === "BEAR" ? "BOS_DOWN" : "NONE",
  degreesOfPower: side === "BULL" ? 70 : side === "BEAR" ? -70 : 0,
  qualityScore: 8,
  regime: "TREND",
  longScore: side === "BULL" ? 8.4 : 3,
  shortScore: side === "BEAR" ? 8.4 : 3,
  forecast: { direction: side === "BULL" ? "BULLISH" : side === "BEAR" ? "BEARISH" : "NEUTRAL", valid: side !== "NEUTRAL", confidence: 78 },
  ...overrides,
});

const flow = (power, delta = power >= 0 ? 5 : -5, overrides = {}) => ({
  flowPower: power,
  flowDelta: delta,
  flowState: power >= 45 ? "STRONG_ACCUMULATION" : power <= -45 ? "STRONG_DISTRIBUTION" : "NEUTRAL",
  liquidity: { bearAbsorption: false, bullAbsorption: false },
  ...overrides,
});

const cleanAdd = buildUnifiedTechnicalDecisionV40({
  roomAtr: 1.8,
  weeklySentinel: sentinel("BULL"),
  dailySentinel: sentinel("BULL"),
  weeklyMcdx: flow(52, 6),
  dailyMcdx: flow(39, 5),
});
assert.equal(cleanAdd.direction, "BULL");
assert.equal(cleanAdd.companionStatus, "CONFIRM");
assert.equal(cleanAdd.action, "ADD");
assert.equal(cleanAdd.addEligible, true);
assert.equal(cleanAdd.policy.sentinelOwnsDirection, true);
assert.equal(cleanAdd.policy.mcdxOwnsConviction, true);
assert.equal(cleanAdd.policy.mcdxNeverCreatesDirection, true);
assert.equal(cleanAdd.policy.volumeDoubleCountPrevented, true);

const vetoLong = buildUnifiedTechnicalDecisionV40({
  roomAtr: 1.8,
  weeklySentinel: sentinel("BULL"),
  dailySentinel: sentinel("BULL"),
  weeklyMcdx: flow(-58, -6),
  dailyMcdx: flow(-62, -8),
});
assert.equal(vetoLong.direction, "BULL", "MCDX opposite flow cannot reverse Sentinel price direction");
assert.equal(vetoLong.companionStatus, "VETO");
assert.equal(vetoLong.action, "HOLD", "strong opposite flow blocks new ADD conviction but is not an automatic sell");

const mcdxCannotCreateBull = buildUnifiedTechnicalDecisionV40({
  roomAtr: 2.0,
  weeklySentinel: sentinel("BEAR"),
  dailySentinel: sentinel("BEAR"),
  weeklyMcdx: flow(70, 8),
  dailyMcdx: flow(65, 6),
});
assert.equal(mcdxCannotCreateBull.direction, "BEAR");
assert.notEqual(mcdxCannotCreateBull.action, "ADD", "bullish MCDX never overrides bearish Sentinel into ADD");

const exitReview = buildUnifiedTechnicalDecisionV40({
  roomAtr: .8,
  weeklySentinel: sentinel("BEAR", { qualityScore: 9 }),
  dailySentinel: sentinel("BEAR", { qualityScore: 8 }),
  weeklyMcdx: flow(-64, -9, { flowState: "STRONG_DISTRIBUTION" }),
  dailyMcdx: flow(-58, -8, { flowState: "DISTRIBUTION", liquidity: { bearAbsorption: true, bullAbsorption: false } }),
});
assert.equal(exitReview.action, "EXIT REVIEW");
assert.equal(exitReview.reduceReview, true);
assert.equal(exitReview.policy.exitRequiresFundamentalGate, true);
assert.equal(exitReview.policy.automaticTrading, false);

const nearTargetStrongBull = buildUnifiedTechnicalDecisionV40({
  roomAtr: .53,
  weeklySentinel: sentinel("BULL"),
  dailySentinel: sentinel("BULL"),
  weeklyMcdx: flow(42, 3),
  dailyMcdx: flow(30, 2),
});
assert.equal(nearTargetStrongBull.location, "EXTENDED");
assert.equal(nearTargetStrongBull.action, "PROFIT WATCH", "location alone does not become a trim");
assert.equal(nearTargetStrongBull.policy.roomAloneNeverForcesTrim, true);

console.log("Unified Technical Decision V40 regression passed");
