// Production redeploy trigger: 2026-08-03
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
 const derived=price!=null&&target!=null?((target/price)-1)*100:null;
 return {...p,price,targetPrice:target,expectedReturnPct:derived,valuationValid:derived!=null};
}
function thematicAllocation(input:any[]){
 const eligible=input
  .map(normalizeValuation)
  .filter(p=>p.valuationValid&&p.expectedReturnPct!=null&&p.expectedReturnPct>=8&&p.targetPrice!=null&&p.price!=null&&p.targetPrice>p.price)
  .sort((a,b)=>(finiteNumber(b.composite)??-Infinity)-(finiteNumber(a.composite)??-Infinity));
 const selected=eligible.slice(0,8);
 if(!selected.length)return[];
 const raw=selected.map(p=>Math.max(1,finiteNumber(p.composite)??1));
 const rawTotal=raw.reduce((sum,value)=>sum+value,0);
 if(rawTotal<=0)return[];
 let weights=raw.map(value=>Math.min(22,Math.max(8,value/rawTotal*100)));
 const boundedTotal=weights.reduce((sum,value)=>sum+value,0);
 if(boundedTotal<=0)return[];
 weights=weights.map(value=>value/boundedTotal*100);
 const rounded=weights.map(value=>Math.round(value*10)/10);
 const drift=Math.round((100-rounded.reduce((sum,value)=>sum+value,0))*10)/10;
 if(rounded.length)rounded[0]=Math.round((rounded[0]+drift)*10)/10;
 return selected.map((p,index)=>({...p,portfolioWeightPct:rounded[index],allocationRank:index+1}));
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
  const result=await runFactorDiscovery(engineMode,universe,mode==="thematic"?20:top);
  const normalized=(result.picks??[]).map(normalizeValuation);
  const picks=mode==="thematic"?thematicAllocation(normalized):normalized;
  const rejectedForValuation=mode==="thematic"?normalized.filter((p:any)=>!p.valuationValid||p.expectedReturnPct==null||p.expectedReturnPct<8||p.targetPrice==null||p.price==null||p.targetPrice<=p.price).length:0;
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · benchmark ${themeConfig.benchmark}`:`engine:${mode}`;
  const totalWeight=picks.reduce((sum:number,p:any)=>sum+(finiteNumber(p.portfolioWeightPct)??0),0);
  return NextResponse.json({
   ...result,
   picks,
   stats:{...result.stats,returned:picks.length,rejectedForValuation},
   mode,
   rankingMode:engineMode,
   sector,
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   portfolio:mode==="thematic"?{
    construction:"Score-weighted thematic equity portfolio",
    holdings:picks.length,
    targetHoldings:"5-8 when enough securities pass every gate",
    totalWeightPct:Math.round(totalWeight*10)/10,
    maxPositionPct:22,
    minPositionPct:8,
    minimumExpectedReturnPct:8,
   }:null,
   universeSource:source,
   universeTickers:universe,
   methodology:mode==="thematic"
    ?"The selected theme defines a hard stock universe. Expected return is derived directly from current price and target price. Securities with missing or invalid valuation evidence, target at or below spot, or expected upside below 8% are rejected before ranking. The engine then selects up to 8 eligible stocks and assigns score-weighted allocations totaling 100%."
    :result.methodology,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(error:unknown){const message=error instanceof Error?error.message:"Alpha discovery failed";return NextResponse.json({error:message,mode,sector},{status:500})}
}
