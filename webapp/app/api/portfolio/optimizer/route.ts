import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getLightQuote } from "@/lib/marketData";
import { openOnly } from "@/lib/openPositions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESERVES = new Set(["SGOV","BIL","SHV","USFR","TFLO","ICSH","JPST","JAAA"]);
const MAX_SINGLE_NAME_PCT = 20;
const REVIEW_SINGLE_NAME_PCT = 15;

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    const [{ data, error }, bufferRes] = await Promise.all([
      sb.from("holdings").select("ticker,shares,avg_cost,closed_at"),
      fetch(new URL("/api/portfolio/cash-buffer", req.nextUrl.origin), { cache: "no-store" }),
    ]);
    if (error) throw new Error(error.message);
    const buffer = await bufferRes.json();
    if (!bufferRes.ok) throw new Error(buffer.error || "Cash buffer analysis unavailable");
    if (!buffer.verified || buffer.totalNav == null) {
      return NextResponse.json({ version:"v8.3", status:"BLOCKED", reason:"Portfolio prices are incomplete.", missingPrices:buffer.missingPrices ?? [], proposals:[] });
    }

    const holdings = openOnly((data ?? []) as any[])
      .map((h:any)=>({ ticker:String(h.ticker).toUpperCase(), shares:Number(h.shares), avgCost:Number(h.avg_cost) }))
      .filter((h:any)=>Number.isFinite(h.shares)&&h.shares>0);
    const quotes = await Promise.all(holdings.map(async h=>[h.ticker,await getLightQuote(h.ticker).catch(()=>null)] as const));
    const quoteMap = new Map(quotes);
    const positions = holdings.flatMap(h=>{
      const price=Number(quoteMap.get(h.ticker)?.price);
      if(!Number.isFinite(price)||price<=0) return [];
      const marketValue=h.shares*price;
      const weightPct=marketValue/buffer.totalNav*100;
      return [{...h,price,marketValue,weightPct,isReserve:RESERVES.has(h.ticker)}];
    });

    const proposals:any[]=[];
    for(const p of positions.filter(x=>!x.isReserve)){
      if(p.weightPct>MAX_SINGLE_NAME_PCT){
        proposals.push({ticker:p.ticker,action:"TRIM REVIEW",priority:"HIGH",currentWeightPct:p.weightPct,targetWeightPct:MAX_SINGLE_NAME_PCT,capitalUsd:(p.weightPct-MAX_SINGLE_NAME_PCT)/100*buffer.totalNav,reason:`Position exceeds the ${MAX_SINGLE_NAME_PCT}% hard single-name cap.`});
      }else if(p.weightPct>REVIEW_SINGLE_NAME_PCT){
        proposals.push({ticker:p.ticker,action:"HOLD / REVIEW",priority:"MEDIUM",currentWeightPct:p.weightPct,targetWeightPct:REVIEW_SINGLE_NAME_PCT,capitalUsd:0,reason:`Position is above the ${REVIEW_SINGLE_NAME_PCT}% concentration review threshold but below the hard cap.`});
      }else{
        proposals.push({ticker:p.ticker,action:"HOLD",priority:"NORMAL",currentWeightPct:p.weightPct,targetWeightPct:null,capitalUsd:0,reason:"Within portfolio concentration policy."});
      }
    }

    if(buffer.posture==="UNDERFUNDED"){
      proposals.unshift({ticker:"LIQUIDITY",action:"RAISE BUFFER",priority:"CRITICAL",currentWeightPct:buffer.bufferPct,targetWeightPct:buffer.targetPct,capitalUsd:Math.abs(buffer.gapValue ?? 0),reason:"Liquidity reserve is below the market-regime policy floor. New risk deployment is blocked until the buffer is rebuilt."});
    }else if(buffer.posture==="OVERFUNDED"){
      proposals.unshift({ticker:"OPPORTUNITY PIPELINE",action:"DEPLOY EXCESS",priority:"MEDIUM",currentWeightPct:buffer.bufferPct,targetWeightPct:buffer.targetPct,capitalUsd:Math.max(0,buffer.gapValue ?? 0),reason:"Liquidity exceeds the policy band. Deploy only into committee-approved opportunities; reserve instruments are not automatic sell candidates."});
    }else{
      proposals.unshift({ticker:"LIQUIDITY",action:"MAINTAIN",priority:"NORMAL",currentWeightPct:buffer.bufferPct,targetWeightPct:buffer.targetPct,capitalUsd:0,reason:"Liquidity is inside the regime-adjusted policy band."});
    }

    const blockers:string[]=[];
    if(buffer.posture==="UNDERFUNDED") blockers.push("New risk positions blocked until liquidity reaches the policy floor.");
    if(positions.some(p=>p.weightPct>MAX_SINGLE_NAME_PCT)) blockers.push("At least one risk position exceeds the hard single-name cap.");

    return NextResponse.json({
      version:"v8.3",
      status:blockers.length?"REVIEW_REQUIRED":"READY",
      asOf:new Date().toISOString(),
      policy:{maxSingleNamePct:MAX_SINGLE_NAME_PCT,reviewSingleNamePct:REVIEW_SINGLE_NAME_PCT,reserveTickers:[...RESERVES],automaticExecution:false},
      portfolio:{nav:buffer.totalNav,bufferPct:buffer.bufferPct,targetBufferPct:buffer.targetPct,regime:buffer.regime?.classification,positions:positions.length,riskPositions:positions.filter(p=>!p.isReserve).length,reservePositions:positions.filter(p=>p.isReserve).length},
      blockers,
      proposals:proposals.sort((a,b)=>({CRITICAL:4,HIGH:3,MEDIUM:2,NORMAL:1}[b.priority as "CRITICAL"]??0)-({CRITICAL:4,HIGH:3,MEDIUM:2,NORMAL:1}[a.priority as "CRITICAL"]??0)),
      note:"Decision support only. Optimizer proposals require investment committee approval and human execution.",
    },{headers:{"Cache-Control":"no-store"}});
  }catch(error:any){
    return NextResponse.json({error:error?.message??"Portfolio optimizer failed."},{status:500});
  }
}
