"use client";

import {useMemo,useState} from "react";
import type {AppLang} from "../page";
import SwingScanPanel from "./SwingScanPanel";

type Mode="momentum"|"growth"|"quality"|"value"|"dividend"|"institutional"|"ai"|"thematic"|"multifactor";
type StageId="universe"|"analyzed"|"qualified"|"valuation"|"selected"|"rejected";
type SortKey="score"|"upside"|"ticker";
type Candidate={
 ticker:string;name?:string;sector?:string;price?:number|null;targetPrice?:number|null;expectedReturnPct?:number|null;
 composite?:number;momentum?:number;growth?:number;quality?:number;value?:number;dividend?:number;institutional?:number;ai?:number;
 portfolioWeightPct?:number;allocationRank?:number;passed?:boolean;status?:string;failedGates?:string[];valuationFailures?:string[];
 rejectionReasons?:string[];reasons?:string[];thesis?:string;dataQuality?:string;engines?:string[];consensusCount?:number;
};
type Pipeline=Record<string,number>;
type Result={
 mode:Mode;asOf?:string;theme?:{label:string;benchmark:string}|null;universeSource?:string;pipeline?:Pipeline;stats?:Record<string,number>;
 stageCandidates?:Partial<Record<StageId,Candidate[]>>;picks?:Candidate[];rejectedCandidates?:Candidate[];methodology?:string;
 portfolio?:{holdings:number;totalWeightPct:number;status:string}|null;warnings?:string[];
};

const MODES:{id:Mode;icon:string;en:string;th:string;noteEn:string;noteTh:string}[]=[
 {id:"multifactor",icon:"◈",en:"Multi-Factor",th:"หลายปัจจัย",noteEn:"Balanced institutional composite",noteTh:"จัดอันดับแบบสมดุลหลายมิติ"},
 {id:"momentum",icon:"🚀",en:"Momentum",th:"โมเมนตัม",noteEn:"Relative strength, trend and volume",noteTh:"แนวโน้ม ความแข็งแกร่ง และปริมาณซื้อขาย"},
 {id:"growth",icon:"📈",en:"Growth",th:"เติบโต",noteEn:"Revenue, earnings and margin expansion",noteTh:"รายได้ กำไร และมาร์จิ้นเติบโต"},
 {id:"quality",icon:"⭐",en:"Quality",th:"คุณภาพ",noteEn:"ROE, free cash flow and balance sheet",noteTh:"ROE กระแสเงินสด และงบดุล"},
 {id:"value",icon:"💎",en:"Value",th:"มูลค่า",noteEn:"Upside and valuation discipline",noteTh:"ส่วนเผื่อความปลอดภัยและราคาเหมาะสม"},
 {id:"dividend",icon:"💵",en:"Dividend",th:"ปันผล",noteEn:"Yield, payout and durability",noteTh:"ผลตอบแทน ความปลอดภัย และความยั่งยืน"},
 {id:"institutional",icon:"🏛",en:"Institutional",th:"สถาบัน",noteEn:"Accumulation proxy from price and volume",noteTh:"สัญญาณสะสมจากราคาและปริมาณซื้อขาย"},
 {id:"ai",icon:"🧠",en:"AI / Innovation",th:"AI / นวัตกรรม",noteEn:"AI infrastructure and software",noteTh:"โครงสร้างพื้นฐานและซอฟต์แวร์ AI"},
 {id:"thematic",icon:"🔥",en:"Thematic Portfolio",th:"พอร์ตตามธีม",noteEn:"Build a weighted 5–8 stock sleeve",noteTh:"สร้างพอร์ต 5–8 หุ้นพร้อมน้ำหนัก"},
];
const THEMES=[["biotech","Biotech"],["regional-banks","Regional Banks"],["aerospace-defense","Aerospace & Defence"],["semiconductors","Semiconductors"],["cloud-software","Cloud & Software"],["cybersecurity","Cybersecurity"],["ai-infrastructure","AI Infrastructure"],["energy-transition","Energy Transition"]] as const;
const SECTORS=["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;
const money=(value:unknown)=>Number.isFinite(Number(value))?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(Number(value)):"—";
const pct=(value:unknown)=>Number.isFinite(Number(value))?`${Number(value)>=0?"+":""}${Number(value).toFixed(1)}%`:"—";
const score=(candidate:Candidate)=>Number(candidate.composite??0);

/**
 * Hand a candidate to the investment committee.
 *
 * The referral carries the price it was written at. The committee measures how
 * far the price has moved since and sends the paper back rather than sizing a
 * target that was computed against a number that no longer exists.
 */
async function referToCommittee(candidate:Candidate,engine:string){
 const response=await fetch("/api/analyze/actions",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({
   ticker:candidate.ticker,
   action:"COMMITTEE",
   rating:candidate.passed===false?"WATCH":"BUY",
   conviction:Number.isFinite(Number(candidate.composite))?Number(candidate.composite):null,
   payload:{
    source:engine,
    price:candidate.price??null,
    target:candidate.targetPrice??null,
    thesis:candidate.thesis??candidate.reasons?.join(" · ")??null,
    dataQuality:candidate.dataQuality??null,
    sector:candidate.sector??null,
   },
  }),
 });
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(body?.error??"The referral could not be recorded.");
}

