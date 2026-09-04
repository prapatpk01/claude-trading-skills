// Filename retained so the existing CI command does not need to change.
// Coverage is Sentinel X v6.4 + MCDX Sentinel v4.0 + Unified Technical V40.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const overlayPath = path.join(process.cwd(), buildDir, "portfolioTechnicalOverlay.js");
const sentinelPath = path.join(process.cwd(), buildDir, "research", "sentinelX64.js");
const mcdxPath = path.join(process.cwd(), buildDir, "research", "mcdxV40.js");
const { computePortfolioTechnicalOverlay } = await import(pathToFileURL(overlayPath).href);
const { computeSentinelX64 } = await import(pathToFileURL(sentinelPath).href);
const { computeMcdxV40 } = await import(pathToFileURL(mcdxPath).href);

function candles(count, drift, volumeBias = 1) {
  let price = 80;
  const date = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: count }, (_, index) => {
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    const tradingDate = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
    const wave = Math.sin(index / 8) * .45;
    const open = price;
    price = Math.max(8, price + drift + wave * .12);
    const up = price >= open;
    const baseVolume = 700_000 + index * 1_500;
    const volume = Math.round(baseVolume * (up ? volumeBias : 1 / Math.max(1, volumeBias)));
    return { date: tradingDate, open, high: Math.max(open, price) + .65, low: Math.min(open, price) - .65, close: price, volume };
  });
}

const bullRows = candles(340, .28, 1.35);
const bearRows = candles(340, -.18, .78);

const rawMcdx = computeMcdxV40(bullRows, { mcdxLength: 50, vfiLength: 80 });
assert.ok(rawMcdx);
assert.equal(rawMcdx.version, "4.0");
assert.equal(rawMcdx.methodology, "HYBRID_PRICE_VOLUME_PROXY");
assert.ok(rawMcdx.flowPower >= -100 && rawMcdx.flowPower <= 100);
assert.ok(rawMcdx.smartFlow >= 0 && rawMcdx.smartFlow <= 100);
assert.ok(Number.isFinite(rawMcdx.flowDelta));
assert.ok(Number.isFinite(rawMcdx.flowAccel));
assert.match(rawMcdx.reason, /proxy, not verified institutional order flow/i);

const rawSentinel = computeSentinelX64(bullRows, { companionFlowPower: rawMcdx.flowPower, useCompanion: true });
assert.ok(rawSentinel);
assert.equal(rawSentinel.version, "6.4");
assert.equal(rawSentinel.companion.active, true);
assert.equal(rawSentinel.companion.volumeBoosterDisabled, true, "MCDX owns participation so Sentinel must not double-count its relative-volume booster");
assert.ok(rawSentinel.degreesOfPower >= -100 && rawSentinel.degreesOfPower <= 100);
assert.ok(rawSentinel.qualityScore >= 0 && rawSentinel.qualityScore <= 10);
assert.ok(["BULLISH", "BEARISH", "NEUTRAL"].includes(rawSentinel.forecast.direction));
assert.ok(rawSentinel.forecast.confidence >= 5 && rawSentinel.forecast.confidence <= 95);

for (const rows of [bullRows, bearRows]) {
  const overlay = computePortfolioTechnicalOverlay(rows);
  assert.ok(overlay, "V40 overlay remains available for complete market history");
  assert.equal(overlay.sentinel.version, "6.4");
  assert.equal(overlay.mcdx.version, "4.0");
  assert.equal(overlay.policy.version, "40.0");
  assert.equal(overlay.decision.version, "40.0");
  assert.equal(overlay.policy.timeframe, "WEEKLY DECISION · DAILY EXECUTION");
  assert.equal(overlay.policy.companionArchitecture, true);
  assert.equal(overlay.policy.sentinelOwnsDirection, true);
  assert.equal(overlay.policy.mcdxOwnsConviction, true);
  assert.equal(overlay.policy.volumeDoubleCountPrevented, true);
  assert.equal(overlay.policy.pulseDiagnosticsOnly, true);
  assert.equal(overlay.policy.requiresFundamentalExitGate, true);
  assert.equal(overlay.policy.syntheticFlowProxy, true);
  assert.equal(overlay.action, overlay.decision.action);
  assert.ok(["ADD", "HOLD", "PROFIT WATCH", "TRIM REVIEW", "EXIT REVIEW"].includes(overlay.action));
  assert.notEqual(overlay.action, "EXIT");
  assert.notEqual(overlay.action, "SELL");
  assert.ok(Number.isFinite(overlay.sentinel.degreesOfPower));
  assert.ok(Number.isFinite(overlay.mcdx.flowPower));
  assert.equal(overlay.sentinel.companion.active, true);
  assert.equal(overlay.sentinel.companion.volumeBoosterDisabled, true);
  assert.ok(["CONFIRM", "NEUTRAL", "OPPOSITE", "VETO", "OFF"].includes(overlay.decision.companionStatus));
}

assert.equal(computePortfolioTechnicalOverlay(candles(120, .2)), null, "V40 never invents a complete fund decision from insufficient history");
console.log("Technical Overlay V40 regression passed");
