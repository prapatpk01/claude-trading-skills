"use client";
import { useState } from "react";
import { money, num, pct, cls } from "./format";

/**
 * Save a scanned name into the watchlist together with the levels the setup
 * was built on, so the app can later report whether the target was reached.
 */
function WatchButton({
  ticker, reason, target, stop, entry, source,
}: {
  ticker: string; reason: string;
  target?: number; stop?: number; entry?: number; source?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  return (
    <button
      className="btn ghost sm"
      disabled={state === "saving" || state === "saved"}
      title={state === "error" ? msg : target ? `Track ${ticker} to target ${target}` : `Add ${ticker} to the watchlist`}
      onClick={async () => {
        setState("saving");
        try {
          const res = await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticker, reason,
              target_price: target ?? null,
              stop_price: stop ?? null,
              entry_price: entry ?? null,
              source: source ?? "momentum scan",
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "could not save");
          if (json.warning) setMsg(json.warning);
          setState("saved");
        } catch (e: any) {
          setMsg(e.message);
          setState("error");
        }
      }}
    >
      {state === "saved"
        ? target ? "★ Tracking" : "★ On watchlist"
        : state === "saving" ? "…"
        : state === "error" ? "⚠ Retry"
        : target ? "☆ Track target" : "☆ Watch"}
    </button>
  );
}

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
          Powered by free Yahoo Finance data (no API key). Scans run sequentially over the universe — the default 16-name list takes a few seconds.
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

      {result?.noQualifiers && (
        <div className="card">
          <h3 className="sub" style={{ marginTop: 0 }}>🚫 No qualifying setup</h3>
          <p style={{ fontSize: 13.5, lineHeight: 1.6 }}>{result.noQualifiers}</p>
          <p className="notice" style={{ marginTop: 10 }}>
            An empty result is a result. Presenting the least-bad chart in a broad pullback is how a
            momentum model loses money, so the scanner returns nothing rather than manufacturing a trade.
            Every name it looked at is listed below with the rule that excluded it — useful as a watchlist
            for when the tape turns.
          </p>
        </div>
      )}

      {result?.rejected?.length > 0 && (
        <div className="card">
          <h3 className="sub" style={{ marginTop: 0 }}>
            ⚖️ Excluded — {result.rejected.length} name{result.rejected.length > 1 ? "s" : ""} (Sentinel v3.0)
          </h3>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
            These are the scan universe members that did <strong>not</strong> qualify. They are not
            recommendations — each row shows the specific rule that stopped it. Add any of them to your
            watchlist to track for a re-entry.
          </p>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Ticker</th><th className="num">Score</th><th>Why it was excluded</th><th></th></tr></thead>
              <tbody>
                {result.rejected.map((r: any) => (
                  <tr key={r.ticker}>
                    <td><strong>{r.ticker}</strong></td>
                    <td className="num muted">{r.score}/100</td>
                    <td className="neg" style={{ fontSize: 12 }}>
                      {r.reason}
                      {r.blocks?.length > 0 && (
                        <><br /><span className="muted" style={{ fontSize: 11 }}>{r.blocks.join(" · ")}</span></>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <WatchButton ticker={r.ticker} reason={`Scan ${new Date().toISOString().slice(0, 10)}: ${r.reason}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="notice" style={{ marginTop: 10 }}>
            Hard blocks override any score: ADX below 20 · price under the 200-SMA · distribution on rising
            price · RSI under 45 without MA confirmation · under $10M daily dollar volume. Names can also be
            excluded for scoring below {result.rejected.some((r: any) => r.reason?.includes("watch floor")) ? "42" : "the watch floor"},
            for negative SAMP pressure, or for offering less than 1:{result.minRiskReward ?? 3} reward:risk.
          </p>
        </div>
      )}

      {result?.setups?.map((s: any, i: number) => (
        <div className="card setup-card" key={s.ticker}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 className="section" style={{ margin: 0 }}>{i + 1}. {s.ticker} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>({s.name})</span></h2>
              <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className="tag">{s.setupType}</span>
                <WatchButton
                  ticker={s.ticker}
                  reason={`${s.setupType} · score ${s.momentumScore}/100 · entry ${s.entryLow}–${s.entryHigh} · target ${s.target} · stop ${s.stop} · R:R 1:${s.riskReward}`}
                  target={s.target}
                  stop={s.stop}
                  entry={s.entryHigh}
                  source={`Momentum scan ${new Date().toISOString().slice(0, 10)}`}
                />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="badge-score">{s.momentumScore}</div>
              <div className="muted" style={{ fontSize: 11 }}>Sentinel v3.0 /100</div>
              {result.sentinel?.[s.ticker] && (
                <div style={{ marginTop: 4 }}>
                  <span className={cls("pill", result.sentinel[s.ticker].signal.includes("WATCH") ? "hold" : result.sentinel[s.ticker].signal === "REJECT" ? "sell" : "buy")}>
                    {result.sentinel[s.ticker].signal}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="table-wrap"><table className="tbl" style={{ marginTop: 14 }}>
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
          </table></div>

          {result.samp?.[s.ticker] && (
            <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(79,140,255,.08)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 12, marginBottom: 6 }}>
                <strong>🧠 SAMP 3-layer</strong> <span className="muted">— Sentinel Adaptive Structure v1.6 · {result.samp[s.ticker].regime}</span>
              </div>
              <div className="grid cols-3" style={{ gap: 8 }}>
                <div className="metric" style={{ padding: "8px 10px" }}>
                  <div className="label">L1 Direction</div>
                  <div className={cls("value", result.samp[s.ticker].direction >= 0 ? "pos" : "neg")} style={{ fontSize: 16 }}>{result.samp[s.ticker].direction}</div>
                </div>
                <div className="metric" style={{ padding: "8px 10px" }}>
                  <div className="label">L2 Strength</div>
                  <div className="value" style={{ fontSize: 16 }}>{result.samp[s.ticker].strength}</div>
                </div>
                <div className="metric" style={{ padding: "8px 10px" }}>
                  <div className="label">L3 Acceleration</div>
                  <div className={cls("value", result.samp[s.ticker].acceleration >= 0 ? "pos" : "neg")} style={{ fontSize: 16 }}>{result.samp[s.ticker].acceleration}</div>
                </div>
              </div>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 7 }}>
                {result.samp[s.ticker].strongBull && "⚡ STRONG BULL pressure aligned. "}
                {result.samp[s.ticker].earlyBull && "⚡ Early bull turn. "}
                {result.samp[s.ticker].watchLong && "👁 Watch long — setup forming. "}
                {result.samp[s.ticker].lastSignal
                  ? `Last engine signal: ${result.samp[s.ticker].lastSignal.type} on ${result.samp[s.ticker].lastSignal.date} (quality ${result.samp[s.ticker].lastSignal.quality}, ${result.samp[s.ticker].lastSignal.trigger})`
                  : "No confirmed engine signal — location/chase filters are suppressing entry."}
              </div>
            </div>
          )}

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
