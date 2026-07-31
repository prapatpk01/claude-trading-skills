import { runScan, DEFAULT_UNIVERSE } from "./scan";
import { runDividendScan } from "./dividendScan";
import { runThematicPortfolio } from "./thematicPortfolio";
import { buildAnalysis } from "./analyze";

export type FundAction = "INITIATE"|"ADD"|"HOLD"|"TRIM REVIEW"|"REPLACE"|"EXIT REVIEW"|"WATCH";
export interface ActiveFundIdea {
  ticker:string; source:string[]; held:boolean; action:FundAction;
  conviction:number; confidence:string; expectedReturnPct:number|null;
  targetPrice:number|null; currentPrice:number|null; momentum:number|null;
  targetWeightPct:number; capitalUsd:number; committee:string;
  thesis:string; dissent:string[]; reasons:string[];
}
export interface ActiveFundResult {
  asOf:string; nav:number; discovery:{momentum:number;dividend:number;thematic:number;uniqueNew:number};
  newIdeas:ActiveFundIdea[]; existing:ActiveFundIdea[]; replacements:{from:string;to:string;reason:string;rotatePct:number;rotateUsd:number}[];
  capitalPlan:{deployUsd:number;raiseUsd:number;cashAfterUsd:number;initiates:number;adds:number;holds:number;reviews:number};
  process:string[]; warnings:string[];
}

const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const num=(x:any):number|null=>typeof x==="number"&&Number.isFinite(x)?x:null;

async function analyzeSafe(ticker:string){try{return await buildAnalysis(ticker)}catch{return null}}
function sizeIdea(a:any,held:boolean,nav:number):ActiveFundIdea{
  const c=a.committee;
  const exp=num(a.expectedReturnPct), conv=num(c?.conviction)??0, mult=num(c?.sizeMultiplier)??0;
  let action:FundAction="WATCH";
  if(held){ if(c?.decision==="REJECT") action="EXIT REVIEW"; else if(c?.decision==="APPROVE"&&exp!=null&&exp>=15) action="ADD"; else if(exp!=null&&exp<0) action="TRIM REVIEW"; else action="HOLD"; }
  else { if(c?.decision==="APPROVE"&&exp!=null&&exp>=8) action="INITIATE"; else action="WATCH"; }
  const targetWeight=action==="INITIATE"||action==="ADD"?clamp((conv/100)*8*mult,1.5,8):0;
  return {ticker:a.ticker,source:[],held,action,conviction:conv,confidence:c?.confidence??"LOW",expectedReturnPct:exp,targetPrice:num(a.targetPrice),currentPrice:num(a.data?.quote?.price),momentum:num(a.momentum?.total),targetWeightPct:Math.round(targetWeight*10)/10,capitalUsd:Math.round(nav*targetWeight/100),committee:c?.decision??"WATCH",thesis:a.thesis?.find((x:any)=>x.label==="Base")?.narrative??"No base thesis available.",dissent:c?.dissent??[],reasons:c?.reasons??[]};
}

