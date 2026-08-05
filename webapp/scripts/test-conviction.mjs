// Assertions for the four pillar scores, the conviction blend and the tracker.
//   npm run test:conviction

import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-conviction.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
// The module has no relative imports, so tsc emits it flat rather than under
// team/. Accept either layout so the script does not depend on that detail.
import fs from "node:fs";
const nested = path.resolve(outDir, "team/conviction.js");
const { scoreConviction, buildThesisTracker, CONVICTION_WEIGHTS } =
  require_(fs.existsSync(nested) ? nested : path.resolve(outDir, "conviction.js"));

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

const strong = {
  roicPct: 28, roePct: 32, grossMarginPct: 68, operatingMarginPct: 34,
  moatScore: 4, moatMax: 5, earningsQualityScore: 88, netDebtToEbitda: 0.4,
  revenueGrowthTtmPct: 31, revenueCagr3yPct: 27, epsGrowthTtmPct: 42, marginTrendBps: 240,
  upsideToFairValuePct: 34, peVsOwnHistoryPct: -12, fcfYieldPct: 5.2,
  beta: 1.1, maxDrawdownPct: -22, realizedVolPct: 28, sessionsToExit: 0.4, hardBlockCount: 0,
};
const weak = {
  roicPct: 3, roePct: 4, grossMarginPct: 18, operatingMarginPct: 2,
  moatScore: 0, moatMax: 5, earningsQualityScore: 22, netDebtToEbitda: 5.4,
  revenueGrowthTtmPct: -8, revenueCagr3yPct: -3, epsGrowthTtmPct: -22, marginTrendBps: -420,
  upsideToFairValuePct: -28, peVsOwnHistoryPct: 55, fcfYieldPct: -1,
  beta: 2.4, maxDrawdownPct: -74, realizedVolPct: 82, sessionsToExit: 7, hardBlockCount: 2,
};

