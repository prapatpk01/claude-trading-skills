export type ResearchEngineMode="momentum"|"dividend"|"thematic"|"growth"|"quality"|"value"|"institutional"|"ai"|"multifactor";
export type ResearchCandidateLike=Record<string,any>;

export type TradePlan={
 horizon:string;
 entryLow:number|null;
 entryHigh:number|null;
 stopLoss:number|null;
 target1:number|null;
 target2:number|null;
 expectedUpsidePct:number|null;
 riskPct:number|null;
 rewardRisk:number|null;
};

export type EnginePerformanceContract={
 engineId:string;
 pickId:string;
 ticker:string;
 proposedAt:string;
 horizonDays:number;
 entryLow:number|null;
 entryHigh:number|null;
 stopLoss:number|null;
 target1:number|null;
 target2:number|null;
 status:"OPEN"|"WON"|"LOST"|"EXPIRED"|"CANCELLED";
 entryPrice:number|null;
 exitPrice:number|null;
 maxGainPct:number|null;
 maxDrawdownPct:number|null;
 realizedReturnPct:number|null;
 closedAt:string|null;
 outcomeReason:string|null;
};

const num=(value:unknown):number|null=>{const parsed=typeof value==="number"?value:Number(value);return Number.isFinite(parsed)?parsed:null};
const round=(value:number|null,digits=2)=>value==null?null:Number(value.toFixed(digits));
const pctMove=(price:number,percent:number)=>round(price*(1+percent/100));
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

const INCOME_VEHICLES=new Set(["SCHD","VIG","DGRO","FDVV","HDV","JEPI","JEPQ","O","MAIN","ARCC"]);

export function buildTradePlan(mode:ResearchEngineMode,candidate:ResearchCandidateLike):TradePlan{
 const price=num(candidate?.price);
 if(price==null||price<=0)return{horizon:"DATA REQUIRED",entryLow:null,entryHigh:null,stopLoss:null,target1:null,target2:null,expectedUpsidePct:null,riskPct:null,rewardRisk:null};
 const reportedUpside=num(candidate?.expectedReturnPct);
 if(mode==="momentum"){
  const targetUpside=clamp(reportedUpside!=null&&reportedUpside>=10?reportedUpside:12,10,22);
  const risk=6;
  const entryLow=pctMove(price,-1.5),entryHigh=pctMove(price,1);
  const target1=pctMove(price,10),target2=pctMove(price,targetUpside);
  return{horizon:"2–4 weeks",entryLow,entryHigh,stopLoss:pctMove(price,-risk),target1,target2,expectedUpsidePct:round(targetUpside,1),riskPct:risk,rewardRisk:round(targetUpside/risk,2)};
 }
 if(mode==="thematic"){
  const targetUpside=clamp(reportedUpside!=null&&reportedUpside>=10?reportedUpside:15,10,30);
  const risk=8;
  return{horizon:"1–3 months",entryLow:pctMove(price,-3),entryHigh:pctMove(price,1),stopLoss:pctMove(price,-risk),target1:pctMove(price,10),target2:pctMove(price,targetUpside),expectedUpsidePct:round(targetUpside,1),riskPct:risk,rewardRisk:round(targetUpside/risk,2)};
 }
 if(mode==="dividend"){
  const targetUpside=reportedUpside!=null?Math.max(0,reportedUpside):null;
  return{horizon:"6–24 months",entryLow:pctMove(price,-4),entryHigh:price,stopLoss:pctMove(price,-12),target1:targetUpside!=null?pctMove(price,Math.min(10,targetUpside)):null,target2:num(candidate?.targetPrice),expectedUpsidePct:round(targetUpside,1),riskPct:12,rewardRisk:targetUpside!=null?round(targetUpside/12,2):null};
 }
 const upside=reportedUpside;
 return{horizon:"Research horizon",entryLow:pctMove(price,-2),entryHigh:pctMove(price,1),stopLoss:pctMove(price,-8),target1:upside!=null?pctMove(price,Math.min(10,Math.max(5,upside))):null,target2:num(candidate?.targetPrice),expectedUpsidePct:round(upside,1),riskPct:8,rewardRisk:upside!=null?round(upside/8,2):null};
}