export default function ResearchWorkspaceV12({lang,onNavigate}:{lang:AppLang;onNavigate:(id:string)=>void}){
 const[mode,setMode]=useState<Mode>("multifactor");
 const[sector,setSector]=useState("All");
 const[theme,setTheme]=useState("regional-banks");
 const[tickers,setTickers]=useState("");
 const[loading,setLoading]=useState(false);
 const[result,setResult]=useState<Result|null>(null);
 const[error,setError]=useState<string|null>(null);
 const[activeStage,setActiveStage]=useState<StageId>("selected");
 const[filter,setFilter]=useState("");
 const[sortKey,setSortKey]=useState<SortKey>("score");
 const[referred,setReferred]=useState<Set<string>>(new Set());
 const[referAll,setReferAll]=useState<{state:"idle"|"sending"|"done"|"error";message:string}>({state:"idle",message:""});
 const selectedMode=MODES.find(item=>item.id===mode)!;
 // The committee records where a name came from, so the engine that found it
 // travels with the referral rather than all of them arriving as "Research".
 const engineLabel=`${selectedMode.en} scan${mode==="thematic"?` · ${THEMES.find(([id])=>id===theme)?.[1]??theme}`:sector==="All"?"":` · ${sector}`}`;

 async function scan(){
  setLoading(true);setError(null);setResult(null);setFilter("");setReferred(new Set());setReferAll({state:"idle",message:""});
  try{
   const query=new URLSearchParams({mode,sector,theme,top:mode==="thematic"?"8":"10"});
   const normalizedTickers=tickers.split(",").map(value=>value.trim().toUpperCase()).filter(Boolean).join(",");
   if(normalizedTickers)query.set("tickers",normalizedTickers);
   const response=await fetch(`/api/alpha-discovery?${query}`,{cache:"no-store"});
   const json=await response.json();
   if(!response.ok)throw new Error(json.error??"Research scan failed");
   setResult(json);setActiveStage("selected");
  }catch(reason:unknown){setError(reason instanceof Error?reason.message:"Research scan failed")}finally{setLoading(false)}
 }

 const stages=useMemo(()=>{
  if(!result)return[] as {id:StageId;label:string;value:number;note:string}[];
  const pipeline=result.pipeline??{};
  const common=[
   {id:"universe" as StageId,label:tr(lang,"Universe","Universe"),value:pipeline.universe??0,note:tr(lang,"Starting coverage","จำนวนหุ้นตั้งต้น")},
   {id:"analyzed" as StageId,label:tr(lang,"Analyzed","วิเคราะห์แล้ว"),value:pipeline.analyzed??0,note:tr(lang,"Evidence collected","มีข้อมูลวิเคราะห์")},
  ];
  if(result.mode==="thematic")return[
   ...common,
   {id:"qualified" as StageId,label:tr(lang,"Factor Qualified","ผ่าน Factor"),value:pipeline.factorQualified??0,note:tr(lang,"Multi-factor gate","ผ่านเกณฑ์หลายปัจจัย")},
   {id:"valuation" as StageId,label:tr(lang,"Valuation Eligible","ผ่าน Valuation"),value:pipeline.valuationEligible??0,note:tr(lang,"Target above spot + ≥8% upside","เป้าหมายสูงกว่าราคาและ Upside ≥8%")},
   {id:"selected" as StageId,label:tr(lang,"Portfolio Selected","เลือกเข้าพอร์ต"),value:pipeline.selected??0,note:tr(lang,"Weighted to 100%","จัดน้ำหนักรวม 100%")},
   {id:"rejected" as StageId,label:tr(lang,"Rejected","ไม่ผ่าน"),value:pipeline.rejected??0,note:tr(lang,"Reasons documented","มีเหตุผลครบ")},
  ];
  return[
   ...common,
   {id:"qualified" as StageId,label:tr(lang,"Qualified","ผ่านเกณฑ์"),value:pipeline.qualified??0,note:tr(lang,"Engine-specific gate","เกณฑ์เฉพาะ Engine")},
   {id:"selected" as StageId,label:tr(lang,"Committee Ready","พร้อมเข้าประชุม"),value:pipeline.selected??0,note:tr(lang,"Top ranked shortlist","Shortlist อันดับสูงสุด")},
   {id:"rejected" as StageId,label:tr(lang,"Rejected","ไม่ผ่าน"),value:pipeline.rejected??0,note:tr(lang,"Failed gates retained","เก็บเหตุผลที่ไม่ผ่าน")},
  ];
 },[result,lang]);

 const visibleCandidates=useMemo(()=>{
  const source=result?.stageCandidates?.[activeStage]??(activeStage==="rejected"?result?.rejectedCandidates:result?.picks)??[];
  const query=filter.trim().toUpperCase();
  const filtered=query?source.filter(candidate=>`${candidate.ticker} ${candidate.name??""} ${candidate.sector??""}`.toUpperCase().includes(query)):source;
  return [...filtered].sort((left,right)=>{
   if(sortKey==="ticker")return left.ticker.localeCompare(right.ticker);
   if(sortKey==="upside")return Number(right.expectedReturnPct??-Infinity)-Number(left.expectedReturnPct??-Infinity);
   return score(right)-score(left);
  });
 },[result,activeStage,filter,sortKey]);

 const isRejected=activeStage==="rejected";
 // A desk refers a shortlist, not one name at a time.
 const committeeReady=useMemo(()=>(result?.stageCandidates?.selected??result?.picks??[]).filter(candidate=>candidate.passed!==false),[result]);
 const pendingReferral=committeeReady.filter(candidate=>!referred.has(candidate.ticker));

 async function referShortlist(){
  if(!pendingReferral.length)return;
  setReferAll({state:"sending",message:""});
  const sent:string[]=[];const failed:string[]=[];
  for(const candidate of pendingReferral){
   try{await referToCommittee(candidate,engineLabel);sent.push(candidate.ticker)}
   catch{failed.push(candidate.ticker)}
  }
  if(sent.length)setReferred(previous=>{const next=new Set(previous);for(const ticker of sent)next.add(ticker);return next});
  setReferAll({
   state:failed.length?"error":"done",
   message:failed.length
    ?tr(lang,`Referred ${sent.length}. Failed: ${failed.join(", ")}.`,`ส่งแล้ว ${sent.length} ตัว ล้มเหลว: ${failed.join(", ")}`)
    :tr(lang,`${sent.length} name(s) referred to the committee.`,`ส่ง ${sent.length} ตัวเข้าที่ประชุมแล้ว`),
  });
 }

 return <div className="research-v12" data-research-version="12.2">
  <SwingScanPanel lang={lang}/>
  <section className="card research-hero" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div><span className="tag">SENTINEL RESEARCH OS · PHASE 1</span><h2 className="section" style={{margin:"12px 0 6px"}}>{tr(lang,"Institutional Research Pipeline","ระบบวิจัยการลงทุนระดับสถาบัน")}</h2><p className="muted" style={{maxWidth:800}}>{tr(lang,"One auditable evidence chain from universe to Stock Analysis. Each stage has its own candidates and every rejection keeps an explicit reason.","กระบวนการเดียวตั้งแต่ Universe จนส่งต่อ Stock Analysis แต่ละขั้นมีรายชื่อหุ้นของตัวเองและทุกหุ้นที่ไม่ผ่านมีเหตุผลตรวจสอบได้")}</p></div>
    <div className="notice" style={{maxWidth:350}}>{tr(lang,"Research can discover, rank and add to Watchlist. It cannot execute trades or change Holdings.","Research มีหน้าที่ค้นหา จัดอันดับ และเพิ่ม Watchlist เท่านั้น ไม่สามารถซื้อขายหรือแก้ Holdings")}</div>
   </div>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:9,marginTop:16}}>
    {MODES.map(item=><button type="button" key={item.id} className={`btn ${mode===item.id?"":"ghost"}`} style={{textAlign:"left",minHeight:78}} onClick={()=>{setMode(item.id);setResult(null);setError(null)}}><strong>{item.icon} {lang==="th"?item.th:item.en}</strong><small style={{display:"block",opacity:.7,marginTop:6}}>{lang==="th"?item.noteTh:item.noteEn}</small></button>)}
   </div>
   <div className="searchbar" style={{marginTop:16}}>
    {mode==="thematic"?<select value={theme} onChange={event=>setTheme(event.target.value)}>{THEMES.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select>:<select value={sector} onChange={event=>setSector(event.target.value)}>{SECTORS.map(item=><option key={item}>{item}</option>)}</select>}
    <input value={tickers} onChange={event=>setTickers(event.target.value)} placeholder={tr(lang,"Optional ticker override, comma separated","ระบุหุ้นเองได้ คั่นด้วยเครื่องหมาย comma")} style={{flex:1,minWidth:220}}/>
    <button type="button" className="btn" onClick={scan} disabled={loading}>{loading?tr(lang,"Running institutional research…","กำลังวิเคราะห์…"):mode==="thematic"?tr(lang,"Build Thematic Portfolio","สร้างพอร์ตตามธีม"):tr(lang,`Run ${selectedMode.en} Scan`,`เริ่มสแกน ${selectedMode.th}`)}</button>
   </div>
   {tickers.trim()&&<p className="muted" style={{fontSize:11,marginTop:8}}>{tr(lang,"Manual tickers replace the engine universe for this run.","รายการหุ้นที่กรอกจะใช้แทน Universe ของ Engine ในรอบนี้")}</p>}
   {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
  </section>

  {result&&<>
   <section className="card">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
     <div><h3 className="sub" style={{margin:0}}>{result.mode==="thematic"?`${tr(lang,"THEMATIC PORTFOLIO","พอร์ตตามธีม")} · ${result.theme?.label??""}`:`${String(result.mode).toUpperCase()} RESEARCH`}</h3><p className="muted" style={{margin:"6px 0 0"}}>{result.universeSource} · {result.asOf?new Date(result.asOf).toLocaleString():"—"}</p></div>
     <span className="tag">SINGLE PIPELINE STATE</span>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(145px,1fr))",gap:10,marginTop:16}}>
     {stages.map(stage=><button key={stage.id} type="button" className={`metric ${activeStage===stage.id?"active":""}`} onClick={()=>setActiveStage(stage.id)} style={{textAlign:"left",cursor:"pointer",minHeight:92}}><span>{stage.label}</span><strong>{stage.value}</strong><small className="muted">{stage.note}</small></button>)}
    </div>
    <div className="notice" style={{marginTop:14}}>{result.methodology}</div>
    {!!committeeReady.length&&<div className="card" style={{margin:"14px 0 0",borderLeft:"3px solid var(--accent)"}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap",alignItems:"center"}}>
      <div>
       <h4 className="sub" style={{margin:0}}>{tr(lang,"Refer the shortlist to the investment committee","ส่ง shortlist เข้าที่ประชุมคณะกรรมการลงทุน")}</h4>
       <p className="muted" style={{margin:"6px 0 0",maxWidth:640,fontSize:13}}>
        {tr(lang,
         "Each referral carries the price it was written at. The committee measures how far the price has moved since, and sends the paper back rather than sizing a target computed against a price that no longer exists.",
         "การส่งแต่ละครั้งจะแนบราคา ณ เวลาที่วิเคราะห์ไปด้วย ที่ประชุมจะวัดว่าราคาเคลื่อนไปไกลแค่ไหน และจะตีกลับแทนที่จะกำหนดขนาดจากเป้าหมายที่คำนวณบนราคาที่ไม่มีอยู่แล้ว")}
       </p>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
       <span className="tag">{referred.size}/{committeeReady.length} {tr(lang,"referred","ส่งแล้ว")}</span>
       <button type="button" className="btn" onClick={referShortlist} disabled={referAll.state==="sending"||!pendingReferral.length}>
        {referAll.state==="sending"
         ?tr(lang,"Referring…","กำลังส่ง…")
         :!pendingReferral.length
         ?tr(lang,"All referred","ส่งครบแล้ว")
         :tr(lang,`Refer ${pendingReferral.length} name(s)`,`ส่ง ${pendingReferral.length} ตัว`)}
       </button>
      </div>
     </div>
     {!!referAll.message&&<div className={referAll.state==="error"?"err":"notice"} style={{marginTop:12}}>{referAll.message}</div>}
     {!!referred.size&&<p className="muted" style={{marginTop:10,fontSize:12}}>{tr(lang,"Open the CIO workspace to see each referral become a motion with a size, a vote and a funding source.","เปิดหน้า CIO เพื่อดูว่าแต่ละตัวกลายเป็นญัตติพร้อมขนาด การลงมติ และแหล่งเงิน")}</p>}
    </div>}
   </section>

   {result.mode==="thematic"&&<section className="card" style={{borderTop:`2px solid ${(result.picks??[]).length?"var(--green)":"var(--amber)"}`}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}><div><h3 className="sub" style={{margin:0}}>{tr(lang,"Portfolio Construction","การจัดน้ำหนักพอร์ต")}</h3><p className="muted">{result.theme?.benchmark} benchmark · factor gate → valuation gate → allocation</p></div><span className="tag">{result.portfolio?.status??"—"} · {Number(result.portfolio?.totalWeightPct??0).toFixed(1)}%</span></div>
    {(result.picks??[]).length?<div style={{display:"grid",gap:10,marginTop:14}}>{(result.picks??[]).map(candidate=><div key={candidate.ticker} style={{display:"grid",gridTemplateColumns:"44px minmax(90px,1fr) 3fr 72px",gap:10,alignItems:"center"}}><span className="muted">#{candidate.allocationRank}</span><strong>{candidate.ticker}</strong><div className="bar"><span style={{width:`${Math.min(100,Number(candidate.portfolioWeightPct??0)*4)}%`}}/></div><strong style={{textAlign:"right"}}>{Number(candidate.portfolioWeightPct??0).toFixed(1)}%</strong></div>)}</div>:<div className="notice" style={{marginTop:14}}>{tr(lang,"No position was built because no candidate passed both factor and valuation gates. Open Rejected to inspect every reason.","ยังสร้างพอร์ตไม่ได้เพราะไม่มีหุ้นผ่านทั้ง Factor และ Valuation กรุณาเปิด Rejected เพื่อตรวจเหตุผล")}</div>}
   </section>}

   <section className="card">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
     <div><h3 className="sub" style={{margin:0}}>{stages.find(stage=>stage.id===activeStage)?.label??"Candidates"}</h3><p className="muted" style={{margin:"5px 0 0"}}>{isRejected?tr(lang,"Every failed gate is documented.","แสดงเหตุผลที่ไม่ผ่านทุก Gate"):tr(lang,"Inspect evidence, add to Watchlist or continue to Stock Analysis.","ตรวจหลักฐาน เพิ่ม Watchlist หรือส่งต่อไป Stock Analysis")}</p></div>
     <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><input value={filter} onChange={event=>setFilter(event.target.value)} placeholder={tr(lang,"Filter ticker / company","ค้นหา ticker / บริษัท")} style={{minWidth:180}}/><select value={sortKey} onChange={event=>setSortKey(event.target.value as SortKey)}><option value="score">Score</option><option value="upside">Upside</option><option value="ticker">Ticker</option></select></div>
    </div>
    <div style={{display:"grid",gap:12,marginTop:16}}>
     {visibleCandidates.map((candidate,index)=><CandidateCard key={`${candidate.ticker}-${activeStage}`} candidate={candidate} rank={index+1} rejected={isRejected} lang={lang} engine={engineLabel} referred={referred.has(candidate.ticker)} onReferred={()=>setReferred(previous=>new Set(previous).add(candidate.ticker))} onAnalyze={()=>{sessionStorage.setItem("sentinel:selectedTicker",candidate.ticker);onNavigate("analyze")}}/>) }
     {!visibleCandidates.length&&<div className="empty-state">{tr(lang,"No securities in this stage.","ไม่มีหุ้นในขั้นตอนนี้")}</div>}
    </div>
   </section>

   {!!result.warnings?.length&&<details className="card"><summary>{tr(lang,"Data warnings","คำเตือนข้อมูล")} ({result.warnings.length})</summary><div className="advanced-tools-body">{result.warnings.map(warning=><div className="notice" key={warning}>{warning}</div>)}</div></details>}
  </>}
 </div>
}

function CandidateCard({candidate,rank,rejected,lang,engine,referred,onReferred,onAnalyze}:{candidate:Candidate;rank:number;rejected:boolean;lang:AppLang;engine:string;referred:boolean;onReferred:()=>void;onAnalyze:()=>void}){
 const[state,setState]=useState<"idle"|"saving"|"saved"|"error">("idle");
 const[refer,setRefer]=useState<"idle"|"sending"|"error">("idle");
 const[referError,setReferError]=useState("");
 const rejectionReasons=[...(candidate.rejectionReasons??[]),...(candidate.failedGates??[]),...(candidate.valuationFailures??[])].filter((value,index,array)=>array.indexOf(value)===index);
 const factors=[
  ["Momentum",candidate.momentum],["Growth",candidate.growth],["Quality",candidate.quality],["Value",candidate.value],
  ["Dividend",candidate.dividend],["Institutional",candidate.institutional],["AI",candidate.ai],["Composite",candidate.composite],
 ];
 async function addWatchlist(){
  setState("saving");
  try{
   const response=await fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:candidate.ticker,source:"Research OS v12 Phase 1",reason:candidate.thesis??candidate.reasons?.join(" · "),target_price:candidate.targetPrice})});
   if(!response.ok)throw new Error("Watchlist save failed");
   setState("saved");
  }catch{setState("error")}
 }
 async function refer2committee(){
  setRefer("sending");setReferError("");
  try{await referToCommittee(candidate,engine);onReferred()}
  catch(reason:unknown){setRefer("error");setReferError(reason instanceof Error?reason.message:"The referral could not be recorded.")}
 }
 return <article className="setup-card" style={{borderTop:`2px solid ${rejected?"var(--red)":"var(--green)"}`}}>
  <div style={{display:"flex",justifyContent:"space-between",gap:14,flexWrap:"wrap"}}>
   <div><span className="tag">#{rank} · {candidate.sector??"Unknown"} · {candidate.status??(rejected?"REJECTED":"CANDIDATE")}</span><h3 style={{margin:"10px 0 4px"}}>{candidate.ticker} · {candidate.name??candidate.ticker}</h3><p className="muted" style={{maxWidth:780}}>{candidate.thesis??"Institutional research candidate."}</p></div>
   <div className="badge-score">{candidate.composite??0}<span>/100</span><small style={{display:"block"}}>{rejected?"REJECTED":candidate.portfolioWeightPct!=null?`${candidate.portfolioWeightPct.toFixed(1)}% WEIGHT`:"RESEARCH"}</small></div>
  </div>
  <div className="grid cols-4" style={{marginTop:12}}><Metric label="Price" value={money(candidate.price)}/><Metric label="Target" value={money(candidate.targetPrice)}/><Metric label="Expected Return" value={pct(candidate.expectedReturnPct)}/><Metric label="Data Quality" value={candidate.dataQuality??"—"}/></div>
  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(105px,1fr))",gap:8,marginTop:9}}>{factors.map(([label,value])=><Metric key={String(label)} label={String(label)} value={Number.isFinite(Number(value))?`${Number(value)}/100`:"—"}/>)}</div>
  {!!candidate.reasons?.length&&<div className="notice" style={{marginTop:12}}><strong>{tr(lang,"Why it passed","เหตุผลที่ผ่าน")}</strong><div style={{marginTop:6}}>{candidate.reasons.join(" · ")}</div></div>}
  {rejected&&<div className="err" style={{marginTop:12}}><strong>{tr(lang,"Failed gates","เกณฑ์ที่ไม่ผ่าน")}</strong><div style={{marginTop:6}}>{rejectionReasons.length?rejectionReasons.join(" · "):tr(lang,"No explicit rejection reason was returned.","ระบบไม่ได้ส่งเหตุผลกลับมา")}</div></div>}
  {!rejected&&<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12,alignItems:"center"}}>
   <button type="button" className="btn" onClick={onAnalyze}>{tr(lang,"Open in Stock Analysis","เปิดใน Stock Analysis")}</button>
   <button type="button" className="btn" onClick={refer2committee} disabled={referred||refer==="sending"}>
    {referred?tr(lang,"✓ Referred to committee","✓ ส่งเข้าที่ประชุมแล้ว"):refer==="sending"?tr(lang,"Referring…","กำลังส่ง…"):tr(lang,"Refer to committee","ส่งเข้าที่ประชุม")}
   </button>
   <button type="button" className="btn ghost" onClick={addWatchlist} disabled={state==="saving"||state==="saved"}>{state==="saved"?tr(lang,"Added to Watchlist","เพิ่ม Watchlist แล้ว"):state==="saving"?tr(lang,"Saving…","กำลังบันทึก…"):tr(lang,"Add to Watchlist","เพิ่ม Watchlist")}</button>
   {state==="error"&&<span className="neg">{tr(lang,"Save failed","บันทึกไม่สำเร็จ")}</span>}
   {refer==="error"&&<span className="neg">{referError}</span>}
  </div>}
  {!rejected&&candidate.price==null&&<p className="muted" style={{marginTop:8,fontSize:12}}>{tr(lang,"No price was measured for this name, so a referral carries no reference price and the committee cannot check how far it has drifted.","ไม่มีราคาที่วัดได้สำหรับหุ้นตัวนี้ การส่งเข้าที่ประชุมจะไม่มีราคาอ้างอิง และที่ประชุมจะตรวจการเคลื่อนของราคาไม่ได้")}</p>}
 </article>
}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong>{value}</strong></div>}
