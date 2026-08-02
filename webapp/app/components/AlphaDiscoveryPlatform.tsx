"use client";

import {useState} from "react";
import type {AppLang} from "../page";
import AlphaScannerV2 from "./AlphaScannerV2";

const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
type Mode="growth"|"quality"|"value"|"institutional"|"ai"|"multifactor";
const modes:{id:Mode;icon:string;en:string;th:string;note:string}[]=[
 {id:"growth",icon:"🚀",en:"Growth",th:"เติบโต",note:"Revenue, earnings and margin expansion"},
 {id:"quality",icon:"⭐",en:"Quality",th:"คุณภาพ",note:"ROE, cash flow, margins and balance sheet"},
 {id:"value",icon:"💎",en:"Value",th:"มูลค่า",note:"Upside, forward P/E, PEG and value-trap control"},
 {id:"institutional",icon:"🏛",en:"Institutional Interest",th:"ความสนใจจากสถาบัน",note:"Accumulation proxy from volume, RS and trend"},
 {id:"ai",icon:"🧠",en:"AI / Innovation",th:"AI / นวัตกรรม",note:"AI infrastructure, cloud, cyber and automation"},
 {id:"multifactor",icon:"◈",en:"Multi-Factor",th:"หลายปัจจัย",note:"Growth + Quality + Value + Momentum + Institutional"},
];
const sectors=["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const money=(v:any)=>Number.isFinite(Number(v))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(v)):"—";
const pct=(v:any)=>Number.isFinite(Number(v))?`${Number(v)>=0?"+":""}${Number(v).toFixed(1)}%`:"—";

export default function AlphaDiscoveryPlatform({lang}:{lang:AppLang}){
 const[mode,setMode]=useState<Mode>("multifactor");const[sector,setSector]=useState("All");const[tickers,setTickers]=useState("");const[loading,setLoading]=useState(false);const[result,setResult]=useState<any>(null);const[error,setError]=useState<string|null>(null);const[showCore,setShowCore]=useState(false);
 async function scan(){setLoading(true);setError(null);try{const q=new URLSearchParams({mode,sector,top:"10"});if(tickers.trim())q.set("tickers",tickers);const r=await fetch(`/api/scan?${q}`,{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error??"Scan failed");setResult(j)}catch(e:any){setError(e.message)}finally{setLoading(false)}}
 return <div>
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><h2 className="section" style={{margin:0}}>📡 {tr(lang,"Institutional Alpha Discovery Platform","แพลตฟอร์มค้นหา Alpha ระดับสถาบัน")}</h2><p className="muted" style={{margin:"6px 0 0"}}>{tr(lang,"Nine discovery lenses feeding one research and committee pipeline.","เก้าเลนส์ค้นหาโอกาส เชื่อมเข้าสู่ Research และการประชุมกองทุนชุดเดียว")}</p></div><span className="tag">Sentinel v10.4</span></div>
   <button className="btn ghost" style={{marginTop:14}} onClick={()=>setShowCore(v=>!v)}>{showCore?tr(lang,"Hide core scanners","ซ่อน Scanner เดิม"):tr(lang,"Momentum · Dividend · Thematic","Momentum · Dividend · Thematic")}</button>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:9,marginTop:14}}>{modes.map(m=><button key={m.id} className={`btn ${mode===m.id?"":"ghost"}`} style={{textAlign:"left",minHeight:64}} onClick={()=>{setMode(m.id);setResult(null)}}><strong>{m.icon} {tr(lang,m.en,m.th)}</strong><small style={{display:"block",opacity:.7,marginTop:5}}>{m.note}</small></button>)}</div>
   <div className="notice" style={{marginTop:14}}>{mode==="institutional"?tr(lang,"Institutional Interest is an accumulation proxy. It does not claim that institutions bought shares unless verified filing evidence is available.","Institutional Interest เป็นคะแนนประมาณการสะสมจากราคาและ Volume ไม่กล่าวอ้างว่าสถาบันซื้อจริง เว้นแต่มี Filing ยืนยัน"):tr(lang,`Active engine: ${modes.find(x=>x.id===mode)?.en}. Results are ranked by verified factor evidence and can be sent to the fund watchlist.`,`เครื่องยนต์ที่เลือก: ${modes.find(x=>x.id===mode)?.th} ผลลัพธ์เรียงตามหลักฐาน Factor และส่งเข้า Watchlist ของกองทุนได้`)}</div>
   <div className="searchbar" style={{marginTop:14}}><select value={sector} onChange={e=>setSector(e.target.value)}>{sectors.map(s=><option key={s}>{s}</option>)}</select><input value={tickers} onChange={e=>setTickers(e.target.value)} placeholder={tr(lang,"Optional tickers: QCOM, AVGO, MELI…","ระบุหุ้นเองได้: QCOM, AVGO, MELI…")} style={{flex:1,minWidth:220}}/><button className="btn" onClick={scan} disabled={loading}>{loading?tr(lang,"Analyzing…","กำลังวิเคราะห์…"):tr(lang,"Run Factor Scan","เริ่มสแกน Factor")}</button></div>
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>
  {showCore&&<details open className="card" style={{marginTop:14}}><summary style={{cursor:"pointer",fontWeight:800}}>{tr(lang,"Core scanners","Scanner หลักเดิม")}</summary><div style={{marginTop:14}}><AlphaScannerV2 lang={lang}/></div></details>}
  {result&&<FactorResults result={result} lang={lang}/>} 
 </div>
}

