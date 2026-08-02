"use client";

import {useState} from "react";
import type {AppLang} from "../page";

const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
type Mode="momentum"|"growth"|"quality"|"value"|"dividend"|"institutional"|"ai"|"thematic"|"multifactor";
const modes:{id:Mode;icon:string;en:string;th:string;note:string}[]=[
 {id:"momentum",icon:"🚀",en:"Momentum",th:"โมเมนตัม",note:"Relative strength, trend and volume expansion"},
 {id:"growth",icon:"📈",en:"Growth",th:"เติบโต",note:"Revenue, earnings and margin expansion"},
 {id:"quality",icon:"⭐",en:"Quality",th:"คุณภาพ",note:"ROE, free cash flow and balance-sheet strength"},
 {id:"value",icon:"💎",en:"Value",th:"มูลค่า",note:"Expected upside, P/E, PEG and value-trap control"},
 {id:"dividend",icon:"💵",en:"Dividend",th:"ปันผล",note:"Yield, payout safety, coverage and durability"},
 {id:"institutional",icon:"🏛",en:"Institutional Interest",th:"แรงสะสมสถาบัน",note:"Volume, relative strength and accumulation proxy"},
 {id:"ai",icon:"🧠",en:"AI / Innovation",th:"AI / นวัตกรรม",note:"Semiconductor, cloud, cyber and automation"},
 {id:"thematic",icon:"🔥",en:"Thematic Portfolio",th:"พอร์ตตามธีม",note:"Select 5-8 stocks and construct a 100% portfolio"},
 {id:"multifactor",icon:"◈",en:"Multi-Factor",th:"หลายปัจจัย",note:"Balanced composite across independent engines"},
];
const sectors=["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const themes=[
 ["biotech","Biotech"],
 ["regional-banks","Regional Banks"],
 ["aerospace-defense","Aerospace & Defence"],
 ["semiconductors","Semiconductors"],
 ["cloud-software","Cloud & Software"],
 ["cybersecurity","Cybersecurity"],
 ["ai-infrastructure","AI Infrastructure"],
 ["energy-transition","Energy Transition"],
] as const;
const money=(v:any)=>Number.isFinite(Number(v))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(v)):"—";
const pct=(v:any)=>Number.isFinite(Number(v))?`${Number(v)>=0?"+":""}${Number(v).toFixed(1)}%`:"—";
const scoreKey=(mode:string)=>mode==="multifactor"||mode==="thematic"?"composite":mode;
async function safeJson(r:Response){const text=await r.text();const type=r.headers.get("content-type")??"";if(!type.includes("application/json"))throw new Error(`Scanner returned ${r.status} ${type||"non-JSON response"}`);try{return JSON.parse(text)}catch{throw new Error("Scanner returned invalid JSON")}}

