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
assert.ok(complete.momentumForecast, "complete market history produces a V26 probability forecast");
assert.equal(complete.momentumForecast.version, "26.0");
assert.equal(
  complete.momentumForecast.scenarios.bear.probability + complete.momentumForecast.scenarios.base.probability + complete.momentumForecast.scenarios.bull.probability,
  100,
  "Bear/Base/Bull scenario weights must sum to exactly 100%",
);
assert.ok(complete.momentumForecast.confidence >= 0 && complete.momentumForecast.confidence <= 100, "forecast confidence stays on a 0-100 evidence-quality scale");
assert.ok(complete.momentumForecast.scenarios.bear.target <= complete.momentumForecast.scenarios.base.target, "Bear target cannot exceed Base target");
assert.ok(complete.momentumForecast.scenarios.base.target <= complete.momentumForecast.scenarios.bull.target, "Base target cannot exceed Bull target");
assert.equal(complete.momentumForecast.policy.confidenceIsEvidenceQuality, true, "confidence is explicitly separate from scenario probability");
assert.equal(complete.momentumForecast.policy.probabilityIsScenarioWeight, true);
assert.equal(complete.momentumForecast.policy.mcdxSyntheticProxy, true);
assert.equal(complete.momentumForecast.policy.notPriceGuarantee, true);
assert.equal(complete.momentumForecast.policy.automaticTrading, false, "forecast must never become an automatic broker order");
assert.ok(complete.chartRanges.YTD.series.length > 1);
assert.ok(complete.low52 > 0 && complete.high52 > complete.low52);

const partial = buildHoldingMarketItem(candles(100, 0.2), null, "PARTIAL HISTORY");
assert.equal(partial.dataQuality.status, "PARTIAL");
assert.ok(partial.momentumForecast, "60+ bars can produce a low-confidence forecast even while the institutional overlay is withheld");
assert.ok(partial.momentumForecast.confidence <= 52, "partial-history forecast confidence is capped");

const quoteOnly = buildHoldingMarketItem([], { symbol: "IPO", price: 25, change: 0, changePercent: 0, high: 25, low: 25, open: 25, prevClose: 25, asOf: "2026-08-17" }, "QUOTE FALLBACK");
assert.equal(quoteOnly.dataQuality.status, "PARTIAL", "quote-only fallback still displays the current price");
assert.equal(quoteOnly.price, 25);
assert.equal(quoteOnly.technicalOverlay, null, "missing history never invents a technical decision");
assert.equal(quoteOnly.momentumForecast, null, "missing history never invents a probability forecast");

console.log("portfolio technical overlay + Momentum Forecast V26: all assertions passed");
