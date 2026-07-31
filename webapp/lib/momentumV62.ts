import { runMomentumV61, MOMENTUM_V61_UNIVERSE } from "./momentumV61";

export const MOMENTUM_V62_UNIVERSE = MOMENTUM_V61_UNIVERSE;

/**
 * v6.2 is a post-underwriting survival gate on top of v6.1.
 * It exists because a mathematically valid 1:3 setup can still be a bad swing if
 * the stop is sitting inside ordinary two-day volatility or if earnings are too near.
 */
export async function runMomentumV62(universe=MOMENTUM_V62_UNIVERSE, topN=5){
  const raw:any = await runMomentumV61(universe, Math.max(topN*3, 12));
  const rejected=[...(raw.rejected??[])];
  const survivors:any[]=[];

  for(const p of raw.setups??[]){
    const mid=((p.entryLow??0)+(p.entryHigh??0))/2;
    if(!(mid>0) || !(p.stop>0)) { rejected.push({ticker:p.ticker,reason:"v6.2: invalid entry/stop geometry"}); continue; }
    const riskPct=((mid-p.stop)/mid)*100;
    const atrPct=typeof p.atrPct==="number"?p.atrPct:null;
    const minNoiseBuffer=Math.max(2.5, atrPct==null?2.5:atrPct*1.10);
    const maxRisk=6.5;
    if(riskPct<minNoiseBuffer){rejected.push({ticker:p.ticker,reason:`v6.2 survival guard: stop ${riskPct.toFixed(1)}% away is inside normal volatility; need ≥${minNoiseBuffer.toFixed(1)}%`});continue;}
    if(riskPct>maxRisk){rejected.push({ticker:p.ticker,reason:`v6.2 risk guard: ${riskPct.toFixed(1)}% stop exceeds ${maxRisk}% max swing risk`});continue;}

    const m=String(p.catalystHorizon??"").match(/(-?\d+)\s+days/i);
    const days=m?Number(m[1]):null;
    if(days!=null && days>=0 && days<=5){rejected.push({ticker:p.ticker,reason:`v6.2 earnings guard: projected report in ${days} days; no new swing inside 5 trading-day risk window`});continue;}

    if((p.expectedReturnPct??0)<12){rejected.push({ticker:p.ticker,reason:`v6.2 expectancy guard: expected move ${p.expectedReturnPct?.toFixed?.(1)??"n/a"}% below 12%`});continue;}
    if((p.volumeVs20D??0)<1.1 && (p.vol5Vs20D??0)<1){rejected.push({ticker:p.ticker,reason:"v6.2 participation guard: neither current nor 5D volume confirms accumulation"});continue;}
    if(p.dataQuality==="LIMITED"){rejected.push({ticker:p.ticker,reason:"v6.2 data-quality guard: LIMITED coverage cannot become a trade recommendation"});continue;}

    survivors.push({...p,version:"6.2",survivalGuard:{riskPct:Math.round(riskPct*10)/10,minNoiseBufferPct:Math.round(minNoiseBuffer*10)/10,earningsDays:days,status:"PASS"}});
  }

  survivors.sort((a,b)=>(b.score??0)-(a.score??0));
  const out=survivors.slice(0,topN);
  return {...raw,version:"6.2",setups:out,rejected,methodology:`${raw.methodology} v6.2 adds a 2-day survival/noise buffer, 6.5% max stop-risk, 5-day earnings exclusion, ≥12% expected-move hurdle and participation/data-quality guards.`,noQualifiers:out.length?null:"No names cleared the institutional v6.2 survival, event-risk and expectancy gates."};
}
