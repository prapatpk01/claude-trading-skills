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
type Candidate=Record<string,any>;

const finiteNumber=(value:unknown):number|null=>{
 const parsed=typeof value==="number"?value:Number(value);
 return Number.isFinite(parsed)?parsed:null;
};
const finitePositive=(value:unknown):number|null=>{
 const parsed=finiteNumber(value);
 return parsed!=null&&parsed>0?parsed:null;
};

function normalizeValuation(candidate:Candidate){
 const price=finitePositive(candidate?.price);
 const targetPrice=finitePositive(candidate?.targetPrice);
 const expectedReturnPct=price!=null&&targetPrice!=null?((targetPrice/price)-1)*100:null;
 const valuationFailures:string[]=[];
 if(price==null)valuationFailures.push("Current price unavailable");
 if(targetPrice==null)valuationFailures.push("Target price unavailable");
 if(price!=null&&targetPrice!=null&&targetPrice<=price)valuationFailures.push("Target price is not above spot");
 if(expectedReturnPct!=null&&expectedReturnPct<8)valuationFailures.push("Expected upside below 8%");
 return {...candidate,price,targetPrice,expectedReturnPct,valuationValid:valuationFailures.length===0,valuationFailures};
}

function thematicAllocation(input:Candidate[]){
 const eligible=input
  .filter(candidate=>candidate.passed&&candidate.valuationValid)
  .sort((left,right)=>(finiteNumber(right.composite)??-Infinity)-(finiteNumber(left.composite)??-Infinity));
 const selected=eligible.slice(0,8);
 if(!selected.length)return[];
 const scores=selected.map(candidate=>Math.max(1,finiteNumber(candidate.composite)??1));
 const scoreTotal=scores.reduce((sum:number,value:number)=>sum+value,0);
 let weights=scores.map(value=>Math.min(22,Math.max(8,value/scoreTotal*100)));
 const boundedTotal=weights.reduce((sum:number,value:number)=>sum+value,0);
 weights=weights.map(value=>value/boundedTotal*100);
 const rounded=weights.map(value=>Math.round(value*10)/10);
 const drift=Math.round((100-rounded.reduce((sum:number,value:number)=>sum+value,0))*10)/10;
 if(rounded.length)rounded[0]=Math.round((rounded[0]+drift)*10)/10;
 return selected.map((candidate,index)=>({...candidate,portfolioWeightPct:rounded[index],allocationRank:index+1,status:"SELECTED"}));
}

