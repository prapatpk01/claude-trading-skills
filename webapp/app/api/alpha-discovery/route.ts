import {NextRequest,NextResponse} from "next/server";
import {runFactorDiscovery,ENGINE_UNIVERSES,type FactorMode} from "@/lib/factorDiscovery";
import {universeForSector} from "@/lib/sectorUniverse";
import {DEFAULT_THEME,isThemeId,THEMATIC_UNIVERSES} from "@/lib/thematicUniverse";
import {applyIndependentEnginePolicy,createPerformanceContract,engineProfile,engineSelectionLimit,type ResearchEngineMode} from "@/lib/researchEnginePolicies";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

const FACTOR_MODES:FactorMode[]=["momentum","growth","quality","value","dividend","institutional","ai","multifactor"];
const PUBLIC_MODES=[...FACTOR_MODES,"thematic"] as const;
type PublicMode=typeof PUBLIC_MODES[number];
type Candidate=Record<string,any>;

const finiteNumber=(value:unknown):number|null=>{const parsed=typeof value==="number"?value:Number(value);return Number.isFinite(parsed)?parsed:null};
const finitePositive=(value:unknown):number|null=>{const parsed=finiteNumber(value);return parsed!=null&&parsed>0?parsed:null};

function normalizeValuation(candidate:Candidate){
 const price=finitePositive(candidate?.price);
 const targetPrice=finitePositive(candidate?.targetPrice);
 const expectedReturnPct=price!=null&&targetPrice!=null?((targetPrice/price)-1)*100:null;
  const valuationFailures:string[]=[];
 if(price==null)valuationFailures.push("Current price unavailable");
 if(targetPrice==null)valuationFailures.push("Target price unavailable");
 if(price!=null&&targetPrice!=null&&targetPrice<=price)valuationFailures.push("Target price is not above spot");
  if(expectedReturnPct!=null&&expectedReturnPct<8)valuationFailures.push("Expected upside below 8%");
 const inherited=Array.isArray(candidate?.valuationFailures)?candidate.valuationFailures:[];
 const combined=[...new Set([...inherited,...valuationFailures])];
 return {...candidate,price,targetPrice,expectedReturnPct,valuationValid:Boolean(candidate?.valuationReady)&&combined.length===0,valuationFailures:combined};
}

function scoreKey(mode:PublicMode){
 if(mode==="thematic"||mode==="multifactor")return"composite";
 return mode;
}

