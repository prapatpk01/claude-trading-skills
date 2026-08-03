"use client";

import {useMemo,useState} from "react";
import type {AppLang} from "../page";

type Mode="momentum"|"growth"|"quality"|"value"|"dividend"|"institutional"|"ai"|"thematic"|"multifactor";
type Candidate={ticker:string;name?:string;sector?:string;price?:number|null;targetPrice?:number|null;expectedReturnPct?:number|null;composite?:number;portfolioWeightPct?:number;allocationRank?:number;passed?:boolean;status?:string;failedGates?:string[];valuationFailures?:string[];rejectionReasons?:string[];reasons?:string[];thesis?:string;dataQuality?:string};
type Result={mode:Mode;theme?:{label:string;benchmark:string}|null;universeSource?:string;pipeline?:Record<string,number>;stats?:Record<string,number>;picks?:Candidate[];rejectedCandidates?:Candidate[];methodology?:string;portfolio?:{holdings:number;totalWeightPct:number;status:string}|null;warnings?:string[]};

const MODES:{id:Mode;label:string;icon:string;note:string}[]=[
 {id:"multifactor",label:"Multi-Factor",icon:"◈",note:"Balanced institutional composite"},
 {id:"momentum",label:"Momentum",icon:"🚀",note:"Relative strength and trend"},
 {id:"growth",label:"Growth",icon:"📈",note:"Revenue and earnings expansion"},
 {id:"quality",label:"Quality",icon:"⭐",note:"ROE, FCF and balance sheet"},
 {id:"value",label:"Value",icon:"💎",note:"Upside and valuation discipline"},
 {id:"dividend",label:"Dividend",icon:"💵",note:"Yield, payout and durability"},
 {id:"institutional",label:"Institutional",icon:"🏛",note:"Accumulation proxy"},
 {id:"ai",label:"AI / Innovation",icon:"🧠",note:"AI infrastructure and software"},
 {id:"thematic",label:"Thematic Portfolio",icon:"🔥",note:"Build a weighted 5–8 stock sleeve"},
];
const THEMES=[
 ["biotech","Biotech"],["regional-banks","Regional Banks"],["aerospace-defense","Aerospace & Defence"],["semiconductors","Semiconductors"],["cloud-software","Cloud & Software"],["cybersecurity","Cybersecurity"],["ai-infrastructure","AI Infrastructure"],["energy-transition","Energy Transition"]
];
const SECTORS=["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;
const money=(value:unknown)=>Number.isFinite(Number(value))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(value)):"—";
const pct=(value:unknown)=>Number.isFinite(Number(value))?`${Number(value)>=0?"+":""}${Number(value).toFixed(1)}%`:"—";

