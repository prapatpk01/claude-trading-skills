"use client";

import { useEffect, useMemo, useState } from "react";
import { money } from "./format";

type Holding = {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number;
  closed_at?: string | null;
};

type EditState = {
  id: string;
  ticker: string;
  shares: string;
  avgCost: string;
};

const pc = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

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
      const p = await fetch("/api/portfolio", { cache: "no-store" }).then((r) => r.json());
      const hs = (p.holdings ?? []).filter((h: Holding) => !h.closed_at);
      setHoldings(hs);
      const tickers = Array.from(new Set(hs.map((h: Holding) => h.ticker)));
      if (tickers.length) {
        const m = await fetch(`/api/holding-market?tickers=${encodeURIComponent(tickers.join(","))}`, { cache: "no-store" }).then((r) => r.json());
        setMarket(m.items ?? {});
      } else {
        setMarket({});
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const nav = useMemo(
    () => holdings.reduce((sum, holding) => sum + (market[holding.ticker]?.price ?? holding.avg_cost) * holding.shares, 0),
    [holdings, market],
  );

  const beginEdit = (holding: Holding) => {
    setMessage(null);
    setEditing({
      id: holding.id,
      ticker: holding.ticker,
      shares: String(holding.shares),
      avgCost: String(holding.avg_cost),
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    const shares = Number(editing.shares);
    const avgCost = Number(editing.avgCost);
    if (!Number.isFinite(shares) || shares <= 0) {
      setMessage("Shares must be greater than zero.");
      return;
    }
    if (!Number.isFinite(avgCost) || avgCost < 0) {
      setMessage("Average cost must be zero or greater.");
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/portfolio", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editing.id, shares, avg_cost: avgCost }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Unable to update holding.");
      setEditing(null);
      setMessage(`${editing.ticker} updated to ${shares} shares at ${money(avgCost)} average cost.`);
      await load();
      onUpdated?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update holding.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="card"><span className="spinner" /> Loading holdings market intelligence…</div>;
  if (!holdings.length) return null;

  return (
    <div className="card holdings-monitor-card" data-feature="holding-reconciliation">
      <div className="holdings-monitor-head">
        <div>
          <h2 className="section" style={{ margin: 0 }}>📈 Holdings Market Monitor</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Cost basis, live price, position weight and 52-week context. Use Edit to reconcile Shares and Avg Cost with the real broker portfolio.
          </p>
        </div>
        <span className="tag">{holdings.length} open positions</span>
      </div>

      {message && <div className={`holding-edit-message ${message.includes("updated") ? "success" : "error"}`}>{message}</div>}

      {editing && (
        <section className="holding-edit-panel" aria-label={`Edit ${editing.ticker} holding`}>
          <div className="holding-edit-title">
            <div>
              <span>RECONCILE HOLDING</span>
              <strong>{editing.ticker}</strong>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
          </div>
          <div className="holding-edit-grid">
            <label>
              <span>Shares</span>
              <input inputMode="decimal" value={editing.shares} onChange={(event) => setEditing({ ...editing, shares: event.target.value })} />
            </label>
            <label>
              <span>Average cost</span>
              <input inputMode="decimal" value={editing.avgCost} onChange={(event) => setEditing({ ...editing, avgCost: event.target.value })} />
            </label>
            <button type="button" className="btn primary holding-save-btn" onClick={saveEdit} disabled={saving}>
              {saving ? "Saving…" : "Save corrected holding"}
            </button>
          </div>
          <p className="muted holding-edit-note">This is a reconciliation override. It updates the holding master record and does not create a new buy/sell trade.</p>
        </section>
      )}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="tbl holdings-market-table">
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="num">Shares</th>
              <th className="num">Avg cost</th>
              <th className="num">Current</th>
              <th className="num">vs cost</th>
              <th className="num">1W</th>
              <th>YTD</th>
              <th>52W range</th>
              <th className="num">Weight</th>
              <th className="num">Edit</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const item = market[holding.ticker];
              const price = item?.price ?? null;
              const vs = price != null && holding.avg_cost > 0 ? (price / holding.avg_cost - 1) * 100 : null;
              const marketValue = (price ?? holding.avg_cost) * holding.shares;
              const weight = nav ? (marketValue / nav) * 100 : 0;
              return (
                <tr key={holding.id || holding.ticker}>
                  <td><strong>{holding.ticker}</strong><br /><span className="muted" style={{ fontSize: 10.5 }}>{item?.asOf ?? "—"}</span></td>
                  <td className="num"><strong>{holding.shares.toLocaleString(undefined, { maximumFractionDigits: 7 })}</strong></td>
                  <td className="num">{money(holding.avg_cost)}</td>
                  <td className="num"><strong>{price == null ? "—" : money(price)}</strong></td>
                  <td className={`num ${vs == null ? "muted" : vs >= 0 ? "pos" : "neg"}`}>{pc(vs)}</td>
                  <td className={`num ${item?.change1w == null ? "muted" : item.change1w >= 0 ? "pos" : "neg"}`}>{pc(item?.change1w ?? null)}</td>
                  <td style={{ minWidth: 150 }}><Spark points={item?.ytdSeries ?? []} positive={(item?.ytdChangePct ?? 0) >= 0} /><div className={item?.ytdChangePct == null ? "muted" : item.ytdChangePct >= 0 ? "pos" : "neg"} style={{ fontSize: 10.5, marginTop: 2 }}>YTD {pc(item?.ytdChangePct ?? null)}</div></td>
                  <td style={{ minWidth: 210 }}><Range low={item?.low52 ?? null} high={item?.high52 ?? null} pos={item?.pos52 ?? null} price={price} /></td>
                  <td className="num">{weight.toFixed(1)}%</td>
                  <td className="num"><button type="button" className="holding-edit-btn" onClick={() => beginEdit(holding)}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Spark({ points, positive }: { points: any[]; positive: boolean }) {
  if (points.length < 2) return <span className="muted">—</span>;
  const values = points.map((point) => point.close);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const width = 140;
  const height = 36;
  const span = Math.max(0.0001, high - low);
  const path = values.map((value, index) => `${index ? "L" : "M"}${(index / (values.length - 1)) * width},${height - ((value - low) / span) * height}`).join(" ");
  return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="YTD price sparkline"><path d={path} fill="none" stroke="currentColor" strokeWidth="2" className={positive ? "pos" : "neg"} /></svg>;
}

function Range({ low, high, pos, price }: { low: number | null; high: number | null; pos: number | null; price: number | null }) {
  return <div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}><span className="muted">{low == null ? "—" : money(low)}</span><strong>{pos == null ? "—" : `${pos.toFixed(0)}%`}</strong><span className="muted">{high == null ? "—" : money(high)}</span></div><div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,.08)", position: "relative", marginTop: 6 }}>{pos != null && <span style={{ position: "absolute", left: `calc(${pos}% - 5px)`, top: -2, width: 11, height: 11, borderRadius: "50%", background: "currentColor" }} />}</div><div className="muted" style={{ fontSize: 10, marginTop: 4 }}>{price == null ? "No current price" : pos == null ? "52W history unavailable" : pos >= 85 ? "Near 52W high" : pos <= 15 ? "Near 52W low" : "Inside 52W range"}</div></div>;
}
