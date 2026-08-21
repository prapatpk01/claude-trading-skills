import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const buildDir = process.argv[2];
const policyPath = path.join(process.cwd(), buildDir, "research", "reinvestmentBuilderPolicy.js");
const { buildReinvestmentDraft, curateReinvestmentCandidates, rankReinvestmentCandidates, meetsReinvestmentOpportunityFloor } = await import(pathToFileURL(policyPath).href);
const completionPath = path.join(process.cwd(), buildDir, "research", "invBasketCompletionPolicy.js");
const { shouldExpandInvBasket } = await import(pathToFileURL(completionPath).href);

const candidates = [
  { ticker: "AAA", action: "BUY CANDIDATE", readiness: "READY", price: 100, confidence: 82, expectedReturnPct: 14, priority: 95, lifecycleStage: "EARLY_MARKUP" },
  { ticker: "BBB", action: "BUY CANDIDATE", readiness: "READY", price: 50, confidence: 78, expectedReturnPct: 11, priority: 90, lifecycleStage: "ACCUMULATION" },
  { ticker: "CCC", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 80, confidence: 70, expectedReturnPct: 8, priority: 70, lifecycleStage: "MOMENTUM_EXPANSION" },
  { ticker: "DDD", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 40, confidence: 68, expectedReturnPct: 6, priority: 65, lifecycleStage: "EARLY_MARKUP" },
  { ticker: "EEE", action: "ADD", readiness: "READY", price: 120, confidence: 76, expectedReturnPct: 9, priority: 82, lifecycleStage: "EARLY_MARKUP" },
  { ticker: "FFF", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 30, confidence: 66, expectedReturnPct: 5, priority: 62, lifecycleStage: "EARLY_MARKUP" },
  { ticker: "GGG", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 25, confidence: 64, expectedReturnPct: 4, priority: 60, lifecycleStage: "ACCUMULATION" },
  { ticker: "HHH", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 20, confidence: 62, expectedReturnPct: 3, priority: 58, lifecycleStage: "MOMENTUM_EXPANSION" },
  { ticker: "III", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 10, confidence: 60, expectedReturnPct: 2, priority: 56, lifecycleStage: "EARLY_MARKUP" },
];

const ranked = rankReinvestmentCandidates(candidates);
assert.equal(ranked[0].ticker, "AAA", "highest opportunity-adjusted conviction ranks first");
assert.ok(ranked.slice(0, 3).some(row => row.ticker === "AAA"), "high-conviction READY candidate remains near the top");

assert.equal(meetsReinvestmentOpportunityFloor(candidates[0]), true);
assert.equal(meetsReinvestmentOpportunityFloor(candidates[5]), false, "primary-lifecycle +5% weighted upside is below the V31 new-capital floor");
const matureSeven = { ticker: "MAT", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 100, confidence: 72, expectedReturnPct: 7, priority: 80, lifecycleStage: "MATURE" };
assert.equal(meetsReinvestmentOpportunityFloor(matureSeven), false, "MATURE requires a stricter ≥8% weighted upside hurdle");

const curation = curateReinvestmentCandidates({ candidates, deployableUsd: 1688.5, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(curation.owner, "INV_RESEARCH", "investment selection is owned by INV rather than a manual Top 5/8 control");
assert.equal(curation.selected.length, 5, "INV selects the five names that actually clear the V31 opportunity floor");
assert.ok(curation.selected.every(row => meetsReinvestmentOpportunityFloor(row)), "no low-upside candidate is forced into the first five");
assert.equal(curation.selected.some(row => row.ticker === "FFF"), false, "+5% weighted upside does not consume new capital merely to fill the basket");
assert.equal(curation.selected.some(row => row.ticker === "III"), false, "low-quality extension candidates are not forced merely to reach eight names");

const scarce = curateReinvestmentCandidates({ candidates: candidates.slice(0, 3), deployableUsd: 1688.5, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(scarce.selected.length, 3, "INV does not force lower-quality or nonexistent names just to satisfy the five-name target");

const lowCapital = curateReinvestmentCandidates({ candidates, deployableUsd: 350, minNames: 5, maxNames: 8, minOrderUsd: 100 });
assert.equal(lowCapital.selected.length, 3, "capital capacity can reduce the curated basket below five names without violating the minimum order size");

const equal = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: curation.selected, mode: "EQUAL" });
assert.equal(equal.orders.length, 5, "the opportunity-efficient INV basket flows directly into draft position sizing");
assert.ok(equal.allocatedUsd <= 1688.5 + .01, "draft never allocates more than deployable capital");
assert.ok(equal.orders.every(row => row.estimatedShares > 0), "every draft order includes an estimated fractional share count");
assert.ok(equal.orders.filter(row => row.action !== "ADD").every(row => row.suggestedUsd <= 12867 * .03 + .01), "new buys respect the 3% NAV position cap");
assert.ok(equal.orders.filter(row => row.action === "ADD").every(row => row.suggestedUsd <= 12867 * .02 + .01), "adds respect the 2% NAV cap");
assert.equal(equal.automaticTrading, false);
assert.equal(equal.requiresFundingRiskCioApproval, true);

const conviction = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: candidates, mode: "CONVICTION", maxNames: 8 });
assert.equal(conviction.selectedCount, 5, "builder independently strips sub-floor candidates even if a caller supplies them directly");
assert.equal(conviction.orders.some(row => ["FFF", "GGG", "HHH", "III"].includes(row.ticker)), false, "low-upside rows cannot bypass curation through direct draft construction");
assert.ok(conviction.orders[0].suggestedUsd >= conviction.orders.at(-1).suggestedUsd, "conviction sizing gives at least as much capital to the highest-ranked surviving order as the lowest-ranked order");

