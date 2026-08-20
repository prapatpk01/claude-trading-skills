import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const policyPath = path.join(process.cwd(), buildDir, "research", "reinvestmentBuilderPolicy.js");
const { buildReinvestmentDraft, curateReinvestmentCandidates, rankReinvestmentCandidates } = await import(pathToFileURL(policyPath).href);

const candidates = [
  { ticker: "AAA", action: "BUY CANDIDATE", readiness: "READY", price: 100, confidence: 82, expectedReturnPct: 14, priority: 95 },
  { ticker: "BBB", action: "BUY CANDIDATE", readiness: "READY", price: 50, confidence: 78, expectedReturnPct: 11, priority: 90 },
  { ticker: "CCC", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 80, confidence: 70, expectedReturnPct: 8, priority: 70 },
  { ticker: "DDD", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 40, confidence: 68, expectedReturnPct: 6, priority: 65 },
  { ticker: "EEE", action: "ADD", readiness: "READY", price: 120, confidence: 76, expectedReturnPct: 9, priority: 82 },
  { ticker: "FFF", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 30, confidence: 66, expectedReturnPct: 5, priority: 62 },
  { ticker: "GGG", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 25, confidence: 64, expectedReturnPct: 4, priority: 60 },
  { ticker: "HHH", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 20, confidence: 62, expectedReturnPct: 3, priority: 58 },
  { ticker: "III", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 10, confidence: 60, expectedReturnPct: 2, priority: 56 },
];

const ranked = rankReinvestmentCandidates(candidates);
assert.equal(ranked[0].readiness, "READY", "READY candidates rank before CIO_REVIEW drafts");
assert.ok(ranked.slice(0, 3).some(row => row.ticker === "AAA"), "high-conviction READY candidate remains near the top");

const curation = curateReinvestmentCandidates({ candidates, deployableUsd: 1688.5, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(curation.owner, "INV_RESEARCH", "investment selection is owned by INV rather than a manual Top 5/8 control");
assert.ok(curation.selected.length >= 5 && curation.selected.length <= 8, "INV automatically curates within the governed 5-8 name range when enough quality candidates exist");
assert.ok(curation.selected.every(row => candidates.some(candidate => candidate.ticker === row.ticker)), "INV curation can only select from the governed candidate pool");
assert.equal(curation.selected.some(row => row.ticker === "III"), false, "low-quality extension candidates are not forced merely to reach eight names");

const scarce = curateReinvestmentCandidates({ candidates: candidates.slice(0, 3), deployableUsd: 1688.5, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(scarce.selected.length, 3, "INV does not force lower-quality or nonexistent names just to satisfy the five-name target");

const lowCapital = curateReinvestmentCandidates({ candidates, deployableUsd: 350, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(lowCapital.selected.length, 3, "capital capacity can reduce the curated basket below five names without violating the minimum order size");

const equal = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: curation.selected, mode: "EQUAL" });
assert.ok(equal.orders.length >= 5, "the INV-curated basket can flow directly into draft position sizing");
assert.ok(equal.allocatedUsd <= 1688.5 + .01, "draft never allocates more than deployable capital");
assert.ok(equal.orders.every(row => row.estimatedShares > 0), "every draft order includes an estimated fractional share count");
assert.ok(equal.orders.filter(row => row.action !== "ADD").every(row => row.suggestedUsd <= 12867 * .03 + .01), "new buys respect the 3% NAV position cap");
assert.ok(equal.orders.filter(row => row.action === "ADD").every(row => row.suggestedUsd <= 12867 * .02 + .01), "adds respect the 2% NAV cap");
assert.equal(equal.automaticTrading, false);
assert.equal(equal.requiresFundingRiskCioApproval, true);

const conviction = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: candidates, mode: "CONVICTION", maxNames: 8 });
assert.equal(conviction.selectedCount, 8, "builder hard-caps position sizing at eight names even if a caller supplies more");
assert.ok(conviction.orders.length <= 8);
assert.ok(conviction.orders[0].suggestedUsd >= conviction.orders.at(-1).suggestedUsd, "conviction sizing gives at least as much capital to the highest-ranked surviving order as the lowest-ranked order");

const coreSatellite = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: candidates.slice(0, 8), mode: "CORE_SATELLITE" });
assert.ok(coreSatellite.orders.length >= 5, "core/satellite mode remains diversified when five or more names are selected");
assert.ok(coreSatellite.unallocatedUsd >= 0, "policy caps leave residual cash rather than exceeding limits");

const noCapital = buildReinvestmentDraft({ deployableUsd: 0, totalNavUsd: 12867, selected: candidates.slice(0, 5), mode: "EQUAL" });
assert.equal(noCapital.orders.length, 0, "no draft is created when Cash Floor/funding leaves zero deployable capital");

console.log("Reinvestment Builder V28.1 INV curation + position sizing: all assertions passed");
