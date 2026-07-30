"use client";
import { cls } from "./format";

/**
 * The three price windows, rendered identically wherever they appear.
 *
 * One component rather than three inline copies, because the failure cases are
 * where this gets wrong: a null change must read "—", not "0.0%", and an
 * extended-hours quote must say which session it came from and what it is
 * measured against. Getting that right once beats getting it right in four
 * places.
 */

export interface Moves {
  changePct1D?: number | null;
  changePct1W?: number | null;
  weekSessions?: number | null;
  prevClose?: number | null;
  extended?: {
    session: "pre" | "post";
    price: number;
    changePct: number;
    fromClose: number;
    asOf: string;
  } | null;
  /** Legacy field, still sent by the cheap quote path. */
  changePercent?: number | null;
}

const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
const tone = (v: number | null | undefined) => (v == null ? "muted" : v > 0 ? "pos" : v < 0 ? "neg" : "muted");

/** A single signed percentage, or an em dash when it could not be measured. */
export function ChangePct({ value, title }: { value: number | null | undefined; title?: string }) {
  if (value == null) return <span className="muted" title={title ?? "Not available"}>—</span>;
  return <span className={tone(value)} title={title}>{fmt(value)}</span>;
}

/** The 1-day figure with the previous close it was measured against. */
export function DayChange({ m }: { m: Moves | null | undefined }) {
  const v = m?.changePct1D ?? m?.changePercent ?? null;
  return (
    <ChangePct
      value={v}
      title={m?.prevClose != null ? `Against the previous close of $${m.prevClose.toFixed(2)}` : undefined}
    />
  );
}

/** The 1-week figure, which says so when it covers fewer than five sessions. */
export function WeekChange({ m }: { m: Moves | null | undefined }) {
  const v = m?.changePct1W ?? null;
  const short = m?.weekSessions != null && m.weekSessions < 5;
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <ChangePct
        value={v}
        title={m?.weekSessions != null ? `Over the last ${m.weekSessions} trading session${m.weekSessions === 1 ? "" : "s"}` : undefined}
      />
      {short && <span className="muted" style={{ fontSize: 10 }}> ({m!.weekSessions}d)</span>}
    </span>
  );
}

/**
 * Pre- or post-market, when there is one. Renders nothing inside the regular
 * session — an empty cell is the honest state, not a zero.
 */
export function ExtendedHours({ m, compact = false }: { m: Moves | null | undefined; compact?: boolean }) {
  const e = m?.extended;
  if (!e) return <span className="muted">—</span>;
  const label = e.session === "pre" ? "PRE" : "POST";
  const when = new Date(e.asOf).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <span
      style={{ whiteSpace: "nowrap", display: "inline-flex", gap: 5, alignItems: "baseline" }}
      title={`${e.session === "pre" ? "Pre-market" : "After hours"} $${e.price.toFixed(2)} at ${when}, against the ${e.session === "pre" ? "previous" : "regular-session"} close of $${e.fromClose.toFixed(2)}`}
    >
      <span
        style={{
          fontSize: 9, fontWeight: 800, letterSpacing: 0.4, padding: "1px 4px", borderRadius: 4,
          color: e.session === "pre" ? "var(--cyan)" : "var(--amber)",
          background: e.session === "pre" ? "rgba(55,230,216,.13)" : "rgba(245,185,59,.14)",
        }}
      >
        {label}
      </span>
      <span className={tone(e.changePct)} style={{ fontWeight: 600 }}>{fmt(e.changePct)}</span>
      {!compact && <span className="muted" style={{ fontSize: 10.5 }}>${e.price.toFixed(2)}</span>}
    </span>
  );
}

/** All three, stacked — for a card or a header rather than a table row. */
export function MoveStack({ m }: { m: Moves | null | undefined }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline", fontSize: 12.5 }}>
      <span><span className="muted" style={{ fontSize: 10.5, marginRight: 4 }}>1D</span><DayChange m={m} /></span>
      <span><span className="muted" style={{ fontSize: 10.5, marginRight: 4 }}>1W</span><WeekChange m={m} /></span>
      {m?.extended && <ExtendedHours m={m} />}
    </div>
  );
}

/** Column headers, so every table labels these the same way. */
export const MOVE_HEADERS = (
  <>
    <th className="num" title="Last close against the one before it">1D</th>
    <th className="num" title="Last five trading sessions">1W</th>
    <th title="Pre-market or after-hours trade, when there is one">Pre / Post</th>
  </>
);

export function MoveCells({ m }: { m: Moves | null | undefined }) {
  return (
    <>
      <td className={cls("num")}><DayChange m={m} /></td>
      <td className={cls("num")}><WeekChange m={m} /></td>
      <td><ExtendedHours m={m} compact /></td>
    </>
  );
}
