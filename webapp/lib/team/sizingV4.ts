// Sentinel Global Fund — Team Rules v4.0, sizing and sell discipline.
//
// Two changes of substance from v3.
//
// 1. Valuation is a modifier, not a sell signal. v3 trimmed an OVERVALUED name
//    on sight, which sells winners into strength — the single most expensive
//    habit a momentum book can have. In v4 an expensive price shrinks or blocks
//    an *add*; it only forces a trim when the valuation is extreme AND momentum
//    is already weakening. Selling is driven by thesis, structure and risk.
//
// 2. The cap ladder is 15 / 20. Normal maximum 15% of NAV, high conviction may
//    run to 20%, and no purchase may create a position above 20%.
//
// Entry failure is not thesis failure: a name that no longer qualifies for a
// *new* entry is not thereby a sale.

import type { EngineScore, StructureRead, EntryCheck, HybridCheck } from "./engines";
import { ENTRY_SCORE } from "./engines";
import type { RegimeAssessment } from "./governance";
import type { ValuationRead } from "./positionValuation";

/** Normal maximum for a position. */
export const NORMAL_MAX_PCT = 15;
/** High-conviction ceiling, and the hard maximum. */
export const HARD_MAX_PCT = 20;

export type ActionV4 = "ADD" | "HOLD" | "WATCH" | "TRIM" | "EXIT REVIEW";

/** Initial allocation by signal, §14. */
export function initialSizePct(signal: EngineScore["signal"]): number {
  switch (signal) {
    case "ELITE BUY": return 5;
    case "STRONG BUY": return 4;
    case "BUY": return 2.5;
    default: return 0;
  }
}

export interface PositionV4 {
  ticker: string;
  shares: number;
  avgCost: number;
  price: number | null;
  engineA: EngineScore;
  engineB: EngineScore;
  /** Which engine this position is held under. */
  engine: "Momentum Growth" | "High Dividend Growth" | "Cash/Defensive";
  hybrid: HybridCheck;
  structure: StructureRead;
  entry: EntryCheck;
  valuation: ValuationRead;
  /** Current growth rate for the growth thesis test. */
  growthPct: number | null;
  yieldPct: number | null;
  distributionGrowthPct: number | null;
  stop?: number | null;
  /** Set when the name runs with a group currently leading the market. */
  theme?: { label: string; rsPct: number } | null;
}

export interface PlanV4 {
  ticker: string;
  engine: string;
  isHybrid: boolean;
  price: number | null;
  marketValue: number;
  weightPct: number;
  targetWeightPct: number;
  score: number;
  signal: EngineScore["signal"];
  coveragePct: number;
  verdict: ValuationRead["verdict"];
  deviationPct: number | null;
  fairValue: number | null;
  buyBelow: number | null;
  confidence: ValuationRead["confidence"];
  anchors: ValuationRead["anchors"];
  valuationNote: string;
  entryConfirmations: string[];
  entryWarnings: string[];
  theme: { label: string; rsPct: number } | null;
  action: ActionV4;
  deltaShares: number;
  deltaValue: number;
  headline: string;
  /** Which precedence level decided the action. */
  decidedBy: string;
  reasons: string[];
  guard: string | null;
  blocks: string[];
  priority: number;
}

export interface BookV4Input {
  positions: PositionV4[];
  nav: number;
  regime: RegimeAssessment | null;
}

