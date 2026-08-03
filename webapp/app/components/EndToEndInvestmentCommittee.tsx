"use client";
import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";
import CommitteeMeetingV10 from "./CommitteeMeetingV10";

async function getJson(path:string){
 const response=await fetch(path,{cache:"no-store",headers:{Accept:"application/json"}});
 const type=response.headers.get("content-type")??"";
 const raw=await response.text();
 if(!type.includes("application/json"))throw new Error(`${path} returned non-JSON data`);
 const json=raw?JSON.parse(raw):{};
 if(!response.ok)throw new Error(json?.error||path);
 return json;
}
const finite=(value:unknown):number|null=>{const number=typeof value==="number"?value:Number(value);return Number.isFinite(number)?number:null};
const money=(value:number|null)=>value==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(value);

export default function EndToEndInvestmentCommittee({lang}:{lang:AppLang}){
 const[data,setData]=useState<any>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[refresh,setRefresh]=useState(0);
 useEffect(()=>{
  let active=true;
  setLoading(true);
  setError(null);
  const sources=[
   getJson("/api/v10/cio"),
   getJson("/api/portfolio"),
   getJson("/api/portfolio/optimizer"),
   getJson("/api/portfolio/opportunity-allocation"),
   getJson("/api/portfolio/cash-buffer"),
   getJson("/api/macro/intelligence"),
  ];
  Promise.allSettled(sources).then(results=>{
   if(!active)return;
   const values=results.map(result=>result.status==="fulfilled"?result.value:{});
   setData({cio:values[0],portfolio:values[1],optimizer:values[2],allocation:values[3],buffer:values[4],macro:values[5]});
   const failed=results.filter(result=>result.status==="rejected").length;
   setError(failed?`${failed} data source(s) unavailable; the meeting continued with partial evidence.`:null);
  }).finally(()=>active&&setLoading(false));
  return()=>{active=false};
 },[refresh]);

 const meeting=useMemo(()=>{
  const decisions=Array.isArray(data?.cio?.decisions)?data.cio.decisions:[];
  const macroDecision=decisions.find((item:any)=>String(item?.desk).toUpperCase()==="MACRO")??{};
  const macroText=`${macroDecision.action??""} ${macroDecision.reason??""}`.toUpperCase();
  const defensive=/DEFENSIVE|RISK OFF|BEAR|CAUTION/.test(macroText);
  const riskOn=/RISK ON|BULL|AGGRESSIVE/.test(macroText);
  const proposals=Array.isArray(data?.optimizer?.proposals)?data.optimizer.proposals:[];
  const allocations=Array.isArray(data?.allocation?.allocations)?data.allocation.allocations:[];
  const holdings=(Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[]).filter((item:any)=>!item.closed_at);
  const destinations=allocations.map((item:any)=>({
   ticker:String(item?.ticker??"").trim().toUpperCase(),
   amount:finite(item?.approvedCapitalUsd),
  })).filter((item:{ticker:string;amount:number|null})=>Boolean(item.ticker)&&item.amount!=null&&item.amount>0);
  const deployable=finite(data?.allocation?.portfolio?.deployableCapitalUsd??data?.buffer?.gapValue);
  const committed=destinations.reduce((sum:number,item:{amount:number|null})=>sum+(item.amount??0),0);
  const fundingText=destinations.length
   ?`TRIM SGOV ${money(Math.min(deployable??committed,committed))} → ${destinations.map((item:{ticker:string;amount:number|null})=>`${item.ticker} ${money(item.amount)}`).join(" + ")}`
   :`KEEP ${money(deployable)} IN SGOV — NO SALE AUTHORIZED`;
  const valuationAdds=proposals.filter((item:any)=>/ADD|OPEN|BUY/.test(String(item?.action??"").toUpperCase())).length;
  const trims=proposals.filter((item:any)=>/TRIM|REDUCE/.test(String(item?.action??"").toUpperCase())).length;
  const exits=proposals.filter((item:any)=>/EXIT|SELL/.test(String(item?.action??"").toUpperCase())).length;
  return{
   posture:defensive?"DEFENSIVE":riskOn?"GROWTH / RISK-ON":"BALANCED / SELECTIVE",
   cash:defensive?15:riskOn?5:10,
   open:holdings.length,
   add:destinations.length,
   trim:trims,
   exit:exits,
   deployable,
   fundingText,
   destinations,
   valuationAdds,
   watch:proposals.filter((item:any)=>/WATCH|HOLD/.test(String(item?.action??"").toUpperCase())).length,
   direction:defensive?"Raise cash, trim weak holdings, exit broken theses and wait for better risk/reward.":riskOn?"Deploy selectively into approved themes and high-conviction holdings.":"Keep a balanced book and fund only positive-upside ideas.",
   macro:macroDecision.reason??data?.macro?.summary??"Macro rationale pending.",
   macroRegime:data?.macro?.regime?.classification??data?.macro?.regime?.label??"Neutral",
   macroScore:finite(data?.macro?.regime?.score)??50,
  };
 },[data]);

 return <>
  <section className="card" style={{borderTop:"2px solid var(--accent)",marginBottom:18}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
    <div><div className="muted" style={{fontSize:11,letterSpacing:1.2}}>END-TO-END INVESTMENT COMMITTEE</div><h2 className="section" style={{margin:"6px 0"}}>{lang==="th"?"การประชุมบริหารการลงทุนทั้งกองทุน":"FULL FUND INVESTMENT MANDATE"}</h2><p className="muted" style={{margin:0}}>One meeting runs Macro, Portfolio Review, Valuation, opportunity search, funding, voting and the final rebalance package.</p></div>
    <button className="btn" onClick={()=>setRefresh(value=>value+1)} disabled={loading}>{loading?"Running all desks…":"Run Full Fund Meeting"}</button>
   </div>
   {error&&<div className="notice" style={{marginTop:12}}>⚠ {error}</div>}
   <div className="grid cols-4" style={{marginTop:14}}><div className="metric"><span>Fund posture</span><strong>{loading?"…":meeting.posture}</strong></div><div className="metric"><span>Target cash</span><strong>{loading?"…":`${meeting.cash}%`}</strong></div><div className="metric"><span>Deployable</span><strong>{loading?"…":money(meeting.deployable)}</strong></div><div className="metric"><span>Open holdings</span><strong>{loading?"…":meeting.open}</strong></div></div>
   <div className="grid cols-4" style={{marginTop:9}}><div className="metric"><span>ADD / OPEN</span><strong>{loading?"…":meeting.add}</strong></div><div className="metric"><span>TRIM</span><strong>{loading?"…":meeting.trim}</strong></div><div className="metric"><span>EXIT</span><strong>{loading?"…":meeting.exit}</strong></div><div className="metric"><span>Meeting scope</span><strong>8 stages</strong></div></div>
   {!loading&&<div className="notice" style={{marginTop:12,lineHeight:1.6}}><strong>Strategic direction:</strong> {meeting.direction}<br/><span className="muted">Macro: {meeting.macro}</span></div>}

   <div className="grid cols-3" style={{marginTop:12}}>
    <div className="metric"><div className="label">🌐 MACRO DESK</div><div className="value" style={{fontSize:18}}>{meeting.macroRegime} · {meeting.macroScore}/100</div><div className="sub">Regime, sentiment, news and allocation are included in this meeting.</div></div>
    <div className="metric"><div className="label">⚖ PORTFOLIO REVIEW</div><div className="value" style={{fontSize:18}}>{meeting.open} holdings reviewed</div><div className="sub">ADD {meeting.add} · TRIM {meeting.trim} · EXIT {meeting.exit}</div></div>
    <div className="metric"><div className="label">💰 VALUATION REVIEW</div><div className="value" style={{fontSize:18}}>ADD {meeting.valuationAdds} · WATCH {meeting.watch}</div><div className="sub">Fair value and sizing feed the same committee resolution.</div></div>
   </div>

   <div className="notice" style={{marginTop:12,lineHeight:1.6,borderColor:"rgba(72,228,167,.38)"}}><strong>Funding destination:</strong> {meeting.fundingText}</div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,marginTop:12}}>{["1 Macro & Regime","2 Cash / Risk Budget","3 Holdings + Valuation Review","4 Theme / Stock Search","5 ADD / TRIM / EXIT","6 Funding Destination","7 Committee Vote","8 Execution & Minutes"].map(label=><div className="tag" style={{padding:"10px 12px"}} key={label}>{label}</div>)}</div>
  </section>
  <CommitteeMeetingV10 key={refresh} lang={lang}/>
 </>;
}
