"use client";
import { useState } from "react";
import { money, pct, cls } from "./format";
import TeamPanel, { Disclosures } from "./TeamPanel";
import NewsDesk from "./NewsDesk";

/**
 * Macro desk — regime, sentiment, and the allocation they imply.
 *
 * The two readings are shown side by side because they answer different
 * questions: the regime says where the market is, the Fear & Greed reading says
 * how crowded that position is. The allocation below is what the pair implies,
 * stated in percentages and dollars rather than in adjectives.
 */

const BAND_STYLE: Record<string, { color: string; bg: string }> = {
  Capitulation: { color: "var(--green)", bg: "rgba(47,214,137,.20)" },
  "Extreme Fear": { color: "var(--green)", bg: "rgba(47,214,137,.13)" },
  Fear: { color: "var(--cyan)", bg: "rgba(55,230,216,.12)" },
  Neutral: { color: "var(--muted)", bg: "rgba(120,150,220,.12)" },
  Greed: { color: "var(--amber)", bg: "rgba(245,185,59,.14)" },
  "Extreme Greed": { color: "var(--red)", bg: "rgba(255,93,108,.16)" },
};

/** A 0-100 gauge; fear on the left, greed on the right. */
function Gauge({ value, band }: { value: number; band: string }) {
  const s = BAND_STYLE[band] ?? BAND_STYLE.Neutral;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: s.color, lineHeight: 1 }}>{value}</span>
        <span style={{
          padding: "3px 11px", borderRadius: 999, fontSize: 12, fontWeight: 700,
          color: s.color, background: s.bg, boxShadow: `inset 0 0 0 1px ${s.color}44`,
        }}>{band}</span>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 999, marginTop: 10, background: "linear-gradient(90deg, #2fd689 0%, #37e6d8 25%, #93a1c0 50%, #f5b93b 75%, #ff5d6c 100%)", opacity: 0.55 }}>
        <div style={{
          position: "absolute", left: `${Math.max(0, Math.min(100, value))}%`, top: -4,
          width: 3, height: 16, background: "var(--text)", borderRadius: 2, transform: "translateX(-1.5px)",
        }} />
        {/* the fund's capitulation line */}
        <div style={{ position: "absolute", left: "15%", top: -3, width: 1, height: 14, background: "var(--text)", opacity: 0.35 }} />
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginTop: 4 }}>
        <span>0 · extreme fear</span><span>50</span><span>extreme greed · 100</span>
      </div>
    </div>
  );
}

