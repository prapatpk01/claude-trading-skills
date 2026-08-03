import {NextRequest,NextResponse} from "next/server";
import {runFactorDiscovery,ENGINE_UNIVERSES,type FactorMode} from "@/lib/factorDiscovery";
import {universeForSector} from "@/lib/sectorUniverse";
import {DEFAULT_THEME,isThemeId,THEMATIC_UNIVERSES} from "@/lib/thematicUniverse";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

const FACTOR_MODES:FactorMode[]=["momentum","growth","quality","value","dividend","institutional","ai","multifactor"];
const PUBLIC_MODES=[...FACTOR_MODES,"thematic"] as const;
type PublicMode=typeof PUBLIC_MODES[number];

const finiteNumber=(v:unknown):number|null=>{const value=typeof v==="number"?v:Number(v);return Number.isFinite(value)?value:null};
const finitePositive=(v:unknown):boolean=>{const value=finiteNumber(v);return value!=null&&value>0};
function normalizeValuation(p:any){
 const price=finitePositive(p?.price)?finiteNumber(p.price):null;
 const target=finitePositive(p?.targetPrice)?finiteNumber(p.targetPrice):null;
 const expectedReturnPct=price!=null&&target!=null?((target/price)-1)*100:null;
 const valuationFailures:string[]=[];
 if(price==null)valuationFailures.push("Current price unavailable");
 if(target==null)valuationFailures.push("Target price unavailable");
 if(price!=null&&target!=null&&target<=price)valuationFailures.push("Target price is not above spot");
 if(expectedReturnPct!=null&&expectedReturnPct<8)valuationFailures.push("Expected upside below 8%");
 return {...p,price,targetPrice:target,expectedReturnPct,valuationValid:valuationFailures.length===0,valuationFailures};
}
function thematicAllocation(input:any[]){
 const eligible=input.filter(p=>p.passed&&p.valuationValid).sort((a,b)=>(finiteNumber(b.composite)??-Infinity)-(finiteNumber(a.composite)??-Infinity));
 const selected=eligible.slice(0,8);
 if(!selected.length)return[];
 const raw=selected.map(p=>Math.max(1,finiteNumber(p.composite)??1));
 const rawTotal=raw.reduce((sum,value)=>sum+value,0);
 let weights=raw.map(value=>Math.min(22,Math.max(8,value/rawTotal*100)));
 const boundedTotal=weights.reduce((sum,value)=>sum+value,0);
 weights=weights.map(value=>value/boundedTotal*100);
 const rounded=weights.map(value=>Math.round(value*10)/10);
 const drift=Math.round((100-rounded.reduce((sum,value)=>sum+value,0))*10)/10;
 if(rounded.length)rounded[0]=Math.round((rounded[0]+drift)*10)/10;
 return selected.map((p,index)=>({...p,portfolioWeightPct:rounded[index],allocationRank:index+1,status:"SELECTED"}));
}

export async function GET(req:NextRequest){
 const raw=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase();
 const mode:PublicMode=(PUBLIC_MODES as readonly string[]).includes(raw)?raw as PublicMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const requestedTopValue=finiteNumber(req.nextUrl.searchParams.get("top")??10);
 const requestedTop=Math.min(20,Math.max(1,requestedTopValue??10));
 const top=mode==="thematic"?8:requestedTop;
 const rawTickers=req.nextUrl.searchParams.get("tickers");
 const explicit=rawTickers?rawTickers.split(",").map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z.\-]{1,10}$/.test(x)).slice(0,40):[];
 if(rawTickers&&!explicit.length)return NextResponse.json({error:"No valid ticker symbols supplied."},{status:400});
 try{
  const requestedTheme=String(req.nextUrl.searchParams.get("theme")??DEFAULT_THEME).toLowerCase();
  const theme=isThemeId(requestedTheme)?requestedTheme:DEFAULT_THEME;
  const themeConfig=THEMATIC_UNIVERSES[theme];
  const sectorUniverse=sector==="All"?[]:universeForSector(sector);
  const engineMode:FactorMode=mode==="thematic"?"multifactor":mode;
  const hardEngineUniverse=mode==="thematic"?[...themeConfig.tickers]:ENGINE_UNIVERSES[engineMode];
  const universe=explicit.length?explicit:sectorUniverse.length?sectorUniverse:hardEngineUniverse;
  const result=await runFactorDiscovery(engineMode,universe,mode==="thematic"?40:top);
  const normalizedCandidates=(result.candidates??[]).map(normalizeValuation);
  const picks=mode==="thematic"?thematicAllocation(normalizedCandidates):(result.picks??[]).map(normalizeValuation).slice(0,top);
  const factorQualified=normalizedCandidates.filter((p:any)=>p.passed);
  const valuationEligible=factorQualified.filter((p:any)=>p.valuationValid);
  const rejectedCandidates=normalizedCandidates.filter((p:any)=>!p.passed||!p.valuationValid).map((p:any)=>({
   ...p,
   rejectionReasons:[...(p.failedGates??[]),...(p.valuationFailures??[])]
  }));
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · benchmark ${themeConfig.benchmark}`:`engine:${mode}`;
  const totalWeight=picks.reduce((sum:number,p:any)=>sum+(finiteNumber(p.portfolioWeightPct)??0),0);
  const pipeline=mode==="thematic"?{
   universe:universe.length,
   analyzed:normalizedCandidates.length,
   factorQualified:factorQualified.length,
   valuationEligible:valuationEligible.length,
   selected:picks.length,
   rejected:rejectedCandidates.length,
   committeeReady:picks.length,
  }:{...result.pipeline,selected:picks.length,committeeReady:picks.length};
  return NextResponse.json({
   ...result,
   picks,
   candidates:normalizedCandidates,
   rejectedCandidates,
   pipeline,
   stats:{...result.stats,qualified:factorQualified.length,returned:picks.length,valuationEligible:valuationEligible.length,rejected:rejectedCandidates.length},
   mode,
   rankingMode:engineMode,
   sector,
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   portfolio:mode==="thematic"?{
    construction:"Score-weighted thematic equity portfolio",
    holdings:picks.length,
    targetHoldings:"Up to 8 securities that pass factor and valuation gates",
    totalWeightPct:Math.round(totalWeight*10)/10,
    maxPositionPct:22,
    minPositionPct:8,
    minimumExpectedReturnPct:8,
    status:picks.length?"BUILT":"NO_ELIGIBLE_SECURITIES",
   }:null,
   universeSource:source,
   universeTickers:universe,
   methodology:mode==="thematic"
    ?"The selected theme defines a hard stock universe. Candidates first pass the multi-factor gate, then a separate valuation-evidence gate requiring a valid current price, valid target above spot and at least 8% expected upside. Only valuation-eligible candidates enter the score-weighted portfolio. Every rejection is returned with explicit reasons."
    :result.methodology,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(error:unknown){const message=error instanceof Error?error.message:"Alpha discovery failed";return NextResponse.json({error:message,mode,sector},{status:500})}
}
