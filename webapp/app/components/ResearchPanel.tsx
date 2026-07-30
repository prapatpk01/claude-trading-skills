"use client";
import { useState } from "react";
import { money, num, pct, cls } from "./format";

/**
 * The research pack, on screen rather than only in the spreadsheet.
 *
 * These four blocks are the ones a reader checks before the target price: who
 * the company is measured against, whether it earns more than its capital
 * costs, whether the advantage is evidenced or asserted, and what is scheduled
 * to move it. Each rating carries the measurement behind it, so a wrong read is
 * visible rather than buried.
 */

const MOAT_COLOR: Record<string, string> = {
  Wide: "var(--green)",
  Narrow: "var(--amber)",
  None: "var(--red)",
  Unrated: "var(--muted)",
};

const KIND_COLOR: Record<string, string> = {
  Earnings: "var(--red)",
  Macro: "var(--cyan)",
  Distribution: "var(--green)",
  Structural: "var(--muted)",
};

const B = 1e9;
const bn = (v: number | null | undefined) =>
  v == null ? "—" : `$${(v / B).toLocaleString(undefined, { maximumFractionDigits: 1 })}B`;
const pctOr = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "" : ""}${v.toFixed(1)}%`);

export default function ResearchPanel({ research }: { research: any }) {
  const [showGaps, setShowGaps] = useState(false);
  if (!research) {
    return (
      <div className="notice" style={{ marginTop: 14 }}>
        The peer set, returns-on-capital and moat assessment could not be built this run — the SEC filings behind them
        were unreachable. The valuation and momentum work above is unaffected.
      </div>
    );
  }
  const { peerSet, peers, sizing, returns, moat, timeline } = research;
  const gapped = (peers ?? []).filter((p: any) => p.gaps?.length);

  return (
    <div className="card">
      <h2 className="section">🔬 Research — peers, returns, moat &amp; calendar</h2>

      {/* ── Returns on capital ── */}
      <h3 className="sub" style={{ marginTop: 4 }}>Does growth create value?</h3>
      <div className="grid cols-4">
        <div className="metric">
          <div className="label">ROIC</div>
          <div className="value">{pctOr(returns.roicPct)}</div>
          <div className="sub">NOPAT ÷ (debt + equity − cash)</div>
        </div>
        <div className="metric">
          <div className="label">ROIC − WACC</div>
          <div className={cls("value", (returns.spreadPct ?? 0) > 0 ? "pos" : "neg")}>
            {returns.spreadPct == null ? "—" : `${returns.spreadPct >= 0 ? "+" : ""}${returns.spreadPct.toFixed(1)} pts`}
          </div>
          <div className="sub">{(returns.spreadPct ?? 0) > 0 ? "Reinvestment compounds" : "Reinvestment dilutes"}</div>
        </div>
        <div className="metric">
          <div className="label">Effective tax rate</div>
          <div className="value">{pctOr(returns.effectiveTaxRatePct)}</div>
          <div className="sub">{returns.taxRateSource === "filed" ? "As filed" : "21% statutory assumed"}</div>
        </div>
        <div className="metric">
          <div className="label">Moat</div>
          <div className="value" style={{ color: MOAT_COLOR[moat.overall] }}>{moat.overall}</div>
          <div className="sub">{moat.ratedCount} of 5 tests rated</div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 10 }}>{returns.verdict}</p>
      {returns.roicHistory?.length >= 2 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
          {returns.roicHistory.map((h: any) => (
            <span key={h.year} className="tag">{h.year}: {h.roicPct.toFixed(1)}%</span>
          ))}
        </div>
      )}

      {/* ── Peers ── */}
      <h3 className="sub">Peer set — {peerSet.group}</h3>
      <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 8 }}>{peerSet.basis}</p>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Company</th><th className="num">Price</th><th className="num">Revenue TTM</th>
            <th className="num">Mkt cap</th><th className="num">P/E</th>
            <th className="num">Gross margin</th><th className="num">Net margin</th><th className="num">Rev CAGR</th>
          </tr></thead>
          <tbody>
            {peers.map((p: any) => (
              <tr key={p.ticker} style={p.isSubject ? { background: "rgba(120,150,220,.08)" } : undefined}>
                <td><strong style={p.isSubject ? { color: "var(--cyan)" } : undefined}>{p.ticker}</strong>{p.isSubject && <span className="muted" style={{ fontSize: 10 }}> subject</span>}</td>
                <td className="num">{p.price != null ? money(p.price) : <span className="muted">—</span>}</td>
                <td className="num">{p.revenueTTM != null ? bn(p.revenueTTM) : <span className="muted">—</span>}</td>
                <td className="num">{p.marketCap != null ? bn(p.marketCap) : <span className="muted">—</span>}</td>
                <td className="num">{p.peTTM != null ? p.peTTM.toFixed(1) : <span className="muted">—</span>}</td>
                <td className="num">{p.grossMargin != null ? pctOr(p.grossMargin) : <span className="muted">—</span>}</td>
                <td className="num">{p.netMargin != null ? pctOr(p.netMargin) : <span className="muted">—</span>}</td>
                <td className={cls("num", (p.revenueCagrPct ?? 0) >= 0 ? "pos" : "neg")}>
                  {p.revenueCagrPct != null ? pctOr(p.revenueCagrPct) : <span className="muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <span className="tag">Peer-set revenue pool {bn(sizing.peerPoolRevenue)}</span>
        <span className="tag">Subject share {sizing.subjectSharePct != null ? `${sizing.subjectSharePct.toFixed(1)}%` : "—"}</span>
        <span className="tag">Pool CAGR {sizing.poolCagrPct != null ? `${sizing.poolCagrPct.toFixed(1)}%` : "—"}</span>
        <span className="tag">{sizing.contributors} readable{sizing.unreadable > 0 ? ` · ${sizing.unreadable} unreadable` : ""}</span>
      </div>
      {gapped.length > 0 && (
        <>
          <button className="btn ghost sm" style={{ marginTop: 10 }} onClick={() => setShowGaps((o) => !o)}>
            {showGaps ? "Hide" : "Show"} why {gapped.length} name{gapped.length === 1 ? "" : "s"} could not be read fully
          </button>
          {showGaps && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
              {gapped.map((p: any) => (
                <li key={p.ticker} className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
                  <strong>{p.ticker}</strong> — {p.gaps.join(" ")}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <ul style={{ margin: "10px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
        {sizing.limits.map((l: string, i: number) => (
          <li key={i} className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>{l}</li>
        ))}
      </ul>

      {/* ── Moat, with the evidence ── */}
      <h3 className="sub">Moat — each rating with the measurement behind it</h3>
      <div className="table-wrap">
        <table className="tbl">
          <thead><tr><th>Source</th><th>Rating</th><th>Evidence</th></tr></thead>
          <tbody>
            {moat.sources.map((s: any) => (
              <tr key={s.source}>
                <td><strong>{s.source}</strong></td>
                <td style={{ color: MOAT_COLOR[s.strength], fontWeight: 700, whiteSpace: "nowrap" }}>{s.strength}</td>
                <td style={{ fontSize: 12, lineHeight: 1.5 }}>{s.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.5 }}>{moat.note}</p>

      {/* ── Timeline ── */}
      <h3 className="sub">Next 12 months — what is scheduled</h3>
      <div style={{ display: "grid", gap: 8 }}>
        {timeline.map((c: any, i: number) => (
          <div key={i} style={{
            padding: "9px 12px", borderRadius: 11,
            background: "rgba(8,14,28,.42)", border: "1px solid var(--border)",
          }}>
            <div style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{
                fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, padding: "1px 5px", borderRadius: 4,
                color: KIND_COLOR[c.kind], background: "rgba(120,150,220,.10)",
              }}>{c.kind.toUpperCase()}</span>
              <strong style={{ fontSize: 12.5 }}>{c.window}</strong>
              <span style={{ fontSize: 12.5 }}>{c.event}</span>
            </div>
            <p style={{ fontSize: 12, lineHeight: 1.5, margin: "5px 0 0" }}>{c.impact}</p>
            <p className="muted" style={{ fontSize: 10.5, lineHeight: 1.45, margin: "3px 0 0" }}>{c.basis}</p>
          </div>
        ))}
      </div>

      <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
        {research.sources.map((s: string, i: number) => (
          <li key={i} className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>{s}</li>
        ))}
      </ul>
    </div>
  );
}
