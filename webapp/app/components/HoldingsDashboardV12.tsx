"use client";

import {useState} from "react";
import type {AppLang} from "../page";
import PortfolioTruthSummary from "./PortfolioTruthSummary";
import PortfolioTransactionOverride from "./PortfolioTransactionOverride";
import HoldingsMarketMonitor from "./HoldingsMarketMonitor";
import PortfolioLedgerPanel from "./PortfolioLedgerPanel";
import DividendCalendarPanel from "./DividendCalendarPanel";
import CashLedgerPanel from "./CashLedgerPanel";
import CashBufferPanel from "./CashBufferPanel";
import DividendLedgerPanel from "./DividendLedgerPanel";
import PortfolioOptimizerPanel from "./PortfolioOptimizerPanel";
import OpportunityAllocationPanel from "./OpportunityAllocationPanel";

type Tab="all"|"overview"|"holdings"|"transactions"|"income"|"risk";
const tabs:{id:Tab;en:string;th:string}[]=[
 {id:"all",en:"Full Workspace",th:"ดูทุกส่วน"},
 {id:"overview",en:"Overview",th:"ภาพรวม"},
 {id:"holdings",en:"Holdings",th:"รายการถือครอง"},
 {id:"transactions",en:"Transactions",th:"ซื้อขาย"},
 {id:"income",en:"Cash & Income",th:"เงินสดและรายได้"},
 {id:"risk",en:"Risk & Rebalance",th:"ความเสี่ยงและปรับพอร์ต"},
];