function thematicAllocation(input:Candidate[]){
 const eligible=input.filter(candidate=>candidate.passed&&candidate.valuationValid).sort((left,right)=>(finiteNumber(right.composite)??-Infinity)-(finiteNumber(left.composite)??-Infinity));
 const selected=eligible.slice(0,5);
 if(!selected.length)return[];
 const conviction=selected.map(candidate=>Math.max(1,(finiteNumber(candidate.composite)??1)+Math.max(0,finiteNumber(candidate.expectedReturnPct)??0)*.35));
 const total=conviction.reduce((sum:number,value:number)=>sum+value,0);
 let weights=conviction.map(value=>Math.min(30,Math.max(12,value/total*100)));
 const bounded=weights.reduce((sum:number,value:number)=>sum+value,0);
 weights=weights.map(value=>value/bounded*100);
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
 const top=engineSelectionLimit(mode as ResearchEngineMode)??requestedTop;
 const rawTickers=req.nextUrl.searchParams.get("tickers");
 const explicit=rawTickers?rawTickers.split(",").map(value=>value.trim().toUpperCase()).filter(value=>/^[A-Z.\-]{1,10}$/.test(value)).slice(0,40):[];
 if(rawTickers&&!explicit.length)return NextResponse.json({error:"No valid ticker symbols supplied."},{status:400});

 try{
  const requestedTheme=String(req.nextUrl.searchParams.get("theme")??DEFAULT_THEME).toLowerCase();
  const theme=isThemeId(requestedTheme)?requestedTheme:DEFAULT_THEME;
  const themeConfig=THEMATIC_UNIVERSES[theme];
  const sectorUniverse=sector==="All"?[]:universeForSector(sector);
  const engineMode:FactorMode=mode==="thematic"?"multifactor":mode;
  const engineUniverse=mode==="thematic"?[...themeConfig.tickers]:ENGINE_UNIVERSES[engineMode];
  const universe=explicit.length?explicit:sectorUniverse.length?sectorUniverse:engineUniverse;
  const result=await runFactorDiscovery(engineMode,universe,40);
  const asOf=new Date().toISOString();
  const candidates=(result.candidates??[]).map(normalizeValuation).map((candidate:Candidate)=>applyIndependentEnginePolicy(mode as ResearchEngineMode,candidate));
  const factorQualified=candidates.filter((candidate:Candidate)=>candidate.passed);
  const momentumEligible=factorQualified.filter((candidate:Candidate)=>Boolean(candidate?.lifecycle?.entryEligible)&&Number(candidate?.momentum??0)>=62);
  const valuationEligible=momentumEligible.filter((candidate:Candidate)=>candidate.valuationValid);
  const valuationRequired=true;
  const key=scoreKey(mode);
  const ranked=valuationEligible.sort((left:Candidate,right:Candidate)=>(finiteNumber(right[key])??-Infinity)-(finiteNumber(left[key])??-Infinity));
  const picks=mode==="thematic"?thematicAllocation(valuationEligible):ranked.slice(0,top).map((candidate:Candidate,index:number)=>({...candidate,allocationRank:index+1,status:"COMMITTEE_READY"}));
  const selectedTickers=new Set(picks.map((candidate:Candidate)=>candidate.ticker));
  const rejectedCandidates=candidates.filter((candidate:Candidate)=>!candidate.passed||!candidate?.lifecycle?.entryEligible||!candidate.valuationValid).map((candidate:Candidate)=>({...candidate,status:candidate.passed&&candidate?.lifecycle?.entryEligible&&!candidate.valuationValid?"RESEARCH_INCOMPLETE":"REJECTED",rejectionReasons:[...(candidate.failedGates??[]),...(!candidate?.lifecycle?.entryEligible?[`Momentum lifecycle ${candidate?.lifecycle?.stage??"UNCONFIRMED"} is not entry eligible`]:[]),...(candidate.valuationFailures??[])]}));
  const rankedCandidates=candidates.map((candidate:Candidate)=>{
   if(selectedTickers.has(candidate.ticker))return{...candidate,...picks.find((pick:Candidate)=>pick.ticker===candidate.ticker)};
   if(!candidate.passed)return{...candidate,status:"REJECTED"};
   if(!candidate?.lifecycle?.entryEligible)return{...candidate,status:"MOMENTUM_STAGE_REJECTED"};
   if(!candidate.valuationValid)return{...candidate,status:"RESEARCH_INCOMPLETE"};
   if(mode==="thematic")return{...candidate,status:"ELIGIBLE_NOT_SELECTED"};
   return{...candidate,status:"QUALIFIED_NOT_SELECTED"};
  });
  const stageCandidates={universe:rankedCandidates,analyzed:rankedCandidates,qualified:factorQualified,momentum:momentumEligible,valuation:valuationEligible,selected:picks,rejected:rejectedCandidates};
  const source=explicit.length?"explicit":sectorUniverse.length?`sector:${sector}`:mode==="thematic"?`theme:${themeConfig.label} · benchmark ${themeConfig.benchmark}`:`engine:${mode}`;
  const totalWeight=picks.reduce((sum:number,candidate:Candidate)=>sum+(finiteNumber(candidate.portfolioWeightPct)??0),0);
  const pipeline={universe:universe.length,analyzed:candidates.length,factorQualified:factorQualified.length,qualified:factorQualified.length,momentumEligible:momentumEligible.length,valuationEligible:valuationEligible.length,selected:picks.length,rejected:rejectedCandidates.length,committeeReady:picks.length};
  const performanceContracts=picks.map((candidate:Candidate)=>createPerformanceContract(mode as ResearchEngineMode,candidate,asOf));
  return NextResponse.json({
   ...result,version:"23.0-independent-active-momentum-engines",asOf,mode,rankingMode:engineMode,sector,
   engine:engineProfile(mode as ResearchEngineMode),
   theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   universeSource:source,universeTickers:universe,pipeline,stageCandidates,candidates:rankedCandidates,picks,rejectedCandidates,
   performanceContracts,
   stats:{...result.stats,qualified:factorQualified.length,returned:picks.length,valuationEligible:valuationEligible.length,rejected:rejectedCandidates.length},
   portfolio:mode==="thematic"?{construction:"AI conviction-weighted five-stock thematic sleeve",holdings:picks.length,targetHoldings:"Exactly 5 securities when at least 5 pass factor and valuation gates",totalWeightPct:Math.round(totalWeight*10)/10,maxPositionPct:30,minPositionPct:12,minimumExpectedReturnPct:8,status:picks.length===5?"BUILT":picks.length?"PARTIAL":"NO_ELIGIBLE_SECURITIES",horizon:"1–3 months"}:null,
   policy:{researchOnly:true,automaticTrading:false,activeMomentumGateRequired:true,valuationGateRequired:true,explicitRejectionEvidence:true,independentEngineState:true,performanceTrackingRequired:true},
   methodology:`${engineProfile(mode as ResearchEngineMode).objective} This engine owns its universe and factor gate independently. Sentinel then applies the common Active Momentum gate (ACCUMULATION / EARLY_MARKUP / MOMENTUM_EXPANSION) and the mandatory defensible Fair Value gap before any name can become Committee Ready.`,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(error:unknown){
  const message=error instanceof Error?error.message:"Alpha discovery failed";
  return NextResponse.json({error:message,mode,sector},{status:500});
 }
}
