// Price change over the windows a decision actually uses, plus extended hours.
//
// Three separate questions, which the app previously answered with one number:
//
//   1D   last regular close against the one before it. "Is today up?"
//   1W   the last five sessions. One session is noise; a week is the shortest
//        window where a move usually means something.
//   pre  / post — where the stock is trading now, outside the session. This is
//        where an overnight earnings reaction or a macro print shows up first,
//        and it is the number that matters at 8am, before the open.
//
// Sessions are read from the exchange's own trading-period metadata rather than
// guessed from a clock, so a half-day, a holiday, or a non-US listing is handled
// by the venue that sets the hours instead of by an assumption baked in here.
//
// Anything unmeasurable is null and named in `missing`, never zero: a 0.0%
// weekly change and "we could not read the weekly change" are different facts,
// and showing the first when the second is true is the failure mode this app
// exists to avoid (Rule #5).

import { yahooChartRaw } from "./yahoo";
import { dailyCandles } from "./marketData";
import type { Candle } from "./types";

export type ExtendedSession = "pre" | "post";

export interface SessionMove {
  session: ExtendedSession;
  price: number;
  /** Against the regular-session close this move is measured from. */
  changePct: number;
  /** The close it is measured against. */
  fromClose: number;
  asOf: string;
}

export interface PriceMoves {
  ticker: string;
  /** Last regular-session price — live during the session, the close after it. */
  price: number | null;
  prevClose: number | null;
  changePct1D: number | null;
  changePct1W: number | null;
  /** Sessions actually used for the weekly figure, when it is not a full five. */
  weekSessions: number | null;
  extended: SessionMove | null;
  asOf: string | null;
  /** Where `price` came from — a live quote or the last daily bar. */
  priceSource: "live quote" | "last daily close" | null;
  /** Calendar days between `asOf` and now. */
  ageDays: number | null;
  /**
   * True when the price is older than the most recent weekday, i.e. old enough
   * that it is probably not the current market price. Surfaced rather than
   * hidden: a stale price that looks live is worse than one labelled stale.
   */
  stale: boolean;
  staleReason: string | null;
  missing: string[];
}

const SESSIONS_PER_WEEK = 5;

const pctChange = (from: number, to: number): number | null =>
  from > 0 && Number.isFinite(to) ? ((to - from) / from) * 100 : null;

/**
 * Daily windows from a candle series. Split out so it can be tested without a
 * network call, and so a caller that already holds candles need not refetch.
 */
export function movesFromCandles(candles: Candle[]): {
  price: number | null;
  prevClose: number | null;
  changePct1D: number | null;
  changePct1W: number | null;
  weekSessions: number | null;
  asOf: string | null;
  missing: string[];
} {
  const missing: string[] = [];
  if (!candles.length) {
    return {
      price: null, prevClose: null, changePct1D: null, changePct1W: null,
      weekSessions: null, asOf: null,
      missing: ["No price history was returned, so no change could be measured."],
    };
  }
  const closes = candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
  const last = closes[closes.length - 1] ?? null;
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;

  if (prevClose == null) missing.push("Only one session of history — the daily change needs two.");

  // A short series still yields a weekly figure, but it says how many sessions
  // it actually covers rather than passing four off as five.
  let changePct1W: number | null = null;
  let weekSessions: number | null = null;
  if (closes.length >= 2 && last != null) {
    const back = Math.min(SESSIONS_PER_WEEK, closes.length - 1);
    const from = closes[closes.length - 1 - back];
    changePct1W = pctChange(from, last);
    weekSessions = back;
    if (back < SESSIONS_PER_WEEK) {
      missing.push(`Weekly change covers ${back} session${back === 1 ? "" : "s"}, not five — that is all the history available.`);
    }
  } else {
    missing.push("Not enough history for a weekly change.");
  }

  return {
    price: last,
    prevClose,
    changePct1D: prevClose != null && last != null ? pctChange(prevClose, last) : null,
    changePct1W,
    weekSessions,
    asOf: candles[candles.length - 1]?.date ?? null,
    missing,
  };
}

