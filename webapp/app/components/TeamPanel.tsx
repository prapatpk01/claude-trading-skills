"use client";
import { useState } from "react";
import { cls } from "./format";

/**
 * Sentinel Global Fund committee panel.
 *
 * Runs the fund's own framework locally — momentum scoring v3.0, the hard
 * blocks, the nine pre-trade gates, Rule #3 sizing and Rule #7 drift — over
 * real market data. There is no external model call, so it needs no API key
 * and returns the same answer for the same inputs.
 */
export default function TeamPanel({
  label,
  buildBody,
  render,
}: {
  label: string;
  buildBody: () => Record<string, any>;
  render: (result: any) => React.ReactNode;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody()),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Committee run failed");
      setResult(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <button className="btn ai-btn" onClick={run} disabled={loading}>
          {loading ? <><span className="spinner" /> Committee in session…</> : <>⚖️ {label}</>}
        </button>
        <span className="ai-model">Sentinel framework · runs locally, no API key</span>
      </div>
      {error && <div className="err" style={{ marginTop: 10 }}>⚠ {error}</div>}
      {result && <div className="ai-body">{render(result)}</div>}
    </div>
  );
}

// ── Shared presentational pieces ──────────────────────────────────────

export function DeskNotes({ desks }: { desks: any[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {desks.map((d, i) => (
        <div key={i} className="desk">
          <button className="desk-head" onClick={() => setOpen(open === i ? null : i)}>
            <span>
              <strong>{d.heading}</strong>
              <br />
              <span className="muted" style={{ fontSize: 11.5 }}>{d.member} · {d.role}</span>
            </span>
            <span className="muted" style={{ fontSize: 12 }}>{open === i ? "−" : "+"}</span>
          </button>
          {open === i && (
            <div className="desk-body">
              <ul style={{ margin: "0 0 6px", paddingLeft: 18, display: "grid", gap: 4 }}>
                {d.bullets.map((b: string, j: number) => (
                  <li key={j} style={{ fontSize: 12.5, lineHeight: 1.55 }}>{b}</li>
                ))}
              </ul>
              {d.verdict && (
                <div style={{ fontSize: 12.5, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
                  <strong>Verdict:</strong> {d.verdict}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SignalBadge({ signal }: { signal: string }) {
  const tone =
    signal.includes("STRONG") ? "buy" :
    signal === "BUY" ? "buy" :
    signal.includes("WATCH") ? "hold" : "sell";
  return <span className={cls("pill", tone)}>{signal}</span>;
}

export function GateList({ gates }: { gates: any[] }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>#</th><th>Gate</th><th>Owner</th><th>Status</th></tr></thead>
        <tbody>
          {gates.map((g) => (
            <tr key={g.n}>
              <td>{g.n}</td>
              <td>{g.label}<br /><span className="muted" style={{ fontSize: 11 }}>{g.detail}</span></td>
              <td className="muted" style={{ fontSize: 11.5 }}>{g.owner}</td>
              <td className={g.pass === true ? "pos" : g.pass === false ? "neg" : "muted"}>
                {g.pass === true ? "✅ Pass" : g.pass === false ? "❌ Fail" : "⏸ Manual"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScoreBreakdown({ score }: { score: any }) {
  const phases: Record<string, string> = {
    "3A": "Momentum", "3B": "Volume & Flow", "3C": "Structure",
    "3D": "High-Beta", "3E": "Trend Maturity", "3F": "Volatility",
  };
  return (
    <>
      <div className="grid cols-3" style={{ marginBottom: 12 }}>
        {Object.entries(score.phaseTotals).map(([p, t]: [string, any]) => (
          <div className="metric" key={p}>
            <div className="label">{p} · {phases[p] ?? ""}</div>
            <div className="value" style={{ fontSize: 17 }}>{t.points}<span className="muted" style={{ fontSize: 12 }}>/{t.max}</span></div>
            <div className="bar"><span style={{ width: `${(t.points / t.max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Phase</th><th>Input</th><th className="num">Pts</th><th>Detail</th><th>Flag</th></tr></thead>
          <tbody>
            {score.lines.map((l: any, i: number) => (
              <tr key={i}>
                <td>{l.phase}</td>
                <td>{l.label}</td>
                <td className={cls("num", l.points > 0 ? "pos" : "muted")}>{l.points}/{l.max}</td>
                <td className="muted" style={{ fontSize: 12 }}>{l.detail}</td>
                <td className={l.flag === "V" ? "pos" : l.flag === "U" ? "neg" : "muted"}>[{l.flag}]</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function Disclosures({ items }: { items: string[] }) {
  return (
    <div className="notice" style={{ marginTop: 14 }}>
      {items.map((d, i) => (
        <div key={i} style={{ marginBottom: i === items.length - 1 ? 0 : 5 }}>• {d}</div>
      ))}
    </div>
  );
}
