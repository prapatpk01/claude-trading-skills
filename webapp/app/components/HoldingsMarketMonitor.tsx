"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "./format";
import TickerInput from "./TickerInput";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type WatchItem = { id: string; ticker: string; reason?: string | null; source?: string | null; entry_price?: number | null; target_price?: number | null; stop_price?: number | null; created_at?: string | null };
type EditMode = "reconcile" | "add" | "reduce" | "close";
type EditState = { id: string; ticker: string; heldShares: number; mode: EditMode; shares: string; avgCost: string; tradePrice: string };
type MonitorScope = "holdings" | "watchlist";
type ChartRange = "1M" | "3M" | "6M" | "YTD" | "1Y";
type MarketHealth = { requested: number; complete: number; partial: string[]; failed: string[] };

const CHART_RANGES: ChartRange[] = ["1M", "3M", "6M", "YTD", "1Y"];
const pc = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const today = () => new Date().toISOString().slice(0, 10);
const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const WATCHLIST_ACTIONS: Record<string, { label: string; className: string }> = {
  ADD: { label: "BUY CANDIDATE", className: "add" },
  HOLD: { label: "WATCH", className: "hold" },
  TRIM: { label: "AVOID NEW BUY", className: "trim" },
  "EXIT REVIEW": { label: "REMOVE REVIEW", className: "exit-review" },
};

async function loadMarket(tickers: string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < tickers.length; index += 25) chunks.push(tickers.slice(index, index + 25));
  const items: Record<string, any> = {};
  const failed = new Set<string>();
  const partial = new Set<string>();
  let requested = 0;
  let complete = 0;
  // Load chunks sequentially so a 10-holding + 18-watchlist portfolio does not
  // create two simultaneous provider bursts. The route already parallelizes
  // three tickers at a time with bounded concurrency.
  for (const chunk of chunks) {
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load market intelligence.");
    const payload = await response.json();
    Object.assign(items, payload.items ?? {});
    for (const ticker of payload.failed ?? []) failed.add(cleanTicker(ticker));
    for (const ticker of payload.partial ?? []) partial.add(cleanTicker(ticker));
    requested += Number(payload.requested ?? chunk.length);
    complete += Number(payload.complete ?? 0);
  }
  return { items, health: { requested, complete, failed: [...failed], partial: [...partial] } as MarketHealth };
}

function selectedRange(item: any, range: ChartRange) {
  const selected = item?.chartRanges?.[range];
  if (selected) return selected;
  if (range === "YTD") return { series: item?.ytdSeries ?? [], changePct: item?.ytdChangePct ?? null };
  return { series: [], changePct: null };
}

