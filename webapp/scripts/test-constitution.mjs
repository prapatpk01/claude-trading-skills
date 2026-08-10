// The fund's own rules, asserted against the approved policy.
//
// Base rules come from investment-system SKILL.md (16 June 2026).
// The income-policy amendment was approved by the fund manager on 11 Aug 2026.
// If policy changes, this file changes with it and the failure tells us which
// module still holds the old value.
//
//   npm run test:constitution

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-constitution.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const nested = path.resolve(outDir, "team/constitution.js");
const C = require_(fs.existsSync(nested) ? nested : path.resolve(outDir, "constitution.js"));

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

section("Dual objective and income policy");
{
  ok("total return target is 1.3× the benchmark", C.DUAL_OBJECTIVE.benchmarkMultiple === 1.3);
  ok("income soft floor is 3.25%", C.INCOME_POLICY.softFloorPct === 3.25);
  ok("preferred income band is 3.5–4.0%", C.INCOME_POLICY.targetMinPct === 3.5 && C.INCOME_POLICY.targetMaxPct === 4);
  ok("preferred midpoint is 3.75%", C.INCOME_POLICY.midpointPct === 3.75);
  ok("high-distribution review starts above 4.5%", C.INCOME_POLICY.reviewHighPct === 4.5);
  ok("total return outranks distribution yield", C.INCOME_POLICY.totalReturnPriority === true);
  ok("yield chasing is prohibited", C.INCOME_POLICY.noYieldChasing === true);
  ok("compatibility yield floor points to the soft floor", C.DUAL_OBJECTIVE.yieldFloorPct === 3.25);

  ok("3.00% requires remediation", C.assessIncomeYield(3).status === "BELOW_FLOOR" && C.assessIncomeYield(3).pass === false);
  ok("3.30% is watch, not a forced failure", C.assessIncomeYield(3.3).status === "WATCH_LOW" && C.assessIncomeYield(3.3).pass === null);
  ok("3.75% is optimal", C.assessIncomeYield(3.75).status === "OPTIMAL" && C.assessIncomeYield(3.75).pass === true);
  ok("4.25% remains acceptable with total-return review", C.assessIncomeYield(4.25).status === "ACCEPTABLE_HIGH" && C.assessIncomeYield(4.25).pass === true);
  ok("4.70% is a high-distribution review, not a better score", C.assessIncomeYield(4.7).status === "REVIEW_HIGH" && C.assessIncomeYield(4.7).pass === false);
  ok("missing yield stays unavailable", C.assessIncomeYield(null).status === "UNAVAILABLE" && C.assessIncomeYield(null).pass === null);
}

section("Portfolio structure (Section 4)");
{
  ok("growth sleeve targets 55%", C.SLEEVE_TARGETS.growth === 55);
  ok("income sleeve targets 30%", C.SLEEVE_TARGETS.income === 30);
  ok("cash sleeve targets 13%", C.SLEEVE_TARGETS.cash === 13);
  ok("Rule #7 alerts on 5% drift", C.SLEEVE_DRIFT_ALERT_PCT === 5);
}

section("Rule #3 v2 — position balance zones");
{
  ok("≤20% is BASE", C.zoneForWeight(20) === "BASE" && C.zoneForWeight(12) === "BASE");
  ok("20–22% is WATCH", C.zoneForWeight(20.1) === "WATCH" && C.zoneForWeight(22) === "WATCH");
  ok("23–25% is TRIM", C.zoneForWeight(23) === "TRIM" && C.zoneForWeight(25) === "TRIM");
  ok(">25% is EMERGENCY", C.zoneForWeight(25.1) === "EMERGENCY");
  ok("a mandatory trim targets the 18–19% band",
    C.POSITION_ZONES.trimTargetLowPct === 18 && C.POSITION_ZONES.trimTargetHighPct === 19);
  ok("a trim requires a replacement first", C.TRIM_REQUIRES_REPLACEMENT === true);
  ok("no weight falls through the bands",
    ["BASE", "WATCH", "TRIM", "EMERGENCY"].includes(C.zoneForWeight(22.5)), C.zoneForWeight(22.5));
}

section("Rule #1 — soft-block system");
{
  ok("one block above 80 is a soft block", C.softBlockApplies(85, 1) === true);
  ok("one block at exactly 80 is not", C.softBlockApplies(80, 1) === false);
  ok("two blocks is never a soft block", C.softBlockApplies(95, 2) === false);
  ok("no block is not a soft block", C.softBlockApplies(95, 0) === false);
}

section("Rule #2 — staggered deploy");
{
  ok("the Tier-1 window is five days", C.STAGGERED_DEPLOY.tierOneWindowDays === 5);
  ok("the cap is one third", Math.abs(C.STAGGERED_DEPLOY.maxFractionBeforeEvent - 1 / 3) < 1e-9);
  ok("the events are FOMC, CPI and NFP",
    ["FOMC", "CPI", "NFP"].every((e) => C.STAGGERED_DEPLOY.events.includes(e)));

  const risky = C.permittedDeployFraction(85, 3);
  ok("Risk-On inside the window is capped to a third", Math.abs(risky.fraction - 1 / 3) < 1e-9, `${risky.fraction}`);
  ok("and says the event is the binding constraint", /Tier-1 event/.test(risky.reason), risky.reason);

  const neutral = C.permittedDeployFraction(50, 3);
  ok("Neutral inside the window takes the third, not 75%", Math.abs(neutral.fraction - 1 / 3) < 1e-9, `${neutral.fraction}`);

  const riskOff = C.permittedDeployFraction(25, 3);
  ok("Risk-Off already caps at a third, so the event adds nothing",
    Math.abs(riskOff.fraction - 1 / 3) < 1e-9, `${riskOff.fraction}`);
  ok("and the regime is named as the binding constraint", /Risk-Off/.test(riskOff.reason), riskOff.reason);

  ok("no event means the regime alone decides",
    Math.abs(C.permittedDeployFraction(50, null).fraction - 0.75) < 1e-9);
  ok("an event outside the window does not bind",
    Math.abs(C.permittedDeployFraction(85, 30).fraction - 1) < 1e-9);
}

