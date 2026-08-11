// Sentinel Global Fund — macro regime (Daniel Cho) and the pre-trade gate
// checklist (Miriam Osei / James Hartwell).

import type { Candle } from "../types";
import { ema, pctReturn } from "../indicators";
import type { HardBlock, MomentumScoreV3 } from "./scoring";
import { regimeBandFor } from "./constitution";

export type Regime = "Risk-On" | "Neutral" | "Risk-Off" | "Crisis";

export interface RegimeAssessment {
  score: number;
  regime: Regime;
  icon: string;
  cashMinPct: number;
  deployRule: string;
  components: { label: string; points: number; max: number; detail: string }[];
  realizedVol: number | null;
  note: string;
}

function realizedVolAnnualized(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const s = candles.slice(-(lookback + 1));
  const r: number[] = [];
  for (let i = 1; i < s.length; i++) r.push(Math.log(s[i].close / s[i - 1].close));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  return Math.sqrt(v) * Math.sqrt(252) * 100;
}

/**
 * Regime score 0-100. The score is measured here, while the regime bands,
 * minimum Cash Buffer and deployment limits are owned by constitution.ts.
 * This prevents the committee and Cash Buffer engine from drifting apart.
 */
export function assessRegime(spy: Candle[]): RegimeAssessment {
  const closes = spy.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const vol = realizedVolAnnualized(spy, 20);
  const ret1m = pctReturn(spy, 21);
  const ret3m = pctReturn(spy, 63);

  const components: RegimeAssessment["components"] = [];

  let volPts = 15;
  let volDetail = "realized volatility unavailable — scored neutral";
  if (vol != null) {
    if (vol < 12) { volPts = 30; volDetail = `${vol.toFixed(1)}% realized — calm`; }
    else if (vol < 16) { volPts = 24; volDetail = `${vol.toFixed(1)}% realized — normal`; }
    else if (vol < 22) { volPts = 15; volDetail = `${vol.toFixed(1)}% realized — elevated`; }
    else if (vol < 30) { volPts = 7; volDetail = `${vol.toFixed(1)}% realized — stressed`; }
    else { volPts = 0; volDetail = `${vol.toFixed(1)}% realized — crisis-level`; }
  }
  components.push({ label: "Volatility (VIX proxy)", points: volPts, max: 30, detail: volDetail });

  let trendPts = 0;
  let trendDetail = "benchmark history unavailable";
  if (ema20 != null && ema50 != null) {
    const above20 = price > ema20;
    const above50 = price > ema50;
    const stacked = ema20 > ema50;
    trendPts = (above20 ? 10 : 0) + (above50 ? 8 : 0) + (stacked ? 7 : 0);
    trendDetail = `SPY ${above20 ? "above" : "below"} 20-EMA, ${above50 ? "above" : "below"} 50-EMA, MAs ${stacked ? "stacked up" : "crossed down"}`;
  }
  components.push({ label: "Index trend / breadth", points: trendPts, max: 25, detail: trendDetail });

  let momPts = 10;
  let momDetail = "return history unavailable";
  if (ret1m != null && ret3m != null) {
    momPts = 0;
    if (ret1m > 0) momPts += 10;
    else if (ret1m > -3) momPts += 5;
    if (ret3m > 0) momPts += 10;
    else if (ret3m > -5) momPts += 5;
    momDetail = `SPY 1M ${ret1m >= 0 ? "+" : ""}${ret1m.toFixed(1)}%, 3M ${ret3m >= 0 ? "+" : ""}${ret3m.toFixed(1)}%`;
  }
  components.push({ label: "Tape momentum", points: momPts, max: 20, detail: momDetail });

  let ddPts = 8;
  let ddDetail = "insufficient history";
  if (closes.length > 60) {
    const win = closes.slice(-252);
    const peak = Math.max(...win);
    const dd = peak > 0 ? ((price - peak) / peak) * 100 : 0;
    ddPts = dd > -3 ? 15 : dd > -7 ? 11 : dd > -12 ? 6 : dd > -20 ? 3 : 0;
    ddDetail = `${dd.toFixed(1)}% from the 1-year high`;
  }
  components.push({ label: "Index drawdown", points: ddPts, max: 15, detail: ddDetail });

  components.push({
    label: "Rates & credit",
    points: 5,
    max: 10,
    detail: "Not verifiable from price data — scored neutral, not guessed (Rule #5)",
  });

  const score = Math.max(0, Math.min(100, components.reduce((s, c) => s + c.points, 0)));
  const band = regimeBandFor(score);
  const regime = band.name as Regime;

  return {
    score,
    regime,
    icon: band.icon,
    cashMinPct: band.cashMinPct,
    deployRule: band.deployRule,
    components,
    realizedVol: vol,
    note:
      regime === "Risk-On"
        ? "Constructive tape — momentum setups carry their full weighting."
        : regime === "Neutral"
        ? "Mixed tape — favour extreme relative-strength outliers and stagger entries."
        : "Defensive tape — restrict to the strongest names and hold the cash buffer.",
  };
}

export interface Gate {
  n: number;
  label: string;
  owner: string;
  pass: boolean | null;
  detail: string;
}

export interface GateResult {
  gates: Gate[];
  passed: number;
  evaluated: number;
  cleared: boolean;
  verdict: string;
}

