"use client";
import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";

type Action="OPEN NEW"|"ADD EXISTING"|"TRIM"|"EXIT";
type MeetingItem={ticker:string;action:Action;amount:number;reason:string;approved:boolean;votes:string[];upside:number|null;conviction:number|null;target:number|null;price:number|null;risks:string[];monitoring:string[]};
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
  const macroDrivers=[
   {label:"Trend",score:Math.round(macroScore*.30),view:macroScore>=55?"supportive":"soft"},
   {label:"Liquidity",score:Math.round(macroScore*.20),view:macroScore>=50?"adequate":"tight"},
   {label:"Breadth",score:Math.round(macroScore*.18),view:macroScore>=60?"broad":"narrow"},
   {label:"Volatility",score:Math.round((100-macroScore)*.16),view:riskOff?"elevated":"contained"},
   {label:"Valuation",score:Math.round((100-macroScore)*.10),view:riskOn?"acceptable":"selective"},
   {label:"Sentiment",score:Math.round(macroScore*.06),view:macroScore>70?"crowded":macroScore<35?"fearful":"neutral"},
  ];
  const transcript=[
   {desk:"CIO",text:riskOff?"Protect capital first; raise cash and remove broken theses.":riskOn?"Advance, but only into high-conviction ideas with defined risk.":"Maintain a balanced book and approve only asymmetric opportunities."},
   {desk:"MACRO",text:`Regime is ${macroLabel}; liquidity and breadth justify a ${posture.toLowerCase()} stance.`},
   {desk:"RESEARCH",text:"Do not force activity. Only candidates with evidence, positive upside and durable thesis proceed."},
   {desk:"RISK",text:riskOff?"Cut exposure and concentration before adding risk.":"Approve only with position-size controls and explicit invalidation levels."},
   {desk:"QUANT",text:"Rank opportunities by expected return, conviction and data quality; reject weak evidence."},
   {desk:"PORTFOLIO",text:"Do not sell winners solely because they appreciated; act only on drift, risk or thesis deterioration."},
   {desk:"TREASURY",text:"SGOV remains reserve capital until a named destination is human-approved."},
  ];

  const optimizer=Array.isArray(data?.optimizer?.proposals)?data.optimizer.proposals:[];
  const portfolioItems:MeetingItem[]=optimizer.flatMap((x:any)=>{const ticker=String(x?.ticker??"").trim().toUpperCase();const raw=String(x?.action??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY")return[];const action:Action|null=/TRIM|REDUCE/.test(raw)?"TRIM":/EXIT|SELL/.test(raw)?"EXIT":/ADD|BUY/.test(raw)?"ADD EXISTING":null;if(!action)return[];const amount=Math.max(0,finite(x?.capitalUsd??x?.amountUsd)??0);const supportive=action==="TRIM"||action==="EXIT"?riskOff||finite(x?.score)!=null:riskOn||macroScore>=45;return[{ticker,action,amount,reason:String(x?.reason??"Portfolio review recommendation."),approved:supportive,votes:deskVotes(action,supportive,riskOff),upside:finite(x?.expectedReturnPct),conviction:finite(x?.score),target:finite(x?.targetPrice),price:finite(x?.price),risks:["Position concentration","Thesis deterioration","Correlation shock"],monitoring:["Weight drift","Price trend","Earnings revisions"]}]});

  const allocations=Array.isArray(data?.allocation?.allocations)?data.allocation.allocations:[];
  const held=new Set(holdings.map((x:any)=>String(x?.ticker??"").toUpperCase()));
  const strategyItems:MeetingItem[]=allocations.flatMap((x:any)=>{const ticker=String(x?.ticker??"").trim().toUpperCase();const amount=Math.max(0,finite(x?.approvedCapitalUsd)??0);if(!ticker||amount<=0)return[];const action:Action=held.has(ticker)?"ADD EXISTING":"OPEN NEW";const upside=finite(x?.expectedReturnPct);const conviction=finite(x?.conviction);const target=finite(x?.targetPrice);const price=finite(x?.price);const approved=!riskOff&&(upside==null||upside>=8)&&(conviction==null||conviction>=60)&&(target==null||price==null||target>price);return[{ticker,action,amount,reason:String(x?.thesis??"Research allocation candidate."),approved,votes:deskVotes(action,approved,riskOff),upside,conviction,target,price,risks:Array.isArray(x?.risks)?x.risks.map(String):["Execution risk","Valuation compression","Catalyst delay"],monitoring:Array.isArray(x?.monitoring)?x.monitoring.map(String):["Revenue growth","Free cash flow","Guidance and valuation"]}]});

  const approved=[...portfolioItems,...strategyItems].filter(x=>x.approved);
  const reserve=finite(data?.allocation?.portfolio?.deployableCapitalUsd??data?.buffer?.gapValue)??0;
  const marketValue=holdings.reduce((s:number,x:any)=>s+Math.max(0,(finite(x?.shares)??0)*(finite(x?.price??x?.avg_cost)??0)),0);
  const review={count:holdings.length,largest:holdings.slice().sort((a:any,b:any)=>((finite(b?.shares)??0)*(finite(b?.price??b?.avg_cost)??0))-((finite(a?.shares)??0)*(finite(a?.price??a?.avg_cost)??0)))[0],watch:portfolioItems.filter(x=>!x.approved).length,actions:portfolioItems.length};
  return{holdings,macroScore,macroLabel,posture,cashTarget,macroDrivers,transcript,portfolioItems,strategyItems,approved,reserve,marketValue,review};
 },[data]);

 const key=(x:MeetingItem)=>`${x.action}:${x.ticker}`;
 const selectedItems=meeting.approved.filter(x=>selected[key(x)]);
 const buys=selectedItems.filter(x=>x.action==="OPEN NEW"||x.action==="ADD EXISTING");
 const sells=selectedItems.filter(x=>x.action==="TRIM"||x.action==="EXIT");
 const buyTotal=buys.reduce((s,x)=>s+x.amount,0),sellTotal=sells.reduce((s,x)=>s+x.amount,0),reserveNeeded=Math.max(0,buyTotal-sellTotal);
 const reserveUsed=Math.min(meeting.reserve,reserveNeeded);
 const funding=buys.length?`TRIM SGOV ${usd(reserveUsed)} → ${buys.map(x=>`${x.ticker} ${usd(x.amount)}`).join(" + ")}`:`KEEP ${usd(meeting.reserve)} IN SGOV — NO SALE AUTHORIZED`;
 const projectedCash=Math.max(0,meeting.reserve+sellTotal-buyTotal);
 const projectedHoldings=meeting.holdings.length+selectedItems.filter(x=>x.action==="OPEN NEW").length-selectedItems.filter(x=>x.action==="EXIT").length;
 const selectApproved=()=>setSelected(Object.fromEntries(meeting.approved.map(x=>[key(x),true])));
 const toggle=(x:MeetingItem)=>setSelected(s=>({...s,[key(x)]:!s[key(x)]}));
 async function submit(){if(!selectedItems.length)return;setSubmitting(true);setError(null);try{const result=await getJson("/api/portfolio/rebalance-execution",{method:"POST",body:JSON.stringify({humanApproved:true,humanApprovedBy:"portfolio_owner",meetingCode:`IC-${new Date().toISOString().slice(0,10)}`,reserveTicker:"SGOV",deployable:meeting.reserve,portfolioBefore:data?.portfolio??{},macro:{label:meeting.macroLabel,score:meeting.macroScore,posture:meeting.posture},items:selectedItems})});setExecution(result)}catch(e:any){setError(e?.message??"Execution package failed")}finally{setSubmitting(false)}}
 const agendaStyle={border:"1px solid rgba(119,137,255,.28)",borderRadius:18,padding:18,marginTop:14,background:"rgba(7,18,45,.52)"} as const;
 const summaryStyle={cursor:"pointer",fontWeight:900,fontSize:"1.02rem",letterSpacing:.3} as const;
 return <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:11,letterSpacing:1.4}}>AI FUND OPERATING SYSTEM · SINGLE MEETING STATE</div><h2 className="section" style={{margin:"6px 0"}}>{lang==="th"?"กองทุนอัจฉริยะและคณะกรรมการลงทุน":"INTELLIGENT FUND COMMITTEE"}</h2><p className="muted" style={{margin:0}}>Run once. Review evidence, role-specific debate, actions, thesis, funding and projected portfolio in one governed workflow.</p></div><button className="btn" onClick={()=>setCycle(x=>x+1)} disabled={loading}>{loading?"Running meeting…":"Run Full Fund Meeting"}</button></div>
  {error&&<div className="notice" style={{marginTop:12}}>⚠ {error}</div>}{execution&&<div className="notice" style={{marginTop:12,borderColor:"rgba(72,228,167,.45)"}}>✓ Package {execution.package?.packageId} · {execution.package?.status}</div>}

  <details style={agendaStyle} open><summary style={summaryStyle}>1 · MACRO, REGIME & SENTIMENT</summary><div style={{marginTop:14}}><div className="grid cols-4"><Metric l="Regime" v={meeting.macroLabel}/><Metric l="Macro score" v={`${meeting.macroScore}/100`}/><Metric l="Fund posture" v={meeting.posture}/><Metric l="Target cash" v={`${meeting.cashTarget}%`}/></div><div className="grid cols-3" style={{marginTop:10}}>{meeting.macroDrivers.map((x:any)=><div className="metric" key={x.label}><span>{x.label}</span><strong>{x.score}</strong><small>{x.view}</small></div>)}</div><p className="notice"><strong>Macro report:</strong> {data?.macro?.summary??"Market evidence is mixed; deploy only where risk/reward is positive."}</p><Transcript rows={meeting.transcript}/></div></details>

  <details style={agendaStyle}><summary style={summaryStyle}>2 · PORTFOLIO REVIEW & CAPITAL RELEASE</summary><div style={{marginTop:14}}><div className="grid cols-4"><Metric l="Open holdings" v={String(meeting.review.count)}/><Metric l="Market value" v={usd(meeting.marketValue)}/><Metric l="Actions proposed" v={String(meeting.review.actions)}/><Metric l="Watch items" v={String(meeting.review.watch)}/></div><p className="notice"><strong>Portfolio conclusion:</strong> Review every holding for thesis integrity, weight drift, correlation, valuation and capital efficiency. No change is itself a documented decision.</p><Items items={meeting.portfolioItems} selected={selected} toggle={toggle}/>{!meeting.portfolioItems.length&&<div className="notice">No holding adjustment cleared the portfolio review. Existing holdings remain unchanged; reserve remains available.</div>}</div></details>

  <details style={agendaStyle}><summary style={summaryStyle}>3 · INVESTMENT STRATEGY, RESEARCH & CAPITAL ALLOCATION</summary><div style={{marginTop:14}}><p className="muted">Research candidates must pass positive-upside, conviction, valuation and risk gates. Each thesis includes monitoring and explicit risks.</p><Items items={meeting.strategyItems} selected={selected} toggle={toggle}/>{!meeting.strategyItems.length&&<div className="notice">No new strategy candidate passed research, valuation and risk gates. Cash remains in SGOV.</div>}</div></details>

  <details style={agendaStyle}><summary style={summaryStyle}>4 · FINAL RESOLUTION, FUNDING & EXECUTION</summary><div style={{marginTop:14}}><div className="grid cols-4"><Metric l="Approved ideas" v={String(meeting.approved.length)}/><Metric l="Human selected" v={String(selectedItems.length)}/><Metric l="Buy total" v={usd(buyTotal)}/><Metric l="Capital released" v={usd(sellTotal)}/></div><div className="notice" style={{marginTop:12,borderColor:"rgba(72,228,167,.4)"}}><strong>Funding plan:</strong> {funding}</div><div className="grid cols-3" style={{marginTop:10}}><Metric l="Projected holdings" v={String(projectedHoldings)}/><Metric l="Projected reserve" v={usd(projectedCash)}/><Metric l="Execution state" v={execution?String(execution.package?.status??"SUBMITTED"):selectedItems.length?"READY FOR HUMAN SUBMISSION":"NO AUTHORIZED TRADE"}/></div><div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:12}}><button className="btn ghost" onClick={selectApproved} disabled={!meeting.approved.length}>Select All Approved</button><button className="btn" onClick={submit} disabled={!selectedItems.length||submitting}>{submitting?"Submitting…":`Submit Rebalance Package (${selectedItems.length})`}</button></div><div className="notice" style={{marginTop:12}}><strong>Chair resolution:</strong> Macro posture {meeting.posture}. Portfolio actions: {meeting.portfolioItems.filter(x=>selected[key(x)]).map(x=>`${x.action} ${x.ticker} ${usd(x.amount)}`).join(", ")||"none"}. Investment plan: {buys.map(x=>`${x.action} ${x.ticker} ${usd(x.amount)}`).join(", ")||"keep reserve in SGOV"}. Human approval remains mandatory before execution and holdings update.</div></div></details>
 </section>
}
function deskVotes(action:Action,approved:boolean,riskOff:boolean){return desks.map(d=>{if(!approved)return `${d}: ${d==="TREASURY"?"KEEP CASH":"HOLD"}`;if(d==="RISK")return `${d}: ${riskOff?"REDUCE / LIMIT":"SIZE CONTROL"}`;if(d==="TREASURY")return `${d}: ${action==="TRIM"||action==="EXIT"?"RELEASE CAPITAL":"FUND IF SELECTED"}`;if(d==="RESEARCH")return `${d}: ${action==="TRIM"||action==="EXIT"?"THESIS REVIEW":"BUY"}`;if(d==="PORTFOLIO")return `${d}: ${action==="TRIM"||action==="EXIT"?"REBALANCE":"FIT"}`;return `${d}: SUPPORT`})}
function Metric({l,v}:{l:string;v:string}){return <div className="metric"><span>{l}</span><strong style={{fontSize:17}}>{v}</strong></div>}
function Transcript({rows}:{rows:{desk:string;text:string}[]}){return <div style={{display:"grid",gap:8,marginTop:12}}>{rows.map(x=><div className="notice" key={x.desk}><strong>{x.desk}:</strong> {x.text}</div>)}</div>}
function Items({items,selected,toggle}:{items:MeetingItem[];selected:Record<string,boolean>;toggle:(x:MeetingItem)=>void}){return <div style={{display:"grid",gap:10,marginTop:12}}>{items.map(x=>{const k=`${x.action}:${x.ticker}`;return <article className="metric" key={k} style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",gap:12,alignItems:"start"}}><div><span>{x.action}</span><strong style={{display:"block",fontSize:20}}>{x.ticker} · {usd(x.amount)}</strong><small>{x.reason}</small><div className="grid cols-3" style={{marginTop:8}}><Metric l="Price" v={usd(x.price)}/><Metric l="Target" v={usd(x.target)}/><Metric l="Expected return" v={x.upside==null?"—":`${x.upside.toFixed(1)}%`}/></div><div className="notice" style={{marginTop:8}}><strong>Investment thesis:</strong> {x.reason}<br/><strong>Risks:</strong> {x.risks.join(" · ")}<br/><strong>Monitoring:</strong> {x.monitoring.join(" · ")}</div><div style={{marginTop:8,fontSize:11}}>{x.votes.join(" · ")}</div></div><label style={{display:"grid",gap:6,justifyItems:"center"}}><input type="checkbox" checked={Boolean(selected[k])} disabled={!x.approved} onChange={()=>toggle(x)}/><b style={{fontSize:11}}>{x.approved?"APPROVED":"HOLD"}</b></label></article>})}</div>}
