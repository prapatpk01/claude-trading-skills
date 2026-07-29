// Sentinel Global Fund — Team Rules v4.0, the two alpha engines.
//
//   Engine A  Momentum Growth        growth > 12% AND price confirmation
//   Engine B  High Dividend Growth   yield >= 5% AND a durable, growing payout
//
// The governing principle is that neither half is sufficient alone:
//
//   Growth without momentum      = WAIT
//   Momentum without growth      = TACTICAL ONLY
//   High yield without quality   = REJECT
//   Growth + yield + momentum    = PRIORITY (Hybrid Compounder)
//
// Scoring honesty. Several v4 inputs — forward estimates, analyst revisions,
// distribution coverage for a fund — are not available from free, keyless
// sources. Rule #5 forbids guessing them, so an unavailable component scores
// zero and is named. Left there, that would quietly push every score below the
// 65 entry bar for want of data rather than for want of quality. So each engine
// reports three numbers: points earned, points that could be evaluated, and a
// coverage-normalised score. The signal is taken from the normalised score, and
// coverage is published beside it.

import type { Candle } from "../types";
import { sma, rsi, macd, adx, obv, pctReturn, dollarVolume, avgVolume } from "../indicators";

export type Engine = "Momentum Growth" | "High Dividend Growth" | "Cash/Defensive" | "Unqualified";
export type EngineSignal = "ELITE BUY" | "STRONG BUY" | "BUY" | "WATCH" | "REJECT";

/** Minimum growth for Engine A; minimum yield for Engine B. */
export const GROWTH_GATE_PCT = 12;
export const YIELD_GATE_PCT = 5;
/** New positions require this score. */
export const ENTRY_SCORE = 65;

export interface ScoreLine {
  label: string;
  points: number;
  max: number;
  detail: string;
  /** False when the input was unavailable — excluded from the normalised score. */
  evaluated: boolean;
}

export interface HardBlock {
  code: string;
  reason: string;
  /** Blocks entry only, or also calls for an exit review. */
  severity: "entry" | "exit-review";
}

