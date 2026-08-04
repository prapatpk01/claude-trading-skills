"use client";

import {useEffect,useMemo,useState} from "react";
import type {AppLang} from "../page";
import {useFundSnapshot} from "./useFundSnapshot";

type Tab="full"|"macro"|"portfolio"|"research"|"capital"|"risk"|"vote"|"history";
type Candidate={ticker:string;rating:string;conviction:number;upside:number|null;target:number|null;price:number|null;source:string;status:string};
type HoldingReview={ticker:string;weight:number;marketValue:number;pnlPct:number|null;valuation:string;risk:string;action:string;reason:string};

const tabs:{id:Tab;en:string;th:string}[]=[
 {id:"full",en:"Full Meeting",th:"ประชุมทั้งหมด"},
 {id:"macro",en:"Macro Strategy",th:"กลยุทธ์มหภาค"},
 {id:"portfolio",en:"Portfolio Review",th:"ทบทวนพอร์ต"},
 {id:"research",en:"Research Candidates",th:"หุ้นที่เสนอ"},
 {id:"capital",en:"Capital Allocation",th:"จัดสรรเงินทุน"},
 {id:"risk",en:"Risk & Valuation",th:"ความเสี่ยงและมูลค่า"},
 {id:"vote",en:"Voting & Resolution",th:"ลงมติและข้อสรุป"},
 {id:"history",en:"Decision History",th:"ประวัติการตัดสินใจ"},
];

