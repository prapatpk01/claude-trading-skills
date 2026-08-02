"use client";

import { useMemo, useState } from "react";
import type { AppLang } from "../page";
import styles from "./FundOperatingCycle.module.css";

type StageState="idle"|"running"|"done"|"warning";
type Kind="ADD_EXISTING"|"ADD_NEW"|"HOLD"|"TRIM"|"EXIT"|"CASH";
type Action={kind:Kind;ticker:string;label:string;reason:string;amount?:number|null;weight?:number|null;score?:number|null};
type Stage={key:string;en:string;th:string;endpoint:string;state:StageState;detail?:string};

const t=(l:AppLang,en:string,th:string)=>l==="th"?th:en;
const finite=(v:unknown)=>{const n=typeof v==="number"?v:Number(v);return Number.isFinite(n)?n:null};
const money=(v:number|null)=>v==null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(v);
const txt=(...v:unknown[])=>v.find(x=>typeof x==="string"&&x.trim()) as string|undefined;
const stages0:Stage[]=[
 {key:"macro",en:"Macro & regime",th:"Macro และสภาวะตลาด",endpoint:"/api/macro/intelligence",state:"idle"},
 {key:"portfolio",en:"Holdings & market truth",th:"Holdings และราคาตลาด",endpoint:"/api/portfolio",state:"idle"},
 {key:"integrity",en:"System diagnostics",th:"การตรวจสอบระบบ",endpoint:"/api/portfolio/integrity",state:"idle"},
 {key:"liquidity",en:"Liquidity & reserve",th:"สภาพคล่องและเงินสำรอง",endpoint:"/api/portfolio/cash-buffer",state:"idle"},
 {key:"optimizer",en:"Portfolio construction",th:"การจัดพอร์ต",endpoint:"/api/portfolio/optimizer",state:"idle"},
 {key:"opportunity",en:"New opportunities",th:"โอกาสลงทุนใหม่",endpoint:"/api/portfolio/opportunity-allocation",state:"idle"},
 {key:"committee",en:"Investment committee",th:"คณะกรรมการลงทุน",endpoint:"/api/committee/audit",state:"idle"},
 {key:"cio",en:"Final CIO resolution",th:"มติสุดท้ายของ CIO",endpoint:"/api/v10/cio",state:"idle"},
];
async function read(endpoint:string){const r=await fetch(endpoint,{cache:"no-store"});let body:any=null;try{body=await r.json()}catch{}return{ok:r.ok,status:r.status,body}}
function friendlyAction(label:string,lang:AppLang){const x=label.toUpperCase();if(x.includes("DEPLOY_EXCESS"))return t(lang,"Deploy excess reserve","นำเงินสำรองส่วนเกินไปลงทุน");if(x.includes("HOLD"))return t(lang,"Hold","ถือ");if(x.includes("TRIM"))return t(lang,"Trim","ลดน้ำหนัก");if(x.includes("EXIT"))return t(lang,"Exit","ออกจากสถานะ");return label.replaceAll("_"," ")}
function optimizerAction(raw:any,lang:AppLang):Action|null{const ticker=String(raw?.ticker??"").toUpperCase();if(!ticker||ticker==="LIQUIDITY"||ticker==="OPPORTUNITY PIPELINE")return null;const rawLabel=String(raw?.action??"HOLD").toUpperCase();const kind:Kind=rawLabel.includes("TRIM")||rawLabel.includes("REDUCE")?"TRIM":rawLabel.includes("EXIT")?"EXIT":"HOLD";return{kind,ticker,label:friendlyAction(rawLabel,lang),reason:txt(raw?.reason)??t(lang,"Within portfolio policy.","อยู่ภายในนโยบายพอร์ต"),amount:finite(raw?.capitalUsd),weight:finite(raw?.targetWeightPct)}}
function allocationAction(raw:any,held:Set<string>,lang:AppLang):Action|null{const ticker=String(raw?.ticker??"").toUpperCase();if(!ticker)return null;const amount=finite(raw?.approvedCapitalUsd)??0;return{kind:held.has(ticker)?"ADD_EXISTING":"ADD_NEW",ticker,label:amount>0?t(lang,"Committee approved","คณะกรรมการอนุมัติ"):t(lang,"Awaiting capital","รอจัดสรรเงิน"),reason:txt(raw?.thesis,raw?.reason)??t(lang,"Candidate cleared the evidence and committee gates.","หลักทรัพย์ผ่านเกณฑ์หลักฐานและคณะกรรมการ"),amount,weight:finite(raw?.proposedWeightPct),score:finite(raw?.conviction)}}

