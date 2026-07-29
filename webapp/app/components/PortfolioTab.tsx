"use client";
import { useEffect, useState, useCallback } from "react";
import { money, num, pct, cls } from "./format";
import TeamPanel, { DeskNotes, SignalBadge, Disclosures } from "./TeamPanel";
import PortfolioAnalytics from "./PortfolioAnalytics";
import ValuationDesk from "./ValuationDesk";
import AllocationDonut from "./AllocationDonut";
import TickerInput from "./TickerInput";

interface Holding {
  id: string; ticker: string; shares: number; avg_cost: number;
  thesis?: string | null; notes?: string | null; target_price?: number | null;
  opened_at?: string | null; closed_at?: string | null; created_at?: string;
}
type Draft = Partial<Record<"ticker" | "shares" | "avg_cost" | "target_price" | "thesis" | "opened_at" | "closed_at", string>>;
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [savingRow, setSavingRow] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

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

  const startEdit = useCallback((h: Holding) => {
    setRowError(null);
    setEditingId(h.id);
    setDraft({
      ticker: h.ticker,
      shares: String(h.shares),
      avg_cost: String(h.avg_cost),
      target_price: h.target_price != null ? String(h.target_price) : "",
      thesis: h.thesis ?? "",
      opened_at: h.opened_at ?? (h.created_at ? h.created_at.slice(0, 10) : ""),
      closed_at: h.closed_at ?? "",
    });
  }, []);

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

      {/* Allocation — built from the same holdings and quotes the table below
          renders, so the ring can never describe a different book. */}
      {holdings.length > 0 && (
        <div className="card">
          <h2 className="section">🍩 Allocation</h2>
          <AllocationDonut holdings={holdings} quotes={quotes} />
        </div>
      )}

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

      {/* Fair value per holding + the add / trim / exit size it implies */}
      <ValuationDesk />

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
        {rowError && <div className="notice" style={{ marginTop: 10 }}>{rowError}</div>}
        {loading ? <p className="muted">Loading…</p> : (
          <div className="table-wrap"><table className="tbl" style={{ marginTop: 12 }}>
            <thead><tr>
              <th>Ticker</th><th className="num">Shares</th><th className="num">Avg Cost</th><th className="num">Price</th>
              <th className="num">Mkt Value</th><th className="num">P/L</th><th className="num">Target</th>
              <th>Opened / Closed</th><th>Thesis</th><th></th>
            </tr></thead>
            <tbody>
              {holdings.map((h) => {
                const price = quotes[h.ticker]?.price;
                const mv = (price ?? h.avg_cost) * h.shares;
                const pl = ((price ?? h.avg_cost) - h.avg_cost) * h.shares;
                const plp = h.avg_cost ? (((price ?? h.avg_cost) - h.avg_cost) / h.avg_cost) * 100 : 0;
                const editing = editingId === h.id;

                if (editing) {
                  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
                    setDraft((d) => ({ ...d, [k]: e.target.value }));
                  return (
                    <tr key={h.id} className="row-editing">
                      <td style={{ minWidth: 130 }}>
                        <TickerInput value={draft.ticker ?? ""} onChange={(v) => setDraft((d) => ({ ...d, ticker: v }))} />
                      </td>
                      <td><input className="edit-input" value={draft.shares ?? ""} onChange={set("shares")} inputMode="decimal" /></td>
                      <td><input className="edit-input" value={draft.avg_cost ?? ""} onChange={set("avg_cost")} inputMode="decimal" /></td>
                      <td className="num muted">{price != null ? money(price) : "—"}</td>
                      <td className="num muted">{money(mv)}</td>
                      <td className="num muted">{money(pl)}</td>
                      <td><input className="edit-input" value={draft.target_price ?? ""} onChange={set("target_price")} inputMode="decimal" placeholder="—" /></td>
                      <td style={{ minWidth: 150 }}>
                        <input className="edit-input" type="date" value={draft.opened_at ?? ""} onChange={set("opened_at")} />
                        <input className="edit-input" type="date" style={{ marginTop: 4 }} value={draft.closed_at ?? ""} onChange={set("closed_at")} />
                      </td>
                      <td style={{ minWidth: 180 }}>
                        <input className="edit-input" value={draft.thesis ?? ""} onChange={set("thesis")} placeholder="Thesis / notes" />
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <button
                          className="btn sm"
                          disabled={savingRow}
                          onClick={async () => {
                            setSavingRow(true);
                            setRowError(null);
                            try {
                              const res = await fetch("/api/portfolio", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ id: h.id, ...draft }),
                              });
                              const json = await res.json();
                              if (!res.ok) throw new Error(json.error || "Could not save");
                              if (json.warning) setRowError(json.warning);
                              setEditingId(null);
                              setDraft({});
                              load();
                            } catch (e: any) {
                              setRowError(e.message);
                            } finally {
                              setSavingRow(false);
                            }
                          }}
                        >
                          {savingRow ? "…" : "Save"}
                        </button>{" "}
                        <button className="btn ghost sm" onClick={() => { setEditingId(null); setDraft({}); setRowError(null); }}>Cancel</button>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr key={h.id}>
                    <td><strong>{h.ticker}</strong></td>
                    <td className="num">{num(h.shares, 0)}</td>
                    <td className="num">{money(h.avg_cost)}</td>
                    <td className="num">{price != null ? money(price) : "—"}</td>
                    <td className="num">{money(mv)}</td>
                    <td className={cls("num", pl >= 0 ? "pos" : "neg")}>{money(pl)}<br /><span style={{ fontSize: 11 }}>{plp >= 0 ? "+" : ""}{pct(plp)}</span></td>
                    <td className="num">{h.target_price ? money(h.target_price) : "—"}</td>
                    <td className="muted" style={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                      {h.opened_at ?? (h.created_at ? h.created_at.slice(0, 10) : "—")}
                      {h.closed_at && <><br /><span className="neg">closed {h.closed_at}</span></>}
                    </td>
                    <td style={{ maxWidth: 230 }}><ThesisCell text={h.thesis} onAdd={() => startEdit(h)} /></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <button className="btn ghost sm" title="Edit this position" onClick={() => startEdit(h)}>
                        ✎
                      </button>{" "}
                      <button
                        className="btn danger sm"
                        onClick={async () => { await fetch(`/api/portfolio?id=${h.id}`, { method: "DELETE" }); load(); }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
              {holdings.length === 0 && <tr><td colSpan={10} className="muted">No holdings yet — add one above.</td></tr>}
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

      <IdeaTracker refreshKey={tickerKey} />

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
  const [f, setF] = useState({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "", opened_at: new Date().toISOString().slice(0, 10) });
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
          setF({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "", opened_at: new Date().toISOString().slice(0, 10) });
          onAdd();
        } catch (e: any) {
          setErr(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <TickerInput value={f.ticker} onChange={(v) => setF({ ...f, ticker: v })} style={{ minWidth: 150 }} />
      <input placeholder="Shares" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} style={{ width: 90 }} />
      <input placeholder="Avg cost" value={f.avg_cost} onChange={(e) => setF({ ...f, avg_cost: e.target.value })} style={{ width: 100 }} />
      <input placeholder="Target" value={f.target_price} onChange={(e) => setF({ ...f, target_price: e.target.value })} style={{ width: 90 }} />
      <input type="date" title="Date opened" value={f.opened_at} onChange={(e) => setF({ ...f, opened_at: e.target.value })} style={{ width: 150 }} />
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
      <TickerInput value={f.ticker} onChange={(v) => setF({ ...f, ticker: v })} style={{ minWidth: 150 }} />
      <input placeholder="Alert price" value={f.alert_price} onChange={(e) => setF({ ...f, alert_price: e.target.value })} style={{ width: 110 }} />
      <input placeholder="Why watching?" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn" disabled={busy}>{busy ? "…" : "Add"}</button>
    </form>
    {err && <div className="err" style={{ marginTop: 10 }}>⚠ {err}</div>}
    </>
  );
}

/**
 * Outcome tracker for saved trade ideas.
 * Replays the bars since each idea was added and reports whether the target
 * was reached, the stop was taken out, or it is still working.
 */
function IdeaTracker({ refreshKey }: { refreshKey: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/watchlist/track");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not load tracking");
      setData(json);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (refreshKey) load(); }, [load, refreshKey]);

  if (!refreshKey) return null;
  const rows = data?.rows ?? [];
  const s = data?.summary;

  const badge = (status: string) =>
    status === "TARGET HIT" ? <span className="pill buy">🎯 Target hit</span>
    : status === "STOPPED" ? <span className="pill sell">🛑 Stopped</span>
    : status === "OPEN" ? <span className="pill hold">⏳ Open</span>
    : <span className="muted" style={{ fontSize: 11 }}>{status === "NO LEVELS" ? "no target set" : "no data"}</span>;

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section" style={{ margin: 0 }}>🎯 Idea Tracking</h2>
        <button className="btn ghost sm" onClick={load} disabled={loading}>
          {loading ? <><span className="spinner" /> Checking…</> : "↻ Re-check"}
        </button>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
        Ideas saved from the scanner keep their target and stop. Each is replayed against the bars since it was
        added — a wick through the level counts as a touch, and a bar touching both is read as the stop first.
      </p>

      {err && <div className="err" style={{ marginTop: 12 }}>⚠ {err}</div>}
      {loading && !data && <p className="muted" style={{ marginTop: 10 }}><span className="spinner" /> Replaying price history…</p>}

      {s && (
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <div className="metric"><div className="label">Target hit</div><div className="value pos" style={{ fontSize: 19 }}>{s.hit}</div></div>
          <div className="metric"><div className="label">Stopped</div><div className="value neg" style={{ fontSize: 19 }}>{s.stopped}</div></div>
          <div className="metric"><div className="label">Still open</div><div className="value" style={{ fontSize: 19 }}>{s.open}</div></div>
          <div className="metric">
            <div className="label">Hit rate</div>
            <div className="value" style={{ fontSize: 19 }}>{s.hitRatePct != null ? `${s.hitRatePct}%` : "—"}</div>
            <div className="sub">of resolved</div>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr>
              <th>Ticker</th><th>Status</th><th className="num">Entry → Now</th><th className="num">Target</th>
              <th className="num">Stop</th><th className="num">Progress</th><th>Detail</th>
            </tr></thead>
            <tbody>
              {rows.map((r: any) => {
                const o = r.outcome;
                return (
                  <tr key={r.id}>
                    <td><strong>{r.ticker}</strong><br /><span className="muted" style={{ fontSize: 10.5 }}>added {r.addedOn}</span></td>
                    <td>{badge(o.status)}</td>
                    <td className="num">
                      {o.entry != null ? money(o.entry) : "—"} → {o.currentPrice != null ? money(o.currentPrice) : "—"}
                      {o.returnPct != null && (
                        <><br /><span className={o.returnPct >= 0 ? "pos" : "neg"} style={{ fontSize: 11 }}>
                          {o.returnPct >= 0 ? "+" : ""}{pct(o.returnPct)}
                        </span></>
                      )}
                    </td>
                    <td className="num">
                      {o.target != null ? money(o.target) : "—"}
                      {o.toTargetPct != null && o.status === "OPEN" && (
                        <><br /><span className="muted" style={{ fontSize: 10.5 }}>{o.toTargetPct >= 0 ? "+" : ""}{pct(o.toTargetPct)} away</span></>
                      )}
                    </td>
                    <td className="num">{o.stop != null ? money(o.stop) : "—"}</td>
                    <td className="num" style={{ minWidth: 90 }}>
                      {o.progressPct != null ? (
                        <>
                          {o.progressPct}%
                          <div className="bar" style={{ marginTop: 4 }}><span style={{ width: `${o.progressPct}%` }} /></div>
                        </>
                      ) : "—"}
                    </td>
                    <td className="muted" style={{ fontSize: 11.5, maxWidth: 260 }}>
                      {o.note}
                      {o.maxFavourablePct != null && (
                        <><br /><span style={{ fontSize: 10.5 }}>
                          best {o.maxFavourablePct >= 0 ? "+" : ""}{pct(o.maxFavourablePct)} · worst {pct(o.maxAdversePct)}
                        </span></>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !loading && !err && (
        <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>
          Nothing tracked yet. Run the momentum scanner and use <strong>☆ Track target</strong> on a setup.
        </p>
      )}

      {s?.note && <p className="notice" style={{ marginTop: 12 }}>{s.note}</p>}
    </div>
  );
}

/**
 * Thesis cell — shows a short form by default and expands on click.
 * An empty thesis previously rendered a bare dash, which gave no hint that
 * one could be added, so the empty state is now the affordance.
 */
function ThesisCell({ text, onAdd }: { text?: string | null; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const body = (text ?? "").trim();

  if (!body) {
    return (
      <button
        onClick={onAdd}
        title="Add a thesis for this position"
        style={{
          background: "transparent", border: "1px dashed var(--border-strong)", borderRadius: 7,
          color: "var(--muted)", font: "inherit", fontSize: 11.5, padding: "3px 9px", cursor: "pointer",
        }}
      >
        + add note
      </button>
    );
  }

  const SHORT = 70;
  const isLong = body.length > SHORT;
  return (
    <span
      onClick={() => isLong && setOpen((o) => !o)}
      title={isLong && !open ? body : undefined}
      className="muted"
      style={{
        fontSize: 12, lineHeight: 1.45, display: "block",
        cursor: isLong ? "pointer" : "default",
      }}
    >
      {open || !isLong ? body : `${body.slice(0, SHORT).trimEnd()}…`}
      {isLong && (
        <span style={{ color: "var(--accent-2)", marginLeft: 5, whiteSpace: "nowrap", fontSize: 11 }}>
          {open ? "less" : "more"}
        </span>
      )}
    </span>
  );
}
