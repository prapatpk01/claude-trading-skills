import {NextRequest,NextResponse} from "next/server";
import {getSupabase,getSupabaseAdmin} from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type PerformanceRow=Record<string,any>;
const memoryLedger:PerformanceRow[]=[];
const table="research_engine_performance";

function summarize(rows:PerformanceRow[]){
 const closed=rows.filter(row=>["WON","LOST","EXPIRED"].includes(String(row.status)));
 const wins=closed.filter(row=>String(row.status)==="WON").length;
 const losses=closed.filter(row=>String(row.status)==="LOST").length;
 const returns=closed.map(row=>Number(row.realized_return_pct)).filter(Number.isFinite);
 return{
  total:rows.length,open:rows.filter(row=>String(row.status)==="OPEN").length,closed:closed.length,wins,losses,
  winRatePct:closed.length?Number((wins/closed.length*100).toFixed(1)):null,
  averageReturnPct:returns.length?Number((returns.reduce((sum,value)=>sum+value,0)/returns.length).toFixed(2)):null,
  tp1Hits:rows.filter(row=>Boolean(row.tp1_hit)).length,tp2Hits:rows.filter(row=>Boolean(row.tp2_hit)).length,stopHits:rows.filter(row=>Boolean(row.stop_hit)).length,
 };
}

export async function GET(req:NextRequest){
 const engineId=String(req.nextUrl.searchParams.get("engineId")??"").trim();
 const sb=getSupabase();
 if(sb){
  let query=sb.from(table).select("*").order("proposed_at",{ascending:false});
  if(engineId)query=query.eq("engine_id",engineId);
  const {data,error}=await query;
  if(!error){const rows=data??[];return NextResponse.json({rows,summary:summarize(rows),backend:"supabase"},{headers:{"Cache-Control":"no-store"}})}
 }
 const rows=engineId?memoryLedger.filter(row=>row.engine_id===engineId):memoryLedger;
 return NextResponse.json({rows,summary:summarize(rows),backend:"memory"},{headers:{"Cache-Control":"no-store"}});
}

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));
 const engineId=String(body.engineId??body.engine_id??"").trim();
 const ticker=String(body.ticker??"").trim().toUpperCase();
 const pickId=String(body.pickId??body.pick_id??"").trim();
 if(!engineId||!pickId||!/^[A-Z.\-]{1,10}$/.test(ticker))return NextResponse.json({error:"engineId, pickId and ticker are required."},{status:400});
 const row={
  engine_id:engineId,pick_id:pickId,ticker,proposed_at:body.proposedAt??body.proposed_at??new Date().toISOString(),horizon_days:Number(body.horizonDays??body.horizon_days??30),
  entry_low:body.entryLow??body.entry_low??null,entry_high:body.entryHigh??body.entry_high??null,stop_loss:body.stopLoss??body.stop_loss??null,target1:body.target1??null,target2:body.target2??null,
  status:String(body.status??"OPEN"),entry_price:body.entryPrice??null,exit_price:body.exitPrice??null,max_gain_pct:body.maxGainPct??null,max_drawdown_pct:body.maxDrawdownPct??null,realized_return_pct:body.realizedReturnPct??null,
  tp1_hit:Boolean(body.tp1Hit??false),tp2_hit:Boolean(body.tp2Hit??false),stop_hit:Boolean(body.stopHit??false),closed_at:body.closedAt??null,outcome_reason:body.outcomeReason??null,metadata:body.metadata??{},updated_at:new Date().toISOString(),
 };
 const admin=getSupabaseAdmin();
 if(admin){
  const {data,error}=await admin.from(table).upsert(row,{onConflict:"pick_id"}).select("*").single();
  if(!error)return NextResponse.json({row:data,backend:"supabase"});
 }
 const index=memoryLedger.findIndex(item=>item.pick_id===pickId);
 if(index>=0)memoryLedger[index]={...memoryLedger[index],...row};else memoryLedger.push(row);
 return NextResponse.json({row,backend:"memory"});
}
