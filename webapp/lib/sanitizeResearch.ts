import { validatePeer, peerCoverage } from "./peerValidation";
import { getMarketData } from "./marketData";

const finite=(x:any):x is number=>typeof x==="number"&&Number.isFinite(x);

async function crossCheckPeer(p:any){
  let row={...p,gaps:[...(p.gaps??[])]};
  try{
    const md=await getMarketData(p.ticker);
    const latest=md.financials?.income?.[0];
    const annualRevenue=finite(latest?.totalRevenue)&&latest.totalRevenue>0?latest.totalRevenue:null;
    const annualNet=finite(latest?.netIncome)?latest.netIncome:null;
    const currentPrice=finite(md.quote?.price)?md.quote.price:finite(p.price)?p.price:null;
    const eps=finite(md.overview?.eps)&&md.overview.eps>0?md.overview.eps:null;

    if(annualRevenue!=null){
      const ttm=finite(row.revenueTTM)&&row.revenueTTM>0?row.revenueTTM:null;
      const ratio=ttm!=null?ttm/annualRevenue:null;
      if(ratio==null||ratio<0.65||ratio>1.8){
        if(ttm!=null)row.gaps.push(`TTM revenue failed annual cross-check (${ratio!.toFixed(2)}× latest annual revenue); latest annual revenue used as conservative fallback.`);
        row.revenueTTM=annualRevenue;
        if(annualNet!=null)row.netIncomeTTM=annualNet;
      }
    }

    // Prefer a price/EPS pair that comes from the same current market-data pack.
    // This is safer across stock splits than a historical EPS fact paired with today's price.
    if(currentPrice!=null&&eps!=null){
      const pe=currentPrice/eps;
      if(pe>0&&pe<=250)row.peTTM=pe;
      else row.gaps.push(`Current price/EPS implied P/E ${pe.toFixed(1)}x is not a useful comparable.`);
    }
  }catch(e:any){row.gaps.push(`Cross-check unavailable: ${e?.message??"market data error"}`)}
  return row;
}

/**
 * Sanitize an arbitrary research payload without requiring callers to expose
 * a concrete ResearchPack interface. Runtime property access is isolated to a
 * string-keyed record, while the original generic return type is preserved.
 */
export async function sanitizeResearch<T>(research:T):Promise<T>{
  if(!research||typeof research!=="object")return research;
  const record:Record<string,any>=research as Record<string,any>;
  const rawPeers=record["peers"];
  if(!Array.isArray(rawPeers))return research;

  const checked:any[]=[];
  for(let i=0;i<rawPeers.length;i+=3){
    checked.push(...await Promise.all(rawPeers.slice(i,i+3).map(crossCheckPeer)));
  }
  const peers=checked.map((p:any)=>validatePeer({
    ticker:p.ticker,isSubject:!!p.isSubject,price:p.price??null,revenueTTM:p.revenueTTM??null,netIncomeTTM:p.netIncomeTTM??null,grossMargin:p.grossMargin??null,netMargin:p.netMargin??null,marketCap:p.marketCap??null,peTTM:p.peTTM??null,revenueCagrPct:p.revenueCagrPct??null,cagrYears:p.cagrYears??null,gaps:p.gaps??[]
  }));
  const coverage=peerCoverage(peers,70),valid=peers.filter((p:any)=>p.comparable&&p.revenueTTM!=null&&p.revenueTTM>0),pool=valid.reduce((s:number,p:any)=>s+p.revenueTTM,0),subject=valid.find((p:any)=>p.isSubject),withGrowth=valid.filter((p:any)=>p.revenueCagrPct!=null),growthWeight=withGrowth.reduce((s:number,p:any)=>s+p.revenueTTM,0),poolCagr=growthWeight>0?withGrowth.reduce((s:number,p:any)=>s+p.revenueCagrPct*p.revenueTTM,0)/growthWeight:null,old=record["sizing"]??{};
  const sizing={...old,peerPoolRevenue:coverage.publishPool&&pool>0?pool:null,contributors:valid.length,unreadable:peers.length-valid.length,subjectSharePct:coverage.publishPool&&subject&&pool>0?subject.revenueTTM/pool*100:null,poolCagrPct:coverage.publishPool&&poolCagr!=null?Math.round(poolCagr*10)/10:null,coverage,definition:coverage.publishPool?`Comparable revenue pool using ${valid.length}/${peers.length} validated names. TTM revenue is cross-checked against the latest annual filing; margins are recomputed from the same numerator/denominator basis.`:coverage.note,limits:[...(Array.isArray(old.limits)?old.limits:[]),...peers.flatMap((p:any)=>(p.validationWarnings??[]).map((w:string)=>`${p.ticker}: ${w}`)).slice(0,16)]};
  return{...record,peers,sizing} as T;
}
