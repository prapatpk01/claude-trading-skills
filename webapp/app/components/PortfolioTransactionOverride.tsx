"use client";

import HoldingTransactionForm from "./HoldingTransactionForm";

type Props = { onSaved: () => void; lang?: "en" | "th" };

export default function PortfolioTransactionOverride({ onSaved, lang = "en" }: Props) {
  return (
    <section
      className="card"
      data-portfolio-operations="buy-sell-entry"
      style={{ marginTop: 18, borderTop: "2px solid rgba(91,140,255,.75)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <div className="eyebrow">PORTFOLIO OPERATIONS</div>
          <h2 className="section" style={{ margin: "6px 0 5px" }}>
            {lang === "th" ? "บันทึกซื้อ / ขายหุ้น" : "Record Buy / Sell Transaction"}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: 12, maxWidth: 720 }}>
            {lang === "th"
              ? "บันทึกรายการซื้อหรือขายจริงลง Holdings และ Trade Ledger เดียวกัน หลังบันทึกระบบจะรีเฟรชพอร์ต ต้นทุนเฉลี่ย และประวัติธุรกรรมอัตโนมัติ"
              : "Record an actual buy or sell into the same Holdings and Trade Ledger. Saving refreshes positions, average cost and transaction history automatically."}
          </p>
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <HoldingTransactionForm onSaved={onSaved} />
        </div>
      </div>
      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="metric"><span>BUY</span><strong>{lang === "th" ? "เพิ่มหรือถัวเฉลี่ยสถานะ" : "Open or add to a holding"}</strong></div>
        <div className="metric"><span>SELL</span><strong>{lang === "th" ? "ลดหรือปิดสถานะ" : "Trim or close a holding"}</strong></div>
        <div className="metric"><span>LEDGER</span><strong>{lang === "th" ? "บันทึกทุกธุรกรรม" : "Every trade is auditable"}</strong></div>
      </div>
    </section>
  );
}
