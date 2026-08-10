// Sentinel Global Fund — the fund's own rules, as data.
//
// This file is the machine-readable copy of the investment-system document the
// fund manager maintains. Every threshold the app enforces is declared here
// once, so a rule cannot be changed in the document and silently left stale in
// the code, or tuned in the code without the document knowing.
//
// Nothing in here is inferred. If a number is not in the document it is not in
// this file, and the module that needs it says it is unspecified rather than
// picking something reasonable.
//
// Base source: investment-system SKILL.md, 16 June 2026.
// Income-policy amendment approved by the fund manager: 11 August 2026.
// CIO James Hartwell · CRO Miriam Osei.

export const FUND_CONSTITUTION_VERSION = "investment-system · 11 August 2026 income-policy amendment";

/* ─────────────────────────── objectives ───────────────────────────── */

export type IncomeYieldStatus =
  | "UNAVAILABLE"
  | "BELOW_FLOOR"
  | "WATCH_LOW"
  | "OPTIMAL"
  | "ACCEPTABLE_HIGH"
  | "REVIEW_HIGH";

/**
 * Income is an objective, not the master objective.
 *
 * The 11 Aug 2026 amendment replaces the old hard ≥5% blended-yield target.
 * A high distribution rate must never be purchased at the expense of expected
 * total return, NAV growth, quality or portfolio construction.
 */
export const INCOME_POLICY = {
  /** Below this, Income Team must propose remediation — never a forced trade. */
  softFloorPct: 3.25,
  /** Preferred portfolio-income band. */
  targetMinPct: 3.5,
  midpointPct: 3.75,
  targetMaxPct: 4,
  /** Above this, review where the distribution comes from and what upside is surrendered. */
  reviewHighPct: 4.5,
  /** Total return has priority over distribution yield when the two conflict. */
  totalReturnPriority: true,
  /** No asset may be bought or retained solely to manufacture the target yield. */
  noYieldChasing: true,
} as const;

export interface IncomeYieldAssessment {
  status: IncomeYieldStatus;
  pass: boolean | null;
  tone: "good" | "warn" | "bad" | "neutral";
  label: string;
  action: string;
}

export function assessIncomeYield(yieldPct: number | null | undefined): IncomeYieldAssessment {
  if (yieldPct == null || !Number.isFinite(yieldPct)) {
    return {
      status: "UNAVAILABLE",
      pass: null,
      tone: "neutral",
      label: "Yield unavailable",
      action: "Verify portfolio distribution data before making an income decision.",
    };
  }
  if (yieldPct < INCOME_POLICY.softFloorPct) {
    return {
      status: "BELOW_FLOOR",
      pass: false,
      tone: "bad",
      label: "Below soft floor",
      action: `Income Team must propose a remediation path toward ${INCOME_POLICY.targetMinPct.toFixed(2)}–${INCOME_POLICY.targetMaxPct.toFixed(2)}%, but may not sacrifice expected total return or buy yield merely to close the gap.`,
    };
  }
  if (yieldPct < INCOME_POLICY.targetMinPct) {
    return {
      status: "WATCH_LOW",
      pass: null,
      tone: "warn",
      label: "Watch — below preferred band",
      action: "Monitor income coverage. No forced trade is required while total-return opportunities are superior.",
    };
  }
  if (yieldPct <= INCOME_POLICY.targetMaxPct) {
    return {
      status: "OPTIMAL",
      pass: true,
      tone: "good",
      label: "Optimal income band",
      action: "Maintain unless a higher-quality total-return allocation improves the portfolio.",
    };
  }
  if (yieldPct <= INCOME_POLICY.reviewHighPct) {
    return {
      status: "ACCEPTABLE_HIGH",
      pass: true,
      tone: "good",
      label: "Acceptable — above preferred band",
      action: "Accept only while growth, quality and expected total return are not being impaired.",
    };
  }
  return {
    status: "REVIEW_HIGH",
    pass: false,
    tone: "warn",
    label: "Review high distribution",
    action: "Review distribution source, sustainability, return-of-capital/option-premium effects and upside sacrificed. Higher yield is not automatically better.",
  };
}

