"use client";
import {useMemo,useState} from "react";
import ResearchTabV2 from "./components/ResearchTabV2";
import PortfolioTab from "./components/PortfolioTab";
import PortfolioTruthSummary from "./components/PortfolioTruthSummary";
import PortfolioLedgerPanel from "./components/PortfolioLedgerPanel";
import DividendLedgerPanel from "./components/DividendLedgerPanel";
import CashLedgerPanel from "./components/CashLedgerPanel";
import CashBufferPanel from "./components/CashBufferPanel";
import PortfolioOptimizerPanel from "./components/PortfolioOptimizerPanel";
import OpportunityAllocationPanel from "./components/OpportunityAllocationPanel";
import MacroIntelligencePanel from "./components/MacroIntelligencePanel";
import V9InstitutionalStatus from "./components/V9InstitutionalStatus";
import AICioPanel from "./components/AICioPanel";
import CommandCenterV10 from "./components/CommandCenterV10";
import CommitteeMeetingV10 from "./components/CommitteeMeetingV10";
import FundOperatingCycleV2 from "./components/FundOperatingCycleV2";
import AlphaScannerV2 from "./components/AlphaScannerV2";
import HoldingsIntelligence from "./components/HoldingsIntelligence";
import HoldingsMarketMonitor from "./components/HoldingsMarketMonitor";
import DividendCalendarPanel from "./components/DividendCalendarPanel";
import HoldingTransactionForm from "./components/HoldingTransactionForm";
import TabNav,{type TabDef} from "./components/TabNav";
import {InstitutionalPageHeader,InstitutionalSidebar,OpportunityWorkflow,type InstitutionalSection} from "./components/InstitutionalShell";
import "./institutional-shell.css";
import "./sentinel-v8-ui.css";
export type AppLang="en"|"th";
export default function Home(){
 const[tab,setTab]=useState<InstitutionalSection>("command");
 const[lang,setLang]=useState<AppLang>("en");
 const[portfolioRefresh,setPortfolioRefresh]=useState(0);
 const tabs=useMemo<TabDef[]>(()=>lang==="th"?[
  {id:"command",label:"◈ ศูนย์บัญชาการ"},{id:"analyze",label:"◉ วิจัยด้วย AI"},{id:"portfolio",label:"◇ พอร์ตลงทุน"},{id:"scanner",label:"⌁ ค้นหาโอกาส"}
 ]:[{id:"command",label:"◈ Command Center"},{id:"analyze",label:"◉ AI Research"},{id:"portfolio",label:"◇ Portfolio"},{id:"scanner",label:"⌁ Opportunity Pipeline"}],[lang]);
 const navigate=(id:string)=>setTab(id as InstitutionalSection);
 return <div className="sentinel-shell">
  <header className="sentinel-topbar"><div className="sentinel-brand-lockup" aria-label="Sentinel Investment"><div className="sentinel-mark" aria-hidden="true"><svg viewBox="0 0 72 78" role="img"><defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset=".28" stopColor="#9fc7ff"/><stop offset=".58" stopColor="#6f7cff"/><stop offset=".82" stopColor="#9a52ff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs><path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/></svg></div><div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT</strong><span>Institutional AI Investment Operating System v10.1</span></div></div><div className="sentinel-control-cluster"><div className="sentinel-status"><span className="sentinel-status-dot"/>AI CIO ONLINE</div><div className="sentinel-confidence"><span>HUMAN OVERSIGHT</span><span className="sentinel-confidence-bar"><span/></span><strong>ON</strong></div></div></header>
  <div className="sentinel-nav-wrap"><button className="btn ghost sm sentinel-lang-btn" type="button" onClick={()=>setLang(lang==="en"?"th":"en")}>{lang==="en"?"🇹🇭 แปลไทย":"EN English"}</button><TabNav tabs={tabs} active={tab} onChange={navigate}/></div>
  <div className="institutional-layout"><InstitutionalSidebar active={tab} onChange={navigate} lang={lang}/><div className="institutional-content"><InstitutionalPageHeader section={tab} lang={lang}/>{tab==="scanner"&&<OpportunityWorkflow lang={lang}/>}<main className="sentinel-main">
   {tab==="command"&&<><CommandCenterV10 lang={lang} onNavigate={navigate}/><CommitteeMeetingV10 lang={lang}/><AICioPanel lang={lang}/><V9InstitutionalStatus lang={lang}/><MacroIntelligencePanel lang={lang}/></>}
   {tab==="analyze"&&<ResearchTabV2 lang={lang}/>} 
   {tab==="portfolio"&&<><FundOperatingCycleV2 lang={lang}/><div className="card" style={{marginTop:18}}><div style={{display:"flex",justifyContent:"space-between",gap:14,alignItems:"center",flexWrap:"wrap"}}><div><h2 className="section" style={{margin:0}}>{lang==="th"?"อนุมัติและบันทึกธุรกรรม":"Approve & Record Transactions"}</h2><p className="muted" style={{margin:"6px 0 0"}}>{lang==="th"?"ใช้หลังตรวจมติจาก Fund Operating Cycle เท่านั้น ระบบไม่ซื้อขายอัตโนมัติ":"Use only after reviewing the Fund Operating Cycle resolution. Nothing executes automatically."}</p></div><HoldingTransactionForm onSaved={()=>setPortfolioRefresh(v=>v+1)}/></div></div><PortfolioTruthSummary lang={lang} refreshKey={portfolioRefresh}/><HoldingsMarketMonitor/><DividendCalendarPanel lang={lang}/><HoldingsIntelligence lang={lang}/><details className="card" style={{marginTop:18}}><summary style={{cursor:"pointer",fontWeight:800,fontSize:"1.05rem"}}>{lang==="th"?"รายละเอียดบัญชี การตรวจสอบ และเครื่องมือขั้นสูง":"Accounting, audit and advanced tools"}</summary><div style={{marginTop:18}}><PortfolioLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><CashLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><CashBufferPanel lang={lang} refreshKey={portfolioRefresh}/><PortfolioOptimizerPanel lang={lang} refreshKey={portfolioRefresh}/><OpportunityAllocationPanel lang={lang} refreshKey={portfolioRefresh}/><DividendLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><div className="portfolio-legacy" key={portfolioRefresh}><PortfolioTab/></div></div></details></>}
   {tab==="scanner"&&<AlphaScannerV2 lang={lang}/>} 
  </main></div></div>
  <div className="footer-note">{lang==="th"?<>Sentinel Investment OS v10.1 · AI CIO ภายใต้การกำกับของมนุษย์<br/>ระบบไม่ส่งคำสั่งซื้อขายอัตโนมัติ ทุกการตัดสินใจต้องผ่านหลักฐาน Governance และ Audit Trail</>:<>Sentinel Investment OS v10.1 · Institutional AI CIO with mandatory human oversight.<br/>No recommendation executes automatically; every decision requires evidence, governance and an audit trail.</>}</div>
 </div>
}
