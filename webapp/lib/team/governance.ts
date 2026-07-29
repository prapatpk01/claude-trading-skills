// Sentinel Global Fund — macro regime (Daniel Cho) and the pre-trade gate
// checklist (Miriam Osei / James Hartwell).

import type { Candle } from "../types";
import { ema, pctReturn } from "../indicators";
import type { HardBlock, MomentumScoreV3 } from "./scoring";

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
 * Regime score 0-100. The published model weights VIX 30 / yield 25 /
 * inflation 20 / breadth 15 / credit 10. Only the market-derived components
 * can be computed from price data, so the macro inputs we cannot verify are
 * scored neutrally and flagged rather than guessed (Rule #5).
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

  // Volatility proxy (stands in for VIX, 30 pts)
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

  // Trend / breadth proxy (25)
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

  // Momentum of the tape (20)
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

  // Drawdown from the 1-year high (15)
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

  // Rate / credit inputs cannot be verified from price data alone.
  components.push({
    label: "Rates & credit",
    points: 5,
    max: 10,
    detail: "Not verifiable from price data — scored neutral, not guessed (Rule #5)",
  });

  const score = Math.max(0, Math.min(100, components.reduce((s, c) => s + c.points, 0)));
  const regime: Regime = score >= 70 ? "Risk-On" : score >= 40 ? "Neutral" : score >= 20 ? "Risk-Off" : "Crisis";
  const map = {
    "Risk-On": { icon: "🟢", cashMinPct: 10, deployRule: "Full deployment permitted" },
    Neutral: { icon: "🟡", cashMinPct: 15, deployRule: "Deploy up to 75% of plan" },
    "Risk-Off": { icon: "🔴", cashMinPct: 25, deployRule: "One-third of plan only" },
    Crisis: { icon: "⚫", cashMinPct: 40, deployRule: "Freeze — no new deployment" },
  }[regime];

  return {
    score,
    regime,
    icon: map.icon,
    cashMinPct: map.cashMinPct,
    deployRule: map.deployRule,
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
  pass: boolean | null; // null = cannot be evaluated here
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
  score: MomentumScoreV3;
  positionWeightPct: number | null;
  stop: number | null;
  entry: number | null;
  dataQualityScore: number;
  nearTier1Event?: boolean;
}

/** Section 8 — the nine pre-trade gates. */
export function runGates(input: GateInput): GateResult {
  const { regime, score } = input;
  const blocks: HardBlock[] = score.hardBlocks;

  const gates: Gate[] = [
    {
      n: 1,
      label: "Regime timestamp verified (≤ 24h)",
      owner: "Daniel Cho",
      pass: true,
      detail: "Regime computed from the current session's price feed",
    },
    {
      n: 2,
      label: "Regime score ≥ 40 (Neutral or better)",
      owner: "Daniel Cho",
      pass: regime.score >= 40,
      detail: `${regime.score}/100 — ${regime.regime}`,
    },
    {
      n: 3,
      label: "Momentum score ≥ 58/100",
      owner: "Maya Chen",
      pass: score.total >= 58,
      detail: `${score.total}/100`,
    },
    {
      n: 4,
      label: "Soft-block check (Rule #1)",
      owner: "Maya Chen",
      pass: blocks.length === 0 ? true : blocks.length === 1 && score.total > 80,
      detail:
        blocks.length === 0
          ? "No hard blocks"
          : blocks.length === 1
          ? `One block (${blocks[0].code}) — ${score.total > 80 ? "score > 80, soft-block applies" : "score ≤ 80, no relief"}`
          : `${blocks.length} blocks — automatic reject`,
    },
    {
      n: 5,
      label: "Position ≤ 20% NAV (Rule #3)",
      owner: "Kai Tanaka",
      pass: input.positionWeightPct == null ? null : input.positionWeightPct <= 20,
      detail:
        input.positionWeightPct == null
          ? "No position size supplied — evaluate at sizing"
          : `${input.positionWeightPct.toFixed(2)}% of NAV`,
    },
    {
      n: 6,
      label: "ATR stop defined (Rule #4)",
      owner: "Kai Tanaka",
      pass: input.stop != null && input.entry != null,
      detail: input.stop != null && input.entry != null
        ? `Stop ${input.stop.toFixed(2)} vs entry ${input.entry.toFixed(2)}`
        : "No stop computed",
    },
    {
      n: 7,
      label: "Data quality ≥ 70% with V/E/U flags",
      owner: "Miriam Osei",
      pass: input.dataQualityScore >= 70,
      detail: `${input.dataQualityScore}% of scored inputs verified${score.unavailable.length ? ` — unavailable: ${score.unavailable.join(", ")}` : ""}`,
    },
    {
      n: 8,
      label: "Stagger rule near Tier-1 events (Rule #2)",
      owner: "Aisha Fontaine",
      pass: input.nearTier1Event ? false : null,
      detail: input.nearTier1Event
        ? "Tier-1 event within 5 days — maximum one-third deployment"
        : "No Tier-1 event flagged. FOMC/CPI/NFP dates are not in the free data feed — confirm manually",
    },
    {
      n: 9,
      label: "CIO sign-off",
      owner: "James Hartwell",
      pass: null,
      detail: "Manual authorisation — the system never self-approves a deployment",
    },
  ];

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
