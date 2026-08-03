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

type Tab="overview"|"holdings"|"transactions"|"income"|"risk";
const tabs:{id:Tab;en:string;th:string}[]=[
 {id:"overview",en:"Overview",th:"ภาพรวม"},
 {id:"holdings",en:"Holdings",th:"รายการถือครอง"},
 {id:"transactions",en:"Transactions",th:"ซื้อขาย"},
 {id:"income",en:"Cash & Income",th:"เงินสดและรายได้"},
 {id:"risk",en:"Risk & Rebalance",th:"ความเสี่ยงและปรับพอร์ต"},
];

export default function HoldingsDashboardV12({lang,refreshKey,onRefresh}:{lang:AppLang;refreshKey:number;onRefresh:()=>void}){
 const[tab,setTab]=useState<Tab>("overview");
 const t=(en:string,th:string)=>lang==="th"?th:en;
 return <div className="workspace-stack" data-holdings-version="12.3" data-source-of-truth="portfolio-ledger">
  <section className="card" style={{borderTop:"2px solid var(--accent)"}}>
   <div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"flex-start",flexWrap:"wrap"}}>
    <div><span className="tag">HOLDINGS · PHASE 3</span><h2 className="section" style={{margin:"10px 0 5px"}}>{t("Institutional Portfolio Operations","ระบบบริหารพอร์ตระดับสถาบัน")}</h2><p className="muted" style={{margin:0,maxWidth:780}}>{t("One portfolio ledger powers holdings, valuation, reconciliation, trades, cash, income and rebalance tools. Reconciliation edits master data without creating a fake trade.","Portfolio Ledger ชุดเดียวใช้กับ Holdings, Valuation, Reconciliation, Trade, Cash, Income และ Rebalance การแก้ข้อมูลเพื่อกระทบยอดจะไม่สร้างรายการซื้อขายปลอม")}</p></div>
    <span className="tag">SINGLE SOURCE OF TRUTH</span>
   </div>
   <div style={{display:"flex",gap:8,overflowX:"auto",marginTop:16,paddingBottom:4}}>
    {tabs.map(item=><button key={item.id} type="button" className={`btn ${tab===item.id?"":"ghost"}`} onClick={()=>setTab(item.id)}>{lang==="th"?item.th:item.en}</button>)}
   </div>
  </section>

  {tab==="overview"&&<>
   <PortfolioTruthSummary lang={lang} refreshKey={refreshKey}/>
   <section className="card"><h3 className="sub">{t("Portfolio control principles","หลักควบคุมพอร์ต")}</h3><div className="grid cols-4">
    <Guard title={t("Verified NAV","NAV ที่ตรวจสอบแล้ว")} text={t("Withheld when any market price is missing or stale.","ไม่แสดงเมื่อราคาตลาดขาดหรือเก่า")}/>
    <Guard title={t("Atomic trades","ธุรกรรมแบบ Atomic")} text={t("Buy and sell update Holdings and Ledger together.","ซื้อขายอัปเดต Holdings และ Ledger พร้อมกัน")}/>
    <Guard title={t("Reconciliation","กระทบยอด")} text={t("Shares and Avg Cost can be corrected without a synthetic trade.","แก้ Shares และ Avg Cost ได้โดยไม่สร้างรายการปลอม")}/>
    <Guard title={t("Human approval","มนุษย์อนุมัติ")} text={t("Committee proposals never execute automatically.","ข้อเสนอจากที่ประชุมไม่ซื้อขายอัตโนมัติ")}/>
   </div></section>
  </>}

  {tab==="holdings"&&<HoldingsMarketMonitor key={`holdings-${refreshKey}`} onUpdated={onRefresh}/>} 
  {tab==="transactions"&&<><PortfolioTransactionOverride lang={lang} onSaved={onRefresh}/><PortfolioLedgerPanel lang={lang} refreshKey={refreshKey}/></>}
  {tab==="income"&&<><DividendCalendarPanel lang={lang}/><section className="portfolio-operations-grid"><CashLedgerPanel lang={lang} refreshKey={refreshKey}/><CashBufferPanel lang={lang} refreshKey={refreshKey}/><DividendLedgerPanel lang={lang} refreshKey={refreshKey}/></section></>}
  {tab==="risk"&&<section className="card"><h3 className="sub">{t("Allocation, risk and rebalance tools","เครื่องมือจัดสรร ความเสี่ยง และปรับพอร์ต")}</h3><div className="notice">{t("These tools create proposals only. Approved changes must still be recorded through the transaction workflow.","เครื่องมือส่วนนี้สร้างข้อเสนอเท่านั้น การเปลี่ยนแปลงที่อนุมัติแล้วยังต้องบันทึกผ่านขั้นตอนซื้อขาย")}</div><div style={{marginTop:14}}><PortfolioOptimizerPanel lang={lang} refreshKey={refreshKey}/><OpportunityAllocationPanel lang={lang} refreshKey={refreshKey}/></div></section>}
 </div>
}

function Guard({title,text}:{title:string;text:string}){return <div className="metric"><span>{title}</span><strong style={{fontSize:15,lineHeight:1.4}}>{text}</strong></div>}
