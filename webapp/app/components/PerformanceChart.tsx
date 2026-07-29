"use client";
import { useMemo, useState } from "react";
import { money, pct, cls } from "./format";

// Palette validated with the dataviz validator against this app's dark chart
// surface (#101728): lightness band, chroma floor, CVD separation, normal-
// vision floor and contrast all PASS.
const SERIES_PORTFOLIO = "#3987e5"; // slot 1 blue
const SERIES_BENCH = "#d95926"; // slot 2 orange
const GRID = "#2c3550";
const MUTED = "#93a1c0";
const SURFACE = "#101728";

interface Point { date: string; value: number; benchmark: number | null }

/**
 * Axis ticks on round numbers (…, 50k, 55k, 60k) rather than wherever the
 * padded data domain happens to land — ticks carry the values that aren't
 * directly labelled, so they have to be readable at a glance.
 */
function niceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const mag = Math.pow(10, Math.floor(Math.log10(span / target)));
  // Try a round step at this magnitude and the ones either side, then keep the
  // one landing closest to the target count — a single fixed rule leaves some
  // ranges with only two gridlines.
  const candidates = [0.5, 1, 2, 2.5, 5, 10, 20].map((m) => m * mag);
  const count = (step: number) => Math.floor((hi - Math.ceil(lo / step) * step) / step) + 1;
  let step = candidates[0];
  let bestScore = Infinity;
  for (const c of candidates) {
    const n = count(c);
    if (n < 3 || n > 8) continue;
    const score = Math.abs(n - target);
    if (score < bestScore) { bestScore = score; step = c; }
  }
  if (bestScore === Infinity) step = span / (target - 1); // fall back to even split
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(v);
  return ticks.length >= 2 ? ticks : [lo, hi];
}

