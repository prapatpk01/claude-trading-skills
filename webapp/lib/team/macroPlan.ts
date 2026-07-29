// Sentinel Global Fund — the macro desk's allocation plan (Daniel Cho).
//
// Turns two independent reads into one concrete instruction set:
//
//   Regime     where the market IS — trend, volatility, drawdown. Sets the
//              base sleeve allocation (v4 §2).
//   Sentiment  how CROWDED that position is. A contrarian overlay that tilts
//              the allocation without touching the regime score.
//
// The overlay is deliberately asymmetric. Panic is a better buy signal than
// euphoria is a sell signal: markets bottom violently and top slowly, so
// capitulation earns a larger tilt than extreme greed does, and greed reduces
// risk rather than reversing the position.
//
// The plan then splits the growth sleeve across the groups actually leading,
// so "55% growth" becomes "20% semiconductors, 18% software, 17% industrials"
// — a number someone can act on rather than a category.

import type { RegimeAssessment } from "./governance";
import type { FearGreedRead, FearGreedBand } from "./fearGreed";
import type { GroupRank } from "./thematic";
import { isLeading, regimePlaybook } from "./thematic";
import { allocationFor, SLEEVE_RANGES, type Sleeve } from "./portfolio";

export interface SentimentTilt {
  band: FearGreedBand;
  /** Points moved from cash into growth. Negative moves the other way. */
  growthDeltaPts: number;
  posture: string;
  rationale: string;
  /** Conditions that must hold before the tilt is acted on. */
  guards: string[];
}

/**
 * The contrarian overlay.
 *
 * Capitulation is the only band that moves capital aggressively, and it is
 * guarded: buying a panic before it stops is how a drawdown becomes a
 * permanent loss, so the deployment is staged and requires the index to have
 * stopped making new lows.
 */
export function sentimentTilt(fg: FearGreedRead, regime: RegimeAssessment | null): SentimentTilt {
  const band = fg.band;
  switch (band) {
    case "Capitulation":
      return {
        band,
        growthDeltaPts: +10,
        posture: "Deploy into the panic — staged",
        rationale:
          `Fear & Greed at ${fg.value} is below the 15 capitulation line. Forced selling, not fundamentals, is setting prices; ` +
          `this is where the fund adds rather than waits. Move up to 10 points from cash into the growth sleeve.`,
        guards: [
          "Deploy in thirds, not at once — a capitulation reading can persist for weeks.",
          "Require the index to have stopped making new 20-day lows before the first tranche.",
          "Position-level hard blocks still apply: this raises the sleeve, it does not license a broken name.",
        ],
      };
    case "Extreme Fear":
      return {
        band,
        growthDeltaPts: +5,
        posture: "Lean in modestly",
        rationale:
          `Fear & Greed at ${fg.value} is extreme fear. Risk is being priced generously; add 5 points to growth from cash, ` +
          `but the panic is not yet at the capitulation line where the fund commits fully.`,
        guards: ["Prefer adding to existing leaders over initiating into weakness."],
      };
    case "Fear":
      return {
        band, growthDeltaPts: +2, posture: "Slight lean in",
        rationale: `Fear & Greed at ${fg.value}. Mild pessimism — a small tilt toward risk, nothing more.`,
        guards: [],
      };
    case "Neutral":
      return {
        band, growthDeltaPts: 0, posture: "No sentiment tilt",
        rationale: `Fear & Greed at ${fg.value} is neutral. Sentiment adds nothing to the regime's own allocation.`,
        guards: [],
      };
    case "Greed":
      return {
        band, growthDeltaPts: -3, posture: "Trim the edges",
        rationale:
          `Fear & Greed at ${fg.value} is greed. Positioning is getting crowded; take 3 points off growth into cash ` +
          `so a rotation is funded from profits rather than from forced selling.`,
        guards: ["Fund the reduction from the most extended positions, not the strongest theses."],
      };
    default:
      return {
        band,
        growthDeltaPts: -7,
        posture: "De-risk — hype, not thesis",
        rationale:
          `Fear & Greed at ${fg.value} is extreme greed. Late-stage buying is driving prices and the usual resolution is a ` +
          `rotation or a profit-taking flush rather than a crash. Move 7 points from growth to cash and take gains where ` +
          `valuation is already stretched.` +
          (regime?.regime === "Risk-On" ? " The tape is still constructive, so this is a reduction, not an exit." : ""),
        guards: [
          "Reduce; do not reverse. Extreme greed can persist, and shorting a strong tape is not this fund's mandate.",
          "Take from the positions where valuation is stretched and momentum is already fading first.",
        ],
      };
  }
}

