"use client";
import {useEffect,useState} from "react";
import type {AppLang} from "../page";
import styles from "./CommitteeMeetingV10.module.css";
const members=[
 {desk:'CIO',name:'Alex Morgan',role:'Chief Investment Officer',vote:'PENDING'},
 {desk:'MACRO',name:'Dr. Sarah Chen',role:'Global Macro Team',vote:'STRONG BUY'},
 {desk:'RESEARCH',name:'Michael Johnson',role:'Equity Research',vote:'BUY'},
 {desk:'RISK',name:'David Kim',role:'Chief Risk Officer',vote:'CAUTION'},
 {desk:'QUANT',name:'Dr. Emily Zhang',role:'Quantitative Research',vote:'BUY'},
 {desk:'PORTFOLIO',name:'James Wilson',role:'Portfolio Construction',vote:'BUY'},
 {desk:'TREASURY',name:'Lisa Park',role:'Liquidity & Treasury',vote:'NEUTRAL'}
];
export default function CommitteeMeetingV10({lang}:{lang:AppLang}){
 const[data,setData]=useState<any>(null); const[loading,setLoading]=useState(true);
 useEffect(()=>{fetch('/api/v10/cio',{cache:'no-store'}).then(r=>r.json()).then(setData).finally(()=>setLoading(false))},[]);
 const decisions=data?.decisions??[];
 const consensus=data?.status==='READY'?'BUY':'HOLD / REVIEW';
 return <section className={styles.room}>
  <header><div><span>AI COMMITTEE · IC-MEETING-v10</span><h2>{lang==='th'?'การประชุมคณะกรรมการลงทุน AI':'AI INVESTMENT COMMITTEE MEETING'}</h2><p>{lang==='th'?'การพิจารณา ข้อโต้แย้ง การลงคะแนน และมติสุดท้ายภายใต้การกำกับของมนุษย์':'Institutional deliberation, dissent, voting and final human authorization.'}</p></div><b>{loading?'CONVENING':'IN PROGRESS'}</b></header>
  <div className={styles.members}>{members.map((m,i)=>{const api=decisions[i]; const vote=api?.action??m.vote; return <article key={m.desk}><div className={styles.avatar}>{m.desk.slice(0,2)}</div><strong>{m.name}</strong><span>{m.desk}</span><small>{m.role}</small><em className={styles[vote.toLowerCase().replaceAll(' ','')]??''}>{vote}</em></article>})}</div>
  <div className={styles.body}>
   <div className={styles.proposal}><h3>PROPOSAL UNDER REVIEW</h3><strong>{data?.posture??'Balanced Risk Allocation'}</strong><p>{data?.blockers?.[0]??'Review the highest-conviction opportunity while preserving the liquidity floor and risk budget.'}</p><dl><div><dt>Readiness</dt><dd>{data?.readinessPct??'—'}%</dd></div><div><dt>Execution</dt><dd>HUMAN ONLY</dd></div><div><dt>Evidence</dt><dd>{data?.governance?.evidenceRequired===false?'PARTIAL':'REQUIRED'}</dd></div></dl></div>
   <div className={styles.discussion}><h3>COMMITTEE DISCUSSION</h3>{members.slice(1,6).map((m,i)=><div key={m.desk}><span>{m.desk}</span><p>{decisions[i]?.reason??defaultNote(m.desk)}</p></div>)}</div>
   <div className={styles.summary}><h3>DECISION SUMMARY</h3><div className={styles.voteRing}><strong>{members.length}</strong><span>TOTAL VOTES</span></div><ul><li><b>STRONG BUY</b><span>1</span></li><li><b>BUY</b><span>3</span></li><li><b>NEUTRAL</b><span>1</span></li><li><b>CAUTION</b><span>1</span></li><li><b>SELL</b><span>0</span></li></ul><div className={styles.consensus}><span>CONSENSUS</span><strong>{consensus}</strong><small>Human authorization required</small></div></div>
  </div>
  <footer><strong>DISSENT LOG</strong><span>Risk: Maintain position-size discipline until database integrity and evidence controls are fully verified.</span></footer>
 </section>
}
function defaultNote(desk:string){return ({MACRO:'Macro backdrop is mixed; retain a balanced risk posture.',RESEARCH:'Fundamental evidence supports selective high-quality opportunities.',RISK:'Position size and liquidity floor must remain hard constraints.',QUANT:'Factor alignment is constructive but timing confidence is moderate.',PORTFOLIO:'Allocate only after concentration and cash-buffer checks.'} as any)[desk]??'Review pending.'}