export default function FundOperatingCycleV2({lang}:{lang:AppLang}){
 const[stages,setStages]=useState<Stage[]>(stages0);const[running,setRunning]=useState(false);const[actions,setActions]=useState<Action[]>([]);const[summary,setSummary]=useState<any>(null);const[warnings,setWarnings]=useState<string[]>([]);const[completed,setCompleted]=useState<string|null>(null);
 const groups=useMemo(()=>{const g:Record<Kind,Action[]>={ADD_EXISTING:[],ADD_NEW:[],HOLD:[],TRIM:[],EXIT:[],CASH:[]};actions.forEach(a=>g[a.kind].push(a));return g},[actions]);
 const decisionCount=groups.ADD_EXISTING.length+groups.ADD_NEW.length+groups.TRIM.length+groups.EXIT.length;
 async function run(){setRunning(true);setActions([]);setSummary(null);setWarnings([]);setCompleted(null);setStages(stages0.map(s=>({...s,state:"idle",detail:undefined})));const results:Record<string,any>={};const notices:string[]=[];
  for(const stage of stages0){setStages(p=>p.map(s=>s.key===stage.key?{...s,state:"running"}:s));const r=await read(stage.endpoint);results[stage.key]=r.body;const adminMissing=stage.key==="integrity"&&r.status===503;const detail=adminMissing?t(lang,"Optional admin check unavailable","การตรวจสอบระดับผู้ดูแลไม่พร้อมใช้งาน"):r.ok?`HTTP ${r.status}`:`HTTP ${r.status}`;setStages(p=>p.map(s=>s.key===stage.key?{...s,state:adminMissing?"done":r.ok?"done":"warning",detail}:s));if(!r.ok&&!adminMissing)notices.push(`${t(lang,stage.en,stage.th)}: ${detail}`)}
  const holdings=Array.isArray(results.portfolio?.holdings)?results.portfolio.holdings.filter((h:any)=>!h.closed_at):[];const held=new Set<string>(holdings.map((h:any)=>String(h.ticker??"").toUpperCase()));const list:Action[]=[];
  for(const p of Array.isArray(results.optimizer?.proposals)?results.optimizer.proposals:[]){const a=optimizerAction(p,lang);if(a)list.push(a)}
  for(const a0 of Array.isArray(results.opportunity?.allocations)?results.opportunity.allocations:[]){const a=allocationAction(a0,held,lang);if(a)list.push(a)}
  const reserveLabel=txt(results.liquidity?.action,results.optimizer?.proposals?.[0]?.action);const reserveAmount=Math.abs(finite(results.liquidity?.gapValue)??0);const reservePct=finite(results.liquidity?.bufferPct);const reserveTarget=finite(results.liquidity?.targetPct);if(reserveLabel)list.push({kind:"CASH",ticker:t(lang,"RESERVE","เงินสำรอง"),label:friendlyAction(reserveLabel,lang),reason:reserveAmount>0?t(lang,`Reserve is ${reservePct?.toFixed(1)??"—"}% versus a ${reserveTarget?.toFixed(1)??"—"}% target. Deploy only into committee-approved securities.`,`เงินสำรองอยู่ที่ ${reservePct?.toFixed(1)??"—"}% เทียบเป้าหมาย ${reserveTarget?.toFixed(1)??"—"}% ใช้เงินส่วนเกินเฉพาะหลักทรัพย์ที่คณะกรรมการอนุมัติ`):t(lang,"Maintain the current liquidity reserve.","รักษาระดับเงินสำรองปัจจุบัน"),amount:reserveAmount,weight:reserveTarget});
  setActions(Array.from(new Map(list.map(a=>[`${a.kind}:${a.ticker}`,a])).values()));setSummary({posture:txt(results.cio?.posture,results.cio?.status)??"HOLD / VERIFY",readiness:finite(results.cio?.readinessPct??results.cio?.readiness)??0,regime:txt(results.liquidity?.regime?.classification,results.macro?.regime?.classification,results.macro?.classification)??"—",nav:finite(results.liquidity?.totalNav??results.optimizer?.portfolio?.nav??results.opportunity?.portfolio?.nav),reserve:reservePct,reserveTarget});setWarnings(notices);setCompleted(new Date().toISOString());setRunning(false)}
 return <section className={styles.shell}><div className={styles.hero}><div><div className={styles.eyebrow}>ONE-CLICK FUND OPERATING CYCLE · v10.1</div><h2>{t(lang,"Convene the entire fund","ประชุมกองทุนทั้งระบบ")}</h2><p>{t(lang,"One meeting runs every desk and returns one concise CIO action plan.","กดครั้งเดียวเพื่อรันทุกทีมและรับแผนปฏิบัติการ CIO ฉบับเดียว")}</p></div><button className={styles.run} onClick={run} disabled={running}>{running?t(lang,"Meeting in progress…","กำลังประชุม…"):t(lang,"Convene full fund meeting","เริ่มประชุมกองทุนทั้งหมด")}</button></div>
 <div className={styles.stages}>{stages.map((s,i)=><div className={`${styles.stage} ${styles[s.state]}`} key={s.key}><span>{i+1}</span><div><strong>{t(lang,s.en,s.th)}</strong><small>{s.detail??t(lang,"Waiting","รอเริ่ม")}</small></div></div>)}</div>
 {summary&&<><div className={styles.executive}><Metric label={t(lang,"CIO posture","ท่าที CIO")} value={summary.posture}/><Metric label={t(lang,"Readiness","ความพร้อม")} value={`${summary.readiness}%`}/><Metric label={t(lang,"Actionable decisions","มติที่ต้องดำเนินการ")} value={String(decisionCount)}/><Metric label={t(lang,"Regime","สภาวะตลาด")} value={summary.regime}/><Metric label="NAV" value={money(summary.nav)}/><Metric label={t(lang,"Reserve","เงินสำรอง")} value={summary.reserve==null?"—":`${summary.reserve.toFixed(1)}% / ${summary.reserveTarget?.toFixed(1)??"—"}%`}/></div>
 <div className={styles.actionGrid}>
  {groups.ADD_EXISTING.length>0&&<Group title={t(lang,"Add existing holdings","ซื้อเพิ่มหุ้นที่มีอยู่")} tone="green" a={groups.ADD_EXISTING}/>} 
  {groups.ADD_NEW.length>0&&<Group title={t(lang,"Open new positions","เปิดหุ้นใหม่")} tone="cyan" a={groups.ADD_NEW}/>} 
  {groups.HOLD.length>0&&<Group title={t(lang,"Hold / monitor","ถือ / ติดตาม")} tone="blue" a={groups.HOLD}/>} 
  {groups.TRIM.length>0&&<Group title={t(lang,"Trim","ลดน้ำหนัก")} tone="amber" a={groups.TRIM}/>} 
  {groups.EXIT.length>0&&<Group title={t(lang,"Exit","ออกจากสถานะ")} tone="red" a={groups.EXIT}/>} 
  {groups.CASH.length>0&&<Group title={t(lang,"Cash & reserve","เงินสดและเงินสำรอง")} tone="purple" a={groups.CASH}/>} 
 </div>
 <div className={styles.nextStep}><strong>{t(lang,"CIO next action","การดำเนินการถัดไปของ CIO")}</strong>{decisionCount>0?<ol><li>{t(lang,"Review the named buy, trim and exit proposals above.","ตรวจข้อเสนอซื้อ ลดน้ำหนัก และออกจากสถานะที่ระบุชื่อด้านบน")}</li><li>{t(lang,"Approve, reject or edit position size for each proposal.","อนุมัติ ปฏิเสธ หรือแก้ขนาดลงทุนของแต่ละข้อเสนอ")}</li><li>{t(lang,"Record approved decisions; no trade executes automatically.","บันทึกมติที่อนุมัติ ระบบไม่ส่งคำสั่งซื้อขายอัตโนมัติ")}</li></ol>:<p>{t(lang,"No security change cleared the committee. Maintain current holdings and reserve policy.","ยังไม่มีการเปลี่ยนแปลงหลักทรัพย์ที่ผ่านคณะกรรมการ ให้ถือพอร์ตเดิมและรักษานโยบายเงินสำรอง")}</p>}</div>
 {warnings.length>0&&<details className={styles.warning}><summary>{t(lang,"System notices","ประกาศจากระบบ")}</summary>{warnings.map(w=><div key={w}>• {w}</div>)}</details>}<div className={styles.timestamp}>{t(lang,"Completed","เสร็จสิ้น")} · {completed?new Date(completed).toLocaleString():"—"}</div></>}</section>}
function Metric({label,value}:{label:string;value:string}){return <div className={styles.metric}><span>{label}</span><strong>{value}</strong></div>}
function Group({title,tone,a}:{title:string;tone:string;a:Action[]}){return <div className={`${styles.group} ${styles[tone]}`}><h3>{title}<span>{a.length}</span></h3>{a.map(x=><div className={styles.action} key={`${x.kind}-${x.ticker}`}><div><strong>{x.ticker}</strong><span>{x.label}</span></div><p>{x.reason}</p><small>{x.amount!=null&&x.amount>0?money(x.amount):""}{x.weight!=null&&x.weight>0?` · ${x.weight.toFixed(1)}% target`:""}{x.score!=null?` · ${x.score}/100`:""}</small></div>)}</div>}
