"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "./format";
import TickerInput from "./TickerInput";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type WatchItem = { id: string; ticker: string; reason?: string | null; source?: string | null; entry_price?: number | null; target_price?: number | null; stop_price?: number | null; created_at?: string | null };
type EditMode = "reconcile" | "add" | "reduce" | "close";
type EditState = { id: string; ticker: string; heldShares: number; mode: EditMode; shares: string; avgCost: string; tradePrice: string };
type MonitorScope = "holdings" | "watchlist";

const pc = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const WATCHLIST_ACTIONS: Record<string, { label: string; className: string }> = {
  ADD: { label: "BUY CANDIDATE", className: "add" },
  HOLD: { label: "WATCH", className: "hold" },
  TRIM: { label: "AVOID NEW BUY", className: "trim" },
  "EXIT REVIEW": { label: "REMOVE REVIEW", className: "exit-review" },
};

async function loadMarket(tickers: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < tickers.length; index += 25) chunks.push(tickers.slice(index, index + 25));
  const payloads = await Promise.all(chunks.map(async (chunk) => {
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load market intelligence.");
    return response.json();
  }));
  return Object.assign({}, ...payloads.map((payload) => payload.items ?? {}));
}

export default function HoldingsMarketMonitor({ onUpdated }: { onUpdated?: () => void }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [market, setMarket] = useState<Record<string, any>>({});
  const [scope, setScope] = useState<MonitorScope>("holdings");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [watchTicker, setWatchTicker] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [watchSaving, setWatchSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [portfolioResponse, watchlistResponse] = await Promise.all([
        fetch("/api/portfolio", { cache: "no-store" }),
        fetch("/api/watchlist", { cache: "no-store" }),
      ]);
      const [p, w] = await Promise.all([portfolioResponse.json(), watchlistResponse.json()]);
      if (!portfolioResponse.ok) throw new Error(p.error || "Unable to load holdings.");
      if (!watchlistResponse.ok) throw new Error(w.error || "Unable to load watchlist.");
      const hs = (p.holdings ?? []).filter((h: Holding) => !h.closed_at && Number(h.shares) > 0);
      const heldTickers = new Set(hs.map((holding: Holding) => holding.ticker));
      const ws = (w.watchlist ?? []).filter((item: WatchItem) => !heldTickers.has(item.ticker));
      setHoldings(hs);
      setWatchlist(ws);
      const tickers = Array.from(new Set([...hs.map((h: Holding) => h.ticker), ...ws.map((item: WatchItem) => item.ticker)]));
      setMarket(tickers.length ? await loadMarket(tickers) : {});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load holdings.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const nav = useMemo(() => holdings.reduce((sum, h) => sum + (market[h.ticker]?.price ?? h.avg_cost) * h.shares, 0), [holdings, market]);

  const beginEdit = (holding: Holding, mode: EditMode = "reconcile") => {
    const live = market[holding.ticker]?.price ?? holding.avg_cost;
    setMessage(null);
    setEditing({ id: holding.id, ticker: holding.ticker, heldShares: Number(holding.shares), mode, shares: mode === "close" ? String(holding.shares) : mode === "reconcile" ? String(holding.shares) : "", avgCost: String(holding.avg_cost), tradePrice: String(live) });
  };

  const changeMode = (mode: EditMode) => {
    if (!editing) return;
    setEditing({ ...editing, mode, shares: mode === "close" ? String(editing.heldShares) : mode === "reconcile" ? String(editing.heldShares) : "" });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const shares = Number(editing.shares);
    const avgCost = Number(editing.avgCost);
    const tradePrice = Number(editing.tradePrice);
    if (!Number.isFinite(shares) || shares <= 0) return setMessage("Shares must be greater than zero.");
    if (editing.mode === "reconcile" && (!Number.isFinite(avgCost) || avgCost < 0)) return setMessage("Average cost must be zero or greater.");
    if (editing.mode !== "reconcile" && (!Number.isFinite(tradePrice) || tradePrice < 0)) return setMessage("Trade price must be zero or greater.");
    if ((editing.mode === "reduce" || editing.mode === "close") && shares > editing.heldShares + 1e-7) return setMessage(`Cannot sell more than ${editing.heldShares} shares.`);

    setSaving(true); setMessage(null);
    try {
      const isReconcile = editing.mode === "reconcile";
      const action = editing.mode === "add" ? "buy" : "sell";
      const response = await fetch("/api/portfolio", {
        method: isReconcile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isReconcile
          ? { id: editing.id, shares, avg_cost: avgCost }
          : { action, ticker: editing.ticker, shares, avg_cost: tradePrice, transaction_date: today(), notes: `Holdings Edit: ${editing.mode.toUpperCase()}` }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update holding.");
      const text = isReconcile
        ? `${editing.ticker} reconciled to ${shares} shares at ${money(avgCost)} average cost.`
        : editing.mode === "add"
          ? `${editing.ticker} added ${shares} shares at ${money(tradePrice)}.`
          : payload.closed
            ? `${editing.ticker} position closed and moved to Closed Positions.`
            : `${editing.ticker} reduced by ${shares} shares. Remaining ${payload.remainingShares}.`;
      setEditing(null); setMessage(text); await load(); onUpdated?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update holding."); }
    finally { setSaving(false); }
  };

  const addToWatchlist = async (tickerOverride?: string) => {
    const ticker = String(tickerOverride ?? watchTicker).trim().toUpperCase();
    if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return setMessage("Choose a valid ticker from search before adding it.");
    if (holdings.some((holding) => holding.ticker === ticker)) return setMessage(`${ticker} is already an open holding.`);
    if (watchlist.some((item) => item.ticker === ticker)) return setMessage(`${ticker} is already on the watchlist.`);
    setWatchSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          source: "Manual watchlist · Portfolio Monitor",
          reason: watchReason.trim() || "Added from Portfolio & Watchlist Market Monitor for Investment Team research.",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to add this ticker to the watchlist.");
      setWatchTicker(""); setWatchReason(""); setMessage(`${ticker} added to the watchlist.`);
      await load(); onUpdated?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to add this ticker to the watchlist."); }
    finally { setWatchSaving(false); }
  };

  const removeFromWatchlist = async (watch: WatchItem) => {
    setDeleting(watch.id); setMessage(null);
    try {
      const response = await fetch(`/api/watchlist?id=${encodeURIComponent(watch.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to remove this ticker from the watchlist.");
      setPendingDelete(null); setMessage(`${watch.ticker} removed from the watchlist.`);
      await load(); onUpdated?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to remove this ticker from the watchlist."); }
    finally { setDeleting(null); }
  };

  if (loading) return <div className="card"><span className="spinner" /> Loading holdings market intelligence…</div>;
  return <div className="card holdings-monitor-card" data-feature="holding-reconciliation ledger-edit-actions">
    <div className="holdings-monitor-head"><div><h2 className="section" style={{ margin: 0 }}>📈 Portfolio & Watchlist Market Monitor</h2><p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Sentinel X sets trend and technical targets; MCDX confirms accumulation/distribution. Weekly decides, Daily times execution.</p></div><div style={{display:"flex",gap:8,flexWrap:"wrap"}}><span className="tag">{holdings.length} open positions</span><span className="tag">{watchlist.length} watchlist names</span></div></div>
    <div className="market-monitor-tabs" role="tablist" aria-label="Market monitor scope" style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
      <button type="button" role="tab" aria-selected={scope === "holdings"} className={`btn ${scope === "holdings" ? "" : "ghost"} sm`} onClick={() => setScope("holdings")}>Holdings · {holdings.length}</button>
      <button type="button" role="tab" aria-selected={scope === "watchlist"} className={`btn ${scope === "watchlist" ? "" : "ghost"} sm`} onClick={() => setScope("watchlist")}>Watchlist · {watchlist.length}</button>
    </div>
    <div className="technical-overlay-policy"><strong>{scope === "holdings" ? "TECHNICAL PORTFOLIO OVERLAY" : "TECHNICAL WATCHLIST OVERLAY"}</strong><span>{scope === "holdings" ? "ADD / HOLD / TRIM / EXIT REVIEW" : "BUY CANDIDATE / WATCH / AVOID / REMOVE"}</span><small>{scope === "holdings" ? "Technical Target ≠ Fair Value · MCDX is a synthetic price/volume proxy · EXIT always requires thesis/fundamental approval" : "BUY CANDIDATE is not an order · Investment must verify thesis, valuation and catalyst before committee review · No automatic promotion or execution"}</small></div>
    {scope === "watchlist" && <section className="watchlist-manage-panel" aria-label="Add a ticker to the watchlist">
      <div><strong>ADD WATCHLIST CANDIDATE</strong><small>Search by ticker or company name. Adding here creates a research item only—not a BUY order.</small></div>
      <div className="watchlist-manage-grid">
        <TickerInput value={watchTicker} onChange={(value) => setWatchTicker(value.toUpperCase())} onSubmitTicker={(ticker) => setWatchTicker(ticker)} placeholder="Search ticker or company" />
        <input value={watchReason} onChange={(event) => setWatchReason(event.target.value)} placeholder="Research reason (optional)" />
        <button type="button" className="btn" disabled={watchSaving || !watchTicker.trim()} onClick={() => void addToWatchlist()}>{watchSaving ? "Adding…" : "+ Add to Watchlist"}</button>
      </div>
    </section>}
    {message && <div className={`holding-edit-message ${/reconciled|added|reduced|closed|removed/.test(message) ? "success" : "error"}`}>{message}</div>}

    {editing && <section className="holding-edit-panel" aria-label={`Edit ${editing.ticker} holding`}>
      <div className="holding-edit-title"><div><span>EDIT HOLDING · LEDGER SAFE</span><strong>{editing.ticker}</strong></div><button type="button" className="btn ghost sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(["reconcile", "add", "reduce", "close"] as EditMode[]).map((mode) => <button key={mode} type="button" className={`btn ${editing.mode === mode ? "" : "ghost"} sm`} onClick={() => changeMode(mode)} disabled={saving}>{mode === "reconcile" ? "Reconcile" : mode === "add" ? "+ Add shares" : mode === "reduce" ? "− Reduce shares" : "Close position"}</button>)}
      </div>
      <div className="holding-edit-grid">
        <label><span>{editing.mode === "reconcile" ? "Broker shares" : editing.mode === "add" ? "Shares to add" : "Shares to sell"}</span><input inputMode="decimal" value={editing.shares} disabled={editing.mode === "close"} onChange={(e) => setEditing({ ...editing, shares: e.target.value })} /></label>
        {editing.mode === "reconcile" ? <label><span>Average cost</span><input inputMode="decimal" value={editing.avgCost} onChange={(e) => setEditing({ ...editing, avgCost: e.target.value })} /></label> : <label><span>{editing.mode === "add" ? "Buy price" : "Sell price"}</span><input inputMode="decimal" value={editing.tradePrice} onChange={(e) => setEditing({ ...editing, tradePrice: e.target.value })} /></label>}
        <button type="button" className="btn primary holding-save-btn" onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : editing.mode === "reconcile" ? "Save corrected holding" : editing.mode === "add" ? "Record purchase" : editing.mode === "reduce" ? "Record partial sale" : "Sell all & close"}</button>
      </div>
      <p className="muted holding-edit-note">{editing.mode === "reconcile" ? "Reconciliation adjusts the opening balance and writes an audit record. It does not create a synthetic trade." : "This records a real BUY or SELL transaction and updates Holdings, Cash Ledger and Trade Ledger atomically."}</p>
    </section>}

    {scope === "holdings" ? !holdings.length ? <div className="notice" style={{marginTop:12}}>No open holdings are available for market monitoring.</div> : <div className="table-wrap" style={{ marginTop: 12 }}><table className="tbl holdings-market-table"><thead><tr><th>Ticker</th><th className="num">Shares</th><th className="num">Avg cost</th><th className="num">Current</th><th className="num">vs cost</th><th>Overlay action</th><th>Technical targets</th><th>Sentinel X</th><th>MCDX proxy</th><th className="num">1W</th><th>YTD</th><th>52W range</th><th className="num">Weight</th><th className="num">Edit</th></tr></thead><tbody>
      {holdings.map((holding) => { const item = market[holding.ticker]; const overlay = item?.technicalOverlay; const price = item?.price ?? null; const vs = price != null && holding.avg_cost > 0 ? (price / holding.avg_cost - 1) * 100 : null; const marketValue = (price ?? holding.avg_cost) * holding.shares; const weight = nav ? marketValue / nav * 100 : 0; return <tr key={holding.id || holding.ticker}><td><strong>{holding.ticker}</strong><br/><span className="muted" style={{ fontSize: 10.5 }}>{item?.asOf ?? "—"}</span></td><td className="num"><strong>{Number(holding.shares).toLocaleString(undefined,{maximumFractionDigits:7})}</strong></td><td className="num">{money(holding.avg_cost)}</td><td className="num"><strong>{price == null ? "—" : money(price)}</strong></td><td className={`num ${vs == null ? "muted" : vs >= 0 ? "pos" : "neg"}`}>{pc(vs)}</td><td style={{minWidth:190}}>{overlay ? <><span className={`overlay-action ${overlay.action.toLowerCase().replace(" ", "-")}`}>{overlay.action}</span><div className="overlay-reason">{overlay.reason}</div><small className="muted">Confidence {overlay.confidence}%</small></> : <span className="muted">Need 220 trading days</span>}</td><td style={{minWidth:155}}>{overlay ? <div className="overlay-targets"><span>T1 <strong>{overlay.target1 == null ? "—" : money(overlay.target1)}</strong></span><span>T2 <strong>{overlay.target2 == null ? "Conditional" : money(overlay.target2)}</strong></span><span>S1 <strong>{overlay.support1 == null ? "—" : money(overlay.support1)}</strong></span><small>Room {overlay.roomAtr == null ? "—" : `${overlay.roomAtr.toFixed(2)} ATR`}</small></div> : "—"}</td><td style={{minWidth:140}}>{overlay ? <div className="overlay-signals"><strong className={overlay.sentinel.trend === "BULL" ? "pos" : overlay.sentinel.trend === "BEAR" ? "neg" : ""}>{overlay.sentinel.trend}</strong><span>D {overlay.sentinel.dailyScore} · W {overlay.sentinel.weeklyScore}</span><small>{overlay.sentinel.structure} structure</small></div> : "—"}</td><td style={{minWidth:155}}>{overlay ? <div className="overlay-signals"><strong className={overlay.mcdx.state === "ACCUMULATION" ? "pos" : overlay.mcdx.state === "DISTRIBUTION" ? "neg" : ""}>{overlay.mcdx.state}</strong><span>Flow {overlay.mcdx.smartFlow} · Context {overlay.mcdx.contextScore}</span><small>Smart proxy {overlay.mcdx.smartMoneyProxy}</small></div> : "—"}</td><td className={`num ${item?.change1w == null ? "muted" : item.change1w >= 0 ? "pos" : "neg"}`}>{pc(item?.change1w ?? null)}</td><td style={{minWidth:150}}><Spark points={item?.ytdSeries ?? []} positive={(item?.ytdChangePct ?? 0)>=0}/><div className={item?.ytdChangePct == null ? "muted" : item.ytdChangePct >= 0 ? "pos" : "neg"} style={{fontSize:10.5,marginTop:2}}>YTD {pc(item?.ytdChangePct ?? null)}</div></td><td style={{minWidth:210}}><Range low={item?.low52 ?? null} high={item?.high52 ?? null} pos={item?.pos52 ?? null} price={price}/></td><td className="num">{weight.toFixed(1)}%</td><td className="num"><button type="button" className="holding-edit-btn" onClick={() => beginEdit(holding)}>Edit</button></td></tr>; })}
    </tbody></table></div> : <WatchlistTable
      watchlist={watchlist}
      market={market}
      pendingDelete={pendingDelete}
      deleting={deleting}
      onRequestDelete={setPendingDelete}
      onRemove={removeFromWatchlist}
    />}
  </div>;
}

function WatchlistTable({ watchlist, market, pendingDelete, deleting, onRequestDelete, onRemove }: { watchlist: WatchItem[]; market: Record<string, any>; pendingDelete: string | null; deleting: string | null; onRequestDelete: (id: string | null) => void; onRemove: (watch: WatchItem) => Promise<void> }) {
  if (!watchlist.length) return <div className="notice" style={{marginTop:12}}>No watchlist-only names. Use the search above to add a research candidate.</div>;
  return <div className="table-wrap" style={{marginTop:12}}><table className="tbl holdings-market-table watchlist-market-table"><thead><tr><th>Ticker</th><th>Research source</th><th className="num">Current</th><th>Watchlist decision</th><th>Technical targets</th><th>Sentinel X</th><th>MCDX proxy</th><th className="num">1W</th><th>YTD</th><th>52W range</th><th>Manage</th></tr></thead><tbody>
    {watchlist.map((watch) => { const item=market[watch.ticker]; const overlay=item?.technicalOverlay; const price=item?.price??null; const decision=overlay ? WATCHLIST_ACTIONS[overlay.action] ?? WATCHLIST_ACTIONS.HOLD : null; const confirming=pendingDelete===watch.id; return <tr key={watch.id || watch.ticker}><td><strong>{watch.ticker}</strong><br/><span className="muted" style={{fontSize:10.5}}>{item?.asOf??"—"}</span></td><td style={{minWidth:190}}><strong>{watch.source??"Manual watchlist"}</strong><div className="overlay-reason">{watch.reason??"Awaiting Investment research brief."}</div>{watch.entry_price!=null&&<small className="muted">Reference entry {money(Number(watch.entry_price))}</small>}</td><td className="num"><strong>{price==null?"—":money(price)}</strong></td><td style={{minWidth:210}}>{overlay&&decision?<><span className={`overlay-action ${decision.className}`}>{decision.label}</span><div className="overlay-reason">{watchlistReason(overlay.action,overlay.reason)}</div><small className="muted">Technical confidence {overlay.confidence}%</small></>:<span className="muted">Need 220 trading days</span>}</td><td style={{minWidth:175}}>{overlay?<div className="overlay-targets"><span>T1 <strong>{overlay.target1==null?"—":money(overlay.target1)}</strong></span><span>T2 <strong>{overlay.target2==null?"Conditional":money(overlay.target2)}</strong></span><span>S1 <strong>{overlay.support1==null?"—":money(overlay.support1)}</strong></span><small>Room {overlay.roomAtr==null?"—":`${overlay.roomAtr.toFixed(2)} ATR`}</small></div>:"—"}</td><td style={{minWidth:140}}>{overlay?<div className="overlay-signals"><strong className={overlay.sentinel.trend==="BULL"?"pos":overlay.sentinel.trend==="BEAR"?"neg":""}>{overlay.sentinel.trend}</strong><span>D {overlay.sentinel.dailyScore} · W {overlay.sentinel.weeklyScore}</span><small>{overlay.sentinel.structure} structure</small></div>:"—"}</td><td style={{minWidth:155}}>{overlay?<div className="overlay-signals"><strong className={overlay.mcdx.state==="ACCUMULATION"?"pos":overlay.mcdx.state==="DISTRIBUTION"?"neg":""}>{overlay.mcdx.state}</strong><span>Flow {overlay.mcdx.smartFlow} · Context {overlay.mcdx.contextScore}</span><small>Smart proxy {overlay.mcdx.smartMoneyProxy}</small></div>:"—"}</td><td className={`num ${item?.change1w==null?"muted":item.change1w>=0?"pos":"neg"}`}>{pc(item?.change1w??null)}</td><td style={{minWidth:150}}><Spark points={item?.ytdSeries??[]} positive={(item?.ytdChangePct??0)>=0}/><div className={item?.ytdChangePct==null?"muted":item.ytdChangePct>=0?"pos":"neg"} style={{fontSize:10.5,marginTop:2}}>YTD {pc(item?.ytdChangePct??null)}</div></td><td style={{minWidth:210}}><Range low={item?.low52??null} high={item?.high52??null} pos={item?.pos52??null} price={price}/></td><td><div className="watchlist-remove-actions">{confirming?<><button type="button" className="btn danger sm" disabled={deleting===watch.id} onClick={() => void onRemove(watch)}>{deleting===watch.id?"Removing…":"Confirm remove"}</button><button type="button" className="btn ghost sm" disabled={deleting===watch.id} onClick={() => onRequestDelete(null)}>Cancel</button></>:<button type="button" className="btn ghost sm" onClick={() => onRequestDelete(watch.id)}>Remove</button>}</div></td></tr>; })}
  </tbody></table></div>;
}

function watchlistReason(action: string, reason: string) {
  if (action === "ADD") return `${reason} Send to Investment for thesis, valuation and catalyst verification before presentation.`;
  if (action === "HOLD") return "No qualified entry yet; keep monitoring trend, flow and Target 1 room.";
  if (action === "TRIM") return "Entry quality is currently unfavorable; wait for risk/reward and accumulation to improve.";
  return "Bearish trend/distribution requires Research to review whether this name should remain on the watchlist.";
}

function Spark({ points, positive }: { points: any[]; positive: boolean }) { if (points.length < 2) return <span className="muted">—</span>; const values=points.map(p=>p.close); const low=Math.min(...values), high=Math.max(...values), width=140, height=36, span=Math.max(.0001,high-low); const path=values.map((v,i)=>`${i?"L":"M"}${i/(values.length-1)*width},${height-(v-low)/span*height}`).join(" "); return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="YTD price sparkline"><path d={path} fill="none" stroke="currentColor" strokeWidth="2" className={positive?"pos":"neg"}/></svg>; }
function Range({ low, high, pos, price }: { low:number|null; high:number|null; pos:number|null; price:number|null }) { return <div><div style={{display:"flex",justifyContent:"space-between",fontSize:10.5}}><span className="muted">{low==null?"—":money(low)}</span><strong>{pos==null?"—":`${pos.toFixed(0)}%`}</strong><span className="muted">{high==null?"—":money(high)}</span></div><div style={{height:7,borderRadius:999,background:"rgba(255,255,255,.08)",position:"relative",marginTop:6}}>{pos!=null&&<span style={{position:"absolute",left:`calc(${pos}% - 5px)`,top:-2,width:11,height:11,borderRadius:"50%",background:"currentColor"}}/>}</div><div className="muted" style={{fontSize:10,marginTop:4}}>{price==null?"No current price":pos==null?"52W history unavailable":pos>=85?"Near 52W high":pos<=15?"Near 52W low":"Inside 52W range"}</div></div>; }
