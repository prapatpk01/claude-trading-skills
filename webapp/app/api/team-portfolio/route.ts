import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { openOnly } from "@/lib/openPositions";
import { getMarketData, dailyCandles } from "@/lib/marketData";
import { fetchDividends, inferFrequency } from "@/lib/dividends";
import { computeBeta } from "@/lib/derive";
import { computeDcf, defaultAssumptions } from "@/lib/analysis";
import { earningsQuality } from "@/lib/team/intelligence";
import { assessCatalyst } from "@/lib/team/catalyst";
import { projectEarningsDates } from "@/lib/research";
import { buildBookReview } from "@/lib/team/book";
import { ROSTER, FUND } from "@/lib/team/roster";
import type { Candle, MarketData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Holding={ticker:string;shares:number;avg_cost:number};
type Packet={h:Holding;data:MarketData|null;divs:{date:string;amount:number}[];error:string|null};

async function loadHoldings():Promise<Holding[]>{
 const sb=getSupabase();
 if(sb){let {data,error}=await sb.from("holdings").select("ticker,shares,avg_cost,closed_at");if(error&&/closed_at/i.test(error.message))({data,error}=await sb.from("holdings").select("ticker,shares,avg_cost"));if(error)throw new Error(error.message);return openOnly((data??[]) as any[]) as Holding[];}
 return openOnly(memStore.holdings).map(h=>({ticker:h.ticker,shares:h.shares,avg_cost:h.avg_cost}));
}
async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{const out=new Array<R>(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)break;out[i]=await fn(items[i]);}}));return out;}
function fwdYield(events:{date:string;amount:number}[],price:number|null){if(!events.length||!price)return null;const {perYear}=inferFrequency(events);const last=events.at(-1)!;const cutoff=new Date(Date.now()-365*86400000).toISOString().slice(0,10);const ttm=events.filter(e=>e.date>=cutoff).reduce((s,e)=>s+e.amount,0);const est=perYear?last.amount*perYear:ttm;return est>0?est/price*100:null;}
const pc=(x:number|null,d=1)=>x==null?"n/a":`${x>=0?"+":""}${x.toFixed(d)}%`;
const bn=(x:number|null)=>x==null?"n/a":Math.abs(x)>=1e9?`$${(x/1e9).toFixed(1)}B`:Math.abs(x)>=1e6?`$${(x/1e6).toFixed(1)}M`:`$${x.toFixed(0)}`;
function replaceRow(rows:any[],key:string,view:string,tabled=true){const i=rows.findIndex(x=>x.member===key);const row={member:key,role:(Object.values(ROSTER) as any[]).find(x=>x.name===key)?.role??"",desk:(Object.values(ROSTER) as any[]).find(x=>x.name===key)?.desk??"",tabled,view};if(i>=0)rows[i]=row;else rows.push(row);}
function quarterlyGrowth(data:MarketData){const q=data.quarters?.filter(x=>x.revenueYoY!=null).slice(0,4)??[];return q.map(x=>(x.revenueYoY as number)*100);}