export interface BookV4Result {
  plans: PlanV4[];
  notes: string[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const money = (v: number) => `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/** §17 — what the regime permits for each engine. */
function regimeAllows(regime: RegimeAssessment | null, engine: PositionV4["engine"]): { allowed: boolean; factor: number; note: string } {
  if (!regime) return { allowed: true, factor: 0.75, note: "Regime unreadable — deployment throttled to three-quarters" };
  switch (regime.regime) {
    case "Risk-On":
      return { allowed: true, factor: 1, note: "Risk-On — full deployment permitted" };
    case "Neutral":
      return { allowed: true, factor: 0.75, note: "Neutral — up to three-quarters of plan; avoid weak momentum" };
    case "Risk-Off":
      return engine === "Momentum Growth"
        ? { allowed: false, factor: 0, note: "Risk-Off — growth purchases require an exceptional score" }
        : { allowed: true, factor: 0.5, note: "Risk-Off — income and defensive names only, at half size" };
    default:
      return { allowed: false, factor: 0, note: "Crisis — normal deployment frozen; cash preservation takes precedence" };
  }
}

/** §13 — valuation modifies the size of an add; it rarely forces a sale. */
function valuationModifier(p: PositionV4): { factor: number; note: string; forcesTrim: boolean } {
  const v = p.valuation.verdict;
  // "Weakening" must mean more than a wobble. A single MACD cross below its
  // signal happens repeatedly inside a healthy uptrend, and treating that as
  // deterioration would sell winners on noise — exactly what §13 forbids. Two
  // of the three independent reads must agree.
  const weakSignals = [
    p.structure.macdAboveSignal === false,
    (p.structure.rs3mPct ?? 0) < 0,
    p.structure.above50 === false,
  ].filter(Boolean).length;
  const momentumWeakening = weakSignals >= 2;

  if (p.engine === "High Dividend Growth") {
    if (v === "DEEP VALUE" || v === "UNDERVALUED") return { factor: 1.25, note: "High yield at a discount — strong add", forcesTrim: false };
    if (v === "FAIR" || v === "CASH EQUIVALENT" || v == null) return { factor: 1, note: "Fair value — add at plan", forcesTrim: false };
    if (v === "OVERVALUED") return { factor: 0, note: "Overvalued — hold, do not add", forcesTrim: false };
    // Yield compression + overvaluation + weak momentum is the trim case.
    return {
      factor: 0,
      note: momentumWeakening
        ? "Yield compressed into an overvaluation with momentum weakening — trim"
        : "Stretched, but momentum is intact — hold rather than sell strength",
      forcesTrim: momentumWeakening,
    };
  }

  // Momentum Growth
  if (v === "DEEP VALUE" || v === "UNDERVALUED") return { factor: 1.5, note: "Cheap with momentum intact — aggressive add", forcesTrim: false };
  if (v === "FAIR" || v == null) return { factor: 1, note: "Fair with momentum intact — add at plan", forcesTrim: false };
  if (v === "OVERVALUED") return { factor: 0.4, note: "Expensive — hold, or a small add only", forcesTrim: false };
  return {
    factor: 0,
    note: momentumWeakening
      ? "Extreme valuation with momentum already weakening — trim"
      : "Extreme valuation, but momentum is intact — a rich price alone is not a sell signal",
    forcesTrim: momentumWeakening,
  };
}

export function buildPlansV4(input: BookV4Input): BookV4Result {
  const { positions, nav, regime } = input;
  const notes: string[] = [];

  const plans: PlanV4[] = positions.map((p) => {
    const price = p.price;
    const mv = (price ?? p.avgCost) * p.shares;
    const weightPct = nav > 0 ? (mv / nav) * 100 : 0;

    const own = p.engine === "High Dividend Growth" ? p.engineB : p.engineA;
    const blocks = [...p.engineA.blocks, ...p.engineB.blocks];
    const exitBlocks = (p.engine === "High Dividend Growth" ? p.engineB : p.engineA).blocks
      .filter((b) => b.severity === "exit-review");

    const reasons: string[] = [];
    let action: ActionV4 = "HOLD";
    let decidedBy = "10 — default";
    let deltaValue = 0;
    let guard: string | null = null;

    reasons.push(
      `${p.engine}${p.hybrid.isHybrid ? " · HYBRID COMPOUNDER" : ""} — score ${own.score}/100 (${own.signal}), ${own.coveragePct}% of the model's inputs were available.`
    );
    if (p.valuation.verdict) {
      reasons.push(
        p.valuation.verdict === "CASH EQUIVALENT"
          ? `Cash equivalent — ${p.valuation.note}`
          : `${p.valuation.verdict} — $${price?.toFixed(2) ?? "n/a"} against fair value $${p.valuation.fairValue?.toFixed(2)} (${p.valuation.deviationPct != null && p.valuation.deviationPct >= 0 ? "+" : ""}${p.valuation.deviationPct?.toFixed(1)}%).`
      );
    }
    if (p.theme) {
      reasons.push(`Running with ${p.theme.label}, ${p.theme.rsPct >= 0 ? "+" : ""}${p.theme.rsPct.toFixed(1)}% vs SPY over 3 months.`);
    }

    // ── Precedence §18, applied top-down ──

