"use client";

import { useMemo, useState } from "react";
import TickerInput from "./TickerInput";

type Action = "buy" | "sell";

type Props = {
  onSaved: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const cleanDecimal = (raw: string, decimals: number) => {
  const v = raw.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = v.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, decimals)}` : whole;
};

export default function HoldingTransactionForm({ onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<Action>("buy");
  const [ticker, setTicker] = useState("");
  const [shares, setShares] = useState("");
  const [price, setPrice] = useState("");
  const [target, setTarget] = useState("");
  const [date, setDate] = useState(today());
  const [thesis, setThesis] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const shareNum = Number(shares);
  const priceNum = Number(price);
  const total = useMemo(
    () => Number.isFinite(shareNum) && Number.isFinite(priceNum) ? shareNum * priceNum : 0,
    [shareNum, priceNum]
  );

  const reset = () => {
    setAction("buy");
    setTicker("");
    setShares("");
    setPrice("");
    setTarget("");
    setDate(today());
    setThesis("");
    setAdvanced(false);
    setError(null);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!ticker.trim()) return setError("Enter a ticker symbol.");
    if (!Number.isFinite(shareNum) || shareNum <= 0) return setError("Shares must be greater than zero.");
    if (!Number.isFinite(priceNum) || priceNum < 0) return setError(action === "buy" ? "Enter the average cost per share." : "Enter the sell price per share.");

    setBusy(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ticker: ticker.trim().toUpperCase(),
          shares,
          avg_cost: price,
          target_price: target,
          thesis,
          opened_at: date,
          transaction_date: date,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save transaction.");

      const msg = action === "sell"
        ? json.closed
          ? `${ticker.toUpperCase()} sold ${shares} shares · position closed.`
          : `${ticker.toUpperCase()} sold ${shares} shares · ${json.remainingShares ?? "remaining position updated"}.`
        : json.merged
          ? `${ticker.toUpperCase()} · ${json.mergeSummary}`
          : `${ticker.toUpperCase()} holding added.`;
      setNotice(msg);
      onSaved();
      setOpen(false);
      reset();
    } catch (err: any) {
      setError(err?.message || "Could not save transaction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)} style={{ marginTop: 12 }}>
        ＋ Add holding
      </button>
      {notice && <div className="notice" style={{ marginTop: 10 }}>✓ {notice}</div>}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add holding transaction"
          style={{
            position: "fixed", inset: 0, zIndex: 1200, display: "grid", placeItems: "center",
            padding: 18, background: "rgba(2,7,18,.78)", backdropFilter: "blur(8px)",
          }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <form
            onSubmit={submit}
            style={{
              width: "min(760px, 100%)", maxHeight: "92vh", overflowY: "auto",
              border: "1px solid var(--border)", borderRadius: 22,
              background: "linear-gradient(180deg, rgba(18,29,52,.99), rgba(9,17,34,.99))",
              boxShadow: "0 26px 90px rgba(0,0,0,.55)", padding: 20,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 25 }}>💼 Add holding</h2>
                <div className="muted" style={{ marginTop: 4 }}>Record a buy or sell transaction</div>
              </div>
              <button type="button" className="btn ghost sm" onClick={close} aria-label="Close">✕</button>
            </div>

            <label style={{ display: "block", marginTop: 22, marginBottom: 9 }}>Action</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <button
                type="button"
                onClick={() => setAction("buy")}
                style={{
                  minHeight: 62, borderRadius: 13, fontSize: 18, fontWeight: 800,
                  border: action === "buy" ? "1px solid #31d7c0" : "1px solid var(--border)",
                  color: action === "buy" ? "#42e4c9" : "var(--text)",
                  background: action === "buy" ? "rgba(31,189,164,.16)" : "rgba(17,27,48,.6)",
                }}
              >↗ Buy</button>
              <button
                type="button"
                onClick={() => setAction("sell")}
                style={{
                  minHeight: 62, borderRadius: 13, fontSize: 18, fontWeight: 800,
                  border: action === "sell" ? "1px solid #ff5e78" : "1px solid var(--border)",
                  color: action === "sell" ? "#ff7086" : "var(--text)",
                  background: action === "sell" ? "rgba(197,47,76,.17)" : "rgba(17,27,48,.6)",
                }}
              >↘ Sell</button>
            </div>

            <label style={{ display: "block", marginTop: 20, marginBottom: 8 }}>Ticker</label>
            <TickerInput value={ticker} onChange={setTicker} placeholder="AAPL, VOO, SCHD" style={{ width: "100%", minWidth: 0 }} />

            <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) minmax(190px,1fr)", gap: 12, marginTop: 18 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8 }}>Shares</label>
                <input
                  value={shares}
                  onChange={(e) => setShares(cleanDecimal(e.target.value, 7))}
                  placeholder="0.0000000"
                  inputMode="decimal"
                  style={{ width: "100%", minWidth: 0, fontVariantNumeric: "tabular-nums" }}
                />
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Supports up to 7 decimal places</div>
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8 }}>{action === "buy" ? "Average cost per share (USD)" : "Sell price per share (USD)"}</label>
                <input value={price} onChange={(e) => setPrice(cleanDecimal(e.target.value, 4))} placeholder="0.00" inputMode="decimal" style={{ width: "100%" }} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(190px,1fr) minmax(190px,1fr)", gap: 12, marginTop: 18 }}>
              <div>
                <label style={{ display: "block", marginBottom: 8 }}>Total amount (USD)</label>
                <input value={Number.isFinite(total) && total > 0 ? total.toFixed(2) : ""} placeholder="0.00" readOnly style={{ width: "100%", opacity: .85 }} />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 8 }}>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: "100%" }} />
              </div>
            </div>

            <label style={{ display: "block", marginTop: 18, marginBottom: 8 }}>Thesis / notes (optional)</label>
            <textarea
              value={thesis}
              onChange={(e) => setThesis(e.target.value.slice(0, 500))}
              placeholder={action === "buy" ? "Why are you adding this position?" : "Why are you reducing this position?"}
              rows={4}
              style={{ width: "100%", resize: "vertical" }}
            />
            <div className="muted" style={{ textAlign: "right", fontSize: 11 }}>{thesis.length}/500</div>

            <button
              className="btn ghost"
              type="button"
              onClick={() => setAdvanced((v) => !v)}
              style={{ width: "100%", marginTop: 13, justifyContent: "space-between" }}
            >
              <span>Advanced (optional)</span><span>{advanced ? "⌃" : "⌄"}</span>
            </button>
            {advanced && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: "block", marginBottom: 8 }}>Target price</label>
                <input value={target} onChange={(e) => setTarget(cleanDecimal(e.target.value, 4))} placeholder="Optional target" inputMode="decimal" style={{ width: "100%" }} />
              </div>
            )}

            {error && <div className="err" style={{ marginTop: 14 }}>⚠ {error}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 20 }}>
              <button className="btn ghost" type="button" onClick={close} disabled={busy}>Cancel</button>
              <button className="btn" disabled={busy}>{busy ? "Saving…" : action === "buy" ? "Add holding" : "Record sale"}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