export default function AlphaDiscoveryPlatform({lang}:{lang:AppLang}){
 const[mode,setMode]=useState<Mode>("multifactor");const[sector,setSector]=useState("All");const[theme,setTheme]=useState("biotech");const[tickers,setTickers]=useState("");const[loading,setLoading]=useState(false);const[result,setResult]=useState<any>(null);const[error,setError]=useState<string|null>(null);
 async function scan(){setLoading(true);setError(null);try{const q=new URLSearchParams({mode,sector,theme,top:mode==="thematic"?"8":"10"});if(tickers.trim())q.set("tickers",tickers);const r=await fetch(`/api/alpha-discovery?${q}`,{cache:"no-store"});const j=await safeJson(r);if(!r.ok)throw new Error(j.error??"Scan failed");setResult(j)}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 const selected=modes.find(x=>x.id===mode);
 return <div>
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><h2 className="section" style={{margin:0}}>📡 {tr(lang,"Institutional Alpha Discovery","ระบบค้นหา Alpha ระดับสถาบัน")}</h2><p className="muted" style={{margin:"6px 0 0"}}>{tr(lang,"Nine independent engines. Each control changes the API universe, qualification gate and ranking model.","9 เครื่องยนต์อิสระ ทุกปุ่มเปลี่ยน Universe, Gate และ Ranking ที่ API จริง")}</p></div><span className="tag">v11 Alpha Core</span></div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:9,marginTop:14}}>{modes.map(m=><button key={m.id} className={`btn ${mode===m.id?"":"ghost"}`} style={{textAlign:"left",minHeight:68}} onClick={()=>{setMode(m.id);setResult(null);setError(null);if(m.id==="thematic")setSector("All")}}><strong>{m.icon} {tr(lang,m.en,m.th)}</strong><small style={{display:"block",opacity:.72,marginTop:5}}>{m.note}</small></button>)}</div>
   <div className="notice" style={{marginTop:14}}>{mode==="institutional"?tr(lang,"Accumulation proxy only; verified institutional ownership requires filing evidence.","เป็นเพียงสัญญาณประมาณการสะสม การถือครองจริงต้องมี Filing ยืนยัน"):mode==="thematic"?tr(lang,"Choose a theme. The engine scans its stock universe, selects the strongest 5-8 names and constructs a score-weighted portfolio totaling 100%.","เลือกธีมแล้วระบบจะสแกนหุ้นในธีมนั้น คัด 5–8 ตัวที่แข็งแกร่งที่สุด และจัดน้ำหนักพอร์ตให้รวม 100%") :tr(lang,`Active engine: ${selected?.en}. Results come only from this engine's independent universe and gate.`,`เครื่องยนต์ที่เลือก: ${selected?.th} ผลลัพธ์มาจาก Universe และ Gate ของ Engine นี้เท่านั้น`)}</div>
   <div className="searchbar" style={{marginTop:14}}>
    {mode==="thematic"?<select value={theme} onChange={e=>{setTheme(e.target.value);setResult(null)}}>{themes.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>:<select value={sector} onChange={e=>{setSector(e.target.value);setResult(null)}}>{sectors.map(s=><option key={s}>{s}</option>)}</select>}
    <input value={tickers} onChange={e=>setTickers(e.target.value)} placeholder={tr(lang,"Optional override tickers (replaces engine universe)","ระบุหุ้นเองได้ โดยจะแทนที่ Universe ของ Engine")} style={{flex:1,minWidth:220}}/>
    <button className="btn" onClick={scan} disabled={loading}>{loading?tr(lang,"Analyzing…","กำลังวิเคราะห์…"):mode==="thematic"?tr(lang,"Build Thematic Portfolio","สร้างพอร์ตตามธีม"):tr(lang,`Run ${selected?.en??"Factor"} Scan`, `เริ่มสแกน ${selected?.th??"ปัจจัย"}`)}</button>
   </div>
   {tickers.trim()&&<p className="muted" style={{fontSize:11,marginTop:8}}>{tr(lang,"Manual tickers override the selected engine universe. Clear this field for a true engine scan.","เมื่อระบุหุ้นเอง ระบบจะใช้รายการนี้แทน Universe ของ Engine กรุณาล้างช่องเพื่อสแกนแบบ Engine จริง")}</p>}
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>
  {result&&<FactorResults result={result} lang={lang}/>} 
 </div>
}

