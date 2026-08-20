import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const modulePath = path.join(process.cwd(), buildDir, "portfolioTechnicalOverlay.js");
const { computePortfolioTechnicalOverlay } = await import(pathToFileURL(modulePath).href);
const modelPath = path.join(process.cwd(), buildDir, "holdingMarketModel.js");
const { buildHoldingMarketItem, cleanMarketTicker, uniqueMarketTickers } = await import(pathToFileURL(modelPath).href);
const actionPath = path.join(process.cwd(), buildDir, "research", "forecastActionPolicy.js");
const { forecastActionPolicy } = await import(pathToFileURL(actionPath).href);
const recyclingPath = path.join(process.cwd(), buildDir, "research", "capitalRecyclingPolicy.js");
const { buildCapitalRecyclingPlan } = await import(pathToFileURL(recyclingPath).href);
const fastScanPath = path.join(process.cwd(), buildDir, "research", "universeFastScan.js");
const { chooseDeepResearchQueue } = await import(pathToFileURL(fastScanPath).href);

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

const bullishForecast = { outlook: "BULLISH", confidence: 82, expectedReturnPct: 9, lifecycleStage: "EARLY_MARKUP" };
const weakForecast = { outlook: "DEFENSIVE", confidence: 76, expectedReturnPct: -4, lifecycleStage: "WEAKENING" };
const moderateTrimForecast = { outlook: "DEFENSIVE", confidence: 68, expectedReturnPct: 2, lifecycleStage: "UNCONFIRMED" };
const brokenForecast = { outlook: "BEARISH", confidence: 84, expectedReturnPct: -10, lifecycleStage: "BROKEN" };

const invBuy = forecastActionPolicy({ ticker: "NVDA", owner: "INV_RESEARCH", forecast: bullishForecast, research: { passed: true, valuationReady: true, expectedReturnPct: 12 } });
assert.equal(invBuy.action, "BUY CANDIDATE", "INV may recommend a new-capital candidate only after research and forecast gates agree");
assert.equal(invBuy.requiresApproval, true, "INV action remains an approval queue item");

const amAdd = forecastActionPolicy({ ticker: "NVDA", owner: "AM_HOLDING", forecast: bullishForecast });
assert.equal(amAdd.action, "ADD", "AM owns add decisions for actual holdings");
assert.equal(amAdd.requiresApproval, true);

const amTrim = forecastActionPolicy({ ticker: "MELI", owner: "AM_HOLDING", forecast: weakForecast });
assert.equal(amTrim.action, "TRIM", "weakening holding becomes a trim review rather than an automatic exit");
assert.equal(amTrim.recommendedTrimPct, 35, "multiple defensive signals with high confidence size the trim near the upper policy band");

const moderateTrim = forecastActionPolicy({ ticker: "HON", owner: "AM_HOLDING", forecast: moderateTrimForecast });
assert.equal(moderateTrim.action, "TRIM");
assert.equal(moderateTrim.recommendedTrimPct, 20, "a single defensive condition uses the minimum trim band rather than over-reducing the position");
assert.ok(amTrim.recommendedTrimPct > moderateTrim.recommendedTrimPct, "trim sizing increases with forecast severity");
assert.ok(amTrim.recommendedTrimPct >= 20 && amTrim.recommendedTrimPct <= 35, "trim sizing remains inside the governed 20-35% band");

const amSellReview = forecastActionPolicy({ ticker: "QCOM", owner: "AM_HOLDING", forecast: brokenForecast });
assert.equal(amSellReview.action, "SELL REVIEW", "broken holding is routed to thesis/fundamental sell review");
assert.equal(amSellReview.recommendedTrimPct, undefined, "sell review does not invent an executable sell size before the exit gate");
assert.notEqual(amSellReview.action, "SELL", "forecast policy never emits an executable SELL instruction");

const watchPromote = forecastActionPolicy({ ticker: "NET", owner: "WATCHLIST", forecast: bullishForecast });
assert.equal(watchPromote.action, "PROMOTE TO INV", "Watchlist cannot become a direct BUY; it must pass through INV research");
assert.notEqual(watchPromote.action, "BUY CANDIDATE");

