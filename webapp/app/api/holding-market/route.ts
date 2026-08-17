import { NextRequest, NextResponse } from "next/server";
import { dailyCandlesWithFallback, getLightQuote } from "@/lib/marketData";
import { buildHoldingMarketItem, uniqueMarketTickers } from "@/lib/holdingMarketModel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function mapLimit<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>):Promise<R[]>{
  const out=new Array<R>(items.length);let next=0;
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const i=next++;if(i>=items.length)break;out[i]=await fn(items[i]);}});
  await Promise.all(workers);return out;
}

export async function GET(req:NextRequest){
  const raw=req.nextUrl.searchParams.get("tickers")??"";
  const tickers=uniqueMarketTickers(raw.split(","),30);
  if(!tickers.length)return NextResponse.json({items:{},failed:[],partial:[]});

  const rows=await mapLimit(tickers,3,async ticker=>{
    try{
      const history=await dailyCandlesWithFallback(ticker,460);
      // A quote-only retry is deferred until history is genuinely unavailable.
      // With normal history the last daily close supplies the monitor price,
      // cutting provider traffic in half for Holdings + Watchlist.
      const quote=history.candles.length?null:await getLightQuote(ticker).catch(()=>null);
      return {ticker,data:buildHoldingMarketItem(history.candles,quote,history.source,history.warnings)};
    }catch(error){
      const warning=error instanceof Error?error.message:"Market intelligence failed";
      return {ticker,data:buildHoldingMarketItem([],null,null,[warning])};
    }
  });
  const items=Object.fromEntries(rows.map(row=>[row.ticker,row.data]));
  const failed=rows.filter(row=>row.data.dataQuality.status==="UNAVAILABLE").map(row=>row.ticker);
  const partial=rows.filter(row=>row.data.dataQuality.status==="PARTIAL").map(row=>row.ticker);
  return NextResponse.json({items,failed,partial,requested:tickers.length,complete:tickers.length-failed.length-partial.length},{headers:{"Cache-Control":"no-store, max-age=0"}});
}
