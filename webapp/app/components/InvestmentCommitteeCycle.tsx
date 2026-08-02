"use client";

import {useMemo,useState} from "react";
import type {AppLang} from "../page";
import styles from "./InvestmentCommitteeCycle.module.css";

type Desk="Macro"|"Portfolio"|"Research"|"Valuation"|"Risk"|"Liquidity"|"Compliance";
type Vote="APPROVE"|"CAUTION"|"REJECT"|"VETO";
type Proposal={ticker:string;action:string;amount:number|null;weight:number|null;reason:string;score:number|null;isNew:boolean};
type DeskOpinion={desk:Desk;vote:Vote;confidence:number;comment:string};
type Resolution={proposal:Proposal;opinions:DeskOpinion[];approved:boolean;vetoed:boolean;yes:number;no:number};

const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
const num=(v:unknown)=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null};
const text=(...v:unknown[])=>v.find(x=>typeof x==="string"&&x.trim()) as string|undefined;
const usd=(v:number|null)=>v==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v);
async function get(path:string){const r=await fetch(path,{cache:"no-store"});let body:any={};try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body}}

function buildOpinions(p:Proposal,ctx:any):DeskOpinion[]{
 const regime=String(ctx.regime??"NEUTRAL").toUpperCase();
 const reserve=num(ctx.reserve)??0;
 const score=p.score??60;
 const amount=p.amount??0;
 const nav=num(ctx.nav)??0;
 const proposedPct=p.weight??(nav>0?amount/nav*100:0);
 const macroVote:Vote=regime.includes("RISK-OFF")&&p.action.includes("BUY")?"CAUTION":"APPROVE";
 const riskVote:Vote=proposedPct>8?"VETO":proposedPct>5?"CAUTION":"APPROVE";
 const liquidityVote:Vote=reserve<8&&amount>0?"VETO":reserve<12&&amount>0?"CAUTION":"APPROVE";
 const researchVote:Vote=score>=80?"APPROVE":score>=65?"CAUTION":"REJECT";
 const valuationVote:Vote=p.action.includes("TRIM")||p.action.includes("EXIT")?"APPROVE":score>=70?"APPROVE":"CAUTION";
 return [
  {desk:"Macro",vote:macroVote,confidence:Math.min(95,60+Math.round(Math.abs((num(ctx.macroScore)??50)-50)/2)),comment:regime.includes("RISK-OFF")?"Macro backdrop requires smaller sizing and stronger evidence.":"Current regime permits selective risk-taking."},
  {desk:"Portfolio",vote:"APPROVE",confidence:84,comment:p.isNew?"Candidate improves the opportunity set if sizing remains controlled.":"Action is consistent with current portfolio construction rules."},
  {desk:"Research",vote:researchVote,confidence:Math.max(45,Math.min(96,score)),comment:score>=80?"Evidence and conviction are strong.":score>=65?"Thesis is viable but requires monitoring.":"Evidence is not strong enough for capital deployment."},
  {desk:"Valuation",vote:valuationVote,confidence:score>=70?82:65,comment:p.action.includes("TRIM")?"Valuation or concentration supports reducing exposure.":"Expected return is acceptable relative to the evidence supplied."},
  {desk:"Risk",vote:riskVote,confidence:92,comment:proposedPct>8?"VETO: proposed position exceeds the committee risk budget.":proposedPct>5?"Approve only with reduced position size.":"Position size is within risk policy."},
  {desk:"Liquidity",vote:liquidityVote,confidence:90,comment:reserve<8?"VETO: reserve floor would be breached.":reserve<12?"Liquidity is tight; phase the trade.":"Liquidity sleeve can support the proposal."},
  {desk:"Compliance",vote:"APPROVE",confidence:98,comment:"Human approval remains mandatory and no order is executed automatically."},
 ];
}

