import {NextResponse} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const revalidate=0;

type Point={date:string;value:number};
const finite=(v:unknown):number|null=>{const n=Number(v);return Number.isFinite(n)?n:null};

async function yahoo(symbol:string,range="6mo",interval="1d"){
 const url=`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
 const r=await fetch(url,{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0"}});
 if(!r.ok)throw new Error(`Yahoo ${symbol} ${r.status}`);
 const j=await r.json();const x=j?.chart?.result?.[0];const ts=x?.timestamp??[];const close=x?.indicators?.quote?.[0]?.close??[];
 const points:Point[]=ts.map((t:number,i:number)=>({date:new Date(t*1000).toISOString().slice(0,10),value:finite(close[i])})).filter((p:any)=>p.value!=null);
 return{symbol,points,last:points.at(-1)?.value??null};
}

async function fred(series:string){
 const url=`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`;
 const r=await fetch(url,{cache:"no-store",headers:{"User-Agent":"Mozilla/5.0"}});if(!r.ok)throw new Error(`FRED ${series} ${r.status}`);
 const text=await r.text();const rows=text.trim().split(/\r?\n/).slice(1).map(line=>{const [date,raw]=line.split(",");const value=finite(raw);return value==null?null:{date,value}}).filter(Boolean) as Point[];
 return{series,points:rows.slice(-24),last:rows.at(-1)?.value??null};
}

function sentiment(spy:Point[],qqq:Point[],vix:Point[]){
 const ret=(p:Point[],days:number)=>p.length>days&&p[p.length-days-1].value>0?(p.at(-1)!.value/p[p.length-days-1].value-1)*100:0;
 const v=vix.at(-1)?.value??20;
 const score=Math.max(0,Math.min(100,50+ret(spy,20)*2+ret(qqq,20)*1.5-(v-20)*1.8));
 const dates=spy.slice(-90).map((p,i)=>{const q=qqq.slice(-90)[i]?.value;const vv=vix.slice(-90)[i]?.value??20;const s0=spy.slice(-90)[0]?.value||p.value;const q0=qqq.slice(-90)[0]?.value||q||1;const s=Math.max(0,Math.min(100,50+((p.value/s0)-1)*100*1.2+(((q??q0)/q0)-1)*100-(vv-20)*1.2));return{date:p.date,value:Number(s.toFixed(1))}});
 return{score:Number(score.toFixed(1)),points:dates,label:score<25?"Extreme Fear":score<45?"Fear":score<56?"Neutral":score<75?"Greed":"Extreme Greed"};
}

export async function GET(){
 const results=await Promise.allSettled([yahoo("SPY"),yahoo("QQQ"),yahoo("^VIX"),fred("FEDFUNDS"),fred("CPIAUCSL"),fred("A191RL1Q225SBEA")]);
 const [spy,qqq,vix,rate,cpi,gdp]=results.map(r=>r.status==="fulfilled"?r.value:null) as any[];
 let inflation:number|null=null;
 if(cpi?.points?.length>12){const a=cpi.points.at(-1)?.value;const b=cpi.points.at(-13)?.value;if(a&&b)inflation=(a/b-1)*100}
 const sent=sentiment(spy?.points??[],qqq?.points??[],vix?.points??[]);
 return NextResponse.json({asOf:new Date().toISOString(),sentiment:sent,vix:{value:vix?.last??null,points:vix?.points?.slice(-90)??[]},economic:{policyRate:rate?.last??null,inflation:inflation==null?null:Number(inflation.toFixed(2)),gdpGrowth:gdp?.last??null,policyRateHistory:rate?.points??[],inflationHistory:cpi?.points??[],gdpHistory:gdp?.points??[]},sources:{market:"Yahoo Finance chart",economy:"FRED public CSV"}},{headers:{"Cache-Control":"no-store"}});
}