function FactorResults({result,lang}:{result:any;lang:AppLang}){return <>
 <section className="card"><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><h3 className="sub" style={{margin:0}}>{String(result.mode).toUpperCase()} RANKING</h3><span className="tag">{result.scanned} scanned</span></div><p className="muted" style={{fontSize:12,lineHeight:1.6}}>{result.methodology}</p></section>
 {(result.picks??[]).map((p:any,i:number)=><article className="card setup-card" key={p.ticker} style={{borderTop:i===0?"2px solid var(--green)":"1px solid var(--border-strong)"}}><div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:10}}>#{i+1} · {p.sector}</div><h2 className="section" style={{margin:"4px 0"}}>{p.ticker} · {p.name}</h2><p className="muted" style={{maxWidth:760,fontSize:11,lineHeight:1.55}}>{p.thesis}</p></div><div className="badge-score">{p[result.mode==="multifactor"?"composite":result.mode]}<span style={{fontSize:13}}>/100</span></div></div>
 <div className="grid cols-4" style={{marginTop:12}}><Metric label="Growth" value={`${p.growth}/100`}/><Metric label="Quality" value={`${p.quality}/100`}/><Metric label="Value" value={`${p.value}/100`}/><Metric label="Institutional" value={`${p.institutional}/100`}/></div>
 <div className="grid cols-4" style={{marginTop:9}}><Metric label="AI / Innovation" value={`${p.ai}/100`}/><Metric label="Composite" value={`${p.composite}/100`}/><Metric label={tr(lang,"Price","ราคา")} value={money(p.price)}/><Metric label={tr(lang,"Expected return","ผลตอบแทนคาดหวัง")} value={pct(p.expectedReturnPct)}/></div>
 <div style={{marginTop:12}}><Watchlist ticker={p.ticker} source={`${result.mode} Factor Scanner v10.4`} reason={`${result.mode} score ${p[result.mode==="multifactor"?"composite":result.mode]}/100; composite ${p.composite}/100. ${p.thesis}`} target={p.targetPrice} lang={lang}/></div></article>)}
 </>}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
function Watchlist({ticker,source,reason,target,lang}:{ticker:string;source:string;reason:string;target:any;lang:AppLang}){const[state,setState]=useState("idle");async function add(){setState("saving");try{const r=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,source,reason,target_price:target})});if(!r.ok)throw new Error();setState("saved")}catch{setState("error")}}return <button className="btn ghost sm" onClick={add} disabled={state==="saving"||state==="saved"}>{state==="saved"?tr(lang,"Added to Research Queue","เพิ่มเข้า Research Queue แล้ว"):state==="error"?tr(lang,"Retry Watchlist","ลองเพิ่มใหม่"):tr(lang,"Send to Watchlist / Research","ส่งเข้า Watchlist / Research")}</button>}
