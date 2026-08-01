"use client";
import { useCallback, useEffect, useState } from "react";
import { cls, money, pct } from "./format";
import type { AppLang } from "../page";

export default function PortfolioOptimizerPanel({ lang, refreshKey }: { lang: AppLang; refreshKey: number }) {
  const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null);
  const t=(en:string,th:string)=>lang==="th"?th:en;
  const load=useCallback(async()=>{setLoading(true);setError(null);try{const r=await fetch("/api/portfolio/optimizer",{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Optimizer failed");setData(j);}catch(e:any){setError(e.message)}finally{setLoading(false)}},[]);
  useEffect(()=>{load()},[load,refreshKey]);
  const status=String(data?.status??"—");
  return <div className="card" style={{marginTop:18}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><h2 className="section" style={{margin:0}}>⚖️ {t("Policy-Constrained Portfolio Optimizer","ระบบปรับพอร์ตภายใต้นโยบาย")}</h2><p className="muted" style={{margin:"6px 0 0"}}>{t("Reviews liquidity floors and concentration limits before proposing capital deployment. It never executes trades automatically.","ตรวจ Liquidity Floor และข้อจำกัดการกระจุกตัวก่อนเสนอการใช้เงินทุน โดยไม่ส่งคำสั่งซื้อขายอัตโนมัติ")}</p></div><button className="btn ghost sm" onClick={load} disabled={loading}>{loading?"…":"↻ Refresh"}</button></div>
    {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
    {data&&<>
      <div className="grid cols-4" style={{marginTop:14}}>
        <Metric label={t("Optimizer status","สถานะ Optimizer")} value={status.replaceAll("_","-")} accent={status==="READY"?"pos":status==="BLOCKED"?"neg":""}/>
        <Metric label={t("Verified NAV","NAV ที่ยืนยันแล้ว")} value={money(data.portfolio?.nav)}/>
        <Metric label={t("Liquidity / target","Liquidity / เป้าหมาย")} value={`${pct(data.portfolio?.bufferPct)} / ${pct(data.portfolio?.targetBufferPct)}`}/>
        <Metric label={t("Risk / reserve positions","สถานะเสี่ยง / เงินสำรอง")} value={`${data.portfolio?.riskPositions??0} / ${data.portfolio?.reservePositions??0}`}/>
      </div>
      {(data.blockers??[]).length>0&&<div className="err" style={{marginTop:12}}>{(data.blockers??[]).map((x:string)=><div key={x}>• {x}</div>)}</div>}
      <div className="table-wrap" style={{marginTop:14,maxHeight:520,overflowY:"auto"}}><table className="tbl"><thead><tr><th>{t("Asset","สินทรัพย์")}</th><th>{t("Action","คำแนะนำ")}</th><th>{t("Priority","ความสำคัญ")}</th><th className="num">{t("Current","ปัจจุบัน")}</th><th className="num">{t("Target","เป้าหมาย")}</th><th className="num">{t("Capital","เงินทุน")}</th><th>{t("Reason","เหตุผล")}</th></tr></thead><tbody>
        {(data.proposals??[]).map((p:any,i:number)=><tr key={`${p.ticker}-${i}`}><td><strong>{p.ticker}</strong></td><td>{p.action}</td><td className={cls(p.priority==="CRITICAL"||p.priority==="HIGH"?"neg":p.priority==="NORMAL"?"pos":"")}>{p.priority}</td><td className="num">{p.currentWeightPct==null?"—":pct(p.currentWeightPct)}</td><td className="num">{p.targetWeightPct==null?"—":pct(p.targetWeightPct)}</td><td className="num">{p.capitalUsd?money(p.capitalUsd):"—"}</td><td style={{fontSize:12}}>{p.reason}</td></tr>)}
        {!(data.proposals??[]).length&&<tr><td colSpan={7} className="muted">{t("No proposals available.","ยังไม่มีข้อเสนอ")}</td></tr>}
      </tbody></table></div>
      <p className="notice" style={{marginTop:12}}>{t("Hard policy: single-name cap 20%; review threshold 15%; reserve holdings are excluded from equity concentration scoring; all proposals require committee approval and human execution.","นโยบายบังคับ: จำกัดหุ้นรายตัว 20%; เริ่มทบทวนเมื่อเกิน 15%; ตราสารเงินสำรองไม่ถูกนับเป็นความเสี่ยงกระจุกตัวของหุ้น; ทุกข้อเสนอต้องผ่านคณะกรรมการและให้มนุษย์ดำเนินการ")}</p>
    </>}
  </div>;
}
function Metric({label,value,accent}:{label:string;value:string;accent?:string}){return <div className="metric"><div className="label">{label}</div><div className={cls("value",accent)} style={{fontSize:19}}>{value}</div></div>}
