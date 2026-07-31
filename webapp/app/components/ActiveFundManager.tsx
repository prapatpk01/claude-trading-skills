"use client";
import {useState} from"react";
import {money} from"./format";

export default function ActiveFundManager(){
 const[loading,setLoading]=useState(false),[data,setData]=useState<any>(null),[error,setError]=useState<string|null>(null);
 async function run(){setLoading(true);setError(null);try{const p=await fetch("/api/portfolio").then(r=>r.json());if(p.error)throw new Error(p.error);const holdings=(p.holdings??[]).filter((h:any)=>!h.closed_at);const tickers=Array.from(new Set(holdings.map((h:any)=>h.ticker))) as string[];let quotes:Record<string,any>={};if(tickers.length){const q=await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`).then(r=>r.json());quotes=q.quotes??{}}const nav=holdings.reduce((s:number,h:any)=>s+((quotes[h.ticker]?.price??h.avg_cost)*h.shares),0);const r=await fetch("/api/active-fund",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tickers,nav})}),j=await r.json();if(!r.ok)throw new Error(j.error||"Review failed");setData(j)}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 return <div className="card ai-card" style={{marginTop:18}}>
  <h3 className="sub">🧠 Sentinel Active Fund Management Engine</h3>
  <p className="muted" style={{fontSize:12,lineHeight:1.6}}>The fund does not rebalance only what it already owns. It discovers new stocks and ETFs, sends them through Research, specialist desks, Risk and the Investment Committee, then compares approved ideas against existing holdings before proposing capital allocation.</p>
  <button className="btn" onClick={run} disabled={loading}>{loading?"Running full investment committee…":"🏛 Run Investment Committee"}</button>
  {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  {data&&<>
   <div className="grid cols-4" style={{marginTop:14}}><M l="New opportunities" v={data.discovery?.uniqueNew??0}/><M l="Initiate" v={data.capitalPlan?.initiates??0}/><M l="Add existing" v={data.capitalPlan?.adds??0}/><M l="Review / Exit" v={data.capitalPlan?.reviews??0}/></div>
   <div className="grid cols-3" style={{marginTop:12}}><M l="Proposed deployment" v={money(data.capitalPlan?.deployUsd??0)}/><M l="Capital raised by rotations" v={money(data.capitalPlan?.raiseUsd??0)}/><M l="Residual cash" v={money(data.capitalPlan?.cashAfterUsd??0)}/></div>
   <h3 className="sub">🔭 Opportunity Discovery</h3><p className="muted" style={{fontSize:12}}>Momentum {data.discovery?.momentum??0} · Dividend Quality {data.discovery?.dividend??0} · Thematic {data.discovery?.thematic??0} · {data.discovery?.uniqueNew??0} unique names outside the current book</p>
   <Table ideas={data.newIdeas??[]} title="New opportunities — not currently held"/>
   <Table ideas={data.existing??[]} title="Existing holdings — committee review"/>
   <h3 className="sub">🔄 Replacement Alpha</h3>{data.replacements?.length?<div className="table-wrap"><table className="tbl"><thead><tr><th>From</th><th>To</th><th className="num">Rotate</th><th>Why</th></tr></thead><tbody>{data.replacements.map((x:any,i:number)=><tr key={i}><td><strong>{x.from}</strong></td><td><strong>{x.to}</strong></td><td className="num">{x.rotatePct}% · {money(x.rotateUsd)}</td><td style={{fontSize:12}}>{x.reason}</td></tr>)}</tbody></table></div>:<div className="notice">No replacement clears the current conviction and expected-return hurdle. A winner is not sold just because a new idea exists.</div>}
   <h3 className="sub">🏛 Fund Operating Process</h3><ol style={{fontSize:12.5,lineHeight:1.7}}>{data.process?.map((x:string,i:number)=><li key={i}>{x}</li>)}</ol>
   {data.warnings?.length>0&&<div className="notice">{data.warnings.join(" · ")}</div>}
   <p className="muted" style={{fontSize:11}}>Decision-support only. INITIATE/ADD/TRIM/REPLACE/EXIT are committee proposals; no order is executed automatically.</p>
  </>}
 </div>
}
function M({l,v}:{l:string;v:any}){return <div className="metric"><div className="label">{l}</div><div className="value" style={{fontSize:19}}>{v}</div></div>}
function Table({ideas,title}:{ideas:any[];title:string}){return <><h3 className="sub">{title}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>Action</th><th>Discovery</th><th className="num">Conviction</th><th className="num">Exp. return</th><th className="num">Target weight</th><th className="num">Capital</th><th>Committee / thesis</th></tr></thead><tbody>{ideas.map((x:any)=><tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td><strong>{x.action}</strong></td><td style={{fontSize:11}}>{x.source?.join(" · ")||"Current book"}</td><td className="num">{x.conviction}/100</td><td className="num">{x.expectedReturnPct==null?"—":`${x.expectedReturnPct>=0?"+":""}${x.expectedReturnPct.toFixed(1)}%`}</td><td className="num">{x.targetWeightPct?`${x.targetWeightPct.toFixed(1)}%`:"—"}</td><td className="num">{x.capitalUsd?money(x.capitalUsd):"—"}</td><td style={{fontSize:11.5,lineHeight:1.5}}><strong>{x.committee} · {x.confidence}</strong><br/>{x.thesis}{x.dissent?.length?<><br/><span className="neg">Dissent: {x.dissent.join(" · ")}</span></>:null}</td></tr>)}{!ideas.length&&<tr><td colSpan={8} className="muted">No fully analyzed ideas returned in this run.</td></tr>}</tbody></table></div></>}
