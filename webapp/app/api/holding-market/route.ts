import { NextRequest, NextResponse } from "next/server";
import { dailyCandles, getLightQuote } from "@/lib/marketData";
import { computePortfolioTechnicalOverlay } from "@/lib/portfolioTechnicalOverlay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ChartRange = "1M" | "3M" | "6M" | "YTD" | "1Y";

async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length);let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)break;out[i]=await fn(items[i]);}});
  await Promise.all(workers);return out;
}

function pct(from:number|null,to:number|null){return from!=null&&to!=null&&from>0?((to-from)/from)*100:null;}
function sample<T>(xs:T[],max=32){if(xs.length<=max)return xs;const step=(xs.length-1)/(max-1);return Array.from({length:max},(_,i)=>xs[Math.round(i*step)]);}
function rangePayload(rows:Array<{date:string;close:number}>,price:number|null){
  const series=sample(rows.filter(r=>Number.isFinite(r.close)&&r.close>0),36);
  const start=series[0]?.close??null;
  return {series,changePct:pct(start,price)};
}

export async function GET(req:NextRequest){
  const raw=req.nextUrl.searchParams.get("tickers")??"";
  const tickers=Array.from(new Set(raw.split(",").map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z.\-]{1,10}$/.test(x)))).slice(0,30);
  if(!tickers.length)return NextResponse.json({items:{}});

  const rows=await mapLimit(tickers,5,async ticker=>{
    try{
      const [candles,quote]=await Promise.all([dailyCandles(ticker,460).catch(()=>[]),getLightQuote(ticker).catch(()=>null)]);
      if(!candles.length&&!quote)return {ticker,data:null};
      const price=quote?.price??candles.at(-1)?.close??null;
      const closes=candles.map(c=>c.close).filter(x=>Number.isFinite(x)&&x>0);
      const wFrom=closes.length>=6?closes.at(-6)!:closes.length>=2?closes[0]:null;
      const change1w=pct(wFrom,price);
      const nowYear=new Date().getUTCFullYear();
      let ytd=candles.filter(c=>new Date(c.date+"T00:00:00Z").getUTCFullYear()===nowYear);
      if(!ytd.length)ytd=candles.slice(-Math.min(120,candles.length));
      const asSeries=(rows:typeof candles)=>rows.map(c=>({date:c.date,close:c.close}));
      const ranges:Record<ChartRange,{series:Array<{date:string;close:number}>;changePct:number|null}>={
        "1M":rangePayload(asSeries(candles.slice(-Math.min(21,candles.length))),price),
        "3M":rangePayload(asSeries(candles.slice(-Math.min(63,candles.length))),price),
        "6M":rangePayload(asSeries(candles.slice(-Math.min(126,candles.length))),price),
        "YTD":rangePayload(asSeries(ytd),price),
        "1Y":rangePayload(asSeries(candles.slice(-Math.min(252,candles.length))),price),
      };
      const year=candles.slice(-Math.min(252,candles.length));
      const low52=year.length?Math.min(...year.map(c=>c.low)):null;
      const high52=year.length?Math.max(...year.map(c=>c.high)):null;
      const pos52=price!=null&&low52!=null&&high52!=null&&high52>low52?Math.max(0,Math.min(100,(price-low52)/(high52-low52)*100)):null;
      const technicalOverlay=computePortfolioTechnicalOverlay(candles);
      return {ticker,data:{
        price,change1w,
        ytdChangePct:ranges.YTD.changePct,
        ytdSeries:ranges.YTD.series,
        chartRanges:ranges,
        low52,high52,pos52,technicalOverlay,
        asOf:quote?.asOf??candles.at(-1)?.date??null,
      }};
    }catch{return {ticker,data:null};}
  });
  return NextResponse.json({items:Object.fromEntries(rows.map(r=>[r.ticker,r.data]))},{headers:{"Cache-Control":"no-store, max-age=0"}});
}
