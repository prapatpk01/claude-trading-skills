// The four scores and the conviction that blends them.
//
// Sofia Reyes owns quality, Marcus Webb growth, Thomas Eriksson valuation, Kai
// Tanaka risk, and James Hartwell the blend. Each score is 0–100 and each is
// normalised over the components that could actually be measured — a company
// whose ROIC cannot be computed does not score zero on returns, it scores over
// a smaller denominator and says so.
//
// The blend is fixed and published. A conviction score whose weights move with
// the answer is a rationalisation with a number attached.
//
// Pure functions. No network, no clock beyond what is passed in.

export const CONVICTION_WEIGHTS = { quality: 0.3, growth: 0.25, valuation: 0.25, risk: 0.2 } as const;

export interface ScoreComponent {
  label: string;
  /** null when the input could not be measured. Excluded from the denominator. */
  points: number | null;
  max: number;
  detail: string;
}

export interface PillarScore {
  score: number | null;
  coveragePct: number;
  components: ScoreComponent[];
  unmeasured: string[];
  note: string;
}

export interface ConvictionInput {
  /* Quality — Sofia Reyes */
  roicPct?: number | null;
  roePct?: number | null;
  grossMarginPct?: number | null;
  operatingMarginPct?: number | null;
  /** 0–5 evidence-scored moat tests. */
  moatScore?: number | null;
  moatMax?: number | null;
  /** Marcus's earnings-quality read, already 0–100. */
  earningsQualityScore?: number | null;
  netDebtToEbitda?: number | null;

  /* Growth — Marcus Webb */
  revenueGrowthTtmPct?: number | null;
  revenueCagr3yPct?: number | null;
  epsGrowthTtmPct?: number | null;
  /** Operating margin change over the period, in basis points. */
  marginTrendBps?: number | null;

  /* Valuation — Thomas Eriksson */
  upsideToFairValuePct?: number | null;
  /** Current multiple against its own history, in percent. Negative = cheaper. */
  peVsOwnHistoryPct?: number | null;
  fcfYieldPct?: number | null;

  /* Risk — Kai Tanaka. Higher score means LOWER risk. */
  beta?: number | null;
  maxDrawdownPct?: number | null;
  realizedVolPct?: number | null;
  /** Sessions to exit at 20% of median dollar volume. */
  sessionsToExit?: number | null;
  /** Hard blocks raised by the momentum model. */
  hardBlockCount?: number | null;
}

export interface ConvictionResult {
  quality: PillarScore;
  growth: PillarScore;
  valuation: PillarScore;
  risk: PillarScore;
  overall: number | null;
  overallCoveragePct: number;
  weights: typeof CONVICTION_WEIGHTS;
  rating: "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell" | "Not rated";
  ratingReason: string;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const r0 = (v: number) => Math.round(v);
const n = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : v.toFixed(d));

/** Score a value on a band: at or below `lo` scores 0, at or above `hi` scores max. */
function band(value: number | null | undefined, lo: number, hi: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (hi === lo) return null;
  return clamp(((value - lo) / (hi - lo)) * max, 0, max);
}
/** The same, inverted: lower is better. */
function inverseBand(value: number | null | undefined, best: number, worst: number, max: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (best === worst) return null;
  return clamp(((worst - value) / (worst - best)) * max, 0, max);
}

function pillar(components: ScoreComponent[], label: string): PillarScore {
  const evaluable = components.filter((c) => c.points != null).reduce((s, c) => s + c.max, 0);
  const raw = components.reduce((s, c) => s + (c.points ?? 0), 0);
  const unmeasured = components.filter((c) => c.points == null).map((c) => c.label);
  const coveragePct = r0((evaluable / components.reduce((s, c) => s + c.max, 0)) * 100);
  return {
    score: evaluable > 0 ? r0((raw / evaluable) * 100) : null,
    coveragePct,
    components,
    unmeasured,
    note:
      evaluable === 0
        ? `No ${label} input could be measured, so no score is published. An unmeasured pillar is not a low one.`
        : unmeasured.length
        ? `Scored over ${coveragePct}% of the ${label} model. Unmeasured: ${unmeasured.join("; ")} — excluded from the denominator, not counted as zero.`
        : `Every ${label} input was measured.`,
  };
}

