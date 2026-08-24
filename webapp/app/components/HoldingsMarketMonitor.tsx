"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "./format";
import TickerInput from "./TickerInput";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type WatchItem = { id: string; ticker: string; reason?: string | null; source?: string | null; entry_price?: number | null };
type EditMode = "reconcile" | "add" | "reduce" | "close";
type EditState = { id: string; ticker: string; heldShares: number; mode: EditMode; shares: string; avgCost: string; tradePrice: string };
type Scope = "holdings" | "watchlist";
type ChartRange = "1M" | "3M" | "6M" | "YTD" | "1Y";
type MarketHealth = { requested: number; complete: number; partial: string[]; failed: string[] };

const RANGES: ChartRange[] = ["1M", "3M", "6M", "YTD", "1Y"];
const pc = (v: number | null) => v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

function actionClass(action: string) {
  if (action === "ADD") return "add";
  if (action === "PROFIT WATCH" || action === "HOLD") return "hold";
  if (action === "TRIM REVIEW") return "trim";
  return "exit-review";
}

function watchlistDecision(action: string) {
  if (action === "ADD") return { label: "BUY CANDIDATE", className: "add" };
  if (action === "PROFIT WATCH") return { label: "WATCH · EXTENDED", className: "hold" };
  if (action === "TRIM REVIEW") return { label: "AVOID NEW BUY", className: "trim" };
  if (action === "EXIT REVIEW") return { label: "REMOVE REVIEW", className: "exit-review" };
  return { label: "WATCH", className: "hold" };
}

