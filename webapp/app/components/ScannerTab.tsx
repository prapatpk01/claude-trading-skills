"use client";
import { useState } from "react";
import { money, num, pct, cls } from "./format";

export default function ScannerTab() {
  const [tickers, setTickers] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const qs = tickers.trim() ? `?tickers=${encodeURIComponent(tickers.trim())}` : "";
      const res = await fetch(`/api/scan${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Scan failed");
      setResult(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const r = result?.regime;

  return (
    <div>
      <div className="card">
        <h2 className="section">📡 Momentum Swing Scanner</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Momentum-Centric Alpha Score (RS 40% · Volume 25% · Structure 20% · Catalyst 15%) → top swing setups for a 7–15 day horizon.
        </p>
        <div className="searchbar">
          <input
            placeholder="Optional: NVDA, AMD, AVGO… (blank = default high-beta universe)"
            value={tickers}
            onChange={(e) => setTickers(e.target.value)}
            style={{ flex: 1, minWidth: 260 }}
          />
          <button className="btn" onClick={scan} disabled={loading}>
            {loading ? <><span className="spinner" /> Scanning…</> : "Run scan"}
          </button>
        </div>
        <p className="notice" style={{ marginTop: 10 }}>
          Alpha Vantage free tier is rate-limited (~5 req/min). Scans run sequentially — a default 16-name universe may take a moment or hit limits; paste a shorter custom list for reliability.
        </p>
        {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
      </div>

      {r && (
        <div className="card">
          <h3 className="sub">🌐 Market Regime &amp; Swing Sentiment</h3>
          <div className="grid cols-4">
            <div className="metric"><div className="label">Market Outlook</div><div className="value">{r.score}/100</div><div className="sub">{r.stance}</div></div>
            <div className="metric"><div className="label">SPY vs 20-EMA</div><div className={cls("value", r.spyAboveEma20 ? "pos" : "neg")}>{r.spyAboveEma20 ? "Above" : "Below"}</div></div>
            <div className="metric"><div className="label">SPY 1M Return</div><div className={cls("value", (r.spyReturn1m ?? 0) >= 0 ? "pos" : "neg")}>{pct(r.spyReturn1m)}</div></div>
            <div className="metric"><div className="label">Realized Vol (VIX proxy)</div><div className="value">{num(r.realizedVol, 1)}</div></div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>{r.note}</p>
        </div>
      )}

      {result?.setups?.map((s: any, i: number) => (
        <div className="card setup-card" key={s.ticker}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 className="section" style={{ margin: 0 }}>{i + 1}. {s.ticker} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({s.name})</span></h2>
              <div style={{ marginTop: 4 }}><span className="tag">{s.setupType}</span></div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="badge-score">{s.momentumScore}</div>
              <div className="muted" style={{ fontSize: 11 }}>Momentum Score /100</div>
            </div>
          </div>

          <table className="tbl" style={{ marginTop: 14 }}>
            <thead><tr><th>Timeframe</th><th className="num">Risk:Reward</th><th className="num">Entry Range</th><th className="num">Target</th><th className="num">Stop</th><th className="num">Exp. Return</th><th className="num">Win Prob.</th></tr></thead>
            <tbody>
              <tr>
                <td>7–15 Days</td>
                <td className="num">1:{s.riskReward}</td>
                <td className="num"><strong>{money(s.entryLow)}–{money(s.entryHigh)}</strong></td>
                <td className="num pos"><strong>{money(s.target)}</strong></td>
                <td className="num neg"><strong>{money(s.stop)}</strong></td>
                <td className="num pos">+{pct(s.expectedReturnPct)}</td>
                <td className="num">{s.winProbability}%</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <div><strong>📈 Momentum &amp; RS:</strong> <span className="muted">{s.momentumNote}</span></div>
            <div><strong>📡 Volume:</strong> <span className="muted">{s.volumeNote}</span></div>
            <div><strong>⚡ Catalyst:</strong> <span className="muted">{s.catalystNote}</span></div>
            <div><strong>💡 Swing Thesis:</strong> <span className="muted">{s.thesis}</span></div>
          </div>
        </div>
      ))}

      {result && result.setups.length === 0 && (
        <div className="card"><p className="muted">No qualifying setups returned. {result.warnings?.slice(0, 3).join(" · ")}</p></div>
      )}
      {result?.warnings?.length > 0 && result.setups.length > 0 && (
        <div className="notice">Scanned {result.scanned} names. Notes: {result.warnings.slice(0, 4).join(" · ")}</div>
      )}
    </div>
  );
}
