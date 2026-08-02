import {NextRequest,NextResponse} from "next/server";
import {runFactorDiscovery,ENGINE_UNIVERSES,type FactorMode} from "@/lib/factorDiscovery";
import {universeForSector} from "@/lib/sectorUniverse";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

const MODES:FactorMode[]=["momentum","growth","quality","value","dividend","institutional","ai","multifactor"];

export async function GET(req:NextRequest){
 const rawMode=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase() as FactorMode;
 const mode=MODES.includes(rawMode)?rawMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const top=Math.min(20,Math.max(1,Number(req.nextUrl.searchParams.get("top")??10)||10));
 const rawTickers=req.nextUrl.searchParams.get("tickers");
 const explicit=rawTickers?rawTickers.split(",").map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z.\-]{1,10}$/.test(x)).slice(0,40):[];
 if(rawTickers&&!explicit.length)return NextResponse.json({error:"No valid ticker symbols supplied."},{status:400});
 try{
  const sectorUniverse=sector==="All"?[]:universeForSector(sector);
  const universe=explicit.length?explicit:sectorUniverse.length?sectorUniverse:ENGINE_UNIVERSES[mode];
  const result=await runFactorDiscovery(mode,universe,top);
  return NextResponse.json({...result,sector,universeSource:explicit.length?"explicit":sectorUniverse.length?"sector":`${mode}-engine`},{headers:{"Cache-Control":"no-store"}});
 }catch(e:any){return NextResponse.json({error:e?.message??"Alpha discovery failed",mode,sector},{status:500})}
}
