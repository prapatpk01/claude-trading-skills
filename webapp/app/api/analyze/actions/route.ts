import {NextRequest,NextResponse} from "next/server";
import {getSupabaseAdmin} from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type ActionRow={id:string;ticker:string;action:"WATCHLIST"|"COMMITTEE";rating:string|null;conviction:number|null;payload:Record<string,unknown>;created_at:string};
const memory:ActionRow[]=[];

const validTicker=(value:unknown)=>/^[A-Z.\-]{1,10}$/.test(String(value??"").trim().toUpperCase());

export async function GET(req:NextRequest){
 const ticker=String(req.nextUrl.searchParams.get("ticker")??"").trim().toUpperCase();
 const sb=getSupabaseAdmin();
 if(sb){
  let query=sb.from("analysis_actions").select("*").order("created_at",{ascending:false}).limit(100);
  if(ticker)query=query.eq("ticker",ticker);
  const {data,error}=await query;
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({actions:data??[],backend:"supabase"});
 }
 return NextResponse.json({actions:ticker?memory.filter(row=>row.ticker===ticker):memory,backend:"memory"});
}

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));
 const ticker=String(body.ticker??"").trim().toUpperCase();
 const action=String(body.action??"").trim().toUpperCase();
 if(!validTicker(ticker))return NextResponse.json({error:"Invalid ticker"},{status:400});
 if(action!=="WATCHLIST"&&action!=="COMMITTEE")return NextResponse.json({error:"Action must be WATCHLIST or COMMITTEE"},{status:400});
 const row={
  ticker,
  action,
  rating:body.rating?String(body.rating):null,
  conviction:Number.isFinite(Number(body.conviction))?Number(body.conviction):null,
  payload:typeof body.payload==="object"&&body.payload?body.payload:{},
 };
 const sb=getSupabaseAdmin();
 if(sb){
  const {data,error}=await sb.from("analysis_actions").insert(row).select("*").single();
  if(error)return NextResponse.json({error:error.message},{status:500});
  return NextResponse.json({action:data,backend:"supabase"},{status:201});
 }
 const created:ActionRow={id:crypto.randomUUID(),...row,action:action as "WATCHLIST"|"COMMITTEE",created_at:new Date().toISOString()};
 memory.unshift(created);
 return NextResponse.json({action:created,backend:"memory"},{status:201});
}
