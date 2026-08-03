"use client";
import type {AppLang} from"../page";
import styles from"./CommandCenterV10.module.css";
import {useFundSnapshot} from"./useFundSnapshot";
const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
const money=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n);
const pct=(n:number|null)=>n==null?"—":`${n>=0?"+":""}${n.toFixed(2)}%`;
export default function CommandCenterV10({lang,onNavigate}:{lang:AppLang;onNavigate:(id:string)=>void}){
 const fund=useFundSnapshot();
 if(fund.loading)return <div className={styles.shell}><section className={styles.hero}><p>Loading verified fund snapshot…</p></section></div>;
 const top=[...fund.holdings].sort((a,b)=>b.marketValue-a.marketValue).slice(0,5);
 return <div className={styles.shell} data-source="fund-snapshot">
  <section className={styles.hero}><div><span>EXECUTIVE INTELLIGENCE</span><h1>{tr(lang,'INVESTMENT COMMAND CENTER','ศูนย์บัญชาการการลงทุน')}</h1><p>{tr(lang,'One verified portfolio snapshot across the fund operating system','ข้อมูลพอร์ตจริงชุดเดียวสำหรับระบบบริหารกองทุนทั้งหมด')}</p></div><b>● {fund.verified?'PORTFOLIO VERIFIED':'VERIFY MARKET DATA'}</b></section>
  <section className={styles.kpis}>
   <Kpi t="NET ASSET VALUE" v={money(fund.totalNav)} s={`${fund.openPositions} live positions · ${fund.verified?'VERIFIED':'PARTIAL'}`}/>
   <Kpi t="UNREALIZED P/L" v={money(fund.unrealizedPnl)} s={pct(fund.unrealizedPnlPct)} red={fund.unrealizedPnl<0}/>
   <Kpi t="CASH BUFFER" v={`${fund.cashBufferPct.toFixed(1)}%`} s={`${money(fund.cashAndEquivalents)} · Target ${fund.targetCashPct.toFixed(0)}%`}/>
   <Kpi t="RISK SCORE" v={`${fund.riskScore}/100`} s={fund.riskScore>=75?'CONTROLLED':fund.riskScore>=55?'HOLD / VERIFY':'DEFENSIVE'}/>
   <Kpi t="MARKET REGIME" v={fund.macroLabel.toUpperCase()} s={`Score ${fund.macroScore.toFixed(0)}/100`}/>
  </section>
  <section className={styles.regime}><div className={styles.orbit}><strong>{fund.macroScore.toFixed(0)}</strong><span>{fund.macroLabel}</span></div><div><h3>MARKET REGIME & OUTLOOK</h3><p>{fund.macroVision}</p><div className={styles.risk}><span>Evidence confidence</span><b>{fund.macroConfidence}</b></div><div className={styles.risk}><span>Deployable above policy</span><b>{money(fund.deployableCash)}</b></div><div className={styles.risk}><span>Portfolio health</span><b>{fund.portfolioHealth}/100</b></div></div><div><h3>OUTLOOK PROBABILITIES</h3><Prob n="BULLISH" v={fund.bullishPct}/><Prob n="NEUTRAL" v={fund.neutralPct}/><Prob n="BEARISH" v={fund.bearishPct}/></div></section>
  <section className={styles.grid}><Panel title="PORTFOLIO ALLOCATION"><div className={styles.donut}><span>{money(fund.totalNav)}<small>{fund.verified?'VERIFIED NAV':'PARTIAL NAV'}</small></span></div></Panel><Panel title="TOP HOLDINGS">{top.map(row=><div className={styles.sector} key={row.ticker}><span>{row.ticker}</span><i><b style={{width:`${Math.min(100,row.weightPct*4)}%`}}/></i><em>{row.weightPct.toFixed(1)}%</em></div>)}</Panel></section>
  <section className={styles.grid3}><Panel title="COMMITTEE INSIGHT"><button onClick={()=>onNavigate('portfolio')}>REVIEW PORTFOLIO</button><p>{fund.deployableCash>0?`${money(fund.deployableCash)} is available above the ${fund.targetCashPct.toFixed(0)}% reserve target. Human approval remains mandatory.`:'No capital is currently authorized above the reserve target.'}</p><div className={styles.avatars}>{['CIO','MAC','RES','RSK','QNT','PM'].map(x=><i key={x}>{x}</i>)}</div></Panel><Panel title="LARGEST POSITIONS">{top.map((row,i)=><div className={styles.row} key={row.ticker}><b>{i+1}</b><span>{row.ticker}</span><em>{money(row.marketValue)}</em></div>)}</Panel><Panel title="FUND METRICS">{[['Cost basis',money(fund.costBasis)],['Cash & equivalents',money(fund.cashAndEquivalents)],['Deployable cash',money(fund.deployableCash)],['YTD return',pct(fund.ytdReturnPct)]].map(([a,b])=><div className={styles.risk} key={a}><span>{a}</span><b>{b}</b></div>)}</Panel></section>
  <section className={styles.agents}><h3>DESK STATUS</h3><div>{[['MACRO',fund.macroScore],['RESEARCH',fund.qualityScore],['QUANT',fund.portfolioHealth],['RISK',fund.riskScore],['VALUATION',fund.qualityScore],['PORTFOLIO',fund.portfolioHealth],['LIQUIDITY',fund.liquidityScore],['EXECUTION',fund.verified?95:55]].map(([n,v]:any)=><article key={n}><i style={{'--p':`${Number(v)*3.6}deg`} as any}><span>{Number(v).toFixed(0)}%</span></i><b>{n}</b><small>{fund.verified?'Operational':'Verify data'}</small></article>)}</div></section>
 </div>
}
function Kpi({t,v,s,red}:{t:string;v:string;s:string;red?:boolean}){return <div className={styles.kpi}><span>{t}</span><strong className={red?styles.red:''}>{v}</strong><small>{s}</small></div>}
function Prob({n,v}:{n:string;v:number|null}){return <div className={styles.prob}><span>{n}</span><i><b style={{width:`${v??0}%`}}/></i><em>{v==null?'—':`${v}%`}</em></div>}
function Panel({title,children}:{title:string;children:any}){return <section className={styles.panel}><h3>{title}</h3>{children}</section>}