export default function HoldingsMarketMonitor({ onUpdated }: { onUpdated?: () => void }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [market, setMarket] = useState<Record<string, any>>({});
  const [marketHealth, setMarketHealth] = useState<MarketHealth | null>(null);
  const [scope, setScope] = useState<MonitorScope>("holdings");
  const [chartRange, setChartRange] = useState<ChartRange>("YTD");
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
      const hs = (p.holdings ?? []).flatMap((raw: Holding) => {
        const ticker = cleanTicker(raw.ticker);
        return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) && !raw.closed_at && Number(raw.shares) > 0
          ? [{ ...raw, ticker, shares: Number(raw.shares), avg_cost: Number(raw.avg_cost) }]
          : [];
      });
      const heldTickers = new Set(hs.map((holding: Holding) => holding.ticker));
      const ws = (w.watchlist ?? []).flatMap((raw: WatchItem) => {
        const ticker = cleanTicker(raw.ticker);
        return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) && !heldTickers.has(ticker) ? [{ ...raw, ticker }] : [];
      });
      setHoldings(hs);
      setWatchlist(ws);
      const tickers = Array.from(new Set([...hs.map((h: Holding) => h.ticker), ...ws.map((item: WatchItem) => item.ticker)]));
      if (tickers.length) {
        const result = await loadMarket(tickers);
        setMarket(result.items);
        setMarketHealth(result.health);
      } else {
        setMarket({});
        setMarketHealth({ requested: 0, complete: 0, partial: [], failed: [] });
      }
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
        body: JSON.stringify({ ticker, source: "Manual watchlist · Portfolio Monitor", reason: watchReason.trim() || "Added from Portfolio & Watchlist Market Monitor for Investment Team research." }),
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

  return <div className="card holdings-monitor-card" data-feature="holding-reconciliation ledger-edit-actions multi-range-chart">
    <div className="holdings-monitor-head">
      <div><h2 className="section" style={{ margin: 0 }}>📈 Portfolio & Watchlist Market Monitor</h2><p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Sentinel X v5.6.2 owns trend/momentum/structure; MCDX v3.3 confirms sponsored price-volume participation. Weekly decides, Daily times execution.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><span className="tag">{holdings.length} open positions</span><span className="tag">{watchlist.length} watchlist names</span></div>
    </div>

    <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
      <div className="market-monitor-tabs" role="tablist" aria-label="Market monitor scope" style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <button type="button" role="tab" aria-selected={scope === "holdings"} className={`btn ${scope === "holdings" ? "" : "ghost"} sm`} onClick={() => setScope("holdings")}>Holdings · {holdings.length}</button>
        <button type="button" role="tab" aria-selected={scope === "watchlist"} className={`btn ${scope === "watchlist" ? "" : "ghost"} sm`} onClick={() => setScope("watchlist")}>Watchlist · {watchlist.length}</button>
      </div>
      <RangeSelector value={chartRange} onChange={setChartRange}/>
    </div>

    <div className="technical-overlay-policy"><strong>{scope === "holdings" ? "TECHNICAL PORTFOLIO OVERLAY" : "TECHNICAL WATCHLIST OVERLAY"}</strong><span>{scope === "holdings" ? "ADD / HOLD / TRIM / EXIT REVIEW" : "BUY CANDIDATE / WATCH / AVOID / REMOVE"}</span><small>{scope === "holdings" ? `Price chart ${chartRange} · Technical Target ≠ Fair Value · EXIT always requires thesis/fundamental approval` : `Price chart ${chartRange} · BUY CANDIDATE is not an order · Investment must verify thesis, valuation and catalyst before committee review`}</small></div>

    {scope === "watchlist" && <section className="watchlist-manage-panel" aria-label="Add a ticker to the watchlist">
      <div><strong>ADD WATCHLIST CANDIDATE</strong><small>Search by ticker or company name. Adding here creates a research item only—not a BUY order.</small></div>
      <div className="watchlist-manage-grid"><TickerInput value={watchTicker} onChange={(value) => setWatchTicker(value.toUpperCase())} onSubmitTicker={(ticker) => setWatchTicker(ticker)} placeholder="Search ticker or company"/><input value={watchReason} onChange={(event) => setWatchReason(event.target.value)} placeholder="Research reason (optional)"/><button type="button" className="btn" disabled={watchSaving || !watchTicker.trim()} onClick={() => void addToWatchlist()}>{watchSaving ? "Adding…" : "+ Add to Watchlist"}</button></div>
    </section>}

    {marketHealth && marketHealth.requested > 0 && <div className={marketHealth.failed.length ? "err" : "notice"} style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong>MARKET DATA · {marketHealth.complete}/{marketHealth.requested} COMPLETE</strong>
          {marketHealth.partial.length > 0 && <small style={{ display: "block", marginTop: 5 }}>Partial history (&lt;220 trading days): {marketHealth.partial.join(", ")}</small>}
          {marketHealth.failed.length > 0 && <small style={{ display: "block", marginTop: 5 }}>Provider unavailable: {marketHealth.failed.join(", ")}. No signal is inferred from missing data.</small>}
        </div>
        {(marketHealth.failed.length > 0 || marketHealth.partial.length > 0) && <button type="button" className="btn ghost sm" onClick={() => void load()} disabled={loading}>{loading ? "Retrying…" : "Retry market data"}</button>}
      </div>
    </div>}

    {message && <div className={`holding-edit-message ${/reconciled|added|reduced|closed|removed/.test(message) ? "success" : "error"}`}>{message}</div>}

    {editing && <section className="holding-edit-panel" aria-label={`Edit ${editing.ticker} holding`}>
      <div className="holding-edit-title"><div><span>EDIT HOLDING · LEDGER SAFE</span><strong>{editing.ticker}</strong></div><button type="button" className="btn ghost sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</button></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{(["reconcile", "add", "reduce", "close"] as EditMode[]).map((mode) => <button key={mode} type="button" className={`btn ${editing.mode === mode ? "" : "ghost"} sm`} onClick={() => changeMode(mode)} disabled={saving}>{mode === "reconcile" ? "Reconcile" : mode === "add" ? "+ Add shares" : mode === "reduce" ? "− Reduce shares" : "Close position"}</button>)}</div>
      <div className="holding-edit-grid">
        <label><span>{editing.mode === "reconcile" ? "Broker shares" : editing.mode === "add" ? "Shares to add" : "Shares to sell"}</span><input inputMode="decimal" value={editing.shares} disabled={editing.mode === "close"} onChange={(e) => setEditing({ ...editing, shares: e.target.value })}/></label>
        {editing.mode === "reconcile" ? <label><span>Average cost</span><input inputMode="decimal" value={editing.avgCost} onChange={(e) => setEditing({ ...editing, avgCost: e.target.value })}/></label> : <label><span>{editing.mode === "add" ? "Buy price" : "Sell price"}</span><input inputMode="decimal" value={editing.tradePrice} onChange={(e) => setEditing({ ...editing, tradePrice: e.target.value })}/></label>}
        <button type="button" className="btn primary holding-save-btn" onClick={saveEdit} disabled={saving}>{saving ? "Saving…" : editing.mode === "reconcile" ? "Save corrected holding" : editing.mode === "add" ? "Record purchase" : editing.mode === "reduce" ? "Record partial sale" : "Sell all & close"}</button>
      </div>
      <p className="muted holding-edit-note">{editing.mode === "reconcile" ? "Reconciliation adjusts the opening balance and writes an audit record. It does not create a synthetic trade." : "This records the real BUY or SELL in Holdings and the trade ledger. Investment USD cash remains manually reconciled from the broker and is not changed automatically."}</p>
    </section>}

    {scope === "holdings" ? <HoldingsTable holdings={holdings} market={market} nav={nav} chartRange={chartRange} beginEdit={beginEdit}/> : <WatchlistTable watchlist={watchlist} market={market} chartRange={chartRange} pendingDelete={pendingDelete} deleting={deleting} onRequestDelete={setPendingDelete} onRemove={removeFromWatchlist}/>} 
  </div>;
}

