"use client";
import { useMemo, useState } from "react";
import { money, pct } from "./format";

/**
 * Portfolio allocation donut — by sector or by holding.
 *
 * Palette: the reference categorical order, dark steps, validated against this
 * app's chart surface (#101728) with `scripts/validate_palette.js --mode dark`.
 * Six slots PASS every check on the adjacent pairlist (worst CVD ΔE 8.4, worst
 * normal-vision ΔE 19.3, all ≥ 3:1 contrast).
 *
 * They do NOT pass on the all-pairs list (worst CVD ΔE 1.6) — which is the list
 * that governs whenever a reader has to match a legend swatch to a ring
 * position. So identity here is never carried by color: every segment is
 * directly labelled, and the breakdown below is ordered to match the ring
 * (largest first, clockwise from 12 o'clock). Color is a secondary cue on top
 * of label and position, which puts the chart on the adjacent pairlist it
 * passes. Segments are capped at six plus "Other" for the same reason — past
 * ~7 classes, adjacent hues blur regardless.
 */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300"];
const OTHER = "#6b7796";
const SURFACE = "#101728";
const MUTED = "#93a1c0";
const TEXT = "#eaf0fb";

const MAX_SEGMENTS = 6;
/** Below this share a slice is too thin to carry a label on the ring. */
const LABEL_MIN_PCT = 4;

interface Slice {
  key: string;
  label: string;
  sub: string;
  value: number;
  weightPct: number;
  color: string;
}

interface Arc extends Slice {
  start: number;
  end: number;
  mid: number;
}

const TAU = Math.PI * 2;
const polar = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];

/** Annular sector path, drawn clockwise from 12 o'clock. */
function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, rOuter, start);
  const [x1, y1] = polar(cx, cy, rOuter, end);
  const [x2, y2] = polar(cx, cy, rInner, end);
  const [x3, y3] = polar(cx, cy, rInner, start);
  return [
    `M ${x0.toFixed(2)} ${y0.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `L ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/** Fold the tail into "Other" so no slice ever needs a generated hue. */
function toSlices(items: Omit<Slice, "color">[]): Slice[] {
  const sorted = [...items].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SEGMENTS + 1) {
    return sorted.map((s, i) => ({ ...s, color: SERIES[i] ?? OTHER }));
  }
  const head = sorted.slice(0, MAX_SEGMENTS).map((s, i) => ({ ...s, color: SERIES[i] }));
  const tail = sorted.slice(MAX_SEGMENTS);
  return [
    ...head,
    {
      key: "__other",
      label: "Other",
      sub: `${tail.length} more: ${tail.map((t) => t.label).join(", ")}`,
      value: tail.reduce((s, t) => s + t.value, 0),
      weightPct: tail.reduce((s, t) => s + t.weightPct, 0),
      color: OTHER,
    },
  ];
}

