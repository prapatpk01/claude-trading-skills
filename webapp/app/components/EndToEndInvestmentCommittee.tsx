"use client";
import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";
import CommitteeMeetingV10 from "./CommitteeMeetingV10";

async function getJson(path:string){
 const response=await fetch(path,{cache:"no-store",credentials:"same-origin",headers:{Accept:"application/json"}});
 const contentType=response.headers.get("content-type")??"";
 if(!contentType.includes("application/json"))throw new Error(`${path} returned ${response.status} ${contentType||"non-JSON response"}`);
 const json=await response.json();
 if(!response.ok)throw new Error(json?.error||path);
 return json;
}
const money=(v:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v||0);

export default function EndToEndInvestmentCommittee({lang}:{lang:AppLang}){
 const[data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[meetingCycle,setMeetingCycle]=useState(0);
 useEffect(()=>{
  let active=true;
  setLoading(true);
  setError(null);
  Promise.allSettled([
   getJson("/api/v10/cio"),
   getJson("/api/portfolio"),
   getJson("/api/portfolio/optimizer"),
   getJson("/api/portfolio/opportunity-allocation"),
   getJson("/api/portfolio/cash-buffer"),
  ]).then(results=>{
   if(!active)return;
   const values=results.map(result=>result.status==="fulfilled"?result.value:{});
   setData({cio:values[0],portfolio:values[1],optimizer:values[2],allocation:values[3],buffer:values[4]});
   const failures=results.filter(result=>result.status==="rejected").length;
   setError(failures?`${failures} data source(s) unavailable; meeting continued with partial data.`:null);
  }).finally(()=>active&&setLoading(false));
  return()=>{active=false};
 },[meetingCycle]);
 const m=useMemo(()=>{
  const decisions=data?.cio?.decisions??[];
  const macro=decisions.find((x:any)=>String(x?.desk).toUpperCase()==="MACRO")??{};
  const raw=`${macro.action??""} ${macro.reason??""}`.toUpperCase();
  const defensive=/DEFENSIVE|RISK OFF|BEAR|CAUTION/.test(raw),riskOn=/RISK ON|BULL|AGGRESSIVE/.test(raw);
  const proposals=data?.optimizer?.proposals??[],alloc=data?.allocation?.allocations??[],holdings=(data?.portfolio?.holdings??[]).filter((x:any)=>!x.closed_at);
  return{
   posture:defensive?"DEFENSIVE":riskOn?"GROWTH / RISK-ON":"BALANCED / SELECTIVE",
   cash:defensive?15:riskOn?5:10,
   open:holdings.length,
   add:alloc.filter((x:any)=>Number(x?.approvedCapitalUsd)>0).length,
   trim:proposals.filter((x:any)=>/TRIM|REDUCE/.test(String(x?.action??"").toUpperCase())).length,
   exit:proposals.filter((x:any)=>/EXIT|SELL/.test(String(x?.action??"").toUpperCase())).length,
   deployable:Number(data?.allocation?.portfolio?.deployableCapitalUsd??data?.buffer?.gapValue??0)||0,
   direction:defensive?"Raise cash, trim weak holdings, exit broken theses and wait for better risk/reward.":riskOn?"Deploy selectively into approved themes and high-conviction holdings.":"Keep a balanced book and fund only positive-upside ideas.",
   macro:macro.reason??"Macro rationale pending.",
  };
 },[data]);
 const runMeeting=()=>setMeetingCycle(cycle=>cycle+1);
 return <>
  <section className="card" style={{borderTop:"2px solid var(--accent)",marginBottom:18}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
    <div>
     <div className="muted" style={{fontSize:11,letterSpacing:1.2}}>END-TO-END INVESTMENT COMMITTEE</div>
     <h2 className="section" style={{margin:"6px 0"}}>{lang==="th"?"การประชุมบริหารการลงทุนทั้งกองทุน":"FULL FUND INVESTMENT MANDATE"}</h2>
     <p className="muted" style={{margin:0}}>One meeting sets regime, cash target, risk posture, holding actions, opportunity search, funding and the final rebalance package.</p>
    </div>
    <button className="btn" onClick={runMeeting} disabled={loading}>{loading?"Consolidating…":"Run Full Fund Meeting"}</button>
   </div>
   {error&&<div className="notice" style={{marginTop:12}}>⚠ {error}</div>}
   <div className="grid cols-4" style={{marginTop:14}}>
    <div className="metric"><span>Fund posture</span><strong>{loading?"…":m.posture}</strong></div>
    <div className="metric"><span>Target cash</span><strong>{loading?"…":`${m.cash}%`}</strong></div>
    <div className="metric"><span>Deployable</span><strong>{loading?"…":money(m.deployable)}</strong></div>
    <div className="metric"><span>Open holdings</span><strong>{loading?"…":m.open}</strong></div>
   </div>
   <div className="grid cols-4" style={{marginTop:9}}>
    <div className="metric"><span>ADD / OPEN</span><strong>{loading?"…":m.add}</strong></div>
    <div className="metric"><span>TRIM</span><strong>{loading?"…":m.trim}</strong></div>
    <div className="metric"><span>EXIT</span><strong>{loading?"…":m.exit}</strong></div>
    <div className="metric"><span>Meeting scope</span><strong>8 stages</strong></div>
   </div>
   {!loading&&<div className="notice" style={{marginTop:12,lineHeight:1.6}}><strong>Strategic direction:</strong> {m.direction}<br/><span className="muted">Macro: {m.macro}</span></div>}
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,marginTop:12}}>{["1 Macro & Regime","2 Cash / Risk Budget","3 Holdings Review","4 Theme / Stock Search","5 ADD / TRIM / EXIT","6 Funding Plan","7 Committee Vote","8 Execution & Minutes"].map(x=><div className="tag" style={{padding:"10px 12px"}} key={x}>{x}</div>)}</div>
  </section>
  <CommitteeMeetingV10 key={`meeting-cycle-${meetingCycle}`} lang={lang}/>
 </>;
}
