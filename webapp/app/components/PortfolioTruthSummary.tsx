"use client";

import type { AppLang } from "../page";
import { money, pct, cls } from "./format";
import { useFundSnapshot } from "./useFundSnapshot";

export default function PortfolioTruthSummary({ lang, refreshKey = 0 }: { lang: AppLang; refreshKey?: number }) {
  const fund = useFundSnapshot(refreshKey);
  const t = (en: string, th: string) => lang === "th" ? th : en;

  return (
    <section className="portfolio-truth-summary" aria-label={t("Verified portfolio summary", "สรุปพอร์ตที่ตรวจสอบแล้ว")}>
      <div className="grid cols-3">
        <div className="metric">
          <div className="label">{t("Verified Holdings Value", "มูลค่าหุ้นที่ยืนยันแล้ว")}</div>
          <div className="value">{fund.loading ? "…" : fund.verified ? money(fund.securitiesValue) : "—"}</div>
          <div className="sub">{fund.openPositions} {t("open positions · broker cash tracked separately", "สถานะเปิด · เงินสดโบรกเกอร์แยกติดตามต่างหาก")}</div>
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
          <div className="sub">{t("Cost basis remains internal for P/L calculation", "เก็บต้นทุนไว้ภายในเพื่อคำนวณกำไร/ขาดทุน")}</div>
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
