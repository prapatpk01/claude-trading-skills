import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-valuation-governance.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { governValuationSnapshot } = require_(path.resolve(outDir, "valuationGovernance.js"));
const { fundamentalValuationFallback } = require_(path.resolve(outDir, "fundamentalValuationFallback.js"));

let passed = 0, failed = 0;
function ok(name, condition, detail = "") {
  if (condition) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const now = new Date("2026-08-17T00:00:00.000Z");
const base = {
  status: "COMPLETE", modelRoute: "OPERATING_COMPANY", source: "THOMAS_DCF_MULTI_ANCHOR",
  currentPrice: 100, fairValue: 120, bearValue: 90, bullValue: 145, confidence: "MEDIUM",
  anchors: [{ method: "Discounted cash flow" }, { method: "Earnings multiple" }], note: "audited test",
  expiresAt: "2026-08-24T00:00:00.000Z",
};

console.log("\nThomas governed valuation rail");
const valid = governValuationSnapshot(base, 100, now);
ok("decision-ready multi-anchor valuation survives", valid.valid && valid.decisionReady && valid.status === "VALID", JSON.stringify(valid));
ok("gap is recomputed from live price", valid.valuationGapPct === 20, String(valid.valuationGapPct));

const netBasisBug = governValuationSnapshot({ ...base, fairValue: 25.12 }, 307.65, now);
ok("NET-style per-share basis mismatch is blocked", !netBasisBug.valid && netBasisBug.status === "INVALID", JSON.stringify(netBasisBug));

for (const [ticker, fairValue, livePrice] of [["RTX", 113.05, 223.55], ["OKE", 51.40, 95.14], ["BAC", 29.07, 64.95]]) {
  const suspicious = governValuationSnapshot({ ...base, fairValue }, livePrice, now);
  ok(`${ticker} extreme downside remains display-only pending basis review`, suspicious.valid && !suspicious.decisionReady && suspicious.status === "LOW_CONFIDENCE", JSON.stringify(suspicious));
}

const expired = governValuationSnapshot({ ...base, expiresAt: "2026-08-16T23:59:59.000Z" }, 100, now);
ok("expired valuation is blocked", !expired.valid && expired.status === "INVALID", JSON.stringify(expired));

const noAnchors = governValuationSnapshot({ ...base, anchors: [] }, 100, now);
ok("anchorless target is blocked", !noAnchors.valid && noAnchors.status === "INVALID", JSON.stringify(noAnchors));

const low = governValuationSnapshot({ ...base, confidence: "LOW" }, 100, now);
ok("LOW confidence remains display-only", low.valid && !low.decisionReady && low.status === "LOW_CONFIDENCE", JSON.stringify(low));

const priceOnly = governValuationSnapshot({ ...base, anchors: [{ method: "Log trend" }] }, 100, now);
ok("price-only proxy cannot authorize capital", priceOnly.valid && !priceOnly.decisionReady, JSON.stringify(priceOnly));

const cash = governValuationSnapshot({ ...base, modelRoute: "CASH_EQUIVALENT", source: "THOMAS_CASH_EQUIVALENT", fairValue: 100, confidence: "LOW", anchors: [] }, 100, now);
ok("cash-equivalent NAV remains decision-ready", cash.valid && cash.decisionReady && cash.status === "NO_EDGE", JSON.stringify(cash));

const marketData = (ticker, price, overview = {}, balance = []) => ({
  ticker, quote: { price }, candles: [], annualEps: [], quarters: [], ttm: {},
  overview: { sharesOutstanding: 1_000_000, ...overview },
  financials: { income: [], cashflow: [], balance }, sources: [], warnings: [],
});
const splitMismatch = fundamentalValuationFallback(marketData("NET", 307.65, { analystTargetPrice: 25.12 }));
ok("filing fallback rejects a lone split/basis-mismatched target", splitMismatch === null, JSON.stringify(splitMismatch));

const bank = fundamentalValuationFallback(marketData("BAC", 65, { analystTargetPrice: 72, eps: 4, roe: .11 }, [{ totalShareholderEquity: 38_000_000 }]));
ok("bank route uses book value rather than generic EPS/FCF", bank?.anchors.some(anchor => anchor.label.includes("justified P/B")) && !bank?.anchors.some(anchor => anchor.label.includes("P/E")), JSON.stringify(bank));

console.log(`\n${passed} passed · ${failed} failed`);
if (failed) process.exit(1);