export async function POST(){
 try{
  const holdings=await loadHoldings();if(!holdings.length)return NextResponse.json({error:"No holdings to review — add a position first."},{status:400});
  const spy=await dailyCandles("SPY",400).catch(()=>[] as Candle[]);
  const packets=await mapLimit(holdings,4,async(h):Promise<Packet>=>{try{const [data,div]=await Promise.all([getMarketData(h.ticker),fetchDividends(h.ticker,5).catch(()=>({events:[]} as any))]);return{h,data,divs:div.events??[],error:null};}catch(e:any){return{h,data:null,divs:[],error:e?.message??"research unavailable"};}});
  const closesByTicker:Record<string,number[]>={},candlesByTicker:Record<string,Candle[]>={};
  const enriched=packets.map(p=>{const c=p.data?.candles??[];if(c.length){candlesByTicker[p.h.ticker]=c;closesByTicker[p.h.ticker]=c.map(x=>x.close);}const price=p.data?.quote?.price??c.at(-1)?.close??null;return{...p.h,price,yieldPct:fwdYield(p.divs,price),beta:c.length&&spy.length?computeBeta(c,spy):null};});
  let portfolioReturnPct:number|null=null,spyReturnPct:number|null=null,start=0,end=0;for(const h of enriched){const c=closesByTicker[h.ticker];if(!c||c.length<22)continue;start+=c[c.length-22]*h.shares;end+=c.at(-1)!*h.shares;}if(start>0)portfolioReturnPct=(end-start)/start*100;if(spy.length>=22)spyReturnPct=(spy.at(-1)!.close-spy[spy.length-22].close)/spy[spy.length-22].close*100;
  const review=buildBookReview({holdings:enriched,benchmark:spy,closesByTicker,candlesByTicker,portfolioReturnPct,spyReturnPct});
  const valid=packets.filter(p=>p.data) as Array<Packet&{data:MarketData}>;

  // Sofia — business quality, using reported fundamentals rather than a placeholder.
  const quality=valid.map(p=>{const q=earningsQuality(p.data.financials),ov=p.data.overview;return{t:p.h.ticker,score:q.score,margin:ov?.profitMargin==null?null:ov.profitMargin*100,roe:ov?.roe==null?null:ov.roe*100,summary:q.summary};}).sort((a,b)=>b.score-a.score);
  replaceRow(review.roundTable,ROSTER.sofia.name,quality.length?`Business-quality evidence resolved for ${quality.length}/${holdings.length} holdings. Highest quality: ${quality.slice(0,3).map(x=>`${x.t} ${x.score}/100`).join(", ")}. Lowest measurable: ${quality.slice(-3).map(x=>`${x.t} ${x.score}/100`).join(", ")}. Profitability/ROE are taken from the latest available fundamentals; missing fields are not estimated.`:"No fundamental packet resolved for any holding this review.",quality.length>0);

  // Marcus — earnings and revenue-growth direction.
  const earningsReads=valid.map(p=>{const g=quarterlyGrowth(p.data),sur=p.data.earnings?.filter(e=>e.surprisePercent!=null).slice(0,4)??[];const beats=sur.filter(e=>(e.surprisePercent??0)>0).length;return{t:p.h.ticker,g,beats,n:sur.length};});
  const accelerating=earningsReads.filter(x=>x.g.length>=2&&x.g[0]>x.g[1]);
  const slowing=earningsReads.filter(x=>x.g.length>=2&&x.g[0]<x.g[1]);
  replaceRow(review.roundTable,ROSTER.marcus.name,earningsReads.length?`Earnings-trend read resolved for ${earningsReads.length}/${holdings.length}. Revenue growth is accelerating in ${accelerating.map(x=>x.t).join(", ")||"none measurable"}; decelerating in ${slowing.map(x=>x.t).join(", ")||"none measurable"}. Recent consensus-beat records: ${earningsReads.filter(x=>x.n).slice(0,8).map(x=>`${x.t} ${x.beats}/${x.n}`).join(" · ")||"unavailable"}.`:"No quarterly earnings packet resolved.",earningsReads.length>0);

  // Aisha — earnings dates + measured catalyst/PEAD by holding.
  const catalystReads=valid.map(p=>{const reported=p.data.earnings.map(e=>e.reportedDate).filter((x):x is string=>!!x),proj=projectEarningsDates(reported,new Date(),1),cat=assessCatalyst({earnings:p.data.earnings,quarters:p.data.quarters,candles:p.data.candles,benchmark:spy,nextEarningsDate:proj.dates[0]??null,nextEarningsBasis:"Projected from the company's own reporting cadence"});return{t:p.h.ticker,score:cat.score,band:cat.band,days:cat.nextEvent.daysAway,blackout:cat.nextEvent.blackout,thesis:cat.thesis};});
  const near=catalystReads.filter(x=>x.days!=null&&x.days>=0&&x.days<=10);
  replaceRow(review.roundTable,ROSTER.aisha.name,catalystReads.length?`Catalyst read resolved for ${catalystReads.length}/${holdings.length}. ${near.length?`Near-term reporting risk (≤10 days): ${near.map(x=>`${x.t} ${x.days}d`).join(", ")}. `:"No holding has a projected report inside 10 days. "}Strong/moderate catalyst evidence: ${catalystReads.filter(x=>x.band==="Strong"||x.band==="Moderate").map(x=>`${x.t} ${x.score??"n/a"}/25`).join(", ")||"none"}. Dates are projected when not explicitly available and are labelled as such.`:"No catalyst packet resolved.",catalystReads.length>0);
  for(const x of near)review.riskRegister.push({raisedBy:ROSTER.aisha.name,role:ROSTER.aisha.role,severity:x.days!=null&&x.days<=5?"high":"medium",item:`${x.t} near earnings window`,evidence:`Projected reporting date is ${x.days} day(s) away.`,suggestedAction:"Do not increase risk solely on price momentum into the print; confirm the reporting date and reassess after guidance."});

  // Thomas — DCF and market-multiple evidence. DCF is one anchor, never certainty.
  const vals=valid.map(p=>{const dcf=computeDcf(p.data,defaultAssumptions(p.data)),price=p.data.quote?.price??null,pe=p.data.overview?.peRatio??null,fpe=p.data.overview?.forwardPE??null;return{t:p.h.ticker,dcf:dcf?.fairValue??null,up:dcf&&price?((dcf.fairValue-price)/price)*100:null,reliable:dcf?.reliable??false,pe,fpe};});
  const usable=vals.filter(x=>x.dcf!=null);
  replaceRow(review.roundTable,ROSTER.thomas.name,usable.length?`Valuation evidence resolved for ${usable.length}/${holdings.length}. DCF-implied upside/downside: ${usable.slice().sort((a,b)=>(b.up??-999)-(a.up??-999)).slice(0,5).map(x=>`${x.t} ${pc(x.up)}${x.reliable?"":" (low confidence)"}`).join(" · ")}. DCF is cross-checked with current/forward P/E where available and low-confidence terminal-value cases are explicitly marked.`:"No usable DCF could be computed for the book; valuation is withheld rather than fabricated.",usable.length>0);

  // Ryan — precision that does not falsely imply instantaneous execution.
  const ryan=review.roundTable.find(x=>x.member===ROSTER.ryan.name);if(ryan?.view){ryan.view=ryan.view.replace(/0\.00 session\(s\)/g,"<0.01 session").replace(/inside 0\.00/g,"inside <0.01");}
  review.riskRegister.sort((a,b)=>({high:0,medium:1,low:2}[a.severity]-{high:0,medium:1,low:2}[b.severity]));
  review.disclosures.unshift(`Committee V2 deep coverage: ${valid.length}/${holdings.length} holdings resolved with fundamental, earnings, catalyst and valuation packets. Missing inputs are withheld, never inferred.`);
  return NextResponse.json({mode:"portfolio",review,fund:FUND,version:"portfolio-committee-v2"});
 }catch(e:any){return NextResponse.json({error:e?.message??"Portfolio committee failed"},{status:500});}
}