export default function AllocationDonut({ allocation }: { allocation: any }) {
  const [mode, setMode] = useState<"sector" | "holding">("sector");
  const [hover, setHover] = useState<string | null>(null);

  const slices = useMemo<Slice[]>(() => {
    if (!allocation) return [];
    if (mode === "sector") {
      return toSlices(
        (allocation.bySector ?? []).map((s: any) => ({
          key: s.sector,
          label: s.sector,
          sub: s.tickers.join(", "),
          value: s.value,
          weightPct: s.weightPct,
        }))
      );
    }
    return toSlices(
      (allocation.holdings ?? []).map((h: any) => ({
        key: h.ticker,
        label: h.ticker,
        sub: h.sector,
        value: h.value,
        weightPct: h.weightPct,
      }))
    );
  }, [allocation, mode]);

  const total = slices.reduce((s, x) => s + x.value, 0);

  const arcs = useMemo<Arc[]>(() => {
    if (total <= 0) return [];
    // A 2px surface gap between fills, expressed as the angle 2px subtends at
    // the ring's mid-radius — and never more than a third of a slice, so a thin
    // slice is narrowed rather than erased.
    const gap = 2 / 78;
    let a = 0;
    return slices.map((s) => {
      const span = (s.value / total) * TAU;
      const inset = Math.min(gap, span / 3);
      const start = a + inset / 2;
      const end = a + span - inset / 2;
      a += span;
      return { ...s, start, end, mid: (start + end) / 2 };
    });
  }, [slices, total]);

  if (!allocation || !slices.length || total <= 0) {
    return <p className="muted" style={{ fontSize: 13 }}>Add a holding to see the allocation breakdown.</p>;
  }

  // The ring sits centred with ~130px of clear space each side for the direct
  // labels — a left-side label is right-aligned and grows outward, so the box
  // has to hold the longest sector name at 11.5px without clipping.
  const W = 470, H = 300, CX = 235, CY = 150, R_OUT = 92, R_IN = 64;
  const LABEL_R = R_OUT + 9;
  const LINE_H = 27;

  /**
   * Direct labels, de-collided vertically within each side. Two adjacent thin
   * slices put their labels a few degrees apart, which overlaps two lines of
   * text — so each side is swept top-down and anything closer than a line
   * height is pushed clear, with the leader line following it.
   */
  const labels = (() => {
    const placed = arcs
      .filter((a) => a.weightPct >= LABEL_MIN_PCT)
      .map((a) => {
        const [ax, ay] = polar(CX, CY, R_OUT + 2, a.mid);
        const [lx, ly] = polar(CX, CY, LABEL_R, a.mid);
        return { arc: a, ax, ay, lx, y: ly, right: Math.sin(a.mid) >= 0 };
      });
    for (const side of [true, false]) {
      const col = placed.filter((p) => p.right === side).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) {
        if (col[i].y - col[i - 1].y < LINE_H) col[i].y = col[i - 1].y + LINE_H;
      }
      // If the push ran past the bottom, walk back up from the last label.
      for (let i = col.length - 1; i > 0; i--) {
        if (col[i].y > H - 18) col[i].y = H - 18;
        if (col[i].y - col[i - 1].y < LINE_H) col[i - 1].y = col[i].y - LINE_H;
      }
      if (col.length && col[0].y < 18) col[0].y = 18;
    }
    return placed;
  })();

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {mode === "sector"
            ? `${allocation.bySector.length} sector${allocation.bySector.length === 1 ? "" : "s"} across ${allocation.holdings.length} position${allocation.holdings.length === 1 ? "" : "s"}`
            : `${allocation.holdings.length} position${allocation.holdings.length === 1 ? "" : "s"}`}
        </span>
        <div className="tabs" style={{ padding: 4 }}>
          {(["sector", "holding"] as const).map((m) => (
            <button key={m} className={`tab ${mode === m ? "active" : ""}`} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setMode(m)}>
              {m === "sector" ? "By sector" : "By holding"}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 470, height: "auto", display: "block" }}
          role="img"
          aria-label={`Portfolio allocation by ${mode}. ${slices.map((s) => `${s.label} ${s.weightPct.toFixed(1)} percent`).join(", ")}.`}
        >
          {arcs.map((a) => {
            const dim = hover !== null && hover !== a.key;
            return (
              <path
                key={a.key}
                d={arcPath(CX, CY, R_OUT, R_IN, a.start, a.end)}
                fill={a.color}
                opacity={dim ? 0.35 : 1}
                stroke={SURFACE}
                strokeWidth={hover === a.key ? 2 : 0}
                onMouseEnter={() => setHover(a.key)}
                onMouseLeave={() => setHover(null)}
                style={{ cursor: "default", transition: "opacity .12s" }}
              />
            );
          })}

          {/* Hero figure in the hole: what the ring adds up to */}
          <text x={CX} y={CY - 6} textAnchor="middle" fill={TEXT} fontSize="21" fontWeight="700">
            {money(total)}
          </text>
          <text x={CX} y={CY + 14} textAnchor="middle" fill={MUTED} fontSize="11" letterSpacing="0.4">
            {hover ? slices.find((s) => s.key === hover)?.label ?? "TOTAL" : "TOTAL"}
          </text>
          {hover && (
            <text x={CX} y={CY + 31} textAnchor="middle" fill={TEXT} fontSize="13" fontWeight="600">
              {pct(slices.find((s) => s.key === hover)?.weightPct ?? 0)}
            </text>
          )}

          {/* Direct labels — identity never rests on the color alone */}
          {labels.map(({ arc: a, ax, ay, lx, y, right }) => {
            const tx = right ? lx + 5 : lx - 5;
            return (
              <g key={`l-${a.key}`} opacity={hover !== null && hover !== a.key ? 0.4 : 1}>
                <polyline
                  points={`${ax.toFixed(1)},${ay.toFixed(1)} ${lx.toFixed(1)},${y.toFixed(1)}`}
                  fill="none" stroke={MUTED} strokeWidth="1"
                />
                <text x={tx} y={y - 1} textAnchor={right ? "start" : "end"} fill={TEXT} fontSize="11.5" fontWeight="600">
                  {a.label.length > 19 ? `${a.label.slice(0, 18)}…` : a.label}
                </text>
                <text x={tx} y={y + 12} textAnchor={right ? "start" : "end"} fill={MUTED} fontSize="11">
                  {pct(a.weightPct)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Breakdown, in ring order — doubles as the table view */}
        <div style={{ flex: "1 1 260px", minWidth: 240 }}>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>{mode === "sector" ? "Sector" : "Holding"}</th>
                  <th className="num">Value</th>
                  <th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {slices.map((s) => (
                  <tr
                    key={s.key}
                    onMouseEnter={() => setHover(s.key)}
                    onMouseLeave={() => setHover(null)}
                    style={{ background: hover === s.key ? "rgba(120,150,220,.08)" : undefined }}
                  >
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flex: "0 0 auto" }} />
                        <span>
                          <strong>{s.label}</strong>
                          {s.sub && <><br /><span className="muted" style={{ fontSize: 11 }}>{s.sub.length > 44 ? `${s.sub.slice(0, 43)}…` : s.sub}</span></>}
                        </span>
                      </span>
                    </td>
                    <td className="num">{money(s.value)}</td>
                    <td className="num"><strong>{pct(s.weightPct)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {(allocation.fundPct > 0 || allocation.unclassifiedPct > 0) && (
        <p className="notice" style={{ marginTop: 12 }}>
          {allocation.fundPct > 0 && (
            <>
              <strong>{pct(allocation.fundPct)}</strong> of the book sits in funds and ETFs. Those are shown as a single
              class — the allocation does not look through a wrapper to the sectors it holds, so true sector exposure is
              more diversified than the ring suggests.{" "}
            </>
          )}
          {allocation.unclassifiedPct > 0 && (
            <>
              <strong>{pct(allocation.unclassifiedPct)}</strong> could not be classified — no SEC industry code was found
              for those symbols.
            </>
          )}
        </p>
      )}
    </div>
  );
}
