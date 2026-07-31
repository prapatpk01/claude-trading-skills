import { NextRequest, NextResponse } from "next/server";
import { runActiveFund } from "@/lib/activeFund";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    const tickers=Array.isArray(body?.tickers)?body.tickers.map((x:any)=>String(x).toUpperCase()).filter((x:string)=>/^[A-Z.\-]{1,10}$/.test(x)).slice(0,20):[];
    const nav=typeof body?.nav==="number"&&Number.isFinite(body.nav)&&body.nav>0?body.nav:0;
    return NextResponse.json(await runActiveFund(tickers,nav));
  }catch(e:any){return NextResponse.json({error:e?.message??"Active fund review failed"},{status:500})}
}
