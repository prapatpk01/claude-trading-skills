"use client";

import {useEffect,useMemo,useState} from "react";
import type {CSSProperties} from "react";
import type {AppLang} from "../page";
import styles from "./CommitteeMeetingV10.module.css";
import resolution from "./CommitteePortfolioResolution.module.css";

type VoteLabel="STRONG BUY"|"BUY"|"NEUTRAL"|"CAUTION"|"SELL"|"VETO"|"PENDING";
type Action="OPEN NEW"|"ADD EXISTING"|"TRIM"|"EXIT"|"HOLD"|"REJECT";
type Member={desk:string;name:string;role:string;avatarX:number};
type Proposal={ticker:string;action:Action;amount:number;weight:number|null;currentPrice:number|null;targetPrice:number|null;expectedReturn:number|null;conviction:number|null;reason:string;isNew:boolean;source:"CURRENT"|"CARRY FORWARD"};
type Ballot={proposal:Proposal;votes:{desk:string;vote:VoteLabel;reason:string}[];buyVotes:number;vetoed:boolean;approved:boolean};

const members:Member[]=[
 {desk:"CIO",name:"Alex Morgan",role:"Chief Investment Officer",avatarX:0},
 {desk:"MACRO",name:"Dr. Sarah Chen",role:"Global Macro Team",avatarX:16.6667},
 {desk:"RESEARCH",name:"Michael Johnson",role:"Equity Research",avatarX:33.3333},
 {desk:"RISK",name:"David Kim",role:"Chief Risk Officer",avatarX:50},
 {desk:"QUANT",name:"Dr. Emily Zhang",role:"Quantitative Research",avatarX:66.6667},
 {desk:"PORTFOLIO",name:"James Wilson",role:"Portfolio Construction",avatarX:83.3333},
 {desk:"TREASURY",name:"Lisa Park",role:"Liquidity & Treasury",avatarX:100},
];
const finite=(v:unknown)=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null};
const usd=(v:number|null)=>v==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(v);
const pct=(v:number|null)=>v==null?"—":`${v>=0?"+":""}${v.toFixed(1)}%`;
const text=(v:unknown,fallback:string)=>typeof v==="string"&&v.trim()?v:fallback;
const supportive=(v:VoteLabel)=>v==="STRONG BUY"||v==="BUY";
const voteClass=(v:VoteLabel)=>v.toLowerCase().replaceAll(" ","");
async function readJson(path:string){const r=await fetch(path,{cache:"no-store"});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j?.error??`${path} returned ${r.status}`);return j}
function normalizeAction(raw:string,isNew:boolean):Action{const a=raw.toUpperCase();if(a.includes("TRIM")||a.includes("REDUCE"))return"TRIM";if(a.includes("EXIT")||a.includes("SELL"))return"EXIT";if(a.includes("REJECT"))return"REJECT";if(a.includes("HOLD")||a.includes("WATCH"))return"HOLD";if(isNew||a.includes("OPEN")||a.includes("INITIATE"))return"OPEN NEW";return"ADD EXISTING"}
function votesFor(p:Proposal,ctx:any):Ballot{
 const macro=String(ctx?.macroAction??"").toUpperCase();const reserve=finite(ctx?.deployable)??0;const weight=p.weight??0;const positive=p.action==="OPEN NEW"||p.action==="ADD EXISTING";
 const macroVote:VoteLabel=macro.includes("DEFENSIVE")&&positive?"CAUTION":positive?"BUY":"NEUTRAL";
 const researchVote:VoteLabel=(p.conviction??0)>=85?"STRONG BUY":(p.conviction??0)>=70?"BUY":p.action==="HOLD"?"NEUTRAL":p.source==="CARRY FORWARD"?"BUY":"CAUTION";
 const riskVote:VoteLabel=weight>8?"VETO":weight>5?"CAUTION":p.action==="EXIT"?"SELL":"BUY";
 const quantVote:VoteLabel=(p.expectedReturn??0)>=15?"STRONG BUY":(p.expectedReturn??0)>=8?"BUY":p.action==="TRIM"||p.action==="EXIT"?"SELL":p.source==="CARRY FORWARD"?"BUY":"NEUTRAL";
 const portfolioVote:VoteLabel=p.action==="REJECT"?"SELL":p.action==="HOLD"?"NEUTRAL":"BUY";
 const treasuryVote:VoteLabel=positive&&reserve>0&&p.amount>reserve?"VETO":positive?"BUY":"NEUTRAL";
 const prelim=[macroVote,researchVote,riskVote,quantVote,portfolioVote,treasuryVote];
 const cioVote:VoteLabel=prelim.includes("VETO")?"VETO":prelim.filter(supportive).length>=4?"BUY":p.action==="TRIM"||p.action==="EXIT"?"SELL":"CAUTION";
 const votes=[
  {desk:"CIO",vote:cioVote,reason:cioVote==="VETO"?"CIO blocks the proposal until the veto condition is resolved.":"CIO reflects the committee majority and portfolio mandate."},
  {desk:"MACRO",vote:macroVote,reason:text(ctx?.macroReason,"Macro permits selective deployment with controlled sizing.")},
  {desk:"RESEARCH",vote:researchVote,reason:p.reason},
  {desk:"RISK",vote:riskVote,reason:riskVote==="VETO"?"Proposed weight exceeds the 8% risk limit.":"Position size remains inside policy."},
  {desk:"QUANT",vote:quantVote,reason:`Expected return ${pct(p.expectedReturn)} · conviction ${p.conviction??"—"}/100.`},
  {desk:"PORTFOLIO",vote:portfolioVote,reason:`Portfolio action: ${p.action}.`},
  {desk:"TREASURY",vote:treasuryVote,reason:positive?`Deployable liquidity ${usd(reserve)}.`:"This action supplies capital or requires no new cash."},
 ];
 const buyVotes=votes.filter(x=>supportive(x.vote)).length;const vetoed=votes.some(x=>x.vote==="VETO");const approved=!vetoed&&(p.action==="TRIM"||p.action==="EXIT"?votes.filter(x=>x.vote==="SELL"||supportive(x.vote)).length>=4:buyVotes>=4);return{proposal:p,votes,buyVotes,vetoed,approved};
}