export default function HoldingsDashboardV12({lang,refreshKey,onRefresh}:{lang:AppLang;refreshKey:number;onRefresh:()=>void}){
 const[tab,setTab]=useState<Tab>("all");
 const t=(en:string,th:string)=>lang==="th"?th:en;
 const show=(id:Exclude<Tab,"all">)=>tab==="all"||tab===id;
 const go=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});

 return <div className="workspace-stack" data-holdings-version="12.4" data-source-of-truth="portfolio-ledger">
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div>
     <span className="tag">HOLDINGS · PHASE 3</span>
     <h2 className="section" style={{margin:"10px 0 5px"}}>{t("Institutional Portfolio Operations","ระบบบริหารพอร์ตระดับสถาบัน")}</h2>
     <p className="muted" style={{margin:0,maxWidth:820}}>{t("One verified portfolio ledger powers valuation, holdings, reconciliation, trades, cash, income and rebalance proposals. Full Workspace shows the complete operating flow on one page.","Portfolio Ledger ที่ตรวจสอบแล้วเพียงชุดเดียวใช้กับ Valuation, Holdings, Reconciliation, Trade, Cash, Income และข้อเสนอ Rebalance โดย Full Workspace จะแสดงกระบวนการทั้งหมดในหน้าเดียว")}</p>
    </div>
    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><span className="tag">SINGLE SOURCE OF TRUTH</span><span className="tag">NO AUTO EXECUTION</span></div>
   </div>

   <div style={{display:"flex",gap:8,overflowX:"auto",marginTop:16,paddingBottom:4,position:"sticky",top:72,zIndex:8,background:"rgba(5,8,22,.94)",backdropFilter:"blur(12px)",padding:"10px",borderRadius:12}}>
    {tabs.map(item=><button key={item.id} type="button" className={`btn ${tab===item.id?"":"ghost"}`} onClick={()=>{setTab(item.id);window.scrollTo({top:0,behavior:"smooth"})}}>{lang==="th"?item.th:item.en}</button>)}
   </div>

   {tab==="all"&&<div style={{display:"flex",gap:8,overflowX:"auto",marginTop:12,paddingBottom:3}}>
    <button className="btn ghost sm" onClick={()=>go("holdings-overview")}>{t("1 · Overview","1 · ภาพรวม")}</button>
    <button className="btn ghost sm" onClick={()=>go("holdings-master")}>{t("2 · Holdings Master","2 · รายการถือครอง")}</button>
    <button className="btn ghost sm" onClick={()=>go("holdings-transactions")}>{t("3 · Transactions","3 · ซื้อขาย")}</button>
    <button className="btn ghost sm" onClick={()=>go("holdings-income")}>{t("4 · Cash & Income","4 · เงินสดและรายได้")}</button>
    <button className="btn ghost sm" onClick={()=>go("holdings-risk")}>{t("5 · Risk & Rebalance","5 · ความเสี่ยงและปรับพอร์ต")}</button>
   </div>}
  </section>

  {show("overview")&&<section id="holdings-overview" style={{scrollMarginTop:150}}>
   <SectionHeader step="01" title={t("Verified Portfolio Overview","ภาพรวมพอร์ตที่ตรวจสอบแล้ว")} subtitle={t("NAV, cost basis, unrealized P/L and return are shown only when all required market prices are verified.","NAV ต้นทุน กำไร/ขาดทุน และผลตอบแทนจะแสดงเมื่อราคาตลาดที่จำเป็นได้รับการตรวจสอบครบ")}/>
   <PortfolioTruthSummary lang={lang} refreshKey={refreshKey}/>
   <section className="card">
    <h3 className="sub">{t("Portfolio control principles","หลักควบคุมพอร์ต")}</h3>
    <div className="grid cols-4">
     <Guard title={t("Verified NAV","NAV ที่ตรวจสอบแล้ว")} text={t("Withheld when any market price is missing or stale.","ไม่แสดงเมื่อราคาตลาดขาดหรือเก่า")}/>
     <Guard title={t("Atomic trades","ธุรกรรมแบบ Atomic")} text={t("Buy and sell update Holdings and Ledger together.","ซื้อขายอัปเดต Holdings และ Ledger พร้อมกัน")}/>
     <Guard title={t("Reconciliation","กระทบยอด")} text={t("Shares and Avg Cost can be corrected without a synthetic trade.","แก้ Shares และ Avg Cost ได้โดยไม่สร้างรายการปลอม")}/>
     <Guard title={t("Human approval","มนุษย์อนุมัติ")} text={t("Committee proposals never execute automatically.","ข้อเสนอจากที่ประชุมไม่ซื้อขายอัตโนมัติ")}/>
    </div>
   </section>
  </section>}

  {show("holdings")&&<section id="holdings-master" style={{scrollMarginTop:150}}>
   <SectionHeader step="02" title={t("Holdings Master & Reconciliation","รายการถือครองหลักและการกระทบยอด")} subtitle={t("Review each position, live market context, portfolio weight and broker reconciliation controls.","ตรวจสอบแต่ละสถานะ ราคาตลาด น้ำหนักพอร์ต และเครื่องมือกระทบยอดกับโบรกเกอร์")}/>
   <HoldingsMarketMonitor key={`holdings-${refreshKey}`} onUpdated={onRefresh}/>
  </section>}

  {show("transactions")&&<section id="holdings-transactions" style={{scrollMarginTop:150}}>
   <SectionHeader step="03" title={t("Transaction Operations & Audit Ledger","งานซื้อขายและสมุดบัญชีตรวจสอบ")} subtitle={t("Record real BUY or SELL activity and review the auditable trade history generated from the same ledger.","บันทึก BUY หรือ SELL จริงและตรวจสอบประวัติธุรกรรมจาก Ledger ชุดเดียวกัน")}/>
   <PortfolioTransactionOverride lang={lang} onSaved={onRefresh}/>
   <PortfolioLedgerPanel lang={lang} refreshKey={refreshKey}/>
  </section>}

  {show("income")&&<section id="holdings-income" style={{scrollMarginTop:150}}>
   <SectionHeader step="04" title={t("Cash, Liquidity & Income Center","ศูนย์เงินสด สภาพคล่อง และรายได้")} subtitle={t("Track cash movements, SGOV buffer policy, dividend receipts and upcoming income events.","ติดตามกระแสเงินสด นโยบาย SGOV Buffer เงินปันผลที่ได้รับ และกำหนดการรายได้")}/>
   <DividendCalendarPanel lang={lang}/>
   <section className="portfolio-operations-grid">
    <CashLedgerPanel lang={lang} refreshKey={refreshKey}/>
    <CashBufferPanel lang={lang} refreshKey={refreshKey}/>
    <DividendLedgerPanel lang={lang} refreshKey={refreshKey}/>
   </section>
  </section>}

  {show("risk")&&<section id="holdings-risk" style={{scrollMarginTop:150}}>
   <SectionHeader step="05" title={t("Risk, Allocation & Rebalance Proposals","ความเสี่ยง การจัดสรร และข้อเสนอปรับพอร์ต")} subtitle={t("Generate allocation and capital-source proposals without changing holdings until a real transaction is approved and recorded.","สร้างข้อเสนอจัดสรรและแหล่งเงินโดยไม่เปลี่ยน Holdings จนกว่าจะอนุมัติและบันทึกธุรกรรมจริง")}/>
   <section className="card">
    <div className="notice">{t("Proposal-only zone: approved changes must still be recorded through the transaction workflow. This prevents committee ideas from silently changing the portfolio.","พื้นที่ข้อเสนอเท่านั้น: การเปลี่ยนแปลงที่อนุมัติแล้วต้องบันทึกผ่านขั้นตอนซื้อขาย เพื่อป้องกันข้อเสนอจากที่ประชุมเปลี่ยนพอร์ตโดยไม่รู้ตัว")}</div>
    <div style={{marginTop:14}}><PortfolioOptimizerPanel lang={lang} refreshKey={refreshKey}/><OpportunityAllocationPanel lang={lang} refreshKey={refreshKey}/></div>
   </section>
  </section>}
 </div>
}

function SectionHeader({step,title,subtitle}:{step:string;title:string;subtitle:string}){return <div className="card" style={{padding:"16px 18px",borderLeft:"3px solid var(--accent)",marginBottom:10}}><div style={{display:"flex",gap:14,alignItems:"center"}}><div style={{fontSize:26,fontWeight:900,color:"var(--accent)"}}>{step}</div><div><h3 className="sub" style={{margin:0}}>{title}</h3><p className="muted" style={{margin:"5px 0 0"}}>{subtitle}</p></div></div></div>}
function Guard({title,text}:{title:string;text:string}){return <div className="metric"><span>{title}</span><strong style={{fontSize:15,lineHeight:1.4}}>{text}</strong></div>}
