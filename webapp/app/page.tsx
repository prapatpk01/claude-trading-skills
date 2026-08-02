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
import AlphaDiscoveryPlatform from "./components/AlphaDiscoveryPlatform";
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
 const refreshPortfolio=()=>setPortfolioRefresh(v=>v+1);
 return <div className="sentinel-shell" data-sentinel-version="10.5" data-governance="adaptive-portfolio-committee" data-source-of-truth="unified-meeting-state-and-ledger">
  <header className="sentinel-topbar"><div className="sentinel-brand-lockup" aria-label="Sentinel Investment"><div className="sentinel-mark" aria-hidden="true"><svg viewBox="0 0 72 78" role="img"><defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset=".28" stopColor="#9fc7ff"/><stop offset=".58" stopColor="#6f7cff"/><stop offset=".82" stopColor="#9a52ff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs><path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/></svg></div><div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT</strong><span>Institutional AI Investment Operating System v10.5</span></div></div><div className="sentinel-control-cluster"><div className="sentinel-status"><span className="sentinel-status-dot"/>AI CIO ONLINE</div><div className="sentinel-confidence"><span>HUMAN OVERSIGHT</span><span className="sentinel-confidence-bar"><span/></span><strong>ON</strong></div></div></header>
  <div className="sentinel-nav-wrap"><button className="btn ghost sm sentinel-lang-btn" type="button" onClick={()=>setLang(lang==="en"?"th":"en")}>{lang==="en"?"🇹🇭 แปลไทย":"EN English"}</button><TabNav tabs={tabs} active={tab} onChange={navigate}/></div>
  <div className="institutional-layout"><InstitutionalSidebar active={tab} onChange={navigate} lang={lang}/><div className="institutional-content"><InstitutionalPageHeader section={tab} lang={lang}/>{tab==="scanner"&&<OpportunityWorkflow lang={lang}/>}<main className="sentinel-main">
   {tab==="command"&&<><CommandCenterV10 lang={lang} onNavigate={navigate}/><CommitteeMeetingV10 lang={lang}/><AICioPanel lang={lang}/><V9InstitutionalStatus lang={lang}/><MacroIntelligencePanel lang={lang}/></>}
   {tab==="analyze"&&<ResearchTabV2 lang={lang}/>} 
   {tab==="portfolio"&&<><CommitteeMeetingV10 lang={lang}/><PortfolioTruthSummary lang={lang} refreshKey={portfolioRefresh}/><HoldingsMarketMonitor key={`market-${portfolioRefresh}`}/><DividendCalendarPanel lang={lang}/><details className="card" style={{marginTop:18}}><summary style={{cursor:"pointer",fontWeight:800,fontSize:"1.05rem"}}>{lang==="th"?"Manual override, บัญชี และเครื่องมือขั้นสูง":"Manual override, accounting and advanced tools"}</summary><div style={{marginTop:18}}><div className="card"><h2 className="section">{lang==="th"?"Manual transaction override":"Manual transaction override"}</h2><p className="muted">{lang==="th"?"ใช้เฉพาะธุรกรรมที่ไม่ได้มาจากมติประชุม หรือเมื่อต้องแก้ไข Ticket ด้วยตนเอง":"Use only for transactions outside a committee resolution or when a ticket requires manual correction."}</p><HoldingTransactionForm onSaved={refreshPortfolio}/></div><PortfolioLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><CashLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><CashBufferPanel lang={lang} refreshKey={portfolioRefresh}/><PortfolioOptimizerPanel lang={lang} refreshKey={portfolioRefresh}/><OpportunityAllocationPanel lang={lang} refreshKey={portfolioRefresh}/><DividendLedgerPanel lang={lang} refreshKey={portfolioRefresh}/><div className="portfolio-legacy" key={portfolioRefresh}><PortfolioTab/></div></div></details></>}
   {tab==="scanner"&&<AlphaDiscoveryPlatform lang={lang}/>} 
  </main></div></div>
  <div className="footer-note">{lang==="th"?<>Sentinel Investment OS v10.5 · Unified Meeting State, Multi-Asset Resolution, Planned-vs-Actual Reconciliation และ Tiered Meeting Memory<br/>Proposal, Vote, Funding Plan, CIO Resolution และ Meeting Minutes ใช้ข้อมูลประชุมชุดเดียวกัน จึงไม่เกิดยอด 0 สวนกับคำสั่ง Trim อีก</>:<>Sentinel Investment OS v10.5 · Unified meeting state, multi-asset resolution, planned-vs-actual reconciliation and tiered meeting memory.<br/>Proposal, vote, funding plan, CIO resolution and meeting minutes now read from the same meeting state.</>}</div>
 </div>
}
