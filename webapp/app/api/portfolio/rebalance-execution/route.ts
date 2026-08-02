import {NextRequest,NextResponse} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

type Action="OPEN NEW"|"ADD EXISTING"|"TRIM"|"EXIT";
type Item={ticker:string;action:Action;amount:number;weight?:number|null;currentPrice?:number|null;reason?:string;source?:string};
const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
const cleanTicker=(v:unknown)=>String(v??"").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,"").slice(0,12);
const validAction=(v:unknown):v is Action=>["OPEN NEW","ADD EXISTING","TRIM","EXIT"].includes(String(v));
const code=()=>`RB-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-6)}`;

export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));
 if(body?.humanApproved!==true)return NextResponse.json({error:"Human approval is required before a rebalance package can be submitted."},{status:400});
 const raw=Array.isArray(body?.items)?body.items:[];
 const items:Item[]=raw.map((x:any)=>({ticker:cleanTicker(x?.ticker),action:String(x?.action) as Action,amount:Math.abs(n(x?.amount)),weight:x?.weight==null?null:n(x.weight),currentPrice:x?.currentPrice==null?null:n(x.currentPrice),reason:String(x?.reason??""),source:String(x?.source??"COMMITTEE")})).filter(x=>x.ticker&&validAction(x.action)&&(x.amount>0||x.action==="EXIT"));
 if(!items.length)return NextResponse.json({error:"No approved rebalance items were supplied."},{status:400});
 const reserveTicker=cleanTicker(body?.reserveTicker)||"SGOV";
 const deployable=Math.max(0,n(body?.deployable));
 const buys=items.filter(x=>x.action==="OPEN NEW"||x.action==="ADD EXISTING");
 const sells=items.filter(x=>x.action==="TRIM"||x.action==="EXIT");
 const required=buys.reduce((s,x)=>s+x.amount,0);
 const proceeds=sells.reduce((s,x)=>s+x.amount,0);
 const reserveNeeded=Math.max(0,required-proceeds);
 if(reserveNeeded>deployable+0.01)return NextResponse.json({error:`Funding gap: required $${required.toFixed(2)}, approved sales $${proceeds.toFixed(2)}, deployable reserve $${deployable.toFixed(2)}.`},{status:409});
 const fundingLeg:Item[]=(reserveNeeded>0&&!sells.some(x=>x.ticker===reserveTicker))?[{ticker:reserveTicker,action:"TRIM",amount:reserveNeeded,reason:`Funding source for approved rebalance package`,source:"AUTO FUNDING"}]:[];
 const ordered=[...sells,...fundingLeg,...buys].map((x,index)=>({...x,sequence:index+1,side:x.action==="OPEN NEW"||x.action==="ADD EXISTING"?"BUY":"SELL",status:"READY"}));
 const packageId=code();
 const meetingCode=String(body?.meetingCode??packageId);
 const executionMode=String(process.env.REBALANCE_EXECUTION_MODE??"ticket").toLowerCase();
 const webhook=String(process.env.REBALANCE_EXECUTION_WEBHOOK??"").trim();
 const packagePayload={packageId,meetingCode,status:"READY_FOR_EXECUTION",executionMode,createdAt:new Date().toISOString(),humanApprovedBy:String(body?.humanApprovedBy??"portfolio_owner"),funding:{requiredUsd:required,approvedSaleUsd:proceeds,reserveUsd:reserveNeeded,balanceUsd:proceeds+reserveNeeded-required,reserveTicker},items:ordered};
 let external:any=null;
 if(executionMode==="live"){
  if(!webhook)return NextResponse.json({error:"Live execution is enabled but REBALANCE_EXECUTION_WEBHOOK is not configured."},{status:503});
  const r=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json","Authorization":process.env.REBALANCE_EXECUTION_TOKEN?`Bearer ${process.env.REBALANCE_EXECUTION_TOKEN}`:""},body:JSON.stringify(packagePayload),cache:"no-store"});
  const text=await r.text();
  let parsed:any={};try{parsed=text?JSON.parse(text):{}}catch{parsed={message:text.slice(0,500)}}
  if(!r.ok)return NextResponse.json({error:parsed?.error??`Execution webhook returned ${r.status}`,package:packagePayload},{status:502});
  external=parsed;packagePayload.status="SUBMITTED";
 }
 const memoryResponse=await fetch(new URL("/api/committee-memory",req.nextUrl.origin),{method:"POST",headers:{"Content-Type":"application/json","Cookie":req.headers.get("cookie")??""},body:JSON.stringify({meetingCode,status:packagePayload.status,summary:{packageId,executionMode,humanApproved:true,funding:packagePayload.funding},resolution:ordered,portfolioBefore:body?.portfolioBefore??{},macro:body?.macro??{},learning:{executionPackage:true}}),cache:"no-store"}).catch(()=>null);
 const memory=memoryResponse?await memoryResponse.json().catch(()=>null):null;
 return NextResponse.json({ok:true,package:packagePayload,external,memory:memory?.meeting??null,message:executionMode==="live"?"Rebalance package submitted to the execution service.":"Rebalance package created as execution-ready tickets. Set REBALANCE_EXECUTION_MODE=live and configure the execution webhook to route orders to a broker."});
}