export default function MacroDesk() {
  return (
    <div className="card ai-card" style={{ marginTop: 18 }}>
      <h3 className="sub">🌐 Macro Desk — Regime, Sentiment, News &amp; Allocation</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Three independent reads. The <strong>regime</strong> measures where the market is — trend, volatility, drawdown —
        and sets the base sleeve allocation. The <strong>Fear &amp; Greed</strong> reading measures how crowded that
        position is, and tilts it: below 15 the fund deploys into the panic, in extreme greed it takes risk off ahead of
        a rotation. The <strong>news flow</strong> measures what is being said, and matters most where it disagrees with
        the other two. The result is a target for each sleeve and each leading group, in percent and in dollars — and a
        pace for getting there.
      </p>
      <TeamPanel
        label="Read the macro desk"
        buildBody={() => ({ mode: "macro" })}
        render={(res) => {
          const p = res.plan;
          if (!p) return <p className="muted">No plan returned.</p>;
          const fg = p.fearGreed;
          const growth = p.sleeves.find((s: any) => s.sleeve === "Growth/Momentum");
          return (
            <>
              <div className="grid cols-2" style={{ marginBottom: 14, alignItems: "start" }}>
                <div className="metric">
                  <div className="label">Market regime</div>
                  <div className="value" style={{ fontSize: 20 }}>
                    {p.regime ? `${p.regime.icon} ${p.regime.regime}` : "Unknown"}
                  </div>
                  <div className="sub">
                    {p.regime ? `${p.regime.score}/100 · cash floor ${p.regime.cashMinPct}% · ${p.regime.deployRule}` : "Benchmark history unavailable"}
                  </div>
                </div>
                <div className="metric">
                  <div className="label">Fear &amp; Greed · {fg.source}</div>
                  <Gauge value={fg.value} band={fg.band} />
                </div>
              </div>

              <div style={{ padding: "13px 15px", borderRadius: 13, background: "rgba(8,14,28,.5)", border: "1px solid var(--border-strong)", marginBottom: 14 }}>
                <strong style={{ fontSize: 14 }}>{p.posture}</strong>
                <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: "6px 0 0" }} className="muted">{p.tilt.rationale}</p>
                {p.tilt.guards?.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
                    {p.tilt.guards.map((g: string, i: number) => (
                      <li key={i} style={{ fontSize: 12, lineHeight: 1.5, color: "var(--amber)" }}>{g}</li>
                    ))}
                  </ul>
                )}
              </div>

              <h3 className="sub" style={{ marginTop: 0 }}>Sleeve balance — target vs held</h3>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th>Sleeve</th><th className="num">Regime base</th><th className="num">After sentiment</th>
                    <th className="num">Held</th><th className="num">Drift</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {p.sleeves.map((s: any) => (
                      <tr key={s.sleeve}>
                        <td><strong>{s.sleeve}</strong></td>
                        <td className="num muted">{s.basePct.toFixed(1)}%</td>
                        <td className="num"><strong>{s.targetPct.toFixed(1)}%</strong></td>
                        <td className="num">{s.currentPct.toFixed(1)}%</td>
                        <td className={cls("num", Math.abs(s.driftPts) < 3 ? "muted" : s.driftPts > 0 ? "neg" : "pos")}>
                          {s.driftPts >= 0 ? "+" : ""}{s.driftPts.toFixed(1)}
                        </td>
                        <td style={{ fontSize: 12 }}>{s.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {p.groups?.length > 0 && (
                <>
                  <h3 className="sub">
                    Where the growth sleeve goes
                    {growth && <span className="muted" style={{ fontWeight: 400 }}> — splitting {growth.targetPct.toFixed(1)}% across the leading groups</span>}
                  </h3>
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead><tr>
                        <th>Group</th><th>Proxy</th><th className="num">Target</th><th className="num">Held</th>
                        <th className="num">Move</th><th className="num">3M vs SPY</th><th className="num">Leadership</th>
                      </tr></thead>
                      <tbody>
                        {p.groups.map((g: any) => (
                          <tr key={g.proxy}>
                            <td><strong>{g.label}</strong><br /><span className="muted" style={{ fontSize: 11 }}>{g.note}</span></td>
                            <td className="muted">{g.proxy}</td>
                            <td className="num"><strong>{g.targetPct.toFixed(1)}%</strong></td>
                            <td className="num">{g.currentPct.toFixed(1)}%</td>
                            {/* money() carries its own minus sign, so the value
                                is taken absolute before the sign is prepended —
                                otherwise a reduction reads "−$-1,796". */}
                            <td className={cls("num", g.deltaValue >= 0 ? "pos" : "neg")}>
                              {g.deltaValue >= 0 ? "+" : "−"}{money(Math.abs(g.deltaValue), 0)}
                            </td>
                            <td className={cls("num", (g.rs3mPct ?? 0) >= 0 ? "pos" : "neg")}>
                              {g.rs3mPct == null ? "—" : `${g.rs3mPct >= 0 ? "+" : ""}${g.rs3mPct.toFixed(1)}%`}
                            </td>
                            <td className="num">{g.leadership}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h3 className="sub">Action list</h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
                {p.actions.map((a: string, i: number) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.55 }}>{a}</li>
                ))}
              </ul>

              <SentimentDetail fg={fg} />

              {/* The third read: what the economic news flow is saying, and
                  where it disagrees with price and positioning. */}
              <NewsDesk news={res.news} outlook={res.outlook} />

              <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 5 }}>
                {p.notes.map((n: string, i: number) => (
                  <li key={i} className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{n}</li>
                ))}
              </ul>

              <Disclosures items={res.disclosures} />
            </>
          );
        }}
      />
    </div>
  );
}

function SentimentDetail({ fg }: { fg: any }) {
  const [open, setOpen] = useState(false);
  if (!fg.components?.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <button className="btn ghost sm" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} what the sentiment reading is made of
      </button>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead><tr><th>Component</th><th className="num">Score</th><th>Detail</th></tr></thead>
            <tbody>
              {fg.components.map((c: any, i: number) => (
                <tr key={i}>
                  <td>{c.label}</td>
                  <td className={cls("num", c.value == null ? "muted" : c.value >= 55 ? "neg" : c.value <= 45 ? "pos" : "")}>
                    {c.value == null ? "—" : c.value}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            {fg.coveragePct}% of the model could be evaluated. {fg.note}
          </p>
        </div>
      )}
    </div>
  );
}
