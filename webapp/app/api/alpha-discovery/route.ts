import {NextRequest,NextResponse} from "next/server";
import {runFactorDiscovery,type FactorMode} from "@/lib/factorDiscovery";
import {universeForSector} from "@/lib/sectorUniverse";
import {DEFAULT_THEME,isThemeId,THEMATIC_UNIVERSES} from "@/lib/thematicUniverse";
import {applyIndependentEnginePolicy,createPerformanceContract,engineProfile,engineSelectionLimit,type ResearchEngineMode} from "@/lib/researchEnginePolicies";
import {buildRotatingMarketUniverse,loadThreeIndexUniverse} from "@/lib/research/marketUniverse";
import {buildFundResearchEvidence} from "@/lib/research/fundResearchEvidence";
import {LIFECYCLE_DISCOVERY_POLICY_V25,isMatureFallbackStage,isPrimaryDiscoveryStage,lifecycleDiscoveryTier,selectLifecycleFirst} from "@/lib/research/lifecycleDiscoveryPolicy";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;

const FACTOR_MODES:FactorMode[]=["momentum","growth","quality","value","dividend","institutional","ai","multifactor"];
const PUBLIC_MODES=[...FACTOR_MODES,"thematic"] as const;
type PublicMode=typeof PUBLIC_MODES[number];
type Candidate=Record<string,any>;
const DEEP_RESEARCH_LIMIT=40;

const finiteNumber=(value:unknown):number|null=>{const parsed=typeof value==="number"?value:Number(value);return Number.isFinite(parsed)?parsed:null};
const finitePositive=(value:unknown):number|null=>{const parsed=finiteNumber(value);return parsed!=null&&parsed>0?parsed:null};
async function mapLimit<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>):Promise<R[]>{const out=new Array<R>(items.length);let next=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)break;out[index]=await fn(items[index])}}));return out}

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
function scoreKey(mode:PublicMode){return mode==="thematic"||mode==="multifactor"?"composite":mode}
function stableHash(value:string){let hash=2166136261;for(let index=0;index<value.length;index+=1)hash=Math.imul(hash^value.charCodeAt(index),16777619);return hash>>>0}
function rotateApproved(values:string[],asOf=new Date()){
 const seed=Math.floor(Date.UTC(asOf.getUTCFullYear(),asOf.getUTCMonth(),asOf.getUTCDate())/86400000);
 return Array.from(new Set(values.map(value=>String(value).trim().toUpperCase()).filter(value=>/^[A-Z.\-]{1,10}$/.test(value))))
  .map(ticker=>({ticker,rank:stableHash(`${seed}:${ticker}`)})).sort((left,right)=>left.rank-right.rank||left.ticker.localeCompare(right.ticker)).map(row=>row.ticker);
}
function thematicAllocation(input:Candidate[]){
 const selected=input.slice(0,5);if(!selected.length)return[];
 const conviction=selected.map(candidate=>Math.max(1,(finiteNumber(candidate.composite)??1)+Math.max(0,finiteNumber(candidate.expectedReturnPct)??0)*.35));
 const total=conviction.reduce((sum:number,value:number)=>sum+value,0);
 let weights=conviction.map(value=>Math.min(30,Math.max(12,value/total*100)));
 const bounded=weights.reduce((sum:number,value:number)=>sum+value,0);weights=weights.map(value=>value/bounded*100);
 const rounded=weights.map(value=>Math.round(value*10)/10);const drift=Math.round((100-rounded.reduce((sum:number,value:number)=>sum+value,0))*10)/10;if(rounded.length)rounded[0]=Math.round((rounded[0]+drift)*10)/10;
 return selected.map((candidate,index)=>({...candidate,portfolioWeightPct:rounded[index],allocationRank:index+1,status:"COMMITTEE_READY"}));
}

