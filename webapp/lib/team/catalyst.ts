// Sentinel Global Fund — the catalyst desk (Aisha Fontaine).
//
// This seat existed in the scoring models from the start: both Momentum Scoring
// v3.0 and Engine A accept a `catalystScore`, and every score printed "Catalyst
// 0/10, not evaluated" because nothing ever supplied one. Ten of Engine A's
// hundred points were structurally unreachable.
//
// The reason was real — analyst revisions, guidance and product-cycle news are
// not in any free, keyless feed — but it was not the whole story. Two of the
// most reliable catalyst effects in the literature CAN be measured from data
// this app already holds:
//
//   1. Earnings surprise, from the reported-vs-estimated history.
//   2. Post-earnings announcement drift, by MEASURING what the price actually
//      did in the sessions after the last report, against the benchmark over
//      the same window. Not a proxy — the realised drift itself.
//
// What still cannot be measured is named and excluded rather than guessed:
// there is no consensus-revision series and no product-cycle feed here, so the
// score reports the share of the model it could evaluate (Rule #5).
//
// The output is on Aisha's published 0-25 scale. Callers that need Engine A's
// 0-10 catalyst line scale it down; the two must not drift apart, so the
// conversion lives here.

import type { Candle, EarningsRow, QuarterlyRow } from "../types";

export type CatalystBand = "Strong" | "Moderate" | "Weak" | "None" | "Negative";

export interface CatalystLine {
  label: string;
  points: number;
  max: number;
  evaluated: boolean;
  detail: string;
}

export interface PeadRead {
  /** Sessions measured since the report. */
  sessions: number;
  /** The window the desk wanted, when fewer sessions have elapsed. */
  targetSessions: number;
  reportedDate: string;
  driftPct: number;
  benchmarkPct: number | null;
  /** Drift less the benchmark over the same window — the part that is the name. */
  excessPct: number | null;
  note: string;
}

export interface CatalystRead {
  /** 0-25 on the desk's own scale, or null when nothing could be evaluated. */
  score: number | null;
  /** Score normalised over the components that could be evaluated. */
  coveragePct: number;
  band: CatalystBand;
  /**
   * True when the evidence points the wrong way — a miss, or drift running
   * against the name. Momentum Scoring v3.0 subtracts 3 for this.
   */
  negative: boolean;
  lines: CatalystLine[];
  pead: PeadRead | null;
  nextEvent: {
    date: string | null;
    daysAway: number | null;
    /** Inside the pre-earnings window where the fund does not initiate. */
    blackout: boolean;
    basis: string;
  };
  /** The theme this name sits in, when the macro desk ranked one. */
  theme: { label: string; proxy: string; leadership: number; rs3mPct: number | null } | null;
  /** One sentence a human can read, built only from what was measured. */
  thesis: string;
  notes: string[];
  unavailable: string[];
}

const PEAD_WINDOW = 20;
/** Inside this many sessions of a report, the fund does not open a new position. */
const BLACKOUT_DAYS = 2;

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Realised post-earnings drift.
 *
 * Measured, not modelled: find the session on or after the report date, then
 * compare the price change over the following window against the benchmark's
 * change over exactly the same sessions. Where fewer sessions have elapsed the
 * read still returns, with the count, because "8 sessions in and running +6%
 * against the index" is useful and "wait 12 more days" is not.
 */
