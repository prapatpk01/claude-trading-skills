// Sentinel Global Fund — book-level review (Lena Müller, Kai Tanaka,
// Miriam Osei, James Hartwell) applied to the user's own holdings.

import { buildSleeves, dualObjectiveScorecard, blendedYield, correlationFlags, type HoldingLike, type SleeveRow, type DualObjective } from "./portfolio";
import { assessPositionZone, type ZoneAssessment } from "./risk";
import { assessRegime, type RegimeAssessment } from "./governance";
import { ROSTER } from "./roster";
import type { Candle } from "../types";
import type { DeskNote } from "./memo";

export interface BookReview {
  asOf: string;
  nav: number;
  regime: RegimeAssessment | null;
  sleeves: SleeveRow[];
  objectives: DualObjective[];
  blendedYieldPct: number | null;
  yieldRows: { ticker: string; weightPct: number; yieldPct: number; contribution: number }[];
  zones: (ZoneAssessment & { ticker: string })[];
  cashPct: number;
  cashRequiredPct: number | null;
  correlations: { a: string; b: string; correlation: number }[];
  desks: DeskNote[];
  actions: string[];
  disclosures: string[];
}

const pct = (v: number | null | undefined, d = 2) => (v == null ? "n/a" : `${v.toFixed(d)}%`);
const money = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export interface BookInput {
  holdings: HoldingLike[];
  benchmark: Candle[];
  /** Daily closes per ticker, for the correlation matrix. */
  closesByTicker?: Record<string, number[]>;
  portfolioReturnPct?: number | null;
  spyReturnPct?: number | null;
}

