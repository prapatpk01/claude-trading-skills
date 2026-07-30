// The forward calendar — what is coming, and what the fund does about each
// outcome BEFORE it lands.
//
// This is the part that makes the news desk forward-looking rather than a
// rear-view mirror. Reacting to a CPI print after it prints is competing with
// every algorithm on the tape. Deciding in advance what a hot print means for
// the book is a decision that can actually be executed.
//
// On dates, and this matters: the app has no verifiable source for the exact
// release schedule, so it does not pretend to one. Each release is projected
// from its published *convention* — the Employment Situation lands on the first
// Friday of the month, CPI in the second week, PCE at month end — and every
// projection is labelled with the rule that produced it and marked [E] for
// estimated. The FOMC is given at month resolution only, because the exact
// meeting dates are set by the committee and guessing them would be inventing
// data (Rule #5). Confirm any date that a decision depends on at the source.

import type { Theme } from "./classify";

export type DateBasis = "convention" | "month-only";

export interface MacroEvent {
  label: string;
  theme: Theme;
  /** ISO date when the convention gives a day; null at month resolution. */
  date: string | null;
  /** Human window, always shown — "Fri 7 Aug" or "somewhere in September". */
  window: string;
  basis: DateBasis;
  /** The rule that produced the date, stated so it can be checked. */
  rule: string;
  daysAway: number | null;
  source: string;
  /** What the fund does if the print comes in hostile to risk. */
  ifHostile: string;
  /** What it does if the print is supportive. */
  ifSupportive: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

function fmt(d: Date): string {
  return `${DAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`;
}

/** The nth given weekday of a month — first Friday is nth=1, dow=5. */
function nthWeekday(y: number, m: number, dow: number, nth: number): Date {
  const first = utc(y, m, 1);
  const shift = (dow - first.getUTCDay() + 7) % 7;
  return utc(y, m, 1 + shift + (nth - 1) * 7);
}

/** The first weekday-of-week `dow` on or after the given day of month. */
function weekdayOnOrAfter(y: number, m: number, day: number, dow: number): Date {
  const d = utc(y, m, day);
  const shift = (dow - d.getUTCDay() + 7) % 7;
  return utc(y, m, day + shift);
}

/** Last business day of a month. */
function lastBusinessDay(y: number, m: number): Date {
  let d = utc(y, m + 1, 0);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d = utc(y, m, d.getUTCDate() - 1);
  return d;
}

const dayGap = (from: Date, to: Date) =>
  Math.round((Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) / 86_400_000);

/**
 * The next occurrence of each recurring release, projected from its convention.
 * Returns events in date order, nearest first; month-resolution items sort last
 * within their month.
 */
export function macroCalendar(now = new Date(), horizonDays = 45): MacroEvent[] {
  const out: MacroEvent[] = [];

  /** Walk forward month by month until the projection lands ahead of today. */
  const nextFrom = (project: (y: number, m: number) => Date): Date => {
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth();
    for (let i = 0; i < 4; i++) {
      const d = project(y, m);
      if (dayGap(now, d) >= 0) return d;
      m++;
      if (m > 11) { m = 0; y++; }
    }
    return project(y, m);
  };

  const add = (
    label: string, theme: Theme, date: Date, rule: string, source: string,
    ifHostile: string, ifSupportive: string
  ) => {
    const away = dayGap(now, date);
    if (away > horizonDays) return;
    out.push({
      label, theme, date: iso(date), window: `${fmt(date)} [E]`, basis: "convention",
      rule, daysAway: away, source, ifHostile, ifSupportive,
    });
  };

  add(
    "Employment Situation (payrolls, unemployment)",
    "Labour market",
    nextFrom((y, m) => nthWeekday(y, m, 5, 1)),
    "Released on the first Friday of the month in most months, 08:30 ET.",
    "Bureau of Labor Statistics",
    "A weak print with rising unemployment is the one macro surprise that hits the growth sleeve and the income sleeve together. Do not add to cyclical or high-beta names in the same session — wait for the second day, when the initial reaction has been reversed or confirmed.",
    "A strong print without wage acceleration supports the growth sleeve. Treat it as permission to complete a staged add already decided on, not as a reason to raise the target.",
  );

  add(
    "Consumer Price Index",
    "Inflation",
    nextFrom((y, m) => weekdayOnOrAfter(y, m, 10, 3)),
    "Released in the second week of the month, usually Tuesday to Thursday, 08:30 ET. Projected as the first Wednesday on or after the 10th.",
    "Bureau of Labor Statistics",
    "A hot print removes rate cuts from the price and hits long-duration growth hardest. Pause any add to the growth sleeve for two sessions, and check that the cash sleeve is at or above the regime floor before the print, not after it.",
    "A cooling print widens what the growth sleeve can carry. Deploy staged tranches already approved; do not raise the sleeve target on one print.",
  );

  add(
    "Producer Price Index",
    "Inflation",
    nextFrom((y, m) => weekdayOnOrAfter(y, m, 11, 4)),
    "Released within a day or two of CPI. Projected as the first Thursday on or after the 11th.",
    "Bureau of Labor Statistics",
    "Confirms or contradicts CPI at the margin. Weigh it only where it disagrees with CPI — agreement adds no information.",
    "Supportive alongside a cool CPI strengthens the disinflation read; alone it is weak evidence.",
  );

  add(
    "Personal Income & Outlays (PCE inflation)",
    "Inflation",
    nextFrom((y, m) => lastBusinessDay(y, m)),
    "Released near the end of the month, 08:30 ET. Projected as the last business day.",
    "Bureau of Economic Analysis",
    "PCE is the Fed's own preferred gauge, so a hot core reading matters more for policy than a hot CPI does. Same response as CPI, with an extra session of patience.",
    "A cool core reading is the strongest single input to the case for cuts. Confirm with the tape before adding.",
  );

  // GDP: advance estimate lands late in the month after quarter end.
  const gdpMonths = [0, 3, 6, 9];
  const gdp = nextFrom((y, m) => {
    const target = gdpMonths.find((g) => g >= m) ?? gdpMonths[0];
    const yy = target < m ? y + 1 : y;
    return weekdayOnOrAfter(yy, target, 25, 4);
  });
  add(
    "GDP — advance estimate",
    "Growth",
    gdp,
    "Advance estimate released in the last week of the month following quarter end (January, April, July, October). Projected as the first Thursday on or after the 25th.",
    "Bureau of Economic Analysis",
    "A contraction or a sharp deceleration compresses multiples before it cuts earnings. Review the growth sleeve against the regime's cash floor rather than reacting name by name.",
    "Resilient growth with contained inflation is the best backdrop this book can have. It still does not license going over the position cap.",
  );

  // FOMC — month resolution, and no day count.
  //
  // The committee sets its own dates, and this app has no verifiable source for
  // them, so the month is projected from the eight-meetings-a-year cadence and
  // the day is left null. `daysAway` stays null too: a countdown to a date the
  // app does not know would be fabricated precision, and a meeting later in the
  // current month is neither ahead of nor behind today as far as this projection
  // can tell. Every FOMC month touching the horizon is listed, current month
  // included, so a late-month decision is never silently missing.
  //
  // Modern cadence: late Jan, mid Mar, end Apr/early May, mid Jun, late Jul,
  // mid Sep, late Oct/early Nov, mid Dec.
  const fomcMonths = [0, 2, 4, 5, 6, 8, 10, 11];
  {
    const horizonEnd = new Date(now.getTime() + horizonDays * 86_400_000);
    const months: string[] = [];
    let y = now.getUTCFullYear();
    let m = now.getUTCMonth();
    for (let i = 0; i < 14; i++) {
      const isCurrent = y === now.getUTCFullYear() && m === now.getUTCMonth();
      if (utc(y, m, 1) > horizonEnd && !isCurrent) break;
      if (fomcMonths.includes(m)) {
        months.push(`${MONTHS[m]} ${y}${isCurrent ? " (may already have passed)" : ""}`);
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
    // One entry, however many months it spans — the guidance is identical for
    // every meeting, and repeating it per month is noise.
    if (months.length) {
      out.push({
        label: "FOMC rate decision",
        theme: "Monetary policy",
        date: null,
        window: `${months.join(" or ")} — exact date not asserted`,
        basis: "month-only",
        rule:
          "The FOMC meets eight times a year, roughly every six to seven weeks. The month comes from that cadence; the exact date is the committee's to set and is not guessed here, so no day count is shown.",
        daysAway: null,
        source: "Federal Reserve — confirm the date at federalreserve.gov/monetarypolicy/fomccalendars.htm",
        ifHostile:
          "A hawkish hold or a hawkish dot plot re-prices the whole growth sleeve at once. Be at the regime's cash floor going in; a decision is the one event where being early costs nothing and being late costs the most.",
        ifSupportive:
          "A cut or a dovish shift is the strongest tailwind the growth sleeve gets. The response is to complete staged adds, not to exceed the sleeve band — a dovish Fed does not raise the position cap.",
      });
    }
  }

  // Dated events first, nearest first; month-only events last, since they carry
  // no day to sort on.
  out.sort((a, b) => {
    if (a.daysAway == null && b.daysAway == null) return 0;
    if (a.daysAway == null) return 1;
    if (b.daysAway == null) return -1;
    return a.daysAway - b.daysAway;
  });
  return out;
}

/**
 * Events close enough that a position decision today should account for them.
 * Month-only events are excluded by construction: without a date there is no
 * way to know whether they are inside the window.
 */
export function imminent(events: MacroEvent[], withinDays = 5): MacroEvent[] {
  return events.filter((e) => e.daysAway != null && e.daysAway <= withinDays);
}
