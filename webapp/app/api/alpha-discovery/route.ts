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

export async function GET(req:NextRequest){
 const raw=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase();
 const mode:PublicMode=(PUBLIC_MODES as readonly string[]).includes(raw)?raw as PublicMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const top=Math.min(20,Math.max(1,Number(req.nextUrl.searchParams.get("top")??10)||10));
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
  const result=await runFactorDiscovery(engineMode,universe,top);
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · ${themeConfig.benchmark}`:`engine:${mode}`;
  return NextResponse.json({
   ...result,
   mode,
   rankingMode:engineMode,
   sector,
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   universeSource:source,
   universeTickers:universe,
   methodology:mode==="thematic"
    ?`Hard theme universe (${themeConfig.label} / ${themeConfig.benchmark}) is filtered first, then ranked by the multifactor model. Securities outside the selected theme cannot enter this result.`
    :result.methodology,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(e:any){return NextResponse.json({error:e?.message??"Alpha discovery failed",mode,sector},{status:500})}
}
