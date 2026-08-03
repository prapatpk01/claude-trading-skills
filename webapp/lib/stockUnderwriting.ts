export type UnderwritingDecision="BUY"|"WATCH"|"AVOID"|"BLOCKED";

export type UnderwritingPack={
 version:string;
 decision:UnderwritingDecision;
 conviction:number;
 horizon:string;
 evidence:{score:number;grade:"HIGH"|"MEDIUM"|"LOW";checks:Record<string,boolean>;hardBlocks:string[]};
 valuation:{price:number|null;fairValue:number|null;targetPrice:number|null;upsidePct:number|null;marginOfSafetyPct:number|null;status:string};
 quality:{score:number;grade:string;roePct:number|null;operatingMarginPct:number|null;freeCashFlow:number|null;netDebt:number|null};
 growth:{score:number;grade:string;revenueGrowthPct:number|null;earningsGrowthPct:number|null};
 technical:{score:number;trend:string;momentumScore:number|null;entryZoneLow:number|null;entryZoneHigh:number|null;stopLoss:number|null};
 thesis:{base:string;bull:string;bear:string;keyDrivers:string[]};
 catalysts:{items:string[];status:string};
 risks:{items:string[];killCriteria:string[]};
 monitoring:{items:string[];reviewCadence:string};
 provenance:{researchEngine:string|null;researchHorizon:string|null;receivedFromResearch:boolean};
};

const finite=(value:unknown):number|null=>typeof value==="number"&&Number.isFinite(value)?value:null;
const clamp=(value:number)=>Math.max(0,Math.min(100,Math.round(value)));
const growth=(rows:any[],field:string):number|null=>{
 const latest=finite(rows?.[0]?.[field]);
 const prior=finite(rows?.[1]?.[field]);
 return latest!=null&&prior!=null&&prior!==0?(latest/prior-1)*100:null;
};
const grade=(score:number)=>score>=75?"HIGH":score>=55?"MEDIUM":"LOW";

