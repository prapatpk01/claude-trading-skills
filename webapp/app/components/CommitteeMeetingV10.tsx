"use client";

import {useEffect,useMemo,useState} from "react";
import type {CSSProperties} from "react";
import type {AppLang} from "../page";
import styles from "./CommitteeMeetingV10.module.css";

type VoteLabel="STRONG BUY"|"BUY"|"NEUTRAL"|"CAUTION"|"SELL"|"VETO"|"PENDING";
type Member={desk:string;name:string;role:string;avatarX:number};
type MemberVote=Member&{vote:VoteLabel;reason:string};
type Allocation={
 ticker?:string;
 approvedCapitalUsd?:number|string;
 proposedWeightPct?:number|string;
 currentPrice?:number|string;
 targetPrice?:number|string;
 expectedReturnPct?:number|string;
 conviction?:number|string;
 committee?:string;
 thesis?:string;
 confidence?:string;
};

const members:Member[]=[
 {desk:"CIO",name:"Alex Morgan",role:"Chief Investment Officer",avatarX:0},
 {desk:"MACRO",name:"Dr. Sarah Chen",role:"Global Macro Team",avatarX:16.6667},
 {desk:"RESEARCH",name:"Michael Johnson",role:"Equity Research",avatarX:33.3333},
 {desk:"RISK",name:"David Kim",role:"Chief Risk Officer",avatarX:50},
 {desk:"QUANT",name:"Dr. Emily Zhang",role:"Quantitative Research",avatarX:66.6667},
 {desk:"PORTFOLIO",name:"James Wilson",role:"Portfolio Construction",avatarX:83.3333},
 {desk:"TREASURY",name:"Lisa Park",role:"Liquidity & Treasury",avatarX:100},
];

const finite=(value:unknown):number|null=>{
 const parsed=typeof value==="number"?value:Number(value);
 return Number.isFinite(parsed)?parsed:null;
};
const usd=(value:number|null)=>value==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
const pct=(value:number|null)=>value==null?"—":`${value>=0?"+":""}${value.toFixed(1)}%`;
const isBuy=(vote:VoteLabel)=>vote==="STRONG BUY"||vote==="BUY";
const voteClass=(vote:VoteLabel)=>vote.toLowerCase().replaceAll(" ","").replaceAll("/","");
const text=(value:unknown,fallback:string)=>typeof value==="string"&&value.trim()?value:fallback;

async function readJson(path:string){
 const response=await fetch(path,{cache:"no-store"});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body?.error??`${path} returned HTTP ${response.status}`);
 return body;
}

