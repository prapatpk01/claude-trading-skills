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

async function internalJson(req: NextRequest, path: string) {
  const cookie = req.headers.get("cookie") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const response = await fetch(new URL(path, req.nextUrl.origin), {
    cache: "no-store",
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
      accept: "application/json",
    },
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();
  if (!contentType.includes("application/json")) {
    throw new Error(`${path} returned ${response.status} ${contentType || "non-JSON"}; preview authentication may not have been forwarded.`);
  }
  let json: any;
  try { json = body ? JSON.parse(body) : {}; }
  catch { throw new Error(`${path} returned malformed JSON.`); }
  if (!response.ok) throw new Error(json?.error ?? `${path} returned ${response.status}`);
  return json;
}

export async function GET(req: NextRequest) {
  try {
    const sb = getSupabase();
    if (!sb) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
    const [{ data, error }, buffer] = await Promise.all([
      sb.from("holdings").select("ticker,shares,avg_cost,closed_at"),
      internalJson(req, "/api/portfolio/cash-buffer"),
    ]);
    if (error) throw new Error(error.message);
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
      // Selling SGOV into USD only changes the form of the Cash Buffer; it does
      // not increase the combined sleeve. A genuine shortfall must therefore
      // be filled by retaining new cash or reducing a risk asset.
      const shortfall=Math.abs(buffer.gapValue ?? 0);
      const smallestRisk=positions.filter(p=>!p.isReserve&&p.marketValue>=shortfall).sort((a,b)=>a.marketValue-b.marketValue)[0]??null;
      const fundingPlan=smallestRisk
        ? `${smallestRisk.ticker} is the smallest risk position that can close the shortfall in one ticket.`
        : "No single risk position covers the shortfall, so Asset Management must submit a multi-line reduction plan or add external cash.";
      proposals.unshift({
        ticker:smallestRisk?.ticker??"CASH BUFFER",
        action:"RAISE BUFFER",
        priority:"CRITICAL",
        currentWeightPct:buffer.bufferPct,
        targetWeightPct:buffer.targetPct,
        capitalUsd:shortfall,
        fundingSource:smallestRisk?.ticker??null,
        proceedsDestination:"CASH BUFFER — USD or approved reserve instrument",
        reason:`Total Cash Buffer (USD plus haircut-adjusted reserves) is ${Number(buffer.bufferPct ?? 0).toFixed(1)}% against a ${buffer.targetPct}% target (${Number(buffer.targetValue ?? 0).toFixed(2)} USD), a shortfall of ${shortfall.toFixed(2)} USD. ${fundingPlan} SGOV and other approved reserves are already inside the buffer, so converting them to USD cannot close this gap. New risk deployment stays blocked until the combined floor is met.`,
      });
    }else if(buffer.posture==="OVERFUNDED"){
      proposals.unshift({
        ticker:"OPPORTUNITY PIPELINE",
        action:"DEPLOY EXCESS",
        priority:"MEDIUM",
        currentWeightPct:buffer.bufferPct,
        targetWeightPct:buffer.targetPct,
        capitalUsd:Math.max(0,buffer.gapValue ?? 0),
        fundingSource:"CASH BUFFER EXCESS — USD/reserves as needed",
        proceedsDestination:"COMMITTEE-APPROVED POSITIONS ONLY",
        reason:`Total Cash Buffer is ${Number(buffer.bufferPct ?? 0).toFixed(1)}% against a ${buffer.targetPct}% target, leaving ${Math.max(0,buffer.gapValue ?? 0).toFixed(2)} USD deployable. Use broker USD first; convert an approved reserve only to fund a named purchase. A reserve conversion is a liquidity transfer, not a buffer increase.`,
      });
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