export async function runActiveFund(existingTickers:string[],nav:number):Promise<ActiveFundResult>{
  const held=new Set(existingTickers.map(x=>x.toUpperCase())),warnings:string[]=[];
  const [mom,div,theme]=await Promise.all([
    runScan(DEFAULT_UNIVERSE,5).catch(e=>{warnings.push(`Momentum discovery: ${e?.message??"failed"}`);return null}),
    runDividendScan(DEFAULT_UNIVERSE,5).catch(e=>{warnings.push(`Dividend discovery: ${e?.message??"failed"}`);return null}),
    runThematicPortfolio(8,"monthly").catch(e=>{warnings.push(`Thematic discovery: ${e?.message??"failed"}`);return null}),
  ]);
  const sourceMap=new Map<string,Set<string>>(); const add=(ticker:string|undefined,source:string)=>{if(!ticker)return;const t=ticker.toUpperCase();if(held.has(t))return;if(!sourceMap.has(t))sourceMap.set(t,new Set());sourceMap.get(t)!.add(source)};
  (mom?.setups??[]).forEach((x:any)=>add(x.ticker,"Momentum"));
  (div?.picks??[]).forEach((x:any)=>add(x.ticker,"Dividend Quality"));
  (theme?.holdings??[]).forEach((x:any)=>add(x.ticker,`Thematic · ${x.theme??x.proxy??"Leadership"}`));
  const ranked=[...sourceMap.entries()].sort((a,b)=>b[1].size-a[1].size).slice(0,10);
  const newAnalyses=await Promise.all(ranked.map(([t])=>analyzeSafe(t)));
  const currentAnalyses=await Promise.all(existingTickers.slice(0,12).map(t=>analyzeSafe(t)));
  const newIdeas=newAnalyses.filter(Boolean).map((a:any,i)=>{const x=sizeIdea(a,false,nav);x.source=[...(ranked[i]?.[1]??[])];return x}).sort((a,b)=>(b.conviction+(b.expectedReturnPct??0))-(a.conviction+(a.expectedReturnPct??0)));
  const existing=currentAnalyses.filter(Boolean).map((a:any)=>sizeIdea(a,true,nav)).sort((a,b)=>(b.conviction+(b.expectedReturnPct??0))-(a.conviction+(a.expectedReturnPct??0)));
  const approvedNew=newIdeas.filter(x=>x.action==="INITIATE"); const weakest=[...existing].sort((a,b)=>(a.conviction+(a.expectedReturnPct??0))-(b.conviction+(b.expectedReturnPct??0)));
  const replacements=[] as ActiveFundResult["replacements"];
  for(const cand of approvedNew){const old=weakest.find(x=>!replacements.some(r=>r.from===x.ticker)&&((cand.conviction-x.conviction)>=10)&&((cand.expectedReturnPct??-99)-(x.expectedReturnPct??-99)>=8));if(!old)continue;const pct=clamp(cand.targetWeightPct,1.5,Math.min(6,cand.targetWeightPct));replacements.push({from:old.ticker,to:cand.ticker,reason:`${cand.ticker} has higher committee conviction (${cand.conviction} vs ${old.conviction}) and expected return (${cand.expectedReturnPct?.toFixed(1)??"—"}% vs ${old.expectedReturnPct?.toFixed(1)??"—"}%).`,rotatePct:Math.round(pct*10)/10,rotateUsd:Math.round(nav*pct/100)});}
  const deployUsd=approvedNew.reduce((s,x)=>s+x.capitalUsd,0)+existing.filter(x=>x.action==="ADD").reduce((s,x)=>s+x.capitalUsd,0);
  const raiseUsd=replacements.reduce((s,x)=>s+x.rotateUsd,0);
  return {asOf:new Date().toISOString(),nav,discovery:{momentum:mom?.setups?.length??0,dividend:div?.picks?.length??0,thematic:theme?.holdings?.length??0,uniqueNew:sourceMap.size},newIdeas,existing,replacements,capitalPlan:{deployUsd,raiseUsd,cashAfterUsd:Math.max(0,raiseUsd-deployUsd),initiates:approvedNew.length,adds:existing.filter(x=>x.action==="ADD").length,holds:existing.filter(x=>x.action==="HOLD").length,reviews:existing.filter(x=>x.action==="TRIM REVIEW"||x.action==="EXIT REVIEW").length},process:["Macro/regime sets risk appetite and cash discipline.","Opportunity Discovery scans momentum, dividend-quality and thematic leadership outside the current book.","Research underwrites fundamentals, competition, thesis, catalysts, risks, five-year model and valuation.","Specialist desks score independently; Risk may veto; CIO committee returns APPROVE/WATCH/REJECT.","Portfolio Construction compares every approved idea with existing holdings using replacement alpha, then proposes capital weights."],warnings};
}