    // 1. Risk hard limit.
    if (weightPct > HARD_MAX_PCT) {
      action = "TRIM";
      decidedBy = "1 — risk hard limit";
      deltaValue = -((weightPct - HARD_MAX_PCT) / 100) * nav;
      reasons.push(`${weightPct.toFixed(1)}% of NAV is above the ${HARD_MAX_PCT}% hard maximum — trim to the cap. No other model overrides this.`);
    }
    // 2-3. Broken fundamental thesis / dividend sustainability.
    else if (exitBlocks.length) {
      action = "EXIT REVIEW";
      decidedBy = p.engine === "High Dividend Growth" ? "3 — dividend sustainability" : "2 — broken fundamental thesis";
      deltaValue = 0;
      reasons.push(`Exit review: ${exitBlocks.map((b) => b.reason).join("; ")}.`);
      guard = "Exit review is a decision to take, not an order to send. Confirm the thesis break before selling, and exit on the stop or into strength (Rule #4).";
    }
    // 5. Structural trend — below the 200-day with the thesis also weakening.
    else if (p.structure.above200 === false && !thesisIntact(p)) {
      action = "EXIT REVIEW";
      decidedBy = "5 — structural trend";
      reasons.push(
        `Below the 200-day average and the ${p.engine === "High Dividend Growth" ? "distribution" : "growth"} thesis no longer holds — the two together are an exit review.`
      );
      guard = "A structure break alone is not a sale; it is a review. Confirm the thesis first.";
    }
    // 7. Valuation — the only case where valuation alone sells.
    else {
      const mod = valuationModifier(p);
      if (mod.forcesTrim && weightPct >= 5) {
        action = "TRIM";
        decidedBy = "7 — valuation";
        deltaValue = -mv * 0.25;
        reasons.push(`${mod.note}. Take a quarter off and keep the rest.`);
      } else {
        // Adds — everything below is permission-seeking, not obligation.
        const reg = regimeAllows(regime, p.engine);
        const room = Math.max(0, HARD_MAX_PCT - weightPct);
        const normalRoom = Math.max(0, NORMAL_MAX_PCT - weightPct);
        const highConviction = own.signal === "ELITE BUY" || own.signal === "STRONG BUY" || p.hybrid.isHybrid;
        const ceiling = highConviction ? room : normalRoom;

        let addPct = initialSizePct(own.signal) * mod.factor * reg.factor;
        addPct = Math.min(addPct, ceiling);

        if (blocks.some((b) => b.severity === "entry") && own.score < ENTRY_SCORE) {
          action = "HOLD";
          decidedBy = "6 — engine qualification";
          reasons.push(
            `No add — ${blocks.filter((b) => b.severity === "entry").map((b) => b.reason).join("; ")}. Entry failure is not thesis failure: the position is held, not sold.`
          );
        } else if (!reg.allowed) {
          action = "HOLD";
          decidedBy = "4 — market regime";
          reasons.push(`No add — ${reg.note}.`);
        } else if (own.score < ENTRY_SCORE) {
          action = own.score >= 55 ? "WATCH" : "HOLD";
          decidedBy = "8 — engine score";
          reasons.push(`Score ${own.score} is below the ${ENTRY_SCORE} entry bar — hold the position, add nothing.`);
        } else if (!p.entry.cleared) {
          action = "WATCH";
          decidedBy = "5 — structural trend";
          reasons.push(`Entry layer not cleared — ${p.entry.failures.join("; ")}. Wait for confirmation rather than paying up.`);
          if (p.entry.warnings.length) guard = p.entry.warnings.join(" · ");
        } else if (addPct <= 0) {
          action = "HOLD";
          decidedBy = "7 — valuation";
          reasons.push(
            weightPct >= NORMAL_MAX_PCT && !highConviction
              ? `At ${weightPct.toFixed(1)}% the position is already at the ${NORMAL_MAX_PCT}% normal maximum; only a high-conviction signal opens the ${NORMAL_MAX_PCT}-${HARD_MAX_PCT}% band.`
              : `${mod.note}.`
          );
        } else {
          action = "ADD";
          decidedBy = p.hybrid.isHybrid ? "6 — hybrid compounder" : "8 — engine score";
          deltaValue = (addPct / 100) * nav;
          reasons.push(
            `${mod.note}. ${reg.note}. Step ${addPct.toFixed(1)}% of NAV${highConviction ? ` — high conviction, permitted up to ${HARD_MAX_PCT}%` : ` — normal maximum ${NORMAL_MAX_PCT}%`}.`
          );
          if (p.entry.warnings.length) guard = p.entry.warnings.join(" · ");
          // Rule #4 — the incremental trade may not risk more than 1.5% of NAV.
          if (price && p.stop != null && p.stop > 0 && p.stop < price) {
            const maxShares = Math.floor((nav * 0.015) / (price - p.stop));
            const maxValue = maxShares * price;
            if (maxValue < deltaValue) {
              deltaValue = maxValue;
              reasons.push(`Capped at ${maxShares} shares by the 1.5%-of-NAV trade risk limit (stop $${p.stop.toFixed(2)}).`);
              guard = `Stop $${p.stop.toFixed(2)} must be live before adding (Rule #4).`;
            }
          }
        }
      }
    }

