"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./FundCommandCenter.module.css";

type Lang="en"|"th";
type Holding={id:string;ticker:string;shares:number;avg_cost:number;closed_at?:string|null};
type Quote={price?:number}|null;
type Analysis={momentum?:{total?:number}};
type Fact={ticker:string;growthPct:number|null;growthSource:string|null;yieldPct:number|null;yieldSource:string|null;sector:string|null;industry:string|null;warnings:string[]};
type Props={holdings:Holding[];quotes:Record<string,Quote>;lang:Lang};
type PrimarySleeve="Growth"|"Income"|"Defensive"|"Unclassified";
type MomentumOverlay="Strong"|"Positive"|"Neutral"|"Weak"|"Unknown";

const TARGETS:Record<Exclude<PrimarySleeve,"Unclassified">,number>={Growth:45,Income:40,Defensive:15};
const ROLE_HINTS:Record<string,Exclude<PrimarySleeve,"Unclassified">>={
 SGOV:"Defensive",JAAA:"Defensive",BIL:"Defensive",SHV:"Defensive",TFLO:"Defensive",USFR:"Defensive",
 SCHD:"Income",VYMI:"Income",GPIQ:"Income",JEPI:"Income",JEPQ:"Income",QDVO:"Income",FDVV:"Income",O:"Income",MO:"Income",ENB:"Income",BTI:"Income",JNJ:"Income",USB:"Income",ITUB:"Income",
 VOO:"Growth",SPMO:"Growth",QQQ:"Growth",QQQM:"Growth",VUG:"Growth"
};
const tx=(l:Lang,en:string,th:string)=>l==="th"?th:en;
const signed=(n:number)=>`${n>=0?"+":""}${n.toFixed(1)}%`;
const fmt=(n:number|null)=>n==null?"—":`${n>=0?"+":""}${n.toFixed(1)}%`;

function overlay(score:number|null):MomentumOverlay{if(score==null)return"Unknown";if(score>=75)return"Strong";if(score>=60)return"Positive";if(score>=45)return"Neutral";return"Weak";}
function classify(ticker:string,yieldPct:number|null,growthPct:number|null,sector:string|null){
 const hint=ROLE_HINTS[ticker];
 if(hint){const en=hint==="Income"?"income mandate / dividend profile":hint==="Defensive"?"cash / fixed-income mandate":"core growth / equity mandate";const th=hint==="Income"?"บทบาทสร้างรายได้ / ปันผล":hint==="Defensive"?"บทบาทเงินสด / ตราสารหนี้เชิงรับ":"บทบาทเติบโต / หุ้นแกนหลัก";return{sleeve:hint as PrimarySleeve,reasonEn:en,reasonTh:th};}
 if(yieldPct!=null&&yieldPct>=3)return{sleeve:"Income" as PrimarySleeve,reasonEn:`income profile · yield ${yieldPct.toFixed(1)}%`,reasonTh:`ลักษณะสร้างรายได้ · ปันผล ${yieldPct.toFixed(1)}%`};
 if(growthPct!=null&&growthPct>=12)return{sleeve:"Growth" as PrimarySleeve,reasonEn:`revenue growth ${growthPct.toFixed(1)}%`,reasonTh:`รายได้เติบโต ${growthPct.toFixed(1)}%`};
 const s=(sector??"").toLowerCase();
 if(s.includes("utilit")||s.includes("real estate"))return{sleeve:"Income" as PrimarySleeve,reasonEn:`${sector} income-oriented business model`,reasonTh:`${sector} มีบทบาทเน้นรายได้`};
 return{sleeve:"Unclassified" as PrimarySleeve,reasonEn:"insufficient evidence — no primary sleeve assigned",reasonTh:"ข้อมูลไม่เพียงพอ — ยังไม่จัดเข้ากลุ่มหลัก"};
}

