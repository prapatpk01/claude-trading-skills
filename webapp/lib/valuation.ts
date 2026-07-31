// Scenario valuation anchored in the stock's own trading history.
// Split-aware: per-share fundamentals from filings can be on a different basis
// from current prices after corporate actions. Current P/E and spot are used as
// a sanity anchor before historical multiples are trusted.

import type { Candle } from "./types";
import type { AnnualEps } from "./sec";

export interface MultipleScenarios {
  peLow:number; peMid:number; peHigh:number; forwardEps:number; epsGrowth:number;
  bear:number; base:number; bull:number; observations:number; method:string;
  basisNormalized?: boolean;
}
const pctile=(s:number[],p:number)=>{if(!s.length)return NaN;if(s.length===1)return s[0];const i=(s.length-1)*p,l=Math.floor(i),h=Math.ceil(i);return l===h?s[l]:s[l]+(s[h]-s[l])*(i-l)};
const round2=(x:number)=>Math.round(x*100)/100;

export function historicalPeSamples(candles:Candle[],annualEps:AnnualEps[]):number[]{
 if(!candles.length||!annualEps.length)return[];
 const positives=annualEps.map(e=>e.eps).filter(e=>e>0).sort((a,b)=>a-b),med=positives.length?pctile(positives,.5):0;
 const usable=annualEps.filter(e=>e.eps>0&&(med<=0||e.eps>=med*.45));
 const asc=[...(usable.length?usable:annualEps)].sort((a,b)=>a.end.localeCompare(b.end)),samples:number[]=[];
 for(let i=0;i<candles.length;i+=21){const c=candles[i];let eps:number|null=null;for(const e of asc){const reported=new Date(new Date(e.end).getTime()+60*86400000).toISOString().slice(0,10);if(reported<=c.date)eps=e.eps}if(eps&&eps>0&&c.close>0){const pe=c.close/eps;if(pe>0&&pe<400)samples.push(pe)}}
 return samples.sort((a,b)=>a-b);
}

export function multipleScenarios(candles:Candle[],annualEps:AnnualEps[],epsTTM:number|null,currentPe:number|null):MultipleScenarios|null{
 const spot=candles.at(-1)?.close??null;
 let eps0=epsTTM??annualEps[0]?.eps??null;
 if(!eps0||eps0<=0)return null;

 // Per-share basis guard. Example: a 10-for-1 split can leave SEC EPS/history
 // and adjusted market prices on different bases. If current P/E × EPS does not
 // reconstruct spot within ±45%, normalize the whole EPS history to today's basis.
 let normalized=false;
 let series=annualEps;
 if(spot&&currentPe&&currentPe>0){
   const implied=currentPe*eps0;
   const ratio=implied/spot;
   if(ratio<.55||ratio>1.45){
     const normalizedEps=spot/currentPe;
     const scale=normalizedEps/eps0;
     if(Number.isFinite(scale)&&scale>0&&scale<100){
       eps0=normalizedEps;
       series=annualEps.map(e=>({...e,eps:e.eps*scale}));
       normalized=true;
     }
   }
 }

 let growth=.08;
 if(series.length>=2){const newest=series[0].eps,oldest=series[Math.min(series.length-1,4)].eps,years=Math.min(series.length-1,4);if(oldest>0&&newest>0&&years>0){const cagr=Math.pow(newest/oldest,1/years)-1;growth=Math.max(-.15,Math.min(.35,cagr*.7))}}
 const forwardEps=eps0*(1+growth),samples=historicalPeSamples(candles,series);
 let peLow:number,peMid:number,peHigh:number,method:string;
 if(samples.length>=8){peMid=pctile(samples,.5);peLow=Math.max(pctile(samples,.25),peMid*.65);peHigh=Math.min(pctile(samples,.75),peMid*1.5);method=`Historical P/E percentiles (${samples.length} monthly observations) applied to forward EPS`;}
 else if(currentPe&&currentPe>0){peMid=currentPe;peLow=currentPe*.75;peHigh=currentPe*1.25;method="Current P/E with a ±25% re-rating band applied to forward EPS (limited history)";}
 else return null;

 let bear=peLow*forwardEps,base=peMid*forwardEps,bull=peHigh*forwardEps;
 // Final safety rail: if historical basis still implies an economically absurd
 // base (<35% or >300% of spot), discard it and anchor scenarios on today's P/E.
 if(spot&&currentPe&&currentPe>0&&(base<spot*.35||base>spot*3)){
   peMid=currentPe;peLow=currentPe*.75;peHigh=currentPe*1.25;
   bear=peLow*forwardEps;base=peMid*forwardEps;bull=peHigh*forwardEps;
   method="Current P/E anchored scenario after rejecting inconsistent historical per-share basis";
   normalized=true;
 }
 return{peLow:round2(peLow),peMid:round2(peMid),peHigh:round2(peHigh),forwardEps:round2(forwardEps),epsGrowth:Math.round(growth*1000)/10,bear:round2(bear),base:round2(base),bull:round2(bull),observations:samples.length,method:normalized?`${method}. Per-share basis normalized against current spot and P/E to protect against split/corporate-action mismatch.`:method,basisNormalized:normalized};
}

export function scenarioProbabilities(momentumScore:number,price:number,base:number){let bull=25,bear=25;const mom=(momentumScore-50)/50;bull+=mom*12;bear-=mom*12;if(base>0&&price>0){const stretch=Math.max(-.6,Math.min(.6,(price-base)/base));bull-=stretch*15;bear+=stretch*15}bull=Math.max(10,Math.min(50,Math.round(bull)));bear=Math.max(10,Math.min(50,Math.round(bear)));if(bull+bear>80){const scale=80/(bull+bear);bull=Math.round(bull*scale);bear=Math.round(bear*scale)}return{bull,base:100-bull-bear,bear};}
