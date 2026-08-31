import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2] || ".test-build-inv-v40";
const policyPath = path.resolve(root, "rankingPolicyV40.js");
const { buildRankingV40, totalRankingScoreV40 } = await import(pathToFileURL(policyPath).href);

const row = (overrides = {}) => ({
  ticker: "TEST",
  name: "Test Co",
  sector: "Technology",
  lane: "MOMENTUM",
  state: "RESEARCH_READY",
  score: 86,
  confidenceScore: 84,
  price: 100,
  targetPrice: 120,
  expectedReturnPct: 20,
  lifecycleStage: "EARLY_MARKUP",
  momentumScore: 88,
  institutionalScore: 78,
  growthScore: 85,
  qualityScore: 84,
  compositeScore: 86,
  fastScore: 88,
  return1w: 4,
  return1m: 11,
  return3m: 28,
  rs3m: 14,
  volumeRatio: 1.4,
  sectorLeadershipScore: null,
  sectorLeadershipStatus: null,
  sectorRank: null,
  theme: null,
  thesis: "Measured growth and momentum candidate",
  catalyst: "Measured catalyst",
  whyNow: "Momentum expanding",
  invalidation: "Trend breaks",
  committeeReady: false,
  discoveryReasons: [],
  hardBlocks: [],
  failedGates: ["Valuation confirmation"],
  dataQuality: "HIGH",
  ...overrides,
});

assert.equal(totalRankingScoreV40({
  momentum: 100,
  growth: 100,
  earningsAcceleration: 100,
  quality: 100,
  relativeStrength: 100,
  valuation: 100,
  catalyst: 100,
}), 100, "weights must sum to 100");

const noCommittee = buildRankingV40([row()], 20);
assert.equal(noCommittee.counts.BUY_NOW, 0, "high score must not become BUY NOW without Committee Ready");
assert.ok(noCommittee.finalists.length > 0, "no BUY NOW must still retain ranked finalists");
assert.equal(noCommittee.finalists[0].actionBand, "ACCUMULATE", "strong deeply researched near-buy should remain actionable research");

const committeeReady = buildRankingV40([row({ ticker: "READY", committeeReady: true, failedGates: [] })], 20);
assert.equal(committeeReady.finalists[0].actionBand, "BUY_NOW", "strict Committee Ready + score >=82 may emit BUY NOW");

const fastOnly = buildRankingV40([row({
  ticker: "FAST",
  momentumScore: null,
  growthScore: null,
  qualityScore: null,
  compositeScore: null,
  expectedReturnPct: null,
  targetPrice: null,
  thesis: null,
  catalyst: null,
  committeeReady: false,
  score: 70,
  fastScore: 74,
  rs3m: 8,
  failedGates: [],
})], 20);
assert.equal(fastOnly.finalists[0].actionBand, "WATCHLIST", "fast-screen evidence may surface a WATCHLIST candidate without pretending deep research exists");
assert.ok(fastOnly.finalists[0].missingToUpgrade.includes("Deep research confirmation"));

const blocked = buildRankingV40([row({ ticker: "BROKEN", lifecycleStage: "BROKEN", committeeReady: true })], 20);
assert.equal(blocked.counts.REJECT, 1, "hard-broken lifecycle must remain rejected regardless of score");
assert.equal(blocked.counts.BUY_NOW, 0);

const ordering = buildRankingV40([
  row({ ticker: "LOW", momentumScore: 60, growthScore: 60, qualityScore: 60, expectedReturnPct: 8, catalyst: null, thesis: null, committeeReady: false }),
  row({ ticker: "HIGH", committeeReady: true, failedGates: [] }),
], 20);
assert.equal(ordering.bestAvailable[0].ticker, "HIGH", "strongest capital-ready idea should rank first");

console.log("INV Research V40 ranking tests passed");