const coreSatellite = buildReinvestmentDraft({ deployableUsd: 1688.5, totalNavUsd: 12867, selected: candidates.slice(0, 8), mode: "CORE_SATELLITE" });
assert.equal(coreSatellite.orders.length, 5, "core/satellite mode uses only the five surviving opportunity-efficient names");
assert.ok(coreSatellite.unallocatedUsd >= 0, "policy caps leave residual cash rather than exceeding limits");

const noCapital = buildReinvestmentDraft({ deployableUsd: 0, totalNavUsd: 12867, selected: candidates.slice(0, 5), mode: "EQUAL" });
assert.equal(noCapital.orders.length, 0, "no draft is created when Cash Floor/funding leaves zero deployable capital");

const shopOnlyDraft = buildReinvestmentDraft({
  deployableUsd: 1688.5,
  totalNavUsd: 12946,
  selected: [{ ticker: "SHOP", action: "BUY DRAFT", readiness: "CIO_REVIEW", price: 146.58, confidence: 68, expectedReturnPct: 2.9, priority: 60, lifecycleStage: "MATURE" }],
  mode: "EQUAL",
});
assert.equal(shopOnlyDraft.orders.length, 0, "SHOP-like +2.9% weighted upside is not funded under V31");
assert.equal(shopOnlyDraft.unallocatedUsd, 1688.5, "capital stays fully available for the next approved-universe research pass");

const meliLowUpside = curateReinvestmentCandidates({
  candidates: [{ ticker: "MELI", action: "BUY CANDIDATE", readiness: "READY", price: 1921.96, confidence: 68, expectedReturnPct: 0.6, priority: 95, lifecycleStage: "EARLY_MARKUP" }],
  deployableUsd: 1688.5,
  minNames: 5,
  maxNames: 8,
  minOrderUsd: 100,
});
assert.equal(meliLowUpside.selected.length, 0, "MELI-like +0.6% forecast is not made investable by READY status alone");

const expandShop = shouldExpandInvBasket({
  selectedCount: 0,
  targetMinNames: 5,
  targetMaxNames: 8,
  deployableUsd: shopOnlyDraft.deployableUsd,
  allocatedUsd: shopOnlyDraft.allocatedUsd,
  unallocatedUsd: shopOnlyDraft.unallocatedUsd,
  minOrderUsd: 100,
  pass: 0,
  maxPasses: 3,
});
assert.equal(expandShop.shouldExpand, true, "a zero-name opportunity-efficient basket with deployable cash automatically triggers the next INV research pass");
assert.equal(expandShop.nextPass, 1);

const completeBasket = shouldExpandInvBasket({
  selectedCount: 6,
  targetMinNames: 5,
  targetMaxNames: 8,
  deployableUsd: 1688.5,
  allocatedUsd: 1588.5,
  unallocatedUsd: 100,
  minOrderUsd: 100,
  pass: 1,
  maxPasses: 3,
});
assert.equal(completeBasket.shouldExpand, false, "a diversified basket with only one minimum-order unit left does not keep expanding unnecessarily");

const passLimit = shouldExpandInvBasket({
  selectedCount: 2,
  targetMinNames: 5,
  targetMaxNames: 8,
  deployableUsd: 1688.5,
  allocatedUsd: 600,
  unallocatedUsd: 1088.5,
  minOrderUsd: 100,
  pass: 2,
  maxPasses: 3,
});
assert.equal(passLimit.shouldExpand, false, "basket completion stops after the governed third deep-research tranche");

console.log("Reinvestment Builder V31 opportunity efficiency + INV curation + basket completion + position sizing: all assertions passed");