export function scoreConviction(input: ConvictionInput): ConvictionResult {
  /* ── Quality (Sofia Reyes) ── */
  const quality = pillar([
    { label: "Return on invested capital", max: 25, points: band(input.roicPct, 4, 25, 25), detail: `ROIC ${n(input.roicPct)}% — 4% scores nothing, 25% scores full marks.` },
    { label: "Return on equity", max: 15, points: band(input.roePct, 8, 30, 15), detail: `ROE ${n(input.roePct)}% — scored across an 8% to 30% band, and read alongside leverage since debt flatters it.` },
    { label: "Gross margin", max: 15, points: band(input.grossMarginPct, 20, 65, 15), detail: `Gross margin ${n(input.grossMarginPct)}% — scored across a 20% to 65% band.` },
    { label: "Operating margin", max: 15, points: band(input.operatingMarginPct, 5, 30, 15), detail: `Operating margin ${n(input.operatingMarginPct)}% — scored across a 5% to 30% band.` },
    { label: "Moat evidence", max: 15, points: input.moatScore == null || input.moatMax == null || input.moatMax <= 0 ? null : clamp((input.moatScore / input.moatMax) * 15, 0, 15), detail: `${input.moatScore == null ? "No moat assessment" : `${input.moatScore} of ${input.moatMax} moat tests passed on evidence`}.` },
    { label: "Earnings quality", max: 15, points: input.earningsQualityScore == null ? null : clamp((input.earningsQualityScore / 100) * 15, 0, 15), detail: `Earnings quality ${n(input.earningsQualityScore, 0)}/100 — cash conversion and accrual behaviour.` },
  ], "quality");

  /* ── Growth (Marcus Webb) ── */
  const growth = pillar([
    { label: "Revenue growth, trailing twelve months", max: 35, points: band(input.revenueGrowthTtmPct, 0, 30, 35), detail: `TTM revenue growth ${n(input.revenueGrowthTtmPct)}%.` },
    { label: "Three-year revenue CAGR", max: 25, points: band(input.revenueCagr3yPct, 0, 25, 25), detail: `Three-year CAGR ${n(input.revenueCagr3yPct)}% — durability, not one good year.` },
    { label: "Earnings growth", max: 25, points: band(input.epsGrowthTtmPct, -5, 35, 25), detail: `TTM earnings growth ${n(input.epsGrowthTtmPct)}%.` },
    { label: "Margin direction", max: 15, points: band(input.marginTrendBps, -300, 300, 15), detail: `Operating margin ${input.marginTrendBps == null ? "trend unmeasured" : `${input.marginTrendBps >= 0 ? "+" : ""}${n(input.marginTrendBps, 0)} bps`} — growth bought with margin is worth less.` },
  ], "growth");

  /* ── Valuation (Thomas Eriksson) ── */
  const valuation = pillar([
    { label: "Upside to fair value", max: 50, points: band(input.upsideToFairValuePct, -20, 40, 50), detail: `Price sits ${n(input.upsideToFairValuePct)}% from the anchor stack's fair value.` },
    { label: "Multiple against its own history", max: 25, points: inverseBand(input.peVsOwnHistoryPct, -30, 40, 25), detail: `Trading ${n(input.peVsOwnHistoryPct)}% against its own multiple history — the company is its own comparable.` },
    { label: "Free cash flow yield", max: 25, points: band(input.fcfYieldPct, 0, 8, 25), detail: `FCF yield ${n(input.fcfYieldPct)}%.` },
  ], "valuation");

  /* ── Risk (Kai Tanaka). Higher = safer. ── */
  const risk = pillar([
    { label: "Beta", max: 25, points: inverseBand(input.beta, 0.7, 2.2, 25), detail: `Beta ${n(input.beta, 2)} against the benchmark.` },
    { label: "Maximum drawdown", max: 25, points: inverseBand(input.maxDrawdownPct == null ? null : Math.abs(input.maxDrawdownPct), 15, 70, 25), detail: `Deepest drawdown ${n(input.maxDrawdownPct)}%.` },
    { label: "Realised volatility", max: 20, points: inverseBand(input.realizedVolPct, 15, 70, 20), detail: `Annualised realised volatility ${n(input.realizedVolPct)}%.` },
    { label: "Exit liquidity", max: 15, points: inverseBand(input.sessionsToExit, 0.2, 5, 15), detail: `${input.sessionsToExit == null ? "Sessions to exit unmeasured" : `${n(input.sessionsToExit)} session(s) to exit at 20% of median volume`}.` },
    { label: "Hard blocks", max: 15, points: input.hardBlockCount == null ? null : clamp(15 - input.hardBlockCount * 7.5, 0, 15), detail: `${input.hardBlockCount == null ? "Hard blocks not assessed" : `${input.hardBlockCount} hard block(s) on the momentum model`}.` },
  ], "risk");

  /* ── The blend ── */
  const pillars: [keyof typeof CONVICTION_WEIGHTS, PillarScore][] = [
    ["quality", quality], ["growth", growth], ["valuation", valuation], ["risk", risk],
  ];
  const scored = pillars.filter(([, p]) => p.score != null);
  const weightAvailable = scored.reduce((s, [k]) => s + CONVICTION_WEIGHTS[k], 0);
  const overall = weightAvailable > 0
    ? r0(scored.reduce((s, [k, p]) => s + (p.score as number) * CONVICTION_WEIGHTS[k], 0) / weightAvailable)
    : null;
  const overallCoveragePct = r0(weightAvailable * 100);

  /* ── The rating, and why ── */
  let rating: ConvictionResult["rating"] = "Not rated";
  let ratingReason: string;
  if (overall == null) {
    ratingReason = "No pillar could be scored, so no rating is published. A rating on no evidence is an opinion wearing a label.";
  } else if (overallCoveragePct < 50) {
    rating = "Not rated";
    ratingReason = `Only ${overallCoveragePct}% of the model's weight could be measured (${pillars.filter(([, p]) => p.score == null).map(([k]) => k).join(", ")} unscored). Below half, a rating says more about the gaps than the company.`;
  } else {
    rating = overall >= 80 ? "Strong Buy" : overall >= 65 ? "Buy" : overall >= 45 ? "Hold" : overall >= 30 ? "Sell" : "Strong Sell";
    const drivers = [...scored].sort((a, b) => (b[1].score as number) - (a[1].score as number));
    ratingReason = `Conviction ${overall}/100 over ${overallCoveragePct}% of the model's weight. Strongest pillar ${drivers[0][0]} at ${drivers[0][1].score}; weakest ${drivers.at(-1)![0]} at ${drivers.at(-1)![1].score}.`;
  }

  return { quality, growth, valuation, risk, overall, overallCoveragePct, weights: CONVICTION_WEIGHTS, rating, ratingReason };
}

