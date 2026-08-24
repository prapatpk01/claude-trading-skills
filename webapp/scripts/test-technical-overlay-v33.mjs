import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const overlayPath = path.join(process.cwd(), buildDir, "portfolioTechnicalOverlay.js");
const sentinelPath = path.join(process.cwd(), buildDir, "research", "sentinelX562.js");
const mcdxPath = path.join(process.cwd(), buildDir, "research", "mcdxV33.js");
const { computePortfolioTechnicalOverlay } = await import(pathToFileURL(overlayPath).href);
const { computeSentinelX562 } = await import(pathToFileURL(sentinelPath).href);
const { computeMcdxV33 } = await import(pathToFileURL(mcdxPath).href);

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

const bullSentinel = computeSentinelX562(bullRows);
assert.ok(bullSentinel);
assert.equal(bullSentinel.version, "5.6.2");
assert.ok(bullSentinel.score >= 0 && bullSentinel.score <= 100);
assert.ok(bullSentinel.momentumStrength >= 0 && bullSentinel.momentumStrength <= 100);
assert.ok(["ABOVE_SMA", "BELOW_SMA", "AT_SMA"].includes(bullSentinel.rsiState));

const mcdx = computeMcdxV33(bullRows);
assert.ok(mcdx);
assert.equal(mcdx.version, "3.3");
assert.equal(mcdx.methodology, "PRICE_VOLUME_PROXY");
assert.ok(["BULL_SPONSORED", "BEAR_SPONSORED", "NONE"].includes(mcdx.sponsor));
assert.ok(["BUY_PRESSURE", "SELL_PRESSURE", "MIXED"].includes(mcdx.flowSignal));
assert.match(mcdx.reason, /PRICE_VOLUME_PROXY only/);

for (const rows of [bullRows, bearRows]) {
  const overlay = computePortfolioTechnicalOverlay(rows);
  assert.ok(overlay, "V34 overlay remains available for complete market history");
  assert.equal(overlay.sentinel.version, "5.6.2");
  assert.equal(overlay.mcdx.version, "3.3");
  assert.equal(overlay.policy.version, "34.0");
  assert.equal(overlay.policy.unifiedDecision, true);
  assert.equal(overlay.policy.mcdxMethodology, "PRICE_VOLUME_PROXY");
  assert.equal(overlay.policy.requiresFundamentalExitGate, true);
  assert.equal(overlay.decision.version, "34.0");
  assert.ok(["ADD", "HOLD", "PROFIT WATCH", "TRIM REVIEW", "EXIT REVIEW"].includes(overlay.action));
  assert.equal(overlay.action, overlay.decision.action);
  assert.ok(["GOOD ROOM", "NORMAL ROOM", "EXTENDED", "TARGET ZONE", "UNKNOWN"].includes(overlay.decision.location));
  assert.notEqual(overlay.action, "EXIT");
  assert.ok(Number.isFinite(overlay.sentinel.direction));
  assert.ok(Number.isFinite(overlay.sentinel.momentumStrength));
  assert.ok(Number.isFinite(overlay.mcdx.longScore));
}

assert.equal(computePortfolioTechnicalOverlay(candles(120, .2)), null, "V34 never invents a complete decision from insufficient history");
console.log("Technical Overlay V33/V34 regression passed");
