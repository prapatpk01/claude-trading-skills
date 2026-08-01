"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppLang } from "../page";
import { money, pct, cls } from "./format";

export default function OpportunityAllocationPanel({ lang, refreshKey }: { lang: AppLang; refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (en: string, th: string) => lang === "th" ? th : en;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portfolio/opportunity-allocation", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Opportunity allocation failed");
      setData(json);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);
  const allocations = data?.allocations ?? [];
  const blockers = data?.blockers ?? [];

  return <div className="card ai-card" style={{ marginTop: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <h2 className="section" style={{ margin: 0 }}>🎯 {t("Committee Capital Allocation", "การจัดสรรเงินทุนโดยคณะกรรมการ")}</h2>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {t("Deploys only verified liquidity excess into watchlist or discovered candidates that pass evidence, return and committee gates.", "จัดสรรเฉพาะเงินส่วนเกินที่ยืนยันแล้วให้กับหุ้นจาก Watchlist หรือ Opportunity Discovery ที่ผ่านหลักฐาน ผลตอบแทน และคณะกรรมการ")}
        </p>
      </div>
      <button className="btn ghost sm" onClick={load} disabled={loading}>{loading ? "…" : "↻ Refresh"}</button>
    </div>

    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={t("Status", "สถานะ")} value={data.status} accent={data.status === "READY_FOR_HUMAN_REVIEW" ? "pos" : data.status === "WAIT" ? "neg" : undefined} />
        <Metric label={t("Deployable", "เงินส่วนเกินที่ใช้ได้")} value={money(data.portfolio?.deployableCapitalUsd)} />
        <Metric label={t("Allocated", "จัดสรรแล้ว")} value={money(data.portfolio?.allocatedCapitalUsd)} accent="pos" />
        <Metric label={t("Remaining", "คงเหลือ")} value={money(data.portfolio?.remainingCapitalUsd)} />
      </div>

      {blockers.length > 0 && <div className="notice" style={{ marginTop: 12 }}>
        <strong>{t("Current blockers", "เงื่อนไขที่ยังไม่ผ่าน")}</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{blockers.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>
      </div>}

      <div className="table-wrap" style={{ marginTop: 14 }}><table className="tbl">
        <thead><tr><th>Ticker</th><th>{t("Decision", "มติ")}</th><th className="num">{t("Capital", "เงินทุน")}</th><th className="num">{t("Weight", "น้ำหนัก")}</th><th className="num">{t("Expected return", "ผลตอบแทนคาดหวัง")}</th><th>{t("Evidence", "หลักฐาน")}</th><th>{t("Execution", "การดำเนินการ")}</th></tr></thead>
        <tbody>
          {allocations.map((a: any) => <tr key={a.ticker}>
            <td><strong>{a.ticker}</strong><br/><span className="muted" style={{ fontSize: 10.5 }}>{(a.sources ?? []).join(" · ") || "Research"}</span></td>
            <td>{a.decision}</td>
            <td className={cls("num", a.approvedCapitalUsd > 0 ? "pos" : "muted")}>{money(a.approvedCapitalUsd)}</td>
            <td className="num">{a.proposedWeightPct != null ? pct(a.proposedWeightPct) : "—"}</td>
            <td className="num">{a.expectedReturnPct != null ? pct(a.expectedReturnPct) : "—"}</td>
            <td><span className="pill buy">PASS</span><br/><span className="muted" style={{ fontSize: 10.5 }}>{a.committee} · {a.confidence}</span></td>
            <td><span className="pill hold">{t("Human review", "มนุษย์ตรวจสอบ")}</span></td>
          </tr>)}
          {!allocations.length && !loading && <tr><td colSpan={7} className="muted">{t("No candidate currently clears every allocation gate.", "ยังไม่มีหุ้นที่ผ่านเกณฑ์การจัดสรรครบทุกข้อ")}</td></tr>}
        </tbody>
      </table></div>
      <p className="notice" style={{ marginTop: 12 }}>{t("No order is sent automatically. Recheck live price, thesis, concentration and broker cash before execution.", "ระบบไม่ส่งคำสั่งซื้อขายอัตโนมัติ ต้องตรวจราคาล่าสุด Thesis การกระจุกตัว และเงินสดที่โบรกเกอร์ก่อนดำเนินการ")}</p>
    </>}
  </div>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="metric"><div className="label">{label}</div><div className={cls("value", accent)} style={{ fontSize: 18 }}>{value}</div></div>;
}
