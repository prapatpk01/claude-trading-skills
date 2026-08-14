"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cls, money, num } from "./format";

interface IntegrityIssue {
  severity: "critical" | "warning";
  code: string;
  ticker?: string;
  detail: string;
}

interface IntegrityResult {
  version: string;
  status: "PASS" | "WARNING" | "FAILED" | "BLOCKED" | "ERROR";
  productionReady: boolean;
  checkedAt?: string;
  counts?: {
    holdings: number;
    openHoldings: number;
    transactions: number;
    critical: number;
    warnings: number;
  };
  issues?: IntegrityIssue[];
  legacyNote?: string;
  error?: string;
}

interface PortfolioTransaction {
  id: string;
  holding_id?: string | null;
  ticker: string;
  side: "BUY" | "SELL";
  shares: number | string;
  price: number | string;
  trade_date: string;
  realized_pnl?: number | string | null;
  notes?: string | null;
  created_at?: string;
}

interface TransactionResult {
  version: string;
  count: number;
  realizedPnl: number;
  transactions: PortfolioTransaction[];
  error?: string;
}

const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export default function PortfolioLedgerPanel({ refreshKey = 0, lang = "en" }: { refreshKey?: number; lang?: "en" | "th" }) {
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [ledger, setLedger] = useState<TransactionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [integrityResponse, ledgerResponse] = await Promise.all([
        fetch("/api/portfolio/integrity", { cache: "no-store" }),
        fetch("/api/portfolio/transactions?limit=20", { cache: "no-store" }),
      ]);
      const [integrityJson, ledgerJson] = await Promise.all([
        integrityResponse.json().catch(() => ({})),
        ledgerResponse.json().catch(() => ({})),
      ]);
      setIntegrity(integrityJson as IntegrityResult);
      setLedger(ledgerJson as TransactionResult);
      if (!integrityResponse.ok && integrityResponse.status !== 503) throw new Error(integrityJson.error || "Integrity audit failed.");
      if (!ledgerResponse.ok) throw new Error(ledgerJson.error || "Transaction history failed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Portfolio audit failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const transactions = ledger?.transactions ?? [];
  const totals = useMemo(() => {
    let buys = 0;
    let sells = 0;
    let buyValue = 0;
    let sellValue = 0;
    for (const tx of transactions) {
      const shares = finite(tx.shares);
      const price = finite(tx.price);
      if (shares == null || price == null) continue;
      if (tx.side === "BUY") {
        buys += 1;
        buyValue += shares * price;
      } else {
        sells += 1;
        sellValue += shares * price;
      }
    }
    return { buys, sells, buyValue, sellValue };
  }, [transactions]);

  const status = integrity?.status ?? (loading ? "CHECKING" : "UNKNOWN");
  const statusClass = status === "PASS" ? "pos" : status === "WARNING" ? "" : "neg";
  const statusText = lang === "th"
    ? status === "PASS" ? "ผ่าน" : status === "WARNING" ? "มีคำเตือน" : status === "CHECKING" ? "กำลังตรวจ" : "ไม่ผ่าน"
    : status;

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="section" style={{ margin: 0 }}>{lang === "th" ? "🧾 สมุดธุรกรรมและการตรวจพอร์ต" : "🧾 Ledger & Portfolio Integrity"}</h2>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
            {lang === "th"
              ? "แสดง 20 รายการซื้อขายล่าสุด พร้อมตรวจความสอดคล้องระหว่าง Holdings, Ledger และกำไรขาดทุนจากฐานข้อมูลจริง"
              : "Shows the latest 20 trades and reconciles holdings, the atomic trade ledger and realized P/L from the production database."}
          </p>
        </div>
        <button className="btn ghost sm" onClick={load} disabled={loading}>
          {loading ? "Checking…" : lang === "th" ? "↻ ตรวจใหม่" : "↻ Re-run audit"}
        </button>
      </div>

      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <div className="metric">
          <div className="label">{lang === "th" ? "สถานะความถูกต้อง" : "Integrity status"}</div>
          <div className={cls("value", statusClass)} style={{ fontSize: 20 }}>{statusText}</div>
          <div className="sub">{integrity?.checkedAt ? new Date(integrity.checkedAt).toLocaleString() : "—"}</div>
        </div>
        <div className="metric">
          <div className="label">{lang === "th" ? "20 รายการล่าสุด" : "Latest ledger entries"}</div>
          <div className="value" style={{ fontSize: 20 }}>{ledger?.count ?? 0}</div>
          <div className="sub">{totals.buys} BUY · {totals.sells} SELL</div>
        </div>
        <div className="metric">
          <div className="label">{lang === "th" ? "กำไร/ขาดทุนที่รับรู้" : "Realized P/L"}</div>
          <div className={cls("value", (ledger?.realizedPnl ?? 0) >= 0 ? "pos" : "neg")} style={{ fontSize: 20 }}>
            {money(ledger?.realizedPnl ?? 0)}
          </div>
          <div className="sub">{lang === "th" ? "เฉพาะ 20 รายการที่แสดง" : "for the 20 displayed transactions"}</div>
        </div>
        <div className="metric">
          <div className="label">{lang === "th" ? "ปัญหาที่ตรวจพบ" : "Audit issues"}</div>
          <div className={cls("value", (integrity?.counts?.critical ?? 0) > 0 ? "neg" : "pos")} style={{ fontSize: 20 }}>
            {(integrity?.counts?.critical ?? 0) + (integrity?.counts?.warnings ?? 0)}
          </div>
          <div className="sub">{integrity?.counts?.critical ?? 0} critical · {integrity?.counts?.warnings ?? 0} warning</div>
        </div>
      </div>

      {(integrity?.issues?.length ?? 0) > 0 && (
        <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
          {integrity!.issues!.map((issue, index) => (
            <div key={`${issue.code}-${index}`} className={issue.severity === "critical" ? "err" : "notice"}>
              <strong>{issue.severity === "critical" ? "CRITICAL" : "WARNING"} · {issue.code}</strong>
              {issue.ticker ? ` · ${issue.ticker}` : ""}<br />{issue.detail}
            </div>
          ))}
        </div>
      )}

      {integrity?.legacyNote && <p className="notice" style={{ marginTop: 14 }}>{integrity.legacyNote}</p>}

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead><tr>
            <th>{lang === "th" ? "วันที่" : "Date"}</th><th>Ticker</th><th>{lang === "th" ? "ประเภท" : "Side"}</th>
            <th className="num">{lang === "th" ? "จำนวน" : "Shares"}</th><th className="num">{lang === "th" ? "ราคา" : "Price"}</th>
            <th className="num">{lang === "th" ? "มูลค่า" : "Notional"}</th><th className="num">{lang === "th" ? "Realized P/L" : "Realized P/L"}</th><th>{lang === "th" ? "หมายเหตุ" : "Notes"}</th>
          </tr></thead>
          <tbody>
            {transactions.map((tx) => {
              const shares = finite(tx.shares);
              const price = finite(tx.price);
              const realized = finite(tx.realized_pnl);
              return (
                <tr key={tx.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{tx.trade_date}</td>
                  <td><strong>{tx.ticker}</strong></td>
                  <td><span className={`pill ${tx.side === "BUY" ? "buy" : "sell"}`}>{tx.side}</span></td>
                  <td className="num">{shares == null ? "—" : num(shares, 7)}</td>
                  <td className="num">{price == null ? "—" : money(price)}</td>
                  <td className="num">{shares == null || price == null ? "—" : money(shares * price)}</td>
                  <td className={cls("num", realized == null ? "muted" : realized >= 0 ? "pos" : "neg")}>{realized == null ? "—" : money(realized)}</td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>{tx.notes || "—"}</td>
                </tr>
              );
            })}
            {!loading && transactions.length === 0 && (
              <tr><td colSpan={8} className="muted">
                {lang === "th" ? "ยังไม่มีธุรกรรมใหม่ใน Ledger — สถานะเดิมก่อน v8.2 ถูกเก็บเป็น Legacy holdings" : "No v8.2+ ledger entries yet. Existing positions are retained as legacy holdings."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <div className="metric"><div className="label">BUY notional</div><div className="value" style={{ fontSize: 17 }}>{money(totals.buyValue)}</div></div>
        <div className="metric"><div className="label">SELL notional</div><div className="value" style={{ fontSize: 17 }}>{money(totals.sellValue)}</div></div>
        <div className="metric"><div className="label">Open holdings</div><div className="value" style={{ fontSize: 17 }}>{integrity?.counts?.openHoldings ?? "—"}</div></div>
        <div className="metric"><div className="label">Ledger coverage</div><div className="value" style={{ fontSize: 17 }}>{integrity?.counts?.transactions ? "ACTIVE" : "LEGACY"}</div></div>
      </div>
    </section>
  );
}
