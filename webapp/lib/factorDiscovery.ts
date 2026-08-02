import { buildAnalysis } from "./analyze";

export type FactorMode="growth"|"quality"|"value"|"institutional"|"ai"|"multifactor";

export const FACTOR_UNIVERSE=[
 "NVDA","MSFT","AVGO","AMZN","META","GOOGL","AMD","TSM","ASML","QCOM","MU","ARM",
 "CRM","NOW","ORCL","PLTR","CRWD","PANW","ANET","UBER","MELI","SHOP","NFLX","LLY",
 "NVO","REGN","ISRG","VRTX","JPM","GS","V","MA","COST","HD","CAT","GE","ETN","LMT",
 "XOM","CVX","COP","NEE","LIN","DE","UNH","ABBV","PG","KO","PEP","WMT"
];

const clamp=(x:number)=>Math.max(0,Math.min(100,Math.round(x)));
const n=(v:any):number|null=>typeof v==="number"&&Number.isFinite(v)?v:null;
const growthPct=(rows:any[],field:string)=>{const a=n(rows?.[0]?.[field]),b=n(rows?.[1]?.[field]);return a!=null&&b&&b!==0?(a/b-1)*100:null};
const ratio=(a:number|null,b:number|null)=>a!=null&&b!=null&&b!==0?a/b:null;

function scoreOne(a:any){
 const ov=a.data?.overview??{};const inc=a.data?.financials?.income??[];const cf=a.data?.financials?.cashflow??[];const bal=a.data?.financials?.balance??[];const tech=a.technicals??{};
 const revG=growthPct(inc,"totalRevenue");const epsG=growthPct(inc,"netIncome");const opG=growthPct(inc,"operatingIncome");
 const q0=a.data?.quarters?.[0];const qGrowth=n(q0?.revenueYoY);
 const margin=(n(ov.profitMargin)??ratio(n(inc?.[0]?.netIncome),n(inc?.[0]?.totalRevenue))??0)*100;
 const opMargin=(n(ov.operatingMargin)??ratio(n(inc?.[0]?.operatingIncome),n(inc?.[0]?.totalRevenue))??0)*100;
 const roe=(n(ov.roe)??0)*100;const roa=(n(ov.roa)??0)*100;
 const ocf=n(cf?.[0]?.operatingCashflow);const capex=Math.abs(n(cf?.[0]?.capitalExpenditures)??0);const fcf=ocf==null?null:ocf-capex;const ni=n(inc?.[0]?.netIncome);
 const cashConv=ni&&fcf!=null?fcf/ni:null;const debt=(n(bal?.[0]?.longTermDebt)??0)+(n(bal?.[0]?.shortTermDebt)??0);const cash=n(bal?.[0]?.cashAndEquivalents)??0;
 const pe=n(ov.forwardPE)??n(ov.peRatio);const peg=n(ov.pegRatio);const pb=n(ov.priceToBook);const upside=n(a.upsidePct)??0;
 const growth=clamp(40+(revG??qGrowth??0)*1.2+(epsG??0)*.7+(opG??0)*.4+(opMargin>20?10:0));
 const quality=clamp(35+Math.min(25,Math.max(-10,roe*.6))+Math.min(15,Math.max(-5,roa*.8))+Math.min(15,Math.max(-10,margin*.5))+(cashConv!=null?Math.min(15,Math.max(-10,cashConv*15)):0)+(cash>debt?10:-5));
 const value=clamp(45+Math.max(-20,Math.min(30,upside))+(pe!=null?Math.max(-20,25-pe):0)+(peg!=null?Math.max(-12,12-peg*5):0)+(pb!=null?Math.max(-8,8-pb):0));
 const institutional=clamp(30+(n(tech.rs30)??1)*20+(n(tech.volRatio)??1)*15+(n(tech.upDownVolRatio)??1)*12+(tech.maFanning?12:0)+(tech.aboveEma20?8:0)+(n(tech.return3m)??0)*.35);
 const sector=String(ov.sector??"").toLowerCase();const desc=String(ov.description??"").toLowerCase();const aiTheme=/semiconductor|software|technology|cloud|cyber|artificial intelligence|data center|robot|automation/.test(`${sector} ${desc}`);
 const ai=clamp((aiTheme?55:25)+growth*.2+quality*.1+institutional*.15);
 const composite=clamp(growth*.25+quality*.22+value*.18+institutional*.2+ai*.15);
 return {ticker:a.ticker,name:ov.name??a.ticker,sector:ov.sector??"Unknown",price:n(a.data?.quote?.price),targetPrice:n(a.targetPrice),expectedReturnPct:n(a.expectedReturnPct),growth,quality,value,institutional,ai,composite,metrics:{revenueGrowthPct:revG??qGrowth,earningsGrowthPct:epsG,operatingMarginPct:opMargin,roePct:roe,freeCashFlow:fcf,forwardPE:pe,peg,pb,rs30:n(tech.rs30),volumeRatio:n(tech.volRatio),upDownVolume:n(tech.upDownVolRatio)},thesis:a.thesis?.find((x:any)=>x.label==="Base")?.narrative??"Institutional factor candidate.",dataQuality:a.committee?.confidence??"MEDIUM"};
}

export async function runFactorDiscovery(mode:FactorMode,universe:string[],topN=10){
 const rows:any[]=[];const warnings:string[]=[];
 for(const ticker of universe.slice(0,30)){
  try{rows.push(scoreOne(await buildAnalysis(ticker)))}catch(e:any){warnings.push(`${ticker}: ${e?.message??"analysis failed"}`)}
 }
 const key=mode==="multifactor"?"composite":mode;
 rows.sort((a,b)=>(b[key]??0)-(a[key]??0));
 return {mode,version:"10.4",asOf:new Date().toISOString(),methodology:mode==="institutional"?"Institutional Interest is an accumulation proxy based on price, volume and relative-strength behavior. It does not claim verified institutional ownership changes unless a filing source is available.":"Ranks verified market and fundamental evidence with factor-specific scoring.",scanned:rows.length,picks:rows.slice(0,topN),rejected:rows.slice(topN),warnings};
}