function RangeSelector({value,onChange}:{value:ChartRange;onChange:(range:ChartRange)=>void}){
  return <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}} aria-label="Price chart range"><span className="muted" style={{fontSize:11}}>Chart</span>{CHART_RANGES.map(range=><button key={range} type="button" className={`btn ${value===range?"":"ghost"} sm`} aria-pressed={value===range} onClick={()=>onChange(range)} style={{padding:"5px 8px",minWidth:42}}>{range}</button>)}</div>;
}

function HoldingsTable({holdings,market,nav,chartRange,beginEdit}:{holdings:Holding[];market:Record<string,any>;nav:number;chartRange:ChartRange;beginEdit:(h:Holding)=>void}){
  if(!holdings.length)return <div className="notice" style={{marginTop:12}}>No open holdings are available for market monitoring.</div>;
  return <div className="table-wrap" style={{marginTop:12}}><table className="tbl holdings-market-table"><thead><tr><th>Ticker</th><th className="num">Shares</th><th className="num">Avg cost</th><th className="num">Current</th><th className="num">vs cost</th><th>Overlay action</th><th>Technical targets</th><th>Sentinel X 5.6.2</th><th>MCDX 3.3 · P/V</th><th className="num">1W</th><th>{chartRange}</th><th>52W range</th><th className="num">Weight</th><th className="num">Edit</th></tr></thead><tbody>{holdings.map(holding=>{
    const item=market[holding.ticker];const overlay=item?.technicalOverlay;const price=item?.price??null;const vs=price!=null&&holding.avg_cost>0?(price/holding.avg_cost-1)*100:null;const marketValue=(price??holding.avg_cost)*holding.shares;const weight=nav?marketValue/nav*100:0;const chart=selectedRange(item,chartRange);
    return <tr key={holding.id||holding.ticker}><td><strong>{holding.ticker}</strong><br/><span className="muted" style={{fontSize:10.5}}>{item?.asOf??"—"}</span>{item?.dataQuality?.source&&<small className="muted" style={{display:"block",fontSize:9.5}}>{item.dataQuality.source}</small>}</td><td className="num"><strong>{Number(holding.shares).toLocaleString(undefined,{maximumFractionDigits:7})}</strong></td><td className="num">{money(holding.avg_cost)}</td><td className="num"><strong>{price==null?"—":money(price)}</strong></td><td className={`num ${vs==null?"muted":vs>=0?"pos":"neg"}`}>{pc(vs)}</td><td style={{minWidth:190}}>{overlay?<><span className={`overlay-action ${overlay.action.toLowerCase().replace(" ","-")}`}>{overlay.action}</span><div className="overlay-reason">{overlay.reason}</div><small className="muted">Confidence {overlay.confidence}%</small></>:<span className="muted">{marketDataNote(item)}</span>}</td><td style={{minWidth:155}}>{overlay?<div className="overlay-targets"><span>T1 <strong>{overlay.target1==null?"—":money(overlay.target1)}</strong></span><span>T2 <strong>{overlay.target2==null?"Conditional":money(overlay.target2)}</strong></span><span>S1 <strong>{overlay.support1==null?"—":money(overlay.support1)}</strong></span><small>Room {overlay.roomAtr==null?"—":`${overlay.roomAtr.toFixed(2)} ATR`}</small></div>:"—"}</td><td style={{minWidth:190}}><SentinelCell overlay={overlay}/></td><td style={{minWidth:205}}><McdxCell overlay={overlay}/></td><td className={`num ${item?.change1w==null?"muted":item.change1w>=0?"pos":"neg"}`}>{pc(item?.change1w??null)}</td><td style={{minWidth:150}}><Spark points={chart.series??[]} positive={(chart.changePct??0)>=0} label={chartRange}/><div className={chart.changePct==null?"muted":chart.changePct>=0?"pos":"neg"} style={{fontSize:10.5,marginTop:2}}>{chartRange} {pc(chart.changePct??null)}</div></td><td style={{minWidth:210}}><PriceRange low={item?.low52??null} high={item?.high52??null} pos={item?.pos52??null} price={price}/></td><td className="num">{weight.toFixed(1)}%</td><td className="num"><button type="button" className="holding-edit-btn" onClick={()=>beginEdit(holding)}>Edit</button></td></tr>;
  })}</tbody></table></div>;
}

