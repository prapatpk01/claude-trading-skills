import {NextRequest,NextResponse} from "next/server";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

type Action="OPEN NEW"|"ADD EXISTING"|"TRIM"|"EXIT";
type Item={ticker:string;action:Action;amount:number;weight?:number|null;currentPrice?:number|null;reason?:string;source?:string};
type OrderedItem=Item&{sequence:number;side:"BUY"|"SELL";status:"READY"};
type PackageStatus="READY_FOR_EXECUTION"|"SUBMITTED";
type RawItem={ticker?:unknown;action?:unknown;amount?:unknown;weight?:unknown;currentPrice?:unknown;reason?:unknown;source?:unknown};

const finiteNumber=(v:unknown):number|null=>{const value=typeof v==="number"?v:Number(v);return Number.isFinite(value)?value:null};
const cleanTicker=(v:unknown)=>String(v??"").trim().toUpperCase().replace(/[^A-Z0-9.\-]/g,"").slice(0,12);
const validAction=(v:unknown):v is Action=>["OPEN NEW","ADD EXISTING","TRIM","EXIT"].includes(String(v));
const code=()=>`RB-${new Date().toISOString().slice(0,10).replaceAll("-","")}-${String(Date.now()).slice(-6)}`;

function parseItem(raw:RawItem):Item|null{
 const ticker=cleanTicker(raw.ticker);
 if(!ticker||!validAction(raw.action))return null;
 const parsedAmount=finiteNumber(raw.amount);
 const amount=parsedAmount==null?null:Math.abs(parsedAmount);
 if(raw.action!=="EXIT"&&(amount==null||amount<=0))return null;
 const weight=raw.weight==null?null:finiteNumber(raw.weight);
 const currentPrice=raw.currentPrice==null?null:finiteNumber(raw.currentPrice);
 return{
  ticker,
  action:raw.action,
  amount:amount??0,
  weight,
  currentPrice,
  reason:String(raw.reason??""),
  source:String(raw.source??"COMMITTEE"),
 };
}

export async function POST(req:NextRequest){
 let body:Record<string,unknown>={};
 try{
  const parsed=await req.json();
  if(parsed&&typeof parsed==="object"&&!Array.isArray(parsed))body=parsed as Record<string,unknown>;
 }catch{
  return NextResponse.json({error:"Request body must be valid JSON."},{status:400});
 }
 if(body.humanApproved!==true)return NextResponse.json({error:"Human approval is required before a rebalance package can be submitted."},{status:400});
 const rawItems=Array.isArray(body.items)?body.items:[];
 const items:Item[]=rawItems.map(value=>parseItem((value&&typeof value==="object"?value:{}) as RawItem)).filter((value):value is Item=>value!==null);
 if(!items.length)return NextResponse.json({error:"No approved rebalance items with valid numeric evidence were supplied."},{status:400});
 const reserveTicker=cleanTicker(body.reserveTicker)||"SGOV";
 const deployableValue=finiteNumber(body.deployable);
 if(deployableValue==null||deployableValue<0)return NextResponse.json({error:"Deployable reserve must be supplied as a valid non-negative number."},{status:400});
 const deployable=deployableValue;
 const buys=items.filter(item=>item.action==="OPEN NEW"||item.action==="ADD EXISTING");
 const sells=items.filter(item=>item.action==="TRIM"||item.action==="EXIT");
 const required=buys.reduce((sum,item)=>sum+item.amount,0);
 const proceeds=sells.reduce((sum,item)=>sum+item.amount,0);
 const reserveNeeded=Math.max(0,required-proceeds);
 if(reserveNeeded>deployable+0.01)return NextResponse.json({error:`Funding gap: required $${required.toFixed(2)}, approved sales $${proceeds.toFixed(2)}, deployable reserve $${deployable.toFixed(2)}.`},{status:409});
 const fundingLeg:Item[]=(reserveNeeded>0&&!sells.some(item=>item.ticker===reserveTicker))?[{ticker:reserveTicker,action:"TRIM",amount:reserveNeeded,reason:"Funding source for approved rebalance package",source:"AUTO FUNDING"}]:[];
 const ordered:OrderedItem[]=[...sells,...fundingLeg,...buys].map((item,index)=>({...item,sequence:index+1,side:item.action==="OPEN NEW"||item.action==="ADD EXISTING"?"BUY":"SELL",status:"READY"}));
 const packageId=code();
 const meetingCode=String(body.meetingCode??packageId);
 const executionMode=String(process.env.REBALANCE_EXECUTION_MODE??"ticket").toLowerCase();
 const webhook=String(process.env.REBALANCE_EXECUTION_WEBHOOK??"").trim();
 const packagePayload:{packageId:string;meetingCode:string;status:PackageStatus;executionMode:string;createdAt:string;humanApprovedBy:string;funding:{requiredUsd:number;approvedSaleUsd:number;reserveUsd:number;balanceUsd:number;reserveTicker:string};items:OrderedItem[]}={packageId,meetingCode,status:"READY_FOR_EXECUTION",executionMode,createdAt:new Date().toISOString(),humanApprovedBy:String(body.humanApprovedBy??"portfolio_owner"),funding:{requiredUsd:required,approvedSaleUsd:proceeds,reserveUsd:reserveNeeded,balanceUsd:proceeds+reserveNeeded-required,reserveTicker},items:ordered};
 let external:unknown=null;
 if(executionMode==="live"){
  if(!webhook)return NextResponse.json({error:"Live execution is enabled but REBALANCE_EXECUTION_WEBHOOK is not configured."},{status:503});
  const response=await fetch(webhook,{method:"POST",headers:{"Content-Type":"application/json","Authorization":process.env.REBALANCE_EXECUTION_TOKEN?`Bearer ${process.env.REBALANCE_EXECUTION_TOKEN}`:""},body:JSON.stringify(packagePayload),cache:"no-store"});
  const responseText=await response.text();
  let parsed:unknown={};
  try{parsed=responseText?JSON.parse(responseText):{}}catch{parsed={message:responseText.slice(0,500)}}
  if(!response.ok){const message=parsed&&typeof parsed==="object"&&"error" in parsed?String((parsed as {error?:unknown}).error):`Execution webhook returned ${response.status}`;return NextResponse.json({error:message,package:packagePayload},{status:502});}
  external=parsed;
  packagePayload.status="SUBMITTED";
 }
 const memoryResponse=await fetch(new URL("/api/committee-memory",req.nextUrl.origin),{method:"POST",headers:{"Content-Type":"application/json","Cookie":req.headers.get("cookie")??""},body:JSON.stringify({meetingCode,status:packagePayload.status,summary:{packageId,executionMode,humanApproved:true,funding:packagePayload.funding},resolution:ordered,portfolioBefore:body.portfolioBefore??{},macro:body.macro??{},learning:{executionPackage:true}}),cache:"no-store"}).catch(()=>null);
 const memory=memoryResponse?await memoryResponse.json().catch(()=>null):null;
 const meeting=memory&&typeof memory==="object"&&"meeting" in memory?(memory as {meeting?:unknown}).meeting:null;
 return NextResponse.json({ok:true,package:packagePayload,external,memory:meeting,message:executionMode==="live"?"Rebalance package submitted to the execution service.":"Rebalance package created as execution-ready tickets. Set REBALANCE_EXECUTION_MODE=live and configure the execution webhook to route orders to a broker."});
}
