import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const policyPath = path.join(process.cwd(), buildDir, "research", "highOpportunityPolicy.js");
const fastPath = path.join(process.cwd(), buildDir, "research", "universeFastScan.js");
const { HIGH_OPPORTUNITY_POLICY, researchOpportunityScore, passesHighOpportunityResearchGate } = await import(pathToFileURL(policyPath).href);
const { highOpportunityFastScore, chooseDeepResearchQueue } = await import(pathToFileURL(fastPath).href);

assert.equal(HIGH_OPPORTUNITY_POLICY.minMomentum, 68);
assert.equal(HIGH_OPPORTUNITY_POLICY.minResearchUpsidePct, 12);

const strong = researchOpportunityScore({ momentum: 82, institutional: 78, growth: 75, quality: 70, value: 68, ai: 72, expectedReturnPct: 20 });
const lowUpside = researchOpportunityScore({ momentum: 82, institutional: 78, growth: 75, quality: 70, value: 68, ai: 72, expectedReturnPct: 3 });
assert.ok(strong > lowUpside + 10, "high valuation upside must materially improve V32 opportunity rank");
assert.equal(passesHighOpportunityResearchGate({ momentum: 80, expectedReturnPct: 18, lifecycleEntryEligible: true, valuationReady: true }), true);
assert.equal(passesHighOpportunityResearchGate({ momentum: 80, expectedReturnPct: 8, lifecycleEntryEligible: true, valuationReady: true }), false, "sub-12% research upside cannot qualify");
assert.equal(passesHighOpportunityResearchGate({ momentum: 62, expectedReturnPct: 20, lifecycleEntryEligible: true, valuationReady: true }), false, "high upside alone cannot compensate for weak momentum");

const base = { price: 100, aboveEma20: true, aboveEma50: true, ema20Above50: true, liquidityScore: 80 };
const early = { ...base, ticker: "EARLY", score: 78, stage: "EARLY_MARKUP", return1w: 3, return1m: 9, return3m: 21, rs3m: 11, distanceEma20Pct: 5, volumeRatio: 1.5 };
const expand = { ...base, ticker: "EXPAND", score: 82, stage: "MOMENTUM_EXPANSION", return1w: 4, return1m: 12, return3m: 27, rs3m: 15, distanceEma20Pct: 7, volumeRatio: 1.6 };
const accum = { ...base, ticker: "ACCUM", score: 72, stage: "ACCUMULATION", return1w: 1, return1m: 1, return3m: 5, rs3m: 2, distanceEma20Pct: 1, volumeRatio: 1.3 };
const mature = { ...base, ticker: "MATURE", score: 91, stage: "MATURE", return1w: 5, return1m: 17, return3m: 38, rs3m: 20, distanceEma20Pct: 13, volumeRatio: 1.4 };
const weak = { ...base, ticker: "WEAK", score: 76, stage: "WEAKENING", return1w: -3, return1m: -6, return3m: -8, rs3m: -10, distanceEma20Pct: -7, volumeRatio: .8 };

assert.ok(highOpportunityFastScore(expand) > highOpportunityFastScore(mature), "V32 should prefer fresh momentum expansion over an already mature extension");
const queue = chooseDeepResearchQueue({ provider: "TEST", requested: 5, scanned: 5, failed: 0, coveragePct: 100, rows: [mature, weak, accum, early, expand], warnings: [], asOf: new Date().toISOString() }, 4);
assert.equal(queue[0].ticker, "EXPAND");
assert.equal(queue[1].ticker, "EARLY");
assert.equal(queue.some(row => row.ticker === "WEAK"), false);
assert.ok(queue.slice(0, 3).every(row => ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(row.stage)), "primary lifecycle consumes the front of the deep-research queue");

console.log("High Opportunity Discovery V32: momentum hunt + upside opportunity gate assertions passed");
