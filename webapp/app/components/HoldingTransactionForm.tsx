"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import TickerInput from "./TickerInput";

type Action = "buy" | "sell";

type Holding = {
  id?: string;
  ticker: string;
  shares: number;
  avg_cost?: number;
  closed_at?: string | null;
};

type Props = {
  onSaved: () => void;
};

const today = () => new Date().toISOString().slice(0, 10);
const cleanDecimal = (raw: string, decimals: number) => {
  const value = raw.replace(/[^0-9.]/g, "");
  const [whole = "", ...rest] = value.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, decimals)}` : whole;
};
const formatShares = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 7 });

export default function HoldingTransactionForm({ onSaved }: Props) {
  const [mounted, setMounted] = useState(false);
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
  const [loadingHolding, setLoadingHolding] = useState(false);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setLoadingHolding(true);
    fetch("/api/portfolio", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        const next = Array.isArray(payload?.holdings) ? payload.holdings : [];
        setHoldings(
          next
            .filter((holding: Holding) => !holding.closed_at && Number(holding.shares) > 0)
            .map((holding: Holding) => ({ ...holding, ticker: String(holding.ticker).toUpperCase(), shares: Number(holding.shares) || 0 })),
        );
      })
      .catch(() => setHoldings([]))
      .finally(() => setLoadingHolding(false));
  }, [open]);

  const normalizedTicker = ticker.trim().toUpperCase();
  const selectedHolding = useMemo(
    () => holdings.find((holding) => holding.ticker === normalizedTicker) ?? null,
    [holdings, normalizedTicker],
  );
  const availableShares = selectedHolding?.shares ?? null;
  const shareNum = Number(shares);
  const priceNum = Number(price);
  const remainingShares = useMemo(() => {
    if (action !== "sell" || availableShares == null || !Number.isFinite(shareNum)) return null;
    return Math.max(0, availableShares - shareNum);
  }, [action, availableShares, shareNum]);
  const total = useMemo(
    () => (Number.isFinite(shareNum) && Number.isFinite(priceNum) ? shareNum * priceNum : 0),
    [shareNum, priceNum],
  );
  const overselling =
    action === "sell" &&
    availableShares != null &&
    Number.isFinite(shareNum) &&
    shareNum > availableShares + 1e-7;
  const missingSellHolding = action === "sell" && normalizedTicker.length > 0 && !loadingHolding && !selectedHolding;

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

  const sellAll = () => {
    if (availableShares == null) return;
    setShares(String(availableShares));
    setError(null);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!normalizedTicker) return setError("Enter a ticker symbol.");
    if (action === "sell" && missingSellHolding) return setError(`${normalizedTicker} has no open holding to sell.`);
    if (!Number.isFinite(shareNum) || shareNum <= 0) return setError("Shares must be greater than zero.");
    if (overselling) return setError(`Cannot sell ${formatShares(shareNum)} shares; only ${formatShares(availableShares)} are available.`);
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return setError(action === "buy" ? "Enter the average cost per share." : "Enter the sell price per share.");
    }

    setBusy(true);
    try {
      const response = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ticker: normalizedTicker,
          shares,
          avg_cost: price,
          target_price: target,
          thesis,
          opened_at: date,
          transaction_date: date,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save transaction.");

      const message = action === "sell"
        ? payload.closed
          ? `${normalizedTicker} sold ${formatShares(shareNum)} shares · position closed.`
          : `${normalizedTicker} sold ${formatShares(shareNum)} shares · ${formatShares(Number(payload.remainingShares))} shares remain.`
        : payload.merged
          ? `${normalizedTicker} · ${payload.mergeSummary}`
          : `${normalizedTicker} holding added.`;
      setNotice(message);
      onSaved();
      setOpen(false);
      reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save transaction.");
    } finally {
      setBusy(false);
    }
  }

  const modal = open ? (
    <div
      className="holding-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add holding transaction"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <form className="holding-modal-card" onSubmit={submit}>
        <div className="holding-modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 25 }}>💼 Add holding</h2>
            <div className="muted" style={{ marginTop: 4 }}>Record a buy or sell transaction</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={close} aria-label="Close">✕</button>
        </div>

        <label style={{ display: "block", marginTop: 22, marginBottom: 9 }}>Action</label>
        <div className="holding-action-grid">
          <button
            type="button"
            onClick={() => { setAction("buy"); setError(null); }}
            style={{
              minHeight: 62, borderRadius: 13, fontSize: 18, fontWeight: 800,
              border: action === "buy" ? "1px solid #31d7c0" : "1px solid var(--border)",
              color: action === "buy" ? "#42e4c9" : "var(--text)",
              background: action === "buy" ? "rgba(31,189,164,.16)" : "rgba(17,27,48,.6)",
            }}
          >↗ Buy</button>
          <button
            type="button"
            onClick={() => { setAction("sell"); setError(null); }}
            style={{
              minHeight: 62, borderRadius: 13, fontSize: 18, fontWeight: 800,
              border: action === "sell" ? "1px solid #ff5e78" : "1px solid var(--border)",
              color: action === "sell" ? "#ff7086" : "var(--text)",
              background: action === "sell" ? "rgba(197,47,76,.17)" : "rgba(17,27,48,.6)",
            }}
          >↘ Sell</button>
        </div>

        <label style={{ display: "block", marginTop: 20, marginBottom: 8 }}>Ticker</label>
        <TickerInput value={ticker} onChange={(value) => { setTicker(value); setError(null); }} placeholder="AAPL, VOO, SCHD" style={{ width: "100%", minWidth: 0 }} />

        {action === "sell" && (
          <div className={`sell-availability ${missingSellHolding ? "missing" : ""}`}>
            <div><span>Available shares</span><strong>{loadingHolding ? "Loading…" : formatShares(availableShares)}</strong></div>
            <div><span>Selling</span><strong>{Number.isFinite(shareNum) && shareNum > 0 ? formatShares(shareNum) : "0"}</strong></div>
            <div><span>Remaining after sale</span><strong>{formatShares(remainingShares)}</strong></div>
            <button type="button" className="btn ghost sm" onClick={sellAll} disabled={availableShares == null || availableShares <= 0}>Sell all</button>
          </div>
        )}

        <div className="holding-fields-grid">
          <div className="holding-field">
            <label style={{ display: "block", marginBottom: 8 }}>Shares</label>
            <input
              value={shares}
              onChange={(event) => { setShares(cleanDecimal(event.target.value, 7)); setError(null); }}
              placeholder="0.0000000"
              inputMode="decimal"
              style={{ width: "100%", minWidth: 0, fontVariantNumeric: "tabular-nums" }}
            />
            <div className={overselling ? "neg" : "muted"} style={{ fontSize: 11, marginTop: 6 }}>
              {overselling ? `Only ${formatShares(availableShares)} shares are available.` : "Supports up to 7 decimal places"}
            </div>
          </div>
          <div className="holding-field">
            <label style={{ display: "block", marginBottom: 8 }}>{action === "buy" ? "Average cost per share (USD)" : "Sell price per share (USD)"}</label>
            <input value={price} onChange={(event) => setPrice(cleanDecimal(event.target.value, 4))} placeholder="0.00" inputMode="decimal" style={{ width: "100%", minWidth: 0 }} />
          </div>
        </div>

        <div className="holding-fields-grid">
          <div className="holding-field">
            <label style={{ display: "block", marginBottom: 8 }}>Total amount (USD)</label>
            <input value={Number.isFinite(total) && total > 0 ? total.toFixed(2) : ""} placeholder="0.00" readOnly style={{ width: "100%", minWidth: 0, opacity: .85 }} />
          </div>
          <div className="holding-field">
            <label style={{ display: "block", marginBottom: 8 }}>Date</label>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} style={{ width: "100%", minWidth: 0 }} />
          </div>
        </div>

        <label style={{ display: "block", marginTop: 18, marginBottom: 8 }}>Thesis / notes (optional)</label>
        <textarea
          value={thesis}
          onChange={(event) => setThesis(event.target.value.slice(0, 500))}
          placeholder={action === "buy" ? "Why are you adding this position?" : "Why are you reducing this position?"}
          rows={4}
          style={{ width: "100%", resize: "vertical" }}
        />
        <div className="muted" style={{ textAlign: "right", fontSize: 11 }}>{thesis.length}/500</div>

        <button className="btn ghost" type="button" onClick={() => setAdvanced((value) => !value)} style={{ width: "100%", marginTop: 13, justifyContent: "space-between" }}>
          <span>Advanced (optional)</span><span>{advanced ? "⌃" : "⌄"}</span>
        </button>
        {advanced && (
          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", marginBottom: 8 }}>Target price</label>
            <input value={target} onChange={(event) => setTarget(cleanDecimal(event.target.value, 4))} placeholder="Optional target" inputMode="decimal" style={{ width: "100%" }} />
          </div>
        )}

        {error && <div className="err" style={{ marginTop: 14 }}>⚠ {error}</div>}

        <div className="holding-submit-grid">
          <button className="btn ghost" type="button" onClick={close} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy || overselling || missingSellHolding || loadingHolding}>
            {busy ? "Saving…" : action === "buy" ? "Add holding" : "Record sale"}
          </button>
        </div>
      </form>

      <style jsx global>{`
        .holding-modal-backdrop{position:fixed;inset:0;z-index:99999;display:flex;justify-content:center;align-items:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:rgba(2,7,18,.84);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);overflow:hidden}
        .holding-modal-card{box-sizing:border-box;width:min(760px,100%);max-height:calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom));overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:22px;background:linear-gradient(180deg,rgba(18,29,52,.995),rgba(9,17,34,.995));box-shadow:0 26px 90px rgba(0,0,0,.62);padding:20px}
        .holding-modal-header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;position:sticky;top:-20px;z-index:2;margin:-20px -20px 0;padding:20px;background:rgba(17,28,50,.97);border-bottom:1px solid rgba(120,150,210,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
        .holding-action-grid,.holding-submit-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.holding-submit-grid{gap:12px;margin-top:20px;padding-bottom:max(0px,env(safe-area-inset-bottom))}.holding-fields-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:18px}.holding-field{min-width:0}
        .sell-availability{margin-top:14px;padding:14px;border:1px solid rgba(91,140,255,.35);border-radius:14px;background:rgba(12,24,48,.72);display:grid;grid-template-columns:repeat(3,minmax(0,1fr)) auto;gap:10px;align-items:center}.sell-availability.missing{border-color:rgba(255,94,120,.5);background:rgba(100,20,40,.18)}.sell-availability>div{display:flex;flex-direction:column;gap:4px;min-width:0}.sell-availability span{font-size:11px;color:var(--muted)}.sell-availability strong{font-variant-numeric:tabular-nums}
        .holding-modal-card input,.holding-modal-card textarea,.holding-modal-card button{box-sizing:border-box;max-width:100%}
        @media(max-width:640px){.holding-modal-backdrop{align-items:flex-end;padding:0}.holding-modal-card{width:100%;max-height:calc(100dvh - env(safe-area-inset-top));border-radius:24px 24px 0 0;border-left:0;border-right:0;border-bottom:0;padding:18px}.holding-modal-header{top:-18px;margin:-18px -18px 0;padding:18px}.holding-fields-grid{grid-template-columns:1fr;gap:16px}.holding-action-grid,.holding-submit-grid{grid-template-columns:1fr 1fr}.holding-modal-card input,.holding-modal-card textarea{font-size:16px}.sell-availability{grid-template-columns:1fr 1fr}.sell-availability button{grid-column:1/-1;width:100%}}
        @media(max-width:380px){.holding-submit-grid{grid-template-columns:1fr}}
      `}</style>
    </div>
  ) : null;

  return (
    <>
      <button className="btn" type="button" onClick={() => setOpen(true)} style={{ marginTop: 12 }}>＋ Add holding</button>
      {notice && <div className="notice" style={{ marginTop: 10 }}>✓ {notice}</div>}
      {mounted && modal ? createPortal(modal, document.body) : null}
    </>
  );
}
