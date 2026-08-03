import {NextRequest,NextResponse} from "next/server";
import {getSupabaseAdmin} from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

const memory:any[]=[];
const asNumber=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;

function summarize(rows:any[]){
 const completed=rows.filter(row=>["WON","LOST"].includes(row.status));
 const wins=completed.filter(row=>row.status==="WON").length;
 const returns=completed.map(row=>asNumber(row.return_pct)).filter((value):value is number=>value!=null);
 return {total:rows.length,open:rows.filter(row=>row.status==="OPEN").length,completed:completed.length,wins,losses:completed.length-wins,winRatePct:completed.length?wins/completed.length*100:null,averageReturnPct:returns.length?returns.reduce((sum,value)=>sum+value,0)/returns.length:null};
}

export async function GET(req:NextRequest){
 const ticker=String(req.nextUrl.searchParams.get("ticker")??"").trim().toUpperCase();
 const sb=getSupabaseAdmin();
 if(sb){
  let query=sb.from("analysis_performance").select("*").order("analysis_date",{ascending:false}).limit(200);
  if(ticker)query=query.eq("ticker",ticker);
  const {data,error}=await query;
  if(error)return NextResponse.json({error:error.message},{status:500});
  const rows=data??[];
  return NextResponse.json({rows,summary:summarize(rows),backend:"supabase"});
 }
 const rows=ticker?memory.filter(row=>row.ticker===ticker):memory;
 return NextResponse.json({rows,summary:summarize(rows),backend:"memory"});
}

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));
 const ticker=String(body.ticker??"").trim().toUpperCase();
 if(!/^[A-Z.\-]{1,10}$/.test(ticker))return NextResponse.json({error:"Invalid ticker"},{status:400});
 const row={ticker,analysis_date:String(body.analysis_date??new Date().toISOString().slice(0,10)),rating:String(body.rating??"HOLD"),entry_price:asNumber(body.entry_price),target_price:asNumber(body.target_price),stop_loss:asNumber(body.stop_loss),conviction:asNumber(body.conviction),status:"OPEN",return_pct:null,review_30d:null,review_90d:null,review_180d:null,review_365d:null};
 const sb=getSupabaseAdmin();
 if(sb){const {data,error}=await sb.from("analysis_performance").insert(row).select("*").single();if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({row:data,backend:"supabase"},{status:201});}
 const created={id:crypto.randomUUID(),...row,created_at:new Date().toISOString()};memory.unshift(created);return NextResponse.json({row:created,backend:"memory"},{status:201});
}
