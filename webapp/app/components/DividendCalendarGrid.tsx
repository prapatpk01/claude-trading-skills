"use client";
import { useMemo, useState } from "react";
import { money } from "./format";

type Item={ticker:string;exDate:string;payDate:string;estAmountPerShare:number;estPayout:number;estPayoutNet:number};
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const key=(y:number,m:number)=>`${y}-${String(m+1).padStart(2,"0")}`;
export default function DividendCalendarGrid({items,withholdingPct=15}:{items:Item[];withholdingPct?:number}){
 const initial=items[0]?.exDate?new Date(items[0].exDate+"T00:00:00Z"):new Date();
 const [cursor,setCursor]=useState(new Date(Date.UTC(initial.getUTCFullYear(),initial.getUTCMonth(),1)));
 const [selected,setSelected]=useState<string|null>(items[0]?.exDate??null);
 const monthKey=key(cursor.getUTCFullYear(),cursor.getUTCMonth());
 const byDate=useMemo(()=>{const m=new Map<string,Item[]>();for(const x of items){for(const d of [x.exDate,x.payDate]){const a=m.get(d)??[];a.push(x);m.set(d,a)}}return m},[items]);
 const firstDow=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),1)).getUTCDay();
 const days=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,0)).getUTCDate();
 const prevDays=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),0)).getUTCDate();
 const cells:Array<{date:string;day:number;muted:boolean}>=[];
 for(let i=firstDow-1;i>=0;i--){const d=prevDays-i,dt=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()-1,d));cells.push({date:dt.toISOString().slice(0,10),day:d,muted:true})}
 for(let d=1;d<=days;d++){const dt=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth(),d));cells.push({date:dt.toISOString().slice(0,10),day:d,muted:false})}
 while(cells.length<42){const d=cells.length-firstDow-days+1,dt=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+1,d));cells.push({date:dt.toISOString().slice(0,10),day:d,muted:true})}
 const selectedItems=selected?(byDate.get(selected)??[]):[];
 const monthLabel=cursor.toLocaleDateString(undefined,{month:"long",year:"numeric",timeZone:"UTC"});
 const move=(n:number)=>setCursor(new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+n,1)));
 return <div>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:12}}><button className="btn ghost sm" onClick={()=>move(-1)}>‹</button><strong style={{fontSize:18}}>{monthLabel}</strong><button className="btn ghost sm" onClick={()=>move(1)}>›</button></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:6}}>{DOW.map(d=><div key={d} className="muted" style={{fontSize:10,fontWeight:800,textAlign:"center",paddingBottom:4}}>{d}</div>)}{cells.map(c=>{const ev=byDate.get(c.date)??[],active=selected===c.date;return <button key={c.date} onClick={()=>setSelected(c.date)} style={{minHeight:64,borderRadius:12,border:active?"1px solid var(--accent-2)":"1px solid var(--border)",background:active?"rgba(87,132,255,.12)":"rgba(8,14,28,.38)",padding:7,textAlign:"left",opacity:c.muted?.45:1,color:"inherit"}}><div style={{fontWeight:800,fontSize:12}}>{c.day}</div><div style={{display:"flex",gap:3,flexWrap:"wrap",marginTop:7}}>{ev.slice(0,4).map((x,i)=>{const ex=x.exDate===c.date,pay=x.payDate===c.date;return <span key={`${x.ticker}-${i}`} title={`${x.ticker} ${ex?"XD":"Pay"}`} style={{fontSize:8.5,padding:"2px 4px",borderRadius:999,background:ex?"rgba(245,185,59,.2)":"rgba(47,214,137,.18)",color:ex?"var(--amber)":"var(--green)",fontWeight:800}}>{x.ticker}</span>})}</div></button>})}</div>
  <div className="notice" style={{marginTop:14}}><strong>{selected??monthKey}</strong>{selectedItems.length===0?<div className="muted" style={{marginTop:6}}>No projected dividend event on this date.</div>:<div style={{display:"grid",gap:8,marginTop:9}}>{selectedItems.map((x,i)=>{const isEx=x.exDate===selected;return <div key={`${x.ticker}-${i}`} style={{padding:"10px 12px",border:"1px solid var(--border)",borderRadius:10}}><div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong>{x.ticker} · {isEx?"XD":"PAYMENT"}</strong><span className={isEx?"":"pos"}>{isEx?`Ex-date ${x.exDate}`:`Pay date ${x.payDate}`}</span></div><div className="grid cols-4" style={{marginTop:8}}><M l="Per share" v={money(x.estAmountPerShare)}/><M l="Gross" v={money(x.estPayout)}/><M l={`Net after ${withholdingPct}%`} v={money(x.estPayoutNet)}/><M l={isEx?"Est. pay date":"Ex-date"} v={isEx?x.payDate:x.exDate}/></div></div>})}</div>}</div>
  <div style={{display:"flex",gap:12,marginTop:8,fontSize:11}}><span><b style={{color:"var(--amber)"}}>●</b> XD</span><span><b style={{color:"var(--green)"}}>●</b> Pay date</span></div>
 </div>
}
function M({l,v}:{l:string;v:any}){return <div><div className="muted" style={{fontSize:9.5}}>{l}</div><div style={{fontWeight:800,fontSize:12,marginTop:2}}>{v}</div></div>}