const tr=(lang:AppLang,en:string,th:string)=>lang==="th"?th:en;
const money=(value:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(value||0);
const pct=(value:number|null)=>value==null?"—":`${value>=0?"+":""}${value.toFixed(1)}%`;
const finite=(value:unknown):number|null=>{const numberValue=typeof value==="number"?value:Number(value);return Number.isFinite(numberValue)?numberValue:null};

async function getJson(path:string){
 const response=await fetch(path,{cache:"no-store",headers:{Accept:"application/json"}});
 const raw=await response.text();
 let json:any={};
 try{json=raw?JSON.parse(raw):{}}catch{throw new Error(`${path} returned invalid JSON`)}
 if(!response.ok)throw new Error(json?.error??`${path} returned ${response.status}`);
 return json;
}

export default function CIOCommandCenterV12({lang,onNavigate}:{lang:AppLang;onNavigate:(id:string)=>void}){
 const fund=useFundSnapshot();
 const[tab,setTab]=useState<Tab>("full");
 const[data,setData]=useState<any>({portfolio:null,actions:null,performance:null});
 const[error,setError]=useState<string|null>(null);
 const[refreshKey,setRefreshKey]=useState(0);

 useEffect(()=>{
  let active=true;
  setError(null);
  Promise.allSettled([
   getJson("/api/portfolio"),
   getJson("/api/analysis/actions"),
   getJson("/api/analysis/performance"),
  ]).then(results=>{
   if(!active)return;
   const values=results.map(result=>result.status==="fulfilled"?result.value:null);
   setData({portfolio:values[0],actions:values[1],performance:values[2]});
   const failed=results.filter(result=>result.status==="rejected").length;
   if(failed)setError(`${failed} committee source(s) unavailable. Missing evidence was excluded.`);
  });
  return()=>{active=false};
 },[refreshKey]);

 const reviews=useMemo<HoldingReview[]>(()=>fund.holdings.map((row):HoldingReview=>{
   const pnlPct=row.avgCost>0?(row.price/row.avgCost-1)*100:null;
   const over=row.weightPct>20;
   const weak=pnlPct!==null&&pnlPct<-12;
   const strong=pnlPct!==null&&pnlPct>20;
   const action=over?"TRIM REVIEW":weak?"THESIS REVIEW":strong?"KEEP WINNER":"KEEP";
   return{
    ticker:row.ticker,
    weight:row.weightPct,
    marketValue:row.marketValue,
    pnlPct,
    valuation:pnlPct==null?"DATA LIMITED":pnlPct>25?"PREMIUM / WATCH":pnlPct<-10?"DISCOUNT / VERIFY":"FAIR RANGE",
    risk:over?"CONCENTRATION HIGH":weak?"DRAWDOWN WATCH":"WITHIN POLICY",
    action,
    reason:over?"Position exceeds the single-name review zone.":weak?"Drawdown requires thesis and catalyst verification.":strong?"Winner remains inside policy; do not trim mechanically.":"No verified evidence currently justifies a change.",
   };
  }).sort((a:HoldingReview,b:HoldingReview)=>b.weight-a.weight),[fund.holdings]);

 const candidates=useMemo<Candidate[]>(()=>{
  const payload=data?.actions;
  const rows=Array.isArray(payload)?payload:Array.isArray(payload?.actions)?payload.actions:Array.isArray(payload?.items)?payload.items:[];
  return rows.map((row:any)=>({
   ticker:String(row?.ticker??row?.symbol??"").toUpperCase(),
   rating:String(row?.rating??row?.decision??row?.action??"WATCH").toUpperCase(),
   conviction:Math.max(0,Math.min(100,finite(row?.conviction??row?.score)??0)),
   upside:finite(row?.upside??row?.expected_upside),
   target:finite(row?.target??row?.target_price),
   price:finite(row?.price??row?.current_price),
   source:String(row?.source??row?.engine??"Stock Analyze"),
   status:String(row?.status??"PENDING CIO").toUpperCase(),
  })).filter((row:Candidate)=>row.ticker).sort((a:Candidate,b:Candidate)=>b.conviction-a.conviction).slice(0,8);
 },[data?.actions]);

 const macroAction=fund.macroScore>=65?"ADVANCE SELECTIVELY":fund.macroScore<40?"REDUCE RISK / RAISE CASH":"BALANCED / SELECTIVE";
 const committeeVotes=[
  {desk:"RESEARCH",vote:candidates.some(row=>/BUY/.test(row.rating))?"BUY":"HOLD",score:candidates[0]?.conviction??fund.qualityScore},
  {desk:"QUANT",vote:fund.portfolioHealth>=65?"BUY":"HOLD",score:fund.portfolioHealth},
  {desk:"VALUATION",vote:fund.qualityScore>=60?"BUY":"HOLD",score:fund.qualityScore},
  {desk:"RISK",vote:fund.riskScore>=65?"BUY":"HOLD",score:fund.riskScore},
  {desk:"PORTFOLIO",vote:fund.portfolioHealth>=60?"BUY":"HOLD",score:fund.portfolioHealth},
  {desk:"CIO",vote:fund.macroScore>=45&&fund.riskScore>=55?"BUY":"HOLD",score:Math.round((fund.macroScore+fund.riskScore+fund.portfolioHealth)/3)},
 ];
 const approvals=committeeVotes.filter(vote=>vote.vote==="BUY").length;
 const consensus=Math.round(approvals/committeeVotes.length*100);
 const need=candidates.filter(row=>/BUY/.test(row.rating)).reduce((sum,row)=>sum+Math.max(0,finite((row as any).amount)??0),0);
 const proposedCapital=need>0?need:Math.min(fund.deployableCash,candidates.some(row=>/BUY/.test(row.rating))?fund.deployableCash:0);
 const trimSource=Math.min(proposedCapital,fund.deployableCash);
 const remainingDeployable=Math.max(0,fund.deployableCash-trimSource);

 const show=(id:Tab)=>tab==="full"||tab===id;
 const jump=(id:Tab)=>{setTab("full");requestAnimationFrame(()=>document.getElementById(`cio-${id}`)?.scrollIntoView({behavior:"smooth",block:"start"}))};

 if(fund.loading)return <section className="card"><p>Loading verified fund snapshot…</p></section>;
 return <div className="workspace-stack" data-cio-version="12.5" data-workspace="investment-committee" data-source-of-truth="fund-snapshot portfolio-ledger analysis-actions">
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div><span className="tag">CIO · PHASE 4</span><h2 className="section" style={{margin:"10px 0 6px"}}>{tr(lang,"Executive Investment Committee Workspace","ห้องประชุมคณะกรรมการลงทุน")}</h2><p className="muted" style={{margin:0,maxWidth:880}}>{tr(lang,"One meeting combines market regime, portfolio review, research candidates, risk, valuation, capital allocation, voting and the final human-approved resolution.","การประชุมเดียวรวมสภาวะตลาด การทบทวนพอร์ต หุ้นที่เสนอ ความเสี่ยง มูลค่า การจัดสรรเงิน ลงมติ และข้อสรุปที่มนุษย์อนุมัติ")}</p></div>
    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><span className="tag">{fund.verified?"COMMITTEE READY":"VERIFY DATA"}</span><button className="btn ghost" type="button" onClick={()=>setRefreshKey(value=>value+1)}>↻ Refresh Meeting</button></div>
   </div>
   {error&&<div className="notice" style={{marginTop:12}}>{error}</div>}
   <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginTop:16,position:"sticky",top:0,zIndex:5}}>{tabs.map(item=><button key={item.id} className={`btn ${tab===item.id?"":"ghost"}`} type="button" onClick={()=>setTab(item.id)}>{lang==="th"?item.th:item.en}</button>)}</div>
   {tab==="full"&&<div style={{display:"flex",gap:8,overflowX:"auto",marginTop:10}}>{tabs.filter(item=>item.id!=="full").map(item=><button key={item.id} className="btn ghost sm" type="button" onClick={()=>jump(item.id)}>{lang==="th"?item.th:item.en}</button>)}</div>}
  </section>

  {show("macro")&&<section id="cio-macro" className="card"><SectionTitle n="1" title={tr(lang,"Macro Strategy & Market Regime","กลยุทธ์มหภาคและสภาวะตลาด")}/><div className="grid cols-4"><Metric label="Regime" value={fund.macroLabel.toUpperCase()}/><Metric label="Macro Score" value={`${fund.macroScore.toFixed(0)}/100`}/><Metric label="Fund Posture" value={macroAction}/><Metric label="Target Cash" value={`${fund.targetCashPct.toFixed(0)}%`}/></div><div className="grid cols-2" style={{marginTop:14}}><div className="notice"><b>Executive summary</b><p>{fund.macroVision}</p><strong>Recommendation: {macroAction}</strong></div><div className="card" style={{margin:0}}><h3 className="sub">Outlook probabilities</h3><Bar label="Bullish" value={fund.bullishPct??0}/><Bar label="Neutral" value={fund.neutralPct??0}/><Bar label="Bearish" value={fund.bearishPct??0}/></div></div></section>}

  {show("portfolio")&&<section id="cio-portfolio" className="card"><SectionTitle n="2" title={tr(lang,"Portfolio Health & Holding Review","สุขภาพพอร์ตและการทบทวนหุ้นที่ถือ")}/><div className="grid cols-4"><Metric label="Verified NAV" value={money(fund.totalNav)}/><Metric label="Portfolio Health" value={`${fund.portfolioHealth}/100`}/><Metric label="Open Holdings" value={String(fund.openPositions)}/><Metric label="Unrealized P/L" value={`${money(fund.unrealizedPnl)} · ${pct(fund.unrealizedPnlPct)}`}/></div><div style={{overflowX:"auto",marginTop:16}}><table style={{width:"100%",minWidth:900,borderCollapse:"collapse"}}><thead><tr>{["Ticker","Weight","Market Value","Vs Cost","Valuation","Risk","Committee Action"].map(label=><th key={label} style={th}>{label}</th>)}</tr></thead><tbody>{reviews.map(row=><tr key={row.ticker}><td style={td}><b>{row.ticker}</b></td><td style={td}>{row.weight.toFixed(1)}%</td><td style={td}>{money(row.marketValue)}</td><td style={td}>{pct(row.pnlPct)}</td><td style={td}>{row.valuation}</td><td style={td}>{row.risk}</td><td style={td}><b>{row.action}</b><small style={{display:"block",marginTop:4}}>{row.reason}</small></td></tr>)}</tbody></table></div><button className="btn ghost" type="button" onClick={()=>onNavigate("portfolio")} style={{marginTop:14}}>Open Holdings Workspace</button></section>}

  {show("research")&&<section id="cio-research" className="card"><SectionTitle n="3" title={tr(lang,"Research Candidates & New Ideas","หุ้นใหม่และข้อเสนอจากฝ่ายวิจัย")}/>{candidates.length?<div className="grid cols-2">{candidates.map((row,index)=><article className="metric" key={`${row.ticker}-${index}`}><span>#{index+1} · {row.source}</span><strong>{row.ticker} · {row.rating}</strong><small>Conviction {row.conviction}/100 · Upside {pct(row.upside)} · Target {row.target==null?"—":money(row.target)} · {row.status}</small></article>)}</div>:<div className="notice">No Stock Analyze candidate is currently queued for CIO review.</div>}<div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}><button className="btn ghost" type="button" onClick={()=>onNavigate("research")}>Open Research</button><button className="btn ghost" type="button" onClick={()=>onNavigate("analyze")}>Open Stock Analyze</button></div></section>}

  {show("capital")&&<section id="cio-capital" className="card"><SectionTitle n="4" title={tr(lang,"Capital Allocation & Funding Plan","การจัดสรรเงินทุนและแหล่งเงิน")}/><div className="grid cols-4"><Metric label="Broker Cash" value={money(fund.cashBalance)}/><Metric label="Deployable Cash" value={money(fund.deployableCash)}/><Metric label="Proposed Deployment" value={money(proposedCapital)}/><Metric label="Remaining Deployable" value={money(remainingDeployable)}/></div><div className="notice" style={{marginTop:14}}><b>Funding plan</b><p>{proposedCapital>0?`Use ${money(trimSource)} of deployable cash only for named, human-selected candidates. Cash remains uncommitted until the final resolution is submitted.`:`KEEP ${money(fund.deployableCash)} IN CASH — NO SALE AUTHORIZED`}</p></div></section>}

  {show("risk")&&<section id="cio-risk" className="card"><SectionTitle n="5" title={tr(lang,"Risk, Liquidity & Valuation Meeting","การประชุมความเสี่ยง สภาพคล่อง และมูลค่า")}/><div className="grid cols-4"><Metric label="Risk Score" value={`${fund.riskScore}/100`}/><Metric label="Liquidity" value={`${fund.liquidityScore}/100`}/><Metric label="Quality" value={`${fund.qualityScore}/100`}/><Metric label="Largest Weight" value={`${(reviews[0]?.weight??0).toFixed(1)}%`}/></div><div className="grid cols-2" style={{marginTop:14}}><div className="notice"><b>Top risks</b><p>{reviews.filter(row=>row.risk!=="WITHIN POLICY").slice(0,4).map(row=>`${row.ticker}: ${row.risk}`).join(" · ")||"No verified holding currently breaches the review rules."}</p></div><div className="notice"><b>Mitigation</b><p>{fund.cashBufferPct>fund.targetCashPct?"Deploy excess cash only into positive-upside, committee-approved ideas.":"Preserve cash policy and avoid unfunded additions."}</p></div></div></section>}

  {show("vote")&&<section id="cio-vote" className="card"><SectionTitle n="6" title={tr(lang,"Committee Voting & Final Resolution","การลงมติและข้อสรุปการประชุม")}/><div className="grid cols-3">{committeeVotes.map(vote=><article className="metric" key={vote.desk}><span>{vote.desk}</span><strong>{vote.vote}</strong><small>{vote.score}/100</small></article>)}</div><div className="grid cols-4" style={{marginTop:14}}><Metric label="Supportive Votes" value={`${approvals}/${committeeVotes.length}`}/><Metric label="Consensus" value={`${consensus}%`}/><Metric label="Resolution" value={consensus>=67?"APPROVED FOR HUMAN SELECTION":"HOLD / MORE RESEARCH"}/><Metric label="Execution" value="HUMAN REQUIRED"/></div><div className="notice" style={{marginTop:14}}><b>Meeting minutes</b><p>Macro posture: {macroAction}. Portfolio actions: {reviews.filter(row=>row.action!=="KEEP").map(row=>`${row.ticker} ${row.action}`).join(", ")||"none"}. Research shortlist: {candidates.map(row=>row.ticker).join(", ")||"none"}. Funding remains proposal-only until a human submits the approved transaction package.</p></div></section>}

  {show("history")&&<section id="cio-history" className="card"><SectionTitle n="7" title={tr(lang,"Decision History & Committee Attribution","ประวัติการตัดสินใจและผลงานคณะกรรมการ")}/><div className="grid cols-4"><Metric label="Tracked Decisions" value={String(data?.performance?.summary?.total??data?.performance?.total??0)}/><Metric label="Committee Win Rate" value={`${finite(data?.performance?.summary?.winRate??data?.performance?.winRate)??0}%`}/><Metric label="Average Return" value={pct(finite(data?.performance?.summary?.averageReturn??data?.performance?.averageReturn))}/><Metric label="Governance" value="AUDITABLE"/></div><div className="notice" style={{marginTop:14}}>Decision attribution is read from the analysis performance ledger. No result is counted until an observation or exit is recorded.</div></section>}

  <section className="card"><div className="grid cols-3"><Guard title="SINGLE SOURCE OF TRUTH" text="Fund Snapshot + Portfolio Ledger + Analyze Action Queue"/><Guard title="NO AUTO EXECUTION" text="Committee decisions create proposals, never broker trades"/><Guard title="HUMAN APPROVAL" text="A person must select and record every final transaction"/></div></section>
 </div>
}

const th:React.CSSProperties={textAlign:"left",padding:"12px 10px",borderBottom:"1px solid var(--border)",fontSize:12,letterSpacing:".08em",color:"var(--muted)"};
const td:React.CSSProperties={padding:"12px 10px",borderBottom:"1px solid var(--border)",verticalAlign:"top",fontSize:13};
function SectionTitle({n,title}:{n:string;title:string}){return <h3 className="sub" style={{marginTop:0}}><span className="tag" style={{marginRight:8}}>{n}</span>{title}</h3>}
function Metric({label,value}:{label:string;value:string}){return <div className="metric"><span>{label}</span><strong style={{fontSize:20,lineHeight:1.25}}>{value}</strong></div>}
function Guard({title,text}:{title:string;text:string}){return <div className="metric"><span>{title}</span><strong style={{fontSize:14,lineHeight:1.4}}>{text}</strong></div>}
function Bar({label,value}:{label:string;value:number}){return <div style={{display:"grid",gridTemplateColumns:"80px 1fr 48px",gap:10,alignItems:"center",margin:"12px 0"}}><span>{label}</span><div style={{height:8,borderRadius:999,background:"rgba(148,163,184,.15)",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,Math.min(100,value))}%`,background:"linear-gradient(90deg,#31d9f3,#8f5cff)"}}/></div><b>{value}%</b></div>}
