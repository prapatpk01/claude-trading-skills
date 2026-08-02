import {buildAnalysis} from "./analyze";

export type FactorMode="momentum"|"growth"|"quality"|"value"|"dividend"|"institutional"|"ai"|"multifactor";

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

const clamp=(x:number)=>Math.max(0,Math.min(100,Math.round(x)));
const n=(v:any):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const growthPct=(rows:any[],field:string)=>{const a=n(rows?.[0]?.[field]),b=n(rows?.[1]?.[field]);return a!=null&&b!=null&&b!==0?(a/b-1)*100:null};
const ratio=(a:number|null,b:number|null)=>a!=null&&b!=null&&b!==0?a/b:null;
const positive=(v:number|null,threshold=0)=>v!=null&&v>threshold;

function scoreOne(a:any){
 const ov=a.data?.overview??{};const inc=a.data?.financials?.income??[];const cf=a.data?.financials?.cashflow??[];const bal=a.data?.financials?.balance??[];const tech=a.technicals??{};
 const revG=growthPct(inc,"totalRevenue");const epsG=growthPct(inc,"netIncome");const opG=growthPct(inc,"operatingIncome");const qGrowth=n(a.data?.quarters?.[0]?.revenueYoY);
 const margin=(n(ov.profitMargin)??ratio(n(inc?.[0]?.netIncome),n(inc?.[0]?.totalRevenue))??0)*100;
 const opMargin=(n(ov.operatingMargin)??ratio(n(inc?.[0]?.operatingIncome),n(inc?.[0]?.totalRevenue))??0)*100;
 const roe=(n(ov.roe)??0)*100;const roa=(n(ov.roa)??0)*100;
 const ocf=n(cf?.[0]?.operatingCashflow);const capex=Math.abs(n(cf?.[0]?.capitalExpenditures)??0);const fcf=ocf==null?null:ocf-capex;const ni=n(inc?.[0]?.netIncome);
 const cashConv=ni&&fcf!=null?fcf/ni:null;const debt=(n(bal?.[0]?.longTermDebt)??0)+(n(bal?.[0]?.shortTermDebt)??0);const cash=n(bal?.[0]?.cashAndEquivalents)??0;
 const pe=n(ov.forwardPE)??n(ov.peRatio);const peg=n(ov.pegRatio);const pb=n(ov.priceToBook);const upside=n(a.upsidePct)??n(a.expectedReturnPct)??0;
 const yieldPct=(n(ov.dividendYield)??0)*100;const payout=(n(ov.payoutRatio)??0)*100;const dividendGrowth=n(ov.dividendGrowth5Y)??0;
 const rs30=n(tech.rs30)??1;const volRatio=n(tech.volRatio)??1;const upDown=n(tech.upDownVolRatio)??1;const ret3m=n(tech.return3m)??0;
 const momentum=clamp(20+rs30*22+volRatio*16+upDown*12+ret3m*.45+(tech.maFanning?14:0)+(tech.aboveEma20?8:0));
 const growth=clamp(28+(revG??qGrowth??0)*1.35+(epsG??0)*.75+(opG??0)*.45+(opMargin>20?10:0)+(positive(fcf)?7:0));
 const quality=clamp(30+Math.min(25,Math.max(-10,roe*.65))+Math.min(15,Math.max(-5,roa*.8))+Math.min(15,Math.max(-10,margin*.5))+(cashConv!=null?Math.min(15,Math.max(-10,cashConv*15)):0)+(cash>debt?10:-5));
 const value=clamp(38+Math.max(-20,Math.min(32,upside))+(pe!=null?Math.max(-20,28-pe):0)+(peg!=null?Math.max(-12,13-peg*5):0)+(pb!=null?Math.max(-8,9-pb):0)+(positive(fcf)?6:0));
 const dividend=clamp(22+Math.min(35,yieldPct*7)+Math.min(18,Math.max(0,dividendGrowth*.8))+(payout>0&&payout<70?15:payout>=90?-12:4)+(positive(fcf)?10:0)+(cash>debt?6:0));
 const institutional=clamp(18+rs30*20+volRatio*18+upDown*14+ret3m*.35+(tech.maFanning?12:0)+(tech.aboveEma20?8:0));
 const sector=String(ov.sector??"").toLowerCase();const desc=String(ov.description??"").toLowerCase();const aiTheme=/semiconductor|software|technology|cloud|cyber|artificial intelligence|data center|robot|automation|machine learning/.test(`${sector} ${desc}`);
 const ai=clamp((aiTheme?50:18)+growth*.22+quality*.12+institutional*.18);
 const composite=clamp(momentum*.18+growth*.2+quality*.2+value*.16+dividend*.08+institutional*.12+ai*.06);
 const reasons:string[]=[];
 if(momentum>=75)reasons.push("Strong relative strength and trend participation");
 if(growth>=75)reasons.push("Revenue or earnings expansion");
 if(quality>=75)reasons.push("High profitability and cash-flow quality");
 if(value>=75)reasons.push("Attractive valuation versus expected return");
 if(dividend>=75)reasons.push("Dividend income and coverage quality");
 if(institutional>=75)reasons.push("Accumulation proxy from volume and relative strength");
 if(ai>=75)reasons.push("AI / innovation theme exposure");
 return {ticker:a.ticker,name:ov.name??a.ticker,sector:ov.sector??"Unknown",price:n(a.data?.quote?.price),targetPrice:n(a.targetPrice),expectedReturnPct:n(a.expectedReturnPct),momentum,growth,quality,value,dividend,institutional,ai,composite,reasons,metrics:{revenueGrowthPct:revG??qGrowth,earningsGrowthPct:epsG,operatingMarginPct:opMargin,roePct:roe,freeCashFlow:fcf,forwardPE:pe,peg,pb,dividendYieldPct:yieldPct,payoutRatioPct:payout,rs30,volumeRatio:volRatio,upDownVolume:upDown},thesis:a.thesis?.find((x:any)=>x.label==="Base")?.narrative??"Institutional factor candidate.",dataQuality:a.committee?.confidence??"MEDIUM"};
}

