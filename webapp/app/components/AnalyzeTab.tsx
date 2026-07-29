"use client";
import { useState } from "react";
import { money, num, pct, bn, cls } from "./format";
import TeamPanel, { DeskNotes, SignalBadge, GateList, ScoreBreakdown, Disclosures } from "./TeamPanel";

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
            <h3 className="sub">⚖️ Sentinel Investment Committee</h3>
            <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
              Runs the fund&apos;s own framework on {data.ticker}: Momentum Scoring v3.0, hard blocks, the nine
              pre-trade gates, Rule&nbsp;#3 sizing and the Rule&nbsp;#4 ATR stop — each section attributed to the desk that owns it.
            </p>
            <TeamPanel
              label={`Convene committee on ${data.ticker}`}
              buildBody={() => ({ mode: "ticker", ticker: data.ticker, analysis: data })}
              render={(res) => {
                const m = res.memo;
                return (
                  <>
                    <div className="grid cols-4" style={{ marginBottom: 14 }}>
                      <div className="metric">
                        <div className="label">Momentum v3.0</div>
                        <div className="value">{m.score.total}<span className="muted" style={{ fontSize: 13 }}>/100</span></div>
                        <div className="sub"><SignalBadge signal={m.score.signal} /></div>
                      </div>
                      <div className="metric">
                        <div className="label">Macro regime</div>
                        <div className="value" style={{ fontSize: 18 }}>{m.regime.icon} {m.regime.score}</div>
                        <div className="sub">{m.regime.regime} · cash ≥ {m.regime.cashMinPct}%</div>
                      </div>
                      <div className="metric">
                        <div className="label">Pre-trade gates</div>
                        <div className={cls("value", m.gates.cleared ? "pos" : "neg")} style={{ fontSize: 18 }}>
                          {m.gates.passed}/{m.gates.evaluated}
                        </div>
                        <div className="sub">{m.gates.cleared ? "clear" : "hold"}</div>
                      </div>
                      <div className="metric">
                        <div className="label">Rule #4 stop</div>
                        <div className="value" style={{ fontSize: 18 }}>{m.stop ? money(m.stop.stop) : "—"}</div>
                        <div className="sub">{m.stop ? `2 × ATR ${m.stop.atr}` : "ATR unavailable"}</div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(79,140,255,.09)", border: "1px solid var(--border-strong)" }}>
                      <strong>{m.desks[m.desks.length - 1].heading}</strong>
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{m.verdict.detail}</div>
                    </div>

                    {m.samp && (
                      <>
                        <h3 className="sub" style={{ marginTop: 0 }}>
                          🧠 SAMP 3-layer engine — Sentinel Adaptive Structure v1.6 ({m.samp.regime})
                        </h3>
                        <div className="grid cols-4" style={{ marginBottom: 10 }}>
                          <div className="metric">
                            <div className="label">L1 Direction</div>
                            <div className={cls("value", m.samp.direction >= 0 ? "pos" : "neg")} style={{ fontSize: 18 }}>{m.samp.direction}</div>
                          </div>
                          <div className="metric">
                            <div className="label">L2 Strength</div>
                            <div className="value" style={{ fontSize: 18 }}>{m.samp.strength}</div>
                          </div>
                          <div className="metric">
                            <div className="label">L3 Acceleration</div>
                            <div className={cls("value", m.samp.acceleration >= 0 ? "pos" : "neg")} style={{ fontSize: 18 }}>{m.samp.acceleration}</div>
                          </div>
                          <div className="metric">
                            <div className="label">Setup quality</div>
                            <div className="value" style={{ fontSize: 18 }}>{m.samp.longQuality}<span className="muted" style={{ fontSize: 12 }}>/{m.samp.thresholds.quality}</span></div>
                            <div className="sub">long side</div>
                          </div>
                        </div>
                        <p className="notice" style={{ marginBottom: 14 }}>
                          {m.samp.lastSignal
                            ? <>Last engine signal: <strong>{m.samp.lastSignal.type}</strong> on {m.samp.lastSignal.date} at {money(m.samp.lastSignal.price)} — quality {m.samp.lastSignal.quality}, via {m.samp.lastSignal.trigger}
                                {m.samp.barsSinceLastSignal != null && ` (${m.samp.barsSinceLastSignal} bars ago)`}.</>
                            : <>No confirmed signal across {m.samp.bars} bars — a signal needs context, location, trigger <em>and</em> pressure together, so extended moves are deliberately not chased.</>}
                        </p>
                      </>
                    )}

                    <h3 className="sub" style={{ marginTop: 0 }}>Desk notes</h3>
                    <DeskNotes desks={m.desks} />

                    <h3 className="sub">Score breakdown — {res.fund.scoringVersion}</h3>
                    <ScoreBreakdown score={m.score} />

                    <h3 className="sub">Pre-trade checklist</h3>
                    <GateList gates={m.gates.gates} />

                    <Disclosures items={m.disclosures} />
                  </>
                );
              }}
            />
          </div>

          <div className="grid cols-2">
            <div className="card">
              <h3 className="sub">Key Metrics</h3>
              <KV k="Market Cap" v={bn(ov?.marketCap)} />
              <KV k="P/E (TTM)" v={num(ov?.peRatio, 1)} />
              <KV k="Forward P/E (est.)" v={num(ov?.forwardPE, 1)} />
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

          {data.data.quarters?.length > 0 && (
            <div className="card">
              <h3 className="sub">Quarterly Results (last 8 reported)</h3>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th>Quarter</th><th className="num">Revenue</th><th className="num">Net Income</th>
                    <th className="num">Net Margin</th><th className="num">EPS</th><th className="num">Rev YoY</th>
                  </tr></thead>
                  <tbody>
                    {data.data.quarters.map((q: any) => (
                      <tr key={q.end}>
                        <td>{q.end}</td>
                        <td className="num">{bn(q.revenue)}</td>
                        <td className="num">{bn(q.netIncome)}</td>
                        <td className="num">{q.netMargin != null ? pct(q.netMargin * 100) : "—"}</td>
                        <td className="num">{q.eps != null ? money(q.eps) : "—"}</td>
                        <td className={cls("num", (q.revenueYoY ?? 0) >= 0 ? "pos" : "neg")}>
                          {q.revenueYoY != null ? `${q.revenueYoY >= 0 ? "+" : ""}${pct(q.revenueYoY * 100)}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>Source: SEC EDGAR XBRL (10-Q / 10-K filings).</p>
            </div>
          )}

          <div className="card">
            <h3 className="sub">Scenario Thesis (probability-weighted)</h3>
            {data.valuationNote && (
              <p className="notice" style={{ marginBottom: 12 }}>
                <strong>Method:</strong> {data.valuationNote}
              </p>
            )}
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
