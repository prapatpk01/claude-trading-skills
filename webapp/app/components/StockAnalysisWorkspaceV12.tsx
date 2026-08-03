"use client";

import {useEffect,useState} from "react";
import type {AppLang} from "../page";
import TickerInput from "./TickerInput";

const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;
const money=(value:unknown)=>Number.isFinite(Number(value))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(value)):"—";
const pct=(value:unknown)=>Number.isFinite(Number(value))?`${Number(value)>=0?"+":""}${Number(value).toFixed(1)}%`:"—";
const num=(value:unknown)=>Number.isFinite(Number(value))?Number(value).toLocaleString(undefined,{maximumFractionDigits:1}):"—";

type Props={lang:AppLang};

export default function StockAnalysisWorkspaceV12({lang}:Props){
 const[ticker,setTicker]=useState("");
 const[data,setData]=useState<any>(null);
 const[loading,setLoading]=useState(false);
 const[error,setError]=useState<string|null>(null);

 useEffect(()=>{
  const saved=window.localStorage.getItem("sentinel:selectedResearchTicker");
  if(saved){setTicker(saved);run(undefined,saved)}
 },[]);

 async function run(event?:React.FormEvent,override?:string){
  event?.preventDefault();
  const symbol=(override??ticker).trim().toUpperCase();
  if(!symbol)return;
  setLoading(true);setError(null);setData(null);
  try{
   const engine=window.localStorage.getItem("sentinel:selectedResearchEngine")??"";
   const horizon=window.localStorage.getItem("sentinel:selectedResearchHorizon")??"";
   const query=new URLSearchParams({ticker:symbol});
   if(engine)query.set("engine",engine);
   if(horizon)query.set("horizon",horizon);
   const response=await fetch(`/api/analyze?${query}`,{cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error??"Analysis failed");
   setData(json);
  }catch(reason:unknown){setError(reason instanceof Error?reason.message:"Analysis failed")}finally{setLoading(false)}
 }

 const u=data?.underwriting;
 return <div className="workspace-stack" data-stock-analysis-version="12.0">
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <span className="tag">STOCK ANALYSIS · PHASE 2</span>
   <h2 className="section" style={{margin:"12px 0 6px"}}>{tr(lang,"Institutional Stock Underwriting","การวิเคราะห์หุ้นเชิงลึกระดับสถาบัน")}</h2>
   <p className="muted">{tr(lang,"One stock, one evidence chain and one explicit decision. Research context is preserved, but Stock Analysis independently re-checks valuation, quality, growth, catalysts and risk.","หุ้นหนึ่งตัวใช้หลักฐานชุดเดียวและมีมติชัดเจน โดยรับบริบทจาก Research แต่จะตรวจ Valuation, Quality, Growth, Catalyst และ Risk ใหม่อย่างอิสระ")}</p>
   <form className="searchbar" onSubmit={run} style={{marginTop:16}}>
    <TickerInput value={ticker} onChange={setTicker} placeholder="QCOM" onSubmitTicker={(value)=>run(undefined,value)}/>
    <button className="btn" disabled={loading}>{loading?tr(lang,"Underwriting…","กำลังวิเคราะห์…"):tr(lang,"Analyze Stock","วิเคราะห์หุ้น")}</button>
   </form>
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>

  {loading&&<section className="card"><span className="spinner"/> {tr(lang,"Building underwriting pack…","กำลังสร้างรายงานวิเคราะห์…")}</section>}

  {u&&<>
   <section className="card" style={{borderTop:`2px solid ${u.decision==="BUY"?"var(--green)":u.decision==="AVOID"||u.decision==="BLOCKED"?"var(--red)":"var(--amber)"}`}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
     <div><span className="tag">{u.provenance?.receivedFromResearch?`FROM ${String(u.provenance.researchEngine).toUpperCase()} RESEARCH`:"DIRECT ANALYSIS"}</span><h2 className="section" style={{margin:"10px 0 4px"}}>{data.ticker} · {data.data?.overview?.name??""}</h2><p className="muted">{data.data?.overview?.sector??"—"} · {data.data?.overview?.industry??"—"}</p></div>
     <div style={{textAlign:"right"}}><div style={{fontSize:34,fontWeight:800}}>{u.decision}</div><div className="muted">{tr(lang,"Conviction","ความเชื่อมั่น")} {u.conviction}/100</div></div>
    </div>
    <div className="grid cols-4" style={{marginTop:16}}>
     <Metric label={tr(lang,"Price","ราคาปัจจุบัน")} value={money(u.valuation.price)}/>
     <Metric label={tr(lang,"Target","ราคาเป้าหมาย")} value={money(u.valuation.targetPrice)} sub={pct(u.valuation.upsidePct)}/>
     <Metric label={tr(lang,"Evidence","ความครบถ้วนข้อมูล")} value={`${u.evidence.score}/100`} sub={u.evidence.grade}/>
     <Metric label={tr(lang,"Horizon","ระยะลงทุน")} value={u.horizon}/>
    </div>
    {u.evidence.hardBlocks?.length>0&&<div className="err" style={{marginTop:14}}><strong>{tr(lang,"Hard blocks","เงื่อนไขบล็อก")}:</strong> {u.evidence.hardBlocks.join(" · ")}</div>}
   </section>

   <section className="card">
    <h3 className="sub">1 · {tr(lang,"Valuation & Entry Plan","Valuation และแผนเข้าซื้อ")}</h3>
    <div className="grid cols-4">
     <Metric label="Fair value" value={money(u.valuation.fairValue)}/>
     <Metric label={tr(lang,"Margin of safety","ส่วนเผื่อความปลอดภัย")} value={pct(u.valuation.marginOfSafetyPct)}/>
     <Metric label={tr(lang,"Entry zone","โซนเข้าซื้อ")} value={`${money(u.technical.entryZoneLow)} – ${money(u.technical.entryZoneHigh)}`}/>
     <Metric label="Stop loss" value={money(u.technical.stopLoss)}/>
    </div>
   </section>

   <section className="card">
    <h3 className="sub">2 · {tr(lang,"Quality, Growth & Technical","คุณภาพ การเติบโต และเทคนิค")}</h3>
    <div className="grid cols-3">
     <ScoreCard title="Quality" score={u.quality.score} grade={u.quality.grade} lines={[`ROE ${pct(u.quality.roePct)}`,`Operating margin ${pct(u.quality.operatingMarginPct)}`,`FCF ${num(u.quality.freeCashFlow)}`]}/>
     <ScoreCard title="Growth" score={u.growth.score} grade={u.growth.grade} lines={[`Revenue ${pct(u.growth.revenueGrowthPct)}`,`Earnings ${pct(u.growth.earningsGrowthPct)}`]}/>
     <ScoreCard title="Technical" score={u.technical.score} grade={u.technical.trend} lines={[`Momentum ${u.technical.momentumScore??"—"}/100`,`Entry ${money(u.technical.entryZoneLow)}–${money(u.technical.entryZoneHigh)}`]}/>
    </div>
   </section>

   <section className="card">
    <h3 className="sub">3 · {tr(lang,"Investment Thesis","วิทยานิพนธ์การลงทุน")}</h3>
    <Thesis title="Base" text={u.thesis.base}/><Thesis title="Bull" text={u.thesis.bull}/><Thesis title="Bear" text={u.thesis.bear}/>
   </section>

   <section className="card">
    <h3 className="sub">4 · {tr(lang,"Catalysts, Risks & Monitoring","Catalyst ความเสี่ยง และการติดตาม")}</h3>
    <div className="grid cols-3">
     <ListCard title={tr(lang,"Catalysts","Catalyst")} items={u.catalysts.items}/>
     <ListCard title={tr(lang,"Risks","ความเสี่ยง")} items={u.risks.items}/>
     <ListCard title={tr(lang,"Monitoring","ติดตาม")} items={u.monitoring.items}/>
    </div>
    <div className="notice" style={{marginTop:14}}><strong>{tr(lang,"Review cadence","รอบทบทวน")}:</strong> {u.monitoring.reviewCadence}</div>
   </section>

   <section className="card">
    <h3 className="sub">5 · {tr(lang,"Decision Gate","มติวิเคราะห์")}</h3>
    <div className="grid cols-4">
     <Metric label={tr(lang,"Decision","มติ")} value={u.decision}/>
     <Metric label={tr(lang,"Conviction","ความเชื่อมั่น")} value={`${u.conviction}/100`}/>
     <Metric label={tr(lang,"Valuation status","สถานะ Valuation")} value={u.valuation.status}/>
     <Metric label={tr(lang,"Evidence grade","เกรดข้อมูล")} value={u.evidence.grade}/>
    </div>
    <div className="notice" style={{marginTop:14}}>{tr(lang,"Stock Analysis does not execute trades. BUY means the stock is eligible to be presented to the CIO committee after human review.","Stock Analysis ไม่ได้ซื้อขายหุ้น มติ BUY หมายถึงสามารถส่งเข้าที่ประชุม CIO ได้หลังมนุษย์ตรวจสอบ")}</div>
   </section>
  </>}
 </div>
}

function Metric({label,value,sub}:{label:string;value:string;sub?:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong>{sub&&<small className="muted">{sub}</small>}</div>}
function ScoreCard({title,score,grade,lines}:{title:string;score:number;grade:string;lines:string[]}){return <div className="card" style={{padding:18}}><span className="tag">{title}</span><div style={{fontSize:34,fontWeight:800,marginTop:10}}>{score}/100</div><strong>{grade}</strong>{lines.map(line=><p className="muted" key={line} style={{margin:"8px 0 0"}}>{line}</p>)}</div>}
function Thesis({title,text}:{title:string;text:string}){return <div className="notice" style={{marginTop:10}}><strong>{title}</strong><p style={{margin:"7px 0 0"}}>{text}</p></div>}
function ListCard({title,items}:{title:string;items:string[]}){return <div className="card" style={{padding:18}}><h4 style={{marginTop:0}}>{title}</h4>{items?.length?items.map(item=><p key={item} className="muted">• {item}</p>):<p className="muted">—</p>}</div>}
