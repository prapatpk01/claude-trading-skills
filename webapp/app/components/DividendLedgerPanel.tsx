"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cls, money, num } from "./format";
import TickerInput from "./TickerInput";

interface DividendRow {
  id: string;
  ticker: string;
  ex_date?: string | null;
  record_date?: string | null;
  pay_date: string;
  shares_eligible: number | string;
  gross_per_share: number | string;
  gross_amount: number | string;
  withholding_tax: number | string;
  net_amount: number | string;
  currency: string;
  source?: string | null;
  notes?: string | null;
}

interface DividendResponse {
  count: number;
  totals: { gross: number; tax: number; net: number };
  byYear: Array<{ year: string; gross: number; tax: number; net: number }>;
  dividends: DividendRow[];
  error?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export default function DividendLedgerPanel({ refreshKey = 0, lang = "en" }: { refreshKey?: number; lang?: "en" | "th" }) {
  const [data, setData] = useState<DividendResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    ticker: "", ex_date: "", record_date: "", pay_date: today(), shares_eligible: "",
    gross_per_share: "", withholding_tax: "", currency: "USD", source: "", notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/portfolio/dividends?limit=500", { cache: "no-store" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Could not load dividend ledger.");
      setData(json as DividendResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load dividend ledger.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const taxRate = useMemo(() => {
    const gross = data?.totals?.gross ?? 0;
    return gross > 0 ? ((data?.totals?.tax ?? 0) / gross) * 100 : null;
  }, [data]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/portfolio/dividends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || "Could not record dividend.");
      setForm({ ticker: "", ex_date: "", record_date: "", pay_date: today(), shares_eligible: "", gross_per_share: "", withholding_tax: "", currency: "USD", source: "", notes: "" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not record dividend.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="section" style={{ margin: 0 }}>{lang === "th" ? "💵 สมุดเงินปันผลรับจริง" : "💵 Actual Dividend Ledger"}</h2>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {lang === "th" ? "แยกเงินปันผลที่ได้รับจริงออกจากประมาณการ Forward income" : "Cash payments actually received, separate from projected forward income."}
          </p>
        </div>
        <button className="btn ghost sm" onClick={load} disabled={loading}>{loading ? "Loading…" : "↻ Refresh"}</button>
      </div>

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <div className="metric"><div className="label">Gross received</div><div className="value" style={{ fontSize: 20 }}>{money(data?.totals?.gross ?? 0)}</div></div>
        <div className="metric"><div className="label">Withholding tax</div><div className="value neg" style={{ fontSize: 20 }}>{money(data?.totals?.tax ?? 0)}</div><div className="sub">{taxRate == null ? "—" : `${taxRate.toFixed(2)}% effective`}</div></div>
        <div className="metric"><div className="label">Net received</div><div className="value pos" style={{ fontSize: 20 }}>{money(data?.totals?.net ?? 0)}</div></div>
        <div className="metric"><div className="label">Payments</div><div className="value" style={{ fontSize: 20 }}>{data?.count ?? 0}</div><div className="sub">verified ledger rows</div></div>
      </div>

      <form className="searchbar" onSubmit={submit} style={{ marginTop: 14 }}>
        <TickerInput value={form.ticker} onChange={(ticker) => setForm((old) => ({ ...old, ticker }))} style={{ minWidth: 130 }} />
        <input type="date" title="Ex-date" value={form.ex_date} onChange={(e) => setForm((old) => ({ ...old, ex_date: e.target.value }))} />
        <input type="date" title="Pay date" value={form.pay_date} onChange={(e) => setForm((old) => ({ ...old, pay_date: e.target.value }))} required />
        <input placeholder="Eligible shares" inputMode="decimal" value={form.shares_eligible} onChange={(e) => setForm((old) => ({ ...old, shares_eligible: e.target.value }))} required />
        <input placeholder="Gross / share" inputMode="decimal" value={form.gross_per_share} onChange={(e) => setForm((old) => ({ ...old, gross_per_share: e.target.value }))} required />
        <input placeholder="Tax withheld" inputMode="decimal" value={form.withholding_tax} onChange={(e) => setForm((old) => ({ ...old, withholding_tax: e.target.value }))} />
        <input placeholder="Source" value={form.source} onChange={(e) => setForm((old) => ({ ...old, source: e.target.value }))} />
        <input placeholder="Notes" value={form.notes} onChange={(e) => setForm((old) => ({ ...old, notes: e.target.value }))} />
        <button className="btn" disabled={busy}>{busy ? "Saving…" : lang === "th" ? "บันทึกเงินปันผล" : "Record payment"}</button>
      </form>

      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      {(data?.byYear?.length ?? 0) > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table className="tbl">
            <thead><tr><th>Year</th><th className="num">Gross</th><th className="num">Tax</th><th className="num">Net</th></tr></thead>
            <tbody>{data!.byYear.map((row) => <tr key={row.year}><td><strong>{row.year}</strong></td><td className="num">{money(row.gross)}</td><td className="num neg">{money(row.tax)}</td><td className="num pos">{money(row.net)}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead><tr><th>Pay date</th><th>Ticker</th><th className="num">Shares</th><th className="num">Gross/share</th><th className="num">Gross</th><th className="num">Tax</th><th className="num">Net</th><th>Source / notes</th><th></th></tr></thead>
          <tbody>
            {(data?.dividends ?? []).map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap" }}><strong>{row.pay_date}</strong>{row.ex_date && <><br /><span className="muted" style={{ fontSize: 10 }}>ex {row.ex_date}</span></>}</td>
                <td><strong>{row.ticker}</strong></td>
                <td className="num">{num(Number(row.shares_eligible), 7)}</td>
                <td className="num">{money(Number(row.gross_per_share))}</td>
                <td className="num">{money(Number(row.gross_amount))}</td>
                <td className="num neg">{money(Number(row.withholding_tax))}</td>
                <td className="num pos">{money(Number(row.net_amount))}</td>
                <td className="muted" style={{ fontSize: 12 }}>{[row.source, row.notes].filter(Boolean).join(" · ") || "—"}</td>
                <td><button className="btn danger sm" onClick={async () => { if (!window.confirm(`Delete ${row.ticker} dividend paid ${row.pay_date}?`)) return; const res = await fetch(`/api/portfolio/dividends?id=${row.id}`, { method: "DELETE" }); const json = await res.json().catch(() => ({})); if (!res.ok) setError(json.error || "Delete failed."); else load(); }}>✕</button></td>
              </tr>
            ))}
            {!loading && (data?.dividends?.length ?? 0) === 0 && <tr><td colSpan={9} className="muted">{lang === "th" ? "ยังไม่มีรายการเงินปันผลรับจริง" : "No actual dividend payments recorded yet."}</td></tr>}
          </tbody>
        </table>
      </div>

      <p className="notice" style={{ marginTop: 12 }}>
        {lang === "th" ? "ยอดในส่วนนี้เป็นเงินสดรับจริงเท่านั้น ส่วน Dividend Income ด้านล่างยังเป็นประมาณการจากประวัติการจ่ายของผู้ออกหลักทรัพย์" : "This ledger contains actual cash receipts only. The Dividend Income projection below remains an issuer-history estimate."}
      </p>
    </section>
  );
}