async function loadMarket(tickers: string[]) {
  const items: Record<string, any> = {};
  const failed = new Set<string>();
  const partial = new Set<string>();
  let requested = 0;
  let complete = 0;
  for (let index = 0; index < tickers.length; index += 25) {
    const chunk = tickers.slice(index, index + 25);
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
  return item?.chartRanges?.[range] ?? (range === "YTD"
    ? { series: item?.ytdSeries ?? [], changePct: item?.ytdChangePct ?? null }
    : { series: [], changePct: null });
}

export default function HoldingsMarketMonitor({ onUpdated }: { onUpdated?: () => void }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watchlist, setWatchlist] = useState<WatchItem[]>([]);
  const [market, setMarket] = useState<Record<string, any>>({});
  const [marketHealth, setMarketHealth] = useState<MarketHealth | null>(null);
  const [scope, setScope] = useState<Scope>("holdings");
  const [range, setRange] = useState<ChartRange>("YTD");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [watchTicker, setWatchTicker] = useState("");
  const [watchReason, setWatchReason] = useState("");
  const [watchSaving, setWatchSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [portfolioResponse, watchResponse] = await Promise.all([
        fetch("/api/portfolio", { cache: "no-store" }),
        fetch("/api/watchlist", { cache: "no-store" }),
      ]);
      const [portfolio, watch] = await Promise.all([portfolioResponse.json(), watchResponse.json()]);
      if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Unable to load holdings.");
      if (!watchResponse.ok) throw new Error(watch?.error ?? "Unable to load watchlist.");

      const hs: Holding[] = (portfolio?.holdings ?? []).flatMap((raw: Holding) => {
        const ticker = cleanTicker(raw.ticker);
        return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) && !raw.closed_at && Number(raw.shares) > 0
          ? [{ ...raw, ticker, shares: Number(raw.shares), avg_cost: Number(raw.avg_cost) }]
          : [];
      });
      const held = new Set(hs.map(row => row.ticker));
      const ws: WatchItem[] = (watch?.watchlist ?? []).flatMap((raw: WatchItem) => {
        const ticker = cleanTicker(raw.ticker);
        return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(ticker) && !held.has(ticker) ? [{ ...raw, ticker }] : [];
      });
      setHoldings(hs);
      setWatchlist(ws);
      const tickers = Array.from(new Set([...hs.map(row => row.ticker), ...ws.map(row => row.ticker)]));
      const result = tickers.length ? await loadMarket(tickers) : { items: {}, health: { requested: 0, complete: 0, failed: [], partial: [] } };
      setMarket(result.items);
      setMarketHealth(result.health);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to load market monitor.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const nav = useMemo(() => holdings.reduce((sum, row) => sum + (market[row.ticker]?.price ?? row.avg_cost) * row.shares, 0), [holdings, market]);

  const beginEdit = (holding: Holding, mode: EditMode = "reconcile") => {
    const live = market[holding.ticker]?.price ?? holding.avg_cost;
    setEditing({ id: holding.id, ticker: holding.ticker, heldShares: Number(holding.shares), mode, shares: mode === "close" ? String(holding.shares) : mode === "reconcile" ? String(holding.shares) : "", avgCost: String(holding.avg_cost), tradePrice: String(live) });
    setMessage(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const shares = Number(editing.shares), avgCost = Number(editing.avgCost), tradePrice = Number(editing.tradePrice);
    if (!Number.isFinite(shares) || shares <= 0) return setMessage("Shares must be greater than zero.");
    if (editing.mode === "reconcile" && (!Number.isFinite(avgCost) || avgCost < 0)) return setMessage("Average cost must be zero or greater.");
    if (editing.mode !== "reconcile" && (!Number.isFinite(tradePrice) || tradePrice < 0)) return setMessage("Trade price must be zero or greater.");
    if (["reduce", "close"].includes(editing.mode) && shares > editing.heldShares + 1e-7) return setMessage(`Cannot sell more than ${editing.heldShares} shares.`);
    setSaving(true);
    try {
      const reconcile = editing.mode === "reconcile";
      const response = await fetch("/api/portfolio", {
        method: reconcile ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reconcile
          ? { id: editing.id, shares, avg_cost: avgCost }
          : { action: editing.mode === "add" ? "buy" : "sell", ticker: editing.ticker, shares, avg_cost: tradePrice, transaction_date: today(), notes: `Holdings Edit: ${editing.mode.toUpperCase()}` }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update holding.");
      setMessage(`${editing.ticker} updated successfully.`);
      setEditing(null);
      await load();
      onUpdated?.();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to update holding.");
    } finally { setSaving(false); }
  };

  const addWatch = async () => {
    const ticker = cleanTicker(watchTicker);
    if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return setMessage("Choose a valid ticker before adding it.");
    if (holdings.some(row => row.ticker === ticker) || watchlist.some(row => row.ticker === ticker)) return setMessage(`${ticker} is already tracked.`);
    setWatchSaving(true);
    try {
      const response = await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker, source: "Manual watchlist · Portfolio Monitor", reason: watchReason.trim() || "Added for Investment research." }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to add watchlist ticker.");
      setWatchTicker(""); setWatchReason(""); setMessage(`${ticker} added to Watchlist.`); await load(); onUpdated?.();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to add Watchlist ticker."); }
    finally { setWatchSaving(false); }
  };

  const removeWatch = async (watch: WatchItem) => {
    setDeleting(watch.id);
    try {
      const response = await fetch(`/api/watchlist?id=${encodeURIComponent(watch.id)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to remove ticker.");
      setPendingDelete(null); setMessage(`${watch.ticker} removed from Watchlist.`); await load(); onUpdated?.();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Unable to remove ticker."); }
    finally { setDeleting(null); }
  };

  if (loading) return <div className="card"><span className="spinner" /> Loading unified technical intelligence…</div>;

  return <div className="card holdings-monitor-card" data-feature="unified-technical-v34 holding-reconciliation watchlist-management">
    <div className="holdings-monitor-head">
      <div><h2 className="section" style={{ margin: 0 }}>📈 Portfolio & Watchlist Market Monitor</h2><p className="muted" style={{ fontSize: 12, marginTop: 6 }}>V34 uses one policy everywhere: Trend (Sentinel X) → Flow (MCDX) → Location (ATR room) → Action. Location alone never forces a trim.</p></div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><span className="tag">{holdings.length} open positions</span><span className="tag">{watchlist.length} watchlist names</span><span className="tag">UNIFIED V34</span></div>
    </div>

    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8 }}><button className={`btn ${scope === "holdings" ? "" : "ghost"} sm`} onClick={() => setScope("holdings")}>Holdings · {holdings.length}</button><button className={`btn ${scope === "watchlist" ? "" : "ghost"} sm`} onClick={() => setScope("watchlist")}>Watchlist · {watchlist.length}</button></div>
      <RangeSelector value={range} onChange={setRange}/>
    </div>

    <div className="technical-overlay-policy"><strong>V34 · TREND → FLOW → LOCATION → ACTION</strong><span>{scope === "holdings" ? "ADD / HOLD / PROFIT WATCH / TRIM REVIEW / EXIT REVIEW" : "BUY CANDIDATE / WATCH / AVOID / REMOVE REVIEW"}</span><small>Technical Target ≠ Fair Value · PROFIT WATCH is not a sell · EXIT REVIEW still requires thesis/fundamental approval.</small></div>

    {scope === "watchlist" && <section className="watchlist-manage-panel"><div><strong>ADD WATCHLIST CANDIDATE</strong><small>Creates a research item only—not an order.</small></div><div className="watchlist-manage-grid"><TickerInput value={watchTicker} onChange={value => setWatchTicker(value.toUpperCase())} onSubmitTicker={ticker => setWatchTicker(ticker)} placeholder="Search ticker or company"/><input value={watchReason} onChange={e => setWatchReason(e.target.value)} placeholder="Research reason (optional)"/><button className="btn" disabled={watchSaving || !watchTicker.trim()} onClick={() => void addWatch()}>{watchSaving ? "Adding…" : "+ Add to Watchlist"}</button></div></section>}

    {marketHealth && marketHealth.requested > 0 && <div className={marketHealth.failed.length ? "err" : "notice"} style={{ marginTop: 12 }}><strong>MARKET DATA · {marketHealth.complete}/{marketHealth.requested} COMPLETE</strong>{marketHealth.partial.length > 0 && <small style={{ display: "block" }}>Partial: {marketHealth.partial.join(", ")}</small>}{marketHealth.failed.length > 0 && <small style={{ display: "block" }}>Unavailable: {marketHealth.failed.join(", ")} · no signal inferred from missing data.</small>}</div>}
    {message && <div className="notice" style={{ marginTop: 12 }}>{message}</div>}

    {editing && <section className="holding-edit-panel"><div className="holding-edit-title"><div><span>EDIT HOLDING · LEDGER SAFE</span><strong>{editing.ticker}</strong></div><button className="btn ghost sm" onClick={() => setEditing(null)}>Cancel</button></div><div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>{(["reconcile", "add", "reduce", "close"] as EditMode[]).map(mode => <button key={mode} className={`btn ${editing.mode === mode ? "" : "ghost"} sm`} disabled={saving} onClick={() => setEditing({ ...editing, mode, shares: mode === "close" ? String(editing.heldShares) : mode === "reconcile" ? String(editing.heldShares) : "" })}>{mode}</button>)}</div><div className="holding-edit-grid"><label><span>Shares</span><input inputMode="decimal" value={editing.shares} disabled={editing.mode === "close"} onChange={e => setEditing({ ...editing, shares: e.target.value })}/></label>{editing.mode === "reconcile" ? <label><span>Average cost</span><input inputMode="decimal" value={editing.avgCost} onChange={e => setEditing({ ...editing, avgCost: e.target.value })}/></label> : <label><span>Trade price</span><input inputMode="decimal" value={editing.tradePrice} onChange={e => setEditing({ ...editing, tradePrice: e.target.value })}/></label>}<button className="btn primary" disabled={saving} onClick={() => void saveEdit()}>{saving ? "Saving…" : "Save"}</button></div></section>}

    {scope === "holdings"
      ? <HoldingsTable holdings={holdings} market={market} nav={nav} range={range} onEdit={beginEdit}/>
      : <WatchlistTable watchlist={watchlist} market={market} range={range} pendingDelete={pendingDelete} deleting={deleting} onRequestDelete={setPendingDelete} onRemove={removeWatch}/>} 
  </div>;
}

function RangeSelector({ value, onChange }: { value: ChartRange; onChange: (range: ChartRange) => void }) {
  return <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}><span className="muted" style={{ fontSize: 11 }}>Chart</span>{RANGES.map(range => <button key={range} className={`btn ${value === range ? "" : "ghost"} sm`} onClick={() => onChange(range)}>{range}</button>)}</div>;
}

function HoldingsTable({ holdings, market, nav, range, onEdit }: { holdings: Holding[]; market: Record<string, any>; nav: number; range: ChartRange; onEdit: (h: Holding) => void }) {
  if (!holdings.length) return <div className="notice" style={{ marginTop: 12 }}>No open holdings.</div>;
  return <div className="table-wrap" style={{ marginTop: 12 }}><table className="tbl holdings-market-table"><thead><tr><th>Ticker</th><th className="num">Current</th><th>V34 Unified Decision</th><th>Targets</th><th>{range}</th><th className="num">Weight</th><th>Edit</th></tr></thead><tbody>{holdings.map(row => {
    const item = market[row.ticker], overlay = item?.technicalOverlay, price = item?.price ?? null, chart = selectedRange(item, range);
    const value = (price ?? row.avg_cost) * row.shares, weight = nav ? value / nav * 100 : 0;
    return <tr key={row.id || row.ticker}><td><strong>{row.ticker}</strong><small className="muted" style={{ display: "block" }}>{row.shares.toLocaleString(undefined, { maximumFractionDigits: 7 })} sh · cost {money(row.avg_cost)}</small></td><td className="num"><strong>{price == null ? "—" : money(price)}</strong><small className="muted" style={{ display: "block" }}>1W {pc(item?.change1w ?? null)}</small></td><td style={{ minWidth: 300 }}><UnifiedCell overlay={overlay}/></td><td style={{ minWidth: 145 }}><Targets overlay={overlay}/></td><td style={{ minWidth: 150 }}><Spark points={chart.series ?? []}/><small className={chart.changePct == null ? "muted" : chart.changePct >= 0 ? "pos" : "neg"}>{range} {pc(chart.changePct ?? null)}</small></td><td className="num">{weight.toFixed(1)}%</td><td><button className="holding-edit-btn" onClick={() => onEdit(row)}>Edit</button></td></tr>;
  })}</tbody></table></div>;
}

function WatchlistTable({ watchlist, market, range, pendingDelete, deleting, onRequestDelete, onRemove }: { watchlist: WatchItem[]; market: Record<string, any>; range: ChartRange; pendingDelete: string | null; deleting: string | null; onRequestDelete: (id: string | null) => void; onRemove: (watch: WatchItem) => Promise<void> }) {
  if (!watchlist.length) return <div className="notice" style={{ marginTop: 12 }}>No watchlist-only names.</div>;
  return <div className="table-wrap" style={{ marginTop: 12 }}><table className="tbl holdings-market-table"><thead><tr><th>Ticker</th><th className="num">Current</th><th>Watchlist Decision</th><th>V34 Technical</th><th>Targets</th><th>{range}</th><th>Manage</th></tr></thead><tbody>{watchlist.map(row => {
    const item = market[row.ticker], overlay = item?.technicalOverlay, price = item?.price ?? null, chart = selectedRange(item, range), presentation = watchlistDecision(overlay?.action ?? "HOLD");
    return <tr key={row.id || row.ticker}><td><strong>{row.ticker}</strong><small className="muted" style={{ display: "block" }}>{row.source ?? "Watchlist"}</small></td><td className="num"><strong>{price == null ? "—" : money(price)}</strong></td><td><span className={`overlay-action ${presentation.className}`}>{presentation.label}</span><div className="overlay-reason">{watchReason(overlay)}</div></td><td style={{ minWidth: 300 }}><UnifiedCell overlay={overlay}/></td><td><Targets overlay={overlay}/></td><td><Spark points={chart.series ?? []}/><small className={chart.changePct == null ? "muted" : chart.changePct >= 0 ? "pos" : "neg"}>{pc(chart.changePct ?? null)}</small></td><td>{pendingDelete === row.id ? <><button className="btn danger sm" disabled={deleting === row.id} onClick={() => void onRemove(row)}>{deleting === row.id ? "Removing…" : "Confirm"}</button><button className="btn ghost sm" onClick={() => onRequestDelete(null)}>Cancel</button></> : <button className="btn ghost sm" onClick={() => onRequestDelete(row.id)}>Remove</button>}</td></tr>;
  })}</tbody></table></div>;
}

function UnifiedCell({ overlay }: { overlay: any }) {
  if (!overlay) return <span className="muted">Technical evidence unavailable.</span>;
  const d = overlay.decision ?? { action: overlay.action, trendLabel: overlay.sentinel?.coreState, flowLabel: overlay.mcdx?.state, location: "UNKNOWN", summary: overlay.reason };
  return <div><span className={`overlay-action ${actionClass(d.action)}`}>{d.action}</span><div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}><span className="tag">TREND · {d.trendLabel}</span><span className="tag">FLOW · {d.flowLabel}</span><span className="tag">LOCATION · {d.location}</span></div><div className="overlay-reason">{d.summary}</div><small className="muted">Confidence {overlay.confidence}% · Policy V34</small><details style={{ marginTop: 7 }}><summary className="muted" style={{ cursor: "pointer", fontSize: 11 }}>Technical details</summary><div className="overlay-signals" style={{ marginTop: 6 }}><span>Sentinel D {overlay.sentinel?.dailyScore} · W {overlay.sentinel?.weeklyScore} · Strength {overlay.sentinel?.momentumStrength}</span><small>RSI {overlay.sentinel?.rsi} / SMA {overlay.sentinel?.rsiSma} · {overlay.sentinel?.structurePattern} · {overlay.sentinel?.trigger}</small><span>MCDX Flow {overlay.mcdx?.smartFlow} · Context {overlay.mcdx?.contextScore}</span><small>Smart {overlay.mcdx?.smartMoneyProxy} · Hot {overlay.mcdx?.hotMoneyProxy} · Retail {overlay.mcdx?.retailProxy} · PRICE/VOLUME PROXY</small></div></details></div>;
}

function Targets({ overlay }: { overlay: any }) {
  if (!overlay) return <>—</>;
  return <div className="overlay-targets"><span>T1 <strong>{overlay.target1 == null ? "—" : money(overlay.target1)}</strong></span><span>T2 <strong>{overlay.target2 == null ? "Conditional" : money(overlay.target2)}</strong></span><span>S1 <strong>{overlay.support1 == null ? "—" : money(overlay.support1)}</strong></span><small>{overlay.decision?.location ?? "UNKNOWN"} · {overlay.roomAtr == null ? "—" : `${overlay.roomAtr.toFixed(2)} ATR`}</small></div>;
}

function watchReason(overlay: any) {
  if (!overlay) return "No measurable technical decision yet.";
  if (overlay.action === "ADD") return "Technically qualified for INV review; thesis, valuation and catalyst must still pass.";
  if (overlay.action === "PROFIT WATCH") return "Trend may remain healthy, but location is extended/near target. Do not chase a new entry.";
  if (overlay.action === "TRIM REVIEW") return "Multiple risk signals are clustering; avoid a new entry until trend/flow/location improve.";
  if (overlay.action === "EXIT REVIEW") return "Bearish evidence requires Research to review whether this name should remain on Watchlist.";
  return "Trend, flow and location are not aligned enough for a new entry yet.";
}

function Spark({ points }: { points: any[] }) {
  if (!points || points.length < 2) return <span className="muted">—</span>;
  const values = points.map(row => Number(row.close)).filter(Number.isFinite);
  if (values.length < 2) return <span className="muted">—</span>;
  const low = Math.min(...values), high = Math.max(...values), span = Math.max(.0001, high - low), width = 140, height = 36;
  const path = values.map((value, index) => `${index ? "L" : "M"}${index / (values.length - 1) * width},${height - (value - low) / span * height}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}><path d={path} fill="none" stroke="currentColor" strokeWidth="2"/></svg>;
}
