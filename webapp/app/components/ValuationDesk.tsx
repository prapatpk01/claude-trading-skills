"use client";
import { useState } from "react";
import { money, pct, cls } from "./format";
import TeamPanel, { Disclosures } from "./TeamPanel";

/**
 * Valuation desk — fair value per holding and the size change it implies.
 *
 * Every row answers the two questions directly: is the price cheap, fair or
 * rich, and how many shares to add, trim or sell. The reasoning behind each
 * call expands in place so a recommendation is never a bare verdict.
 */

const VERDICT_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  "DEEP VALUE": { color: "var(--green)", bg: "rgba(47,214,137,.18)", label: "Deep value" },
  UNDERVALUED: { color: "var(--green)", bg: "rgba(47,214,137,.12)", label: "Undervalued" },
  FAIR: { color: "var(--muted)", bg: "rgba(120,150,220,.12)", label: "Fair value" },
  OVERVALUED: { color: "var(--amber)", bg: "rgba(245,185,59,.14)", label: "Overvalued" },
  STRETCHED: { color: "var(--red)", bg: "rgba(255,93,108,.16)", label: "Stretched" },
  "CASH EQUIVALENT": { color: "var(--cyan)", bg: "rgba(55,230,216,.12)", label: "Cash equivalent" },
};

const ACTION_CLASS: Record<string, string> = {
  ADD: "pill buy",
  HOLD: "pill hold",
  WATCH: "pill hold",
  TRIM: "pill sell",
  EXIT: "pill sell",
  "EXIT REVIEW": "pill sell",
};

function VerdictBadge({ verdict }: { verdict: string | null }) {
  if (!verdict) return <span className="muted" style={{ fontSize: 12 }}>no anchor</span>;
  const s = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.FAIR;
  return (
    <span
      style={{
        display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5,
        fontWeight: 700, whiteSpace: "nowrap", color: s.color, background: s.bg,
        boxShadow: `inset 0 0 0 1px ${s.color}44`,
      }}
    >
      {s.label}
    </span>
  );
}