export default function InvestmentCommitteeCycle({lang}:{lang:AppLang}){
 const[running,setRunning]=useState(false);const[phase,setPhase]=useState(0);const[data,setData]=useState<any>(null);const[error,setError]=useState<string|null>(null);const[started,setStarted]=useState<string|null>(null);const[finished,setFinished]=useState<string|null>(null);
 const resolutions=useMemo<Resolution[]>(()=>{
  if(!data)return[];return data.proposals.map((p:Proposal)=>{const opinions=buildOpinions(p,data);const vetoed=opinions.some(x=>x.vote==="VETO");const yes=opinions.filter(x=>x.vote==="APPROVE").length;const no=opinions.filter(x=>x.vote==="REJECT"||x.vote==="VETO").length;return{proposal:p,opinions,vetoed,yes,no,approved:!vetoed&&yes>=4&&no<=1}})
 },[data]);
 const approved=resolutions.filter(x=>x.approved);
 async function convene(){setRunning(true);setError(null);setData(null);setStarted(new Date().toISOString());setFinished(null);setPhase(1);
  try{
   const macro=await get("/api/macro/intelligence");setPhase(2);
   const portfolio=await get("/api/portfolio");const analytics=await get("/api/portfolio/analytics");setPhase(3);
   const optimizer=await get("/api/portfolio/optimizer");const opportunities=await get("/api/portfolio/opportunity-allocation");setPhase(4);
   const liquidity=await get("/api/portfolio/cash-buffer");const cio=await get("/api/v10/cio");
   const holdings=Array.isArray(portfolio.body?.holdings)?portfolio.body.holdings.filter((h:any)=>!h.closed_at):[];
   const held=new Set(holdings.map((h:any)=>String(h.ticker??"").toUpperCase()));
   const proposals:Proposal[]=[];
   for(const p of Array.isArray(optimizer.body?.proposals)?optimizer.body.proposals:[]){const ticker=String(p?.ticker??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY"||ticker==="OPPORTUNITY PIPELINE")continue;const action=String(p?.action??"HOLD").toUpperCase();if(action==="HOLD"||action.includes("WATCH"))continue;proposals.push({ticker,action,amount:num(p?.capitalUsd),weight:num(p?.targetWeightPct),reason:text(p?.reason)??"Portfolio construction proposal.",score:num(p?.score),isNew:false})}
   for(const p of Array.isArray(opportunities.body?.allocations)?opportunities.body.allocations:[]){const ticker=String(p?.ticker??"").toUpperCase();if(!ticker)continue;const amount=num(p?.approvedCapitalUsd)??0;if(amount<=0)continue;proposals.push({ticker,action:held.has(ticker)?"ADD EXISTING":"OPEN NEW",amount,weight:num(p?.proposedWeightPct),reason:text(p?.thesis,p?.reason)??"Research candidate cleared evidence gates.",score:num(p?.conviction),isNew:!held.has(ticker)})}
   const unique=Array.from(new Map(proposals.map(p=>[`${p.action}:${p.ticker}`,p])).values());
   setData({
    regime:text(liquidity.body?.regime?.classification,macro.body?.regime?.classification,macro.body?.classification)??"NEUTRAL",
    macroScore:num(macro.body?.regime?.score??macro.body?.score)??50,
    sentiment:text(macro.body?.sentiment?.label,macro.body?.outlook?.stance,macro.body?.classification)??"Mixed",
    nav:num(liquidity.body?.totalNav??optimizer.body?.portfolio?.nav),reserve:num(liquidity.body?.bufferPct??optimizer.body?.portfolio?.bufferPct),
    reserveTarget:num(liquidity.body?.targetPct)??15,reserveGap:Math.abs(num(liquidity.body?.gapValue)??0),
    holdingsCount:holdings.length,health:num(analytics.body?.healthScore??analytics.body?.portfolioHealthScore)??num(cio.body?.readinessPct)??0,
    quality:text(analytics.body?.qualityGrade,analytics.body?.status)??"MONITOR",risk:text(analytics.body?.riskLabel,cio.body?.posture)??"HOLD / VERIFY",
    proposals:unique,candidates:Array.isArray(opportunities.body?.allocations)?opportunities.body.allocations.length:0,
   });setPhase(5);setFinished(new Date().toISOString())
  }catch(e:any){setError(e?.message??"Meeting failed")}finally{setRunning(false)}
 }
 return <section className={styles.shell}>
  <header className={styles.hero}><div><span>IC-MEETING · SENTINEL v10.1</span><h2>{tr(lang,"Investment Committee Meeting","การประชุมคณะกรรมการลงทุน")}</h2><p>{tr(lang,"One meeting. Seven specialist desks. One CIO resolution and one execution package.","ประชุมครั้งเดียว เจ็ดทีมผู้เชี่ยวชาญ สรุปเป็นมติ CIO และชุดคำสั่งปรับพอร์ตเพียงชุดเดียว")}</p></div><button onClick={convene} disabled={running}>{running?tr(lang,"Meeting in progress…","กำลังประชุม…"):tr(lang,"Convene committee","เริ่มประชุมคณะกรรมการ")}</button></header>
  <div className={styles.timeline}>{["Macro briefing","Portfolio report","Strategy & research","Vote / veto","Execution package"].map((x,i)=><div key={x} className={phase>i?styles.complete:phase===i+1?styles.active:""}><b>{i+1}</b><span>{tr(lang,x,["รายงาน Macro","รายงานพอร์ต","กลยุทธ์และงานวิจัย","ลงคะแนน / Veto","ชุดคำสั่งดำเนินการ"][i])}</span></div>)}</div>
  {error&&<div className={styles.error}>{error}</div>}
  {data&&<>
   <section className={styles.report}><div className={styles.reportTitle}><span>🌍</span><div><small>PHASE 1 · MACRO DESK</small><h3>{tr(lang,"Market regime and investment sentiment","สภาวะตลาดและ Sentiment การลงทุน")}</h3></div></div><div className={styles.metrics}><Metric label="Regime" value={data.regime}/><Metric label="Macro score" value={`${data.macroScore}/100`}/><Metric label="Sentiment" value={data.sentiment}/><Metric label={tr(lang,"Reserve","เงินสำรอง")} value={data.reserve==null?"—":`${data.reserve.toFixed(1)}%`}/></div><p>{data.regime.includes("RISK-OFF")?tr(lang,"Capital preservation leads. New risk requires exceptional evidence.","เน้นรักษาเงินทุน การเพิ่มความเสี่ยงต้องมีหลักฐานที่แข็งแรงเป็นพิเศษ"):tr(lang,"Selective deployment is permitted, while liquidity and valuation discipline remain in force.","อนุญาตให้ลงทุนแบบคัดเลือก โดยยังคุมสภาพคล่องและวินัยด้านมูลค่า")}</p></section>
   <section className={styles.report}><div className={styles.reportTitle}><span>📊</span><div><small>PHASE 2 · PORTFOLIO MANAGEMENT</small><h3>{tr(lang,"Holdings health and portfolio quality","สุขภาพ Holdings และคุณภาพพอร์ต")}</h3></div></div><div className={styles.metrics}><Metric label="NAV" value={usd(data.nav)}/><Metric label={tr(lang,"Holdings","จำนวน Holdings")} value={String(data.holdingsCount)}/><Metric label={tr(lang,"Health","สุขภาพพอร์ต")} value={`${data.health}/100`}/><Metric label={tr(lang,"Risk posture","ท่าทีความเสี่ยง")} value={data.risk}/></div><p>{tr(lang,"Portfolio management reviewed concentration, quality, liquidity, drawdown and the role of each holding before proposing changes.","ทีม Portfolio ตรวจการกระจุกตัว คุณภาพ สภาพคล่อง Drawdown และบทบาทของแต่ละสินทรัพย์ก่อนเสนอการปรับพอร์ต")}</p></section>
   <section className={styles.report}><div className={styles.reportTitle}><span>🔬</span><div><small>PHASE 3 · STRATEGY & RESEARCH</small><h3>{tr(lang,"Research proposals for committee debate","ข้อเสนอจากทีม Research เพื่อเข้าสู่การอภิปราย")}</h3></div></div>{data.proposals.length?<div className={styles.proposals}>{data.proposals.map((p:Proposal)=><article key={`${p.action}-${p.ticker}`}><div><strong>{p.ticker}</strong><span>{p.action}</span></div><p>{p.reason}</p><small>{p.amount?usd(p.amount):""}{p.weight!=null?` · ${p.weight.toFixed(1)}%`:""}{p.score!=null?` · ${p.score}/100`:""}</small></article>)}</div>:<div className={styles.empty}>{tr(lang,"Research found no proposal strong enough for a vote. The current portfolio remains the default.","ทีม Research ยังไม่พบข้อเสนอที่แข็งแรงพอเข้าสู่การลงคะแนน จึงคงพอร์ตเดิมเป็นค่าเริ่มต้น")}</div>}</section>
   <section className={styles.report}><div className={styles.reportTitle}><span>⚖️</span><div><small>PHASE 4 · COMMITTEE VOTE</small><h3>{tr(lang,"Desk opinions, votes and veto rights","ความเห็น การลงคะแนน และสิทธิ์ Veto")}</h3></div></div>{resolutions.length?<div className={styles.ballots}>{resolutions.map(r=><article key={r.proposal.ticker}><header><div><strong>{r.proposal.ticker}</strong><span>{r.proposal.action}</span></div><b className={r.approved?styles.approved:styles.rejected}>{r.vetoed?"VETOED":r.approved?"APPROVED":"REJECTED"}</b></header><div className={styles.votes}>{r.opinions.map(o=><div key={o.desk}><span>{o.desk}</span><b className={styles[o.vote.toLowerCase()]}>{o.vote}</b><small>{o.comment}</small></div>)}</div><footer>{r.yes} approve · {r.no} reject/veto · {tr(lang,"Human CIO authorization required","ต้องให้ CIO มนุษย์อนุมัติ")}</footer></article>)}</div>:<div className={styles.empty}>{tr(lang,"No securities reached the voting floor.","ไม่มีหลักทรัพย์ผ่านเกณฑ์เข้าสู่การลงคะแนน")}</div>}</section>
   <section className={styles.resolution}><div className={styles.reportTitle}><span>👔</span><div><small>PHASE 5 · CIO RESOLUTION</small><h3>{tr(lang,"Final decision and execution package","มติสุดท้ายและชุดคำสั่งปรับพอร์ต")}</h3></div></div><div className={styles.resolutionStats}><Metric label={tr(lang,"Approved","อนุมัติ")} value={String(approved.length)}/><Metric label={tr(lang,"Rejected / vetoed","ไม่อนุมัติ / Veto")} value={String(resolutions.length-approved.length)}/><Metric label={tr(lang,"Excess reserve","เงินสำรองส่วนเกิน")} value={usd(data.reserveGap)}/><Metric label={tr(lang,"Execution","การดำเนินการ")} value={tr(lang,"HUMAN APPROVAL","มนุษย์อนุมัติ")}/></div>{approved.length?<div className={styles.execution}>{approved.map(r=><article key={r.proposal.ticker}><b>{r.proposal.action}</b><strong>{r.proposal.ticker}</strong><span>{r.proposal.amount?usd(r.proposal.amount):tr(lang,"Size after review","กำหนดขนาดหลังตรวจทาน")}</span><p>{r.proposal.reason}</p></article>)}</div>:<div className={styles.hold}>{tr(lang,"CIO resolution: HOLD the current portfolio. Keep excess reserve available until a committee-approved opportunity appears.","มติ CIO: คงพอร์ตปัจจุบัน และรักษาเงินสำรองส่วนเกินไว้จนกว่าจะมีโอกาสที่ผ่านการอนุมัติจากคณะกรรมการ")}</div>}<button className={styles.execute} disabled={!approved.length}>{approved.length?tr(lang,"Review execution package","ตรวจและอนุมัติชุดคำสั่ง"):tr(lang,"No execution required","ไม่มีรายการต้องดำเนินการ")}</button><p className={styles.policy}>{tr(lang,"No trade executes automatically. This package must be reviewed and recorded by a human.","ระบบไม่ส่งคำสั่งซื้อขายอัตโนมัติ ชุดคำสั่งนี้ต้องได้รับการตรวจและบันทึกโดยมนุษย์")}</p></section>
   <details className={styles.minutes}><summary>{tr(lang,"View meeting minutes","ดูรายงานการประชุม")}</summary><div><p>Meeting ID: IC-{started?.slice(0,19)}</p><p>Started: {started?new Date(started).toLocaleString():"—"}</p><p>Completed: {finished?new Date(finished).toLocaleString():"—"}</p><p>Regime: {data.regime} · NAV: {usd(data.nav)} · Reserve: {data.reserve?.toFixed?.(1)??"—"}%</p><p>Proposals: {resolutions.length} · Approved: {approved.length} · Vetoed: {resolutions.filter(x=>x.vetoed).length}</p></div></details>
  </>}
 </section>
}
function Metric({label,value}:{label:string;value:string}){return <div><span>{label}</span><strong>{value}</strong></div>}
