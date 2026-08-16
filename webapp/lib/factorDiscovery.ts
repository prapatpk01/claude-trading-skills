import {buildAnalysis} from "./analyze";

export type FactorMode="momentum"|"growth"|"quality"|"value"|"dividend"|"institutional"|"ai"|"multifactor";
export type ResearchStatus="QUALIFIED"|"REJECTED"|"ANALYSIS_FAILED";

export type ResearchCandidate={
 ticker:string;name:string;sector:string;price:number|null;targetPrice:number|null;expectedReturnPct:number|null;
 momentum:number;growth:number;quality:number;value:number;dividend:number;institutional:number;ai:number;composite:number;
 reasons:string[];metrics:Record<string,number|null>;thesis:string;dataQuality:string;
 engines?:string[];consensusCount?:number;status:ResearchStatus;passed:boolean;gateReasons:string[];failedGates:string[];
};

export const ENGINE_UNIVERSES:Record<FactorMode,string[]>={
 momentum:["PLTR","APP","HOOD","CRWV","NVDA","AVGO","QCOM","ANET","ARM","MU","AMD","META","NFLX","SHOP","MELI","UBER","CRWD","PANW","GE","ETN","CAT","LMT","RTX","VRT"],
 growth:["MELI","SHOP","NU","PDD","UBER","META","AMZN","NFLX","PLTR","CRWD","NOW","CRM","LLY","NVO","ISRG","VRTX","QCOM","AMD","MU","TSM","ANET","SNOW","DDOG","NET"],
 quality:["MSFT","V","MA","COST","META","GOOGL","ADBE","ORCL","TXN","AVGO","UNH","REGN","VRTX","ISRG","LLY","PG","KO","PEP","WMT","HD","LOW","SPGI","MCO","ICE"],
 value:["GOOGL","QCOM","AMAT","USB","GD","UNH","CVX","XOM","COP","JPM","GS","C","BAC","PFE","BMY","UPS","FDX","DE","CAT","LMT","RTX","CMCSA","TROW","BK"],
 dividend:["SCHD","VIG","DGRO","FDVV","HDV","JEPI","JEPQ","O","MAIN","ARCC","KO","PEP","PG","JNJ","ABBV","CVX","XOM","HD","LOW","TXN","IBM","UPS","TROW","USB"],
 institutional:["QCOM","AVGO","MELI","CRWV","SHOP","PLTR","ANET","VRT","ARM","MU","TSM","META","UBER","HOOD","APP","GE","ETN","RTX","LMT","CAT","LLY","NVO","ISRG","REGN"],
 ai:["NVDA","AVGO","AMD","QCOM","TSM","ASML","ARM","MU","ANET","VRT","PLTR","MSFT","GOOGL","AMZN","META","ORCL","NOW","CRM","CRWD","PANW","SNOW","DDOG","NET","PATH"],
 multifactor:["MSFT","GOOGL","META","QCOM","AVGO","AMZN","MELI","V","MA","COST","UNH","LLY","REGN","VRTX","ISRG","JPM","GD","USB","CAT","GE","ETN","LMT","RTX","CVX","XOM","TXN","HD","WMT","PG","KO"]
};

export const FACTOR_UNIVERSE=Array.from(new Set(Object.values(ENGINE_UNIVERSES).flat()));
const clamp=(x:number)=>Math.max(0,Math.min(100,Math.round(x)));
const n=(v:any):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const growthPct=(rows:any[],field:string)=>{const a=n(rows?.[0]?.[field]),b=n(rows?.[1]?.[field]);return a!=null&&b!=null&&b!==0?(a/b-1)*100:null};
const ratio=(a:number|null,b:number|null)=>a!=null&&b!=null&&b!==0?a/b:null;
const positive=(v:number|null,threshold=0)=>v!=null&&v>threshold;
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const output=new Array<R>(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)break;output[index]=await fn(items[index])}}));return output;}