export function measurePead(
  candles: Candle[],
  benchmark: Candle[],
  reportedDate: string,
  window = PEAD_WINDOW
): PeadRead | null {
  if (candles.length < 2 || !reportedDate) return null;
  const startIdx = candles.findIndex((c) => c.date >= reportedDate);
  if (startIdx < 0 || startIdx >= candles.length - 1) return null;

  const endIdx = Math.min(startIdx + window, candles.length - 1);
  const sessions = endIdx - startIdx;
  if (sessions < 1) return null;

  const from = candles[startIdx].close;
  const to = candles[endIdx].close;
  if (!(from > 0)) return null;
  const driftPct = round1(((to - from) / from) * 100);

  // The benchmark over the same calendar span, so the comparison is like for
  // like even when the two series have different session counts.
  let benchmarkPct: number | null = null;
  if (benchmark.length > 1) {
    const bStart = benchmark.findIndex((c) => c.date >= candles[startIdx].date);
    const bEndTarget = candles[endIdx].date;
    let bEnd = -1;
    for (let i = benchmark.length - 1; i >= 0; i--) {
      if (benchmark[i].date <= bEndTarget) { bEnd = i; break; }
    }
    if (bStart >= 0 && bEnd > bStart && benchmark[bStart].close > 0) {
      benchmarkPct = round1(((benchmark[bEnd].close - benchmark[bStart].close) / benchmark[bStart].close) * 100);
    }
  }

  return {
    sessions,
    targetSessions: window,
    reportedDate,
    driftPct,
    benchmarkPct,
    excessPct: benchmarkPct != null ? round1(driftPct - benchmarkPct) : null,
    note:
      sessions >= window
        ? `Measured over the ${sessions} sessions following the ${reportedDate} report.`
        : `Only ${sessions} of the ${window} sessions since the ${reportedDate} report have traded, so the drift window is incomplete.`,
  };
}

export interface CatalystInput {
  earnings: EarningsRow[];
  quarters: QuarterlyRow[];
  candles: Candle[];
  benchmark: Candle[];
  /** Next reporting date, projected from the company's own cadence. */
  nextEarningsDate?: string | null;
  nextEarningsBasis?: string;
  theme?: { label: string; proxy: string; leadership: number; rs3mPct: number | null } | null;
  now?: Date;
}

/**
 * Score the catalyst. Five components, 25 points, each reporting whether it
 * could be evaluated at all.
 */
