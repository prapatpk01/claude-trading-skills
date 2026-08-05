// Assertions for the Momentum-Centric Alpha Score.
//
// Candles are constructed to produce a known shape, so a failure points at the
// rule rather than at the market. The egress allowlist blocks the price hosts
// from this container; every case runs the real module over built series.
//
//   npm run test:swing

import { createRequire } from "node:module";
import path from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node scripts/test-swing.mjs <compiled-dir>"); process.exit(2); }
const require_ = createRequire(import.meta.url);
const { runSwingScan, readSwingRegime, ALPHA_WEIGHTS } = require_(path.resolve(outDir, "team/swing.js"));

let passed = 0, failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ───────────────────────── candle builders ────────────────────────── */

const day = (i) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

/** A series from a close path; highs/lows hug the close unless widened. */
function series(closes, { volume = 1_000_000, spread = 0.01 } = {}) {
  return closes.map((close, i) => ({
    date: day(i),
    open: close * (1 - spread / 2),
    high: close * (1 + spread),
    low: close * (1 - spread),
    close,
    volume: typeof volume === "function" ? volume(i, closes.length) : volume,
  }));
}

/** Steady drift, used for the benchmark. */
const drift = (n, from, to) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));

/**
 * A flat base then a breakout: a long advance, a shallow multi-week range, and
 * price emerging just above the range high.
 */
function flatBaseThenBreakout({ advance = 40, baseWeeks = 6, depthPct = 8, extendPct = 1.5, volumeSurge = 2 } = {}) {
  const run = drift(60, 100, 100 * (1 + advance / 100));
  const top = run.at(-1);
  const baseLen = Math.round(baseWeeks * 5);
  const base = Array.from({ length: baseLen }, (_, i) => {
    const t = i / (baseLen - 1);
    // Dip into the middle of the base, recover to the top.
    return top * (1 - (depthPct / 100) * Math.sin(Math.PI * t));
  });
  const out = [top * (1 + extendPct / 100)];
  const closes = [...run, ...base, ...out];
  const breakIndex = run.length + base.length;
  return series(closes, {
    volume: (i, n) => (i >= n - 5 ? 1_000_000 * volumeSurge : i >= breakIndex - 20 ? 900_000 : 1_000_000),
  });
}

/** The same shape but price far above the pivot — an extended chart. */
const extendedChart = () => flatBaseThenBreakout({ extendPct: 9 });

/** A downtrend: no base, price under its averages. */
function downtrend() {
  return series(drift(120, 100, 62));
}

const spy = series(drift(140, 400, 420));
const qqq = series(drift(140, 350, 372));
const calmVix = series(drift(60, 14, 13));
const stressVix = series(drift(60, 20, 24));

const benchmarks = { spy, qqq, vix: calmVix };

/* ───────────────────────────── the weights ────────────────────────── */

section("The brief's weighting");
{
  ok("momentum is the dominant factor at 40", ALPHA_WEIGHTS.momentum === 40);
  ok("volume accumulation is 25", ALPHA_WEIGHTS.volume === 25);
  ok("structure is 20", ALPHA_WEIGHTS.structure === 20);
  ok("catalyst drift is 15", ALPHA_WEIGHTS.catalyst === 15);
  ok("they total 100", Object.values(ALPHA_WEIGHTS).reduce((a, b) => a + b, 0) === 100);
}

/* ───────────────────────────── the regime ─────────────────────────── */

section("Market regime filter");
{
  const r = readSwingRegime(spy, qqq, calmVix);
  ok("a healthy tape is not defensive-only", !r.defensiveOnly, r.note);
  ok("it reports the VIX it read", r.vix != null);
  ok("both index tests are answered", r.spyAboveEma20 === true && r.qqqAboveEma20 === true);
}
{
  const r = readSwingRegime(spy, qqq, stressVix);
  ok("VIX above 18 forces outliers only", r.defensiveOnly, `vix ${r.vix}`);
  ok("the note names the VIX as the reason", /VIX at/.test(r.note), r.note);
}
{
  const r = readSwingRegime(downtrend(), qqq, calmVix);
  ok("SPY below its 20 EMA forces outliers only", r.defensiveOnly);
  ok("the note names the index", /SPY is below/.test(r.note), r.note);
}
{
  const r = readSwingRegime([], [], []);
  ok("with no index history the filter says so rather than passing", /unavailable/.test(r.note), r.note);
  ok("and the index tests read null, not false", r.spyAboveEma20 === null && r.qqqAboveEma20 === null);
}

/* ──────────────────────────── the setup ───────────────────────────── */

section("A qualifying setup");
{
  const result = runSwingScan(
    [{ ticker: "AAA", candles: flatBaseThenBreakout(), catalystScore: 18, catalystNote: "Post-earnings drift, third consecutive beat" }],
    benchmarks, 5
  );
  const s = result.setups[0];
  ok("it qualifies", s != null, JSON.stringify(result.rejected));
  if (s) {
    ok("a base type is named, never 'None'", s.setupType !== "None", s.setupType);
    ok("the entry is a range, not a single price", s.entryHigh > s.entryLow);
    ok("the entry is anchored to the pivot within 3%", s.entryHigh <= s.pivot * 1.0301, `${s.entryHigh} vs pivot ${s.pivot}`);
    ok("the target sits in the 10–25% band", s.expectedReturnPct >= 10 && s.expectedReturnPct <= 25, `${s.expectedReturnPct}%`);
    ok("reward:risk clears 1:3", s.riskReward >= 3, `1:${s.riskReward}`);
    ok("the stop is below the entry", s.stop < s.entryLow);
    ok("the target method is structural", /Fibonacci|Measured move/.test(s.targetMethod), s.targetMethod);
    ok("every scored line carries a detail sentence", s.lines.every((l) => l.detail.length > 15));
    ok("the four factors are all represented",
      new Set(s.lines.map((l) => l.factor)).size === 4, JSON.stringify(s.lines.map((l) => l.factor)));
    ok("the score is a percentage of what was measured", s.momentumScore >= 0 && s.momentumScore <= 100);
    ok("coverage is reported", s.coveragePct > 0 && s.coveragePct <= 100, `${s.coveragePct}%`);
    ok("the thesis names the entry, stop and target",
      s.notes.thesis.includes(String(s.stop)) && /Target/.test(s.notes.thesis));
  }
}

