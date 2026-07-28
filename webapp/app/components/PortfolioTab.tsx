"use client";
import { useEffect, useState, useCallback } from "react";
import { money, num, pct, cls } from "./format";

interface Holding { id: string; ticker: string; shares: number; avg_cost: number; thesis?: string; target_price?: number | null; }
interface WatchItem { id: string; ticker: string; reason?: string; alert_price?: number | null; }

export default function PortfolioTab() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, { price: number; changePercent: number } | null>>({});
  const [backend, setBackend] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w] = await Promise.all([
      fetch("/api/portfolio").then((r) => r.json()),
      fetch("/api/watchlist").then((r) => r.json()),
    ]);
    setHoldings(p.holdings ?? []);
    setWatch(w.watchlist ?? []);
    setBackend(p.backend ?? "");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refreshQuotes = useCallback(async () => {
    const tickers = Array.from(new Set([...holdings.map((h) => h.ticker), ...watch.map((w) => w.ticker)]));
    if (!tickers.length) return;
    const res = await fetch(`/api/quote?tickers=${tickers.join(",")}`).then((r) => r.json());
    setQuotes(res.quotes ?? {});
  }, [holdings, watch]);

  useEffect(() => { if (holdings.length || watch.length) refreshQuotes(); }, [holdings.length, watch.length]); // eslint-disable-line

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

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 className="section" style={{ margin: 0 }}>💼 Portfolio Holdings</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <span className="tag">store: {backend || "…"}</span>
            <button className="btn ghost sm" onClick={refreshQuotes}>↻ Refresh prices</button>
          </div>
        </div>
        <HoldingForm onAdd={load} />
        {loading ? <p className="muted">Loading…</p> : (
          <table className="tbl" style={{ marginTop: 12 }}>
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
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="section">⭐ Watchlist</h2>
        <WatchForm onAdd={load} />
        <table className="tbl" style={{ marginTop: 12 }}>
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
        </table>
      </div>
    </div>
  );
}

function HoldingForm({ onAdd }: { onAdd: () => void }) {
  const [f, setF] = useState({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="searchbar"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.ticker) return;
        setBusy(true);
        await fetch("/api/portfolio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        setF({ ticker: "", shares: "", avg_cost: "", target_price: "", thesis: "" });
        setBusy(false);
        onAdd();
      }}
    >
      <input className="input-ticker" placeholder="TICKER" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} maxLength={10} />
      <input placeholder="Shares" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} style={{ width: 90 }} />
      <input placeholder="Avg cost" value={f.avg_cost} onChange={(e) => setF({ ...f, avg_cost: e.target.value })} style={{ width: 100 }} />
      <input placeholder="Target" value={f.target_price} onChange={(e) => setF({ ...f, target_price: e.target.value })} style={{ width: 90 }} />
      <input placeholder="Thesis / notes" value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn" disabled={busy}>{busy ? "…" : "Add holding"}</button>
    </form>
  );
}

function WatchForm({ onAdd }: { onAdd: () => void }) {
  const [f, setF] = useState({ ticker: "", alert_price: "", reason: "" });
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="searchbar"
      style={{ marginTop: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f.ticker) return;
        setBusy(true);
        await fetch("/api/watchlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
        setF({ ticker: "", alert_price: "", reason: "" });
        setBusy(false);
        onAdd();
      }}
    >
      <input className="input-ticker" placeholder="TICKER" value={f.ticker} onChange={(e) => setF({ ...f, ticker: e.target.value })} maxLength={10} />
      <input placeholder="Alert price" value={f.alert_price} onChange={(e) => setF({ ...f, alert_price: e.target.value })} style={{ width: 110 }} />
      <input placeholder="Why watching?" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} style={{ flex: 1, minWidth: 160 }} />
      <button className="btn" disabled={busy}>{busy ? "…" : "Add"}</button>
    </form>
  );
}