export const DUAL_OBJECTIVE = {
  /** Total return must beat the benchmark by this multiple, per year. */
  benchmarkMultiple: 1.3,
  benchmark: "SPY total return",
  /** Compatibility field: the new income soft floor, not the preferred target. */
  yieldFloorPct: INCOME_POLICY.softFloorPct,
  yieldTargetMinPct: INCOME_POLICY.targetMinPct,
  yieldTargetMidPct: INCOME_POLICY.midpointPct,
  yieldTargetMaxPct: INCOME_POLICY.targetMaxPct,
  yieldReviewHighPct: INCOME_POLICY.reviewHighPct,
} as const;

/* ──────────────────────── portfolio structure ─────────────────────── */

export const SLEEVE_TARGETS = {
  growth: 55,
  income: 30,
  cash: 13,
} as const;

/** Rule #7 — a sleeve this far from target raises an alert immediately. */
export const SLEEVE_DRIFT_ALERT_PCT = 5;

/* ───────────────── Rule #3 v2 — position balance zones ────────────── */

export type ZoneName = "BASE" | "WATCH" | "TRIM" | "EMERGENCY";

export const POSITION_ZONES = {
  /** At or below this a position is optimal. */
  basePct: 20,
  /** 20–22: bring it to the meeting; trim or watch, judged against macro. */
  watchUpperPct: 22,
  /** 23–25: mandatory trim. */
  trimLowerPct: 23,
  /** Above this, trim immediately. */
  emergencyPct: 25,
  /** Where a mandatory trim lands. */
  trimTargetLowPct: 18,
  trimTargetHighPct: 19,
} as const;

/**
 * Rule #3 procedure, and one of the fund's ten hard rules:
 * **research must identify a replacement before a trim is executed.**
 *
 * The replacement is judged on total-return quality first. Income contribution
 * is a portfolio constraint, not a requirement to match the trimmed name's
 * headline yield. If nothing qualifies, park proceeds in SGOV/JAAA and wait.
 */
export const TRIM_REQUIRES_REPLACEMENT = true;

/* ──────────────────── Rule #1 — soft-block system ─────────────────── */

export const SOFT_BLOCK = {
  /** One hard block AND a score above this reads WATCH, not REJECT. */
  scoreFloor: 80,
  /** Two or more hard blocks is always a REJECT, whatever the score. */
  maxBlocksForSoftBlock: 1,
} as const;

/* ───────────────────── Rule #2 — staggered deploy ─────────────────── */

export const STAGGERED_DEPLOY = {
  /** Within this many days of a Tier-1 event, deployment is capped. */
  tierOneWindowDays: 5,
  /** The cap: at most one third of the planned size may go in. */
  maxFractionBeforeEvent: 1 / 3,
  events: ["FOMC", "CPI", "NFP"] as const,
} as const;

/* ─────────────────── Rule #5 — data integrity flags ───────────────── */

export type DataFlag = "V" | "E" | "U";

/**
 * The fund's rule, and it is stricter than excluding a gap from the average:
 * **an unavailable input scores zero and stays in the denominator.** A missing
 * measurement is not neutral — it lowers the score, and Gate 7's data-quality
 * floor then blocks the trade separately.
 *
 * Modules that report coverage must still report it. What they must not do is
 * quietly shrink the denominator so a thin case scores like a complete one.
 */
export const DATA_INTEGRITY = {
  unavailableScoresZero: true,
  /** Gate 7 — the data-quality score a trade must clear. */
  minDataQualityPct: 70,
  flagMeaning: {
    V: "Verified — named source, dated within 24 hours",
    E: "Estimate — must state the basis",
    U: "Unavailable — scores zero, never guessed",
  },
} as const;

/* ───────────────────── Rule #6 — win-rate disclosure ──────────────── */