interface Period { start: number; end: number }

/** Trading-period bounds from chart metadata, in epoch seconds. */
function periods(meta: any): { pre?: Period; regular?: Period; post?: Period } {
  const raw = meta?.currentTradingPeriod;
  if (!raw) return {};
  const one = (p: any): Period | undefined => {
    const start = typeof p?.start === "number" ? p.start : p?.start instanceof Date ? p.start.getTime() / 1000 : null;
    const end = typeof p?.end === "number" ? p.end : p?.end instanceof Date ? p.end.getTime() / 1000 : null;
    return start != null && end != null ? { start, end } : undefined;
  };
  return { pre: one(raw.pre), regular: one(raw.regular), post: one(raw.post) };
}

const secondsOf = (d: any): number | null =>
  d instanceof Date ? Math.floor(d.getTime() / 1000) : typeof d === "number" ? d : null;

/**
 * The extended-hours read.
 *
 * Deliberately conservative about *which* close to measure against, because
 * this is where the number is easy to get wrong: pre-market is measured against
 * yesterday's close, post-market against today's. Yahoo's `chartPreviousClose`
 * is the close preceding the whole window, so it is right for pre-market and
 * wrong for post-market — post-market uses the last regular bar in the series
 * instead.
 */
export async function extendedHours(ticker: string): Promise<SessionMove | null> {
  try {
    const res: any = await yahooChartRaw(ticker, {
      period1: new Date(Date.now() - 4 * 86_400_000),
      interval: "5m",
      includePrePost: true,
    });
    const rows: any[] = res?.quotes ?? [];
    const p = periods(res?.meta);
    if (!rows.length || !p.regular) return null;

    // The last bar with a price, and its timestamp in epoch seconds.
    let lastIdx = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.close != null && secondsOf(rows[i].date) != null) { lastIdx = i; break; }
    }
    if (lastIdx < 0) return null;
    const lastBar = rows[lastIdx];
    const t = secondsOf(lastBar.date)!;

    // Inside the regular session there is nothing extended to report.
    if (t >= p.regular.start && t <= p.regular.end) return null;

    const isPre = t < p.regular.start;
    const isPost = t > p.regular.end;
    if (!isPre && !isPost) return null;

    let fromClose: number | null = null;
    if (isPre) {
      // The close before this window — exactly what chartPreviousClose means.
      const cp = res?.meta?.chartPreviousClose ?? res?.meta?.previousClose;
      fromClose = typeof cp === "number" && cp > 0 ? cp : null;
      if (fromClose == null) {
        // Fall back to the last bar that sat inside a regular session.
        for (let i = lastIdx; i >= 0; i--) {
          const ts = secondsOf(rows[i]?.date);
          if (ts != null && rows[i].close != null && ts >= p.regular.start && ts <= p.regular.end) {
            fromClose = rows[i].close;
            break;
          }
        }
      }
    } else {
      // Post-market: measure against today's regular close, not yesterday's.
      for (let i = lastIdx; i >= 0; i--) {
        const ts = secondsOf(rows[i]?.date);
        if (ts != null && rows[i].close != null && ts <= p.regular.end) { fromClose = rows[i].close; break; }
      }
      if (fromClose == null && typeof res?.meta?.regularMarketPrice === "number") {
        fromClose = res.meta.regularMarketPrice;
      }
    }
    const change = fromClose != null ? pctChange(fromClose, lastBar.close) : null;
    if (change == null || fromClose == null) return null;

    return {
      session: isPre ? "pre" : "post",
      price: lastBar.close,
      changePct: change,
      fromClose,
      asOf: new Date(t * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}

/** The most recent weekday on or before a date — a crude session calendar. */
function lastWeekdayOnOrBefore(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  while (x.getUTCDay() === 0 || x.getUTCDay() === 6) x.setUTCDate(x.getUTCDate() - 1);
  return x;
}

/**
 * Judge how current a price is.
 *
 * Exported and pure so the rule can be tested without a network call. A price is
 * called stale when its date is more than one weekday behind — one day of lag is
 * normal before an open or on a holiday, several is not. Holidays are not in the
 * calendar here, so a long weekend can read as one day stale; that is the safe
 * direction to be wrong in, since the label invites a refresh rather than
 * suppressing information.
 */
export function judgeFreshness(asOf: string | null, now = new Date()): {
  ageDays: number | null;
  stale: boolean;
  staleReason: string | null;
} {
  if (!asOf) return { ageDays: null, stale: true, staleReason: "No timestamp on the price." };
  const t = Date.parse(asOf);
  if (!Number.isFinite(t)) return { ageDays: null, stale: true, staleReason: "Price timestamp could not be read." };
  const priceDay = new Date(Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate()));
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const ageDays = Math.round((today.getTime() - priceDay.getTime()) / 86_400_000);

  // One weekday of lag is the normal state before a session opens.
  const expected = lastWeekdayOnOrBefore(new Date(today.getTime() - 86_400_000));
  const stale = priceDay.getTime() < expected.getTime();
  return {
    ageDays,
    stale,
    staleReason: stale
      ? `Price is dated ${asOf.slice(0, 10)}, which is behind the last trading day. The feed did not return a fresher bar — refresh, and if it persists the symbol may be delisted, renamed, or unsupported by the free endpoint.`
      : null,
  };
}