function FactorResults({result,lang}:{result:any;lang:AppLang}){const stats=result.stats??{};const key=scoreKey(String(result.mode));const thematic=String(result.mode)==="thematic";return <>
 <section className="card"><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><h3 className="sub" style={{margin:0}}>{thematic?tr(lang,"THEMATIC PORTFOLIO","พอร์ตตามธีม"):String(result.mode).toUpperCase()+" ENGINE"}{result.theme?` · ${result.theme.label}`:""}</h3><span className="tag">{result.universeSource}</span></div><div className="grid cols-4" style={{marginTop:12}}><Metric label="Universe" value={String(stats.universe??0)}/><Metric label="Analyzed" value={String(stats.analyzed??0)}/><Metric label="Qualified" value={String(stats.qualified??0)}/><Metric label={thematic?tr(lang,"Portfolio holdings","จำนวนหุ้นในพอร์ต"):"Returned"} value={String(thematic?result.portfolio?.holdings??0:stats.returned??0)}/></div><p className="muted" style={{fontSize:12,lineHeight:1.6}}>{result.methodology}</p></section>
 {thematic&&(result.picks??[]).length>0&&<section className="card" style={{borderTop:"2px solid var(--green)"}}><div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><div><h3 className="sub" style={{margin:0}}>{tr(lang,"Recommended allocation","น้ำหนักลงทุนที่แนะนำ")}</h3><p className="muted" style={{margin:"5px 0 0",fontSize:12}}>{result.theme?.label} · {result.theme?.benchmark} {tr(lang,"benchmark · weights total","เป็น Benchmark · น้ำหนักรวม")} {Number(result.portfolio?.totalWeightPct??100).toFixed(1)}%</p></div><span className="tag">5–8 STOCKS · 100%</span></div><div style={{display:"grid",gap:8,marginTop:14}}>{(result.picks??[]).map((p:any)=><div key={p.ticker} style={{display:"grid",gridTemplateColumns:"52px minmax(90px,1fr) 3fr 70px",gap:10,alignItems:"center"}}><span className="muted">#{p.allocationRank}</span><strong>{p.ticker}</strong><div className="bar"><span style={{width:`${Math.min(100,Number(p.portfolioWeightPct??0)*4)}%`}}/></div><strong style={{textAlign:"right"}}>{Number(p.portfolioWeightPct??0).toFixed(1)}%</strong></div>)}</div></section>}
 {(result.picks??[]).map((p:any,i:number)=><article className="card setup-card" key={p.ticker} style={{borderTop:i===0?"2px solid var(--green)":"1px solid var(--border-strong)"}}><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:10}}>#{i+1} · {p.sector}{result.theme?` · ${result.theme.label}`:""}</div><h2 className="section" style={{margin:"4px 0"}}>{p.ticker} · {p.name}</h2><p className="muted" style={{maxWidth:760,fontSize:11,lineHeight:1.55}}>{p.thesis}</p><div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>{(p.engines??[]).map((x:string)=><span className="tag" key={x}>{x}</span>)}</div></div><div className="badge-score">{thematic?`${Number(p.portfolioWeightPct??0).toFixed(1)}%`:p[key]??p.composite}<span style={{fontSize:13}}>{thematic?" weight":"/100"}</span><small style={{display:"block",fontSize:10}}>{thematic?`Score ${p.composite}/100`:`Consensus ${p.consensusCount??0}/7`}</small></div></div>
 <div className="grid cols-4" style={{marginTop:12}}><Metric label="Momentum" value={`${p.momentum}/100`}/><Metric label="Growth" value={`${p.growth}/100`}/><Metric label="Quality" value={`${p.quality}/100`}/><Metric label="Value" value={`${p.value}/100`}/></div>
 <div className="grid cols-4" style={{marginTop:9}}><Metric label="Dividend" value={`${p.dividend}/100`}/><Metric label="Institutional" value={`${p.institutional}/100`}/><Metric label="AI / Innovation" value={`${p.ai}/100`}/><Metric label="Composite" value={`${p.composite}/100`}/></div>
 <div className="grid cols-4" style={{marginTop:9}}><Metric label={tr(lang,"Price","ราคา")} value={money(p.price)}/><Metric label={tr(lang,"Expected return","ผลตอบแทนคาดหวัง")} value={pct(p.expectedReturnPct)}/><Metric label="Target" value={money(p.targetPrice)}/><Metric label={thematic?tr(lang,"Portfolio weight","น้ำหนักพอร์ต"):"Data quality"} value={thematic?`${Number(p.portfolioWeightPct??0).toFixed(1)}%`:String(p.dataQuality??"—")}/></div>
 {(p.reasons??[]).length>0&&<div className="notice" style={{marginTop:12}}><strong>{tr(lang,"Why discovered","เหตุผลที่ค้นพบ")}</strong><br/>{p.reasons.join(" · ")}</div>}
 <div style={{marginTop:12}}><Watchlist ticker={p.ticker} source={`${result.mode} independent engine v11`} reason={`${result.mode} score ${p[key]??p.composite}/100; consensus ${p.consensusCount??0}/7; composite ${p.composite}/100${thematic?`; portfolio weight ${Number(p.portfolioWeightPct??0).toFixed(1)}%`:""}.`} target={p.targetPrice} lang={lang}/></div></article>)}
 {!(result.picks??[]).length&&<section className="card"><p className="muted">{tr(lang,"No securities passed this engine's independent qualification gate.","ไม่มีหุ้นผ่านเกณฑ์อิสระของ Engine นี้")}</p></section>}
 </>}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
function Watchlist({ticker,source,reason,target,lang}:{ticker:string;source:string;reason:string;target:any;lang:AppLang}){const[state,setState]=useState("idle");async function add(){setState("saving");try{const r=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,source,reason,target_price:target})});if(!r.ok)throw new Error();setState("saved")}catch{setState("error")}}return <button className="btn ghost sm" onClick={add} disabled={state==="saving"||state==="saved"}>{state==="saved"?tr(lang,"Added to Research Queue","เพิ่มเข้า Research Queue แล้ว"):state==="error"?tr(lang,"Retry Watchlist","ลองเพิ่มใหม่"):tr(lang,"Send to Watchlist / Research","ส่งเข้า Watchlist / Research")}</button>}
