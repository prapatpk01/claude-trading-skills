import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2] || ".test-build-tradingview-v30";
const webhookModule = await import(pathToFileURL(path.resolve(buildDir, "integrations/tradingViewWebhook.js")).href);
const earningsModule = await import(pathToFileURL(path.resolve(buildDir, "research/earningsIntelligence.js")).href);
const { normalizeTradingViewAlert } = webhookModule;
const { assessTradingViewEarnings } = earningsModule;

const nvda = normalizeTradingViewAlert({
  secret: "must-never-persist",
  ticker: "NASDAQ:NVDA",
  timeframe: "1D",
  price: 217.68,
  eventType: "EARNINGS_FINANCIAL",
  earnings: {
    epsActual: 1.866,
    epsEstimate: 1.752,
    revenueActual: 81.61,
    revenueEstimate: 78.91,
    fiscalPeriod: "2026-Q2",
    aiSummary: "Record revenue and strong AI-driven growth",
  },
  financials: { revenueGrowth: 0.5 },
});
assert.equal(nvda.ticker, "NVDA");
assert.equal(nvda.eventType, "EARNINGS_FINANCIAL");
assert.ok((nvda.earnings.epsSurprisePct ?? 0) > 6);
assert.ok((nvda.earnings.revenueSurprisePct ?? 0) > 3);
assert.equal("secret" in nvda.raw, false, "webhook secret must be stripped from persisted raw payload");

const positive = assessTradingViewEarnings({
  eps_surprise_pct: nvda.earnings.epsSurprisePct,
  revenue_surprise_pct: nvda.earnings.revenueSurprisePct,
  fiscal_period: "2026-Q2",
  ai_summary: nvda.earnings.aiSummary,
});
assert.equal(positive.sentiment, "POSITIVE");
assert.ok((positive.score ?? 0) > 50);
assert.ok(positive.probabilityAdjustmentPct > 0);
assert.equal(positive.aiSummaryAffectsScore, false);
assert.equal(positive.automaticTrading, false);

const missing = assessTradingViewEarnings(null);
assert.equal(missing.sentiment, "UNAVAILABLE");
assert.equal(missing.score, null);
assert.equal(missing.probabilityAdjustmentPct, 0, "missing TradingView data must not become negative evidence");

const aiOnly = assessTradingViewEarnings({ ai_summary: "Extremely bullish AI-generated summary" });
assert.equal(aiOnly.sentiment, "UNAVAILABLE", "AI summary alone must not create a positive earnings score");
assert.equal(aiOnly.score, null);
assert.equal(aiOnly.aiSummaryAffectsScore, false);

const route = fs.readFileSync(path.resolve("app/api/tradingview/webhook/route.ts"), "utf8");
assert.match(route, /BLOCKED_BY_POLICY/);
assert.match(route, /saveTradingViewIntelligence/);
assert.doesNotMatch(route, /createOrder|placeOrder|submitOrder/i, "TradingView bridge must remain intake-only");

const overlay = fs.readFileSync(path.resolve("lib/research/tradingViewResearchOverlay.ts"), "utf8");
assert.match(overlay, /missing data does not reduce Fund Fit/);
assert.match(overlay, /provider AI summary is context-only/);

console.log("TradingView Intelligence V30 regression: PASS");