export default function ResearchWorkspaceV12({lang}:{lang:AppLang}){
 const[mode,setMode]=useState<Mode>("multifactor");
 const[sector,setSector]=useState("All");
 const[theme,setTheme]=useState("regional-banks");
 const[tickers,setTickers]=useState("");
 const[loading,setLoading]=useState(false);
 const[result,setResult]=useState<Result|null>(null);
 const[error,setError]=useState<string|null>(null);
 const[activeStage,setActiveStage]=useState("selected");
 const selectedMode=MODES.find(item=>item.id===mode)!;

 async function scan(){
  setLoading(true);setError(null);setResult(null);
  try{
   const query=new URLSearchParams({mode,sector,theme,top:mode==="thematic"?"8":"10"});
   if(tickers.trim())query.set("tickers",tickers);
   const response=await fetch(`/api/alpha-discovery?${query}`,{cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error??"Research scan failed");
   setResult(json);setActiveStage("selected");
  }catch(reason:any){setError(reason?.message??"Research scan failed")}finally{setLoading(false)}
 }

 const pipeline=useMemo(()=>{
  if(!result)return[];
  const p=result.pipeline??{};
  return result.mode==="thematic"?[
   ["universe","Universe",p.universe??0],["analyzed","Analyzed",p.analyzed??0],["qualified","Factor Qualified",p.factorQualified??0],["valuation","Valuation Eligible",p.valuationEligible??0],["selected","Portfolio Selected",p.selected??0],["rejected","Rejected",p.rejected??0]
  ]:[
   ["universe","Universe",p.universe??0],["analyzed","Analyzed",p.analyzed??0],["qualified","Qualified",p.qualified??0],["selected","Committee Ready",p.selected??0],["rejected","Rejected",p.rejected??0]
  ];
 },[result]);

 const visibleCandidates=activeStage==="rejected"?(result?.rejectedCandidates??[]):(result?.picks??[]);
 return <div className="research-v12" data-research-version="12.0">
  <section className="card research-hero" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div><span className="tag">SENTINEL RESEARCH OS v12</span><h2 className="section" style={{margin:"12px 0 6px"}}>Institutional Research Pipeline</h2><p className="muted" style={{maxWidth:760}}>One evidence chain from universe → analysis → qualification → ranking → committee. Every rejected security keeps an explicit reason.</p></div>
    <div className="notice" style={{maxWidth:330}}>Research discovers and ranks ideas. It cannot execute trades. Portfolio changes require CIO committee approval and human confirmation.</div>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:9,marginTop:16}}>
    {MODES.map(item=><button type="button" key={item.id} className={`btn ${mode===item.id?"":"ghost"}`} style={{textAlign:"left",minHeight:76}} onClick={()=>{setMode(item.id);setResult(null);setError(null)}}><strong>{item.icon} {item.label}</strong><small style={{display:"block",opacity:.7,marginTop:6}}>{item.note}</small></button>)}
   </div>
   <div className="searchbar" style={{marginTop:16}}>
    {mode==="thematic"?<select value={theme} onChange={event=>setTheme(event.target.value)}>{THEMES.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>:<select value={sector} onChange={event=>setSector(event.target.value)}>{SECTORS.map(item=><option key={item}>{item}</option>)}</select>}
    <input value={tickers} onChange={event=>setTickers(event.target.value)} placeholder="Optional ticker override, comma separated" style={{flex:1,minWidth:220}}/>
    <button type="button" className="btn" onClick={scan} disabled={loading}>{loading?"Running institutional research…":mode==="thematic"?"Build Thematic Portfolio":`Run ${selectedMode.label} Scan`}</button>
   </div>
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>

  {result&&<>
   <section className="card">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}><div><h3 className="sub" style={{margin:0}}>{result.mode==="thematic"?`THEMATIC PORTFOLIO · ${result.theme?.label??""}`:`${String(result.mode).toUpperCase()} RESEARCH`}</h3><p className="muted" style={{margin:"6px 0 0"}}>{result.universeSource}</p></div><span className="tag">SINGLE PIPELINE STATE</span></div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10,marginTop:16}}>
     {pipeline.map(([id,label,value])=><button key={String(id)} type="button" className={`metric ${activeStage===id?"active":""}`} onClick={()=>setActiveStage(String(id))} style={{textAlign:"left",cursor:"pointer"}}><span>{String(label)}</span><strong>{String(value)}</strong></button>)}
    </div>
    <div className="notice" style={{marginTop:14}}>{result.methodology}</div>
   </section>

   {result.mode==="thematic"&&<section className="card" style={{borderTop:`2px solid ${(result.picks??[]).length?"var(--green)":"var(--amber)"}`}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><h3 className="sub" style={{margin:0}}>Portfolio Construction</h3><p className="muted">{result.theme?.benchmark} benchmark · factor gate → valuation gate → weighted allocation</p></div><span className="tag">{result.portfolio?.status??"—"}</span></div>
    {(result.picks??[]).length?<div style={{display:"grid",gap:10,marginTop:14}}>{(result.picks??[]).map(candidate=><div key={candidate.ticker} style={{display:"grid",gridTemplateColumns:"44px minmax(90px,1fr) 3fr 72px",gap:10,alignItems:"center"}}><span className="muted">#{candidate.allocationRank}</span><strong>{candidate.ticker}</strong><div className="bar"><span style={{width:`${Math.min(100,Number(candidate.portfolioWeightPct??0)*4)}%`}}/></div><strong style={{textAlign:"right"}}>{Number(candidate.portfolioWeightPct??0).toFixed(1)}%</strong></div>)}</div>:<div className="notice" style={{marginTop:14}}>No position was constructed because no candidate passed both the factor and valuation-evidence gates. Review rejected evidence below.</div>}
   </section>}

   <section className="card">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><h3 className="sub" style={{margin:0}}>{activeStage==="rejected"?"Rejected Evidence":"Committee-Ready Candidates"}</h3><p className="muted" style={{margin:"5px 0 0"}}>{activeStage==="rejected"?"Every failed gate is documented.":"Ranked ideas eligible for deeper Stock Analysis and CIO review."}</p></div><div style={{display:"flex",gap:8}}><button className={`btn ${activeStage==="selected"?"":"ghost"}`} type="button" onClick={()=>setActiveStage("selected")}>Selected ({result.picks?.length??0})</button><button className={`btn ${activeStage==="rejected"?"":"ghost"}`} type="button" onClick={()=>setActiveStage("rejected")}>Rejected ({result.rejectedCandidates?.length??0})</button></div></div>
    <div style={{display:"grid",gap:12,marginTop:16}}>
     {visibleCandidates.map((candidate,index)=><CandidateCard key={`${candidate.ticker}-${activeStage}`} candidate={candidate} rank={index+1} rejected={activeStage==="rejected"} lang={lang}/>) }
     {!visibleCandidates.length&&<div className="empty-state">No securities in this stage.</div>}
    </div>
   </section>
  </>}
 </div>
}

function CandidateCard({candidate,rank,rejected,lang}:{candidate:Candidate;rank:number;rejected:boolean;lang:AppLang}){
 const[state,setState]=useState("idle");
 const rejectionReasons=[...(candidate.rejectionReasons??[]),...(candidate.failedGates??[]),...(candidate.valuationFailures??[])].filter((value,index,array)=>array.indexOf(value)===index);
 async function addWatchlist(){setState("saving");try{const response=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:candidate.ticker,source:"Research OS v12",reason:candidate.thesis??candidate.reasons?.join(" · "),target_price:candidate.targetPrice})});if(!response.ok)throw new Error("Watchlist save failed");setState("saved")}catch{setState("error")}}
 return <article className="setup-card" style={{borderTop:`2px solid ${rejected?"var(--red)":"var(--green)"}`}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}><div><span className="tag">#{rank} · {candidate.sector??"Unknown"}</span><h3 style={{margin:"10px 0 4px"}}>{candidate.ticker} · {candidate.name??candidate.ticker}</h3><p className="muted" style={{maxWidth:760}}>{candidate.thesis??"Institutional research candidate."}</p></div><div className="badge-score">{candidate.composite??0}<span>/100</span><small style={{display:"block"}}>{rejected?"REJECTED":"COMMITTEE READY"}</small></div></div>
  <div className="grid cols-4" style={{marginTop:12}}><Metric label="Price" value={money(candidate.price)}/><Metric label="Target" value={money(candidate.targetPrice)}/><Metric label="Expected Return" value={pct(candidate.expectedReturnPct)}/><Metric label="Data Quality" value={candidate.dataQuality??"—"}/></div>
  {rejected&&<div className="err" style={{marginTop:12}}><strong>Failed gates</strong><div style={{marginTop:6}}>{rejectionReasons.length?rejectionReasons.join(" · "):"No explicit rejection reason was returned."}</div></div>}
  {!rejected&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}><button type="button" className="btn ghost" onClick={addWatchlist} disabled={state==="saving"}>{state==="saved"?tr(lang,"Added to Watchlist","เพิ่ม Watchlist แล้ว"):state==="saving"?"Saving…":"Add to Watchlist"}</button><span className="tag">NEXT: STOCK ANALYSIS → CIO</span></div>}
 </article>
}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