const reserve = forecastActionPolicy({ ticker: "JAAA", owner: "AM_HOLDING", forecast: bullishForecast });
assert.equal(reserve.action, "RESERVE", "liquidity reserve policy overrides momentum action");
assert.equal(reserve.requiresApproval, true);
assert.equal(reserve.recommendedTrimPct, undefined, "reserve assets are never assigned a trim size by momentum forecast");

const fastRows = [
  { ticker: "EARLY", score: 78, stage: "EARLY_MARKUP", rs3m: 8, return3m: 15 },
  { ticker: "ACCUM", score: 74, stage: "ACCUMULATION", rs3m: 3, return3m: 6 },
  { ticker: "EXPAND", score: 80, stage: "MOMENTUM_EXPANSION", rs3m: 10, return3m: 22 },
  { ticker: "MATURE1", score: 92, stage: "MATURE", rs3m: 15, return3m: 38 },
  { ticker: "MATURE2", score: 90, stage: "MATURE", rs3m: 14, return3m: 35 },
  { ticker: "WEAK", score: 70, stage: "WEAKENING", rs3m: -5, return3m: -8 },
].map(row => ({ ...row, price: 100, return1m: 5, aboveEma20: true, aboveEma50: true, ema20Above50: true, distanceEma20Pct: 4, volumeRatio: 1.2, liquidityScore: 70 }));
const deepQueue = chooseDeepResearchQueue({ provider: "TEST", requested: 6, scanned: 6, failed: 0, coveragePct: 100, rows: fastRows, warnings: [], asOf: new Date().toISOString() }, 4);
assert.equal(deepQueue.length, 4);
assert.ok(deepQueue.slice(0, 3).every(row => ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(row.stage)), "primary lifecycle fast-screen names must fill the deep queue before MATURE fallback");
assert.equal(deepQueue.filter(row => row.stage === "MATURE").length, 1, "MATURE is limited to fallback capacity even when its raw score is higher");
assert.equal(deepQueue.some(row => row.stage === "WEAKENING"), false, "WEAKENING fast-screen names never displace investable lifecycle stages");

const recycling = buildCapitalRecyclingPlan({
  proposedTrimProceedsUsd: 1_000,
  sellReviewPotentialUsd: 2_500,
  existingDeployableCashUsd: 0,
  cashFloorShortfallUsd: 400,
  totalNavUsd: 12_000,
  candidates: [
    { ticker: "AAA", action: "BUY CANDIDATE", priority: 95, confidence: 80, expectedReturnPct: 12 },
    { ticker: "BBB", action: "ADD", priority: 80, confidence: 75, expectedReturnPct: 8 },
  ],
});
assert.equal(recycling.cashFloorRepairUsd, 400, "trim proceeds must repair the Cash Floor first");
assert.equal(recycling.recyclableAfterFloorUsd, 600, "only the trim excess after Cash Floor repair is recyclable");
assert.equal(recycling.sellReviewPotentialUsd, 2500, "SELL REVIEW value is disclosed separately");
assert.equal(recycling.totalDeployablePoolUsd, 600, "unapproved SELL REVIEW proceeds are excluded from deployable capital");
assert.ok(recycling.allocations.length > 0, "qualified BUY/ADD destinations receive a provisional recycle allocation");
assert.ok(recycling.allocations.every(row => row.suggestedUsd <= row.maxPolicyUsd), "reinvestment sizing respects per-name NAV/pool caps");
assert.equal(recycling.automaticTrading, false, "capital recycling never sends an automatic trade");

const underfunded = buildCapitalRecyclingPlan({
  proposedTrimProceedsUsd: 300,
  cashFloorShortfallUsd: 500,
  totalNavUsd: 12_000,
  candidates: [{ ticker: "AAA", action: "BUY CANDIDATE", priority: 95, confidence: 80, expectedReturnPct: 12 }],
});
assert.equal(underfunded.cashFloorRepairUsd, 300);
assert.equal(underfunded.totalDeployablePoolUsd, 0, "no capital is recycled into stocks while the Cash Floor still consumes all trim proceeds");
assert.equal(underfunded.allocations.length, 0);

console.log("portfolio technical overlay + Momentum Forecast V27 full-universe funnel and capital recycling: all assertions passed");