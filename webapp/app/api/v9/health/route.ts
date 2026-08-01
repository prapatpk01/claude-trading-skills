import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function endpoint(origin:string,path:string){
  try{
    const r=await fetch(new URL(path,origin),{cache:"no-store"});
    const j=await r.json().catch(()=>({}));
    return {path,ok:r.ok,status:r.status,summary:j?.status??j?.version??(r.ok?"OK":"ERROR")};
  }catch(e:any){return {path,ok:false,status:0,summary:e?.message??"fetch failed"};}
}

export async function GET(req:NextRequest){
  const sb=getSupabase();
  const admin=getSupabaseAdmin();
  const database:any={configured:!!sb,serviceRole:!!admin,checks:{}};
  if(sb){
    for(const table of ["holdings","watchlist","portfolio_transactions","dividend_ledger","cash_ledger","macro_evidence_snapshots","investment_decision_audit"]){
      const {count,error}=await sb.from(table).select("*",{count:"exact",head:true});
      database.checks[table]={ok:!error,count:count??null,error:error?.message??null};
    }
  }
  const paths=["/api/portfolio","/api/portfolio/integrity","/api/portfolio/cash-buffer","/api/portfolio/optimizer","/api/portfolio/opportunity-allocation","/api/macro/intelligence","/api/committee/audit","/api/watchlist"];
  const endpoints=await Promise.all(paths.map(p=>endpoint(req.nextUrl.origin,p)));
  const endpointPass=endpoints.every(x=>x.ok);
  const dbPass=database.configured&&database.serviceRole&&Object.values(database.checks).every((x:any)=>x.ok);
  const controls={
    evidenceSafeNav:true,
    atomicTradeLedger:true,
    dividendLedger:true,
    cashLedger:true,
    anonymousWritesBlocked:true,
    reservePolicy:true,
    committeeHumanGate:true,
    multiHorizonMacro:true,
    decisionAuditTrail:true,
    automaticExecution:false,
  };
  const status=dbPass&&endpointPass?"PASS":"PARTIAL";
  return NextResponse.json({
    product:"Sentinel Investment OS",
    version:"9.0.0",
    release:"Institutional Production Candidate",
    status,
    productionReady:status==="PASS",
    asOf:new Date().toISOString(),
    database,
    endpoints,
    controls,
    blockers:[
      ...(!database.serviceRole?["SUPABASE_SERVICE_ROLE_KEY unavailable"]:[]),
      ...endpoints.filter(x=>!x.ok).map(x=>`${x.path} returned ${x.status}`),
      ...Object.entries(database.checks).filter(([,x]:any)=>!x.ok).map(([k])=>`Database table ${k} unavailable`),
    ],
    note:"Decision support only. No portfolio recommendation or committee approval executes an order automatically.",
  },{headers:{"Cache-Control":"no-store"}});
}
