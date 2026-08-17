import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const modulePath = path.join(process.cwd(), buildDir, "portfolioTechnicalOverlay.js");
const { computePortfolioTechnicalOverlay } = await import(pathToFileURL(modulePath).href);
const modelPath = path.join(process.cwd(), buildDir, "holdingMarketModel.js");
const { buildHoldingMarketItem, cleanMarketTicker, uniqueMarketTickers } = await import(pathToFileURL(modelPath).href);

function candles(count, drift) {
  let price = 100;
  const date = new Date(Date.UTC(2024, 0, 1));
  return Array.from({ length: count }, (_, index) => {
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
    const tradingDate = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 1);
    const wave = Math.sin(index / 7) * 0.7;
    const open = price;
    price = Math.max(5, price + drift + wave * 0.16);
    return {
      date: tradingDate,
      open,
      high: Math.max(open, price) + 1,
      low: Math.min(open, price) - 1,
      close: price,
      volume: 1_000_000 + index * (drift > 0 ? 2_000 : -1_000),
    };
  });
}

assert.equal(computePortfolioTechnicalOverlay(candles(100, 0.2)), null, "requires enough history");

for (const drift of [0.35, -0.25, 0]) {
  const result = computePortfolioTechnicalOverlay(candles(320, drift));
  assert.ok(result, "returns an overlay for a complete history");
  assert.ok(["ADD", "HOLD", "TRIM", "EXIT REVIEW"].includes(result.action));
  assert.notEqual(result.action, "EXIT", "technical data never emits an executable exit");
  assert.equal(result.policy.requiresFundamentalExitGate, true);
  assert.equal(result.policy.syntheticFlowProxy, true);
  assert.ok(result.target1 > 0);
  assert.ok(result.support1 > 0);
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
  assert.ok(result.mcdx.smartFlow >= 0 && result.mcdx.smartFlow <= 100);
}

assert.equal(cleanMarketTicker(" net "), "NET", "normalizes portfolio/watchlist ticker keys");
assert.deepEqual(uniqueMarketTickers([" net ", "NET", "rtx", "bad ticker"]), ["NET", "RTX"], "deduplicates normalized ticker keys");

const complete = buildHoldingMarketItem(candles(320, 0.25), null, "TEST HISTORY");
assert.equal(complete.dataQuality.status, "COMPLETE", "complete history populates the technical monitor");
assert.equal(complete.dataQuality.historyBars, 320);
assert.ok(complete.price > 0);
assert.ok(complete.technicalOverlay);
assert.ok(complete.chartRanges.YTD.series.length > 1);
assert.ok(complete.low52 > 0 && complete.high52 > complete.low52);

const quoteOnly = buildHoldingMarketItem([], { symbol: "IPO", price: 25, change: 0, changePercent: 0, high: 25, low: 25, open: 25, prevClose: 25, asOf: "2026-08-17" }, "QUOTE FALLBACK");
assert.equal(quoteOnly.dataQuality.status, "PARTIAL", "quote-only fallback still displays the current price");
assert.equal(quoteOnly.price, 25);
assert.equal(quoteOnly.technicalOverlay, null, "missing history never invents a technical decision");

console.log("portfolio technical overlay: all assertions passed");
