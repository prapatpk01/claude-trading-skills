"use client";
import { useState } from "react";
import { money, num, pct, bn, cls } from "./format";
import AiPanel from "./AiPanel";

export default function AnalyzeTab() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/analyze?ticker=${encodeURIComponent(t)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analysis failed");
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const q = data?.data?.quote;
  const ov = data?.data?.overview;
  const tech = data?.technicals;
  const dcf = data?.dcf;

  return (
    <div>
      <div className="card">
        <h2 className="section">🔎 Analyze a Ticker</h2>
        <form className="searchbar" onSubmit={run}>
          <input
            className="input-ticker"
            placeholder="NVDA"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            maxLength={10}
          />
          <button className="btn" type="submit" disabled={loading}>
            {loading ? <><span className="spinner" /> Analyzing…</> : "Analyze"}
          </button>
          {data && (
            <a
              className="btn ghost"
              href={`/api/workbook?ticker=${encodeURIComponent(data.ticker)}`}
              style={{ display: "inline-flex", alignItems: "center" }}
            >
              ⬇ Download 6-sheet XLSX
            </a>
          )}
        </form>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Full institutional workbook: Executive Summary · Industry &amp; Competition · Financials &amp; Earnings ·
          Thesis/Catalysts/Risks · 3-Statement Model · DCF Valuation &amp; Scenarios (with live Excel formulas).
        </p>
        {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
      </div>

      {loading && <div className="card"><span className="spinner" /> Pulling market data, financials &amp; running the model…</div>}

      {data && (
        <>
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 className="section" style={{ marginBottom: 4 }}>{data.ticker} · {ov?.name ?? ""}</h2>
                <div className="muted" style={{ fontSize: 13 }}>{ov?.sector ?? "—"} · {ov?.industry ?? "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{money(q?.price)}</div>
                <div className={cls(q?.changePercent >= 0 ? "pos" : "neg")} style={{ fontWeight: 700 }}>
                  {q?.changePercent >= 0 ? "▲" : "▼"} {pct(Math.abs(q?.changePercent))}
                </div>
              </div>
            </div>

            <div className="grid cols-4" style={{ marginTop: 16 }}>
              <Metric label="Blended Target" value={money(data.targetPrice)} sub={`${data.upsidePct >= 0 ? "+" : ""}${pct(data.upsidePct)} expected`} accent={data.upsidePct >= 0 ? "pos" : "neg"} />
              <Metric label="Signal" value={<span className={cls("pill", data.signal.toLowerCase())}>{data.signal}</span>} sub={data.signalReasons?.[0]} />
              <Metric label="Momentum Score" value={`${data.momentum.total}/100`} sub={`RS ${data.momentum.momentumRS}/40`} />
              <Metric label="DCF Fair Value" value={money(dcf?.fairValue)} sub={dcf ? `${dcf.upsidePct >= 0 ? "+" : ""}${pct(dcf.upsidePct)}` : "n/a"} />
            </div>
          </div>

          <div className="card ai-card">
            <h3 className="sub">✨ AI Second Opinion</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
              Multi-model analysis of {data.ticker}: verdict, bull/bear points, valuation read &amp; what to watch. Auto-switches between models if one is busy.
            </p>
            <AiPanel label={`Analyze ${data.ticker} with AI`} buildBody={() => ({ mode: "research", analysis: data })} />
          </div>

          <div className="grid cols-2">
            <div className="card">
              <h3 className="sub">Key Metrics</h3>
              <KV k="Market Cap" v={bn(ov?.marketCap)} />
              <KV k="P/E (TTM)" v={num(ov?.peRatio, 1)} />
              <KV k="Forward P/E" v={num(ov?.forwardPE, 1)} />
              <KV k="EPS (TTM)" v={money(ov?.eps)} />
              <KV k="Profit Margin" v={ov?.profitMargin != null ? pct(ov.profitMargin * 100) : "—"} />
              <KV k="ROE (TTM)" v={ov?.roe != null ? pct(ov.roe * 100) : "—"} />
              <KV k="Beta" v={num(ov?.beta)} />
              <KV k="52-wk Range" v={`${money(ov?.week52Low)} – ${money(ov?.week52High)}`} />
            </div>
            <div className="card">
              <h3 className="sub">Technical Signals</h3>
              <KV k="RSI (14)" v={num(tech?.rsi14, 1)} />
              <KV k="MACD Histogram" v={num(tech?.macdHist)} />
              <KV k="RS vs SPY (21d)" v={num(tech?.rs30, 3)} />
              <KV k="Vol 5d / 20d" v={tech?.volRatio ? `${num(tech.volRatio)}x` : "—"} />
              <KV k="Up/Down Vol" v={num(tech?.upDownVolRatio)} />
              <KV k="Price vs 20-EMA" v={tech?.aboveEma20 ? "Above ✓" : "Below"} />
              <KV k="MAs Fanning Up" v={tech?.maFanning ? "Yes ✓" : "No"} />
              <KV k="1M / 3M Return" v={`${pct(tech?.return1m)} / ${pct(tech?.return3m)}`} />
            </div>
          </div>

          <div className="card">
            <h3 className="sub">Scenario Thesis (probability-weighted)</h3>
            <div className="table-wrap"><table className="tbl">
              <thead><tr><th>Scenario</th><th className="num">Prob.</th><th className="num">Target</th><th>Narrative</th></tr></thead>
              <tbody>
                {data.thesis.map((s: any) => (
                  <tr key={s.label}>
                    <td><strong className={s.label === "Bull" ? "pos" : s.label === "Bear" ? "neg" : ""}>{s.label}</strong></td>
                    <td className="num">{s.probability}%</td>
                    <td className="num">{money(s.targetPrice)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{s.narrative}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          {data.swing && (
            <div className="card setup-card">
              <h3 className="sub">7–15 Day Swing Setup</h3>
              <div className="grid cols-4">
                <Metric label="Setup" value={data.swing.setupType} />
                <Metric label="Entry" value={`${money(data.swing.entryLow)}–${money(data.swing.entryHigh)}`} />
                <Metric label="Target" value={money(data.swing.target)} sub={`+${pct(data.swing.expectedReturnPct)}`} accent="pos" />
                <Metric label="Stop / R:R" value={`${money(data.swing.stop)} · 1:${data.swing.riskReward}`} />
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>{data.swing.thesis}</p>
            </div>
          )}

          {data.data.warnings?.length > 0 && (
            <div className="notice" style={{ marginTop: 16 }}>
              <strong>Data notes:</strong> {data.data.warnings.slice(0, 4).join(" · ")}
            </div>
          )}
          <div className="notice" style={{ marginTop: 12 }}>
            Sources: {data.data.sources.join("; ") || "n/a"}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={cls("value", accent)}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="kv"><span className="k">{k}</span><span>{v}</span></div>;
}
