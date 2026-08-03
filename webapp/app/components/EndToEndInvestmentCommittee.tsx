"use client";
import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";

type Action="OPEN NEW"|"ADD EXISTING"|"TRIM"|"EXIT";
type MeetingItem={ticker:string;action:Action;amount:number;reason:string;approved:boolean;votes:string[]};
const desks=["CIO","MACRO","RESEARCH","RISK","QUANT","PORTFOLIO","TREASURY"];
const finite=(v:unknown):number|null=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null};
const usd=(v:number|null)=>v==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v);
async function getJson(path:string,init?:RequestInit){const r=await fetch(path,{cache:"no-store",headers:{Accept:"application/json","Content-Type":"application/json",...(init?.headers??{})},...init});const raw=await r.text();let json:any={};try{json=raw?JSON.parse(raw):{}}catch{throw new Error(`${path} returned invalid JSON`)}if(!r.ok)throw new Error(json?.error??`${path} returned ${r.status}`);return json}

export default function EndToEndInvestmentCommittee({lang}:{lang:AppLang}){
 const[data,setData]=useState<any>(null),[cycle,setCycle]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[selected,setSelected]=useState<Record<string,boolean>>({}),[submitting,setSubmitting]=useState(false),[execution,setExecution]=useState<any>(null);
 useEffect(()=>{let active=true;setLoading(true);setError(null);setExecution(null);Promise.allSettled([
  getJson("/api/macro/intelligence"),getJson("/api/v10/cio"),getJson("/api/portfolio"),getJson("/api/portfolio/optimizer"),getJson("/api/portfolio/opportunity-allocation"),getJson("/api/portfolio/cash-buffer")
 ]).then(results=>{if(!active)return;const values=results.map(x=>x.status==="fulfilled"?x.value:{});setData({macro:values[0],cio:values[1],portfolio:values[2],optimizer:values[3],allocation:values[4],buffer:values[5]});const failed=results.filter(x=>x.status==="rejected").length;setError(failed?`${failed} meeting source(s) unavailable; unresolved evidence was excluded.`:null);setSelected({})}).finally(()=>active&&setLoading(false));return()=>{active=false}},[cycle]);

 const meeting=useMemo(()=>{
  const holdings=(Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[]).filter((x:any)=>!x.closed_at);
  const macroScore=finite(data?.macro?.regime?.score)??50;
  const macroLabel=String(data?.macro?.regime?.classification??data?.macro?.regime?.label??"NEUTRAL").toUpperCase();
  const riskOff=macroScore<40||/BEAR|RISK.OFF|DEFENSIVE/.test(macroLabel);
  const riskOn=macroScore>=65||/BULL|RISK.ON|EXPANSION/.test(macroLabel);
  const posture=riskOff?"REDUCE RISK / RAISE CASH":riskOn?"ADVANCE SELECTIVELY":"BALANCED / SELECTIVE";
  const cashTarget=riskOff?15:riskOn?5:10;
  const macroVotes=desks.map(d=>`${d}: ${riskOff?(d==="RISK"||d==="TREASURY"?"REDUCE RISK":"CAUTION"):(riskOn?(d==="RISK"?"SELECTIVE":"INVEST"):"SELECTIVE")}`);

  const optimizer=Array.isArray(data?.optimizer?.proposals)?data.optimizer.proposals:[];
  const portfolioItems:MeetingItem[]=optimizer.flatMap((x:any)=>{const ticker=String(x?.ticker??"").trim().toUpperCase();const raw=String(x?.action??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY")return[];const action:Action|null=/TRIM|REDUCE/.test(raw)?"TRIM":/EXIT|SELL/.test(raw)?"EXIT":/ADD|BUY/.test(raw)?"ADD EXISTING":null;if(!action)return[];const amount=Math.max(0,finite(x?.capitalUsd??x?.amountUsd)??0);const supportive=action==="TRIM"||action==="EXIT"?riskOff||finite(x?.score)!=null:riskOn||macroScore>=45;return[{ticker,action,amount,reason:String(x?.reason??"Portfolio review recommendation."),approved:supportive,votes:desks.map(d=>`${d}: ${supportive?"SUPPORT":"HOLD"}`)}]});

  const allocations=Array.isArray(data?.allocation?.allocations)?data.allocation.allocations:[];
  const held=new Set(holdings.map((x:any)=>String(x?.ticker??"").toUpperCase()));
  const strategyItems:MeetingItem[]=allocations.flatMap((x:any)=>{const ticker=String(x?.ticker??"").trim().toUpperCase();const amount=Math.max(0,finite(x?.approvedCapitalUsd)??0);if(!ticker||amount<=0)return[];const action:Action=held.has(ticker)?"ADD EXISTING":"OPEN NEW";const upside=finite(x?.expectedReturnPct);const conviction=finite(x?.conviction);const approved=!riskOff&&(upside==null||upside>=8)&&(conviction==null||conviction>=60);return[{ticker,action,amount,reason:String(x?.thesis??"Research allocation candidate."),approved,votes:desks.map(d=>`${d}: ${approved?(d==="RISK"?"SIZE CONTROL":"BUY"):(d==="TREASURY"?"KEEP CASH":"HOLD")}`)}]});

  const approved=[...portfolioItems,...strategyItems].filter(x=>x.approved);
  const reserve=finite(data?.allocation?.portfolio?.deployableCapitalUsd??data?.buffer?.gapValue)??0;
  return{holdings,macroScore,macroLabel,posture,cashTarget,macroVotes,portfolioItems,strategyItems,approved,reserve};
 },[data]);

 const key=(x:MeetingItem)=>`${x.action}:${x.ticker}`;
 const selectedItems=meeting.approved.filter(x=>selected[key(x)]);
 const buys=selectedItems.filter(x=>x.action==="OPEN NEW"||x.action==="ADD EXISTING");
 const sells=selectedItems.filter(x=>x.action==="TRIM"||x.action==="EXIT");
 const buyTotal=buys.reduce((s,x)=>s+x.amount,0),sellTotal=sells.reduce((s,x)=>s+x.amount,0),reserveNeeded=Math.max(0,buyTotal-sellTotal);
 const funding=buys.length?`TRIM SGOV ${usd(Math.min(meeting.reserve,reserveNeeded))} → ${buys.map(x=>`${x.ticker} ${usd(x.amount)}`).join(" + ")}`:`KEEP ${usd(meeting.reserve)} IN SGOV — NO SALE AUTHORIZED`;
 const selectApproved=()=>setSelected(Object.fromEntries(meeting.approved.map(x=>[key(x),true])));
 const toggle=(x:MeetingItem)=>setSelected(s=>({...s,[key(x)]:!s[key(x)]}));
 async function submit(){if(!selectedItems.length)return;setSubmitting(true);setError(null);try{const result=await getJson("/api/portfolio/rebalance-execution",{method:"POST",body:JSON.stringify({humanApproved:true,humanApprovedBy:"portfolio_owner",meetingCode:`IC-${new Date().toISOString().slice(0,10)}`,reserveTicker:"SGOV",deployable:meeting.reserve,portfolioBefore:data?.portfolio??{},macro:{label:meeting.macroLabel,score:meeting.macroScore,posture:meeting.posture},items:selectedItems})});setExecution(result)}catch(e:any){setError(e?.message??"Execution package failed")}finally{setSubmitting(false)}}
 const agendaStyle={border:"1px solid rgba(119,137,255,.28)",borderRadius:18,padding:18,marginTop:14,background:"rgba(7,18,45,.52)"} as const;
 return <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:11,letterSpacing:1.4}}>END-TO-END INVESTMENT COMMITTEE · SINGLE MEETING STATE</div><h2 className="section" style={{margin:"6px 0"}}>{lang==="th"?"ศูนย์ประชุมและบริหารกองทุน":"FULL FUND MEETING"}</h2><p className="muted" style={{margin:0}}>Macro → Portfolio → Investment Plan → Final Resolution. One meeting, one funding plan, one execution package.</p></div><button className="btn" onClick={()=>setCycle(x=>x+1)} disabled={loading}>{loading?"Running meeting…":"Run Full Fund Meeting"}</button></div>
  {error&&<div className="notice" style={{marginTop:12}}>⚠ {error}</div>}{execution&&<div className="notice" style={{marginTop:12,borderColor:"rgba(72,228,167,.45)"}}>✓ Package {execution.package?.packageId} · {execution.package?.status}</div>}

  <section style={agendaStyle}><h3>1 · MACRO, REGIME & SENTIMENT</h3><div className="grid cols-4"><Metric l="Regime" v={meeting.macroLabel}/><Metric l="Macro score" v={`${meeting.macroScore}/100`}/><Metric l="Fund posture" v={meeting.posture}/><Metric l="Target cash" v={`${meeting.cashTarget}%`}/></div><p className="notice"><strong>Macro report:</strong> {data?.macro?.summary??"Market evidence is mixed; deploy only where risk/reward is positive."}</p><Votes rows={meeting.macroVotes}/></section>

  <section style={agendaStyle}><h3>2 · PORTFOLIO REVIEW & CAPITAL RELEASE</h3><p className="muted">Review {meeting.holdings.length} open holdings, propose ADD / TRIM / EXIT, and determine how much capital becomes available.</p><Items items={meeting.portfolioItems} selected={selected} toggle={toggle}/>{!meeting.portfolioItems.length&&<div className="notice">No holding adjustment cleared the portfolio review. Existing holdings remain unchanged.</div>}</section>

  <section style={agendaStyle}><h3>3 · INVESTMENT STRATEGY, RESEARCH & CAPITAL ALLOCATION</h3><p className="muted">Research proposes investable themes and securities. The committee may fund all approved ideas or select only the highest-conviction candidates.</p><Items items={meeting.strategyItems} selected={selected} toggle={toggle}/>{!meeting.strategyItems.length&&<div className="notice">No new strategy candidate passed research, valuation and risk gates. Cash remains in SGOV.</div>}</section>

  <section style={agendaStyle}><h3>4 · FINAL RESOLUTION, FUNDING & EXECUTION</h3><div className="grid cols-4"><Metric l="Approved ideas" v={String(meeting.approved.length)}/><Metric l="Human selected" v={String(selectedItems.length)}/><Metric l="Buy total" v={usd(buyTotal)}/><Metric l="Capital released" v={usd(sellTotal)}/></div><div className="notice" style={{marginTop:12,borderColor:"rgba(72,228,167,.4)"}}><strong>Funding plan:</strong> {funding}</div><div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:12}}><button className="btn ghost" onClick={selectApproved} disabled={!meeting.approved.length}>Select All Approved</button><button className="btn" onClick={submit} disabled={!selectedItems.length||submitting}>{submitting?"Submitting…":`Submit Rebalance Package (${selectedItems.length})`}</button></div><div className="notice" style={{marginTop:12}}><strong>Meeting minutes:</strong> Macro posture {meeting.posture}. Portfolio actions: {meeting.portfolioItems.filter(x=>selected[key(x)]).map(x=>`${x.action} ${x.ticker} ${usd(x.amount)}`).join(", ")||"none"}. Investment plan: {buys.map(x=>`${x.action} ${x.ticker} ${usd(x.amount)}`).join(", ")||"keep reserve in SGOV"}. Human approval remains mandatory.</div></section>
 </section>
}
function Metric({l,v}:{l:string;v:string}){return <div className="metric"><span>{l}</span><strong style={{fontSize:17}}>{v}</strong></div>}
function Votes({rows}:{rows:string[]}){return <div className="grid cols-4" style={{marginTop:10}}>{rows.map(x=><div className="metric" key={x}><span>{x.split(":")[0]}</span><strong style={{fontSize:14}}>{x.split(":").slice(1).join(":")}</strong></div>)}</div>}
function Items({items,selected,toggle}:{items:MeetingItem[];selected:Record<string,boolean>;toggle:(x:MeetingItem)=>void}){return <div style={{display:"grid",gap:10,marginTop:12}}>{items.map(x=>{const k=`${x.action}:${x.ticker}`;return <article className="metric" key={k} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:12,alignItems:"start"}}><div><span>{x.action}</span><strong style={{display:"block",fontSize:20}}>{x.ticker} · {usd(x.amount)}</strong><small>{x.reason}</small><div style={{marginTop:8,fontSize:11}}>{x.votes.join(" · ")}</div></div><label style={{display:"grid",gap:6,justifyItems:"center"}}><input type="checkbox" checked={Boolean(selected[k])} disabled={!x.approved} onChange={()=>toggle(x)}/><b style={{fontSize:11}}>{x.approved?"APPROVED":"HOLD"}</b></label></article>})}</div>}