section("Macro regime framework (Section 7)");
{
  const cases = [
    [85, "Risk-On", 10, 1],
    [70, "Risk-On", 10, 1],
    [69, "Neutral", 15, 0.75],
    [40, "Neutral", 15, 0.75],
    [39, "Risk-Off", 25, 1 / 3],
    [20, "Risk-Off", 25, 1 / 3],
    [19, "Crisis", 40, 0],
    [0, "Crisis", 40, 0],
  ];
  for (const [score, name, cash, deploy] of cases) {
    const band = C.regimeBandFor(score);
    ok(`score ${score} is ${name}`, band.name === name, band.name);
    ok(`  cash floor ${cash}%`, band.cashMinPct === cash, `${band.cashMinPct}`);
    ok(`  deploy ${Math.round(deploy * 100)}%`, Math.abs(band.deployFraction - deploy) < 1e-9, `${band.deployFraction}`);
  }
  ok("Crisis freezes deployment outright", C.regimeBandFor(5).deployFraction === 0);
}

section("Rule #5 — data integrity");
{
  ok("unavailable data scores zero", C.DATA_INTEGRITY.unavailableScoresZero === true);
  ok("Gate 7 requires 70% data quality", C.DATA_INTEGRITY.minDataQualityPct === 70);
  ok("all three flags are defined",
    ["V", "E", "U"].every((f) => typeof C.DATA_INTEGRITY.flagMeaning[f] === "string"));
  ok("the U flag says it scores zero", /zero/.test(C.DATA_INTEGRITY.flagMeaning.U));
}

section("Rule #6 — win-rate disclosure");
{
  ok("100 live trades are required", C.WIN_RATE_DISCLOSURE.liveTradesRequired === 100);

  const thin = C.winRatePresentation(24, 58);
  ok("a rate below the bar is still shown", thin.quotable && thin.value === 58);
  ok("but carries the Component Estimate label", /Component Estimate/.test(thin.label), thin.label);

  const proven = C.winRatePresentation(140, 61);
  ok("past the bar it stands on its own", proven.quotable && !/Component Estimate/.test(proven.label), proven.label);
  ok("citing the sample", /140 live trades/.test(proven.label));

  const none = C.winRatePresentation(0, null);
  ok("no measurement means no rate", !none.quotable && none.value === null);
}

section("Momentum signals (Section 6) and risk limits (Section 9)");
{
  ok("STRONG BUY at 75", C.MOMENTUM_SIGNALS.strongBuyFloor === 75);
  ok("BUY at 58", C.MOMENTUM_SIGNALS.buyFloor === 58);
  ok("WATCH at 42", C.MOMENTUM_SIGNALS.watchFloor === 42);
  ok("a new position needs 58", C.MOMENTUM_SIGNALS.entryFloor === 58);

  ok("quarter Kelly", C.RISK_LIMITS.kellyFraction === 0.25);
  ok("size ceiling 20%", C.RISK_LIMITS.sizeCeilingPct === 20);
  ok("size floor 3%", C.RISK_LIMITS.sizeFloorPct === 3);
  ok("hard position cap 20%", C.RISK_LIMITS.hardPositionCapPct === 20);
  ok("stop is 2× ATR(14)", C.RISK_LIMITS.atrStopMultiple === 2);
  ok("max risk per trade 1.5% of NAV", C.RISK_LIMITS.maxRiskPerTradePct === 1.5);
  ok("max risk across open positions 8% of NAV", C.RISK_LIMITS.maxRiskOpenPct === 8);
  ok("correlation flag at 0.7", C.RISK_LIMITS.correlationFlag === 0.7);
  ok("no chasing a gap above 3%", C.RISK_LIMITS.maxChaseGapPct === 3);
}

section("The nine gates and the ten hard rules");
{
  ok("there are exactly nine gates", C.PRE_TRADE_GATES.length === 9, `${C.PRE_TRADE_GATES.length}`);
  ok("they are numbered 1 to 9", C.PRE_TRADE_GATES.every((g, i) => g.n === i + 1));
  ok("every gate names an owner", C.PRE_TRADE_GATES.every((g) => g.owner.length > 3));
  ok("gate 9 is the CIO sign-off", /CIO sign-off/.test(C.PRE_TRADE_GATES[8].label));

  ok("there are exactly ten hard rules", C.HARD_RULES.length === 10, `${C.HARD_RULES.length}`);
  ok("every hard rule has an id and text", C.HARD_RULES.every((r) => r.id && r.text.length > 10));
  for (const id of ["GATES", "ATR_STOP", "POSITION_CAP", "U_SCORES_ZERO", "WR_LABEL", "NO_CHASE", "NO_AVERAGE_DOWN", "STAGGER", "REPLACEMENT_FIRST", "TRAILING_STOP"]) {
    ok(`  hard rule ${id} is declared`, C.HARD_RULES.some((r) => r.id === id));
  }
}

section("Provenance");
{
  ok("the version names the source document", /investment-system/.test(C.FUND_CONSTITUTION_VERSION), C.FUND_CONSTITUTION_VERSION);
  ok("the version records the income-policy amendment", /11 August 2026/.test(C.FUND_CONSTITUTION_VERSION), C.FUND_CONSTITUTION_VERSION);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