export const WIN_RATE_DISCLOSURE = {
  /** Below this many live trades a win rate carries a mandatory label. */
  liveTradesRequired: 100,
  label: "Component Estimate (not a real backtest)",
} as const;

/* ─────────────────────── macro regime framework ───────────────────── */

export interface RegimeBand {
  name: "Risk-On" | "Neutral" | "Risk-Off" | "Crisis";
  icon: string;
  minScore: number;
  cashMinPct: number;
  /** Fraction of a planned deployment permitted in this regime. */
  deployFraction: number;
  deployRule: string;
}

export const REGIME_BANDS: RegimeBand[] = [
  { name: "Risk-On", icon: "🟢", minScore: 70, cashMinPct: 10, deployFraction: 1, deployRule: "Full size permitted." },
  { name: "Neutral", icon: "🟡", minScore: 40, cashMinPct: 15, deployFraction: 0.75, deployRule: "Deploy up to three quarters of the planned size." },
  { name: "Risk-Off", icon: "🔴", minScore: 20, cashMinPct: 25, deployFraction: 1 / 3, deployRule: "One third of the planned size only." },
  { name: "Crisis", icon: "⚫", minScore: 0, cashMinPct: 40, deployFraction: 0, deployRule: "Deployment frozen." },
];

export function regimeBandFor(score: number): RegimeBand {
  return REGIME_BANDS.find((b) => score >= b.minScore) ?? REGIME_BANDS[REGIME_BANDS.length - 1];
}

/* ────────────────── momentum scoring v3.0 thresholds ──────────────── */

export const MOMENTUM_SIGNALS = {
  strongBuyFloor: 75,
  buyFloor: 58,
  watchFloor: 42,
  /** A new position needs at least this score. */
  entryFloor: 58,
} as const;

/* ───────────────────────── risk management ────────────────────────── */

export const RISK_LIMITS = {
  /** Kelly fraction is quarter-Kelly, then floored and capped. */
  kellyFraction: 0.25,
  sizeCeilingPct: 20,
  sizeFloorPct: 3,
  /** Hard cap: no purchase may take a position above this. */
  hardPositionCapPct: 20,
  /** Stop distance, in ATR(14) multiples below entry. */
  atrStopMultiple: 2,
  /** Risk budget per trade and across all open positions, as % of NAV. */
  maxRiskPerTradePct: 1.5,
  maxRiskOpenPct: 8,
  /** Two positions above this correlation are flagged. */
  correlationFlag: 0.7,
  growthSleeveCorrelationWarning: 0.65,
  /** A gap-up larger than this may not be chased. */
  maxChaseGapPct: 3,
} as const;

/* ───────────────────── the nine pre-trade gates ───────────────────── */

export interface GateSpec {
  n: number;
  label: string;
  owner: string;
}

export const PRE_TRADE_GATES: GateSpec[] = [
  { n: 1, label: "Regime timestamp verified within 24 hours", owner: "Nina Okonkwo" },
  { n: 2, label: "Regime score ≥ 40 (Neutral or better)", owner: "Daniel Cho" },
  { n: 3, label: "Momentum score ≥ 58/100", owner: "Maya Chen" },
  { n: 4, label: "Soft-block check applied where relevant (Rule #1)", owner: "Maya Chen" },
  { n: 5, label: "Position ≤ 20% of NAV after the trade (Rule #3)", owner: "Kai Tanaka" },
  { n: 6, label: "ATR stop stated before execution (Rule #4)", owner: "Kai Tanaka" },
  { n: 7, label: "Data quality ≥ 70% and every key input flagged [V/E/U]", owner: "Miriam Osei" },
  { n: 8, label: "Stagger rule applied if a Tier-1 event is near (Rule #2)", owner: "Aisha Fontaine" },
  { n: 9, label: "CIO sign-off", owner: "James Hartwell" },
];

/* ──────────────────────────── hard rules ──────────────────────────── */