/* ─────────────────────────── the hard filters ─────────────────────── */

section("Filters reject rather than down-weight");
{
  const result = runSwingScan([{ ticker: "EXT", candles: extendedChart(), catalystScore: 20 }], benchmarks, 5);
  ok("an extended chart is rejected", result.setups.length === 0);
  ok("the rejection names the entry filter", result.rejected[0]?.filter === "ENTRY RANGE", JSON.stringify(result.rejected[0]));
  ok("it quotes how far above the pivot price sits", /% above the/.test(result.rejected[0].reason), result.rejected[0].reason);
}
{
  const result = runSwingScan([{ ticker: "DWN", candles: downtrend(), catalystScore: 20 }], benchmarks, 5);
  ok("a downtrend produces no setup", result.setups.length === 0);
  ok("and keeps a reason", result.rejected.length === 1 && result.rejected[0].reason.length > 20);
}
{
  const result = runSwingScan(
    [{ ticker: "AAA", candles: flatBaseThenBreakout(), catalystScore: 18 }],
    { spy, qqq, vix: stressVix }, 5
  );
  ok("a hostile tape rejects a non-outlier", result.setups.length === 0, JSON.stringify(result.setups.map((s) => s.ticker)));
  ok("the rejection cites the regime filter", result.rejected[0]?.filter === "MARKET REGIME");
  ok("and quotes the outlier bar it missed", /outlier bar/.test(result.rejected[0].reason));
}
{
  const result = runSwingScan([{ ticker: "SHORT", candles: series(drift(40, 100, 110)) }], benchmarks, 5);
  ok("too little history is a DATA rejection, not a zero score", result.rejected[0]?.filter === "DATA");
  ok("it says how many sessions it had", /\d+ sessions of history/.test(result.rejected[0].reason));
}

/* ─────────────────────── unmeasurable components ──────────────────── */

section("Rule #5 — unmeasured is not zero");
{
  const withCatalyst = runSwingScan([{ ticker: "AAA", candles: flatBaseThenBreakout(), catalystScore: 20, catalystNote: "PEAD" }], benchmarks, 5).setups[0];
  const without = runSwingScan([{ ticker: "AAA", candles: flatBaseThenBreakout() }], benchmarks, 5).setups[0];
  ok("both produce a setup", withCatalyst != null && without != null);
  if (withCatalyst && without) {
    ok("an unassessed catalyst leaves the denominator", without.coveragePct === 85, `${without.coveragePct}%`);
    ok("and is named as unmeasured", without.unmeasured.some((u) => /CATALYST/.test(u)), JSON.stringify(without.unmeasured));
    ok("the missing catalyst does not drag the score toward zero",
      without.momentumScore >= withCatalyst.momentumScore - 2, `${without.momentumScore} vs ${withCatalyst.momentumScore}`);
    ok("the note explains the exclusion rather than showing 0/15",
      /excluded from the denominator/.test(without.notes.catalyst));
  }
}
{
  const s = runSwingScan([{ ticker: "AAA", candles: flatBaseThenBreakout(), catalystScore: 18 }], benchmarks, 5).setups[0];
  ok("win probability is not invented", s.winProbabilityPct === null);
  ok("and the reason is stated", /closed-trade sample/.test(s.winProbabilityNote));
}

/* ──────────────────────────── ranking ─────────────────────────────── */

section("Ranking and output shape");
{
  const candidates = [
    { ticker: "STRONG", candles: flatBaseThenBreakout({ volumeSurge: 3 }), catalystScore: 24, catalystNote: "PEAD" },
    { ticker: "MID", candles: flatBaseThenBreakout({ volumeSurge: 1.2 }), catalystScore: 10, catalystNote: "Sector rotation" },
    { ticker: "WEAK", candles: flatBaseThenBreakout({ volumeSurge: 0.8 }), catalystScore: 2, catalystNote: "None named" },
  ];
  const result = runSwingScan(candidates, benchmarks, 5);
  ok("stronger accumulation and catalyst rank higher",
    result.setups[0].momentumScore >= result.setups.at(-1).momentumScore,
    result.setups.map((s) => `${s.ticker}:${s.momentumScore}`).join(" "));
  ok("the scan reports its universe size", result.universeSize === 3);
  ok("the methodology states the weighting", /40/.test(result.methodology) && /25/.test(result.methodology));
  ok("disclosures say rejections keep their reason", result.disclosures.some((d) => /keep their reason/i.test(d)));
  ok("disclosures say win probability is not quoted", result.disclosures.some((d) => /Win probability is not quoted/i.test(d)));
}
{
  const many = Array.from({ length: 9 }, (_, i) => ({ ticker: `T${i}`, candles: flatBaseThenBreakout(), catalystScore: 20 - i }));
  const result = runSwingScan(many, benchmarks, 5);
  ok("exactly five setups are returned", result.setups.length === 5, `${result.setups.length}`);
  ok("the rest are not silently dropped from the count", result.universeSize === 9);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