export interface SleeveTarget {
  sleeve: Sleeve;
  basePct: number;
  targetPct: number;
  currentPct: number;
  driftPts: number;
  /** Dollars to move to reach the target. */
  deltaValue: number;
  action: string;
}

export interface GroupTarget {
  label: string;
  proxy: string;
  targetPct: number;
  currentPct: number;
  deltaValue: number;
  rs3mPct: number | null;
  leadership: number;
  note: string;
}

export interface MacroPlan {
  regime: RegimeAssessment | null;
  fearGreed: FearGreedRead;
  tilt: SentimentTilt;
  posture: string;
  sleeves: SleeveTarget[];
  /** Concrete split of the growth sleeve across leading groups. */
  groups: GroupTarget[];
  actions: string[];
  notes: string[];
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const money = (v: number) => `$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export interface MacroPlanInput {
  regime: RegimeAssessment | null;
  fearGreed: FearGreedRead;
  ranked: GroupRank[];
  nav: number;
  /** Current share of NAV per sleeve. */
  currentSleevePct: Record<string, number>;
  /** Current share of NAV per GICS sector, for the group comparison. */
  currentSectorPct: Record<string, number>;
}

export function buildMacroPlan(input: MacroPlanInput): MacroPlan {
  const { regime, fearGreed, ranked, nav } = input;
  const tilt = sentimentTilt(fearGreed, regime);
  const base = allocationFor(regime?.regime);
  const playbook = regimePlaybook(regime);

  // Apply the tilt: growth moves by the tilt, cash absorbs the other side,
  // and income is left alone — it is the fund's income mandate, not a buffer.
  const [gLo, gHi] = SLEEVE_RANGES["Growth/Momentum"];
  const [cLo, cHi] = SLEEVE_RANGES["Cash/Defensive"];
  let growth = base["Growth/Momentum"] + tilt.growthDeltaPts;
  let cash = base["Cash/Defensive"] - tilt.growthDeltaPts;
  const income = base["Income/Dividend"];

  // A tilt may not push a sleeve outside its band, and the regime's cash floor
  // is a floor: sentiment does not license running below it.
  growth = Math.max(gLo, Math.min(gHi, growth));
  cash = Math.max(Math.max(cLo, regime?.cashMinPct ?? cLo), Math.min(cHi, cash));
  // Re-derive growth so the three still sum to 100.
  growth = round1(100 - income - cash);

  const targets: Record<Sleeve, number> = {
    "Growth/Momentum": growth,
    "Income/Dividend": income,
    "Cash/Defensive": round1(cash),
  };

  const sleeves: SleeveTarget[] = (Object.keys(targets) as Sleeve[]).map((sleeve) => {
    const currentPct = input.currentSleevePct[sleeve] ?? 0;
    const targetPct = targets[sleeve];
    const driftPts = round1(currentPct - targetPct);
    const deltaValue = ((targetPct - currentPct) / 100) * nav;
    return {
      sleeve,
      basePct: base[sleeve],
      targetPct,
      currentPct: round1(currentPct),
      driftPts,
      deltaValue: Math.round(deltaValue),
      action:
        Math.abs(driftPts) < 3
          ? "In balance — no action"
          : driftPts > 0
          ? `Reduce ${Math.abs(driftPts).toFixed(1)} points (${money(deltaValue)})`
          : `Add ${Math.abs(driftPts).toFixed(1)} points (${money(deltaValue)})`,
    };
  });

  // ── Split the growth sleeve across the groups that are actually leading ──
  const eligible = ranked.filter((g) => isLeading(g) && playbook.allowed.includes(g.risk));
  const groups: GroupTarget[] = [];
  if (eligible.length && growth > 0) {
    // Weight by leadership above the "in line with the index" mark, so a group
    // that merely qualifies does not receive the same capital as one leading
    // decisively.
    const weights = eligible.map((g) => Math.max(1, g.leadership - 50));
    const totalW = weights.reduce((s, w) => s + w, 0);
    eligible.forEach((g, i) => {
      const targetPct = round1((weights[i] / totalW) * growth);
      const currentPct = g.sector ? round1(input.currentSectorPct[g.sector] ?? 0) : 0;
      groups.push({
        label: g.label,
        proxy: g.proxy,
        targetPct,
        currentPct,
        deltaValue: Math.round(((targetPct - currentPct) / 100) * nav),
        rs3mPct: g.rs3m,
        leadership: g.leadership,
        note: g.sector
          ? `${g.note}. Book currently holds ${currentPct.toFixed(1)}% here.`
          : `${g.note}. This is a theme rather than a GICS sector, so the book's exposure is not measured directly — check whether existing names already sit inside it.`,
      });
    });
  }

  // ── The action list ──
  const actions: string[] = [];
  if (tilt.growthDeltaPts !== 0) {
    actions.push(
      `${tilt.posture}: ${tilt.growthDeltaPts > 0 ? "move" : "take"} ${Math.abs(tilt.growthDeltaPts)} points ` +
      `${tilt.growthDeltaPts > 0 ? "from cash into growth" : "off growth into cash"} — ${tilt.rationale}`
    );
  }
  for (const s of sleeves) {
    if (Math.abs(s.driftPts) >= 3) {
      actions.push(
        `${s.sleeve}: ${s.currentPct.toFixed(1)}% against a ${s.targetPct.toFixed(1)}% target — ${s.action.toLowerCase()}.`
      );
    }
  }
  for (const g of groups.slice(0, 4)) {
    if (g.deltaValue > nav * 0.02) {
      actions.push(
        `${g.label} (${g.proxy}): target ${g.targetPct.toFixed(1)}% of NAV against ${g.currentPct.toFixed(1)}% held — ` +
        `add about ${money(g.deltaValue)}. Leading at ${g.leadership}/100, ${g.rs3mPct != null && g.rs3mPct >= 0 ? "+" : ""}${g.rs3mPct?.toFixed(1)}% vs SPY over 3 months.`
      );
    }
  }
  if (!actions.length) actions.push("Allocation is within tolerance of the target on every sleeve — no rebalancing required.");

  const notes: string[] = [
    `Regime sets the base allocation; sentiment tilts it. The two are kept separate on purpose — the regime measures where the market is, sentiment measures how crowded that position is.`,
    `The overlay is asymmetric: capitulation earns +10 points, extreme greed −7. Markets bottom violently and top slowly, so panic is a better buy signal than euphoria is a sell signal.`,
    `A tilt may not push a sleeve outside its band, and never below the regime's ${regime?.cashMinPct ?? "—"}% cash floor.`,
  ];
  if (fearGreed.source === "Computed proxy") {
    notes.push(`Sentiment source: ${fearGreed.note}`);
  }
  if (!eligible.length) {
    notes.push("No group is both leading on relative strength and permitted by the current regime, so the growth sleeve carries no group-level target — hold what is there and wait for leadership.");
  }

  return {
    regime,
    fearGreed,
    tilt,
    posture: `${regime?.regime ?? "Unknown regime"} · ${fearGreed.band} — ${tilt.posture}`,
    sleeves,
    groups,
    actions,
    notes,
  };
}