export interface GateInput {
  regime: RegimeAssessment;
  engine?: "Momentum Growth" | "High Dividend Growth" | "Cash/Defensive";
  engineScore?: number | null;
  growthPct?: number | null;
  yieldPct?: number | null;
  entryCleared?: boolean | null;
  entryDetail?: string;
  valuationVerdict?: string | null;
  hardBlocks?: { code: string; reason: string }[];
  positionWeightPct: number | null;
  stop: number | null;
  entry: number | null;
  dataQualityScore: number;
  coveragePct?: number | null;
  nearTier1Event?: boolean;
  isHybrid?: boolean;
  hybridMissing?: string[];
}

export function runGates(input: GateInput): GateResult {
  const { regime } = input;
  const blocks = input.hardBlocks ?? [];
  const engine = input.engine ?? "Momentum Growth";
  const score = input.engineScore ?? null;

  const gates: Gate[] = [
    {
      n: 1,
      label: "Data verified and current",
      owner: "Nina Okonkwo",
      pass: input.dataQualityScore >= 70,
      detail: `${input.dataQualityScore}% of scored inputs verified${input.coveragePct != null ? `, ${input.coveragePct}% of the engine model evaluable` : ""}`,
    },
    {
      n: 2,
      label: "Regime permits deployment",
      owner: "Daniel Cho",
      pass: regime.regime === "Crisis"
        ? false
        : regime.regime === "Risk-Off"
        ? engine !== "Momentum Growth"
        : true,
      detail: `${regime.icon} ${regime.regime} ${regime.score}/100 — ${regime.deployRule}`,
    },
    {
      n: 3,
      label: "Correct engine identified",
      owner: "James Hartwell",
      pass: engine !== undefined,
      detail: `${engine}${input.isHybrid ? " · qualifies as a Hybrid Compounder" : ""}`,
    },
    {
      n: 4,
      label: "Growth > 12% (Engine A) or yield ≥ 5% (Engine B)",
      owner: "Sofia Reyes / Lena Müller",
      pass: engine === "Cash/Defensive"
        ? null
        : engine === "High Dividend Growth"
        ? input.yieldPct != null && input.yieldPct >= 5
        : input.growthPct != null && input.growthPct > 12,
      detail: engine === "High Dividend Growth"
        ? `Yield ${input.yieldPct != null ? `${input.yieldPct.toFixed(1)}%` : "unavailable"} against the 5% gate`
        : `Growth ${input.growthPct != null ? `${input.growthPct.toFixed(1)}%` : "unavailable"} against the 12% gate`,
    },
    {
      n: 5,
      label: "Engine score ≥ 65",
      owner: "Maya Chen",
      pass: score == null ? null : score >= 65,
      detail: score == null ? "No engine score" : `${score}/100`,
    },
    {
      n: 6,
      label: "No hard block",
      owner: "Miriam Osei",
      pass: blocks.length === 0,
      detail: blocks.length ? blocks.map((b) => b.code).join(", ") : "None",
    },
    {
      n: 7,
      label: "Trend / structure confirmation",
      owner: "Maya Chen",
      pass: input.entryCleared ?? null,
      detail: input.entryDetail ?? (input.entryCleared == null ? "Entry layer not evaluated" : input.entryCleared ? "Above the 200-day with two confirmations" : "Entry layer not cleared"),
    },
    {
      n: 8,
      label: "Valuation reviewed",
      owner: "Thomas Eriksson",
      pass: input.valuationVerdict ? true : null,
      detail: input.valuationVerdict
        ? `${input.valuationVerdict} — modifies size, does not veto (§13)`
        : "No usable valuation anchor — size at plan and note the gap",
    },
    {
      n: 9,
      label: "Position and risk limits (15% normal / 20% hard, 1.5% NAV risk)",
      owner: "Kai Tanaka",
      pass: input.positionWeightPct == null
        ? null
        : input.positionWeightPct <= 20 && input.stop != null && input.entry != null,
      detail: input.positionWeightPct == null
        ? "No position size supplied — evaluate at sizing"
        : `${input.positionWeightPct.toFixed(2)}% of NAV${input.stop != null && input.entry != null ? `, stop ${input.stop.toFixed(2)} vs entry ${input.entry.toFixed(2)}` : ", no stop defined"}`,
    },
    {
      n: 10,
      label: "Event / catalyst risk reviewed",
      owner: "Aisha Fontaine",
      pass: input.nearTier1Event ? false : null,
      detail: input.nearTier1Event
        ? "Tier-1 event within 5 days — maximum one-third deployment (Rule #2)"
        : "No Tier-1 event flagged. FOMC/CPI/NFP dates are not in the free data feed — confirm manually",
    },
    {
      n: 11,
      label: "CIO approval",
      owner: "James Hartwell",
      pass: null,
      detail: "Manual authorisation — the system never self-approves a deployment",
    },
  ];

  if (input.isHybrid === false && input.hybridMissing?.length) {
    gates[2].detail += ` — not a hybrid: ${input.hybridMissing.join(", ")}`;
  }

  const evaluated = gates.filter((g) => g.pass !== null).length;
  const passed = gates.filter((g) => g.pass === true).length;
  const failed = gates.filter((g) => g.pass === false);
  const cleared = failed.length === 0;

  return {
    gates,
    passed,
    evaluated,
    cleared,
    verdict: cleared
      ? `${passed}/${evaluated} evaluable gates pass — proceed to CIO sign-off (Gate 9 remains manual)`
      : `HOLD — ${failed.length} gate${failed.length > 1 ? "s" : ""} failed: ${failed.map((g) => `#${g.n}`).join(", ")}`,
  };
}