function dividendReview(candidate:ResearchCandidateLike){
 const ticker=String(candidate?.ticker??"").toUpperCase();
 const metrics=candidate?.metrics??{};
 const yieldPct=num(metrics.dividendYieldPct)??0;
 const payout=num(metrics.payoutRatioPct);
 const fcf=num(metrics.freeCashFlow);
 const dividendScore=num(candidate?.dividend)??0;
 const incomeVehicle=INCOME_VEHICLES.has(ticker);
 const checks=[
  {label:"Dividend quality score ≥ 48",pass:dividendScore>=48},
  {label:"Yield ≥ 1.5%",pass:yieldPct>=1.5},
  {label:incomeVehicle?"Fund / income vehicle payout structure accepted":"Payout ratio below 95% or unavailable",pass:incomeVehicle||payout==null||payout<95},
  {label:incomeVehicle?"Distribution vehicle coverage model":"Positive FCF or non-corporate income vehicle",pass:incomeVehicle||fcf==null||fcf>0},
 ];
 return{passed:checks.every(check=>check.pass),gateReasons:checks.filter(check=>check.pass).map(check=>check.label),failedGates:checks.filter(check=>!check.pass).map(check=>check.label)};
}

function momentumReview(candidate:ResearchCandidateLike){
 const metrics=candidate?.metrics??{};
 const momentum=num(candidate?.momentum)??0;
 const rs=num(metrics.rs30)??0;
 const volume=num(metrics.volumeRatio)??0;
 const expected=num(candidate?.expectedReturnPct);
 const checks=[
  {label:"Momentum score ≥ 65",pass:momentum>=65},
  {label:"30-day relative strength ≥ 1.0",pass:rs>=1},
  {label:"Volume participation ≥ 0.9x",pass:volume>=.9},
  {label:"2–4 week modeled upside ≥ 10%",pass:expected==null||expected>=10},
 ];
 return{passed:checks.every(check=>check.pass),gateReasons:checks.filter(check=>check.pass).map(check=>check.label),failedGates:checks.filter(check=>!check.pass).map(check=>check.label)};
}

export function applyIndependentEnginePolicy(mode:ResearchEngineMode,candidate:ResearchCandidateLike){
 let review={passed:Boolean(candidate?.passed),gateReasons:[...(candidate?.gateReasons??[])],failedGates:[...(candidate?.failedGates??[])]};
 if(mode==="dividend")review=dividendReview(candidate);
 if(mode==="momentum")review=momentumReview(candidate);
 const tradePlan=buildTradePlan(mode,candidate);
 return{...candidate,...review,passed:review.passed,status:review.passed?"QUALIFIED":"REJECTED",tradePlan};
}

export function engineSelectionLimit(mode:ResearchEngineMode){
 if(mode==="momentum"||mode==="dividend"||mode==="thematic")return 5;
 return 10;
}

export function engineProfile(mode:ResearchEngineMode){
 if(mode==="momentum")return{
  id:"momentum-v1",title:"2–4 Week Momentum",objective:"Select exactly five liquid stocks with strong relative strength, trend and volume participation, targeting at least 10% modeled upside.",holdingPeriod:"10–30 calendar days",benchmark:"SPY / QQQ",performanceMetrics:["Win rate","TP1 hit rate","TP2 hit rate","Stop-loss rate","Average return","Average holding days"],independentState:true,
 };
 if(mode==="dividend")return{
  id:"dividend-v1",title:"Dividend Quality & Growth",objective:"Select five durable income securities using yield, payout safety, cash-flow coverage and distribution durability without imposing a growth-stock upside gate.",holdingPeriod:"6–24 months",benchmark:"SCHD",performanceMetrics:["Total return","Income return","Distribution growth","Maximum drawdown","Dividend cut rate"],independentState:true,
 };
 if(mode==="thematic")return{
  id:"thematic-v1",title:"1–3 Month Thematic Portfolio",objective:"Build an AI-weighted five-stock portfolio within one investable theme, with entry zones, targets, stops and weights totaling 100%.",holdingPeriod:"30–90 calendar days",benchmark:"Theme ETF",performanceMetrics:["Portfolio return","Benchmark alpha","Win rate by constituent","Maximum drawdown","Target hit rate"],independentState:true,
 };
 return{id:`${mode}-v1`,title:mode,objective:"Independent research engine.",holdingPeriod:"Engine specific",benchmark:"SPY",performanceMetrics:["Total return"],independentState:true};
}

export function createPerformanceContract(mode:ResearchEngineMode,candidate:ResearchCandidateLike,asOf:string):EnginePerformanceContract{
 const plan=buildTradePlan(mode,candidate);
 const horizonDays=mode==="momentum"?30:mode==="thematic"?90:730;
 return{
  engineId:engineProfile(mode).id,
  pickId:`${mode}:${String(candidate?.ticker??"").toUpperCase()}:${asOf}`,
  ticker:String(candidate?.ticker??"").toUpperCase(),proposedAt:asOf,horizonDays,
  entryLow:plan.entryLow,entryHigh:plan.entryHigh,stopLoss:plan.stopLoss,target1:plan.target1,target2:plan.target2,
  status:"OPEN",entryPrice:null,exitPrice:null,maxGainPct:null,maxDrawdownPct:null,realizedReturnPct:null,closedAt:null,outcomeReason:null,
 };
}
