import {NextRequest,NextResponse} from "next/server";
import {getSupabase,getSupabaseAdmin} from "@/lib/supabase";

export const runtime="nodejs";
export const dynamic="force-dynamic";

type MeetingStatus="APPROVED"|"PARTIALLY_EXECUTED"|"EXECUTED_WITHIN_TOLERANCE"|"MATERIAL_DEVIATION"|"SUPERSEDED"|"CANCELLED"|"CLOSED";
type MemoryRow={id:string;meeting_code:string;status:MeetingStatus;summary:any;resolution:any[];actual:any[];variance:any;portfolio_before:any;portfolio_after:any;macro:any;learning:any;created_at:string;updated_at:string};

const memory:MemoryRow[]=(globalThis as any).__sentinelCommitteeMemory??((globalThis as any).__sentinelCommitteeMemory=[]);
const now=()=>new Date().toISOString();
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:0};
const code=()=>`IC-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-6)}`;

function reconcile(resolution:any[],actual:any[]){
 const items=resolution.map((plan:any)=>{
  const ticker=String(plan.ticker??"").toUpperCase();const action=String(plan.action??"").toUpperCase();
  const matches=actual.filter((x:any)=>String(x.ticker??"").toUpperCase()===ticker&&String(x.action??"").toUpperCase()===action);
  const planned=Math.abs(num(plan.amount));const executed=matches.reduce((s:number,x:any)=>s+Math.abs(num(x.amount)),0);
  const varianceUsd=executed-planned;const variancePct=planned>0?varianceUsd/planned*100:executed===0?0:100;
  const status=executed===0?"PARTIALLY_EXECUTED":Math.abs(variancePct)<=10?"EXECUTED_WITHIN_TOLERANCE":"MATERIAL_DEVIATION";
  return{ticker,action,plannedUsd:planned,actualUsd:executed,varianceUsd,variancePct:Math.round(variancePct*10)/10,status};
 });
 const material=items.some(x=>x.status==="MATERIAL_DEVIATION");const partial=items.some(x=>x.status==="PARTIALLY_EXECUTED");
 return{items,status:material?"MATERIAL_DEVIATION":partial?"PARTIALLY_EXECUTED":"EXECUTED_WITHIN_TOLERANCE",tolerancePct:10,acceptActualAsBaseline:!material};
}

async function readRows(limit=20){
 const sb=getSupabase();
 if(sb){const{data,error}=await sb.from("committee_meetings").select("*").order("created_at",{ascending:false}).limit(limit);if(!error)return data??[];}
 return [...memory].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,limit);
}

export async function GET(req:NextRequest){
 const limit=Math.min(50,Math.max(1,Number(req.nextUrl.searchParams.get("limit")??20)));
 const rows=await readRows(limit);
 return NextResponse.json({meetings:rows,latest:rows[0]??null,retention:{workingDays:30,candidateDays:60,macroDays:90,permanent:["final resolution","active thesis","material deviation","learning aggregate"]}});
}

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));const operation=String(body.operation??"create");const admin=getSupabaseAdmin();
 if(operation==="reconcile"){
  const id=String(body.id??"");if(!id)return NextResponse.json({error:"meeting id required"},{status:400});
  const rows=await readRows(50);const row=rows.find((x:any)=>String(x.id)===id);if(!row)return NextResponse.json({error:"meeting not found"},{status:404});
  const actual=Array.isArray(body.actual)?body.actual:[];const variance=reconcile(Array.isArray(row.resolution)?row.resolution:[],actual);const patch={actual,variance,status:variance.status,portfolio_after:body.portfolioAfter??row.portfolio_after??{},updated_at:now()};
  if(admin){const{data,error}=await admin.from("committee_meetings").update(patch).eq("id",id).select().single();if(error)return NextResponse.json({error:error.message},{status:500});return NextResponse.json({meeting:data});}
  const index=memory.findIndex(x=>x.id===id);if(index>=0)memory[index]={...memory[index],...patch} as MemoryRow;return NextResponse.json({meeting:memory[index]});
 }
 const created=now();const row={meeting_code:String(body.meetingCode??code()),status:String(body.status??"APPROVED"),summary:body.summary??{},resolution:Array.isArray(body.resolution)?body.resolution:[],actual:[],variance:{status:"PENDING",tolerancePct:10},portfolio_before:body.portfolioBefore??{},portfolio_after:{},macro:body.macro??{},learning:body.learning??{},created_at:created,updated_at:created};
 if(admin){const{data,error}=await admin.from("committee_meetings").insert(row).select().single();if(error)return NextResponse.json({error:error.message,migrationRequired:/committee_meetings/i.test(error.message)},{status:500});return NextResponse.json({meeting:data});}
 const local={id:crypto.randomUUID(),...row} as MemoryRow;memory.push(local);return NextResponse.json({meeting:local,backend:"memory"});
}

export async function DELETE(){
 const cutoff=Date.now()-30*86400000;const before=memory.length;for(let i=memory.length-1;i>=0;i--){const x=memory[i];const permanent=["MATERIAL_DEVIATION","SUPERSEDED"].includes(x.status)||Boolean(x.learning&&Object.keys(x.learning).length);if(!permanent&&new Date(x.updated_at).getTime()<cutoff)memory.splice(i,1);}
 return NextResponse.json({ok:true,deleted:before-memory.length,policy:"Closed working detail older than 30 days is removed; compact resolutions, thesis changes, material deviations and learning remain."});
}
