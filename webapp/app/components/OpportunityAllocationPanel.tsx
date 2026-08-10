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
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onCashChange = () => void load();
    window.addEventListener("sentinel:cash-ledger-changed", onCashChange);
    return () => window.removeEventListener("sentinel:cash-ledger-changed", onCashChange);
  }, [load]);

  const allocations = data?.allocations ?? [];
  const blockers = data?.blockers ?? [];
  const route = data?.capitalRouting;
  const statusAccent = data?.status === "READY_FOR_HUMAN_REVIEW" || data?.status === "RESERVE_PARKING_RECOMMENDED"
    ? "pos" : data?.status === "WAIT" || data?.status === "BLOCKED" ? "neg" : undefined;

  return <div className="card ai-card" style={{ marginTop: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <h2 className="section" style={{ margin: 0 }}>🎯 {t("Committee Capital Allocation", "การจัดสรรเงินทุนโดยคณะกรรมการ")}</h2>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
          {t("Every deployable dollar now receives an explicit destination: invest in approved risk ideas, hold a small USD settlement float, or park otherwise-idle USD in SGOV while existing reserve assets remain parked.", "เงินที่ใช้ได้ทุกดอลลาร์จะมีปลายทางชัดเจน: ลงทุนในหุ้นที่ผ่านอนุมัติ เก็บ USD เล็กน้อยสำหรับ settlement หรือพัก USD ที่ยังไม่มีงานใน SGOV ส่วนตราสารสำรองที่ถืออยู่แล้วให้คงไว้")}
        </p>
      </div>
      <button className="btn ghost sm" onClick={load} disabled={loading}>{loading ? "…" : "↻ Refresh"}</button>
    </div>

    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={t("Status", "สถานะ")} value={String(data.status ?? "—").replaceAll("_", " ")} accent={statusAccent} />
        <Metric label={t("Deployable", "เงินส่วนเกินที่ใช้ได้")} value={money(data.portfolio?.deployableCapitalUsd)} />
        <Metric label={t("Invest now", "ลงทุนตอนนี้")} value={money(route?.investUsd ?? data.portfolio?.allocatedCapitalUsd)} accent="pos" />
        <Metric label={t("Unassigned risk capital", "เงินที่ยังไม่ลงสินทรัพย์เสี่ยง")} value={money(data.portfolio?.remainingCapitalUsd)} />
      </div>

      {route && <div className="card" style={{ marginTop: 14, background: "rgba(8,14,28,.38)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap", alignItems:"center" }}>
          <div>
            <h3 className="sub" style={{ margin:"0 0 4px" }}>🧭 {t("Capital destination", "ปลายทางของเงินทุน")}</h3>
            <p className="muted" style={{ margin:0, fontSize:12 }}>{t("Routing is a decision instruction only; no broker order is sent automatically.", "นี่เป็นคำแนะนำการจัดสรรเท่านั้น ระบบไม่ส่งคำสั่งไปโบรกเกอร์อัตโนมัติ")}</p>
          </div>
          <span className="tag">{t(`Review in ${route.reviewDays ?? 7} days`, `ทบทวนใน ${route.reviewDays ?? 7} วัน`)}</span>
        </div>
        <div className="grid cols-4" style={{ marginTop:12 }}>
          <RouteMetric icon="📈" label={t("INVEST", "ลงทุน")} value={money(route.investUsd ?? 0)} note={t("Approved risk ideas", "หุ้นที่ผ่านอนุมัติ")} accent={(route.investUsd ?? 0)>0?"pos":undefined}/>
          <RouteMetric icon="💵" label={t("HOLD USD", "ถือ USD")} value={money(route.holdUsdTemporarily ?? 0)} note={t(`Settlement float up to $${route.settlementFloatUsd ?? 25}`, `เงินสำรอง settlement สูงสุด $${route.settlementFloatUsd ?? 25}`)}/>
          <RouteMetric icon="🛡️" label={t("PARK IN SGOV", "พักใน SGOV")} value={money(route.parkInSgovUsd ?? 0)} note={t("New idle broker USD", "USD ใหม่ที่ยังไม่มีงาน")} accent={(route.parkInSgovUsd ?? 0)>0?"pos":undefined}/>
          <RouteMetric icon="🏦" label={t("KEEP RESERVE", "คงเงินสำรองเดิม")} value={money(route.keepExistingReserveUsd ?? 0)} note={t("Already in SGOV/JAAA/etc.", "ถืออยู่ใน SGOV/JAAA/อื่น ๆ แล้ว")}/>
        </div>
        <div className="notice" style={{ marginTop:12 }}>
          <strong>{t("CIO instruction", "คำสั่ง CIO")}: </strong>{route.instruction}
          {route.parkInSgovUsd > 0 && <><br/><span className="muted">{t("After you buy SGOV at the broker, record it as BUY SGOV in Holdings. Do not enter the same amount again as External capital in.", "หลังซื้อ SGOV ที่โบรกเกอร์ ให้บันทึกเป็น BUY SGOV ใน Holdings และอย่ากรอกเงินจำนวนเดิมซ้ำเป็นเงินเพิ่มทุนจากภายนอก")}</span></>}
          <br/><span className="muted">{t("JAAA remains an approved reserve alternative but is not the default parking destination because it carries credit exposure; it requires explicit committee approval.", "JAAA ยังเป็นทางเลือกสำรองที่อนุมัติได้ แต่ไม่ใช่ปลายทางพักเงินเริ่มต้นเพราะมีความเสี่ยงเครดิต จึงต้องมีมติคณะกรรมการชัดเจน")}</span>
        </div>
      </div>}

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
          {!allocations.length && !loading && <tr><td colSpan={7} className="muted">{t("No risk candidate currently clears every allocation gate. Check the capital-routing instruction above for the idle cash destination.", "ยังไม่มีหุ้นเสี่ยงที่ผ่านเกณฑ์ครบทุกข้อ ให้ดูคำสั่งปลายทางเงินทุนด้านบนว่าควรถือ USD หรือพักใน SGOV")}</td></tr>}
        </tbody>
      </table></div>
      <p className="notice" style={{ marginTop: 12 }}>{t("No order is sent automatically. Recheck live price, thesis, concentration and broker cash before executing approved risk buys or SGOV parking.", "ระบบไม่ส่งคำสั่งซื้อขายอัตโนมัติ ต้องตรวจราคาล่าสุด Thesis การกระจุกตัว และเงินสดที่โบรกเกอร์ก่อนซื้อหุ้นที่อนุมัติหรือพักเงินใน SGOV")}</p>
    </>}
  </div>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="metric"><div className="label">{label}</div><div className={cls("value", accent)} style={{ fontSize: 18 }}>{value}</div></div>;
}
function RouteMetric({icon,label,value,note,accent}:{icon:string;label:string;value:string;note:string;accent?:string}){
  return <div className="metric"><div className="label">{icon} {label}</div><div className={cls("value",accent)} style={{fontSize:18}}>{value}</div><div className="sub">{note}</div></div>;
}
