import { runMomentumV61, MOMENTUM_V61_UNIVERSE } from "./momentumV61";

export const MOMENTUM_V62_UNIVERSE = MOMENTUM_V61_UNIVERSE;

export interface NearQualifiedMomentum {
  ticker: string;
  name: string;
  score: number;
  price: number | null;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  targetLow: number | null;
  targetHigh: number | null;
  expectedReturnPct: number | null;
  riskReward: number | null;
  sector: string | null;
  setupType: string;
  reasons: string[];
  status: "WATCHLIST — NOT A TRADE";
}

/**
 * v6.2 is the tradable-survival layer on top of v6.1.
 * A candidate that fails this layer is not silently discarded: it is returned
 * as near-qualified research inventory, but never labelled as a trade setup.
 */
export async function runMomentumV62(universe=MOMENTUM_V62_UNIVERSE, topN=5){
  const raw:any = await runMomentumV61(universe, Math.max(topN*3, 12));
  const rejected=[...(raw.rejected??[])];
  const survivors:any[]=[];
  const nearQualified:NearQualifiedMomentum[]=[];

  const watch = (p:any, reasons:string[]) => {
    nearQualified.push({
      ticker:String(p.ticker??"").toUpperCase(),
      name:p.name??p.ticker??"Unknown",
      score:Number(p.score??0),
      price:typeof p.price==="number"?p.price:null,
      entryLow:typeof p.entryLow==="number"?p.entryLow:null,
      entryHigh:typeof p.entryHigh==="number"?p.entryHigh:null,
      stop:typeof p.stop==="number"?p.stop:null,
      targetLow:typeof p.targetLow==="number"?p.targetLow:null,
      targetHigh:typeof p.targetHigh==="number"?p.targetHigh:null,
      expectedReturnPct:typeof p.expectedReturnPct==="number"?p.expectedReturnPct:null,
      riskReward:typeof p.riskReward==="number"?p.riskReward:null,
      sector:p.sector??null,
      setupType:p.setupType??"Momentum candidate",
      reasons,
      status:"WATCHLIST — NOT A TRADE",
    });
  };

  for(const p of raw.setups??[]){
    const reasons:string[]=[];
    const mid=((p.entryLow??0)+(p.entryHigh??0))/2;
    if(!(mid>0) || !(p.stop>0)) reasons.push("Invalid entry/stop geometry");

    const riskPct=mid>0&&p.stop>0?((mid-p.stop)/mid)*100:null;
    const atrPct=typeof p.atrPct==="number"?p.atrPct:null;
    const minNoiseBuffer=Math.max(2.5, atrPct==null?2.5:atrPct*1.10);
    const maxRisk=6.5;
    if(riskPct!=null && riskPct<minNoiseBuffer) reasons.push(`Stop ${riskPct.toFixed(1)}% away is inside normal volatility; need ≥${minNoiseBuffer.toFixed(1)}%`);
    if(riskPct!=null && riskPct>maxRisk) reasons.push(`${riskPct.toFixed(1)}% stop exceeds ${maxRisk}% max swing risk`);

    const m=String(p.catalystHorizon??"").match(/(-?\d+)\s+days/i);
    const days=m?Number(m[1]):null;
    if(days!=null && days>=0 && days<=5) reasons.push(`Projected earnings/reporting event in ${days} days`);
    if((p.expectedReturnPct??0)<12) reasons.push(`Expected move ${p.expectedReturnPct?.toFixed?.(1)??"n/a"}% is below 12%`);
    if((p.volumeVs20D??0)<1.1 && (p.vol5Vs20D??0)<1) reasons.push("Current and 5-day volume do not yet confirm accumulation");
    if(p.dataQuality==="LIMITED") reasons.push("Data coverage is LIMITED");

    if(reasons.length){
      watch(p,reasons);
      rejected.push({ticker:p.ticker,reason:`v6.2 watchlist only: ${reasons.join("; ")}`});
      continue;
    }

    survivors.push({...p,version:"6.2",survivalGuard:{riskPct:Math.round((riskPct??0)*10)/10,minNoiseBufferPct:Math.round(minNoiseBuffer*10)/10,earningsDays:days,status:"PASS"}});
  }

  survivors.sort((a,b)=>(b.score??0)-(a.score??0));
  nearQualified.sort((a,b)=>b.score-a.score);
  const out=survivors.slice(0,topN);
  const near=nearQualified.slice(0,Math.max(5,topN));

  return {
    ...raw,
    version:"6.2",
    setups:out,
    nearQualified:near,
    rejected,
    methodology:`${raw.methodology} v6.2 adds a 2-day survival/noise buffer, 6.5% max stop-risk, 5-day earnings exclusion, ≥12% expected-move hurdle and participation/data-quality guards. Candidates that fail only this final layer are retained as watchlist research, not trade recommendations.`,
    noQualifiers:out.length?null:near.length
      ? `No name is trade-ready under v6.2. ${near.length} candidate(s) passed the earlier institutional screen and remain near-qualified for monitoring.`
      : "No names cleared the institutional v6.2 survival, event-risk and expectancy gates.",
  };
}
