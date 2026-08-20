import { NextRequest, NextResponse } from "next/server";
import { dailyCandlesWithFallback, getLightQuote } from "@/lib/marketData";
import { buildHoldingMarketItem, uniqueMarketTickers } from "@/lib/holdingMarketModel";
import { fastScanApprovedUniverse } from "@/lib/research/universeFastScan";
import type { Quote } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length);let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)break;out[i]=await fn(items[i]);}});
  await Promise.all(workers);return out;
}

function quoteFromFastRow(ticker:string,row:any,asOf:string|null):Quote|null{
  const price=Number(row?.price);
  if(!Number.isFinite(price)||price<=0)return null;
  return {
    symbol:ticker,
    price,
    change:0,
    changePercent:0,
    high:price,
    low:price,
    open:price,
    prevClose:price,
    asOf:asOf?.slice(0,10)??new Date().toISOString().slice(0,10),
  };
}

export async function GET(req:NextRequest){
  const raw=req.nextUrl.searchParams.get("tickers")??"";
  const tickers=uniqueMarketTickers(raw.split(","),30);
  if(!tickers.length)return NextResponse.json({items:{},failed:[],partial:[]});

  // One batch request gives a second independent price path when per-ticker
  // Yahoo chart calls are throttled. It is price fallback only; a batch price
  // never fabricates a technical overlay or Momentum Forecast without history.
  const fast=await fastScanApprovedUniverse(tickers).catch(()=>null);
  const fastByTicker=new Map((fast?.rows??[]).map(row=>[row.ticker,row]));

  const rows=await mapLimit(tickers,3,async ticker=>{
    try{
      const history=await dailyCandlesWithFallback(ticker,460);
      let quote=history.candles.length?null:await getLightQuote(ticker).catch(()=>null);
      const warnings=[...history.warnings];
      let source=history.source;
      if(!quote&&!history.candles.length){
        quote=quoteFromFastRow(ticker,fastByTicker.get(ticker),fast?.asOf??null);
        if(quote){
          source=`${fast?.provider??"multi-symbol batch"} · price fallback`;
          warnings.push("Full daily history is unavailable; current price recovered from the multi-symbol batch. Technical overlay and Momentum Forecast remain withheld until history recovers.");
        }
      }
      return {ticker,data:buildHoldingMarketItem(history.candles,quote,source,warnings)};
    }catch(error){
      const warning=error instanceof Error?error.message:"Market intelligence failed";
      const quote=quoteFromFastRow(ticker,fastByTicker.get(ticker),fast?.asOf??null);
      return {ticker,data:buildHoldingMarketItem([],quote,quote?`${fast?.provider??"multi-symbol batch"} · price fallback`:null,[warning])};
    }
  });
  const items=Object.fromEntries(rows.map(row=>[row.ticker,row.data]));
  const failed=rows.filter(row=>row.data.dataQuality.status==="UNAVAILABLE").map(row=>row.ticker);
  const partial=rows.filter(row=>row.data.dataQuality.status==="PARTIAL").map(row=>row.ticker);
  return NextResponse.json({
    items,failed,partial,requested:tickers.length,complete:tickers.length-failed.length-partial.length,
    batchFallback:{provider:fast?.provider??null,coveragePct:fast?.coveragePct??0,scanned:fast?.scanned??0},
  },{headers:{"Cache-Control":"no-store, max-age=0"}});
}