function scoreOne(a:any):Omit<ResearchCandidate,"status"|"passed"|"gateReasons"|"failedGates">{
 const ov=a.data?.overview??{},inc=a.data?.financials?.income??[],cf=a.data?.financials?.cashflow??[],bal=a.data?.financials?.balance??[],tech=a.technicals??{};
 const revG=growthPct(inc,"totalRevenue"),epsG=growthPct(inc,"netIncome"),opG=growthPct(inc,"operatingIncome"),qGrowth=n(a.data?.quarters?.[0]?.revenueYoY);
 const margin=(n(ov.profitMargin)??ratio(n(inc?.[0]?.netIncome),n(inc?.[0]?.totalRevenue))??0)*100,opMargin=(n(ov.operatingMargin)??ratio(n(inc?.[0]?.operatingIncome),n(inc?.[0]?.totalRevenue))??0)*100;
 const roe=(n(ov.roe)??0)*100,roa=(n(ov.roa)??0)*100,ocf=n(cf?.[0]?.operatingCashflow),capex=Math.abs(n(cf?.[0]?.capitalExpenditures)??0),fcf=ocf==null?null:ocf-capex,ni=n(inc?.[0]?.netIncome);
 const cashConv=ni&&fcf!=null?fcf/ni:null,debt=(n(bal?.[0]?.longTermDebt)??0)+(n(bal?.[0]?.shortTermDebt)??0),cash=n(bal?.[0]?.cashAndEquivalents)??0;
 const pe=n(ov.forwardPE)??n(ov.peRatio),peg=n(ov.pegRatio),pb=n(ov.priceToBook),upside=n(a.upsidePct)??n(a.expectedReturnPct)??0;
 const yieldPct=(n(ov.dividendYield)??0)*100,payout=(n(ov.payoutRatio)??0)*100,dividendGrowth=n(ov.dividendGrowth5Y)??0;
 const rs30=n(tech.rs30)??1,volRatio=n(tech.volRatio)??1,upDown=n(tech.upDownVolRatio)??1,ret1m=n(tech.return1m)??0,ret3m=n(tech.return3m)??0;
 const momentum=clamp(20+rs30*22+volRatio*16+upDown*12+ret3m*.45+(tech.maFanning?14:0)+(tech.aboveEma20?8:0));
 const growth=clamp(28+(revG??qGrowth??0)*1.35+(epsG??0)*.75+(opG??0)*.45+(opMargin>20?10:0)+(positive(fcf)?7:0));
 const quality=clamp(30+Math.min(25,Math.max(-10,roe*.65))+Math.min(15,Math.max(-5,roa*.8))+Math.min(15,Math.max(-10,margin*.5))+(cashConv!=null?Math.min(15,Math.max(-10,cashConv*15)):0)+(cash>debt?10:-5));
 const value=clamp(38+Math.max(-20,Math.min(32,upside))+(pe!=null?Math.max(-20,28-pe):0)+(peg!=null?Math.max(-12,13-peg*5):0)+(pb!=null?Math.max(-8,9-pb):0)+(positive(fcf)?6:0));
 const dividend=clamp(22+Math.min(35,yieldPct*7)+Math.min(18,Math.max(0,dividendGrowth*.8))+(payout>0&&payout<70?15:payout>=90?-12:4)+(positive(fcf)?10:0)+(cash>debt?6:0));
 const institutional=clamp(18+rs30*20+volRatio*18+upDown*14+ret3m*.35+(tech.maFanning?12:0)+(tech.aboveEma20?8:0));
 const sector=String(ov.sector??"").toLowerCase(),desc=String(ov.description??"").toLowerCase(),aiTheme=/semiconductor|software|technology|cloud|cyber|artificial intelligence|data center|robot|automation|machine learning/.test(`${sector} ${desc}`);
 const ai=clamp((aiTheme?50:18)+growth*.22+quality*.12+institutional*.18),composite=clamp(momentum*.18+growth*.2+quality*.2+value*.16+dividend*.08+institutional*.12+ai*.06);
 const reasons:string[]=[];if(momentum>=75)reasons.push("Strong relative strength and trend participation");if(growth>=75)reasons.push("Revenue or earnings expansion");if(quality>=75)reasons.push("High profitability and cash-flow quality");if(value>=75)reasons.push("Attractive valuation versus expected return");if(dividend>=75)reasons.push("Dividend income and coverage quality");if(institutional>=75)reasons.push("Accumulation proxy from volume and relative strength");if(ai>=75)reasons.push("AI / innovation theme exposure");
 return {ticker:a.ticker,name:ov.name??a.ticker,sector:ov.sector??"Unknown",price:n(a.data?.quote?.price),targetPrice:n(a.targetPrice),expectedReturnPct:n(a.expectedReturnPct),momentum,growth,quality,value,dividend,institutional,ai,composite,reasons,metrics:{revenueGrowthPct:revG??qGrowth,earningsGrowthPct:epsG,operatingMarginPct:opMargin,roePct:roe,freeCashFlow:fcf,forwardPE:pe,peg,pb,dividendYieldPct:yieldPct,payoutRatioPct:payout,rs30,volumeRatio:volRatio,upDownVolume:upDown,return1m:ret1m,return3m:ret3m,aboveEma20:tech.aboveEma20?1:0,maFanning:tech.maFanning?1:0},thesis:a.thesis?.find((x:any)=>x.label==="Base")?.narrative??"Institutional factor candidate.",dataQuality:a.committee?.confidence??"MEDIUM"};
}

