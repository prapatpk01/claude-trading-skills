"use client";
import { useCallback, useEffect, useState } from "react";
import type { AppLang } from "../page";

const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
export default function V9InstitutionalStatus({lang}:{lang:AppLang}){
  const [data,setData]=useState<any>(null);const [loading,setLoading]=useState(false);const [error,setError]=useState<string|null>(null);
  const load=useCallback(async()=>{setLoading(true);setError(null);try{const r=await fetch("/api/v9/health",{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Health check failed");setData(j);}catch(e:any){setError(e.message)}finally{setLoading(false)}},[]);
  useEffect(()=>{load()},[load]);
  const ok=data?.status==="PASS";
  return <section className="card ai-card" style={{marginTop:18}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
      <div><h2 className="section" style={{margin:0}}>◈ Sentinel Investment OS v9.0</h2><p className="muted" style={{margin:"6px 0 0"}}>{tr(lang,"Institutional release, evidence and governance status","สถานะ Release หลักฐาน และธรรมาภิบาลระดับสถาบัน")}</p></div>
      <button className="btn ghost sm" onClick={load} disabled={loading}>{loading?"…":"↻ Refresh"}</button>
    </div>
    {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
    {data&&<>
      <div className="grid cols-4" style={{marginTop:14}}>
        <Metric label={tr(lang,"Release status","สถานะ Release")} value={data.status} good={ok}/>
        <Metric label={tr(lang,"Production ready","พร้อม Production")} value={data.productionReady?"YES":"NOT YET"} good={data.productionReady}/>
        <Metric label={tr(lang,"Database admin","สิทธิ์ฐานข้อมูล")} value={data.database?.serviceRole?"SECURE":"MISSING"} good={data.database?.serviceRole}/>
        <Metric label={tr(lang,"Execution mode","โหมดส่งคำสั่ง")} value="HUMAN ONLY" good/>
      </div>
      <div className="grid cols-3" style={{marginTop:12}}>
        <div className="metric"><div className="label">{tr(lang,"Validated controls","ระบบควบคุม")}</div><div style={{marginTop:8,fontSize:12,lineHeight:1.65}}>{Object.entries(data.controls??{}).map(([k,v])=><div key={k}>{v?"✓":"✕"} {k}</div>)}</div></div>
        <div className="metric"><div className="label">{tr(lang,"API readiness","ความพร้อม API")}</div><div style={{marginTop:8,fontSize:12,lineHeight:1.65}}>{(data.endpoints??[]).map((x:any)=><div key={x.path}>{x.ok?"✓":"✕"} {x.path} · {x.status}</div>)}</div></div>
        <div className="metric"><div className="label">{tr(lang,"Database evidence","ข้อมูลในฐานข้อมูล")}</div><div style={{marginTop:8,fontSize:12,lineHeight:1.65}}>{Object.entries(data.database?.checks??{}).map(([k,v]:any)=><div key={k}>{v.ok?"✓":"✕"} {k} · {v.count??"—"}</div>)}</div></div>
      </div>
      {(data.blockers??[]).length>0&&<div className="notice" style={{marginTop:12}}><strong>{tr(lang,"Release blockers:","สิ่งที่ยังขวาง Release:")}</strong> {data.blockers.join(" · ")}</div>}
      <p className="muted" style={{fontSize:11,marginBottom:0}}>{tr(lang,"No recommendation executes automatically. Human authorization remains mandatory.","ไม่มีคำแนะนำใดส่งคำสั่งซื้อขายอัตโนมัติ ทุกการดำเนินการต้องได้รับอนุมัติจากมนุษย์")}</p>
    </>}
  </section>
}
function Metric({label,value,good}:{label:string;value:string;good?:boolean}){return <div className="metric"><div className="label">{label}</div><div className={good?"value pos":"value"} style={{fontSize:19}}>{value}</div></div>}