function qualifies(mode:FactorMode,row:any){
 switch(mode){
  case"momentum":return row.momentum>=62&&row.metrics.rs30>=1&&row.metrics.volumeRatio>=.9;
  case"growth":return row.growth>=60&&(positive(row.metrics.revenueGrowthPct,8)||positive(row.metrics.earningsGrowthPct,10));
  case"quality":return row.quality>=62&&row.metrics.roePct>=10&&positive(row.metrics.freeCashFlow);
  case"value":return row.value>=58&&(row.expectedReturnPct??0)>=8;
  case"dividend":return row.dividend>=55&&row.metrics.dividendYieldPct>=1.5&&row.metrics.payoutRatioPct<95;
  case"institutional":return row.institutional>=62&&row.metrics.volumeRatio>=1&&row.metrics.upDownVolume>=1;
  case"ai":return row.ai>=60;
  case"multifactor":return row.composite>=62;
 }
}

export async function runFactorDiscovery(mode:FactorMode,universe?:string[],topN=10){
 const sourceUniverse=(universe?.length?universe:ENGINE_UNIVERSES[mode]).slice(0,40);const rows:any[]=[];const warnings:string[]=[];
 for(const ticker of sourceUniverse){try{rows.push(scoreOne(await buildAnalysis(ticker)))}catch(e:any){warnings.push(`${ticker}: ${e?.message??"analysis failed"}`)}}
 const qualified=rows.filter(r=>qualifies(mode,r));const key=mode==="multifactor"?"composite":mode;qualified.sort((a,b)=>(b[key]??0)-(a[key]??0));
 const picks=qualified.slice(0,topN);const engineTags:Record<string,string[]>={};
 for(const row of rows){engineTags[row.ticker]=(["momentum","growth","quality","value","dividend","institutional","ai"] as FactorMode[]).filter(m=>qualifies(m,row));}
 const withConsensus=picks.map(row=>({...row,engines:engineTags[row.ticker]??[],consensusCount:(engineTags[row.ticker]??[]).length}));
 return {mode,version:"11.0-alpha-core",asOf:new Date().toISOString(),methodology:mode==="institutional"?"Accumulation proxy based on price, volume and relative strength; no ownership claim without filing evidence.":"Independent universe, filter and ranking model for this engine.",stats:{universe:sourceUniverse.length,analyzed:rows.length,qualified:qualified.length,returned:withConsensus.length},picks:withConsensus,rejected:rows.filter(r=>!qualifies(mode,r)).length,warnings};
}