/**
 * The ten rules the fund says may never be broken. They are listed here so a
 * decision surface can show them and a test can assert each one is enforced
 * somewhere rather than merely written down.
 */
export const HARD_RULES = [
  { id: "GATES", text: "No execution without all nine gates passed." },
  { id: "ATR_STOP", text: "No execution without a stated ATR stop." },
  { id: "POSITION_CAP", text: "No position above 20% of NAV." },
  { id: "U_SCORES_ZERO", text: "Unavailable data never receives points." },
  { id: "WR_LABEL", text: "No win-rate claim without the Component Estimate label." },
  { id: "NO_CHASE", text: "Never chase a gap open above 3%." },
  { id: "NO_AVERAGE_DOWN", text: "Never average down into broken momentum." },
  { id: "STAGGER", text: "Never deploy more than one third before a Tier-1 event." },
  { id: "REPLACEMENT_FIRST", text: "Never trim before research has named a replacement." },
  { id: "TRAILING_STOP", text: "A trailing stop may be raised, never lowered." },
] as const;

export type HardRuleId = (typeof HARD_RULES)[number]["id"];

/* ───────────────────────────── helpers ────────────────────────────── */

/** Rule #6 — how a win rate must be presented at a given sample size. */
export function winRatePresentation(liveTrades: number, winRatePct: number | null): {
  quotable: boolean;
  value: number | null;
  label: string;
} {
  if (winRatePct == null) {
    return { quotable: false, value: null, label: "No win rate has been measured." };
  }
  if (liveTrades >= WIN_RATE_DISCLOSURE.liveTradesRequired) {
    return { quotable: true, value: winRatePct, label: `Verified over ${liveTrades} live trades.` };
  }
  return {
    quotable: true,
    value: winRatePct,
    label: `${WIN_RATE_DISCLOSURE.label} — ${liveTrades} live trade(s) on record, ${WIN_RATE_DISCLOSURE.liveTradesRequired} required before this may be quoted without this label.`,
  };
}

/** Rule #3 — which zone a weight falls in, straight from the document. */
export function zoneForWeight(weightPct: number): ZoneName {
  if (weightPct > POSITION_ZONES.emergencyPct) return "EMERGENCY";
  if (weightPct >= POSITION_ZONES.trimLowerPct) return "TRIM";
  if (weightPct > POSITION_ZONES.basePct) return "WATCH";
  return "BASE";
}

/** Rule #1 — a single hard block on a strong score is a WATCH, not a reject. */
export function softBlockApplies(score: number, hardBlockCount: number): boolean {
  return hardBlockCount === SOFT_BLOCK.maxBlocksForSoftBlock && score > SOFT_BLOCK.scoreFloor;
}

/**
 * Rule #2 — the fraction of a planned size that may be deployed today, taking
 * both the regime and any near Tier-1 event into account. The stricter wins.
 */
export function permittedDeployFraction(regimeScore: number, daysToTierOneEvent: number | null): {
  fraction: number;
  reason: string;
} {
  const band = regimeBandFor(regimeScore);
  const nearEvent = daysToTierOneEvent != null && daysToTierOneEvent <= STAGGERED_DEPLOY.tierOneWindowDays;
  if (nearEvent && STAGGERED_DEPLOY.maxFractionBeforeEvent < band.deployFraction) {
    return {
      fraction: STAGGERED_DEPLOY.maxFractionBeforeEvent,
      reason: `A Tier-1 event is ${daysToTierOneEvent} day(s) away. Rule #2 caps deployment at one third of plan, which is tighter than the ${band.name} regime's ${Math.round(band.deployFraction * 100)}%.`,
    };
  }
  return {
    fraction: band.deployFraction,
    reason: `${band.icon} ${band.name} regime at ${regimeScore}/100. ${band.deployRule}${nearEvent ? ` A Tier-1 event is ${daysToTierOneEvent} day(s) away but the regime is already the tighter constraint.` : ""}`,
  };
}