export default function CommitteeMeetingV10({lang}:{lang:AppLang}){
 const[data,setData]=useState<any>(null);const[loading,setLoading]=useState(true);const[error,setError]=useState<string|null>(null);const[selected,setSelected]=useState<Record<string,boolean>>({});
 useEffect(()=>{let active=true;Promise.all([readJson("/api/v10/cio"),readJson("/api/portfolio/opportunity-allocation"),readJson("/api/portfolio/optimizer"),readJson("/api/portfolio"),readJson("/api/portfolio/cash-buffer"),readJson("/api/committee-memory?limit=1")]).then(([cio,allocation,optimizer,portfolio,buffer,memory])=>{if(active)setData({cio,allocation,optimizer,portfolio,buffer,memory})}).catch(e=>{if(active)setError(e.message)}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
 const proposals=useMemo<Proposal[]>(()=>{
  if(!data)return[];const held=new Set((Array.isArray(data.portfolio?.holdings)?data.portfolio.holdings:[]).filter((h:any)=>!h.closed_at).map((h:any)=>String(h.ticker??"").toUpperCase()));const out:Proposal[]=[];
  for(const x of Array.isArray(data.allocation?.allocations)?data.allocation.allocations:[]){const ticker=String(x?.ticker??"").toUpperCase();const amount=finite(x?.approvedCapitalUsd)??0;if(!ticker||amount<=0)continue;const isNew=!held.has(ticker);out.push({ticker,action:isNew?"OPEN NEW":"ADD EXISTING",amount,weight:finite(x?.proposedWeightPct),currentPrice:finite(x?.currentPrice),targetPrice:finite(x?.targetPrice),expectedReturn:finite(x?.expectedReturnPct),conviction:finite(x?.conviction),reason:text(x?.thesis,"Research candidate cleared the allocation bridge."),isNew,source:"CURRENT"})}
  for(const x of Array.isArray(data.optimizer?.proposals)?data.optimizer.proposals:[]){const ticker=String(x?.ticker??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY"||ticker==="OPPORTUNITY PIPELINE")continue;const action=normalizeAction(String(x?.action??"HOLD"),!held.has(ticker));if(action!=="TRIM"&&action!=="EXIT")continue;out.push({ticker,action,amount:finite(x?.capitalUsd)??0,weight:finite(x?.targetWeightPct),currentPrice:finite(x?.currentPrice),targetPrice:finite(x?.targetPrice),expectedReturn:finite(x?.expectedReturnPct),conviction:finite(x?.score),reason:text(x?.reason,"Portfolio risk-control recommendation."),isNew:false,source:"CURRENT"})}
  const latest=data.memory?.latest;const carryAllowed=latest&&!['CLOSED','CANCELLED','SUPERSEDED','EXECUTED_WITHIN_TOLERANCE'].includes(String(latest.status??''));
  if(carryAllowed){for(const x of Array.isArray(latest?.resolution)?latest.resolution:[]){const ticker=String(x?.ticker??"").toUpperCase();const action=normalizeAction(String(x?.action??"HOLD"),!held.has(ticker));if(!ticker||action==="HOLD"||action==="REJECT")continue;out.push({ticker,action,amount:finite(x?.amount??x?.plannedUsd??x?.amountUsd)??0,weight:finite(x?.weight??x?.targetWeightPct),currentPrice:finite(x?.currentPrice),targetPrice:finite(x?.targetPrice),expectedReturn:finite(x?.expectedReturn??x?.expectedReturnPct),conviction:finite(x?.conviction??x?.score),reason:text(x?.reason,"Carried forward from the previous unresolved committee resolution."),isNew:!held.has(ticker),source:"CARRY FORWARD"})}}
  return Array.from(new Map(out.map(p=>[`${p.action}:${p.ticker}`,p])).values());
 },[data]);
 const deployable=finite(data?.allocation?.portfolio?.deployableCapitalUsd??data?.buffer?.gapValue)??0;
 const context={macroAction:data?.cio?.decisions?.find((x:any)=>String(x?.desk).toUpperCase()==="MACRO")?.action,macroReason:data?.cio?.decisions?.find((x:any)=>String(x?.desk).toUpperCase()==="MACRO")?.reason,deployable};
 const ballots=useMemo(()=>proposals.map(p=>votesFor(p,context)),[proposals,data]);
 const groups=(["OPEN NEW","ADD EXISTING","TRIM","EXIT","REJECT"] as Action[]).map(action=>({action,items:ballots.filter(b=>b.proposal.action===action)}));
 const approved=ballots.filter(b=>b.approved);const positive=approved.filter(b=>b.proposal.action==="OPEN NEW"||b.proposal.action==="ADD EXISTING");const sales=approved.filter(b=>b.proposal.action==="TRIM"||b.proposal.action==="EXIT");
 const required=positive.reduce((s,b)=>s+b.proposal.amount,0);const proceeds=sales.reduce((s,b)=>s+b.proposal.amount,0);const reserveTicker=(Array.isArray(data?.portfolio?.holdings)?data.portfolio.holdings:[]).find((h:any)=>["SGOV","BIL","SHV"].includes(String(h?.ticker??"").toUpperCase()))?.ticker??"RESERVE";
 const committed=required>0;const fundingLabel=committed?`TRIM ${String(reserveTicker).toUpperCase()} ${usd(Math.min(deployable,required))}`:`${String(reserveTicker).toUpperCase()} EXCESS ${usd(deployable)} · NOT COMMITTED`;
 const balance=(proceeds+deployable)-required;const toggle=(key:string)=>setSelected(s=>({...s,[key]:!s[key]}));const approveAll=()=>setSelected(Object.fromEntries(approved.map(b=>[`${b.proposal.action}:${b.proposal.ticker}`,true])));
 return <section className={styles.room}>
  <header><div><span>AI COMMITTEE · UNIFIED MEETING STATE · v10.5</span><h2>{lang==="th"?"มติคณะกรรมการลงทุนทั้งพอร์ต":"PORTFOLIO DECISION SUMMARY"}</h2><p>{lang==="th"?"Proposal, Vote, Funding และ Minutes อ่านจากสถานะประชุมชุดเดียว":"Proposal, vote, funding and minutes share one meeting state."}</p></div><b>{loading?"CONVENING":`${approved.length} APPROVED`}</b></header>
  {error&&<div className={styles.error}>{error}</div>}
  <div className={styles.members}>{members.map(m=><article key={m.desk}><div className={styles.avatar} style={{backgroundPosition:`${m.avatarX}% center`} as CSSProperties}/><strong>{m.name}</strong><span>{m.desk}</span><small>{m.role}</small></article>)}</div>
  <section className={resolution.stats}>{groups.map(g=><div key={g.action}><span>{g.action}</span><strong>{g.items.length}</strong></div>)}<div><span>APPROVED</span><strong>{approved.length}</strong></div></section>
  <section className={resolution.panel}>
   <div className={resolution.head}><div><span>FUNDING PLAN</span><h3>{fundingLabel}</h3><p>{committed?`${usd(required)} allocated to ${positive.map(x=>x.proposal.ticker).join(", ")}. Funding balance ${usd(balance)}.`:`Excess liquidity is available, but no sell/trim ticket is authorized until at least one destination is approved.`}</p></div><button onClick={approveAll} disabled={!approved.length}>Approve All Approved Items</button></div>
   {groups.map(g=>g.items.length>0&&<div className={resolution.group} key={g.action}><h4>{g.action} <span>{g.items.length}</span></h4>{g.items.map(b=>{const key=`${b.proposal.action}:${b.proposal.ticker}`;return <article className={resolution.card} key={key}><div className={resolution.main}><div><strong>{b.proposal.ticker}</strong><span>{b.proposal.action} · {b.proposal.source}</span><p>{b.proposal.reason}</p></div><div className={resolution.amount}><b>{b.proposal.amount>0?usd(b.proposal.amount):b.proposal.weight!=null?`${b.proposal.weight.toFixed(1)}%`:"NO CASH"}</b><small>{b.proposal.currentPrice?`@ ${usd(b.proposal.currentPrice)}`:""}</small></div><div className={b.vetoed?resolution.vetoed:b.approved?resolution.approved:resolution.rejected}>{b.vetoed?"VETOED":b.approved?"APPROVED":"REVIEW"}</div></div><div className={resolution.votes}>{b.votes.map(v=><div key={v.desk}><span>{v.desk}</span><b className={resolution[voteClass(v.vote)]??""}>{v.vote}</b><small>{v.reason}</small></div>)}</div><div className={resolution.footer}><span>{b.buyVotes}/7 supportive votes</span>{b.approved&&<label><input type="checkbox" checked={Boolean(selected[key])} onChange={()=>toggle(key)}/> Human approve</label>}</div></article>})}</div>)}
   {!ballots.length&&<div className={resolution.empty}>No actionable portfolio proposal is ready. {fundingLabel}.</div>}
   <div className={resolution.group}><h4>MEETING MINUTES</h4><article className={resolution.card}><div className={resolution.main}><div><strong>{data?.memory?.latest?.meeting_code??`IC-${new Date().toISOString().slice(0,10)}`}</strong><span>{ballots.length} actionable proposals · {approved.length} approved</span><p>Funding: {fundingLabel}. Destinations: {positive.length?positive.map(x=>`${x.proposal.action} ${x.proposal.ticker} ${usd(x.proposal.amount)}`).join(" · "):"none authorized"}.</p></div><div className={balance<0?resolution.vetoed:resolution.approved}>{balance<0?"FUNDING GAP":"BALANCED"}</div></div></article></div>
  </section>
 </section>
}