function WatchlistTable({watchlist,market,chartRange,pendingDelete,deleting,onRequestDelete,onRemove}:{watchlist:WatchItem[];market:Record<string,any>;chartRange:ChartRange;pendingDelete:string|null;deleting:string|null;onRequestDelete:(id:string|null)=>void;onRemove:(watch:WatchItem)=>Promise<void>}){
  if(!watchlist.length)return <div className="notice" style={{marginTop:12}}>No watchlist-only names. Use the search above to add a research candidate.</div>;
  return <div className="table-wrap" style={{marginTop:12}}><table className="tbl holdings-market-table watchlist-market-table"><thead><tr><th>Ticker</th><th>Research source</th><th className="num">Current</th><th>Watchlist decision</th><th>Technical targets</th><th>Sentinel X 5.6.2</th><th>MCDX 3.3 · P/V</th><th className="num">1W</th><th>{chartRange}</th><th>52W range</th><th>Manage</th></tr></thead><tbody>{watchlist.map(watch=>{
    const item=market[watch.ticker];const overlay=item?.technicalOverlay;const price=item?.price??null;const decision=overlay?WATCHLIST_ACTIONS[overlay.action]??WATCHLIST_ACTIONS.HOLD:null;const confirming=pendingDelete===watch.id;const chart=selectedRange(item,chartRange);
    return <tr key={watch.id||watch.ticker}><td><strong>{watch.ticker}</strong><br/><span className="muted" style={{fontSize:10.5}}>{item?.asOf??"—"}</span>{item?.dataQuality?.source&&<small className="muted" style={{display:"block",fontSize:9.5}}>{item.dataQuality.source}</small>}</td><td style={{minWidth:190}}><strong>{watch.source??"Manual watchlist"}</strong><div className="overlay-reason">{watch.reason??"Awaiting Investment research brief."}</div>{watch.entry_price!=null&&<small className="muted">Reference entry {money(Number(watch.entry_price))}</small>}</td><td className="num"><strong>{price==null?"—":money(price)}</strong></td><td style={{minWidth:210}}>{overlay&&decision?<><span className={`overlay-action ${decision.className}`}>{decision.label}</span><div className="overlay-reason">{watchlistReason(overlay.action,overlay.reason)}</div><small className="muted">Technical confidence {overlay.confidence}%</small></>:<span className="muted">{marketDataNote(item)}</span>}</td><td style={{minWidth:175}}>{overlay?<div className="overlay-targets"><span>T1 <strong>{overlay.target1==null?"—":money(overlay.target1)}</strong></span><span>T2 <strong>{overlay.target2==null?"Conditional":money(overlay.target2)}</strong></span><span>S1 <strong>{overlay.support1==null?"—":money(overlay.support1)}</strong></span><small>Room {overlay.roomAtr==null?"—":`${overlay.roomAtr.toFixed(2)} ATR`}</small></div>:"—"}</td><td style={{minWidth:190}}><SentinelCell overlay={overlay}/></td><td style={{minWidth:205}}><McdxCell overlay={overlay}/></td><td className={`num ${item?.change1w==null?"muted":item.change1w>=0?"pos":"neg"}`}>{pc(item?.change1w??null)}</td><td style={{minWidth:150}}><Spark points={chart.series??[]} positive={(chart.changePct??0)>=0} label={chartRange}/><div className={chart.changePct==null?"muted":chart.changePct>=0?"pos":"neg"} style={{fontSize:10.5,marginTop:2}}>{chartRange} {pc(chart.changePct??null)}</div></td><td style={{minWidth:210}}><PriceRange low={item?.low52??null} high={item?.high52??null} pos={item?.pos52??null} price={price}/></td><td><div className="watchlist-remove-actions">{confirming?<><button type="button" className="btn danger sm" disabled={deleting===watch.id} onClick={()=>void onRemove(watch)}>{deleting===watch.id?"Removing…":"Confirm remove"}</button><button type="button" className="btn ghost sm" disabled={deleting===watch.id} onClick={()=>onRequestDelete(null)}>Cancel</button></>:<button type="button" className="btn ghost sm" onClick={()=>onRequestDelete(watch.id)}>Remove</button>}</div></td></tr>;
  })}</tbody></table></div>;
}

