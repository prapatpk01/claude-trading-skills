"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "./format";

type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type EditMode = "reconcile" | "add" | "reduce" | "close";
type EditState = { id: string; ticker: string; heldShares: number; mode: EditMode; shares: string; avgCost: string; tradePrice: string };

const pc = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
const today = () => new Date().toISOString().slice(0, 10);

export default function HoldingsMarketMonitor({ onUpdated }: { onUpdated?: () => void }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [market, setMarket] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/portfolio", { cache: "no-store" });
      const p = await response.json();
      if (!response.ok) throw new Error(p.error || "Unable to load holdings.");
      const hs = (p.holdings ?? []).filter((h: Holding) => !h.closed_at && Number(h.shares) > 0);
      setHoldings(hs);
      const tickers = Array.from(new Set(hs.map((h: Holding) => h.ticker)));
      if (tickers.length) {
        const m = await fetch(`/api/holding-market?tickers=${encodeURIComponent(tickers.join(","))}`, { cache: "no-store" }).then((r) => r.json());
        setMarket(m.items ?? {});
      } else setMarket({});
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

  if (loading) return <div className="card"><span className="spinner" /> Loading holdings market intelligence…</div>;
  if (!holdings.length) return <div className="card"><div className="notice">No open positions. Use Record Buy / Sell Transaction to add a holding.</div></div>;

  return <div className="card holdings-monitor-card" data-feature="holding-reconciliation ledger-edit-actions">
    <div className="holdings-monitor-head"><div><h2 className="section" style={{ margin: 0 }}>📈 Holdings Market Monitor</h2><p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Edit can reconcile broker data or record real Add, Reduce and Close transactions. Transaction actions always write to the Trade Ledger.</p></div><span className="tag">{holdings.length} open positions</span></div>
    {message && <div className={`holding-edit-message ${/reconciled|added|reduced|closed/.test(message) ? "success" : "error"}`}>{message}</div>}

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

    <div className="table-wrap" style={{ marginTop: 12 }}><table className="tbl holdings-market-table"><thead><tr><th>Ticker</th><th className="num">Shares</th><th className="num">Avg cost</th><th className="num">Current</th><th className="num">vs cost</th><th className="num">1W</th><th>YTD</th><th>52W range</th><th className="num">Weight</th><th className="num">Edit</th></tr></thead><tbody>
      {holdings.map((holding) => { const item = market[holding.ticker]; const price = item?.price ?? null; const vs = price != null && holding.avg_cost > 0 ? (price / holding.avg_cost - 1) * 100 : null; const marketValue = (price ?? holding.avg_cost) * holding.shares; const weight = nav ? marketValue / nav * 100 : 0; return <tr key={holding.id || holding.ticker}><td><strong>{holding.ticker}</strong><br/><span className="muted" style={{ fontSize: 10.5 }}>{item?.asOf ?? "—"}</span></td><td className="num"><strong>{Number(holding.shares).toLocaleString(undefined,{maximumFractionDigits:7})}</strong></td><td className="num">{money(holding.avg_cost)}</td><td className="num"><strong>{price == null ? "—" : money(price)}</strong></td><td className={`num ${vs == null ? "muted" : vs >= 0 ? "pos" : "neg"}`}>{pc(vs)}</td><td className={`num ${item?.change1w == null ? "muted" : item.change1w >= 0 ? "pos" : "neg"}`}>{pc(item?.change1w ?? null)}</td><td style={{minWidth:150}}><Spark points={item?.ytdSeries ?? []} positive={(item?.ytdChangePct ?? 0)>=0}/><div className={item?.ytdChangePct == null ? "muted" : item.ytdChangePct >= 0 ? "pos" : "neg"} style={{fontSize:10.5,marginTop:2}}>YTD {pc(item?.ytdChangePct ?? null)}</div></td><td style={{minWidth:210}}><Range low={item?.low52 ?? null} high={item?.high52 ?? null} pos={item?.pos52 ?? null} price={price}/></td><td className="num">{weight.toFixed(1)}%</td><td className="num"><button type="button" className="holding-edit-btn" onClick={() => beginEdit(holding)}>Edit</button></td></tr>; })}
    </tbody></table></div>
  </div>;
}

function Spark({ points, positive }: { points: any[]; positive: boolean }) { if (points.length < 2) return <span className="muted">—</span>; const values=points.map(p=>p.close); const low=Math.min(...values), high=Math.max(...values), width=140, height=36, span=Math.max(.0001,high-low); const path=values.map((v,i)=>`${i?"L":"M"}${i/(values.length-1)*width},${height-(v-low)/span*height}`).join(" "); return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="YTD price sparkline"><path d={path} fill="none" stroke="currentColor" strokeWidth="2" className={positive?"pos":"neg"}/></svg>; }
function Range({ low, high, pos, price }: { low:number|null; high:number|null; pos:number|null; price:number|null }) { return <div><div style={{display:"flex",justifyContent:"space-between",fontSize:10.5}}><span className="muted">{low==null?"—":money(low)}</span><strong>{pos==null?"—":`${pos.toFixed(0)}%`}</strong><span className="muted">{high==null?"—":money(high)}</span></div><div style={{height:7,borderRadius:999,background:"rgba(255,255,255,.08)",position:"relative",marginTop:6}}>{pos!=null&&<span style={{position:"absolute",left:`calc(${pos}% - 5px)`,top:-2,width:11,height:11,borderRadius:"50%",background:"currentColor"}}/>}</div><div className="muted" style={{fontSize:10,marginTop:4}}>{price==null?"No current price":pos==null?"52W history unavailable":pos>=85?"Near 52W high":pos<=15?"Near 52W low":"Inside 52W range"}</div></div>; }