export async function GET(req:NextRequest){
 const requestedMode=String(req.nextUrl.searchParams.get("mode")??"multifactor").toLowerCase();
 const mode:PublicMode=(PUBLIC_MODES as readonly string[]).includes(requestedMode)?requestedMode as PublicMode:"multifactor";
 const sector=String(req.nextUrl.searchParams.get("sector")??"All");
 const requestedTopValue=finiteNumber(req.nextUrl.searchParams.get("top")??10);const requestedTop=Math.min(20,Math.max(1,requestedTopValue??10));const top=engineSelectionLimit(mode as ResearchEngineMode)??requestedTop;
 const rawTickers=req.nextUrl.searchParams.get("tickers");const explicit=rawTickers?rawTickers.split(",").map(value=>value.trim().toUpperCase()).filter(value=>/^[A-Z.\-]{1,10}$/.test(value)).slice(0,40):[];
 if(rawTickers&&!explicit.length)return NextResponse.json({error:"No valid ticker symbols supplied."},{status:400});
 try{
  const requestedTheme=String(req.nextUrl.searchParams.get("theme")??DEFAULT_THEME).toLowerCase();const theme=isThemeId(requestedTheme)?requestedTheme:DEFAULT_THEME;const themeConfig=THEMATIC_UNIVERSES[theme];
  const sectorUniverse=sector==="All"?[]:universeForSector(sector);const engineMode:FactorMode=mode==="thematic"?"multifactor":mode;const universeWarnings:string[]=[];
  let universe:string[]=[];let coverageUniverseSize=0;let source="explicit";let approvedMasterUniverseSize:number|null=null;
  if(explicit.length){universe=explicit;coverageUniverseSize=explicit.length;source="explicit ticker override · one-off analysis outside automatic discovery rules"}
  else{
   const approved=await loadThreeIndexUniverse();approvedMasterUniverseSize=approved.masterUniverseSize;universeWarnings.push(...approved.warnings);const allowed=new Set(approved.masterTickers);
   if(mode==="thematic"){const thematicApproved=rotateApproved([...themeConfig.tickers].filter(ticker=>allowed.has(String(ticker).toUpperCase())));universe=thematicApproved.slice(0,DEEP_RESEARCH_LIMIT);coverageUniverseSize=thematicApproved.length;source=`theme:${themeConfig.label} · approved-index members only · S&P 500 + Nasdaq-100 + Russell 2000`}
   else if(sectorUniverse.length){const sectorApproved=rotateApproved(sectorUniverse.filter(ticker=>allowed.has(ticker.toUpperCase())));universe=sectorApproved.slice(0,DEEP_RESEARCH_LIMIT);coverageUniverseSize=sectorApproved.length;source=`sector:${sector} · approved-index members only · S&P 500 + Nasdaq-100 + Russell 2000`}
   else{const rotation=await buildRotatingMarketUniverse({detailedLimit:DEEP_RESEARCH_LIMIT});universeWarnings.push(...rotation.warnings);universe=rotation.queue.map(row=>row.ticker).slice(0,DEEP_RESEARCH_LIMIT);coverageUniverseSize=approved.masterUniverseSize;source=`APPROVED 3-INDEX UNIVERSE · S&P 500 + Nasdaq-100 + Russell 2000 · ${universe.length} names scheduled this cycle`}
  }
  if(!universe.length)return NextResponse.json({error:"No securities from the CIO-approved universe are available for this research run.",mode,sector},{status:422});

  const result=await runFactorDiscovery(engineMode,universe,40);const asOf=new Date().toISOString();const key=scoreKey(mode);
  const candidates=(result.candidates??[]).map(normalizeValuation).map((candidate:Candidate)=>applyIndependentEnginePolicy(mode as ResearchEngineMode,candidate));
  const factorQualified=candidates.filter((candidate:Candidate)=>candidate.passed);
  const lifecycleCandidates=factorQualified.filter((candidate:Candidate)=>(isPrimaryDiscoveryStage(candidate?.lifecycle?.stage)||isMatureFallbackStage(candidate?.lifecycle?.stage))&&Number(candidate?.momentum??0)>=62&&candidate.valuationValid);
  const primaryPre=lifecycleCandidates.filter((candidate:Candidate)=>isPrimaryDiscoveryStage(candidate?.lifecycle?.stage)).sort((a:Candidate,b:Candidate)=>(finiteNumber(b[key])??0)-(finiteNumber(a[key])??0)).slice(0,Math.max(top*2,12));
  const maturePre=lifecycleCandidates.filter((candidate:Candidate)=>isMatureFallbackStage(candidate?.lifecycle?.stage)&&!candidate?.lifecycle?.nearFairValue&&Number(candidate.expectedReturnPct??0)>=12).sort((a:Candidate,b:Candidate)=>(finiteNumber(b[key])??0)-(finiteNumber(a[key])??0)).slice(0,Math.max(top,6));
  const preUnderwrite=[...primaryPre,...maturePre].filter((candidate,index,rows)=>rows.findIndex(row=>row.ticker===candidate.ticker)===index);
  const underwritten=await mapLimit(preUnderwrite,3,async(candidate:Candidate)=>{
   const discoveryTier=lifecycleDiscoveryTier(candidate?.lifecycle?.stage);
   const researchEvidence=await buildFundResearchEvidence(candidate,{discoveryTier,marketFitScore:50});
   return {...candidate,discoveryTier,researchEvidence};
  });
  const underwrittenEligible=underwritten.filter((candidate:Candidate)=>isPrimaryDiscoveryStage(candidate?.lifecycle?.stage)
   ? candidate.researchEvidence?.fundFit?.hardBlocks?.length===0&&Number(candidate.researchEvidence?.fundFit?.score??0)>=60
   : Boolean(candidate.researchEvidence?.fundFit?.matureFallbackEligible));
  const lifecycleSelection=selectLifecycleFirst(underwrittenEligible,{
   topN:mode==="thematic"?Math.max(5,top):top,
   getStage:(candidate:Candidate)=>candidate?.lifecycle?.stage,
   getScore:(candidate:Candidate)=>(finiteNumber(candidate[key])??0)+Number(candidate.researchEvidence?.fundFit?.score??0)*.25,
   matureEligible:(candidate:Candidate)=>Boolean(candidate.researchEvidence?.fundFit?.matureFallbackEligible),
  });
  const selectedRows=lifecycleSelection.selected;
  const primarySelected=selectedRows.filter((candidate:Candidate)=>candidate.discoveryTier==="PRIMARY").map((candidate:Candidate,index:number)=>({...candidate,allocationRank:index+1,status:"COMMITTEE_READY"}));
  const matureSelected=selectedRows.filter((candidate:Candidate)=>candidate.discoveryTier==="MATURE_FALLBACK").map((candidate:Candidate,index:number)=>({...candidate,allocationRank:primarySelected.length+index+1,status:"MATURE_FALLBACK_REVIEW",portfolioWeightPct:0}));
  const picks=mode==="thematic"?[...thematicAllocation(primarySelected),...matureSelected]:[...primarySelected,...matureSelected];
  const selectedTickers=new Set(picks.map((candidate:Candidate)=>candidate.ticker));const evidenceByTicker=new Map(underwritten.map((candidate:Candidate)=>[candidate.ticker,candidate]));
  const rankedCandidates=candidates.map((candidate:Candidate)=>{
   if(selectedTickers.has(candidate.ticker))return{...candidate,...picks.find((pick:Candidate)=>pick.ticker===candidate.ticker)};
   const enriched=evidenceByTicker.get(candidate.ticker)??candidate;
   if(!candidate.passed)return{...enriched,status:"REJECTED"};
   if(isMatureFallbackStage(candidate?.lifecycle?.stage))return{...enriched,status:"MATURE_FALLBACK_WAIT"};
   if(!isPrimaryDiscoveryStage(candidate?.lifecycle?.stage))return{...enriched,status:"MOMENTUM_STAGE_REJECTED"};
   if(!candidate.valuationValid)return{...enriched,status:"RESEARCH_INCOMPLETE"};
   if(enriched.researchEvidence?.fundFit?.hardBlocks?.length)return{...enriched,status:"FUND_UNDERWRITING_WAIT"};
   return{...enriched,status:"QUALIFIED_NOT_SELECTED"};
  });
  const rejectedCandidates=rankedCandidates.filter((candidate:Candidate)=>["REJECTED","MOMENTUM_STAGE_REJECTED"].includes(candidate.status));
  const primaryLifecycle=factorQualified.filter((candidate:Candidate)=>isPrimaryDiscoveryStage(candidate?.lifecycle?.stage)&&Number(candidate?.momentum??0)>=62);
  const matureFallback=factorQualified.filter((candidate:Candidate)=>isMatureFallbackStage(candidate?.lifecycle?.stage));
  const valuationEligible=lifecycleCandidates;
  const stageCandidates={universe:rankedCandidates,analyzed:rankedCandidates,qualified:factorQualified,momentum:primaryLifecycle,matureFallback,valuation:valuationEligible,selected:picks,rejected:rejectedCandidates};
  const totalWeight=picks.reduce((sum:number,candidate:Candidate)=>sum+(finiteNumber(candidate.portfolioWeightPct)??0),0);
  const committeeReady=picks.filter((candidate:Candidate)=>candidate.status==="COMMITTEE_READY").length;
  const pipeline={coverageUniverse:coverageUniverseSize,universe:universe.length,scheduled:universe.length,analyzed:candidates.length,factorQualified:factorQualified.length,qualified:factorQualified.length,primaryLifecycleEligible:primaryLifecycle.length,matureFallbackAvailable:matureFallback.length,valuationEligible:valuationEligible.length,selected:picks.length,matureFallbackSelected:lifecycleSelection.matureFallbackSelected,rejected:rejectedCandidates.length,committeeReady};
  const performanceContracts=picks.map((candidate:Candidate)=>createPerformanceContract(mode as ResearchEngineMode,candidate,asOf));const warnings=[...new Set([...universeWarnings,...(result.warnings??[])])];
  return NextResponse.json({
   ...result,version:"25.0-lifecycle-first-fund-underwriting",asOf,mode,rankingMode:engineMode,sector,engine:engineProfile(mode as ResearchEngineMode),theme:mode==="thematic"?{id:theme,label:themeConfig.label,benchmark:themeConfig.benchmark}:null,
   universeSource:source,approvedMasterUniverseSize,universeTickers:universe,pipeline,stageCandidates,candidates:rankedCandidates,picks,rejectedCandidates,warnings,performanceContracts,
   lifecyclePolicy:{...LIFECYCLE_DISCOVERY_POLICY_V25,primaryAvailable:lifecycleSelection.primaryAvailable,matureFallbackAvailable:lifecycleSelection.matureFallbackAvailable,primarySelected:lifecycleSelection.primarySelected,matureFallbackSelected:lifecycleSelection.matureFallbackSelected,fallbackUsed:lifecycleSelection.fallbackUsed},
   stats:{...result.stats,coverageUniverse:coverageUniverseSize,scheduled:universe.length,qualified:factorQualified.length,returned:picks.length,valuationEligible:valuationEligible.length,rejected:rejectedCandidates.length},
   portfolio:mode==="thematic"?{construction:"Lifecycle-first thematic sleeve; MATURE fallback receives zero automatic weight and stays research-only",holdings:primarySelected.length,targetHoldings:"5 primary-lifecycle securities when available",totalWeightPct:Math.round(totalWeight*10)/10,maxPositionPct:30,minPositionPct:12,minimumExpectedReturnPct:8,status:primarySelected.length===5?"BUILT":primarySelected.length?"PARTIAL":"NO_PRIMARY_LIFECYCLE_SECURITIES",horizon:"1–3 months"}:null,
   policy:{researchOnly:true,automaticTrading:false,approvedAutomaticUniverse:["S&P 500","Nasdaq-100","Russell 2000"],primaryLifecycleStages:["ACCUMULATION","EARLY_MARKUP","MOMENTUM_EXPANSION"],matureFallbackOnly:true,activeMomentumGateRequired:true,valuationGateRequired:true,fundUnderwritingRequired:true,sentinelXEvidenceOnly:true,mcdxSyntheticProxy:true,explicitRejectionEvidence:true,independentEngineState:true,performanceTrackingRequired:true},
   methodology:`${engineProfile(mode as ResearchEngineMode).objective} Automatic discovery remains restricted to the CIO-approved S&P 500, Nasdaq-100 and Russell 2000 universe. V25 searches ACCUMULATION / EARLY_MARKUP / MOMENTUM_EXPANSION first. MATURE is used only if the primary shortlist does not fill, and only after stricter valuation-room, Sentinel X trend/ATR-room, MCDX synthetic price-volume distribution and Fund-Fit checks. Every underwritten finalist carries Structure, Quant, Sentinel X, MCDX Proxy, Thesis, Catalyst and Fund-Fit evidence. Manual ticker overrides remain one-off research and never widen the automatic universe.`,
  },{headers:{"Cache-Control":"no-store"}});
 }catch(error:unknown){const message=error instanceof Error?error.message:"Alpha discovery failed";return NextResponse.json({error:message,mode,sector},{status:500})}
}