function SentinelCell({overlay}:{overlay:any}){
  if(!overlay)return <>—</>;
  const s=overlay.sentinel;
  const trigger=s.trigger&&s.trigger!=="NONE"?s.trigger.replaceAll("_"," "):null;
  return <div className="overlay-signals"><strong className={s.trend==="BULL"?"pos":s.trend==="BEAR"?"neg":""}>{s.coreState??s.trend}</strong><span>D {s.dailyScore} · W {s.weeklyScore} · Strength {s.momentumStrength??"—"}</span><small>RSI {s.rsi??"—"} / SMA {s.rsiSma??"—"} · {s.structurePattern??s.structure}</small><small>{trigger?`Trigger ${trigger}`:`${s.regime??"BALANCED"} · HMA16 ${s.hma16State??"—"}`}</small></div>;
}

function McdxCell({overlay}:{overlay:any}){
  if(!overlay)return <>—</>;
  const m=overlay.mcdx;
  const sponsor=String(m.sponsor??"NONE").replaceAll("_"," ");
  const flow=String(m.flowSignal??"MIXED").replaceAll("_"," ");
  return <div className="overlay-signals"><strong className={m.state==="ACCUMULATION"?"pos":m.state==="DISTRIBUTION"?"neg":""}>{m.state}</strong><span>Flow {m.smartFlow} · Context {m.contextScore} · Signal {m.flowSignalValue??"—"}</span><small>Smart {m.smartMoneyProxy} · Hot {m.hotMoneyProxy??"—"} · Retail {m.retailProxy??"—"}</small><small>{sponsor} · {flow} · PRICE/VOLUME PROXY</small></div>;
}

function watchlistReason(action:string,reason:string){
  if(action==="ADD")return `${reason} Send to Investment for thesis, valuation and catalyst verification before presentation.`;
  if(action==="HOLD")return "No qualified entry yet; keep monitoring trend, flow and Target 1 room.";
  if(action==="TRIM")return "Entry quality is currently unfavorable; wait for risk/reward and accumulation to improve.";
  return "Bearish trend/distribution requires Research to review whether this name should remain on the watchlist.";
}

function marketDataNote(item:any){
  return item?.dataQuality?.reason ?? "Market data unavailable. Use Retry market data; no technical decision is inferred.";
}

function Spark({points,positive,label}:{points:any[];positive:boolean;label:string}){
  if(points.length<2)return <span className="muted">—</span>;
  const values=points.map(p=>Number(p.close)).filter(Number.isFinite);if(values.length<2)return <span className="muted">—</span>;
  const low=Math.min(...values),high=Math.max(...values),width=140,height=36,span=Math.max(.0001,high-low);
  const path=values.map((v,i)=>`${i?"L":"M"}${i/(values.length-1)*width},${height-(v-low)/span*height}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label} price sparkline`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2" className={positive?"pos":"neg"}/></svg>;
}

function PriceRange({low,high,pos,price}:{low:number|null;high:number|null;pos:number|null;price:number|null}){
  return <div><div style={{display:"flex",justifyContent:"space-between",fontSize:10.5}}><span className="muted">{low==null?"—":money(low)}</span><strong>{pos==null?"—":`${pos.toFixed(0)}%`}</strong><span className="muted">{high==null?"—":money(high)}</span></div><div style={{height:7,borderRadius:999,background:"rgba(255,255,255,.08)",position:"relative",marginTop:6}}>{pos!=null&&<span style={{position:"absolute",left:`calc(${pos}% - 5px)`,top:-2,width:11,height:11,borderRadius:"50%",background:"currentColor"}}/>}</div><div className="muted" style={{fontSize:10,marginTop:4}}>{price==null?"No current price":pos==null?"52W history unavailable":pos>=85?"Near 52W high":pos<=15?"Near 52W low":"Inside 52W range"}</div></div>;
}
