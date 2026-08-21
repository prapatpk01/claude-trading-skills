"use client";

import { buildFundingWaterfall } from "@/lib/research/fundingWaterfall";

const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0);

export default function FundingWaterfallSummary({
  requestedInvestmentUsd,
  cashBufferExcessUsd,
  approvedTrimProceedsUsd,
  executedSellProceedsUsd = 0,
  sellReviewPotentialUsd = 0,
  lang = "th",
}: {
  requestedInvestmentUsd: number;
  cashBufferExcessUsd: number;
  approvedTrimProceedsUsd: number;
  executedSellProceedsUsd?: number;
  sellReviewPotentialUsd?: number;
  lang?: "th" | "en";
}) {
  const plan = buildFundingWaterfall({ requestedInvestmentUsd, cashBufferExcessUsd, approvedTrimProceedsUsd, executedSellProceedsUsd });
  const status = plan.unfundedUsd > 0
    ? (lang === "th" ? "FUNDING GAP" : "FUNDING GAP")
    : plan.noSaleRequired
      ? "NO SALE REQUIRED"
      : plan.sellRequired
        ? "EXECUTED SELL USED"
        : "TRIM REQUIRED";

  return <section style={{ marginTop: 16, padding: 16, border: "1px solid rgba(102,214,185,.28)", borderRadius: 16, background: "rgba(7,36,43,.42)" }} data-funding-waterfall="cash-excess-first">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <small style={{ color: "#6ed7c7", letterSpacing: ".12em", fontWeight: 800 }}>FUNDING WATERFALL · AM / CIO</small>
        <div style={{ marginTop: 5, fontWeight: 800 }}>{lang === "th" ? "ใช้ Cash Buffer ส่วนเกินก่อนขายหุ้น" : "Use excess Cash Buffer before selling holdings"}</div>
      </div>
      <span style={{ border: "1px solid rgba(102,214,185,.45)", borderRadius: 999, padding: "6px 10px", color: plan.unfundedUsd > 0 ? "#f2bd7d" : "#76e0b4", fontWeight: 800, fontSize: 12 }}>{status}</span>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 10, marginTop: 14 }}>
      <div><small style={{ color: "#8496b3" }}>{lang === "th" ? "Draft ที่ต้องใช้" : "Draft required"}</small><div style={{ fontWeight: 800 }}>{usd(plan.requestedInvestmentUsd)}</div></div>
      <div><small style={{ color: "#8496b3" }}>{lang === "th" ? "จาก Cash Buffer ส่วนเกิน" : "From excess Cash Buffer"}</small><div style={{ fontWeight: 800 }}>{usd(plan.fromCashBufferExcessUsd)}</div></div>
      <div><small style={{ color: "#8496b3" }}>{lang === "th" ? "จาก TRIM ที่ต้องทำ" : "From approved TRIM"}</small><div style={{ fontWeight: 800 }}>{usd(plan.fromApprovedTrimUsd)}</div></div>
      <div><small style={{ color: "#8496b3" }}>{lang === "th" ? "จาก SELL ที่ขายจริงแล้ว" : "From executed SELL"}</small><div style={{ fontWeight: 800 }}>{usd(plan.fromExecutedSellUsd)}</div></div>
    </div>

    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(102,214,185,.15)", color: "#9aacbf", fontSize: 12, lineHeight: 1.6 }}>
      {plan.noSaleRequired
        ? (lang === "th"
          ? `Cash Buffer ส่วนเกินเพียงพอสำหรับ Draft นี้ จึงไม่ต้อง TRIM/SELL เพื่อหาเงินลงทุน${sellReviewPotentialUsd > 0 ? ` · SELL REVIEW ${usd(sellReviewPotentialUsd)} ยังไม่นับเป็นเงิน` : ""}`
          : `Excess Cash Buffer fully funds this draft; no holding sale is required.${sellReviewPotentialUsd > 0 ? ` SELL REVIEW ${usd(sellReviewPotentialUsd)} remains excluded.` : ""}`)
        : (lang === "th"
          ? `ลำดับเงิน: Cash Buffer Excess → TRIM ที่อนุมัติ → SELL ที่เกิดขึ้นจริง${plan.unfundedUsd > 0 ? ` · ยังขาด ${usd(plan.unfundedUsd)}` : ""}. SELL REVIEW ไม่ถูกนับล่วงหน้า.`
          : `Funding order: Cash Buffer excess → approved TRIM → executed SELL${plan.unfundedUsd > 0 ? ` · ${usd(plan.unfundedUsd)} still unfunded` : ""}. SELL REVIEW is never pre-counted.`)}
    </div>
  </section>;
}
