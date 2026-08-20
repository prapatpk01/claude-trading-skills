import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const fastPath = path.join(process.cwd(), buildDir, "research", "universeFastScan.js");
const modelPath = path.join(process.cwd(), buildDir, "holdingMarketModel.js");
const { fastScanRequestKey } = await import(pathToFileURL(fastPath).href);
const { buildHoldingMarketItem } = await import(pathToFileURL(modelPath).href);

const fullUniverseKey = fastScanRequestKey(["SPY", "AAA", "BBB", "CCC"]);
const sectorKey = fastScanRequestKey(["SPY", "XLK", "XLF", "XLE"]);
assert.notEqual(fullUniverseKey, sectorKey, "different same-sized ticker sets must not share the same in-flight/cache key");
assert.equal(fastScanRequestKey(["SPY", "XLK"]), fastScanRequestKey(["SPY", "XLK"]), "same ticker set has a stable request key");

const batchPriceOnly = buildHoldingMarketItem([], {
  symbol: "TEST",
  price: 125,
  change: 0,
  changePercent: 0,
  high: 125,
  low: 125,
  open: 125,
  prevClose: 125,
  asOf: "2026-08-20",
}, "Yahoo multi-symbol batch · price fallback", ["Full history unavailable"]);
assert.equal(batchPriceOnly.price, 125, "batch fallback may recover a visible live/last price");
assert.equal(batchPriceOnly.dataQuality.status, "PARTIAL", "price-only recovery is explicitly partial data");
assert.equal(batchPriceOnly.technicalOverlay, null, "price-only recovery must not invent technical evidence");
assert.equal(batchPriceOnly.momentumForecast, null, "missing history must never be converted into BROKEN/WEAKENING momentum output");

const unavailable = buildHoldingMarketItem([], null, null, ["provider unavailable"]);
assert.equal(unavailable.dataQuality.status, "UNAVAILABLE");
assert.equal(unavailable.price, null);
assert.equal(unavailable.momentumForecast, null, "provider failure remains an evidence gap rather than a bearish forecast");

console.log("Market Data Resilience V29: all assertions passed");
