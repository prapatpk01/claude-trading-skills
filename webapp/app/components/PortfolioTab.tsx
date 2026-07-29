"use client";
import { useEffect, useState, useCallback } from "react";
import { money, num, pct, cls } from "./format";
import TeamPanel, { DeskNotes, SignalBadge, Disclosures } from "./TeamPanel";
import PortfolioAnalytics from "./PortfolioAnalytics";

interface Holding { id: string; ticker: string; shares: number; avg_cost: number; thesis?: string; target_price?: number | null; }
interface WatchItem { id: string; ticker: string; reason?: string; alert_price?: number | null; }

export default function PortfolioTab() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, { price: number; changePercent: number } | null>>({});
  const [backend, setBackend] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [failedQuotes, setFailedQuotes] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, w] = await Promise.all([
        fetch("/api/portfolio").then((r) => r.json()),
        fetch("/api/watchlist").then((r) => r.json()),
      ]);
      if (p.error) throw new Error(`Portfolio: ${p.error}`);
      if (w.error) throw new Error(`Watchlist: ${w.error}`);
      setHoldings(p.holdings ?? []);
      setWatch(w.watchlist ?? []);
      setBackend(p.backend ?? "");
    } catch (e: any) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshQuotes = useCallback(async () => {
    const tickers = Array.from(new Set([...holdings.map((h) => h.ticker), ...watch.map((w) => w.ticker)]));
    if (!tickers.length) return;
    setQuotesLoading(true);
    try {
      const res = await fetch(`/api/quote?tickers=${tickers.join(",")}`).then((r) => r.json());
      setQuotes(res.quotes ?? {});
      setFailedQuotes(res.failed ?? []);
    } catch {
      setFailedQuotes(tickers);
    } finally {
      setQuotesLoading(false);
    }
  }, [holdings, watch]);

  // Key on the actual ticker list: keying on length alone missed refreshes when
  // one holding replaced another (count unchanged, symbols different).
  const tickerKey = [...holdings.map((h) => h.ticker), ...watch.map((w) => w.ticker)].sort().join(",");
  useEffect(() => { if (tickerKey) refreshQuotes(); }, [tickerKey]); // eslint-disable-line

  // ── totals ──
  let mktValue = 0, costBasis = 0;
  for (const h of holdings) {
    const price = quotes[h.ticker]?.price ?? h.avg_cost;
    mktValue += price * h.shares;
    costBasis += h.avg_cost * h.shares;
  }
  const pnl = mktValue - costBasis;
  const pnlPct = costBasis ? (pnl / costBasis) * 100 : 0;

  return (
    <div>
      <div className="grid cols-4">
        <div className="metric"><div className="label">Market Value</div><div className="value">{money(mktValue)}</div></div>
        <div className="metric"><div className="label">Cost Basis</div><div className="value">{money(costBasis)}</div></div>
        <div className="metric"><div className="label">Unrealized P/L</div><div className={cls("value", pnl >= 0 ? "pos" : "neg")}>{money(pnl)}</div></div>
        <div className="metric"><div className="label">Return</div><div className={cls("value", pnlPct >= 0 ? "pos" : "neg")}>{pnlPct >= 0 ? "+" : ""}{pct(pnlPct)}</div></div>
      </div>

      {/* Performance chart + dividend income/calendar */}
      <div style={{ marginTop: 18 }}>
        <PortfolioAnalytics refreshKey={tickerKey} />
      </div>

      <div className="card ai-card" style={{ marginTop: 18 }}>
        <h3 className="sub">⚖️ Sentinel Committee — Portfolio Review</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          Sleeve balance against the 55/30/13 targets, Rule&nbsp;#7 drift alerts, Rule&nbsp;#3 concentration zones,
          correlation flags, the dual-objective scorecard and the regime cash floor.
        </p>
        <TeamPanel
          label="Convene portfolio committee"
          buildBody={() => ({ mode: "portfolio" })}
          render={(res) => {
            const r = res.review;
            return (
              <>
                <div className="grid cols-4" style={{ marginBottom: 14 }}>
                  <div className="metric">
                    <div className="label">NAV</div>
                    <div className="value" style={{ fontSize: 18 }}>{money(r.nav)}</div>
                  </div>
                  <div className="metric">
                    <div className="label">Blended yield</div>
                    <div className={cls("value", (r.blendedYieldPct ?? 0) >= 5 ? "pos" : "neg")} style={{ fontSize: 18 }}>
                      {r.blendedYieldPct != null ? pct(r.blendedYieldPct) : "—"}
                    </div>
                    <div className="sub">target ≥ 5%</div>
                  </div>
                  <div className="metric">
                    <div className="label">Cash sleeve</div>
                    <div className={cls("value", r.cashRequiredPct != null && r.cashPct < r.cashRequiredPct ? "neg" : "pos")} style={{ fontSize: 18 }}>
                      {pct(r.cashPct)}
                    </div>
                    <div className="sub">{r.cashRequiredPct != null ? `floor ${r.cashRequiredPct}%` : ""}</div>
                  </div>
                  <div className="metric">
                    <div className="label">Actions</div>
                    <div className={cls("value", r.actions.length ? "neg" : "pos")} style={{ fontSize: 18 }}>{r.actions.length}</div>
                    <div className="sub">{r.actions.length ? "outstanding" : "book in policy"}</div>
                  </div>
                </div>

                {r.actions.length > 0 && (
                  <>
                    <h3 className="sub" style={{ marginTop: 0 }}>Action list</h3>
                    <ul style={{ margin: "0 0 14px", paddingLeft: 18, display: "grid", gap: 6 }}>
                      {r.actions.map((a: string, i: number) => (
                        <li key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}

                <h3 className="sub" style={{ marginTop: 0 }}>Sleeve balance</h3>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th>Sleeve</th><th className="num">Actual</th><th className="num">Target</th><th className="num">Drift</th><th>Holdings</th></tr></thead>
                    <tbody>
                      {r.sleeves.map((s: any) => (
                        <tr key={s.sleeve}>
                          <td>{s.alert ? "🔔 " : ""}<strong>{s.sleeve}</strong></td>
                          <td className="num">{pct(s.actualPct)}</td>
                          <td className="num muted">{s.targetPct}%</td>
                          <td className={cls("num", s.alert ? "neg" : "muted")}>{s.driftPct >= 0 ? "+" : ""}{s.driftPct.toFixed(2)}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{s.tickers.join(", ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="sub">Concentration zones (Rule #3)</h3>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th>Ticker</th><th className="num">Weight</th><th>Zone</th><th>Action</th></tr></thead>
                    <tbody>
                      {r.zones.map((z: any) => (
                        <tr key={z.ticker}>
                          <td><strong>{z.ticker}</strong></td>
                          <td className="num">{pct(z.weightPct)}</td>
                          <td>{z.icon} {z.zone}</td>
                          <td className="muted" style={{ fontSize: 12 }}>{z.action}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="sub">Dual objectives</h3>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead><tr><th>Objective</th><th className="num">Actual</th><th className="num">Target</th><th>Status</th></tr></thead>
                    <tbody>
                      {r.objectives.map((o: any) => (
                        <tr key={o.label}>
                          <td>{o.label}<br /><span className="muted" style={{ fontSize: 11 }}>{o.note}</span></td>
                          <td className="num">{o.actual}</td>
                          <td className="num muted">{o.target}</td>
                          <td className={o.pass === true ? "pos" : o.pass === false ? "neg" : "muted"}>
                            {o.pass === true ? "✅ Pass" : o.pass === false ? "❌ Behind" : "⏸ n/a"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <h3 className="sub">Desk notes</h3>
                <DeskNotes desks={r.desks} />
                <Disclosures items={r.disclosures} />
              </>
            );
          }}
        />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="section" style={{ margin: 0 }}>💼 Portfolio Holdings</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="tag">store: {backend || "…"}</span>
            <button className="btn ghost sm" onClick={refreshQuotes} disabled={quotesLoading}>
              {quotesLoading ? <><span className="spinner" /> Prices…</> : "↻ Refresh prices"}
            </button>
          </div>
        </div>
        {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
        {failedQuotes.length > 0 && (
          <div className="notice" style={{ marginTop: 12 }}>
            Could not fetch a live price for: <strong>{failedQuotes.join(", ")}</strong>. Market value for those rows falls back to cost basis. Check the symbol is a valid US-listed ticker, or retry.
          </div>
        )}
        <HoldingForm onAdd={load} />
        {loading ? <p className="muted">Loading…</p> : (
          <div className="table-wrap"><table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr>
              <th>Ticker</th><th className="num">Shares</th><th className="num">Avg Cost</th><th className="num">Price</th>
              <th className="num">Mkt Value</th><th className="num">P/L</th><th className="num">Target</th><th>Thesis</th><th></th>
            </tr></thead>
            <tbody>
              {holdings.map((h) => {
                const price = quotes[h.ticker]?.price;
                const mv = (price ?? h.avg_cost) * h.shares;
                const pl = ((price ?? h.avg_cost) - h.avg_cost) * h.shares;
                const plp = h.avg_cost ? (((price ?? h.avg_cost) - h.avg_cost) / h.avg_cost) * 100 : 0;
                return (
                  <tr key={h.id}>
                    <td><strong>{h.ticker}</strong></td>
                    <td className="num">{num(h.shares, 0)}</td>
                    <td className="num">{money(h.avg_cost)}</td>
                    <td className="num">{price != null ? money(price) : "—"}</td>
                    <td className="num">{money(mv)}</td>
                    <td className={cls("num", pl >= 0 ? "pos" : "neg")}>{money(pl)}<br /><span style={{ fontSize: 11 }}>{plp >= 0 ? "+" : ""}{pct(plp)}</span></td>
                    <td className="num">{h.target_price ? money(h.target_price) : "—"}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 220 }}>{h.thesis ?? "—"}</td>
                    <td><button className="btn danger sm" onClick={async () => { await fetch(`/api/portfolio?id=${h.id}`, { method: "DELETE" }); load(); }}>✕</button></td>
                  </tr>
                );
              })}
              {holdings.length === 0 && <tr><td colSpan={9} className="muted">No holdings yet — add one above.</td></tr>}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="card ai-card">
        <h3 className="sub">⚖️ Sentinel Committee — Watchlist Ranking</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: -6, marginBottom: 12 }}>
          Scores every watchlist name through Momentum Scoring v3.0 and ranks them, applying the hard blocks
          so a name that fails ADX, the 200-SMA or liquidity is flagged rather than promoted.
        </p>
        <TeamPanel
          label="Rank my watchlist"
          buildBody={() => ({ mode: "watchlist" })}
          render={(res) => (
            <>
              {res.regime && (
                <p className="notice" style={{ marginBottom: 12 }}>
                  Regime {res.regime.icon} <strong>{res.regime.regime}</strong> — {res.regime.score}/100. {res.regime.deployRule}.
                </p>
              )}
              <div className="table-wrap">
                <table className="tbl">
                  <thead><tr>
                    <th>#</th><th>Ticker</th><th className="num">Price</th><th className="num">Score</th>
                    <th>Signal</th><th className="num">SAMP L1/L3</th><th className="num">Stop</th><th>Notes</th>
                  </tr></thead>
                  <tbody>
                    {res.rows.map((row: any, i: number) => (
                      <tr key={row.ticker}>
                        <td className="muted">{row.error ? "—" : i + 1}</td>
                        <td><strong>{row.ticker}</strong></td>
                        <td className="num">{row.price != null ? money(row.price) : "—"}</td>
                        <td className="num">{row.score != null ? `${row.score}/100` : "—"}</td>
                        <td>{row.signal ? <SignalBadge signal={row.signal} /> : <span className="muted">n/a</span>}</td>
                        <td className="num">
                          {row.samp ? (
                            <>
                              <span className={row.samp.direction >= 0 ? "pos" : "neg"}>{row.samp.direction}</span>
                              {" / "}
                              <span className={row.samp.acceleration >= 0 ? "pos" : "neg"}>{row.samp.acceleration}</span>
                              {(row.samp.strongBull || row.samp.earlyBull || row.samp.watchLong) && (
                                <><br /><span style={{ fontSize: 10 }} className="muted">
                                  {row.samp.strongBull ? "⚡ strong" : row.samp.earlyBull ? "⚡ early turn" : "👁 watch"}
                                </span></>
                              )}
                            </>
                          ) : "—"}
                        </td>
                        <td className="num">{row.stop != null ? money(row.stop) : "—"}</td>
                        <td className="muted" style={{ fontSize: 11.5, maxWidth: 260 }}>
                          {row.error
                            ? row.error
                            : (row.hardBlocks?.length
                                ? `❌ ${row.hardBlocks.map((b: any) => b.code).join(", ")}`
                                : row.signalReason)}
                          {row.distanceToAlert != null && (
                            <> · {row.distanceToAlert >= 0 ? "+" : ""}{pct(row.distanceToAlert)} vs alert</>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="notice" style={{ marginTop: 12 }}>
                Scores are computed from price and volume data only — a name with no verified catalyst is not credited for one (Rule #5).
              </p>
            </>
          )}
        />
      </div>

      <div className="card">
        <h2 className="section">⭐ Watchlist</h2>
        <WatchForm onAdd={load} />
        <div className="table-wrap"><table className="tbl" style={{ marginTop: 12 }}>
          <thead><tr><th>Ticker</th><th className="num">Price</th><th className="num">Chg</th><th className="num">Alert</th><th>Reason</th><th></th></tr></thead>
          <tbody>
            {watch.map((w) => {
              const price = quotes[w.ticker]?.price;
              const chg = quotes[w.ticker]?.changePercent;
              return (
                <tr key={w.id}>
                  <td><strong>{w.ticker}</strong></td>
                  <td className="num">{price != null ? money(price) : "—"}</td>
                  <td className={cls("num", (chg ?? 0) >= 0 ? "pos" : "neg")}>{chg != null ? `${chg >= 0 ? "+" : ""}${pct(chg)}` : "—"}</td>
                  <td className="num">{w.alert_price ? money(w.alert_price) : "—"}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{w.reason ?? "—"}</td>
                  <td><button className="btn danger sm" onClick={async () => { await fetch(`/api/watchlist?id=${w.id}`, { method: "DELETE" }); load(); }}>✕</button></td>
                </tr>
              );
            })}
            {watch.length === 0 && <tr><td colSpan={6} className="muted">Watchlist empty.</td></tr>}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}

function HoldingForm({ onAdd }: { onAdd: () => void }) {
  const [f, setF] = useState({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
    <form
      className="searchbar"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.ticker) return;
        setBusy(true);
        setErr(null);
        try {
          const res = await fetch("/api/portfolio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(f),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Could not save the holding");
          setF({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "" });
          onAdd();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input-ticker" placeholder="TICKER" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} maxLength={10} />
      <input placeholder="Shares" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} style={{ width: 90 }} />
      <input placeholder="Avg cost" value={f.avg_cost} onChange={(e) => setF({ ...f, avg_cost: e.target.value })} style={{ width: 100 }} />
      <input placeholder="Target" value={f.target_price} onChange={(e) => setF({ ...f, target_price: e.target.value })} style={{ width: 90 }} />
      <input placeholder="Thesis / notes" value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn" disabled={busy}>{busy ? "…" : "Add holding"}</button>
    </form>
    {err && <div className="err" style={{ marginTop: 10 }}>⚠ {err}</div>}
    </>
  );
}

function WatchForm({ onAdd }: { onAdd: () => void }) {
  const [f, setF] = useState({ ticker: "", alert_price: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
    <form
      className="searchbar"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.ticker) return;
        setBusy(true);
        setErr(null);
        try {
          const res = await fetch("/api/watchlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(f),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Could not save to the watchlist");
          setF({ ticker: "", alert_price: "", reason: "" });
          onAdd();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className="input-ticker" placeholder="TICKER" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} maxLength={10} />
      <input placeholder="Alert price" value={f.alert_price} onChange={(e) => setF({ ...f, alert_price: e.target.value })} style={{ width: 110 }} />
      <input placeholder="Why watching?" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn" disabled={busy}>{busy ? "…" : "Add"}</button>
    </form>
    {err && <div className="err" style={{ marginTop: 10 }}>⚠ {err}</div>}
    </>
  );
}