export function buildBookReview(input: BookInput): BookReview {
  const { holdings } = input;
  const { rows: sleeves, nav } = buildSleeves(holdings);
  const { blended, rows: yieldRows } = blendedYield(holdings);
  const objectives = dualObjectiveScorecard(
    input.portfolioReturnPct ?? null,
    input.spyReturnPct ?? null,
    blended
  );
  const regime = input.benchmark.length ? assessRegime(input.benchmark) : null;

  const zones = holdings
    .map((h) => {
      const value = (h.price ?? h.avg_cost) * h.shares;
      const weightPct = nav > 0 ? (value / nav) * 100 : 0;
      return { ticker: h.ticker, ...assessPositionZone(weightPct, value, nav) };
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  const cashRow = sleeves.find((s) => s.sleeve === "Cash/Defensive");
  const cashPct = cashRow?.actualPct ?? 0;
  const cashRequiredPct = regime?.cashMinPct ?? null;

  const correlations = input.closesByTicker
    ? correlationFlags(
        Object.fromEntries(
          Object.entries(input.closesByTicker).map(([t, closes]) => {
            const rets: number[] = [];
            for (let i = 1; i < closes.length; i++) {
              if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
            }
            return [t, rets];
          })
        )
      )
    : [];

  // ── Desk notes ────────────────────────────────────────────────────
  const desks: DeskNote[] = [];
  const actions: string[] = [];

  if (regime) {
    desks.push({
      member: ROSTER.daniel.name,
      role: ROSTER.daniel.role,
      heading: `Macro regime ${regime.icon} ${regime.regime} — ${regime.score}/100`,
      bullets: [
        ...regime.components.map((c) => `${c.label}: ${c.points}/${c.max} — ${c.detail}`),
        `Cash floor for this regime: ${regime.cashMinPct}% (book currently ${pct(cashPct)}).`,
      ],
      verdict: regime.note,
    });
    if (cashRequiredPct != null && cashPct < cashRequiredPct) {
      actions.push(
        `Raise the cash/defensive sleeve to at least ${cashRequiredPct}% — currently ${pct(cashPct)} against a ${regime.regime} regime.`
      );
    }
  }

  // Lena — sleeve balance and objectives
  const lenaBullets = sleeves.map(
    (s) =>
      `${s.alert ? "🔔" : "•"} ${s.sleeve}: ${pct(s.actualPct)} vs ${s.targetPct}% target (drift ${s.driftPct >= 0 ? "+" : ""}${s.driftPct.toFixed(2)} pts)${s.tickers.length ? ` — ${s.tickers.join(", ")}` : " — empty"}`
  );
  lenaBullets.push(`NAV ${money(nav)} across ${holdings.length} position${holdings.length === 1 ? "" : "s"}.`);
  if (blended != null) lenaBullets.push(`Blended forward yield ${pct(blended)} against the 5% objective.`);
  desks.push({
    member: ROSTER.lena.name,
    role: ROSTER.lena.role,
    heading: "Sleeve balance & dual objectives",
    bullets: lenaBullets,
    verdict: objectives
      .map((o) => `${o.pass === true ? "✅" : o.pass === false ? "❌" : "⏸"} ${o.label}: ${o.actual} vs ${o.target}`)
      .join(" | "),
  });
  for (const s of sleeves) {
    if (s.alert) {
      actions.push(
        `Rule #7 drift alert — ${s.sleeve} is ${s.driftPct >= 0 ? "over" : "under"} target by ${Math.abs(s.driftPct).toFixed(2)} points (${pct(s.actualPct)} vs ${s.targetPct}%). Rebalance at the next review.`
      );
    }
  }

  // Kai — concentration
  const kaiBullets = zones.map(
    (z) => `${z.icon} ${z.ticker}: ${pct(z.weightPct)} — ${z.zone}. ${z.action}${z.trimToTarget ? ` Trim ≈ ${money(z.trimToTarget)}.` : ""}`
  );
  if (correlations.length) {
    kaiBullets.push(
      ...correlations.slice(0, 5).map((c) => `⚠️ ${c.a} / ${c.b} correlation ${c.correlation.toFixed(2)} — above the 0.7 flag`)
    );
  } else if (input.closesByTicker) {
    kaiBullets.push("No position pair exceeds the 0.7 correlation flag.");
  }
  desks.push({
    member: ROSTER.kai.name,
    role: ROSTER.kai.role,
    heading: "Concentration & correlation (Rule #3)",
    bullets: kaiBullets.length ? kaiBullets : ["No positions to assess."],
  });
  for (const z of zones) {
    if (z.zone === "EMERGENCY") actions.push(`🚨 ${z.ticker} at ${pct(z.weightPct)} — trim immediately to the 18-19% band.`);
    else if (z.zone === "TRIM") actions.push(`🔴 ${z.ticker} at ${pct(z.weightPct)} — mandatory trim, but Research must identify a replacement first (Rule #3).`);
    else if (z.zone === "WATCH") actions.push(`⚠️ ${z.ticker} at ${pct(z.weightPct)} — review at the meeting; trim or hold on the macro read.`);
  }

  // Miriam — governance
  const miriamBullets: string[] = [];
  const priced = holdings.filter((h) => h.price != null).length;
  miriamBullets.push(`Pricing verified for ${priced}/${holdings.length} positions [${priced === holdings.length ? "V" : "E"}].`);
  miriamBullets.push(
    holdings.some((h) => h.yieldPct == null)
      ? "Some positions have no verified distribution history — their yield contribution is scored zero, not estimated (Rule #5)."
      : "Distribution history present for every position."
  );
  miriamBullets.push("Cost basis is user-supplied and unaudited [E] until reconciled against a broker statement.");
  desks.push({
    member: ROSTER.miriam.name,
    role: ROSTER.miriam.role,
    heading: "Data integrity & governance",
    bullets: miriamBullets,
  });

  // James — CIO
  const failing = objectives.filter((o) => o.pass === false).length;
  desks.push({
    member: ROSTER.james.name,
    role: ROSTER.james.role,
    heading: `CIO review — ${actions.length ? `${actions.length} action${actions.length > 1 ? "s" : ""} outstanding` : "book within policy"}`,
    bullets: [
      `NAV ${money(nav)} · ${holdings.length} positions · blended yield ${pct(blended)}.`,
      failing
        ? `${failing} of 2 objectives are behind target.`
        : "Both objectives are on or ahead of target where measurable.",
      actions.length ? "Actions are listed below in priority order." : "No rebalancing action required this review.",
    ],
  });

  return {
    asOf: new Date().toISOString(),
    nav,
    regime,
    sleeves,
    objectives,
    blendedYieldPct: blended,
    yieldRows,
    zones,
    cashPct,
    cashRequiredPct,
    correlations,
    desks,
    actions,
    disclosures: [
      "Sleeve classification is inferred from yield, beta and the fund's own instrument list; override it if a holding belongs elsewhere.",
      "Return figures are computed from current share counts valued back through time, not from a transaction ledger.",
      "Cost basis is user-supplied and unaudited [E].",
      "For research and education only. Not investment advice.",
    ],
  };
}
