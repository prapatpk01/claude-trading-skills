"use client";

import {useMemo,useState} from "react";
import type {AppLang} from "../page";
import styles from "./InvestmentCommitteeCycle.module.css";

type Vote="APPROVE"|"CAUTION"|"REJECT"|"VETO";
type Proposal={ticker:string;action:string;amount:number;weight:number|null;reason:string;score:number|null;isNew:boolean;currentPrice:number|null;targetPrice:number|null;fundingSource?:string};
type HoldingReport={ticker:string;weight:number|null;fairValue:number|null;score:number|null;status:"HOLD"|"REVIEW"|"MONITOR"|"FUNDING SOURCE";reason:string};
type Opinion={desk:string;vote:Vote;comment:string};
type Resolution={proposal:Proposal;opinions:Opinion[];approved:boolean;vetoed:boolean;yes:number;no:number};
type TicketStatus="PENDING_HUMAN"|"RECORDING"|"RECORDED"|"FAILED"|"MANUAL_REQUIRED";
type Ticket={id:string;proposal:Proposal;status:TicketStatus;message?:string};

const tr=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
const num=(v:unknown)=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null};
const text=(...v:unknown[])=>v.find(x=>typeof x==="string"&&x.trim()) as string|undefined;
const usd=(v:number|null)=>v==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v);
async function get(path:string){const r=await fetch(path,{cache:"no-store"});let body:any={};try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body}}
async function post(path:string,body:any){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),cache:"no-store"});let data:any={};try{data=await r.json()}catch{}return{ok:r.ok,status:r.status,body:data}}

function holdingValue(h:any){return num(h?.market_value??h?.marketValue??h?.current_value??h?.currentValue)??((num(h?.shares)??0)*(num(h?.current_price??h?.currentPrice??h?.price??h?.avg_cost)??0));}
function calculateHealth(holdings:any[],nav:number,reserve:number,target:number){
 const values=holdings.map(holdingValue);const total=nav>0?nav:values.reduce((a,b)=>a+b,0);const weights=values.map(v=>total>0?v/total*100:0);const maxWeight=Math.max(0,...weights);
 const diversification=Math.min(100,Math.round(holdings.length*5.5));
 const concentration=Math.max(20,Math.min(100,Math.round(100-Math.max(0,maxWeight-10)*4)));
 const liquidity=Math.max(35,Math.min(100,Math.round(100-Math.abs(reserve-target)*5)));
 const covered=holdings.filter(h=>(num(h?.current_price??h?.currentPrice??h?.price)!=null)&&(num(h?.avg_cost??h?.avgCost)!=null)).length;
 const dataQuality=holdings.length?Math.max(45,Math.round(covered/holdings.length*100)):50;
 const breadth=Math.min(95,60+holdings.filter(h=>holdingValue(h)>0).length*2);
 return Math.round(diversification*.22+concentration*.24+liquidity*.18+dataQuality*.18+breadth*.18);
}

function opinionsFor(p:Proposal,ctx:any):Opinion[]{
 const regime=String(ctx.regime??"NEUTRAL").toUpperCase();const reserve=num(ctx.reserve)??0;const score=p.score??60;const proposedPct=p.weight??(ctx.nav>0?p.amount/ctx.nav*100:0);
 return [
  {desk:"Macro",vote:regime.includes("RISK-OFF")?"CAUTION":"APPROVE",comment:regime.includes("RISK-OFF")?"Reduce size in a defensive regime.":"Selective deployment is permitted."},
  {desk:"Portfolio",vote:"APPROVE",comment:p.isNew?"The candidate fits the opportunity budget without overriding the holdings report.":"The rebalance action fits portfolio construction policy."},
  {desk:"Research",vote:score>=80?"APPROVE":score>=65?"CAUTION":"REJECT",comment:score>=80?"Evidence and conviction are strong.":"Evidence requires monitoring."},
  {desk:"Valuation",vote:p.currentPrice&&p.targetPrice&&p.targetPrice>p.currentPrice?"APPROVE":"CAUTION",comment:p.targetPrice?`Target ${usd(p.targetPrice)} versus current ${usd(p.currentPrice)}.`:"Valuation anchor requires a final price check."},
  {desk:"Risk",vote:proposedPct>8?"VETO":proposedPct>5?"CAUTION":"APPROVE",comment:proposedPct>8?"VETO: position exceeds the 8% risk budget.":"Position size is within policy."},
  {desk:"Treasury",vote:reserve<8&&p.amount>0?"VETO":reserve<12?"CAUTION":"APPROVE",comment:reserve<8?"VETO: reserve floor would be breached.":`Funding source: ${p.fundingSource??"approved liquidity sleeve"}.`},
  {desk:"Compliance",vote:"APPROVE",comment:"Human authorization and an audit record are mandatory."},
 ];
}