export function assessCatalyst(input: CatalystInput): CatalystRead {
  const now = input.now ?? new Date();
  const lines: CatalystLine[] = [];
  const notes: string[] = [];
  const unavailable: string[] = [];
  const earnings = input.earnings.filter((e) => e.reportedEPS != null);

  // ── 1. Surprise magnitude (7) ──
  const latest = earnings[0];
  let latestSurprise: number | null = null;
  if (latest?.surprisePercent != null) {
    latestSurprise = latest.surprisePercent;
    const s = latestSurprise;
    const pts = s >= 10 ? 7 : s >= 5 ? 5 : s >= 2 ? 3 : s >= 0 ? 1 : 0;
    lines.push({
      label: "Surprise magnitude",
      points: pts, max: 7, evaluated: true,
      detail: `Last quarter ${s >= 0 ? "beat" : "missed"} by ${Math.abs(s).toFixed(1)}%${latest.reportedDate ? ` (reported ${latest.reportedDate})` : ""}. A large surprise is what starts a drift; a small one rarely does.`,
    });
  } else {
    lines.push({
      label: "Surprise magnitude", points: 0, max: 7, evaluated: false,
      detail: "No consensus estimate in the free feed for the latest quarter, so the surprise cannot be measured [U].",
    });
    unavailable.push("Latest earnings surprise");
  }

  // ── 2. Surprise consistency (5) ──
  const withSurprise = earnings.filter((e) => e.surprisePercent != null).slice(0, 4);
  if (withSurprise.length >= 3) {
    const beats = withSurprise.filter((e) => (e.surprisePercent as number) > 0).length;
    const pts = beats === withSurprise.length ? 5 : beats >= withSurprise.length - 1 ? 3 : beats >= 2 ? 1 : 0;
    lines.push({
      label: "Surprise consistency",
      points: pts, max: 5, evaluated: true,
      detail: `${beats} of the last ${withSurprise.length} quarters beat. A repeated beat is management guiding conservatively — a pattern, not an accident, and the pattern is what persists.`,
    });
  } else {
    lines.push({
      label: "Surprise consistency", points: 0, max: 5, evaluated: false,
      detail: `Only ${withSurprise.length} quarter${withSurprise.length === 1 ? "" : "s"} carry a consensus estimate; three are needed to call a pattern [U].`,
    });
    unavailable.push("Surprise consistency");
  }

  // ── 3. Post-earnings drift, measured (7) ──
  const pead = latest?.reportedDate
    ? measurePead(input.candles, input.benchmark, latest.reportedDate)
    : null;
  if (pead && pead.excessPct != null) {
    const x = pead.excessPct;
    const pts = x >= 8 ? 7 : x >= 4 ? 5 : x >= 1 ? 3 : x >= -1 ? 1 : 0;
    lines.push({
      label: "Post-earnings drift (measured)",
      points: pts, max: 7, evaluated: true,
      detail: `${pead.driftPct >= 0 ? "+" : ""}${pead.driftPct}% since the report against ${pead.benchmarkPct! >= 0 ? "+" : ""}${pead.benchmarkPct}% for the benchmark — ${x >= 0 ? "+" : ""}${x}% excess over ${pead.sessions} sessions. ${pead.note}`,
    });
  } else if (pead) {
    lines.push({
      label: "Post-earnings drift (measured)", points: 0, max: 7, evaluated: false,
      detail: `Drift is ${pead.driftPct >= 0 ? "+" : ""}${pead.driftPct}% but no benchmark series was available to separate the name from the market [U].`,
    });
    unavailable.push("Benchmark-adjusted drift");
  } else {
    lines.push({
      label: "Post-earnings drift (measured)", points: 0, max: 7, evaluated: false,
      detail: "No reporting date with subsequent price history, so drift cannot be measured [U].",
    });
    unavailable.push("Post-earnings drift");
  }

  // ── 4. Revenue-growth acceleration (3) ──
  //
  // The nearest honest stand-in for estimate revisions: when year-on-year
  // revenue growth is accelerating quarter over quarter, estimates are usually
  // being revised up. It is a proxy and is labelled as one.
  const qWithYoY = input.quarters.filter((q) => (q as any).revenueYoY != null).slice(0, 4);
  if (qWithYoY.length >= 2) {
    const newest = (qWithYoY[0] as any).revenueYoY as number;
    const prior = (qWithYoY[1] as any).revenueYoY as number;
    const delta = (newest - prior) * 100;
    const pts = delta >= 5 ? 3 : delta >= 0 ? 2 : delta >= -5 ? 1 : 0;
    lines.push({
      label: "Growth acceleration (revision proxy)",
      points: pts, max: 3, evaluated: true,
      detail: `Revenue growth ${(newest * 100).toFixed(1)}% against ${(prior * 100).toFixed(1)}% the quarter before — ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} points. [E] a proxy for estimate revisions, which have no free source.`,
    });
  } else {
    lines.push({
      label: "Growth acceleration (revision proxy)", points: 0, max: 3, evaluated: false,
      detail: "Fewer than two quarters carry a year-on-year comparison [U].",
    });
    unavailable.push("Growth acceleration");
  }

  // ── 5. The next event (3) ──
  let daysAway: number | null = null;
  let blackout = false;
  if (input.nextEarningsDate) {
    daysAway = Math.round(
      (Date.parse(input.nextEarningsDate + "T00:00:00Z") -
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000
    );
    blackout = daysAway != null && daysAway >= 0 && daysAway <= BLACKOUT_DAYS;
    // A catalyst you can position ahead of is worth more than one months away,
    // but one landing tomorrow is a coin toss, not a setup.
    const pts = blackout ? 0 : daysAway != null && daysAway > 2 && daysAway <= 25 ? 3 : daysAway != null && daysAway <= 45 ? 2 : 1;
    lines.push({
      label: "Next scheduled catalyst",
      points: pts, max: 3, evaluated: true,
      detail: blackout
        ? `Results in ${daysAway} day${daysAway === 1 ? "" : "s"} — inside the ${BLACKOUT_DAYS}-day blackout. The fund does not open a position into a print; the outcome is not analysable, only guessable.`
        : `Results projected ${input.nextEarningsDate} (${daysAway} days). ${input.nextEarningsBasis ?? "Projected from the company's own reporting cadence [E]."}`,
    });
  } else {
    lines.push({
      label: "Next scheduled catalyst", points: 0, max: 3, evaluated: false,
      detail: "The next reporting date could not be projected from the filing history [U].",
    });
    unavailable.push("Next earnings date");
  }

  // ── Normalise over what could be evaluated (Rule #5) ──
  const evaluated = lines.filter((l) => l.evaluated);
  const rawMax = evaluated.reduce((s, l) => s + l.max, 0);
  const raw = evaluated.reduce((s, l) => s + l.points, 0);
  const score = rawMax > 0 ? Math.round((raw / rawMax) * 25) : null;
  const coveragePct = Math.round((rawMax / lines.reduce((s, l) => s + l.max, 0)) * 100);

  // A catalyst can point the wrong way, and that is information.
  const negative =
    (latestSurprise != null && latestSurprise < 0) ||
    (pead?.excessPct != null && pead.excessPct <= -5);

  const band: CatalystBand =
    negative ? "Negative"
      : score == null ? "None"
      : score >= 18 ? "Strong"
      : score >= 12 ? "Moderate"
      : score >= 6 ? "Weak"
      : "None";

  // ── The one-sentence thesis, assembled only from measurements ──
  const parts: string[] = [];
  if (input.theme) {
    parts.push(
      `sits in ${input.theme.label}, which is leading at ${input.theme.leadership}/100` +
      (input.theme.rs3mPct != null ? ` (${input.theme.rs3mPct >= 0 ? "+" : ""}${input.theme.rs3mPct.toFixed(1)}% vs SPY over 3 months)` : "")
    );
  }
  if (latestSurprise != null) {
    parts.push(`${latestSurprise >= 0 ? "beat" : "missed"} by ${Math.abs(latestSurprise).toFixed(1)}% last quarter`);
  }
  if (pead?.excessPct != null) {
    parts.push(`and has run ${pead.excessPct >= 0 ? "+" : ""}${pead.excessPct}% against the index in the ${pead.sessions} sessions since`);
  }
  if (daysAway != null && !blackout) parts.push(`next print in ${daysAway} days`);
  const thesis = parts.length
    ? parts.join(", ").replace(/^./, (c) => c.toUpperCase()) + "."
    : "No measurable catalyst: neither a consensus estimate nor a reporting date with subsequent price history was available, so this name is a momentum read only.";

  if (blackout) notes.push(`Earnings inside ${BLACKOUT_DAYS} days — no new position until the print is out.`);
  if (negative) notes.push("The catalyst reads negative. A drift running against the name after a report is the market disagreeing with the result, and it usually persists as long as a positive drift does.");
  notes.push(
    "Consensus revisions, guidance changes and product-cycle news are not in any free, keyless feed. They are excluded from the score, not estimated, and the coverage figure says how much of the model that cost."
  );

  return {
    score, coveragePct, band, negative, lines, pead,
    nextEvent: {
      date: input.nextEarningsDate ?? null,
      daysAway,
      blackout,
      basis: input.nextEarningsBasis ?? "Projected from the company's own reporting cadence [E] — not an announced date.",
    },
    theme: input.theme ?? null,
    thesis, notes, unavailable,
  };
}

/**
 * Aisha's 0-25 scale converted to Engine A's 0-10 catalyst line.
 *
 * Kept here so the two scales cannot drift apart: any change to the desk's
 * scoring flows into the engine automatically.
 */
export function toEngineCatalyst(read: CatalystRead | null): number | null {
  if (!read || read.score == null) return null;
  return Math.round(clamp((read.score / 25) * 10, 0, 10) * 10) / 10;
}
