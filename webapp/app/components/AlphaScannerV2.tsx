"use client";

import { useState } from "react";
import type { AppLang } from "../page";
import { money } from "./format";

const SECTORS=["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;
type Mode="momentum"|"dividend"|"thematic";

export default function AlphaScannerV2({lang}:{lang:AppLang}){
  const[mode,setMode]=useState<Mode>("momentum");
  const[sector,setSector]=useState("All");
  const[tickers,setTickers]=useState("");
  const[holdings,setHoldings]=useState(8);
  const[cadence,setCadence]=useState<"monthly"|"quarterly">("monthly");
  const[loading,setLoading]=useState(false);
  const[result,setResult]=useState<any>(null);
  const[error,setError]=useState<string|null>(null);

  async function scan(){
    setLoading(true);setError(null);setResult(null);
    try{
      const qs=new URLSearchParams({mode,sector,top:"5",holdings:String(holdings),cadence});
      if(mode!=="thematic"&&tickers.trim())qs.set("tickers",tickers.trim());
      const r=await fetch(`/api/scan?${qs}`,{cache:"no-store"});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Scan failed");
      setResult(j);
    }catch(e:any){setError(e.message)}finally{setLoading(false)}
  }

  return <div>
    <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div><h2 className="section" style={{margin:0}}>📡 {tr(lang,"Alpha Discovery Scanner","ระบบค้นหา Alpha")}</h2><div className="muted" style={{fontSize:11,marginTop:5}}>Sentinel Capital · Opportunity Discovery Desk</div></div>
        {mode==="momentum"&&<span className="tag">Institutional High-Beta v6.2</span>}
      </div>
      <div className="grid cols-3" style={{marginTop:16}}>
        <ModeButton active={mode==="momentum"} onClick={()=>{setMode("momentum");setResult(null)}}>⚡ {tr(lang,"Momentum Pick","หุ้น Momentum")}</ModeButton>
        <ModeButton active={mode==="dividend"} onClick={()=>{setMode("dividend");setResult(null)}}>💰 {tr(lang,"Dividend Quality","หุ้นปันผลคุณภาพ")}</ModeButton>
        <ModeButton active={mode==="thematic"} onClick={()=>{setMode("thematic");setResult(null)}}>🧭 {tr(lang,"Thematic Portfolio","พอร์ตตาม Theme")}</ModeButton>
      </div>
      <div className="notice" style={{marginTop:14,lineHeight:1.65}}>
        {mode==="momentum"?tr(lang,
          "Trade-ready names must clear every v6.2 gate. Candidates that pass the institutional screen but fail only the final timing, event-risk, volume or expectancy layer are now retained as Near-Qualified watchlist research.",
          "หุ้นที่เป็นสัญญาณเทรดต้องผ่านเกณฑ์ v6.2 ทุกข้อ ส่วนหุ้นที่ผ่านการคัดกรองระดับสถาบันแต่ยังติดเงื่อนไขจังหวะ ข่าวงบ Volume หรือผลตอบแทนคาดหวัง จะถูกเก็บเป็น Near-Qualified สำหรับติดตามใน Watchlist"):
        mode==="dividend"?tr(lang,
          "Ranks dividend durability, cash-flow coverage, dividend growth, quality, valuation, thesis, catalysts and risks. Qualified names can be sent directly to the fund watchlist.",
          "จัดอันดับจากความยั่งยืนของปันผล กระแสเงินสด การเติบโต คุณภาพ Valuation Thesis Catalyst และ Risk พร้อมส่งหุ้นที่ผ่านเข้า Watchlist ของกองทุนได้ทันที"):
          tr(lang,"Build a concentrated thematic portfolio and send selected names into the fund research queue.","สร้างพอร์ตตามธีมแบบกระจุกตัวและส่งหุ้นที่เลือกเข้าสู่คิววิจัยของกองทุน")}
      </div>
      {mode==="thematic"?<div className="searchbar" style={{marginTop:14}}>
        <select value={holdings} onChange={e=>setHoldings(Number(e.target.value))}>{[5,6,7,8,9,10].map(n=><option key={n} value={n}>{n} {tr(lang,"stocks","หุ้น")}</option>)}</select>
        <select value={cadence} onChange={e=>setCadence(e.target.value as any)}><option value="monthly">{tr(lang,"Monthly review","ทบทวนรายเดือน")}</option><option value="quarterly">{tr(lang,"3-month review","ทบทวนทุก 3 เดือน")}</option></select>
        <button className="btn" onClick={scan} disabled={loading}>{loading?tr(lang,"Building…","กำลังจัดพอร์ต…"):tr(lang,"Build Portfolio","สร้างพอร์ต")}</button>
      </div>:<div className="searchbar" style={{marginTop:14}}>
        <select value={sector} onChange={e=>setSector(e.target.value)}>{SECTORS.map(s=><option key={s} value={s}>{s==="All"?tr(lang,"All sectors","ทุก Sector"):s}</option>)}</select>
        <input value={tickers} onChange={e=>setTickers(e.target.value)} placeholder={tr(lang,"Optional override: NVDA, AVGO, JPM…","ระบุหุ้นเองได้: NVDA, AVGO, JPM…")} style={{flex:1,minWidth:220}}/>
        <button className="btn" onClick={scan} disabled={loading}>{loading?tr(lang,"Institutional scan in progress…","กำลังสแกนแบบสถาบัน…"):tr(lang,"Run Institutional Scan","เริ่มสแกน")}</button>
      </div>}
      {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
    </div>
    {result?.mode==="momentum"&&<MomentumResults result={result} lang={lang}/>} 
    {result?.mode==="dividend"&&<DividendResults result={result} lang={lang}/>} 
    {result?.mode==="thematic"&&<ThematicResults result={result} lang={lang}/>} 
  </div>
}

function ModeButton({active,onClick,children}:{active:boolean;onClick:()=>void;children:any}){return <button className={`btn ${active?"":"ghost"}`} onClick={onClick}>{children}</button>}

function MomentumResults({result,lang}:{result:any;lang:AppLang}){
  const r=result.regime;
  return <>
    <div className="card" style={{borderTop:"2px solid var(--accent)"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><h3 className="sub" style={{margin:0}}>🌐 MARKET REGIME — {String(result.asOf??"").slice(0,10)}</h3><span className="tag">v{result.version}</span></div>
      <div className="grid cols-4" style={{marginTop:12}}><Metric label="Market Score" value={`${r?.score??"—"}/100`}/><Metric label={tr(lang,"Classification","สภาวะตลาด")} value={r?.classification??r?.stance??"—"}/><Metric label="SPY vs 20EMA" value={r?.spy?.above??r?.spyAboveEma20?"ABOVE":"BELOW"}/><Metric label="QQQ vs 20EMA" value={r?.qqq?.above==null?"—":r.qqq.above?"ABOVE":"BELOW"}/></div>
      <p className="muted" style={{fontSize:11}}>{tr(lang,`Scanned ${result.scanned} liquid/high-beta names. Trade cards require every hard gate; near-qualified cards are research only.`,`สแกนหุ้นสภาพคล่องสูง/High-Beta ${result.scanned} ตัว การ์ดสัญญาณเทรดต้องผ่านทุก Hard Gate ส่วน Near-Qualified ใช้เพื่อวิจัยและติดตามเท่านั้น`)}</p>
    </div>
    {result.noQualifiers&&<div className="card"><div className="notice">{result.noQualifiers}</div></div>}
    {(result.setups??[]).map((s:any,i:number)=><MomentumCard key={s.ticker} s={s} i={i} lang={lang}/>) }
    {(result.nearQualified??[]).length>0&&<div className="card">
      <h3 className="sub">🟡 {tr(lang,"Near-Qualified Momentum — Watchlist Research","Momentum ที่เกือบผ่าน — ส่งเข้าวิจัยใน Watchlist")}</h3>
      <p className="muted" style={{fontSize:12,lineHeight:1.6}}>{tr(lang,"These names passed the earlier institutional screen but are not trade-ready. Add them to the watchlist so Research, Macro, Risk and Portfolio Construction can review them in the next fund meeting.","หุ้นเหล่านี้ผ่านการคัดกรองระดับสถาบันขั้นต้น แต่ยังไม่พร้อมเทรด สามารถเพิ่มเข้า Watchlist เพื่อให้ทีม Research, Macro, Risk และ Portfolio Construction นำเข้าประชุมกองทุนรอบถัดไป")}</p>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th className="num">Score</th><th>{tr(lang,"Blockers","เหตุผลที่ยังไม่ผ่าน")}</th><th>{tr(lang,"Action","ดำเนินการ")}</th></tr></thead><tbody>{result.nearQualified.map((p:any)=><tr key={p.ticker}><td><strong>{p.ticker}</strong><div className="muted" style={{fontSize:10}}>{p.name}</div></td><td className="num">{p.score}/100</td><td style={{fontSize:11.5}}>{(p.reasons??[]).join(" · ")}</td><td><WatchlistButton lang={lang} ticker={p.ticker} source="Momentum Near-Qualified v6.2" reason={`Near-qualified momentum ${p.score}/100. Blockers: ${(p.reasons??[]).join("; ")}`} entry={p.entryLow} stop={p.stop} target={p.targetLow}/></td></tr>)}</tbody></table></div>
    </div>}
  </>
}

function MomentumCard({s,i,lang}:{s:any;i:number;lang:AppLang}){return <div className="card setup-card" style={{borderTop:i===0?"2px solid var(--green)":"1px solid var(--border-strong)"}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:10}}>#{i+1} · {s.setupType}</div><h2 className="section" style={{margin:"4px 0"}}>{s.ticker} · {s.name}</h2><div className="muted" style={{fontSize:11}}>{s.sector} · {s.sectorTheme}</div></div><div style={{textAlign:"right"}}><div className="badge-score">{s.score}<span style={{fontSize:13}}>/100</span></div><span className="pill buy">TRADE-READY</span></div></div>
  <div className="grid cols-4" style={{marginTop:14}}><Metric label={tr(lang,"Entry Zone","โซนเข้า")} value={`${money(s.entryLow)}–${money(s.entryHigh)}`}/><Metric label="Stop" value={money(s.stop)}/><Metric label={tr(lang,"Target Zone","โซนเป้าหมาย")} value={`${money(s.targetLow)}–${money(s.targetHigh)}`}/><Metric label="R:R" value={`1:${s.riskReward?.toFixed?.(1)??"—"}`}/></div>
  <div className="grid cols-4" style={{marginTop:10}}><Metric label={tr(lang,"Current Price","ราคาปัจจุบัน")} value={money(s.price)} sub={`${s.source??""} · ${s.dateConfirmed??""}`}/><Metric label={tr(lang,"Expected Return","ผลตอบแทนคาดหวัง")} value={s.expectedReturnPct==null?"—":`+${s.expectedReturnPct.toFixed(1)}%`}/><Metric label={tr(lang,"Model Probability","ความน่าจะเป็นโมเดล")} value={`${s.winProbability??"—"}%`}/><Metric label="Data Quality" value={s.dataQuality??"—"}/></div>
  <h3 className="sub">🔥 Catalyst</h3><div className="notice"><strong>{s.catalystHorizon}</strong><br/>{s.catalyst}</div>
  <div style={{marginTop:12}}><WatchlistButton lang={lang} ticker={s.ticker} source="Momentum Trade-Ready v6.2" reason={`Trade-ready momentum ${s.score}/100. ${s.catalyst??""}`} entry={s.entryLow} stop={s.stop} target={s.targetLow}/></div>
</div>}

function DividendResults({result,lang}:{result:any;lang:AppLang}){return <>
  <div className="card"><h3 className="sub">💰 {tr(lang,"DIVIDEND QUALITY RANKING","อันดับหุ้นปันผลคุณภาพ")}</h3><p className="muted" style={{fontSize:12,lineHeight:1.6}}>{result.methodology}</p><div className="grid cols-3"><Metric label={tr(lang,"Universe scanned","จำนวนที่สแกน")} value={result.scanned}/><Metric label={tr(lang,"Qualified","ผ่านเกณฑ์")} value={result.picks?.length??0}/><Metric label={tr(lang,"Rejected","ไม่ผ่าน")} value={result.rejected?.length??0}/></div></div>
  {result.noQualifiers&&<div className="card"><div className="notice">{result.noQualifiers}</div></div>}
  {(result.picks??[]).map((p:any,i:number)=><div className="card setup-card" key={p.ticker}><div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}><div><div className="muted" style={{fontSize:10}}>#{i+1} · {p.dataQuality} DATA</div><h2 className="section" style={{margin:"4px 0"}}>{p.ticker} · {p.name}</h2><div className="muted" style={{fontSize:11}}>{p.sector}</div></div><div className="badge-score">{p.score}<span style={{fontSize:13}}>/100</span></div></div><div className="grid cols-4" style={{marginTop:12}}><Metric label="Yield" value={p.yieldPct==null?"—":`${p.yieldPct.toFixed(2)}%`}/><Metric label={tr(lang,"Distribution Growth","ปันผลเติบโต")} value={p.distributionGrowthPct==null?"—":`${p.distributionGrowthPct>=0?"+":""}${p.distributionGrowthPct.toFixed(1)}%`}/><Metric label="5Y Revenue CAGR" value={p.revenueGrowthPct==null?"—":`${p.revenueGrowthPct.toFixed(1)}%`}/><Metric label="DCF / Target" value={`${p.dcfFairValue==null?"—":money(p.dcfFairValue)} / ${p.targetPrice==null?"—":money(p.targetPrice)}`}/></div><h3 className="sub">🧠 {tr(lang,"Investment Thesis","Thesis การลงทุน")}</h3><p style={{lineHeight:1.65}}>{p.thesis}</p><WatchlistButton lang={lang} ticker={p.ticker} source="Dividend Quality Scanner" reason={`Dividend Quality ${p.score}/100. Yield ${p.yieldPct??"n/a"}%. ${p.thesis??""}`} target={p.targetPrice}/></div>)}
</>}

function ThematicResults({result,lang}:{result:any;lang:AppLang}){return <>
  <div className="card"><h3 className="sub">🧭 {tr(lang,"Thematic Rotation Portfolio","พอร์ตหมุนตาม Theme")}</h3><p style={{lineHeight:1.6}}>{result.methodology}</p><div className="grid cols-3"><Metric label={tr(lang,"Portfolio size","จำนวนหุ้น")} value={`${result.holdings?.length??0}/${result.requestedHoldings}`}/><Metric label={tr(lang,"Review cadence","รอบทบทวน")} value={result.cadence==="monthly"?tr(lang,"Monthly","รายเดือน"):tr(lang,"Every 3 months","ทุก 3 เดือน")}/><Metric label={tr(lang,"Cash reserve","เงินสดสำรอง")} value={`${result.cashPct??0}%`}/></div></div>
  {result.themes?.length>0&&<div className="card"><h3 className="sub">🔥 {tr(lang,"Leading Themes","Theme ที่นำตลาด")}</h3><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{result.themes.map((g:any)=><span className="tag" key={g.proxy}>{g.label} · {g.proxy} · {g.leadership}/100</span>)}</div></div>}
  <div className="card"><h3 className="sub">💼 {tr(lang,"Proposed Portfolio & Research Queue","พอร์ตที่เสนอและคิววิจัย")}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>#</th><th>Ticker</th><th>Theme</th><th className="num">Weight</th><th className="num">Score</th><th>{tr(lang,"Action","ดำเนินการ")}</th></tr></thead><tbody>{(result.holdings??[]).map((h:any,i:number)=><tr key={h.ticker}><td>{i+1}</td><td><strong>{h.ticker}</strong></td><td>{h.theme}</td><td className="num">{h.weightPct?.toFixed(1)}%</td><td className="num">{h.score}</td><td><WatchlistButton lang={lang} ticker={h.ticker} source={`Thematic Scanner · ${h.theme}`} reason={`Thematic candidate ${h.score}/100, proposed weight ${h.weightPct?.toFixed?.(1)??"—"}%. ${h.rationale??""}`}/></td></tr>)}</tbody></table></div></div>
</>}

function WatchlistButton({lang,ticker,source,reason,entry,stop,target}:{lang:AppLang;ticker:string;source:string;reason:string;entry?:number|null;stop?:number|null;target?:number|null}){
  const[state,setState]=useState<"idle"|"saving"|"saved"|"error">("idle");
  async function add(){
    setState("saving");
    try{
      const r=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker,source,reason,entry_price:entry??null,stop_price:stop??null,target_price:target??null})});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Save failed");
      setState("saved");
    }catch{setState("error")}
  }
  return <button className={`btn sm ${state==="saved"?"ghost":""}`} onClick={add} disabled={state==="saving"||state==="saved"}>
    {state==="saving"?tr(lang,"Saving…","กำลังบันทึก…"):state==="saved"?tr(lang,"✓ In Watchlist","✓ อยู่ใน Watchlist แล้ว"):state==="error"?tr(lang,"Retry add","ลองเพิ่มอีกครั้ง"):tr(lang,"＋ Add to Watchlist","＋ เพิ่มเข้า Watchlist")}
  </button>
}

function Metric({label,value,sub}:{label:string;value:any;sub?:string}){return <div className="metric"><div className="label">{label}</div><div className="value" style={{fontSize:18}}>{value}</div>{sub&&<div className="muted" style={{fontSize:10,marginTop:3}}>{sub}</div>}</div>}
