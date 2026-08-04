"use client";

import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";

const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value);
const finite=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
const clamp=(value:number)=>Math.max(0,Math.min(100,value));

type Holding={ticker:string;shares:number;avg_cost:number;closed_at?:string|null};
type SimRow={ticker:string;currentWeight:number;afterWeight:number;afterValue:number};

export default function CIOScenarioLabV13({lang}:{lang:AppLang}){
 const[holdings,setHoldings]=useState<Holding[]>([]);
 const[market,setMarket]=useState<Record<string,any>>({});
 const[target,setTarget]=useState("MU");
 const[amount,setAmount]=useState("500");
 const[source,setSource]=useState("SGOV");
 const[loading,setLoading]=useState(true);
 const t=(en:string,th:string)=>lang==="th"?th:en;

 useEffect(()=>{let active=true;(async()=>{setLoading(true);try{const p=await fetch("/api/portfolio",{cache:"no-store"}).then(r=>r.json());const hs=(p.holdings??[]).filter((h:Holding)=>!h.closed_at&&Number(h.shares)>0);if(!active)return;setHoldings(hs);if(!hs.some((h:Holding)=>h.ticker===source)&&hs[0])setSource(hs[0].ticker);const tickers=hs.map((h:Holding)=>h.ticker).join(",");if(tickers){const m=await fetch(`/api/holding-market?tickers=${encodeURIComponent(tickers)}`,{cache:"no-store"}).then(r=>r.json());if(active)setMarket(m.items??{})}}finally{if(active)setLoading(false)}})();return()=>{active=false}},[]);

 const sim=useMemo(()=>{
  const rows=holdings.map(holding=>{const price=finite(market[holding.ticker]?.price)||finite(holding.avg_cost);return{ticker:holding.ticker,value:price*finite(holding.shares)}});
  const nav=rows.reduce((sum,row)=>sum+row.value,0);
  const capital=Math.max(0,finite(amount));
  const sourceAvailable=rows.find(row=>row.ticker===source)?.value??0;
  const valid=capital>0&&capital<=sourceAvailable&&target.trim().length>0&&target.trim().toUpperCase()!==source;
  const after=rows.map(row=>({ticker:row.ticker,currentWeight:nav?100*row.value/nav:0,afterValue:row.ticker===source?row.value-(valid?capital:0):row.value}));
  const targetTicker=target.trim().toUpperCase();
  const existing=after.find(row=>row.ticker===targetTicker);
  if(existing)existing.afterValue+=valid?capital:0;else if(targetTicker)after.push({ticker:targetTicker,currentWeight:0,afterValue:valid?capital:0});
  const mapped:SimRow[]=after.map(row=>({...row,afterWeight:nav?100*row.afterValue/nav:0})).sort((a,b)=>b.afterWeight-a.afterWeight);
  return{nav,capital,sourceAvailable,valid,after:mapped,largest:Math.max(...mapped.map(row=>row.afterWeight),0),usage:sourceAvailable>0?capital/sourceAvailable*100:0,targetTicker};
 },[holdings,market,target,amount,source]);

 return <section className="card" data-cio-scenario-version="13.1" style={{borderTop:"2px solid var(--accent)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><span className="tag">WHAT-IF PORTFOLIO LAB · V13</span><h3 className="sub" style={{margin:"10px 0 4px"}}>{t("Capital-source and rebalance simulation","จำลองแหล่งเงินและผลหลังปรับพอร์ต")}</h3><p className="muted" style={{margin:0}}>{t("Simulation only. It never changes Holdings or sends trades.","เป็นการจำลองเท่านั้น ไม่แก้ Holdings และไม่ส่งคำสั่งซื้อขาย")}</p></div><span className="tag">NO AUTO EXECUTION</span></div>
  {loading?<div className="notice" style={{marginTop:14}}>Loading portfolio…</div>:<>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:12,marginTop:16}}>
    <Field label={t("Funding source to reduce","แหล่งเงินที่จะลด")} help={t("Select the holding that would be trimmed or sold.","เลือกหุ้นหรือสินทรัพย์ที่จะลดหรือขาย")}><select value={source} onChange={event=>setSource(event.target.value)} style={{width:"100%"}}>{holdings.map(holding=><option key={holding.ticker} value={holding.ticker}>{holding.ticker}</option>)}</select></Field>
    <Field label={t("Amount to reallocate (USD)","จำนวนเงินที่จะโยก (USD)")} help={t("Dollar value, not number of shares.","เป็นจำนวนเงินดอลลาร์ ไม่ใช่จำนวนหุ้น")}><input value={amount} onChange={event=>setAmount(event.target.value)} inputMode="decimal" placeholder="500" style={{width:"100%"}}/></Field>
    <Field label={t("New investment ticker","หุ้นปลายทางที่จะลงทุน")} help={t("Ticker proposed for the new allocation.","Ticker ที่เสนอให้นำเงินไปลงทุน")}><input value={target} onChange={event=>setTarget(event.target.value.toUpperCase())} placeholder="MU" style={{width:"100%"}}/></Field>
   </div>

   <div className="card" style={{marginTop:14,padding:16}}><span className={`tag ${sim.valid?"":"err"}`}>{sim.valid?"SIMULATION READY":"CHECK CAPITAL"}</span><div style={{display:"grid",gridTemplateColumns:"1fr auto 1fr auto 1fr",gap:10,alignItems:"center",marginTop:14,textAlign:"center"}}><FlowNode label={t("Reduce holding","ลดสินทรัพย์")} value={source} note={t("Simulation SELL/TRIM","จำลอง SELL/TRIM")}/><FlowArrow/><FlowNode label={t("Cash proceeds","เงินจากการขาย")} value={money(sim.capital)} note={t("Reallocation amount","จำนวนเงินที่จะโยก")}/><FlowArrow/><FlowNode label={t("Proposed investment","การลงทุนใหม่")} value={sim.targetTicker||"—"} note={t("Simulation BUY","จำลอง BUY")}/></div><p className="muted" style={{margin:"12px 0 0",textAlign:"center"}}>{source} → {money(sim.capital)} {t("cash","เงินสด")} → {sim.targetTicker||"—"}</p></div>

   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginTop:14}}><Gauge title={t("Funding source used","สัดส่วนแหล่งเงินที่ใช้")} value={sim.valid?sim.usage:0} display={sim.valid?`${sim.usage.toFixed(1)}%`:"—"}/><Gauge title={t("Largest weight after","น้ำหนักสูงสุดหลังปรับ")} value={sim.largest} display={`${sim.largest.toFixed(1)}%`}/><Metric label="Portfolio NAV" value={money(sim.nav)}/><Metric label={`${source} available`} value={money(sim.sourceAvailable)}/></div>
   {!sim.valid&&<div className="err" style={{marginTop:12}}>{t("Amount must be positive, cannot exceed the selected funding source, and the target must differ from the source.","จำนวนเงินต้องมากกว่า 0 ไม่เกินมูลค่าแหล่งเงิน และหุ้นปลายทางต้องไม่ซ้ำกับแหล่งเงิน")}</div>}

   <section className="card" style={{marginTop:14,padding:16}}><h4 style={{margin:"0 0 12px"}}>{t("Before vs after portfolio weights","เปรียบเทียบน้ำหนักก่อนและหลัง")}</h4>{sim.after.slice(0,10).map(row=><WeightRow key={row.ticker} row={row}/>)}</section>

   <div className="table-wrap" style={{marginTop:14}}><table className="tbl"><thead><tr><th>Ticker</th><th className="num">Current weight</th><th className="num">After weight</th><th className="num">Change</th></tr></thead><tbody>{sim.after.map(row=><tr key={row.ticker}><td><strong>{row.ticker}</strong></td><td className="num">{row.currentWeight.toFixed(2)}%</td><td className="num">{row.afterWeight.toFixed(2)}%</td><td className={`num ${row.afterWeight-row.currentWeight>=0?"pos":"neg"}`}>{(row.afterWeight-row.currentWeight>=0?"+":"")+(row.afterWeight-row.currentWeight).toFixed(2)}%</td></tr>)}</tbody></table></div>
   <div className="notice" style={{marginTop:14}}>{t("This means a simulated reduction of the funding source and a simulated purchase of the target. To execute an approved scenario, record the actual SELL and BUY separately in Portfolio Operations.","รายการนี้หมายถึงการจำลองลดแหล่งเงินและจำลองซื้อหุ้นปลายทาง หากอนุมัติจริงต้องบันทึก SELL และ BUY แยกกันใน Portfolio Operations")}</div>
  </>}
 </section>
}

