"use client";

import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";

type WatchRow={id:string;ticker:string;reason?:string|null;alert_price?:number|null;target_price?:number|null;stop_price?:number|null;entry_price?:number|null;source?:string|null;created_at?:string|null};
type SymbolHit={ticker:string;name:string;type?:string;exchange?:string;source?:string};

export default function WatchlistIntelligenceV13({lang,onNavigate}:{lang:AppLang;onNavigate:(id:string)=>void}){
 const[rows,setRows]=useState<WatchRow[]>([]);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState<string|null>(null);
 const[query,setQuery]=useState("");
 const[hits,setHits]=useState<SymbolHit[]>([]);
 const[searching,setSearching]=useState(false);
 const[mutating,setMutating]=useState<string|null>(null);
 const t=(en:string,th:string)=>lang==="th"?th:en;

 const load=async()=>{
  setLoading(true);setError(null);
  try{
   const r=await fetch("/api/watchlist",{cache:"no-store"});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error??"Watchlist unavailable");
   setRows(j.watchlist??[]);
  }catch(e){setError(e instanceof Error?e.message:"Watchlist unavailable")}
  finally{setLoading(false)}
 };
 useEffect(()=>{void load()},[]);

 useEffect(()=>{
  const q=query.trim();
  if(!q){setHits([]);setSearching(false);return}
  let cancelled=false;
  const timer=setTimeout(async()=>{
   setSearching(true);
   try{
    const r=await fetch(`/api/symbols?q=${encodeURIComponent(q)}&limit=10`,{cache:"no-store"});
    const j=await r.json();
    if(!cancelled)setHits(Array.isArray(j.results)?j.results:[]);
   }catch{if(!cancelled)setHits([])}
   finally{if(!cancelled)setSearching(false)}
  },250);
  return()=>{cancelled=true;clearTimeout(timer)};
 },[query]);

 const tracked=useMemo(()=>new Set(rows.map(r=>r.ticker.toUpperCase())),[rows]);
 const visible=useMemo(()=>{
  const q=query.trim().toUpperCase();
  return rows.filter(r=>!q||r.ticker.toUpperCase().includes(q)||(r.reason??"").toUpperCase().includes(q));
 },[rows,query]);

 const add=async(hit:SymbolHit)=>{
  setMutating(hit.ticker);setError(null);
  try{
   const r=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:hit.ticker,reason:hit.name?`Manual watchlist: ${hit.name}`:"Manual watchlist",source:"watchlist-search"})});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error??"Unable to add ticker");
   setQuery("");setHits([]);await load();
  }catch(e){setError(e instanceof Error?e.message:"Unable to add ticker")}
  finally{setMutating(null)}
 };

 const remove=async(row:WatchRow)=>{
  setMutating(row.ticker);setError(null);
  try{
   const r=await fetch(`/api/watchlist?id=${encodeURIComponent(row.id)}`,{method:"DELETE"});
   const j=await r.json();
   if(!r.ok)throw new Error(j.error??"Unable to remove ticker");
   await load();
  }catch(e){setError(e instanceof Error?e.message:"Unable to remove ticker")}
  finally{setMutating(null)}
 };

 return <section className="card" data-watchlist-version="13.1" style={{borderTop:"2px solid var(--accent)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"flex-start"}}>
   <div><span className="tag">WATCHLIST INTELLIGENCE · V13.1</span><h3 className="sub" style={{margin:"10px 0 4px"}}>{t("Research follow-up and promotion pipeline","ติดตามหุ้นและส่งต่อเข้าสู่กระบวนการลงทุน")}</h3><p className="muted" style={{margin:0}}>{t("Search any ticker or company name, add it explicitly, and remove it when no longer needed.","ค้นหาหุ้นด้วย ticker หรือชื่อบริษัท เพิ่มเข้า Watchlist และลบออกได้โดยตรง")}</p></div>
   <button className="btn ghost sm" type="button" onClick={load}>Refresh</button>
  </div>

  <div className="searchbar" style={{marginTop:14,position:"relative"}}>
   <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t("Search ticker or company name","ค้นหา ticker หรือชื่อบริษัท")}/>
   <span className="tag">{rows.length} tracked</span>
  </div>

  {!!query.trim()&&<div className="card" style={{marginTop:8,padding:8}}>
   {searching?<div className="muted" style={{padding:8}}>{t("Searching market symbols…","กำลังค้นหาหุ้น…")}</div>:
   hits.length?hits.map(h=><div key={`${h.ticker}-${h.exchange??""}`} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,padding:"9px 8px",borderBottom:"1px solid var(--line)"}}>
    <div style={{minWidth:0}}><strong>{h.ticker}</strong> <span className="muted">· {h.name}</span><br/><span className="muted" style={{fontSize:10}}>{[h.type,h.exchange].filter(Boolean).join(" · ")}</span></div>
    {tracked.has(h.ticker.toUpperCase())?<span className="tag">TRACKED</span>:<button className="btn ghost sm" type="button" disabled={mutating===h.ticker} onClick={()=>void add(h)}>{mutating===h.ticker?t("Adding…","กำลังเพิ่ม…"):t("Add","เพิ่ม")}</button>}
   </div>):<div className="notice" style={{margin:0}}>{t("No matching symbols found. Try a ticker such as NVDA, QCOM or MELI.","ไม่พบหุ้นที่ตรงกัน ลองพิมพ์ ticker เช่น NVDA, QCOM หรือ MELI")}</div>}
  </div>}

  {loading&&<div className="notice" style={{marginTop:12}}>Loading watchlist…</div>}
  {error&&<div className="err" style={{marginTop:12}}>{error}</div>}
  {!loading&&!visible.length?<div className="notice" style={{marginTop:14}}>{query.trim()?t("No tracked ticker matches this filter. Use the search results above to add one.","ไม่มีหุ้นใน Watchlist ที่ตรงกับคำค้น ใช้ผลค้นหาด้านบนเพื่อเพิ่มหุ้นได้เลย"):t("Watchlist is empty. Search above to add a stock.","Watchlist ยังว่าง ค้นหาหุ้นด้านบนเพื่อเพิ่มได้เลย")}</div>:
  <div className="table-wrap" style={{marginTop:14}}><table className="tbl"><thead><tr><th>Ticker</th><th>Reason</th><th className="num">Target</th><th>Source</th><th>Action</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.ticker}</strong></td><td>{r.reason??"—"}</td><td className="num">{r.target_price==null?"—":`$${Number(r.target_price).toFixed(2)}`}</td><td>{r.source??"—"}</td><td><div style={{display:"flex",gap:6,flexWrap:"wrap"}}><button className="btn ghost sm" type="button" onClick={()=>{localStorage.setItem("sentinel:selectedResearchTicker",r.ticker);onNavigate("analyze")}}>Open Analyze</button><button className="btn ghost sm" type="button" disabled={mutating===r.ticker} onClick={()=>void remove(r)}>{mutating===r.ticker?t("Removing…","กำลังลบ…"):t("Remove","ลบ")}</button></div></td></tr>)}</tbody></table></div>}
 </section>
}