/** Compact axis money label: 62000 → $62k, 1500 → $1.5k, 24 → $24 */
function axisMoney(v: number): string {
  const a = Math.abs(v);
  if (a < 1e-9) return "$0";
  if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `$${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  if (a >= 10) return `$${Math.round(v)}`;
  return `$${v.toFixed(1)}`;
}

export default function PerformanceChart({
  points,
  height = 240,
}: {
  points: Point[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  const W = 720;
  const H = height;
  const PAD = { top: 14, right: 16, bottom: 26, left: 58 };

  const geom = useMemo(() => {
    const vals: number[] = [];
    points.forEach((p) => {
      vals.push(p.value);
      if (p.benchmark != null) vals.push(p.benchmark);
    });
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    // pad the domain so the line never touches the frame
    const lo = min - span * 0.08;
    const hi = max + span * 0.08;
    const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
    const path = (key: "value" | "benchmark") => {
      let d = "";
      let started = false;
      points.forEach((p, i) => {
        const v = key === "value" ? p.value : p.benchmark;
        if (v == null) return;
        d += `${started ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        started = true;
      });
      return d;
    };
    const areaPath = () => {
      const base = y(lo);
      let d = `M${x(0).toFixed(1)},${base.toFixed(1)}`;
      points.forEach((p, i) => (d += `L${x(i).toFixed(1)},${y(p.value).toFixed(1)}`));
      d += `L${x(points.length - 1).toFixed(1)},${base.toFixed(1)}Z`;
      return d;
    };
    const ticks = niceTicks(lo, hi, 4);
    return { x, y, path, areaPath, ticks, lo, hi };
  }, [points, H]);

  if (points.length < 2) return <p className="muted">Not enough history to plot.</p>;

  const hoverPt = hover != null ? points[hover] : null;
  const first = points[0];
  const last = points[points.length - 1];
  const hasBench = points.some((p) => p.benchmark != null);

  const fmtDate = (d: string) =>
    new Date(d + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });

  return (
    <div>
      {/* legend — identity is never color-alone */}
      {hasBench && (
        <div style={{ display: "flex", gap: 16, marginBottom: 8, fontSize: 12, color: MUTED, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 2, background: SERIES_PORTFOLIO, borderRadius: 2 }} /> Portfolio
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 14, height: 2, background: SERIES_BENCH, borderRadius: 2 }} /> SPY (rebased)
          </span>
        </div>
      )}

      <div style={{ position: "relative", width: "100%" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", height: "auto", display: "block", touchAction: "pan-y" }}
          role="img"
          aria-label="Portfolio value over time compared with SPY"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const rel = ((e.clientX - rect.left) / rect.width) * W;
            const t = (rel - PAD.left) / (W - PAD.left - PAD.right);
            const i = Math.round(t * (points.length - 1));
            setHover(i >= 0 && i < points.length ? i : null);
          }}
        >
          {/* gridlines: hairline, solid, recessive */}
          {geom.ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={geom.y(t)} y2={geom.y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={geom.y(t) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
                {axisMoney(t)}
              </text>
            </g>
          ))}

          {/* area wash ~10% opacity */}
          <path d={geom.areaPath()} fill={SERIES_PORTFOLIO} opacity={0.1} />

          {hasBench && (
            <path d={geom.path("benchmark")} fill="none" stroke={SERIES_BENCH} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          )}
          <path d={geom.path("value")} fill="none" stroke={SERIES_PORTFOLIO} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* crosshair + markers with a 2px surface ring */}
          {hoverPt && (
            <g>
              <line x1={geom.x(hover!)} x2={geom.x(hover!)} y1={PAD.top} y2={H - PAD.bottom} stroke={MUTED} strokeWidth={1} />
              {hoverPt.benchmark != null && (
                <circle cx={geom.x(hover!)} cy={geom.y(hoverPt.benchmark)} r={4.5} fill={SERIES_BENCH} stroke={SURFACE} strokeWidth={2} />
              )}
              <circle cx={geom.x(hover!)} cy={geom.y(hoverPt.value)} r={4.5} fill={SERIES_PORTFOLIO} stroke={SURFACE} strokeWidth={2} />
            </g>
          )}

          {/* end marker + direct label (selective: endpoint only) */}
          {!hoverPt && (
            <circle cx={geom.x(points.length - 1)} cy={geom.y(last.value)} r={4.5} fill={SERIES_PORTFOLIO} stroke={SURFACE} strokeWidth={2} />
          )}

          {/* x labels: first and last only, so they never collide */}
          <text x={PAD.left} y={H - 8} fontSize={10} fill={MUTED}>{fmtDate(first.date)}</text>
          <text x={W - PAD.right} y={H - 8} fontSize={10} fill={MUTED} textAnchor="end">{fmtDate(last.date)}</text>
        </svg>

        {hoverPt && (
          <div
            style={{
              position: "absolute", top: 6, left: 0, right: 0, pointerEvents: "none",
              display: "flex", justifyContent: "center",
            }}
          >
            <div style={{
              background: "rgba(6,10,20,.94)", border: "1px solid var(--border-strong)",
              borderRadius: 10, padding: "8px 12px", fontSize: 12, whiteSpace: "nowrap",
            }}>
              <div style={{ color: MUTED, marginBottom: 3 }}>{fmtDate(hoverPt.date)}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 10, height: 2, background: SERIES_PORTFOLIO, borderRadius: 2 }} />
                <strong>{money(hoverPt.value)}</strong>
              </div>
              {hoverPt.benchmark != null && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ width: 10, height: 2, background: SERIES_BENCH, borderRadius: 2 }} />
                  <span className="muted">{money(hoverPt.benchmark)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setShowTable((s) => !s)}>
        {showTable ? "Hide" : "Show"} data table
      </button>
      {showTable && (
        <div className="table-wrap" style={{ marginTop: 10, maxHeight: 260, overflowY: "auto" }}>
          <table className="tbl">
            <thead><tr><th>Date</th><th className="num">Portfolio</th><th className="num">SPY (rebased)</th></tr></thead>
            <tbody>
              {points.slice().reverse().map((p) => (
                <tr key={p.date}>
                  <td>{p.date}</td>
                  <td className="num">{money(p.value)}</td>
                  <td className="num muted">{p.benchmark != null ? money(p.benchmark) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Monthly dividend income — columns, one series, so no legend box. */
export function DividendBars({ data }: { data: { period: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(...data.map((d) => d.amount), 0.01);
  const ticks = niceTicks(0, peak, 3);
  const max = Math.max(ticks[ticks.length - 1], peak); // scale to the top tick
  const W = 720;
  const H = 170;
  const PAD = { top: 12, right: 12, bottom: 30, left: 52 };
  const AQUA = "#199e70"; // slot 3, validated
  const slot = (W - PAD.left - PAD.right) / data.length;
  const barW = Math.min(24, slot - 2); // cap thickness, 2px surface gap

  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
        role="img" aria-label="Dividend income by month" onMouseLeave={() => setHover(null)}>
        {ticks.map((t, i) => {
          const y = PAD.top + (1 - t / max) * (H - PAD.top - PAD.bottom);
          return (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize={10} fill={MUTED}>
                {axisMoney(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.amount / max) * (H - PAD.top - PAD.bottom);
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const y = H - PAD.bottom - h;
          return (
            <g key={d.period} onMouseEnter={() => setHover(i)}>
              {/* invisible full-height hit target, bigger than the mark */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={H - PAD.top - PAD.bottom} fill="transparent" />
              {d.amount > 0 && <rect x={x} y={y} width={barW} height={h} rx={4} fill={AQUA} opacity={hover === i ? 1 : 0.88} />}
            </g>
          );
        })}
        {/* label only the first and last month to avoid collisions */}
        <text x={PAD.left} y={H - 8} fontSize={10} fill={MUTED}>{data[0]?.period}</text>
        <text x={W - PAD.right} y={H - 8} fontSize={10} fill={MUTED} textAnchor="end">{data[data.length - 1]?.period}</text>
      </svg>
      {hover != null && (
        <div style={{
          position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)",
          background: "rgba(6,10,20,.94)", border: "1px solid var(--border-strong)",
          borderRadius: 10, padding: "6px 11px", fontSize: 12, pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          <span className="muted">{data[hover].period}</span>{" "}
          <strong>{money(data[hover].amount)}</strong>
        </div>
      )}
    </div>
  );
}