function PlanRow({ p }: { p: any }) {
  const [open, setOpen] = useState(false);
  const dev = p.deviationPct;
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <td>
          <strong>{p.ticker}</strong>
          {p.isHybrid && <span className="tag" style={{ marginLeft: 6, fontSize: 9.5 }}>HYBRID</span>}
          <br />
          <span className="muted" style={{ fontSize: 10.5 }}>{p.engine ?? p.sleeve}</span>
        </td>
        <td className="num">{p.price != null ? money(p.price) : "—"}</td>
        <td className="num">{p.fairValue != null ? money(p.fairValue) : "—"}</td>
        <td className={cls("num", dev == null ? "muted" : dev <= 0 ? "pos" : "neg")}>
          {dev == null ? "—" : `${dev >= 0 ? "+" : ""}${dev.toFixed(1)}%`}
        </td>
        <td><VerdictBadge verdict={p.verdict} /></td>
        <td className="num" style={{ whiteSpace: "nowrap" }}>
          {p.score != null ? <><strong>{p.score}</strong><br /><span className="muted" style={{ fontSize: 10.5 }}>{p.signal}</span></> : "—"}
        </td>
        <td className="num" style={{ whiteSpace: "nowrap" }}>
          {pct(p.weightPct)}
          <span className="muted"> → {pct(p.targetWeightPct)}</span>
        </td>
        <td><span className={ACTION_CLASS[p.action] ?? "pill hold"}>{p.action}</span></td>
        <td style={{ fontSize: 12, minWidth: 150 }}>
          {p.headline}
          <span style={{ color: "var(--accent-2)", marginLeft: 6, fontSize: 11 }}>{open ? "less" : "why"}</span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: "rgba(8,14,28,.45)" }}>
            <div style={{ display: "grid", gap: 10, padding: "4px 2px 8px" }}>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
                {(p.reasons ?? []).map((r: string, i: number) => (
                  <li key={i} style={{ fontSize: 12.5, lineHeight: 1.55 }}>{r}</li>
                ))}
              </ul>

              {p.decidedBy && (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  Decided at precedence level <strong>{p.decidedBy}</strong>
                  {p.coveragePct != null && ` · ${p.coveragePct}% of the engine's inputs were available`}
                  {p.blocks?.length > 0 && ` · blocks: ${p.blocks.join(", ")}`}
                </div>
              )}

              {p.guard && (
                <div className="notice">
                  <strong>Before acting:</strong> {p.guard}
                </div>
              )}

              {(p.entryConfirmations?.length > 0 || p.entryWarnings?.length > 0) && (
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".4px", marginBottom: 5 }}>
                    ENTRY LAYER
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                    {(p.entryConfirmations ?? []).map((c: string, i: number) => (
                      <li key={`c${i}`} className="pos" style={{ fontSize: 12, lineHeight: 1.5 }}>{c}</li>
                    ))}
                    {(p.entryWarnings ?? []).map((w: string, i: number) => (
                      <li key={`w${i}`} style={{ fontSize: 12, lineHeight: 1.5, color: "var(--amber)" }}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {p.anchors?.length > 0 && (
                <div>
                  <div className="muted" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".4px", marginBottom: 5 }}>
                    FAIR VALUE ANCHORS · {p.confidence} confidence
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
                    {(p.anchors ?? []).map((a: any, i: number) => (
                      <li key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                        <strong>{a.method} {money(a.fairValue)}</strong>
                        <span className="muted"> (weight {a.weight}) — {a.detail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 5 }}>{p.valuationNote}</div>
                </div>
              )}

              <div className="muted" style={{ fontSize: 11.5 }}>
                Position {money(p.marketValue)} · {pct(p.weightPct)} of NAV · {p.engine}
                {p.isHybrid && " · Hybrid Compounder"}
                {p.buyBelow != null && ` · add zone below ${money(p.buyBelow)}`}
                {p.theme && ` · ${p.theme.label} leading`}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ValuationDesk() {
  return (
    <div className="card ai-card" style={{ marginTop: 18 }}>
      <h3 className="sub">💰 Valuation Desk — Fair Value &amp; Position Sizing</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
        Prices every holding against its own history — the multiple the market has paid for its earnings, the yield
        it has paid on its distributions, and its long-run price trend — then sizes it against the 20% single-name
        cap, then routes it through the two v4 engines — Momentum Growth (growth above 12% with price confirmation)
        and High Dividend Growth (yield 5%+ with a durable, growing distribution). Valuation sizes an add; it does
        not sell a winner.
      </p>
      <TeamPanel
        label="Run valuation review"
        buildBody={() => ({ mode: "valuation" })}
        render={(res) => {
          const plans: any[] = res.plans ?? [];
          const count = (a: string) => plans.filter((p) => p.action === a).length;
          const addCash = plans.filter((p) => p.action === "ADD").reduce((s, p) => s + p.deltaValue, 0);
          const raiseCash = plans
            .filter((p) => p.action === "TRIM")
            .reduce((s, p) => s + Math.abs(p.deltaValue), 0);

          return (
            <>
              <div className="grid cols-4" style={{ marginBottom: 14 }}>
                <div className="metric">
                  <div className="label">Add</div>
                  <div className="value pos" style={{ fontSize: 18 }}>{count("ADD")}</div>
                  <div className="sub">{addCash > 0 ? `${money(addCash)} to deploy` : "no adds cleared"}</div>
                </div>
                <div className="metric">
                  <div className="label">Trim</div>
                  <div className="value" style={{ fontSize: 18, color: "var(--amber)" }}>{count("TRIM")}</div>
                  <div className="sub">rich, or over the cap</div>
                </div>
                <div className="metric">
                  <div className="label">Watch</div>
                  <div className="value" style={{ fontSize: 18, color: "var(--accent-2)" }}>{count("WATCH")}</div>
                  <div className="sub">overweight, let it run</div>
                </div>
                <div className="metric">
                  <div className="label">Exit review</div>
                  <div className={cls("value", count("EXIT REVIEW") ? "neg" : "pos")} style={{ fontSize: 18 }}>{count("EXIT REVIEW")}</div>
                  <div className="sub">{count("EXIT REVIEW") ? "thesis under review" : "none flagged"}</div>
                </div>
                <div className="metric">
                  <div className="label">Cash raised</div>
                  <div className="value" style={{ fontSize: 18 }}>{money(raiseCash)}</div>
                  <div className="sub">from trims and exits</div>
                </div>
              </div>

              {res.mix?.length > 0 && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
                  {res.mix.map((m: any) => (
                    <span key={m.engine} className="tag">{m.engine} {m.valuePct}%</span>
                  ))}
                  {res.rulesVersion && <span className="tag">Rules {res.rulesVersion}</span>}
                </div>
              )}

              {res.tilt && <ThematicTilt tilt={res.tilt} />}

              <div className="table-wrap">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Ticker</th>
                      <th className="num">Price</th>
                      <th className="num">Fair value</th>
                      <th className="num">vs fair</th>
                      <th>Valuation</th>
                      <th className="num">Score</th>
                      <th className="num">Weight → target</th>
                      <th>Action</th>
                      <th>Recommendation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plans.map((p) => <PlanRow key={p.ticker} p={p} />)}
                    {plans.length === 0 && (
                      <tr><td colSpan={9} className="muted">Nothing could be valued.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                Tap any row for the fair-value anchors and the reasoning behind its call.
              </p>

              {res.failures?.length > 0 && (
                <div className="notice" style={{ marginTop: 12 }}>
                  Could not value: {res.failures.map((f: any) => `${f.ticker} (${f.error})`).join(", ")}.
                </div>
              )}

              {res.notes?.length > 0 && (
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 5 }}>
                  {res.notes.map((n: string, i: number) => (
                    <li key={i} className="muted" style={{ fontSize: 12, lineHeight: 1.5 }}>{n}</li>
                  ))}
                </ul>
              )}

              <Disclosures items={res.disclosures} />
            </>
          );
        }}
      />
    </div>
  );
}

/**
 * Market posture and where leadership actually is. The regime decides which
 * risk profiles new capital may go into; relative strength decides which groups
 * within that permission are worth it.
 */
function ThematicTilt({ tilt }: { tilt: any }) {
  const [open, setOpen] = useState(false);
  const pb = tilt.playbook;
  return (
    <div style={{ margin: "0 0 16px", padding: "13px 15px", borderRadius: 13, background: "rgba(8,14,28,.5)", border: "1px solid var(--border-strong)" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>{pb.regime} — {pb.posture}</strong>
        <span className="muted" style={{ fontSize: 11.5 }}>cash floor {pb.cashMinPct}%</span>
      </div>
      <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "6px 0 10px" }}>{pb.guidance}</p>

      {tilt.favoured.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 10 }}>
          {tilt.favoured.slice(0, 6).map((g: any) => (
            <span key={g.proxy} className="tag" title={g.note}>
              {g.label} · {g.proxy} {g.rs3m >= 0 ? "+" : ""}{g.rs3m?.toFixed(1)}%
            </span>
          ))}
        </div>
      )}

      {tilt.recommendations.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
          {tilt.recommendations.map((r: string, i: number) => (
            <li key={i} style={{ fontSize: 12.5, lineHeight: 1.55 }}>{r}</li>
          ))}
        </ul>
      )}

      <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} the full leadership table
      </button>
      {open && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Group</th><th>Proxy</th>
                <th className="num">1M vs SPY</th><th className="num">3M</th><th className="num">6M</th>
                <th className="num">Leadership</th><th>Trend</th><th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {tilt.ranked.map((g: any) => (
                <tr key={g.proxy}>
                  <td><strong>{g.label}</strong><br /><span className="muted" style={{ fontSize: 11 }}>{g.note}</span></td>
                  <td className="muted">{g.proxy}</td>
                  {(["rs1m", "rs3m", "rs6m"] as const).map((k) => (
                    <td key={k} className={cls("num", (g[k] ?? 0) >= 0 ? "pos" : "neg")}>
                      {g[k] == null ? "—" : `${g[k] >= 0 ? "+" : ""}${g[k].toFixed(1)}%`}
                    </td>
                  ))}
                  <td className="num"><strong>{g.leadership}</strong></td>
                  <td className={g.trending ? "pos" : "neg"} style={{ fontSize: 12 }}>
                    {g.trending ? "intact" : g.aboveSma200 === false ? "below 200d" : "weak"}
                  </td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{g.risk}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