function Field({label,help,children}:{label:string;help:string;children:React.ReactNode}){return <label className="metric" style={{display:"block"}}><span style={{display:"block",marginBottom:8}}>{label}</span>{children}<small className="muted" style={{display:"block",marginTop:7}}>{help}</small></label>}
function FlowNode({label,value,note}:{label:string;value:string;note:string}){return <div className="metric" style={{minWidth:0}}><span>{label}</span><strong style={{fontSize:20,overflowWrap:"anywhere"}}>{value}</strong><small className="muted">{note}</small></div>}
function FlowArrow(){return <strong aria-hidden="true" style={{fontSize:24,color:"var(--accent)"}}>→</strong>}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
function Gauge({title,value,display}:{title:string;value:number;display:string}){const score=clamp(value);return <div className="metric" style={{textAlign:"center"}}><div style={{width:108,height:108,borderRadius:"50%",margin:"0 auto",display:"grid",placeItems:"center",background:`conic-gradient(var(--accent) ${score*3.6}deg,rgba(100,120,170,.16) 0)`}}><div style={{width:80,height:80,borderRadius:"50%",background:"var(--panel)",display:"grid",placeItems:"center",fontSize:20,fontWeight:800}}>{display}</div></div><strong style={{display:"block",fontSize:13,marginTop:9}}>{title}</strong></div>}
function WeightRow({row}:{row:SimRow}){const max=Math.max(row.currentWeight,row.afterWeight,1);return <div style={{display:"grid",gridTemplateColumns:"58px 1fr 52px",gap:9,alignItems:"center",marginTop:10}}><strong style={{fontSize:12}}>{row.ticker}</strong><div><div style={{height:7,borderRadius:99,background:"rgba(100,120,170,.14)",overflow:"hidden"}}><div style={{height:"100%",width:`${row.currentWeight/max*100}%`,background:"rgba(148,163,184,.65)"}}/></div><div style={{height:7,borderRadius:99,background:"rgba(100,120,170,.14)",overflow:"hidden",marginTop:4}}><div style={{height:"100%",width:`${row.afterWeight/max*100}%`,background:"linear-gradient(90deg,#31d9f3,#8f5cff)"}}/></div></div><span style={{fontSize:11,textAlign:"right"}}>{row.afterWeight.toFixed(1)}%</span></div>}
