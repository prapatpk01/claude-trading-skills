"use client";
import { useEffect, useState, useCallback } from "react";
import PerformanceChart, { DividendBars } from "./PerformanceChart";
import { money, num, pct, cls } from "./format";

const RANGES = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
];

export default function PortfolioAnalytics({ refreshKey }: { refreshKey: string }) {
  const [days, setDays] = useState(365);
  // Income is shown after withholding by default — that is what actually lands.
  const [net, setNet] = useState(true);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/analytics?days=${days}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load analytics");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { if (refreshKey) load(); }, [load, refreshKey]);

  if (!refreshKey) return null;

  const perf = data?.performance;
  const div = data?.dividends;

  return (
    <>
      {/* ── Performance ─────────────────────────────── */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section" style={{ margin: 0 }}>📈 Performance</h2>
          <div className="tabs" style={{ padding: 4 }}>
            {RANGES.map((r) => (
              <button key={r.days} className={`tab ${days === r.days ? "active" : ""}`} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="muted" style={{ marginTop: 12 }}><span className="spinner" /> Loading price history…</p>}
        {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

        {!loading && perf && (
          <>
            <div className="grid cols-4" style={{ marginTop: 14 }}>
              <Metric label="Value now" value={money(perf.endValue)} />
              <Metric label={`Change (${RANGES.find((r) => r.days === days)?.label})`}
                value={`${perf.changePct >= 0 ? "+" : ""}${pct(perf.changePct)}`}
                accent={perf.changePct >= 0 ? "pos" : "neg"}
                sub={perf.benchmarkChangePct != null ? `SPY ${perf.benchmarkChangePct >= 0 ? "+" : ""}${pct(perf.benchmarkChangePct)}` : undefined} />
              <Metric label="Max drawdown" value={pct(perf.maxDrawdownPct)} accent="neg" />
              <Metric label="Best / worst day"
                value={`${perf.bestDay ? "+" + pct(perf.bestDay.pct) : "—"} / ${perf.worstDay ? pct(perf.worstDay.pct) : "—"}`} />
            </div>

            <div style={{ marginTop: 16 }}>
              <PerformanceChart points={perf.points} />
            </div>

            <p className="notice" style={{ marginTop: 12 }}>{perf.note}</p>
            {perf.missing?.length > 0 && (
              <p className="notice" style={{ marginTop: 8 }}>No price history for: <strong>{perf.missing.join(", ")}</strong> — excluded from the chart.</p>
            )}
          </>
        )}
        {!loading && !perf && !error && <p className="muted" style={{ marginTop: 12 }}>Add a holding to see performance.</p>}
      </div>

      {/* ── Dividends ───────────────────────────────── */}
      {div && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section" style={{ margin: 0 }}>💰 Dividend Income</h2>
            <div className="tabs" style={{ padding: 4 }}>
              <button className={`tab ${net ? "active" : ""}`} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setNet(true)}>
                Net of {div.withholdingPct}% tax
              </button>
              <button className={`tab ${!net ? "active" : ""}`} style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setNet(false)}>
                Gross
              </button>
            </div>
          </div>

          <div className="grid cols-4">
            <Metric label="Est. forward / yr" value={money(net ? div.estAnnualIncomeNet : div.estAnnualIncome)} accent="pos"
              sub={net ? `after ${div.withholdingPct}% tax · gross ${money(div.estAnnualIncome)}` : "gross, next 12 months"} />
            <Metric label="Est. per month" value={money(net ? div.estMonthlyAverageNet : div.estMonthlyAverage)} sub="average" />
            <Metric label="Received (12M)" value={money(net ? div.trailingIncome12mNet : div.trailingIncome12m)} sub="trailing actual" />
            <Metric label="Yield / on cost"
              value={`${(net ? div.portfolioYieldNet : div.portfolioYield) != null ? pct(net ? div.portfolioYieldNet : div.portfolioYield) : "—"} / ${(net ? div.yieldOnCostNet : div.yieldOnCost) != null ? pct(net ? div.yieldOnCostNet : div.yieldOnCost) : "—"}`} />
          </div>

          <h3 className="sub">Monthly income — last 24 months {net && <span className="muted" style={{ fontWeight: 400 }}>(net of tax)</span>}</h3>
          <DividendBars data={net ? div.byMonthNet : div.byMonth} />

          <div className="grid cols-2" style={{ marginTop: 18 }}>
            <div>
              <h3 className="sub" style={{ marginTop: 0 }}>By year</h3>
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr><th>Year</th><th className="num">Income</th><th className="num">vs prior</th></tr></thead>
                  <tbody>
                    {div.byYear.length === 0 && <tr><td colSpan={3} className="muted">No dividend history.</td></tr>}
                    {(net ? div.byYearNet : div.byYear).map((y: any, i: number) => {
                      const prior = (net ? div.byYearNet : div.byYear)[i + 1];
                      const chg = prior && prior.amount > 0 ? ((y.amount - prior.amount) / prior.amount) * 100 : null;
                      return (
                        <tr key={y.period}>
                          <td><strong>{y.period}</strong></td>
                          <td className="num">{money(y.amount)}</td>
                          <td className={cls("num", (chg ?? 0) >= 0 ? "pos" : "neg")}>{chg != null ? `${chg >= 0 ? "+" : ""}${pct(chg)}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 className="sub" style={{ marginTop: 0 }}>By month — last 12</h3>
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
                <table className="tbl">
                  <thead><tr><th>Month</th><th className="num">Income</th></tr></thead>
                  <tbody>
                    {(net ? div.byMonthNet : div.byMonth).slice(-12).reverse().map((m: any) => (
                      <tr key={m.period}>
                        <td>{m.period}</td>
                        <td className={cls("num", m.amount > 0 ? "pos" : "muted")}>{m.amount > 0 ? money(m.amount) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <h3 className="sub">Per holding</h3>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                <th>Ticker</th><th>Frequency</th><th className="num">Last paid</th><th className="num">TTM / share</th>
                <th className="num">Est. income / yr</th><th className="num">Net after tax</th><th className="num">Yield</th><th className="num">On cost</th>
              </tr></thead>
              <tbody>
                {div.holdings.map((h: any) => (
                  <tr key={h.ticker}>
                    <td><strong>{h.ticker}</strong></td>
                    <td className={h.frequencyLabel === "No dividend" ? "muted" : ""}>{h.frequencyLabel}</td>
                    <td className="num">{h.lastAmount != null ? `${money(h.lastAmount)}` : "—"}<br />
                      <span className="muted" style={{ fontSize: 11 }}>{h.lastExDate ?? ""}</span></td>
                    <td className="num">{h.ttmPerShare > 0 ? money(h.ttmPerShare) : "—"}</td>
                    <td className="num">{h.estAnnualIncome > 0 ? money(h.estAnnualIncome) : "—"}</td>
                    <td className="num pos">{h.estAnnualIncomeNet > 0 ? money(h.estAnnualIncomeNet) : "—"}</td>
                    <td className="num">{h.currentYield != null ? pct(h.currentYield) : "—"}</td>
                    <td className="num">{h.yieldOnCost != null ? pct(h.yieldOnCost) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Calendar ── */}
          <h3 className="sub">📅 Upcoming dividend calendar</h3>
          {div.calendar.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No upcoming dividends projected for these holdings.</p>
          ) : (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Est. ex-date</th><th>Est. pay date</th><th>Ticker</th><th className="num">Per share</th><th className="num">Gross</th><th className="num">Net after tax</th><th>In</th></tr></thead>
                <tbody>
                  {div.calendar.map((c: any) => {
                    // Whole calendar days between today and the ex-date, both
                    // taken at UTC midnight — a fractional difference used to
                    // round tomorrow down to "due".
                    const today = new Date();
                    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
                    const daysAway = Math.round((new Date(c.exDate + "T00:00:00Z").getTime() - todayUtc) / 86400000);
                    return (
                      <tr key={`${c.ticker}-${c.exDate}`}>
                        <td><strong>{c.exDate}</strong></td>
                        <td className="muted">{c.payDate}</td>
                        <td>{c.ticker}</td>
                        <td className="num">{money(c.estAmountPerShare)}</td>
                        <td className="num">{money(c.estPayout)}</td>
                        <td className="num pos">{money(c.estPayoutNet)}</td>
                        <td className="muted">{daysAway < 0 ? "past" : daysAway === 0 ? "today" : daysAway === 1 ? "tomorrow" : `${daysAway}d`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="notice" style={{ marginTop: 12 }}>
            Ex-dates are <strong>projected</strong> from each holding's own calendar position — the day of the month the
            issuer has actually been using — rather than announced dates. <strong>Pay dates are estimated</strong> from
            the ex-date plus a typical settlement lag by frequency; the free data feed carries ex-dates only, so no
            per-issuer pay date can be verified. Forward income assumes the latest payment repeats at that cadence; a
            cut, raise or special dividend will change it. Net figures deduct <strong>{div.withholdingPct}% US
            withholding</strong>, the treaty rate for a Thai-resident holder — your broker may apply a different rate,
            and this is not tax advice.
          </p>
        </div>
      )}
    </>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className={cls("value", accent)} style={{ fontSize: 19 }}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
