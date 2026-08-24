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
    return {
      date: tradingDate,
      open,
      high: Math.max(open, price) + .65,
      low: Math.min(open, price) - .65,
      close: price,
      volume,
    };
  });
}

const bullRows = candles(340, .28, 1.35);
const bearRows = candles(340, -.18, .78);

const bullSentinel = computeSentinelX562(bullRows);
assert.ok(bullSentinel, "Sentinel X 5.6.2 produces a decision snapshot with sufficient history");
assert.equal(bullSentinel.version, "5.6.2");
assert.ok(bullSentinel.score >= 0 && bullSentinel.score <= 100);
assert.ok(bullSentinel.momentumStrength >= 0 && bullSentinel.momentumStrength <= 100);
assert.ok(bullSentinel.rsi >= 0 && bullSentinel.rsi <= 100);
assert.ok(["ABOVE_SMA", "BELOW_SMA", "AT_SMA"].includes(bullSentinel.rsiState));
assert.ok(["HH/HL", "BULLISH", "MIXED", "BEARISH", "LH/LL"].includes(bullSentinel.structure));
assert.ok(["BREAKOUT", "TREND", "RANGE", "TRANSITION", "BALANCED"].includes(bullSentinel.regime));
assert.match(bullSentinel.reason, /Sentinel X v5\.6\.2/);

const mcdx = computeMcdxV33(bullRows);
assert.ok(mcdx, "MCDX v3.3 produces a sponsored-flow proxy snapshot");
assert.equal(mcdx.version, "3.3");
assert.equal(mcdx.methodology, "PRICE_VOLUME_PROXY");
assert.ok(mcdx.smartMoneyProxy >= 0 && mcdx.smartMoneyProxy <= 100);
assert.ok(mcdx.smartFlow >= 0 && mcdx.smartFlow <= 100);
assert.ok(mcdx.contextScore >= 0 && mcdx.contextScore <= 100);
assert.ok(["BULL_SPONSORED", "BEAR_SPONSORED", "NONE"].includes(mcdx.sponsor));
assert.ok(["BUY_PRESSURE", "SELL_PRESSURE", "MIXED"].includes(mcdx.flowSignal));
assert.match(mcdx.reason, /PRICE_VOLUME_PROXY only/);
assert.doesNotMatch(mcdx.reason, /ownership evidence confirmed/i, "synthetic flow must never be represented as ownership evidence");

for (const rows of [bullRows, bearRows]) {
  const overlay = computePortfolioTechnicalOverlay(rows);
  assert.ok(overlay, "V33 overlay remains available for complete market history");
  assert.equal(overlay.sentinel.version, "5.6.2");
  assert.equal(overlay.mcdx.version, "3.3");
  assert.equal(overlay.mcdx.methodology, "PRICE_VOLUME_PROXY");
  assert.equal(overlay.policy.sentinelVersion, "5.6.2");
  assert.equal(overlay.policy.mcdxVersion, "3.3");
  assert.equal(overlay.policy.mcdxMethodology, "PRICE_VOLUME_PROXY");
  assert.equal(overlay.policy.syntheticFlowProxy, true);
  assert.equal(overlay.policy.requiresFundamentalExitGate, true);
  assert.ok(["ADD", "HOLD", "TRIM", "EXIT REVIEW"].includes(overlay.action));
  assert.notEqual(overlay.action, "EXIT");
  assert.ok(Number.isFinite(overlay.sentinel.direction));
  assert.ok(Number.isFinite(overlay.sentinel.energy));
  assert.ok(Number.isFinite(overlay.sentinel.fastImpulse));
  assert.ok(Number.isFinite(overlay.sentinel.momentumStrength));
  assert.ok(Number.isFinite(overlay.mcdx.longScore));
  assert.ok(Number.isFinite(overlay.mcdx.shortScore));
}

assert.equal(computePortfolioTechnicalOverlay(candles(120, .2)), null, "V33 does not infer a complete technical decision from insufficient history");
console.log("Technical Overlay V33 regression passed");