/* ─────────────────────────── thesis tracker ───────────────────────── */

export interface MonitoringMetric {
  metric: string;
  current: string;
  /** The reading that would break the thesis. */
  trigger: string;
  owner: string;
}

export interface ThesisTracker {
  bull: string[];
  bear: string[];
  /**
   * Where the fund's measurement differs from what the price implies. This is
   * the only part of a thesis that is worth anything — agreeing with the market
   * at the market's price is not a position.
   */
  variantPerception: string;
  keyRisks: string[];
  monitoring: MonitoringMetric[];
}

export interface TrackerInput {
  ticker: string;
  price: number | null;
  fairValue: number | null;
  conviction: ConvictionResult;
  /** Narratives already produced by the scenario engine. */
  bullNarrative?: string | null;
  bearNarrative?: string | null;
  risks?: string[];
  revenueGrowthTtmPct?: number | null;
  operatingMarginPct?: number | null;
  roicPct?: number | null;
  netDebtToEbitda?: number | null;
  nextEarningsDate?: string | null;
}

export function buildThesisTracker(input: TrackerInput): ThesisTracker {
  const { conviction: c } = input;
  const bull: string[] = [];
  const bear: string[] = [];

  // The case is assembled from the pillars that actually scored, so it cannot
  // claim a strength the model could not measure.
  if (c.quality.score != null && c.quality.score >= 60) bull.push(`Business quality scores ${c.quality.score}/100 — ${c.quality.components.filter((x) => x.points != null && x.points / x.max > 0.6).map((x) => x.label.toLowerCase()).join(", ") || "returns and margins"} carry it.`);
  if (c.growth.score != null && c.growth.score >= 60) bull.push(`Growth scores ${c.growth.score}/100 on measured revenue and earnings, not guidance.`);
  if (c.valuation.score != null && c.valuation.score >= 60) bull.push(`Valuation scores ${c.valuation.score}/100 — the anchor stack puts fair value above the current price.`);
  if (input.bullNarrative) bull.push(input.bullNarrative);

  if (c.quality.score != null && c.quality.score < 45) bear.push(`Business quality scores only ${c.quality.score}/100; ${c.quality.components.filter((x) => x.points != null && x.points / x.max < 0.4).map((x) => x.label.toLowerCase()).join(", ") || "returns"} are the drag.`);
  if (c.growth.score != null && c.growth.score < 45) bear.push(`Growth scores ${c.growth.score}/100 — the trailing numbers do not support a growth multiple.`);
  if (c.valuation.score != null && c.valuation.score < 45) bear.push(`Valuation scores ${c.valuation.score}/100; the price already carries the case.`);
  if (c.risk.score != null && c.risk.score < 45) bear.push(`Risk scores ${c.risk.score}/100 — volatility, drawdown or exit liquidity make the position expensive to hold through noise.`);
  if (input.bearNarrative) bear.push(input.bearNarrative);

  if (!bull.length) bull.push("No pillar scored strongly enough to carry a bull case on measured evidence alone.");
  if (!bear.length) bear.push("No pillar scored weakly enough to carry a bear case on measured evidence alone.");

  // Variant perception is a measurement, not a story: the gap between the
  // anchor stack and the price, stated with its direction.
  const gapPct = input.price != null && input.fairValue != null && input.price > 0
    ? ((input.fairValue - input.price) / input.price) * 100
    : null;
  const variantPerception = gapPct == null
    ? "No fair-value anchor could be built, so there is no measurable gap between the fund's read and the price. Without one there is no variant perception — only agreement at whatever the market is asking."
    : Math.abs(gapPct) < 8
    ? `The anchor stack puts fair value within ${n(Math.abs(gapPct))}% of the ${input.price!.toFixed(2)} price. The fund and the market agree, which means there is no variant view here and no edge to be paid for holding one.`
    : gapPct > 0
    ? `The anchor stack values ${input.ticker} ${n(gapPct)}% above the ${input.price!.toFixed(2)} price. The market is discounting ${c.growth.score != null && c.growth.score >= 55 ? "growth the trailing numbers already show" : "a recovery the fund does not require for the case to work"}; the fund is not. That gap is the position.`
    : `The anchor stack values ${input.ticker} ${n(Math.abs(gapPct))}% BELOW the ${input.price!.toFixed(2)} price. The market is paying for something the fund cannot measure — the variant view here runs against owning it, not for it.`;

  const keyRisks = [...(input.risks ?? [])];
  for (const component of c.risk.components) {
    if (component.points != null && component.max > 0 && component.points / component.max < 0.35) {
      keyRisks.push(`${component.label}: ${component.detail}`);
    }
  }
  if (!keyRisks.length) keyRisks.push("No risk component scored in the bottom third and no narrative risk was supplied. That is an absence of measurement as much as an absence of risk.");

  // Every metric carries the level that breaks the thesis, so the review has
  // something to check rather than a feeling to revisit.
  const monitoring: MonitoringMetric[] = [
    { metric: "Revenue growth (TTM)", current: `${n(input.revenueGrowthTtmPct)}%`, trigger: "Two consecutive quarters below zero, or a halving of the current rate", owner: "Marcus Webb" },
    { metric: "Operating margin", current: `${n(input.operatingMarginPct)}%`, trigger: "A fall of more than 300 bps against the same quarter last year", owner: "Marcus Webb" },
    { metric: "Return on invested capital", current: `${n(input.roicPct)}%`, trigger: "ROIC below the cost of capital — the company would be destroying value by growing", owner: "Sofia Reyes" },
    { metric: "Net debt / EBITDA", current: `${n(input.netDebtToEbitda, 2)}×`, trigger: "Above 3.0× without a stated deleveraging path", owner: "Kai Tanaka" },
    { metric: "Price against fair value", current: gapPct == null ? "unmeasured" : `${n(gapPct)}% ${gapPct >= 0 ? "below" : "above"} fair value`, trigger: "Price more than 25% above the anchor stack — the case is priced and the position is a trade, not a holding", owner: "Thomas Eriksson" },
    { metric: "Next reported quarter", current: input.nextEarningsDate ?? "date not projected", trigger: "A miss on revenue AND a guidance cut in the same report", owner: "Aisha Fontaine" },
  ];

  return { bull, bear, variantPerception, keyRisks, monitoring };
}