section("The blend is published and fixed");
{
  ok("weights total 1", Math.abs(Object.values(CONVICTION_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  ok("quality carries the most weight", CONVICTION_WEIGHTS.quality === 0.3);
  ok("the result reports the weights it used", scoreConviction(strong).weights.quality === 0.3);
}

section("Pillar scores");
{
  const s = scoreConviction(strong);
  ok("a strong business scores high on quality", s.quality.score >= 75, `${s.quality.score}`);
  ok("and on growth", s.growth.score >= 75, `${s.growth.score}`);
  ok("and on valuation", s.valuation.score >= 60, `${s.valuation.score}`);
  ok("and low risk scores HIGH, not low", s.risk.score >= 55, `${s.risk.score}`);
  ok("overall lands in the buy range", s.overall >= 65, `${s.overall}`);
  ok("the rating follows the score", ["Buy", "Strong Buy"].includes(s.rating), s.rating);
  ok("the rating states its reason", /Conviction \d+\/100/.test(s.ratingReason), s.ratingReason);
  ok("full coverage is reported as such", s.overallCoveragePct === 100, `${s.overallCoveragePct}`);
}
{
  const w = scoreConviction(weak);
  ok("a weak business scores low", w.overall <= 35, `${w.overall}`);
  ok("and rates accordingly", ["Sell", "Strong Sell"].includes(w.rating), w.rating);
  ok("high beta and deep drawdown score low on risk", w.risk.score <= 25, `${w.risk.score}`);
}
{
  const s = scoreConviction(strong);
  const allScores = [s.quality.score, s.growth.score, s.valuation.score, s.risk.score];
  ok("every pillar stays inside 0–100", allScores.every((x) => x >= 0 && x <= 100), JSON.stringify(allScores));
  ok("every component carries a detail sentence",
    [...s.quality.components, ...s.growth.components, ...s.valuation.components, ...s.risk.components].every((c) => c.detail.length > 10));
}

section("Rule #5 — unmeasured is not zero");
{
  const partial = scoreConviction({ roicPct: 28, roePct: 32, grossMarginPct: 68, operatingMarginPct: 34 });
  ok("quality still scores from what was measured", partial.quality.score != null && partial.quality.score >= 70, `${partial.quality.score}`);
  ok("the missing components are named", partial.quality.unmeasured.length === 2, JSON.stringify(partial.quality.unmeasured));
  ok("coverage is reported below 100", partial.quality.coveragePct < 100 && partial.quality.coveragePct > 0, `${partial.quality.coveragePct}`);
  ok("the note explains the exclusion", /not counted as zero/.test(partial.quality.note));
}
{
  const nothing = scoreConviction({});
  ok("with no inputs no pillar scores", nothing.quality.score === null && nothing.growth.score === null);
  ok("overall is null, not zero", nothing.overall === null);
  ok("and it refuses to rate", nothing.rating === "Not rated", nothing.rating);
  ok("saying an unmeasured pillar is not a low one", /not a low one/.test(nothing.quality.note));
}
{
  // Only quality and growth measurable: 55% of the weight.
  const half = scoreConviction({ roicPct: 25, roePct: 30, grossMarginPct: 60, operatingMarginPct: 30, moatScore: 4, moatMax: 5, earningsQualityScore: 80, revenueGrowthTtmPct: 25, revenueCagr3yPct: 22, epsGrowthTtmPct: 30, marginTrendBps: 200 });
  ok("the blend uses only the weight it could measure", half.overallCoveragePct === 55, `${half.overallCoveragePct}`);
  ok("a strong half-measured company still scores", half.overall != null && half.overall > 60, `${half.overall}`);
}
{
  // Below half the weight, a rating says more about the gaps than the company.
  const thin = scoreConviction({ revenueGrowthTtmPct: 30, revenueCagr3yPct: 25, epsGrowthTtmPct: 40, marginTrendBps: 300 });
  ok("under 50% coverage the rating is withheld", thin.rating === "Not rated", `${thin.rating} at ${thin.overallCoveragePct}%`);
  ok("and the reason names the gaps", /unscored/.test(thin.ratingReason), thin.ratingReason);
  ok("but the score itself is still published", thin.overall != null);
}

section("Thesis tracker");
{
  const conviction = scoreConviction(strong);
  const t = buildThesisTracker({
    ticker: "AAA", price: 100, fairValue: 134, conviction,
    risks: ["Customer concentration above 30% of revenue"],
    revenueGrowthTtmPct: 31, operatingMarginPct: 34, roicPct: 28, netDebtToEbitda: 0.4,
    nextEarningsDate: "2026-08-28",
  });
  ok("a bull case is assembled", t.bull.length > 0);
  ok("the variant perception is a measurement, not a story", /34/.test(t.variantPerception) || /34\.0/.test(t.variantPerception), t.variantPerception);
  ok("it names the gap as the position", /that gap is the position/i.test(t.variantPerception));
  ok("supplied risks are carried", t.keyRisks.some((r) => /Customer concentration/.test(r)));
  ok("six monitoring metrics are tracked", t.monitoring.length === 6, `${t.monitoring.length}`);
  ok("every metric has a breaking trigger", t.monitoring.every((m) => m.trigger.length > 15));
  ok("every metric has an owner", t.monitoring.every((m) => m.owner.length > 3));
  ok("every metric shows its current reading", t.monitoring.every((m) => m.current.length > 0));
}
{
  const t = buildThesisTracker({ ticker: "BBB", price: 100, fairValue: 103, conviction: scoreConviction(strong) });
  ok("agreement with the market is called out as no edge", /no variant view/i.test(t.variantPerception), t.variantPerception);
}
{
  const t = buildThesisTracker({ ticker: "CCC", price: 100, fairValue: 70, conviction: scoreConviction(weak) });
  ok("an overpriced name says the variant view runs against owning it", /against owning it/i.test(t.variantPerception), t.variantPerception);
  ok("weak pillars produce a bear case", t.bear.length >= 2, JSON.stringify(t.bear));
  ok("low-scoring risk components become key risks", t.keyRisks.length >= 2);
}
{
  const t = buildThesisTracker({ ticker: "DDD", price: null, fairValue: null, conviction: scoreConviction({}) });
  ok("no anchor means no variant perception is claimed", /no measurable gap/i.test(t.variantPerception), t.variantPerception);
  ok("and the absence of measured risk is stated as an absence of measurement",
    t.keyRisks.some((r) => /absence of measurement/i.test(r)));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
