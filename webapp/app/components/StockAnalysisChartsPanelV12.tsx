"use client";

import {useEffect,useState} from "react";
import type {AppLang} from "../page";
import TickerInput from "./TickerInput";
import StockAnalysisChartsV12 from "./StockAnalysisChartsV12";

const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;

export default function StockAnalysisChartsPanelV12({lang}:{lang:AppLang}){
 const[ticker,setTicker]=useState("");
 const[report,setReport]=useState<any>(null);
 const[loading,setLoading]=useState(false);
 const[error,setError]=useState<string|null>(null);

 useEffect(()=>{
  const saved=window.localStorage.getItem("sentinel:selectedResearchTicker")??"";
  if(saved){setTicker(saved);load(saved)}
 },[]);

 async function load(override?:string,event?:React.FormEvent){
  event?.preventDefault();
  const symbol=(override??ticker).trim().toUpperCase();
  if(!symbol)return;
  setLoading(true);setError(null);setReport(null);
  try{
   const engine=window.localStorage.getItem("sentinel:selectedResearchEngine")??"";
   const horizon=window.localStorage.getItem("sentinel:selectedResearchHorizon")??"";
   const query=new URLSearchParams({ticker:symbol});
   if(engine)query.set("engine",engine);
   if(horizon)query.set("horizon",horizon);
   const response=await fetch(`/api/analyze?${query}`,{cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error??"Chart data unavailable");
   window.localStorage.setItem("sentinel:selectedResearchTicker",symbol);
   setTicker(symbol);setReport(json.underwriting);
  }catch(reason:unknown){setError(reason instanceof Error?reason.message:"Chart data unavailable")}finally{setLoading(false)}
 }

 return <div className="workspace-stack" data-visual-analytics-panel="12.2">
  <section className="card" style={{borderTop:"2px solid #31d9f3"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div><span className="tag">VISUAL ANALYTICS</span><h3 className="sub" style={{margin:"10px 0 4px"}}>{tr(lang,"Comparison chart suite","ชุดกราฟเปรียบเทียบข้อมูล")}</h3><p className="muted" style={{margin:0,maxWidth:760}}>{tr(lang,"Load the same underwriting object used by the institutional report, then compare financial, peer, forecast, DCF, score and price-plan evidence visually.","ใช้ข้อมูล Underwriting ชุดเดียวกับรายงาน เพื่อเปรียบเทียบ Financial, Peer, Forecast, DCF, Score และ Price Plan ในรูปแบบกราฟ")}</p></div>
    <span className="tag">NO DUPLICATE CALCULATION</span>
   </div>
   <form className="searchbar" onSubmit={(event)=>load(undefined,event)} style={{marginTop:14}}>
    <TickerInput value={ticker} onChange={setTicker} placeholder="QCOM" onSubmitTicker={(value)=>load(value)}/>
    <button className="btn" disabled={loading}>{loading?tr(lang,"Building charts…","กำลังสร้างกราฟ…"):tr(lang,"Load Comparison Charts","โหลดกราฟเปรียบเทียบ")}</button>
   </form>
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>
  {loading&&<section className="card"><span className="spinner"/> {tr(lang,"Preparing visual analytics…","กำลังเตรียมกราฟวิเคราะห์…")}</section>}
  {report&&<StockAnalysisChartsV12 report={report}/>} 
 </div>
}
