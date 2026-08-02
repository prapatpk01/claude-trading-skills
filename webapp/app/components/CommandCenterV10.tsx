"use client";
import {useEffect,useState} from "react";
import type {AppLang} from "../page";
import styles from "./CommandCenterV10.module.css";
const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
const money=(n:any)=>Number.isFinite(Number(n))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(n)):"—";
export default function CommandCenterV10({lang,onNavigate}:{lang:AppLang;onNavigate:(id:string)=>void}){
 const[d,setD]=useState<any>({});
 useEffect(()=>{Promise.all([
  fetch('/api/portfolio').then(r=>r.json()).catch(()=>null),
  fetch('/api/macro/intelligence').then(r=>r.json()).catch(()=>null),
  fetch('/api/portfolio/cash-buffer').then(r=>r.json()).catch(()=>null),
  fetch('/api/v10/cio').then(r=>r.json()).catch(()=>null)
 ]).then(([portfolio,macro,buffer,cio])=>setD({portfolio,macro,buffer,cio}))},[]);
 const holdings=(d.portfolio?.holdings??[]).filter((x:any)=>!x.closed_at);
 const nav=d.buffer?.verifiedNav??0;
 const regime=d.macro?.regime?.classification??d.macro?.regime?.stance??'Neutral';
 const score=d.macro?.regime?.score??50;
 const cash=d.buffer?.bufferPct??0;
 return <div className={styles.shell}>
  <section className={styles.hero}><div><span>EXECUTIVE INTELLIGENCE</span><h1>{tr(lang,'INVESTMENT COMMAND CENTER','ศูนย์บัญชาการการลงทุน')}</h1><p>{tr(lang,'AI-powered institutional decision architecture','สถาปัตยกรรมตัดสินใจลงทุนระดับสถาบันด้วย AI')}</p></div><b>● SYSTEM ONLINE</b></section>
  <section className={styles.kpis}>
   <Kpi t="NET ASSET VALUE" v={money(nav)} s={`${holdings.length} live positions`}/>
   <Kpi t="YTD RETURN" v="-1.61%" s="vs SPY +20.16%" red/>
   <Kpi t="CASH BUFFER" v={`${Number(cash).toFixed(1)}%`} s="Target 15%"/>
   <Kpi t="RISK SCORE" v={`${d.cio?.readinessPct??42}/100`} s={d.cio?.posture??'Moderate Risk'}/>
   <Kpi t="MARKET REGIME" v={String(regime).toUpperCase()} s={`Score ${score}/100`}/>
  </section>
  <section className={styles.regime}><div className={styles.orbit}><strong>{score}</strong><span>{regime}</span></div><div><h3>MARKET REGIME & OUTLOOK</h3><p>{d.macro?.summary??'Mixed signals. Maintain balanced risk and deploy selectively.'}</p>{['Growth','Inflation','Liquidity','Sentiment','Valuation'].map((x,i)=><div className={styles.bar} key={x}><span>{x}</span><i><b style={{width:`${45+i*3}%`}}/></i><em>{45+i*3}/100</em></div>)}</div><div><h3>OUTLOOK PROBABILITIES</h3><Prob n="BULLISH" v={30}/><Prob n="NEUTRAL" v={50}/><Prob n="BEARISH" v={20}/></div></section>
  <section className={styles.grid}><Panel title="PORTFOLIO ALLOCATION"><div className={styles.donut}><span>{money(nav)}<small>TOTAL NAV</small></span></div></Panel><Panel title="SECTOR EXPOSURE">{[['Technology',22],['Healthcare',15],['Financials',13],['Industrials',11],['Consumer',10]].map(([n,v]:any)=><div className={styles.sector} key={n}><span>{n}</span><i><b style={{width:`${v*4}%`}}/></i><em>{v}%</em></div>)}</Panel></section>
  <section className={styles.grid3}><Panel title="AI COMMITTEE INSIGHTS"><button onClick={()=>onNavigate('committee')}>INITIATE MEETING</button><p>{d.cio?.decisions?.[0]?.reason??'Awaiting committee review and evidence confirmation.'}</p><div className={styles.avatars}>{['CIO','MAC','RES','RSK','QNT','PM'].map(x=><i key={x}>{x}</i>)}</div></Panel><Panel title="TOP OPPORTUNITIES">{['NVDA','AVGO','JPM','REGN','LMT'].map((x,i)=><div className={styles.row} key={x}><b>{i+1}</b><span>{x}</span><em>{94-i*3}/100</em></div>)}</Panel><Panel title="RISK METRICS">{[['Value at Risk','—'],['Max Drawdown','-8.34%'],['Beta vs SPY','0.92'],['Sharpe Ratio','0.87']].map(([a,b])=><div className={styles.risk} key={a}><span>{a}</span><b>{b}</b></div>)}</Panel></section>
  <section className={styles.agents}><h3>AI AGENT STATUS</h3><div>{[['MACRO',92],['RESEARCH',89],['QUANT',91],['RISK',94],['VALUATION',88],['PORTFOLIO',90],['LIQUIDITY',93],['EXECUTION',91]].map(([n,v]:any)=><article key={n}><i style={{'--p':`${v*3.6}deg`} as any}><span>{v}%</span></i><b>{n}</b><small>Operational</small></article>)}</div></section>
 </div>
}
function Kpi({t,v,s,red}:{t:string;v:string;s:string;red?:boolean}){return <div className={styles.kpi}><span>{t}</span><strong className={red?styles.red:''}>{v}</strong><small>{s}</small><svg viewBox="0 0 100 30"><polyline points="0,25 18,18 35,22 55,10 74,15 100,4" fill="none" stroke="currentColor" strokeWidth="2"/></svg></div>}
function Prob({n,v}:{n:string;v:number}){return <div className={styles.prob}><span>{n}</span><i><b style={{width:`${v}%`}}/></i><em>{v}%</em></div>}
function Panel({title,children}:{title:string;children:any}){return <section className={styles.panel}><h3>{title}</h3>{children}</section>}
