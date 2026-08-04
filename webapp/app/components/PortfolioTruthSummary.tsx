"use client";

import type { AppLang } from "../page";
import { money, pct, cls } from "./format";
import { useFundSnapshot } from "./useFundSnapshot";

export default function PortfolioTruthSummary({ lang, refreshKey = 0 }: { lang: AppLang; refreshKey?: number }) {
  const fund = useFundSnapshot(refreshKey);
  const t = (en: string, th: string) => lang === "th" ? th : en;

  return (
    <section className="portfolio-truth-summary" aria-label={t("Verified portfolio summary", "สรุปพอร์ตที่ตรวจสอบแล้ว")}>
      <div className="grid cols-4">
        <div className="metric">
          <div className="label">{t("Verified Portfolio Value", "มูลค่าพอร์ตที่ยืนยันแล้ว")}</div>
          <div className="value">{fund.loading ? "…" : fund.verified ? money(fund.totalNav) : "—"}</div>
          <div className="sub">{fund.openPositions} {t("open positions · includes broker cash", "สถานะเปิด · รวมเงินสดโบรกเกอร์")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Securities Cost Basis", "ต้นทุนหลักทรัพย์รวม")}</div>
          <div className="value">{fund.loading ? "…" : money(fund.costBasis)}</div>
          <div className="sub">{t("Recorded open holdings", "จากสถานะเปิดที่บันทึกไว้")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Unrealized P/L", "กำไร/ขาดทุนที่ยังไม่รับรู้")}</div>
          <div className={cls("value", fund.unrealizedPnl >= 0 ? "pos" : "neg")}>{fund.loading ? "…" : fund.verified ? money(fund.unrealizedPnl) : "—"}</div>
          <div className="sub">{fund.verified ? t("Same verified snapshot used by Dashboard and CIO", "ใช้ Snapshot เดียวกับ Dashboard และ CIO") : t("Withheld until prices are complete", "ระงับจนกว่าราคาจะครบ")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Verified Return", "ผลตอบแทนที่ยืนยันแล้ว")}</div>
          <div className={cls("value", fund.unrealizedPnlPct >= 0 ? "pos" : "neg")}>
            {fund.loading ? "…" : fund.verified ? `${fund.unrealizedPnlPct >= 0 ? "+" : ""}${pct(fund.unrealizedPnlPct)}` : "—"}
          </div>
          <div className="sub">{t("No separate valuation pipeline", "ไม่มีระบบคำนวณมูลค่าแยกอีกชุด")}</div>
        </div>
      </div>

      {!fund.loading && (fund.error || !fund.verified) && (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>{t("Portfolio valuation withheld", "ระงับการประเมินมูลค่าพอร์ต")}</strong>
          <div style={{ marginTop: 5 }}>{fund.error || t("Some required market prices are not verified.", "ราคาตลาดที่จำเป็นบางรายการยังไม่ได้รับการยืนยัน")}</div>
        </div>
      )}
    </section>
  );
}