export async function GET(req:NextRequest){
 const requestedMode=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase();
 const mode:PublicMode=(PUBLIC_MODES as readonly string[]).includes(requestedMode)?requestedMode as PublicMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const requestedTopValue=finiteNumber(req.nextUrl.searchParams.get("top")??10);
 const requestedTop=Math.min(20,Math.max(1,requestedTopValue??10));
 const top=mode==="thematic"?8:requestedTop;
 const rawTickers=req.nextUrl.searchParams.get("tickers");
 const explicit=rawTickers
  ?rawTickers.split(",").map(value=>value.trim().toUpperCase()).filter(value=>/^[A-Z.\-]{1,10}$/.test(value)).slice(0,40)
  :[];
 if(rawTickers&&!explicit.length)return NextResponse.json({error:"No valid ticker symbols supplied."},{status:400});

 try{
  const requestedTheme=String(req.nextUrl.searchParams.get("theme")??DEFAULT_THEME).toLowerCase();
  const theme=isThemeId(requestedTheme)?requestedTheme:DEFAULT_THEME;
  const themeConfig=THEMATIC_UNIVERSES[theme];
  const sectorUniverse=sector==="All"?[]:universeForSector(sector);
  const engineMode:FactorMode=mode==="thematic"?"multifactor":mode;
  const engineUniverse=mode==="thematic"?[...themeConfig.tickers]:ENGINE_UNIVERSES[engineMode];
  const universe=explicit.length?explicit:sectorUniverse.length?sectorUniverse:engineUniverse;
  const result=await runFactorDiscovery(engineMode,universe,mode==="thematic"?40:top);
  const candidates=(result.candidates??[]).map(normalizeValuation);
  const factorQualified=candidates.filter((candidate:Candidate)=>candidate.passed);
  const valuationEligible=factorQualified.filter((candidate:Candidate)=>candidate.valuationValid);
  const basePicks=(result.picks??[]).map(normalizeValuation).slice(0,top);
  const picks=mode==="thematic"?thematicAllocation(candidates):basePicks.map((candidate:Candidate,index:number)=>({...candidate,allocationRank:index+1,status:"COMMITTEE_READY"}));
  const selectedTickers=new Set(picks.map((candidate:Candidate)=>candidate.ticker));

  const rejectedCandidates=(mode==="thematic"
   ?candidates.filter((candidate:Candidate)=>!candidate.passed||!candidate.valuationValid)
   :candidates.filter((candidate:Candidate)=>!candidate.passed)
  ).map((candidate:Candidate)=>({
   ...candidate,
   status:"REJECTED",
   rejectionReasons:[...(candidate.failedGates??[]),...(mode==="thematic"?candidate.valuationFailures??[]:[])],
  }));

  const rankedCandidates=candidates.map((candidate:Candidate)=>{
   if(selectedTickers.has(candidate.ticker))return {...candidate,...picks.find((pick:Candidate)=>pick.ticker===candidate.ticker)};
   if(!candidate.passed)return {...candidate,status:"REJECTED"};
   if(mode==="thematic"&&!candidate.valuationValid)return {...candidate,status:"VALUATION_REJECTED"};
   if(mode==="thematic")return {...candidate,status:"ELIGIBLE_NOT_SELECTED"};
   return {...candidate,status:"QUALIFIED_NOT_SELECTED"};
  });

  const stageCandidates={
   universe:rankedCandidates,
   analyzed:rankedCandidates,
   qualified:factorQualified,
   valuation:mode==="thematic"?valuationEligible:factorQualified,
   selected:picks,
   rejected:rejectedCandidates,
  };
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · benchmark ${themeConfig.benchmark}`:`engine:${mode}`;
  const totalWeight=picks.reduce((sum:number,candidate:Candidate)=>sum+(finiteNumber(candidate.portfolioWeightPct)??0),0);
  const pipeline=mode==="thematic"?{
   universe:universe.length,
   analyzed:candidates.length,
   factorQualified:factorQualified.length,
   valuationEligible:valuationEligible.length,
   selected:picks.length,
   rejected:rejectedCandidates.length,
   committeeReady:picks.length,
  }:{
   universe:universe.length,
   analyzed:candidates.length,
   qualified:factorQualified.length,
   selected:picks.length,
   rejected:rejectedCandidates.length,
   committeeReady:picks.length,
  };

  return NextResponse.json({
   ...result,
   version:"12.1-research-pipeline",
   asOf:new Date().toISOString(),
   mode,
   rankingMode:engineMode,
   sector,
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   universeSource:source,
   universeTickers:universe,
   pipeline,
   stageCandidates,
   candidates:rankedCandidates,
   picks,
   rejectedCandidates,
   stats:{...result.stats,qualified:factorQualified.length,returned:picks.length,valuationEligible:valuationEligible.length,rejected:rejectedCandidates.length},
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
   policy:{
    researchOnly:true,
    automaticTrading:false,
    valuationGateRequired:mode==="thematic",
    explicitRejectionEvidence:true,
   },
   methodology:mode==="thematic"
    ?"The selected theme defines the universe. Candidates pass the multi-factor gate, then a valuation-evidence gate requiring current price, a target above spot and at least 8% expected upside. Eligible names are ranked by composite score and weighted to 100%."
    :"The selected factor engine defines qualification and ranking. Valuation evidence is displayed but does not reject Momentum, Growth, Quality, Dividend, Institutional or AI candidates unless that engine explicitly requires it.",
  },{headers:{"Cache-Control":"no-store"}});
 }catch(error:unknown){
  const message=error instanceof Error?error.message:"Alpha discovery failed";
  return NextResponse.json({error:message,mode,sector},{status:500});
 }
}