export default function CommitteeMeetingV10({lang}:{lang:AppLang}){
 const[cio,setCio]=useState<any>(null);
 const[allocation,setAllocation]=useState<any>(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState<string|null>(null);

 useEffect(()=>{
  let active=true;
  setLoading(true);
  Promise.all([readJson("/api/v10/cio"),readJson("/api/portfolio/opportunity-allocation")])
   .then(([cioData,allocationData])=>{if(active){setCio(cioData);setAllocation(allocationData);setError(null)}})
   .catch((reason)=>{if(active)setError(reason instanceof Error?reason.message:"Committee data unavailable")})
   .finally(()=>{if(active)setLoading(false)});
  return()=>{active=false};
 },[]);

 const proposal=useMemo<Allocation|null>(()=>{
  const allocations=Array.isArray(allocation?.allocations)?allocation.allocations as Allocation[]:[];
  return allocations
   .filter(item=>(finite(item.approvedCapitalUsd)??0)>0)
   .sort((a,b)=>(finite(b.conviction)??0)-(finite(a.conviction)??0))[0]??null;
 },[allocation]);

 const proposalTicker=text(proposal?.ticker,"").toUpperCase();
 const proposalAmount=finite(proposal?.approvedCapitalUsd);
 const currentPrice=finite(proposal?.currentPrice);
 const targetPrice=finite(proposal?.targetPrice);
 const expectedReturn=finite(proposal?.expectedReturnPct);
 const proposedWeight=finite(proposal?.proposedWeightPct);
 const conviction=finite(proposal?.conviction);
 const deployable=finite(allocation?.portfolio?.deployableCapitalUsd)??0;
 const macroDecision=Array.isArray(cio?.decisions)?cio.decisions.find((item:any)=>String(item?.desk).toUpperCase()==="MACRO"):null;
 const portfolioDecision=Array.isArray(cio?.decisions)?cio.decisions.find((item:any)=>String(item?.desk).toUpperCase()==="PORTFOLIO"):null;
 const treasuryDecision=Array.isArray(cio?.decisions)?cio.decisions.find((item:any)=>String(item?.desk).toUpperCase()==="TREASURY"):null;

 const memberVotes=useMemo<MemberVote[]>(()=>{
  if(!proposal)return members.map(member=>({...member,vote:"PENDING",reason:"No committee-approved security is currently under review."}));
  const macroAction=String(macroDecision?.action??"").toUpperCase();
  const macroVote:VoteLabel=macroAction.includes("SELECTIVE RISK")?"BUY":macroAction.includes("DEFENSIVE")?"CAUTION":"NEUTRAL";
  const researchVote:VoteLabel=(conviction??0)>=85?"STRONG BUY":String(proposal.committee??"").toUpperCase()==="APPROVE"?"BUY":"CAUTION";
  const riskVote:VoteLabel=(proposedWeight??0)>8?"VETO":(proposedWeight??0)>5?"CAUTION":"BUY";
  const quantVote:VoteLabel=(expectedReturn??0)>=15?"STRONG BUY":(expectedReturn??0)>=8?"BUY":"NEUTRAL";
  const portfolioVote:VoteLabel=(proposalAmount??0)>0&&String(allocation?.status??"").includes("HUMAN_REVIEW")?"BUY":"NEUTRAL";
  const treasuryVote:VoteLabel=(proposalAmount??0)>deployable?"VETO":deployable>0?"BUY":"CAUTION";
  const preliminary=[macroVote,researchVote,riskVote,quantVote,portfolioVote,treasuryVote];
  const cioVote:VoteLabel=preliminary.includes("VETO")?"VETO":preliminary.filter(isBuy).length>=4?"BUY":preliminary.filter(isBuy).length>=3?"CAUTION":"NEUTRAL";
  return [
   {...members[0],vote:cioVote,reason:cioVote==="BUY"?"The proposal has sufficient cross-desk support for human approval.":"The CIO requires more evidence or a smaller position before approval."},
   {...members[1],vote:macroVote,reason:text(macroDecision?.reason,"Macro conditions allow only selective risk deployment.")},
   {...members[2],vote:researchVote,reason:text(proposal.thesis,`Research conviction is ${conviction??"unrated"}/100.`)},
   {...members[3],vote:riskVote,reason:riskVote==="VETO"?"The proposed weight exceeds the 8% new-position risk limit.":riskVote==="CAUTION"?"Approve only with reduced sizing and a final price check.":"The proposed position remains inside the risk budget."},
   {...members[4],vote:quantVote,reason:`Expected return is ${pct(expectedReturn)} with conviction ${conviction??"—"}/100.`},
   {...members[5],vote:portfolioVote,reason:text(portfolioDecision?.reason,"The candidate improves the opportunity set without replacing a core holding.")},
   {...members[6],vote:treasuryVote,reason:text(treasuryDecision?.reason,`Verified deployable reserve is ${usd(deployable)}.`)},
  ];
 },[allocation,conviction,deployable,expectedReturn,macroDecision,portfolioDecision,proposal,proposalAmount,proposedWeight,treasuryDecision]);

 const counts=useMemo(()=>memberVotes.reduce<Record<VoteLabel,number>>((acc,item)=>{acc[item.vote]=(acc[item.vote]??0)+1;return acc},{"STRONG BUY":0,"BUY":0,"NEUTRAL":0,"CAUTION":0,"SELL":0,"VETO":0,"PENDING":0}),[memberVotes]);
 const buyVotes=counts["STRONG BUY"]+counts.BUY;
 const vetoed=counts.VETO>0;
 const approved=Boolean(proposal)&&!vetoed&&buyVotes>=4;
 const consensus=!proposal?"NO ACTIVE PROPOSAL":vetoed?"VETOED":approved?"APPROVED TO BUY":"HOLD / REVIEW";
 const riskDissent=memberVotes.find(member=>member.desk==="RISK");

 return <section className={styles.room}>
  <header><div><span>AI COMMITTEE · IC-MEETING-v10.3</span><h2>{lang==="th"?"การประชุมคณะกรรมการลงทุน AI":"AI INVESTMENT COMMITTEE MEETING"}</h2><p>{lang==="th"?"พิจารณาหลักทรัพย์เดียวกัน ลงคะแนนพร้อมเหตุผล และส่งต่อให้มนุษย์อนุมัติ":"Every desk votes on the same named security, with reasons and final human authorization."}</p></div><b>{loading?"CONVENING":proposal?"IN PROGRESS":"NO PROPOSAL"}</b></header>
  {error&&<div className={styles.error}>{error}</div>}
  <div className={styles.members}>{memberVotes.map(member=><article key={member.desk} title={member.reason}><div className={styles.avatar} style={{backgroundPosition:`${member.avatarX}% center`} as CSSProperties} role="img" aria-label={`${member.name} portrait`}/><strong>{member.name}</strong><span>{member.desk}</span><small>{member.role}</small><em className={styles[voteClass(member.vote)]??""}>{member.vote}</em></article>)}</div>
  <div className={styles.voteTopic}>
   <span>{lang==="th"?"หัวข้อที่ลงคะแนน":"VOTE TOPIC"}</span>
   <strong>{proposal?`BUY ${proposalTicker}`:"NO ACTIVE BUY PROPOSAL"}</strong>
   <p>{proposal?`${lang==="th"?"เปิดสถานะใหม่":"OPEN NEW POSITION"} · ${usd(proposalAmount)}${proposedWeight!=null?` · ${proposedWeight.toFixed(2)}% target weight`:""}`:lang==="th"?"ยังไม่มีหลักทรัพย์ผ่านเกณฑ์จัดสรรเงินทุน":"No security has cleared the allocation bridge."}</p>
   {proposal&&<small>{`Current ${usd(currentPrice)} · Target ${usd(targetPrice)} · Expected return ${pct(expectedReturn)}`}</small>}
  </div>
  <div className={styles.body}>
   <div className={styles.proposal}><h3>PROPOSAL UNDER REVIEW</h3><strong>{proposal?`${proposalTicker} · ${usd(proposalAmount)}`:text(cio?.posture,"HOLD / VERIFY")}</strong><p>{proposal?text(proposal.thesis,"Committee-approved research candidate awaiting human authorization."):text(cio?.blockers?.[0],"No capital-deployment proposal is ready for a vote.")}</p><dl><div><dt>Readiness</dt><dd>{cio?.readinessPct??"—"}%</dd></div><div><dt>Execution</dt><dd>HUMAN ONLY</dd></div><div><dt>Evidence</dt><dd>{proposal?.committee==="APPROVE"?"PASSED":"REQUIRED"}</dd></div></dl></div>
   <div className={styles.discussion}><h3>COMMITTEE DISCUSSION</h3>{memberVotes.map(member=><div key={member.desk}><span>{member.desk}</span><p><b>{member.vote}</b> · {member.reason}</p></div>)}</div>
   <div className={styles.summary}><h3>DECISION SUMMARY</h3><div className={styles.summarySubject}><span>VOTING ON</span><strong>{proposal?`BUY ${proposalTicker}`:"—"}</strong><small>{proposal?usd(proposalAmount):"No active proposal"}</small></div><div className={styles.voteRing}><strong>{proposalTicker||"—"}</strong><span>{memberVotes.length} TOTAL VOTES</span></div><ul>{(["STRONG BUY","BUY","NEUTRAL","CAUTION","SELL","VETO"] as VoteLabel[]).map(label=><li key={label}><b>{label}</b><span>{counts[label]}</span></li>)}</ul><div className={styles.consensus}><span>CONSENSUS</span><strong className={approved?styles.approved:vetoed?styles.vetoed:""}>{consensus}</strong><small>{proposal?`${buyVotes}/7 supportive votes · Human authorization required`:"Research must submit a named security before voting."}</small></div></div>
  </div>
  <footer><strong>DISSENT LOG</strong><span>{riskDissent?.reason??"No risk opinion available."}</span></footer>
 </section>
}
