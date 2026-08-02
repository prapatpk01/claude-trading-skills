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

const n=(v:unknown)=>Number.isFinite(Number(v))?Number(v):0;
function thematicAllocation(picks:any[]){
 const selected=picks.slice(0,Math.min(8,Math.max(5,picks.length)));
 if(!selected.length)return[];
 const raw=selected.map(p=>Math.max(1,n(p.composite)));
 const total=raw.reduce((s,x)=>s+x,0)||1;
 let weights=raw.map(x=>Math.min(22,Math.max(8,x/total*100)));
 const sum=weights.reduce((s,x)=>s+x,0)||1;
 weights=weights.map(x=>x/sum*100);
 const rounded=weights.map(x=>Math.round(x*10)/10);
 const drift=Math.round((100-rounded.reduce((s,x)=>s+x,0))*10)/10;
 if(rounded.length)rounded[0]=Math.round((rounded[0]+drift)*10)/10;
 return selected.map((p,i)=>({...p,portfolioWeightPct:rounded[i],allocationRank:i+1}));
}

export async function GET(req:NextRequest){
 const raw=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase();
 const mode:PublicMode=(PUBLIC_MODES as readonly string[]).includes(raw)?raw as PublicMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const requestedTop=Math.min(20,Math.max(1,Number(req.nextUrl.searchParams.get("top")??10)||10));
 const top=mode==="thematic"?Math.min(8,Math.max(5,requestedTop)):requestedTop;
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
  const result=await runFactorDiscovery(engineMode,universe,mode==="thematic"?8:top);
  const picks=mode==="thematic"?thematicAllocation(result.picks??[]):result.picks;
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · benchmark ${themeConfig.benchmark}`:`engine:${mode}`;
  return NextResponse.json({
   ...result,
   picks,
   mode,
   rankingMode:engineMode,
   sector,
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   portfolio:mode==="thematic"?{
    construction:"Score-weighted thematic equity portfolio",
    holdings:picks.length,
    targetHoldings:"5-8",
    totalWeightPct:Math.round(picks.reduce((s:number,p:any)=>s+n(p.portfolioWeightPct),0)*10)/10,
    maxPositionPct:22,
    minPositionPct:8,
   }:null,
   universeSource:source,
   universeTickers:universe,
   methodology:mode==="thematic"
    ?`The selected theme defines a hard stock universe. The multifactor engine ranks the constituents, selects the strongest 5-8 stocks, and assigns score-weighted portfolio allocations totaling 100%, with an 8%-22% position band.`
    :result.methodology,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e:any){return NextResponse.json({error:e?.message??"Alpha discovery failed",mode,sector},{status:500})}
}
