// Did the idea work?
//
// A watchlist entry saved from the scanner carries the levels the setup was
// built on. This replays the daily bars since it was added and reports what
// actually happened — target reached, stop taken out, or still open — so the
// list is a record of outcomes rather than a pile of tickers.

import type { Candle } from "./types";

export type IdeaStatus = "TARGET HIT" | "STOPPED" | "OPEN" | "NO LEVELS" | "NO DATA";

export interface IdeaOutcome {
  status: IdeaStatus;
  /** Date the target or stop was first touched. */
  resolvedOn: string | null;
  /** Trading days from being added to resolution (or to today while open). */
  daysHeld: number | null;
  entry: number | null;
  target: number | null;
  stop: number | null;
  currentPrice: number | null;
  /** Return from the entry reference to the current price. */
  returnPct: number | null;
  /** Best and worst the idea got to while open. */
  maxFavourablePct: number | null;
  maxAdversePct: number | null;
  /** How far price still has to travel, as a percentage. */
  toTargetPct: number | null;
  toStopPct: number | null;
  /** 0-100 progress from entry toward the target. */
  progressPct: number | null;
  note: string;
}

export interface IdeaInput {
  addedOn: string;      // YYYY-MM-DD
  entry: number | null;
  target: number | null;
  stop: number | null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Replay the bars from the day the idea was added.
 * Target and stop are judged on intrabar extremes: a wick through the level
 * is a touch, which is how the trade would actually have filled. When both
 * are touched on the same bar the stop is assumed first — the conservative
 * reading, since daily bars can't say which came first.
 */
export function evaluateIdea(input: IdeaInput, candles: Candle[]): IdeaOutcome {
  const { addedOn, target, stop } = input;
  const base: IdeaOutcome = {
    status: "NO LEVELS",
    resolvedOn: null, daysHeld: null,
    entry: input.entry, target, stop,
    currentPrice: null, returnPct: null,
    maxFavourablePct: null, maxAdversePct: null,
    toTargetPct: null, toStopPct: null, progressPct: null,
    note: "No target or stop was recorded for this idea.",
  };

  if (!candles.length) {
    return { ...base, status: "NO DATA", note: "No price history available for this symbol." };
  }

  const window = candles.filter((c) => c.date >= addedOn);
  const bars = window.length ? window : candles.slice(-1);
  const current = bars[bars.length - 1].close;
  // Fall back to the close on the day it was added when no entry was stored.
  const entry = input.entry ?? bars[0]?.close ?? null;

  const pct = (from: number, to: number) => ((to - from) / from) * 100;

  const currentReturn = entry ? r2(pct(entry, current)) : null;
  let maxFav: number | null = null;
  let maxAdv: number | null = null;
  if (entry) {
    const highest = Math.max(...bars.map((c) => c.high));
    const lowest = Math.min(...bars.map((c) => c.low));
    maxFav = r2(pct(entry, highest));
    maxAdv = r2(pct(entry, lowest));
  }

  if (target == null && stop == null) {
    return {
      ...base,
      entry, currentPrice: r2(current), returnPct: currentReturn,
      maxFavourablePct: maxFav, maxAdversePct: maxAdv,
      daysHeld: bars.length,
      note: "Tracked without levels — add a target to judge whether it worked.",
    };
  }

  // walk forward to the first level touched
  let resolved: { status: IdeaStatus; date: string; index: number } | null = null;
  for (let i = 0; i < bars.length; i++) {
    const c = bars[i];
    const hitStop = stop != null && c.low <= stop;
    const hitTarget = target != null && c.high >= target;
    if (hitStop) { resolved = { status: "STOPPED", date: c.date, index: i }; break; }
    if (hitTarget) { resolved = { status: "TARGET HIT", date: c.date, index: i }; break; }
  }

  const toTargetPct = target != null ? r2(pct(current, target)) : null;
  const toStopPct = stop != null ? r2(pct(current, stop)) : null;
  const progressPct =
    entry != null && target != null && target !== entry
      ? Math.max(0, Math.min(100, r2(((current - entry) / (target - entry)) * 100)))
      : null;

  if (resolved) {
    const hitPrice = resolved.status === "TARGET HIT" ? target! : stop!;
    return {
      status: resolved.status,
      resolvedOn: resolved.date,
      daysHeld: resolved.index + 1,
      entry, target, stop,
      currentPrice: r2(current),
      returnPct: currentReturn,
      maxFavourablePct: maxFav,
      maxAdversePct: maxAdv,
      toTargetPct, toStopPct, progressPct,
      note:
        resolved.status === "TARGET HIT"
          ? `Target ${hitPrice} reached on ${resolved.date}, ${resolved.index + 1} trading day${resolved.index === 0 ? "" : "s"} after it was added.`
          : `Stop ${hitPrice} was taken out on ${resolved.date}. Levels are judged on intrabar extremes, and when a bar touches both the stop is assumed first.`,
    };
  }

  return {
    status: "OPEN",
    resolvedOn: null,
    daysHeld: bars.length,
    entry, target, stop,
    currentPrice: r2(current),
    returnPct: currentReturn,
    maxFavourablePct: maxFav,
    maxAdversePct: maxAdv,
    toTargetPct, toStopPct, progressPct,
    note:
      progressPct != null
        ? `Neither level touched in ${bars.length} sessions — ${progressPct}% of the way to target.`
        : `Neither level touched in ${bars.length} sessions.`,
  };
}

/** Aggregate hit rate across resolved ideas. */
export function summariseIdeas(outcomes: IdeaOutcome[]): {
  hit: number; stopped: number; open: number; hitRatePct: number | null; note: string;
} {
  const hit = outcomes.filter((o) => o.status === "TARGET HIT").length;
  const stopped = outcomes.filter((o) => o.status === "STOPPED").length;
  const open = outcomes.filter((o) => o.status === "OPEN").length;
  const resolved = hit + stopped;
  return {
    hit, stopped, open,
    hitRatePct: resolved > 0 ? Math.round((hit / resolved) * 100) : null,
    // Rule #6 — a small sample is not a verified win rate.
    note:
      resolved === 0
        ? "No idea has resolved yet."
        : resolved < 20
        ? `Component Estimate from ${resolved} resolved idea${resolved === 1 ? "" : "s"} — not a verified win rate (the fund requires ≥100 live trades).`
        : `Component Estimate from ${resolved} resolved ideas — still short of the 100-trade bar for a verified rate.`,
  };
}