/**
 * Everything, for one ticker.
 *
 * The daily series is read from the chart endpoint together with its metadata,
 * so the live `regularMarketPrice` is available in the same response. That
 * matters: the last *daily bar* is yesterday's close until today's bar is
 * written, so a book valued on daily bars alone shows yesterday's prices through
 * the whole session. Where the metadata carries a fresher regular-market price,
 * it wins, and `priceSource` records which was used.
 */
export async function getPriceMoves(ticker: string): Promise<PriceMoves> {
  const [candles, ext, meta] = await Promise.all([
    dailyCandles(ticker, 30).catch(() => [] as Candle[]),
    extendedHours(ticker),
    yahooChartRaw(ticker, { period1: new Date(Date.now() - 7 * 86_400_000), interval: "1d" })
      .then((r: any) => r?.meta ?? null)
      .catch(() => null),
  ]);
  const daily = movesFromCandles(candles);
  const missing = [...daily.missing];

  let price = daily.price;
  let asOf = daily.asOf;
  let changePct1D = daily.changePct1D;
  let priceSource: PriceMoves["priceSource"] = daily.price != null ? "last daily close" : null;

  const live = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const liveTime = secondsOf(meta?.regularMarketTime);
  if (live != null && live > 0) {
    const liveDay = liveTime != null ? new Date(liveTime * 1000).toISOString().slice(0, 10) : null;
    // Only take the live price when it is at least as recent as the last bar,
    // so a cached metadata value cannot drag the price backwards.
    if (!asOf || !liveDay || liveDay >= asOf) {
      price = live;
      priceSource = "live quote";
      if (liveDay) asOf = liveDay;
      // Re-measure the day change against the close the live price moved from.
      const ref =
        typeof meta?.chartPreviousClose === "number" && meta.chartPreviousClose > 0
          ? meta.chartPreviousClose
          : daily.prevClose;
      if (ref != null && ref > 0) changePct1D = pctChange(ref, live);
    }
  }

  if (!ext) {
    // Not an error: inside the session, or the venue has no extended session.
    missing.push("No extended-hours trade found — either the regular session is open, or this listing has no pre/post market.");
  }
  const freshness = judgeFreshness(asOf);
  if (freshness.stale && freshness.staleReason) missing.push(freshness.staleReason);

  return {
    ticker,
    ...daily,
    price,
    asOf,
    changePct1D,
    priceSource,
    extended: ext,
    ageDays: freshness.ageDays,
    stale: freshness.stale,
    staleReason: freshness.staleReason,
    missing,
  };
}