export function buildUnderwritingPack(result:any,context?:{engine?:string|null;horizon?:string|null}):UnderwritingPack{
 const data=result?.data??{};
 const overview=data.overview??{};
 const income=Array.isArray(data.financials?.income)?data.financials.income:[];
 const cashflow=Array.isArray(data.financials?.cashflow)?data.financials.cashflow:[];
 const balance=Array.isArray(data.financials?.balance)?data.financials.balance:[];
 const evidence=result?.evidenceCoverage??{checks:{},percent:0,hardBlocks:[]};
 const price=finite(data.quote?.price);
 const target=finite(result?.targetPrice);
 const dcf=finite(result?.dcf?.fairValue);
 const multiple=finite(result?.multiples?.fairValue);
 const fairValues=[dcf,multiple,target].filter((value):value is number=>value!=null&&value>0);
 const fairValue=fairValues.length?fairValues.reduce((sum,value)=>sum+value,0)/fairValues.length:null;
 const upside=price!=null&&target!=null?((target/price)-1)*100:null;
 const marginOfSafety=price!=null&&fairValue!=null?((fairValue/price)-1)*100:null;
 const revenueGrowth=growth(income,"totalRevenue");
 const earningsGrowth=growth(income,"netIncome");
 const revenue=finite(income?.[0]?.totalRevenue);
 const operatingIncome=finite(income?.[0]?.operatingIncome);
 const operatingMargin=revenue!=null&&operatingIncome!=null&&revenue!==0?operatingIncome/revenue*100:finite(overview.operatingMargin)!=null?finite(overview.operatingMargin)!*100:null;
 const roe=finite(overview.roe)!=null?finite(overview.roe)!*100:null;
 const ocf=finite(cashflow?.[0]?.operatingCashflow);
 const capex=Math.abs(finite(cashflow?.[0]?.capitalExpenditures)??0);
 const freeCashFlow=ocf==null?null:ocf-capex;
 const debt=(finite(balance?.[0]?.longTermDebt)??0)+(finite(balance?.[0]?.shortTermDebt)??0);
 const cash=finite(balance?.[0]?.cashAndEquivalents);
 const netDebt=cash==null?null:debt-cash;
 const qualityScore=clamp(35+(roe??0)*.7+(operatingMargin??0)*.6+(freeCashFlow!=null&&freeCashFlow>0?15:-12)+(netDebt!=null&&netDebt<0?10:0));
 const growthScore=clamp(45+(revenueGrowth??0)*1.1+(earningsGrowth??0)*.6);
 const momentumScore=finite(result?.momentum?.total);
 const technicalScore=clamp((momentumScore??50)+(price!=null&&target!=null&&target>price?8:0));
 const hardBlocks=Array.isArray(evidence.hardBlocks)?evidence.hardBlocks:[];
 const evidenceScore=Number(evidence.percent??0);
 const valuationPositive=upside!=null&&upside>0;
 const conviction=clamp(evidenceScore*.35+qualityScore*.2+growthScore*.2+technicalScore*.15+(valuationPositive?10:0));
 let decision:UnderwritingDecision="WATCH";
 if(hardBlocks.length)decision="BLOCKED";
 else if(upside!=null&&upside>=10&&qualityScore>=55&&conviction>=65)decision="BUY";
 else if(upside!=null&&upside<0)decision="AVOID";
 const base=result?.thesis?.find((item:any)=>item?.label==="Base")?.narrative??"Base-case thesis requires analyst review.";
 const bull=result?.thesis?.find((item:any)=>item?.label==="Bull")?.narrative??"Bull case depends on stronger growth, margins or valuation support.";
 const bear=result?.thesis?.find((item:any)=>item?.label==="Bear")?.narrative??"Bear case includes execution risk and valuation compression.";
 const entryLow=price==null?null:Number((price*.97).toFixed(2));
 const entryHigh=price==null?null:Number((price*1.01).toFixed(2));
 const stopLoss=price==null?null:Number((price*.91).toFixed(2));
 const catalysts=(result?.research?.catalysts??result?.catalysts??[]).map((item:any)=>String(item?.title??item?.label??item)).filter(Boolean).slice(0,6);
 const risks=(result?.committee?.dissent??[]).map(String).filter(Boolean).slice(0,6);
 return {
  version:"12.0-stock-underwriting",
  decision,conviction,horizon:context?.horizon??"6–12 months",
  evidence:{score:evidenceScore,grade:grade(evidenceScore),checks:evidence.checks??{},hardBlocks},
  valuation:{price,fairValue,targetPrice:target,upsidePct:upside,marginOfSafetyPct:marginOfSafety,status:hardBlocks.length?"BLOCKED":valuationPositive?"POSITIVE":"CAUTION"},
  quality:{score:qualityScore,grade:grade(qualityScore),roePct:roe,operatingMarginPct:operatingMargin,freeCashFlow,netDebt},
  growth:{score:growthScore,grade:grade(growthScore),revenueGrowthPct:revenueGrowth,earningsGrowthPct:earningsGrowth},
  technical:{score:technicalScore,trend:technicalScore>=65?"UPTREND":technicalScore<45?"DOWNTREND":"NEUTRAL",momentumScore,entryZoneLow:entryLow,entryZoneHigh:entryHigh,stopLoss},
  thesis:{base,bull,bear,keyDrivers:["Revenue growth","Free cash flow","Margins","Valuation","Competitive position"]},
  catalysts:{items:catalysts.length?catalysts:["Next earnings update","Guidance revision","Industry demand inflection"],status:catalysts.length?"EVIDENCE_AVAILABLE":"ANALYST_REVIEW_REQUIRED"},
  risks:{items:risks.length?risks:["Execution risk","Valuation compression","Catalyst delay"],killCriteria:["Thesis-driving revenue growth turns negative","Free cash flow deteriorates materially","Target falls to or below current price"]},
  monitoring:{items:["Revenue and earnings growth","Operating margin","Free cash flow","Guidance","Price versus entry and stop"],reviewCadence:context?.engine==="momentum"?"Weekly":"After earnings or material news"},
  provenance:{researchEngine:context?.engine??null,researchHorizon:context?.horizon??null,receivedFromResearch:Boolean(context?.engine)},
 };
}