function gateReview(mode:FactorMode,row:Omit<ResearchCandidate,"status"|"passed"|"gateReasons"|"failedGates">){const checks:{label:string;pass:boolean}[]=[];if(mode==="momentum")checks.push({label:"Momentum score ≥ 62",pass:row.momentum>=62},{label:"Relative strength ≥ 1.0",pass:(row.metrics.rs30??0)>=1},{label:"Volume ratio ≥ 0.9",pass:(row.metrics.volumeRatio??0)>=.9});if(mode==="growth")checks.push({label:"Growth score ≥ 60",pass:row.growth>=60},{label:"Revenue > 8% or earnings > 10%",pass:positive(row.metrics.revenueGrowthPct,8)||positive(row.metrics.earningsGrowthPct,10)});if(mode==="quality")checks.push({label:"Quality score ≥ 62",pass:row.quality>=62},{label:"ROE ≥ 10%",pass:(row.metrics.roePct??0)>=10},{label:"Positive free cash flow",pass:positive(row.metrics.freeCashFlow)});if(mode==="value")checks.push({label:"Value score ≥ 58",pass:row.value>=58},{label:"Expected upside ≥ 8%",pass:(row.expectedReturnPct??-Infinity)>=8});if(mode==="dividend")checks.push({label:"Dividend score ≥ 55",pass:row.dividend>=55},{label:"Yield ≥ 1.5%",pass:(row.metrics.dividendYieldPct??0)>=1.5},{label:"Payout ratio < 95%",pass:(row.metrics.payoutRatioPct??Infinity)<95},{label:"Positive free cash flow",pass:positive(row.metrics.freeCashFlow)});if(mode==="institutional")checks.push({label:"Institutional proxy ≥ 62",pass:row.institutional>=62},{label:"Volume ratio ≥ 1.0",pass:(row.metrics.volumeRatio??0)>=1},{label:"Up/down volume ≥ 1.0",pass:(row.metrics.upDownVolume??0)>=1});if(mode==="ai")checks.push({label:"AI / innovation score ≥ 60",pass:row.ai>=60});if(mode==="multifactor")checks.push({label:"Composite score ≥ 62",pass:row.composite>=62});const passed=checks.every(check=>check.pass);return{passed,gateReasons:checks.filter(check=>check.pass).map(check=>check.label),failedGates:checks.filter(check=>!check.pass).map(check=>check.label)};}

export async function runFactorDiscovery(mode:FactorMode,universe?:string[],topN=10){const sourceUniverse=(universe?.length?universe:ENGINE_UNIVERSES[mode]).slice(0,40),analyzed:ResearchCandidate[]=[],warnings:string[]=[];const outcomes=await mapLimit(sourceUniverse,5,async ticker=>{try{const scored=scoreOne(await buildAnalysis(ticker)),review=gateReview(mode,scored);return{candidate:{...scored,...review,status:review.passed?"QUALIFIED":"REJECTED"} as ResearchCandidate,error:null}}catch(e:any){return{candidate:null,error:`${ticker}: ${e?.message??"analysis failed"}`}}});for(const outcome of outcomes){if(outcome.candidate)analyzed.push(outcome.candidate);if(outcome.error)warnings.push(outcome.error)}const key=mode==="multifactor"?"composite":mode,qualified=analyzed.filter(row=>row.passed).sort((a,b)=>(Number((b as any)[key])||0)-(Number((a as any)[key])||0)),engineTags:Record<string,string[]>={};for(const row of analyzed){engineTags[row.ticker]=(["momentum","growth","quality","value","dividend","institutional","ai"] as FactorMode[]).filter(engine=>gateReview(engine,row).passed)}const candidates=analyzed.map(row=>({...row,engines:engineTags[row.ticker]??[],consensusCount:(engineTags[row.ticker]??[]).length})),picks=qualified.slice(0,topN).map(row=>({...row,engines:engineTags[row.ticker]??[],consensusCount:(engineTags[row.ticker]??[]).length})),rejected=candidates.filter(row=>!row.passed).sort((a,b)=>(Number((b as any)[key])||0)-(Number((a as any)[key])||0));return{mode,version:"23.0-research-evidence",asOf:new Date().toISOString(),methodology:mode==="institutional"?"Accumulation proxy based on price, volume and relative strength; no ownership claim without filing evidence.":"Independent universe, evidence gates, ranking and documented rejection model for this engine.",stats:{universe:sourceUniverse.length,analyzed:analyzed.length,qualified:qualified.length,returned:picks.length,failedAnalysis:warnings.length},pipeline:{universe:sourceUniverse.length,analyzed:analyzed.length,qualified:qualified.length,rejected:rejected.length,selected:picks.length,committeeReady:picks.length},picks,candidates,rejectedCandidates:rejected,warnings};}
