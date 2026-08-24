import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const policyPath = path.join(process.cwd(), buildDir, "research", "unifiedTechnicalDecisionV34.js");
const { buildUnifiedTechnicalDecisionV34 } = await import(pathToFileURL(policyPath).href);

const baseSentinel = {
  trend: "BULL",
  coreState: "STRONG BULL",
  momentumStrength: 58,
  structure: "BULL",
  structurePattern: "BULLISH",
  regime: "TREND",
  trigger: "NONE",
  rsiState: "ABOVE_SMA",
  fastImpulse: 18,
  hma16State: "BULL",
};
const bullFlow = { state: "NEUTRAL", sponsor: "BULL_SPONSORED", flowSignal: "BUY_PRESSURE", contextScore: 75, smartFlow: 69 };

const nearTargetStrongBull = buildUnifiedTechnicalDecisionV34({ roomAtr: .53, sentinel: baseSentinel, mcdx: bullFlow });
assert.equal(nearTargetStrongBull.location, "EXTENDED");
assert.equal(nearTargetStrongBull.action, "PROFIT WATCH", "strong bull + sponsored buy flow near target must not become an automatic trim");
assert.equal(nearTargetStrongBull.policy.roomAloneNeverForcesTrim, true);

const roomButNoFlow = buildUnifiedTechnicalDecisionV34({
  roomAtr: 2.2,
  sentinel: { ...baseSentinel, momentumStrength: 29, structurePattern: "HH/HL", trigger: "RSI_SMA_BULL_SHIFT" },
  mcdx: { state: "NEUTRAL", sponsor: "NONE", flowSignal: "MIXED", contextScore: 46, smartFlow: 55 },
});
assert.equal(roomButNoFlow.location, "GOOD ROOM");
assert.equal(roomButNoFlow.action, "HOLD", "bullish trigger with good room still waits when flow does not confirm");

const weakBearAtTargetWithSellPressure = buildUnifiedTechnicalDecisionV34({
  roomAtr: .09,
  sentinel: { ...baseSentinel, trend: "BEAR", coreState: "BEAR", momentumStrength: 2, structure: "NEUTRAL", structurePattern: "BULLISH", regime: "RANGE", trigger: "NONE", rsiState: "BELOW_SMA", fastImpulse: -8, hma16State: "BEAR" },
  mcdx: { state: "NEUTRAL", sponsor: "NONE", flowSignal: "SELL_PRESSURE", contextScore: 65, smartFlow: 33 },
});
assert.equal(weakBearAtTargetWithSellPressure.location, "TARGET ZONE");
assert.equal(weakBearAtTargetWithSellPressure.action, "TRIM REVIEW", "target-zone pressure plus confirmed sell pressure should escalate to review, not auto-sell");
assert.equal(weakBearAtTargetWithSellPressure.reduceReview, true);

const cleanAdd = buildUnifiedTechnicalDecisionV34({ roomAtr: 1.8, sentinel: { ...baseSentinel, momentumStrength: 62, trigger: "BOS_UP" }, mcdx: { state: "ACCUMULATION", sponsor: "BULL_SPONSORED", flowSignal: "BUY_PRESSURE", contextScore: 70, smartFlow: 74 } });
assert.equal(cleanAdd.action, "ADD");
assert.equal(cleanAdd.addEligible, true);

const exitReview = buildUnifiedTechnicalDecisionV34({
  roomAtr: .8,
  sentinel: { ...baseSentinel, trend: "BEAR", coreState: "STRONG BEAR", momentumStrength: 72, structure: "BEAR", structurePattern: "LH/LL", regime: "TREND", trigger: "BOS_DOWN", rsiState: "BELOW_SMA", fastImpulse: -42, hma16State: "BEAR" },
  mcdx: { state: "DISTRIBUTION", sponsor: "BEAR_SPONSORED", flowSignal: "SELL_PRESSURE", contextScore: 72, smartFlow: 30 },
});
assert.equal(exitReview.action, "EXIT REVIEW");
assert.equal(exitReview.policy.exitRequiresFundamentalGate, true);

console.log("Unified Technical Decision V34 regression passed");