async function loadMomentum(tickers:string[]){const out:Record<string,Analysis|null>={};for(let i=0;i<tickers.length;i+=3){const rows=await Promise.all(tickers.slice(i,i+3).map(async ticker=>{try{const r=await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);return[ticker,r.ok?await r.json():null] as const}catch{return[ticker,null] as const}}));rows.forEach(([t,a])=>out[t]=a);}return out;}
async function loadFacts(tickers:string[],quotes:Record<string,Quote>){const prices:Record<string,number|null>=Object.fromEntries(tickers.map(t=>[t,quotes[t]?.price??null]));const r=await fetch("/api/portfolio-facts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({tickers,prices}),cache:"no-store"});if(!r.ok)throw new Error("portfolio facts failed");return (await r.json()).facts as Record<string,Fact>;}

export default function PortfolioIntelligence({holdings,quotes,lang}:Props){
 const [analysis,setAnalysis]=useState<Record<string,Analysis|null>>({});
 const [facts,setFacts]=useState<Record<string,Fact>>({});
 const [momentumLoading,setMomentumLoading]=useState(false);
 const [factsLoading,setFactsLoading]=useState(false);
 const tickerKey=Array.from(new Set(holdings.filter(h=>!h.closed_at).map(h=>h.ticker))).sort().join(",");
 const quoteKey=TickerArray(tickerKey).map(t=>`${t}:${quotes[t]?.price??"na"}`).join("|");

 useEffect(()=>{const tickers=tickerKey?TickerArray(tickerKey):[];if(!tickers.length){setAnalysis({});return;}let cancelled=false;setMomentumLoading(true);loadMomentum(tickers).then(a=>{if(!cancelled)setAnalysis(a)}).finally(()=>{if(!cancelled)setMomentumLoading(false)});return()=>{cancelled=true};},[tickerKey]);

 useEffect(()=>{const tickers=tickerKey?TickerArray(tickerKey):[];if(!tickers.length){setFacts({});return;}let cancelled=false;setFactsLoading(true);loadFacts(tickers,quotes).then(f=>{if(!cancelled)setFacts(f)}).catch(()=>{if(!cancelled)setFacts({})}).finally(()=>{if(!cancelled)setFactsLoading(false)});return()=>{cancelled=true};},[tickerKey,quoteKey]);

 const model=useMemo(()=>{const open=holdings.filter(h=>!h.closed_at);let nav=0;const positions=open.map(h=>{const price=quotes[h.ticker]?.price??h.avg_cost,value=Math.max(0,price*h.shares);nav+=value;const momentum=analysis[h.ticker]?.momentum?.total??null,f=facts[h.ticker],growthPct=f?.growthPct??null,yieldPct=f?.yieldPct??null,sector=f?.sector??null,p=classify(h.ticker,yieldPct,growthPct,sector);return{...h,value,momentum,momentumOverlay:overlay(momentum),growthPct,yieldPct,growthSource:f?.growthSource??null,yieldSource:f?.yieldSource??null,sector,sleeve:p.sleeve,reasonEn:p.reasonEn,reasonTh:p.reasonTh};});
 const classifiedNav=positions.filter(p=>p.sleeve!=="Unclassified").reduce((s,p)=>s+p.value,0);const sleeves=(Object.keys(TARGETS) as Array<Exclude<PrimarySleeve,"Unclassified">>).map(sleeve=>{const members=positions.filter(p=>p.sleeve===sleeve),value=members.reduce((s,p)=>s+p.value,0),actual=classifiedNav?value/classifiedNav*100:0,target=TARGETS[sleeve];return{sleeve,members,value,actual,target,drift:actual-target}});const unknown=positions.filter(p=>p.sleeve==="Unclassified"),unknownPct=nav?unknown.reduce((s,p)=>s+p.value,0)/nav*100:0,coveragePct=nav?classifiedNav/nav*100:0,proposals=coveragePct>=85?sleeves.filter(s=>Math.abs(s.drift)>=3).sort((a,b)=>Math.abs(b.drift)-Math.abs(a.drift)):[];return{nav,classifiedNav,coveragePct,positions,sleeves,proposals,unknown,unknownPct,momentumStats:{strong:positions.filter(p=>p.momentumOverlay==="Strong"),positive:positions.filter(p=>p.momentumOverlay==="Positive"),weak:positions.filter(p=>p.momentumOverlay==="Weak")}};},[holdings,quotes,analysis,facts]);

 const loading=momentumLoading||factsLoading;
 return <section className={styles.panel}>
  <div className={styles.panelTitle}><h3>{tx(lang,"Portfolio Intelligence Engine","ระบบวิเคราะห์พอร์ตอัจฉริยะ")}</h3><span>{loading?tx(lang,"loading growth, yield & momentum","กำลังโหลด Growth, Yield และ Momentum"):tx(lang,"Growth · Income · Defensive + Momentum Overlay","เติบโต · รายได้ · เชิงรับ + Momentum Overlay")}</span></div>
  <div className={styles.intelGrid}>{model.sleeves.map(s=><div className={styles.intelCard} key={s.sleeve}><div className={styles.intelHead}><strong>{tx(lang,s.sleeve,s.sleeve==="Growth"?"เติบโต":s.sleeve==="Income"?"รายได้ / ปันผล":"เชิงรับ / เงินสด")}</strong><span>{s.actual.toFixed(1)}% / {s.target}%</span></div><div className={styles.intelBar}><span style={{width:`${Math.min(100,s.actual)}%`}}/></div><div className={styles.intelMeta}><span className={Math.abs(s.drift)>=3?styles.neg:styles.pos}>{tx(lang,"Drift","ส่วนเบี่ยงเบน")} {signed(s.drift)}</span><span>{s.members.map(m=>m.ticker).join(", ")||"—"}</span></div></div>)}</div>

  <div className={styles.rebalanceBox}><div className={styles.rebalanceTitle}>{tx(lang,"Momentum Overlay","Momentum Overlay")}</div><div className={styles.queue}><Queue title={tx(lang,"Strong momentum","โมเมนตัมแข็งแรง")} text={model.momentumStats.strong.map(p=>p.ticker).join(", ")||"—"}/><Queue title={tx(lang,"Positive momentum","โมเมนตัมเป็นบวก")} text={model.momentumStats.positive.map(p=>p.ticker).join(", ")||"—"}/><Queue title={tx(lang,"Weak momentum / review","โมเมนตัมอ่อน / ควรทบทวน")} text={model.momentumStats.weak.map(p=>p.ticker).join(", ")||"—"}/></div></div>

  <div className={styles.rebalanceBox}><div className={styles.rebalanceTitle}>{tx(lang,"Rebalance Proposal","ข้อเสนอการรีบาลานซ์")}</div>{model.coveragePct<85?<div className={styles.rebalanceOk}>{tx(lang,`Classification coverage is ${model.coveragePct.toFixed(1)}%. Rebalance withheld until 85% of NAV is classified.`,`จัดกลุ่มได้ ${model.coveragePct.toFixed(1)}% ของ NAV จึงยังไม่ออกข้อเสนอรีบาลานซ์จนกว่าจะถึง 85%`)}</div>:model.proposals.length===0?<div className={styles.rebalanceOk}>{tx(lang,"Primary sleeves are within the ±3% policy band.","สัดส่วนกลุ่มหลักอยู่ในกรอบนโยบาย ±3%")}</div>:<div className={styles.queue}>{model.proposals.map(s=>{const d=model.classifiedNav*Math.abs(s.drift)/100,over=s.drift>0;return <Queue key={s.sleeve} title={`${over?tx(lang,"Trim","ลด"):tx(lang,"Add","เพิ่ม")} ${s.sleeve}`} text={tx(lang,`${s.actual.toFixed(1)}% vs ${s.target}% target · indicative ${d.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`,`ปัจจุบัน ${s.actual.toFixed(1)}% เทียบเป้า ${s.target}% · มูลค่าปรับโดยประมาณ ${d.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`)}/>})}</div>}</div>

  {model.unknown.length>0&&<div className={styles.rebalanceBox}><div className={styles.rebalanceTitle}>{tx(lang,"Unclassified / needs evidence","ยังไม่จัดกลุ่ม / ต้องเพิ่มข้อมูล")}</div><div className={styles.intelNote}>{model.unknown.map(p=>p.ticker).join(", ")} · {model.unknownPct.toFixed(1)}% NAV</div></div>}

  <div className={styles.tableWrapLocal}><table className={styles.intelTable}><thead><tr><th>{tx(lang,"Ticker","หุ้น")}</th><th>{tx(lang,"Primary role","บทบาทหลัก")}</th><th>{tx(lang,"Momentum overlay","Momentum Overlay")}</th><th>{tx(lang,"Growth","การเติบโต")}</th><th>{tx(lang,"Yield","ปันผล")}</th><th>{tx(lang,"Classification","เหตุผลจัดกลุ่ม")}</th></tr></thead><tbody>{model.positions.map(p=><tr key={p.id}><td><strong>{p.ticker}</strong></td><td>{p.sleeve}</td><td>{p.momentumOverlay}{p.momentum==null?"":` (${p.momentum})`}</td><td title={p.growthSource??undefined}>{fmt(p.growthPct)}</td><td title={p.yieldSource??undefined}>{p.yieldPct==null?"—":`${p.yieldPct.toFixed(2)}%`}</td><td>{lang==="th"?p.reasonTh:p.reasonEn}</td></tr>)}</tbody></table></div>
  <div className={styles.disclaimer}>{tx(lang,"Growth uses latest reported-quarter YoY revenue where available, then annual revenue CAGR. Yield uses actual dividend history and current price, then falls back to overview data. Momentum remains an overlay, not an asset class.","Growth ใช้รายได้ YoY ไตรมาสล่าสุดก่อน แล้ว fallback เป็น CAGR รายปี ส่วน Yield คำนวณจากประวัติปันผลจริงและราคาปัจจุบัน แล้วจึง fallback ไปข้อมูล overview โดย Momentum เป็น overlay ไม่ใช่ asset class")}</div>
 </section>;
}
function TickerArray(key:string){return key.split(",").filter(Boolean)}
function Queue({title,text}:{title:string;text:string}){return <div className={styles.queueItem}><span className={styles.queueDot}/><div><strong>{title}</strong><div className={styles.intelNote}>{text}</div></div></div>}
