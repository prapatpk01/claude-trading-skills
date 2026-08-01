"use client";
import { useMemo, useState } from "react";
import ResearchTabV2 from "./components/ResearchTabV2";
import PortfolioTab from "./components/PortfolioTab";
import PortfolioTruthSummary from "./components/PortfolioTruthSummary";
import PortfolioLedgerPanel from "./components/PortfolioLedgerPanel";
import DividendLedgerPanel from "./components/DividendLedgerPanel";
import CashLedgerPanel from "./components/CashLedgerPanel";
import CashBufferPanel from "./components/CashBufferPanel";
import PortfolioOptimizerPanel from "./components/PortfolioOptimizerPanel";
import OpportunityAllocationPanel from "./components/OpportunityAllocationPanel";
import AlphaScannerV2 from "./components/AlphaScannerV2";
import FundCommandCenter from "./components/FundCommandCenter";
import ActiveFundManager from "./components/ActiveFundManager";
import HoldingsIntelligence from "./components/HoldingsIntelligence";
import HoldingsMarketMonitor from "./components/HoldingsMarketMonitor";
import DividendCalendarPanel from "./components/DividendCalendarPanel";
import HoldingTransactionForm from "./components/HoldingTransactionForm";
import TabNav, { type TabDef } from "./components/TabNav";
import { InstitutionalPageHeader, InstitutionalSidebar, OpportunityWorkflow, type InstitutionalSection } from "./components/InstitutionalShell";
import "./institutional-shell.css";
import "./sentinel-v8-ui.css";

export type AppLang = "en" | "th";

export default function Home() {
  const [tab, setTab] = useState<InstitutionalSection>("command");
  const [lang, setLang] = useState<AppLang>("en");
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);

  const tabs = useMemo<TabDef[]>(() => lang === "th" ? [
    { id: "command", label: "◈ ศูนย์บัญชาการ" },
    { id: "analyze", label: "◉ วิจัยด้วย AI" },
    { id: "portfolio", label: "◇ พอร์ตลงทุน" },
    { id: "scanner", label: "⌁ สายงานโอกาส" },
  ] : [
    { id: "command", label: "◈ Command Center" },
    { id: "analyze", label: "◉ AI Research" },
    { id: "portfolio", label: "◇ Portfolio" },
    { id: "scanner", label: "⌁ Opportunity Pipeline" },
  ], [lang]);

  const navigate = (id: string) => setTab(id as InstitutionalSection);

  return (
    <div className="sentinel-shell">
      <header className="sentinel-topbar">
        <div className="sentinel-brand-lockup" aria-label="Sentinel Investment">
          <div className="sentinel-mark" aria-hidden="true">
            <svg viewBox="0 0 72 78" role="img">
              <defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset="0.28" stopColor="#9fc7ff"/><stop offset="0.58" stopColor="#6f7cff"/><stop offset="0.82" stopColor="#9a52ff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs>
              <path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)" opacity=".96"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/><path d="M36 24 47 30 36 36 25 30 36 24Z" fill="#e9f1ff" opacity=".96"/><path d="M36 39 45 44 36 49 27 44 36 39Z" fill="#91a9ff" opacity=".95"/>
            </svg>
          </div>
          <div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT</strong><span>Institutional AI Investment Operating System</span></div>
        </div>
        <div className="sentinel-control-cluster"><div className="sentinel-status"><span className="sentinel-status-dot"/>SYSTEM ONLINE</div><div className="sentinel-confidence"><span>AI CONFIDENCE</span><span className="sentinel-confidence-bar"><span/></span><strong>87%</strong></div></div>
      </header>

      <div className="sentinel-nav-wrap">
        <button className="btn ghost sm sentinel-lang-btn" type="button" onClick={() => setLang(lang === "en" ? "th" : "en")} aria-label="Toggle Thai English language">{lang === "en" ? "🇹🇭 แปลไทย" : "EN English"}</button>
        <TabNav tabs={tabs} active={tab} onChange={navigate} />
      </div>

      <div className="institutional-layout">
        <InstitutionalSidebar active={tab} onChange={navigate} lang={lang} />
        <div className="institutional-content">
          <InstitutionalPageHeader section={tab} lang={lang} />
          {tab === "scanner" && <OpportunityWorkflow lang={lang} />}
          <main className="sentinel-main">
            {tab === "command" && <FundCommandCenter onNavigate={navigate} lang={lang} />}
            {tab === "analyze" && <ResearchTabV2 lang={lang} />}
            {tab === "portfolio" && <>
              <ActiveFundManager lang={lang} />
              <HoldingsMarketMonitor />
              <DividendCalendarPanel lang={lang} />
              <HoldingsIntelligence lang={lang} />
              <div className="card" style={{ marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}><div><h2 className="section" style={{ margin: 0 }}>{lang === "th" ? "💼 จัดการรายการซื้อ / ขาย" : "💼 Holding Transactions"}</h2><p className="muted" style={{ margin: "6px 0 0" }}>{lang === "th" ? "เพิ่ม ซื้อเพิ่ม หรือลดสถานะ รองรับเศษหุ้นสูงสุด 7 ตำแหน่ง" : "Add, accumulate or reduce positions with fractional shares up to 7 decimal places."}</p></div><HoldingTransactionForm onSaved={() => setPortfolioRefresh((v) => v + 1)} /></div></div>
              <PortfolioTruthSummary lang={lang} refreshKey={portfolioRefresh} />
              <PortfolioLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
              <CashLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
              <CashBufferPanel lang={lang} refreshKey={portfolioRefresh} />
              <PortfolioOptimizerPanel lang={lang} refreshKey={portfolioRefresh} />
              <OpportunityAllocationPanel lang={lang} refreshKey={portfolioRefresh} />
              <DividendLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
              <style jsx global>{`.card form.searchbar:has(input[type="date"]) { display: none !important; }.portfolio-legacy > div > .grid.cols-4:first-child { display: none !important; }`}</style>
              <div className="portfolio-legacy" key={portfolioRefresh}><PortfolioTab /></div>
            </>}
            {tab === "scanner" && <AlphaScannerV2 lang={lang} />}
          </main>
        </div>
      </div>
      <div className="footer-note">{lang === "th" ? <>Sentinel Investment · ระบบสนับสนุนการตัดสินใจลงทุนด้วย AI ภายใต้การกำกับของมนุษย์<br/>ข้อมูลตลาดอาจล่าช้า ควรตรวจสอบข้อมูลก่อนส่งคำสั่งลงทุนจริง</> : <>Sentinel Investment · AI-powered institutional decision support with human oversight.<br/>Market data may be delayed; validate execution decisions independently.</>}</div>
    </div>
  );
}