export interface EngineScore {
  engine: Engine;
  /** Points earned. */
  raw: number;
  /** Points that could be evaluated at all. */
  evaluable: number;
  /** raw / evaluable × 100 — the number the signal is taken from. */
  score: number;
  coveragePct: number;
  signal: EngineSignal;
  signalReason: string;
  lines: ScoreLine[];
  blocks: HardBlock[];
  unavailable: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r1 = (x: number) => Math.round(x * 10) / 10;

function signalFor(score: number, blocks: HardBlock[]): { signal: EngineSignal; reason: string } {
  const entryBlocks = blocks.filter((b) => b.severity === "entry" || b.severity === "exit-review");
  if (entryBlocks.length) {
    return {
      signal: "REJECT",
      reason: `Hard block — ${entryBlocks.map((b) => b.code).join(", ")}. ${entryBlocks[0].reason}`,
    };
  }
  if (score >= 85) return { signal: "ELITE BUY", reason: `Score ${score} — elite` };
  if (score >= 75) return { signal: "STRONG BUY", reason: `Score ${score} in 75-84` };
  if (score >= ENTRY_SCORE) return { signal: "BUY", reason: `Score ${score} in 65-74 — meets the entry bar` };
  if (score >= 55) return { signal: "WATCH", reason: `Score ${score} in 55-64 — below the 65 entry bar` };
  return { signal: "REJECT", reason: `Score ${score} < 55` };
}

function finish(engine: Engine, lines: ScoreLine[], blocks: HardBlock[]): EngineScore {
  const raw = lines.reduce((s, l) => s + l.points, 0);
  const evaluable = lines.filter((l) => l.evaluated).reduce((s, l) => s + l.max, 0);
  const total = lines.reduce((s, l) => s + l.max, 0);
  const score = evaluable > 0 ? Math.round((raw / evaluable) * 100) : 0;
  const { signal, reason } = signalFor(score, blocks);
  return {
    engine,
    raw: r1(raw),
    evaluable,
    score,
    coveragePct: total > 0 ? Math.round((evaluable / total) * 100) : 0,
    signal,
    signalReason: reason,
    lines,
    blocks,
    unavailable: lines.filter((l) => !l.evaluated).map((l) => l.label),
  };
}

// ── Growth classification ────────────────────────────────────────────────

export type GrowthClass = "Hyper Growth" | "Strong Growth" | "Qualified Growth" | "Watch" | "Reject";

export function classifyGrowth(growthPct: number | null): GrowthClass {
  if (growthPct == null) return "Reject";
  if (growthPct >= 25) return "Hyper Growth";
  if (growthPct >= 18) return "Strong Growth";
  if (growthPct >= GROWTH_GATE_PCT) return "Qualified Growth";
  if (growthPct >= 8) return "Watch";
  return "Reject";
}

export interface GrowthInput {
  /** Year-on-year revenue growth, percent. */
  revenueGrowthPct: number | null;
  epsGrowthPct: number | null;
  revenueCagr3yPct: number | null;
  epsCagr3yPct: number | null;
  /** Forward estimates — usually unavailable from free sources. */
  forwardRevenueGrowthPct?: number | null;
  forwardEpsGrowthPct?: number | null;
  epsRevisionPositive?: boolean | null;
  marginTrend?: "rising" | "stable" | "falling" | null;
  fcfPositive?: boolean | null;
  /** ETFs are assessed on the exposure, not on company metrics. */
  isFund?: boolean;
}

/**
 * The best available growth driver, and how many independent drivers clear the
 * 12% gate. v4 asks for one driver above the gate with at least two supporting.
 */
export function growthDrivers(g: GrowthInput): {
  best: number | null;
  clearing: number;
  available: number;
  labels: string[];
} {
  const drivers: [string, number | null][] = [
    ["Forward revenue growth", g.forwardRevenueGrowthPct ?? null],
    ["Forward EPS growth", g.forwardEpsGrowthPct ?? null],
    ["Revenue growth", g.revenueGrowthPct],
    ["EPS growth", g.epsGrowthPct],
    ["3Y revenue CAGR", g.revenueCagr3yPct],
    ["3Y EPS CAGR", g.epsCagr3yPct],
  ];
  const present = drivers.filter(([, v]) => v != null) as [string, number][];
  const clearing = present.filter(([, v]) => v >= GROWTH_GATE_PCT);
  return {
    best: present.length ? Math.max(...present.map(([, v]) => v)) : null,
    clearing: clearing.length,
    available: present.length,
    labels: clearing.map(([k, v]) => `${k} ${v.toFixed(1)}%`),
  };
}

// ── Shared price-structure reads ─────────────────────────────────────────

export interface StructureRead {
  price: number;
  sma50: number | null;
  sma200: number | null;
  above200: boolean | null;
  above50: boolean | null;
  goldenStack: boolean | null;
  higherHighs: boolean | null;
  rs3mPct: number | null;
  rs6mPct: number | null;
  rsiVal: number | null;
  macdAboveSignal: boolean | null;
  adxVal: number | null;
  breakoutVolume: boolean | null;
  obvRising: boolean | null;
  upDownVolume: number | null;
  dollarVolM: number | null;
  /** Distance above the 200-day, used to spot parabolic extension. */
  extensionPct: number | null;
}

export function readStructure(candles: Candle[], benchmark: Candle[]): StructureRead {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const s50 = closes.length >= 50 ? sma(closes, 50) : null;
  const s200 = closes.length >= 200 ? sma(closes, 200) : null;
  const m = macd(closes);
  const o = obv(candles);

  const ret = (lb: number) => pctReturn(candles, lb);
  const bench = (lb: number) => (benchmark.length ? pctReturn(benchmark, lb) : null);
  const rel = (lb: number) => {
    const a = ret(lb), b = bench(lb);
    return a != null && b != null ? a - b : null;
  };

  // Higher highs and higher lows over the last three months, in monthly blocks.
  let higherHighs: boolean | null = null;
  if (candles.length >= 63) {
    const blocks = [candles.slice(-63, -42), candles.slice(-42, -21), candles.slice(-21)];
    if (blocks.every((b) => b.length > 0)) {
      const hi = blocks.map((b) => Math.max(...b.map((c) => c.high)));
      const lo = blocks.map((b) => Math.min(...b.map((c) => c.low)));
      higherHighs = hi[2] > hi[1] && hi[1] > hi[0] && lo[2] > lo[0];
    }
  }

  const av = avgVolume(candles, 50);
  const lastVol = candles[candles.length - 1]?.volume ?? 0;

  // Up/down volume ratio over the last 50 sessions.
  let upDown: number | null = null;
  if (candles.length >= 51) {
    let up = 0, down = 0;
    for (let i = candles.length - 50; i < candles.length; i++) {
      const d = candles[i].close - candles[i - 1].close;
      if (d > 0) up += candles[i].volume; else if (d < 0) down += candles[i].volume;
    }
    upDown = down > 0 ? up / down : up > 0 ? 3 : null;
  }

  const dv = dollarVolume(candles, 20);

  return {
    price,
    sma50: s50,
    sma200: s200,
    above200: s200 != null ? price > s200 : null,
    above50: s50 != null ? price > s50 : null,
    goldenStack: s50 != null && s200 != null ? s50 > s200 : null,
    higherHighs,
    rs3mPct: rel(63),
    rs6mPct: rel(126),
    rsiVal: rsi(closes, 14),
    macdAboveSignal: m ? m.macd > m.signal : null,
    adxVal: adx(candles, 14),
    breakoutVolume: av != null && av > 0 ? lastVol > av * 1.4 : null,
    obvRising: o ? o.rising : null,
    upDownVolume: upDown,
    dollarVolM: dv != null ? dv / 1e6 : null,
    extensionPct: s200 != null && s200 > 0 ? ((price - s200) / s200) * 100 : null,
  };
}

// ── Engine A — Momentum Growth ───────────────────────────────────────────

export interface EngineAInput {
  growth: GrowthInput;
  structure: StructureRead;
  /** Aisha's catalyst read, 0-10 on this engine's scale. */
  catalystScore?: number | null;
  catalystDetail?: string;
  daysToEarnings?: number | null;
}

export function scoreEngineA(input: EngineAInput): EngineScore {
  const { growth: g, structure: s } = input;
  const lines: ScoreLine[] = [];
  const blocks: HardBlock[] = [];

  const drivers = growthDrivers(g);
  const growthClass = classifyGrowth(drivers.best);

  // ── Growth Quality 30 ──
  {
    // Revenue/EPS growth 15
    const core = [g.revenueGrowthPct, g.epsGrowthPct, g.revenueCagr3yPct, g.epsCagr3yPct]
      .filter((v): v is number => v != null);
    if (core.length) {
      const best = Math.max(...core);
      const pts = best >= 25 ? 15 : best >= 18 ? 13 : best >= 12 ? 10 : best >= 8 ? 5 : 0;
      lines.push({ label: "Revenue / EPS growth", points: pts, max: 15, evaluated: true,
        detail: `${growthClass} — best driver ${best.toFixed(1)}%, ${drivers.clearing} of ${drivers.available} drivers above the ${GROWTH_GATE_PCT}% gate` });
    } else {
      lines.push({ label: "Revenue / EPS growth", points: 0, max: 15, evaluated: false,
        detail: g.isFund ? "Fund — company growth metrics do not apply; assess on underlying exposure" : "No revenue or EPS history available [U]" });
    }

    // Forward growth 8
    const fwd = [g.forwardRevenueGrowthPct, g.forwardEpsGrowthPct].filter((v): v is number => v != null);
    if (fwd.length) {
      const best = Math.max(...fwd);
      lines.push({ label: "Forward growth", points: best >= 18 ? 8 : best >= 12 ? 6 : best >= 8 ? 3 : 0, max: 8, evaluated: true,
        detail: `Forward estimate ${best.toFixed(1)}%` });
    } else {
      lines.push({ label: "Forward growth", points: 0, max: 8, evaluated: false,
        detail: "Forward estimates are not in the free data feed [U] — scored zero and excluded, not guessed (Rule #5)" });
    }

    // EPS revision 4
    if (g.epsRevisionPositive != null) {
      lines.push({ label: "EPS revision", points: g.epsRevisionPositive ? 4 : 0, max: 4, evaluated: true,
        detail: g.epsRevisionPositive ? "Estimates revised up" : "Estimates revised down" });
      if (g.epsRevisionPositive === false) {
        blocks.push({ code: "NEGATIVE_REVISION_SHOCK", reason: "Estimates revised down", severity: "entry" });
      }
    } else {
      lines.push({ label: "EPS revision", points: 0, max: 4, evaluated: false, detail: "Analyst revisions unavailable [U]" });
    }

    // Margin / FCF quality 3
    if (g.marginTrend != null || g.fcfPositive != null) {
      let pts = 0;
      const bits: string[] = [];
      if (g.marginTrend === "rising") { pts += 2; bits.push("margins rising"); }
      else if (g.marginTrend === "stable") { pts += 1; bits.push("margins stable"); }
      else if (g.marginTrend === "falling") bits.push("margins falling");
      if (g.fcfPositive) { pts += 1; bits.push("FCF positive"); }
      else if (g.fcfPositive === false) bits.push("FCF negative");
      lines.push({ label: "Margin / FCF quality", points: Math.min(3, pts), max: 3, evaluated: true, detail: bits.join(", ") });
    } else {
      lines.push({ label: "Margin / FCF quality", points: 0, max: 3, evaluated: false, detail: "Margin and cash-flow trend unavailable [U]" });
    }
  }

  // ── Momentum & Relative Strength 30 ──
  {
    if (s.rs3mPct != null) {
      const v = s.rs3mPct;
      lines.push({ label: "Relative strength vs SPY", points: v >= 15 ? 10 : v >= 8 ? 8 : v >= 3 ? 6 : v >= 0 ? 3 : 0, max: 10, evaluated: true,
        detail: `${v >= 0 ? "+" : ""}${v.toFixed(1)}% over 3 months` });
    } else lines.push({ label: "Relative strength vs SPY", points: 0, max: 10, evaluated: false, detail: "Benchmark history unavailable [U]" });

    const r3 = pctReturnSafe(s.rs3mPct), r6 = pctReturnSafe(s.rs6mPct);
    if (r3 != null || r6 != null) {
      let pts = 0;
      if ((s.rs3mPct ?? 0) > 0) pts += 3;
      if ((s.rs6mPct ?? 0) > 0) pts += 3;
      lines.push({ label: "3M / 6M momentum", points: pts, max: 6, evaluated: true,
        detail: `3M ${fmt(s.rs3mPct)}, 6M ${fmt(s.rs6mPct)} vs SPY` });
    } else lines.push({ label: "3M / 6M momentum", points: 0, max: 6, evaluated: false, detail: "Insufficient history [U]" });

    if (s.rsiVal != null) {
      const v = s.rsiVal;
      lines.push({ label: "RSI", points: v >= 55 && v <= 75 ? 4 : v > 75 ? 2 : v >= 45 ? 2 : 0, max: 4, evaluated: true,
        detail: `RSI ${v.toFixed(1)}${v > 75 ? " — extended" : ""}` });
      if (v < 45) blocks.push({ code: "MAJOR_DOWNTREND", reason: `RSI ${v.toFixed(1)} below 45`, severity: "entry" });
    } else lines.push({ label: "RSI", points: 0, max: 4, evaluated: false, detail: "Unavailable [U]" });

    if (s.macdAboveSignal != null) {
      lines.push({ label: "MACD", points: s.macdAboveSignal ? 4 : 0, max: 4, evaluated: true,
        detail: s.macdAboveSignal ? "MACD above signal" : "MACD below signal" });
    } else lines.push({ label: "MACD", points: 0, max: 4, evaluated: false, detail: "Unavailable [U]" });

    if (s.adxVal != null) {
      lines.push({ label: "ADX", points: s.adxVal >= 25 ? 3 : s.adxVal >= 20 ? 2 : 0, max: 3, evaluated: true,
        detail: `ADX ${s.adxVal.toFixed(1)}` });
    } else lines.push({ label: "ADX", points: 0, max: 3, evaluated: false, detail: "Unavailable [U]" });

    // Acceleration: 3-month strength outpacing 6-month.
    if (s.rs3mPct != null && s.rs6mPct != null) {
      const accel = s.rs3mPct > s.rs6mPct / 2;
      lines.push({ label: "Momentum acceleration", points: accel ? 3 : 0, max: 3, evaluated: true,
        detail: accel ? "3-month strength outpacing the 6-month run rate" : "Momentum decelerating" });
    } else lines.push({ label: "Momentum acceleration", points: 0, max: 3, evaluated: false, detail: "Insufficient history [U]" });
  }

  // ── Trend & Structure 20 ──
  {
    if (s.above200 != null) {
      lines.push({ label: "Price > 200DMA", points: s.above200 ? 5 : 0, max: 5, evaluated: true,
        detail: `${s.price.toFixed(2)} vs 200DMA ${s.sma200?.toFixed(2)}` });
      if (!s.above200) blocks.push({ code: "BELOW_200SMA", reason: `Price ${s.price.toFixed(2)} below the 200-day ${s.sma200?.toFixed(2)}`, severity: "entry" });
    } else lines.push({ label: "Price > 200DMA", points: 0, max: 5, evaluated: false, detail: "Under 200 sessions of history [U]" });

    if (s.goldenStack != null) {
      lines.push({ label: "50DMA > 200DMA", points: s.goldenStack ? 5 : 0, max: 5, evaluated: true,
        detail: s.goldenStack ? "Moving averages stacked up" : "50-day below the 200-day" });
    } else lines.push({ label: "50DMA > 200DMA", points: 0, max: 5, evaluated: false, detail: "Insufficient history [U]" });

    if (s.above50 != null) {
      lines.push({ label: "Price > 50DMA", points: s.above50 ? 3 : 0, max: 3, evaluated: true,
        detail: s.above50 ? "Above the 50-day" : "Below the 50-day" });
    } else lines.push({ label: "Price > 50DMA", points: 0, max: 3, evaluated: false, detail: "Insufficient history [U]" });

    if (s.higherHighs != null) {
      lines.push({ label: "Higher high / higher low", points: s.higherHighs ? 4 : 0, max: 4, evaluated: true,
        detail: s.higherHighs ? "Sequence of higher highs and higher lows" : "Structure not making higher highs" });
      if (!s.higherHighs && s.above200 === false) {
        // v4 §5 — a price break alone blocks a new entry; it escalates to an
        // exit review only when the growth thesis has broken with it. Entry
        // failure is not thesis failure, and a compounder in a drawdown is not
        // thereby a sale.
        const growthIntact = drivers.best != null && drivers.best >= GROWTH_GATE_PCT;
        blocks.push({
          code: "STRUCTURE_BROKEN",
          reason: growthIntact
            ? `No higher highs and price below the 200-day, but growth remains ${drivers.best!.toFixed(1)}% — blocks a new entry, not a holding`
            : "No higher highs, price below the 200-day, and growth below the gate",
          severity: growthIntact ? "entry" : "exit-review",
        });
      }
    } else lines.push({ label: "Higher high / higher low", points: 0, max: 4, evaluated: false, detail: "Insufficient history [U]" });

    if (s.breakoutVolume != null || s.above50 != null) {
      const base = s.extensionPct != null && s.extensionPct < 30 && s.above50 === true;
      lines.push({ label: "Breakout / base structure", points: base ? 3 : 0, max: 3, evaluated: true,
        detail: s.extensionPct != null
          ? `${s.extensionPct >= 0 ? "+" : ""}${s.extensionPct.toFixed(1)}% from the 200-day${s.extensionPct >= 30 ? " — extended, not a base" : ""}`
          : "Structure unclear" });
    } else lines.push({ label: "Breakout / base structure", points: 0, max: 3, evaluated: false, detail: "Insufficient history [U]" });
  }

  // ── Volume & Institutional Confirmation 10 ──
  {
    if (s.upDownVolume != null) {
      const v = s.upDownVolume;
      lines.push({ label: "Volume accumulation", points: v >= 1.5 ? 4 : v >= 1.1 ? 3 : v >= 0.9 ? 1 : 0, max: 4, evaluated: true,
        detail: `Up/down volume ${v.toFixed(2)}×` });
    } else lines.push({ label: "Volume accumulation", points: 0, max: 4, evaluated: false, detail: "Unavailable [U]" });

    if (s.obvRising != null) {
      lines.push({ label: "OBV trend", points: s.obvRising ? 2 : 0, max: 2, evaluated: true,
        detail: s.obvRising ? "OBV rising" : "OBV falling — distribution" });
    } else lines.push({ label: "OBV trend", points: 0, max: 2, evaluated: false, detail: "Unavailable [U]" });

    if (s.upDownVolume != null) {
      lines.push({ label: "Up / down volume", points: s.upDownVolume >= 1.25 ? 2 : s.upDownVolume >= 1 ? 1 : 0, max: 2, evaluated: true,
        detail: `${s.upDownVolume.toFixed(2)}×` });
    } else lines.push({ label: "Up / down volume", points: 0, max: 2, evaluated: false, detail: "Unavailable [U]" });

    if (s.breakoutVolume != null) {
      lines.push({ label: "Breakout volume", points: s.breakoutVolume ? 2 : 0, max: 2, evaluated: true,
        detail: s.breakoutVolume ? "Latest session above 1.4× the 50-day average" : "No volume expansion" });
    } else lines.push({ label: "Breakout volume", points: 0, max: 2, evaluated: false, detail: "Unavailable [U]" });
  }

  // ── Catalyst 10 ──
  if (input.catalystScore != null) {
    lines.push({ label: "Catalyst", points: clamp(input.catalystScore, 0, 10), max: 10, evaluated: true,
      detail: input.catalystDetail ?? "Catalyst assessed" });
  } else {
    lines.push({ label: "Catalyst", points: 0, max: 10, evaluated: false,
      detail: "No catalyst assessment available [U] — earnings revisions, product cycle and guidance are not in the free feed" });
  }

  // ── Hard blocks not derived from a scored line ──
  if (drivers.best == null) {
    if (!g.isFund) {
      blocks.push({ code: "GROWTH_LT_12", reason: "No growth history available — the 12% gate cannot be cleared", severity: "entry" });
    }
  } else if (drivers.best < GROWTH_GATE_PCT) {
    blocks.push({ code: "GROWTH_LT_12", reason: `Best growth driver ${drivers.best.toFixed(1)}% is below the ${GROWTH_GATE_PCT}% gate`, severity: "entry" });
  }
  if (s.dollarVolM != null && s.dollarVolM < 10) {
    blocks.push({ code: "ILLIQUID", reason: `Dollar volume $${s.dollarVolM.toFixed(1)}M/day below the $10M floor`, severity: "entry" });
  }
  if (input.daysToEarnings != null && input.daysToEarnings >= 0 && input.daysToEarnings <= 5) {
    blocks.push({ code: "EARNINGS_5D", reason: `Earnings in ${input.daysToEarnings} days — inside the 5-day blackout`, severity: "entry" });
  }

  return finish("Momentum Growth", lines, blocks);
}

// ── Engine B — High Dividend Growth ──────────────────────────────────────

export interface EngineBInput {
  yieldPct: number | null;
  /** TTM distribution against the prior TTM, percent. */
  distributionGrowthPct: number | null;
  /** Payments in the last 3 years that came in below the prior payment. */
  cuts: number;
  payments: number;
  /** Deepest single cut over the window, percent (positive number). */
  deepestCutPct: number | null;
  /** Distribution covered by earnings or FCF, when it can be established. */
  coverageRatio?: number | null;
  /** Underlying fundamental growth — revenue, earnings, FCF or NAV. */
  fundamentalGrowthPct?: number | null;
  structure: StructureRead;
  /** Valuation verdict from the anchor stack. */
  valuation?: "DEEP VALUE" | "UNDERVALUED" | "FAIR" | "OVERVALUED" | "STRETCHED" | "CASH EQUIVALENT" | null;
  /** True when this is an existing holding rather than a candidate entry. */
  existingPosition?: boolean;
}

export function scoreEngineB(input: EngineBInput): EngineScore {
  const { structure: s } = input;
  const lines: ScoreLine[] = [];
  const blocks: HardBlock[] = [];

  // ── Yield 20 ── (above 10% earns nothing extra — that is a review trigger)
  if (input.yieldPct != null) {
    const y = input.yieldPct;
    const pts = y >= 8 ? 20 : y >= 7 ? 18 : y >= 6 ? 15 : y >= YIELD_GATE_PCT ? 12 : 0;
    lines.push({ label: "Yield", points: pts, max: 20, evaluated: true,
      detail: y > 10
        ? `${y.toFixed(1)}% — above 10%, no additional credit. A yield this high is a trap review, not a score`
        : `${y.toFixed(1)}% forward/TTM${y >= YIELD_GATE_PCT ? "" : ` — below the ${YIELD_GATE_PCT}% gate`}` });
  } else {
    lines.push({ label: "Yield", points: 0, max: 20, evaluated: false, detail: "No distribution history [U]" });
  }

  // ── Distribution growth 25 ──
  if (input.distributionGrowthPct != null) {
    const d = input.distributionGrowthPct;
    const pts = d >= 12 ? 25 : d >= 8 ? 20 : d >= 5 ? 15 : d >= 0 ? 8 : 0;
    lines.push({ label: "Distribution growth", points: pts, max: 25, evaluated: true,
      detail: `${d >= 0 ? "+" : ""}${d.toFixed(1)}% TTM against the prior year` });
    if (d < 0) {
      blocks.push({ code: "DISTRIBUTION_DECLINE", reason: `TTM distribution down ${Math.abs(d).toFixed(1)}% — no add`, severity: "entry" });
    }
  } else {
    lines.push({ label: "Distribution growth", points: 0, max: 25, evaluated: false, detail: "Under two years of distributions [U]" });
  }

  // ── Distribution quality 20 ──
  {
    if (input.payments >= 4) {
      const cutRate = input.cuts / input.payments;
      lines.push({ label: "Consistency", points: cutRate <= 0.1 ? 5 : cutRate <= 0.3 ? 3 : 0, max: 5, evaluated: true,
        detail: `${input.cuts} of ${input.payments} payments below the prior one` });
    } else lines.push({ label: "Consistency", points: 0, max: 5, evaluated: false, detail: "Fewer than four payments on record [U]" });

    if (input.coverageRatio != null) {
      const c = input.coverageRatio;
      lines.push({ label: "Coverage", points: c >= 1.2 ? 5 : c >= 1.0 ? 3 : 0, max: 5, evaluated: true,
        detail: `Distribution covered ${c.toFixed(2)}×` });
      if (c < 0.9) {
        blocks.push({ code: "UNSUSTAINABLE_PAYOUT", reason: `Distribution covered only ${c.toFixed(2)}× — the payout is not sustainable`, severity: "exit-review" });
      }
    } else lines.push({ label: "Coverage", points: 0, max: 5, evaluated: false, detail: "Coverage cannot be established from the free feed [U]" });

    if (input.fundamentalGrowthPct != null) {
      lines.push({ label: "FCF / earnings support", points: input.fundamentalGrowthPct > 0 ? 5 : 0, max: 5, evaluated: true,
        detail: `Underlying growth ${input.fundamentalGrowthPct >= 0 ? "+" : ""}${input.fundamentalGrowthPct.toFixed(1)}%` });
    } else lines.push({ label: "FCF / earnings support", points: 0, max: 5, evaluated: false, detail: "Underlying cash generation unavailable [U]" });

    if (input.deepestCutPct != null) {
      const noCut = input.deepestCutPct < 15;
      lines.push({ label: "No recent cut", points: noCut ? 5 : 0, max: 5, evaluated: true,
        detail: noCut ? `Deepest cut ${input.deepestCutPct.toFixed(1)}% — inside tolerance` : `Distribution cut ${input.deepestCutPct.toFixed(1)}%` });
      if (!noCut) {
        blocks.push({ code: "DIVIDEND_CUT", reason: `Distribution cut ${input.deepestCutPct.toFixed(1)}% — exceeds the 15% broken-review line`, severity: "exit-review" });
      }
    } else lines.push({ label: "No recent cut", points: 0, max: 5, evaluated: false, detail: "Insufficient payment history [U]" });
  }

  // ── Fundamental growth 15 ──
  if (input.fundamentalGrowthPct != null) {
    const f = input.fundamentalGrowthPct;
    lines.push({ label: "Fundamental growth", points: f >= 12 ? 15 : f >= 8 ? 12 : f >= 5 ? 8 : f >= 0 ? 4 : 0, max: 15, evaluated: true,
      detail: `Revenue / earnings / FCF / NAV growth ${f >= 0 ? "+" : ""}${f.toFixed(1)}%` });
  } else {
    lines.push({ label: "Fundamental growth", points: 0, max: 15, evaluated: false, detail: "Underlying growth unavailable for this wrapper [U]" });
  }

  // ── Momentum & trend 15 ──
  {
    if (s.rs3mPct != null) {
      lines.push({ label: "Relative strength", points: s.rs3mPct >= 3 ? 4 : s.rs3mPct >= 0 ? 2 : 0, max: 4, evaluated: true,
        detail: `${fmt(s.rs3mPct)} vs SPY over 3 months` });
    } else lines.push({ label: "Relative strength", points: 0, max: 4, evaluated: false, detail: "Benchmark unavailable [U]" });

    if (s.above200 != null) {
      lines.push({ label: "Price > 200DMA", points: s.above200 ? 4 : 0, max: 4, evaluated: true,
        detail: s.above200 ? "Above the 200-day" : "Below the 200-day" });
    } else lines.push({ label: "Price > 200DMA", points: 0, max: 4, evaluated: false, detail: "Insufficient history [U]" });

    if (s.goldenStack != null) {
      lines.push({ label: "50DMA trend", points: s.goldenStack ? 3 : 0, max: 3, evaluated: true,
        detail: s.goldenStack ? "50-day above the 200-day" : "50-day below the 200-day" });
    } else lines.push({ label: "50DMA trend", points: 0, max: 3, evaluated: false, detail: "Insufficient history [U]" });

    if (s.macdAboveSignal != null) {
      lines.push({ label: "MACD / momentum", points: s.macdAboveSignal ? 2 : 0, max: 2, evaluated: true,
        detail: s.macdAboveSignal ? "MACD above signal" : "MACD below signal" });
    } else lines.push({ label: "MACD / momentum", points: 0, max: 2, evaluated: false, detail: "Unavailable [U]" });

    if (s.higherHighs != null) {
      lines.push({ label: "Structure", points: s.higherHighs ? 2 : 0, max: 2, evaluated: true,
        detail: s.higherHighs ? "Higher highs and higher lows" : "No higher-high sequence" });
    } else lines.push({ label: "Structure", points: 0, max: 2, evaluated: false, detail: "Insufficient history [U]" });
  }

  // ── Valuation 5 ──
  if (input.valuation) {
    const v = input.valuation;
    const pts = v === "DEEP VALUE" || v === "UNDERVALUED" ? 5 : v === "FAIR" || v === "CASH EQUIVALENT" ? 3 : 0;
    lines.push({ label: "Valuation", points: pts, max: 5, evaluated: true, detail: v });
  } else {
    lines.push({ label: "Valuation", points: 0, max: 5, evaluated: false, detail: "No usable valuation anchor [U]" });
  }

  // ── Yield gate ──
  // v4: a yield below 5% rejects a *new* position, but an existing holding
  // whose yield fell because the price rose is not thereby a sell.
  if (input.yieldPct == null || input.yieldPct < YIELD_GATE_PCT) {
    if (!input.existingPosition) {
      blocks.push({
        code: "YIELD_LT_5",
        reason: input.yieldPct == null
          ? "No distribution — cannot qualify for the income engine"
          : `Yield ${input.yieldPct.toFixed(1)}% is below the ${YIELD_GATE_PCT}% gate for a new income position`,
        severity: "entry",
      });
    }
  }
  if (s.above200 === false && (input.distributionGrowthPct ?? 0) < 0) {
    blocks.push({
      code: "STRUCTURE_BROKEN",
      reason: "Below the 200-day with a declining distribution — exit review",
      severity: "exit-review",
    });
  }

  return finish("High Dividend Growth", lines, blocks);
}

// ── Yield-trap review ────────────────────────────────────────────────────

export type YieldBand = "Core Income" | "High Income — quality review" | "Yield trap review" | "Below gate";

export function yieldBand(yieldPct: number | null): YieldBand {
  if (yieldPct == null || yieldPct < YIELD_GATE_PCT) return "Below gate";
  if (yieldPct <= 8) return "Core Income";
  if (yieldPct <= 10) return "High Income — quality review";
  return "Yield trap review";
}

/**
 * Why is the yield high? A distribution that grew, or a price that fell.
 * Only the first is an opportunity, and v4 requires the difference to be
 * stated rather than inferred from the yield alone.
 */
export function yieldTrapCheck(
  yieldPct: number | null,
  distributionGrowthPct: number | null,
  price12mChangePct: number | null
): { trap: boolean; verdict: string } {
  const band = yieldBand(yieldPct);
  if (band === "Below gate" || band === "Core Income") {
    return { trap: false, verdict: `${band} — no trap review required.` };
  }
  const grew = (distributionGrowthPct ?? 0) > 0;
  const fell = (price12mChangePct ?? 0) < -15;
  if (fell && !grew) {
    return {
      trap: true,
      verdict: `Yield is ${yieldPct?.toFixed(1)}% because the price fell ${Math.abs(price12mChangePct ?? 0).toFixed(1)}% while the distribution ${distributionGrowthPct == null ? "cannot be shown to have grown" : `fell ${Math.abs(distributionGrowthPct).toFixed(1)}%`}. A rising yield on a falling price is not an opportunity.`,
    };
  }
  if (grew) {
    return {
      trap: false,
      verdict: `Yield is ${yieldPct?.toFixed(1)}% on a distribution that grew ${distributionGrowthPct!.toFixed(1)}% — earned, not a symptom.`,
    };
  }
  return { trap: false, verdict: `${band} — distribution flat and price stable; monitor coverage.` };
}

// ── Momentum entry layer (v4 §12) ────────────────────────────────────────

export interface EntryCheck {
  cleared: boolean;
  confirmations: string[];
  failures: string[];
  warnings: string[];
}

/**
 * A qualifying score is not permission to buy at any price. Price must be above
 * the 200-day and show at least two independent confirmations, and the late-
 * stage patterns are called out rather than ignored.
 */
export function checkEntry(s: StructureRead): EntryCheck {
  const confirmations: string[] = [];
  const failures: string[] = [];
  const warnings: string[] = [];

  if (s.above200 !== true) {
    failures.push(s.above200 == null ? "200-day average unavailable" : "Price is below the 200-day average");
  }

  if (s.goldenStack) confirmations.push("50-day above the 200-day");
  if ((s.rs3mPct ?? -1) > 0) confirmations.push(`3-month relative strength ${fmt(s.rs3mPct)} vs SPY`);
  if (s.macdAboveSignal) confirmations.push("MACD above signal");
  if ((s.adxVal ?? 0) > 20) confirmations.push(`ADX ${s.adxVal!.toFixed(1)} — trend established`);
  if (s.higherHighs) confirmations.push("Higher highs and higher lows");
  if (s.breakoutVolume && s.above50) confirmations.push("Breakout on expanding volume");
  if (s.above50 && (s.extensionPct ?? 99) < 15) confirmations.push("Holding above the 50-day without extension");

  if ((s.extensionPct ?? 0) >= 40) warnings.push(`Parabolic — ${s.extensionPct!.toFixed(0)}% above the 200-day`);
  else if ((s.extensionPct ?? 0) >= 25) warnings.push(`Extended — ${s.extensionPct!.toFixed(0)}% above the 200-day; prefer a pullback`);
  if ((s.rsiVal ?? 0) > 78) warnings.push(`RSI ${s.rsiVal!.toFixed(0)} — late-stage; entering here is buying the last third of the move`);
  if (s.obvRising === false) warnings.push("OBV falling while price holds — distribution");

  if (confirmations.length < 2) failures.push(`Only ${confirmations.length} of the required 2 trend confirmations`);

  return { cleared: failures.length === 0, confirmations, failures, warnings };
}

// ── Hybrid Compounder ────────────────────────────────────────────────────

export interface HybridCheck {
  isHybrid: boolean;
  met: string[];
  missing: string[];
}

/** Growth > 12% AND yield > 5% AND distribution growth > 5% AND momentum >= 65 AND above the 200-day AND no hard block. */
export function checkHybrid(a: EngineScore, b: EngineScore, ctx: {
  growthPct: number | null;
  yieldPct: number | null;
  distributionGrowthPct: number | null;
  above200: boolean | null;
}): HybridCheck {
  const met: string[] = [];
  const missing: string[] = [];
  const test = (ok: boolean, label: string) => (ok ? met : missing).push(label);

  test((ctx.growthPct ?? 0) > GROWTH_GATE_PCT, `Growth > ${GROWTH_GATE_PCT}%${ctx.growthPct != null ? ` (${ctx.growthPct.toFixed(1)}%)` : " — unavailable"}`);
  test((ctx.yieldPct ?? 0) > YIELD_GATE_PCT, `Yield > ${YIELD_GATE_PCT}%${ctx.yieldPct != null ? ` (${ctx.yieldPct.toFixed(1)}%)` : " — unavailable"}`);
  test((ctx.distributionGrowthPct ?? -1) > 5, `Distribution growth > 5%${ctx.distributionGrowthPct != null ? ` (${ctx.distributionGrowthPct.toFixed(1)}%)` : " — unavailable"}`);
  test(Math.max(a.score, b.score) >= ENTRY_SCORE, `Engine score ≥ ${ENTRY_SCORE} (best ${Math.max(a.score, b.score)})`);
  test(ctx.above200 === true, "Price above the 200-day");
  test(a.blocks.length === 0 && b.blocks.length === 0, "No hard block");

  return { isHybrid: missing.length === 0, met, missing };
}

// ── helpers ──────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  return v == null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}
function pctReturnSafe(v: number | null): number | null {
  return v == null || !Number.isFinite(v) ? null : v;
}