    // Minimum trade size.
    const minTrade = Math.max(nav * 0.0075, 200);
    if ((action === "ADD" || action === "TRIM") && Math.abs(deltaValue) < minTrade) {
      reasons.push(`Sized at ${money(deltaValue)}, below the minimum worth trading — hold.`);
      action = "HOLD";
      deltaValue = 0;
    }

    let deltaShares = 0;
    if (price && price > 0 && deltaValue !== 0) {
      deltaShares = Math.trunc(deltaValue / price);
      if (deltaShares < 0) deltaShares = Math.max(deltaShares, -p.shares);
      if (deltaShares === 0) { action = action === "TRIM" ? "HOLD" : action === "ADD" ? "HOLD" : action; deltaValue = 0; }
      else deltaValue = deltaShares * price;
    } else if (!price && (action === "ADD" || action === "TRIM")) {
      reasons.push("No live price — sizing cannot be computed.");
      action = "HOLD";
      deltaValue = 0;
    }

    const targetWeightPct = nav > 0 ? ((mv + deltaValue) / nav) * 100 : 0;

    const headline =
      action === "EXIT REVIEW" ? `Exit review — ${p.shares} shares (${money(mv)}) under review`
      : action === "TRIM" ? `Trim ${Math.abs(deltaShares)} shares (≈${money(deltaValue)})`
      : action === "ADD" ? `Add ${deltaShares} shares (≈${money(deltaValue)})`
      : action === "WATCH" ? "Watch — hold, await confirmation"
      : "Hold — no change";

    const priority =
      action === "EXIT REVIEW" ? 0 : action === "TRIM" ? 1 : action === "ADD" ? 2 : action === "WATCH" ? 3 : 4;

    return {
      ticker: p.ticker,
      engine: p.engine,
      isHybrid: p.hybrid.isHybrid,
      price,
      marketValue: round2(mv),
      weightPct: round2(weightPct),
      targetWeightPct: round2(targetWeightPct),
      score: own.score,
      signal: own.signal,
      coveragePct: own.coveragePct,
      verdict: p.valuation.verdict,
      deviationPct: p.valuation.deviationPct,
      fairValue: p.valuation.fairValue,
      buyBelow: p.valuation.buyBelow,
      confidence: p.valuation.confidence,
      anchors: p.valuation.anchors ?? [],
      valuationNote: p.valuation.note,
      entryConfirmations: p.entry?.confirmations ?? [],
      entryWarnings: p.entry?.warnings ?? [],
      theme: p.theme ?? null,
      action,
      deltaShares,
      deltaValue: round2(deltaValue),
      headline,
      decidedBy,
      reasons,
      guard,
      blocks: blocks.map((b) => b.code),
      priority,
    };
  });

  plans.sort((a, b) => a.priority - b.priority || Math.abs(b.deltaValue) - Math.abs(a.deltaValue));

  notes.push(
    `Position ladder: ${NORMAL_MAX_PCT}% normal maximum, ${NORMAL_MAX_PCT}-${HARD_MAX_PCT}% for high conviction only, ${HARD_MAX_PCT}% hard maximum. No purchase may create a position above ${HARD_MAX_PCT}%.`
  );
  notes.push(
    "Valuation sizes an add; it does not sell a winner. A rich price only forces a trim when momentum is already weakening. Selling follows thesis, structure and risk."
  );
  notes.push(
    "Entry failure is not thesis failure. A name that no longer qualifies for a new entry is held, not sold, until the thesis itself breaks."
  );
  if (regime) notes.push(`${regime.icon} ${regime.regime} (${regime.score}/100) — ${regime.deployRule}.`);

  return { plans, notes };
}

/** Is the engine's own thesis still intact, independent of price? */
function thesisIntact(p: PositionV4): boolean {
  if (p.engine === "High Dividend Growth") {
    // Yield falling because the price rose is not a thesis break.
    return (p.distributionGrowthPct ?? 0) >= 0 && !p.engineB.blocks.some((b) => b.severity === "exit-review");
  }
  if (p.engine === "Cash/Defensive") return true;
  return (p.growthPct ?? 0) >= 12 && !p.engineA.blocks.some((b) => b.severity === "exit-review");
}