export default function InvestmentCommitteeCycle({lang,onExecuted}:{lang:AppLang;onExecuted?:()=>void}){
 const[running,setRunning]=useState(false);const[phase,setPhase]=useState(0);const[data,setData]=useState<any>(null);const[error,setError]=useState<string|null>(null);const[tickets,setTickets]=useState<Ticket[]>([]);const[started,setStarted]=useState<string|null>(null);const[finished,setFinished]=useState<string|null>(null);
 const resolutions=useMemo<Resolution[]>(()=>!data?[]:data.proposals.map((p:Proposal)=>{const opinions=opinionsFor(p,data);const vetoed=opinions.some(x=>x.vote==="VETO");const yes=opinions.filter(x=>x.vote==="APPROVE").length;const no=opinions.filter(x=>x.vote==="REJECT"||x.vote==="VETO").length;return{proposal:p,opinions,vetoed,yes,no,approved:!vetoed&&yes>=4&&no<=1}}),[data]);
 const approved=resolutions.filter(r=>r.approved);

 async function convene(){setRunning(true);setError(null);setData(null);setTickets([]);setStarted(new Date().toISOString());setFinished(null);setPhase(1);
  try{
   const macro=await get("/api/macro/intelligence");setPhase(2);
   const portfolio=await get("/api/portfolio");const analytics=await get("/api/portfolio/analytics");const holdingsIntel=await post("/api/team",{mode:"valuation"});setPhase(3);
   const optimizer=await get("/api/portfolio/optimizer");const opportunities=await get("/api/portfolio/opportunity-allocation");setPhase(4);
   const liquidity=await get("/api/portfolio/cash-buffer");
   const holdings=Array.isArray(portfolio.body?.holdings)?portfolio.body.holdings.filter((h:any)=>!h.closed_at):[];const held=new Set(holdings.map((h:any)=>String(h.ticker??"").toUpperCase()));
   const nav=num(liquidity.body?.totalNav??optimizer.body?.portfolio?.nav)??holdings.reduce((a:number,h:any)=>a+holdingValue(h),0);const reserve=num(liquidity.body?.bufferPct??optimizer.body?.portfolio?.bufferPct)??0;const reserveTarget=num(liquidity.body?.targetPct)??15;const reserveGap=Math.max(0,Math.abs(num(liquidity.body?.gapValue)??0));
   const reserveTicker=held.has("SGOV")?"SGOV":held.has("BIL")?"BIL":held.has("SHV")?"SHV":null;const fundingSource=reserveGap>0?(reserveTicker?`TRIM ${reserveTicker} ${usd(reserveGap)}`:`CASH RESERVE EXCESS ${usd(reserveGap)}`):"NO EXCESS LIQUIDITY";

   const rawPlans=Array.isArray(holdingsIntel.body?.plans)?holdingsIntel.body.plans:[];
   const holdingsReport:HoldingReport[]=rawPlans.map((p:any)=>{const ticker=String(p?.ticker??"").toUpperCase();const original=String(p?.action??"HOLD").toUpperCase();let status:HoldingReport["status"]="HOLD";if(ticker===reserveTicker&&reserveGap>0)status="FUNDING SOURCE";else if(["ADD","TRIM","EXIT","EXIT REVIEW"].includes(original))status="REVIEW";else if(original.includes("WATCH")||original.includes("MONITOR"))status="MONITOR";return{ticker,weight:num(p?.weightPct),fairValue:num(p?.fairValue),score:num(p?.score),status,reason:status==="FUNDING SOURCE"?`${ticker} is the approved liquidity sleeve available to fund committee-authorized trades.`:text(p?.valuationNote,p?.reasons?.[0])??"Portfolio team monitoring; no trade authority outside committee resolution."}}).filter((p:HoldingReport)=>p.ticker);

   const proposals:Proposal[]=[];
   for(const p of Array.isArray(optimizer.body?.proposals)?optimizer.body.proposals:[]){const ticker=String(p?.ticker??"").toUpperCase();const action=String(p?.action??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY"||ticker==="OPPORTUNITY PIPELINE"||action==="HOLD"||action.includes("WATCH")||action==="ADD")continue;if(!action.includes("TRIM")&&!action.includes("EXIT"))continue;proposals.push({ticker,action,amount:num(p?.capitalUsd)??0,weight:num(p?.targetWeightPct),reason:text(p?.reason)??"Portfolio risk-control proposal.",score:num(p?.score),isNew:false,currentPrice:num(p?.currentPrice),targetPrice:num(p?.targetPrice),fundingSource:`PROCEEDS FROM ${action} ${ticker}`})}
   for(const p of Array.isArray(opportunities.body?.allocations)?opportunities.body.allocations:[]){const ticker=String(p?.ticker??"").toUpperCase();const amount=num(p?.approvedCapitalUsd)??0;if(!ticker||amount<=0)continue;proposals.push({ticker,action:held.has(ticker)?"ADD EXISTING":"OPEN NEW",amount,weight:num(p?.proposedWeightPct),reason:text(p?.thesis,p?.reason)??"Research candidate cleared the evidence gates.",score:num(p?.conviction),isNew:!held.has(ticker),currentPrice:num(p?.currentPrice),targetPrice:num(p?.targetPrice),fundingSource})}
   const unique=Array.from(new Map(proposals.map(p=>[`${p.action}:${p.ticker}`,p])).values());const apiHealth=num(analytics.body?.healthScore??analytics.body?.portfolioHealthScore);const health=apiHealth&&apiHealth>0?Math.round(apiHealth):calculateHealth(holdings,nav,reserve,reserveTarget);
   setData({regime:text(liquidity.body?.regime?.classification,macro.body?.regime?.classification,macro.body?.classification)??"NEUTRAL",macroScore:num(macro.body?.regime?.score??macro.body?.score)??50,sentiment:text(macro.body?.sentiment?.label,macro.body?.outlook?.stance)??"Mixed",nav,reserve,reserveTarget,reserveGap,fundingSource,holdingsCount:holdings.length,health,risk:text(analytics.body?.riskLabel)??"MONITOR",holdingsReport,proposals:unique});setPhase(5);setFinished(new Date().toISOString());
  }catch(e:any){setError(e?.message??"Meeting failed")}finally{setRunning(false)}
 }

 function createTickets(){setTickets(approved.map((r,i)=>({id:`${Date.now()}-${i}`,proposal:r.proposal,status:r.proposal.action.includes("TRIM")||r.proposal.action.includes("EXIT")?"MANUAL_REQUIRED":"PENDING_HUMAN"})))}
 async function approveTicket(id:string){const ticket=tickets.find(t=>t.id===id);if(!ticket||ticket.status!=="PENDING_HUMAN")return;const p=ticket.proposal;if(!p.currentPrice||p.currentPrice<=0){setTickets(x=>x.map(t=>t.id===id?{...t,status:"FAILED",message:"Live price unavailable; manual ticket required."}:t));return}const shares=p.amount/p.currentPrice;if(!Number.isFinite(shares)||shares<=0)return;setTickets(x=>x.map(t=>t.id===id?{...t,status:"RECORDING"}:t));try{const r=await fetch("/api/portfolio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"buy",ticker:p.ticker,shares:shares.toFixed(7),avg_cost:p.currentPrice.toFixed(4),target_price:p.targetPrice?.toFixed(4)??"",thesis:`IC approved: ${p.reason}. Funding: ${p.fundingSource??"approved liquidity"}`,opened_at:new Date().toISOString().slice(0,10),transaction_date:new Date().toISOString().slice(0,10),source:"investment_committee_v10_4"})});const j=await r.json();if(!r.ok)throw new Error(j?.error??"Could not record transaction");setTickets(x=>x.map(t=>t.id===id?{...t,status:"RECORDED",message:`${shares.toFixed(4)} shares recorded at ${usd(p.currentPrice)}.`}:t));onExecuted?.();window.dispatchEvent(new Event("sentinel:portfolio-updated"));}catch(e:any){setTickets(x=>x.map(t=>t.id===id?{...t,status:"FAILED",message:e?.message??"Recording failed"}:t))}}

 return <section className={styles.shell} data-meeting-state={phase}>
  <header className={styles.hero}><div><span>IC-MEETING · SENTINEL v10.4</span><h2>{tr(lang,"Investment Committee — Single Source of Truth","การประชุมคณะกรรมการลงทุน — ข้อมูลมติชุดเดียว")}</h2><p>{tr(lang,"Macro → Portfolio health → Holdings report → Research candidates → Vote/Veto → Human-approved execution.","Macro → สุขภาพพอร์ต → รายงาน Holdings → ผู้สมัครจาก Research → Vote/Veto → มนุษย์อนุมัติ")}</p></div><button onClick={convene} disabled={running}>{running?tr(lang,"Meeting in progress…","กำลังประชุม…"):tr(lang,"Convene committee","เริ่มประชุมคณะกรรมการ")}</button></header>
  <div className={styles.timeline}>{["Macro","Portfolio + holdings","Research","Vote / veto","Execution"].map((x,i)=><div key={x} className={phase>i?styles.complete:phase===i+1?styles.active:""}><b>{i+1}</b><span>{x}</span></div>)}</div>{error&&<div className={styles.error}>{error}</div>}
  {data&&<>
   <section className={styles.report}><h3>🌍 {tr(lang,"Macro briefing","รายงาน Macro")}</h3><div className={styles.metrics}><Metric label="Regime" value={data.regime}/><Metric label="Score" value={`${data.macroScore}/100`}/><Metric label="Sentiment" value={data.sentiment}/><Metric label={tr(lang,"Reserve","เงินสำรอง")} value={`${data.reserve.toFixed(1)}%`}/></div></section>
   <section className={styles.report}><h3>📊 {tr(lang,"Portfolio health report","รายงานสุขภาพพอร์ต")}</h3><div className={styles.metrics}><Metric label="NAV" value={usd(data.nav)}/><Metric label="Holdings" value={String(data.holdingsCount)}/><Metric label="Health" value={`${data.health}/100`}/><Metric label="Risk" value={data.risk}/></div><p className={styles.empty}>{tr(lang,"Health is calculated from diversification, concentration, liquidity and data coverage when the analytics API has no valid score.","เมื่อ Analytics API ไม่มีคะแนนที่ใช้งานได้ Health จะคำนวณจากการกระจายตัว ความกระจุกตัว สภาพคล่อง และความครบถ้วนของข้อมูล")}</p></section>
   <section className={styles.report}><h3>🧾 {tr(lang,"Portfolio team — Holdings intelligence report","ทีม Portfolio — รายงาน Holdings Intelligence")}</h3><p className={styles.empty}>{tr(lang,"This report has no authority to place trades. ADD/SELL labels are removed; only HOLD, REVIEW, MONITOR and FUNDING SOURCE are shown.","รายงานนี้ไม่มีอำนาจสั่งซื้อขาย ตัดป้าย ADD/SELL ออก เหลือเพียง HOLD, REVIEW, MONITOR และ FUNDING SOURCE")}</p>{data.holdingsReport.length?<div className={styles.proposals}>{data.holdingsReport.map((h:HoldingReport)=><article key={h.ticker}><header><strong>{h.ticker}</strong><span>{h.status}</span></header><p>{h.reason}</p><small>{h.weight!=null?`${h.weight.toFixed(1)}%`:"—"}{h.fairValue!=null?` · Fair ${usd(h.fairValue)}`:""}{h.score!=null?` · ${h.score}/100`:""}</small></article>)}</div>:<p className={styles.empty}>{tr(lang,"Holdings report unavailable.","ไม่มีข้อมูลรายงาน Holdings")}</p>}</section>
   <section className={styles.report}><h3>🔬 {tr(lang,"Research candidates and actionable proposals","ผู้สมัครจาก Research และข้อเสนอที่พร้อมพิจารณา")}</h3>{data.proposals.length?<div className={styles.proposals}>{data.proposals.map((p:Proposal)=><article key={`${p.action}-${p.ticker}`}><header><strong>{p.ticker}</strong><span>{p.action}</span></header><p>{p.reason}</p><small>{usd(p.amount)} · {p.currentPrice?`Price ${usd(p.currentPrice)}`:"Price check required"}{p.score!=null?` · ${p.score}/100`:""}<br/>{tr(lang,"Funding","แหล่งเงิน")}: {p.fundingSource??data.fundingSource}</small></article>)}</div>:<p className={styles.empty}>{tr(lang,"No proposal cleared the research floor.","ไม่มีข้อเสนอผ่านเกณฑ์ Research")}</p>}</section>
   <section className={styles.report}><h3>⚖️ {tr(lang,"Committee vote and veto","มติ Vote และ Veto")}</h3>{resolutions.map(r=><article className={styles.ballot} key={`${r.proposal.action}-${r.proposal.ticker}`}><header><strong>{r.proposal.ticker} · {r.proposal.action}</strong><b className={r.approved?styles.approved:styles.rejected}>{r.vetoed?"VETOED":r.approved?"APPROVED":"REJECTED"}</b></header><div className={styles.votes}>{r.opinions.map(o=><div key={o.desk}><span>{o.desk}</span><b>{o.vote}</b><small>{o.comment}</small></div>)}</div></article>)}</section>
   <section className={styles.execution}><h3>🧾 {tr(lang,"CIO resolution and execution queue","มติ CIO และคิวดำเนินการ")}</h3><div className={styles.metrics}><Metric label={tr(lang,"Approved","อนุมัติ")} value={String(approved.length)}/><Metric label={tr(lang,"Deployable excess","เงินส่วนเกิน")} value={usd(data.reserveGap)}/><Metric label={tr(lang,"Funding source","แหล่งเงิน")} value={data.fundingSource}/><Metric label={tr(lang,"Execution","การดำเนินการ")} value="HUMAN ONLY"/></div>{approved.length>0&&tickets.length===0&&<button className={styles.createTickets} onClick={createTickets}>{tr(lang,"Create trade tickets","สร้าง Trade Tickets จากมติ")}</button>}{tickets.map(t=><article className={styles.ticket} key={t.id}><div><strong>{t.proposal.ticker}</strong><span>{t.proposal.action}</span></div><p>{usd(t.proposal.amount)} · {t.proposal.currentPrice?`${(t.proposal.amount/t.proposal.currentPrice).toFixed(4)} shares @ ${usd(t.proposal.currentPrice)}`:tr(lang,"Final price required","ต้องตรวจราคาสุดท้าย")}</p><small>{t.message??`${t.status} · Funding: ${t.proposal.fundingSource??data.fundingSource}`}</small>{t.status==="PENDING_HUMAN"&&<button onClick={()=>approveTicket(t.id)}>{tr(lang,"Approve & record transaction","อนุมัติและบันทึกธุรกรรม")}</button>}</article>)}</section>
   <details className={styles.minutes}><summary>{tr(lang,"Meeting minutes","รายงานการประชุม")}</summary><p>Meeting: {started??"—"}</p><p>Closed: {finished??"—"}</p><p>Funding: {data.fundingSource}</p><p>Proposals: {resolutions.length} · Approved: {approved.length} · Recorded: {tickets.filter(t=>t.status==="RECORDED").length}</p></details>
  </>}
 </section>
}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>}
