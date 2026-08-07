import { NextRequest, NextResponse } from "next/server";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";
import { memStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ENV_NAMES = ["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY","SUPABASE_SERVICE_KEY"] as const;
const STAGES = new Set(["RESEARCH","WATCH","READY","COMMITTEE","PROMOTED","REJECTED","ARCHIVED"]);
const optNum=(v:any):number|null=>{if(v===null||v===undefined||String(v).trim()==="")return null;const n=Number(v);return Number.isFinite(n)?n:null};
const cleanTicker=(v:any)=>String(v??"").trim().toUpperCase();
const cleanStage=(v:any)=>{const s=String(v??"RESEARCH").trim().toUpperCase();return STAGES.has(s)?s:null};
function missingAdminKeyResponse(){return NextResponse.json({ok:false,code:"SUPABASE_ADMIN_KEY_MISSING",error:"Secure database writes are unavailable because no privileged Supabase server key is configured in this Vercel Production deployment.",acceptedEnv:ADMIN_ENV_NAMES,action:"Add one accepted server-only key to the existing claude-trading-skills Vercel Production project, then create a new production deployment."},{status:503,headers:{"Cache-Control":"no-store, max-age=0"}})}

export async function GET(){
 const sb=getSupabase();
 if(sb){const{data,error}=await sb.from("watchlist").select("*").order("updated_at",{ascending:false});if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({watchlist:data,backend:"supabase",version:14},{headers:{"Cache-Control":"no-store"}})}
 return NextResponse.json({watchlist:memStore.watchlist,backend:"memory",version:14});
}

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));const ticker=cleanTicker(body.ticker);if(!/^[A-Z.\-]{1,10}$/.test(ticker))return NextResponse.json({error:"Enter a valid ticker symbol (e.g. NVDA)."},{status:400});
 const stage=cleanStage(body.stage);if(!stage)return NextResponse.json({error:"Invalid watchlist stage"},{status:400});
 const target=optNum(body.target_price);const now=new Date().toISOString();
 const row={ticker,reason:String(body.reason??"").trim()||null,alert_price:optNum(body.alert_price)??target,target_price:target,stop_price:optNum(body.stop_price),entry_price:optNum(body.entry_price),source:String(body.source??"").trim()||null,stage,updated_at:now,promoted_at:stage==="PROMOTED"?now:null,archived_at:stage==="ARCHIVED"?now:null};
 const sb=getSupabaseAdmin();if(!sb)return missingAdminKeyResponse();
 const{data,error}=await sb.from("watchlist").upsert(row,{onConflict:"ticker"}).select().single();if(error)return NextResponse.json({error:`Supabase: ${error.message}`},{status:500});return NextResponse.json({item:data,version:14});
}

export async function PATCH(req:NextRequest){
 const body=await req.json().catch(()=>({}));const id=String(body.id??"").trim();const ticker=cleanTicker(body.ticker);const stage=cleanStage(body.stage);if(!stage)return NextResponse.json({error:"Invalid watchlist stage"},{status:400});if(!id&&!ticker)return NextResponse.json({error:"id or ticker required"},{status:400});
 const sb=getSupabaseAdmin();if(!sb)return missingAdminKeyResponse();const now=new Date().toISOString();const patch:any={stage,updated_at:now};if(stage==="PROMOTED")patch.promoted_at=now;if(stage==="ARCHIVED")patch.archived_at=now;
 let q=sb.from("watchlist").update(patch);q=id?q.eq("id",id):q.eq("ticker",ticker);const{data,error}=await q.select().single();if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({item:data,version:14});
}

export async function DELETE(req:NextRequest){
 const id=req.nextUrl.searchParams.get("id");if(!id)return NextResponse.json({error:"id required"},{status:400});const sb=getSupabaseAdmin();if(!sb)return missingAdminKeyResponse();const{error}=await sb.from("watchlist").delete().eq("id",id);if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({ok:true,version:14});
}
