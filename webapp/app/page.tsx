"use client";

import { useState } from "react";
import ResearchTabV2 from "./components/ResearchTabV2";
import PortfolioTruthSummary from "./components/PortfolioTruthSummary";
import PortfolioLedgerPanel from "./components/PortfolioLedgerPanel";
import DividendLedgerPanel from "./components/DividendLedgerPanel";
import CashLedgerPanel from "./components/CashLedgerPanel";
import CashBufferPanel from "./components/CashBufferPanel";
import PortfolioOptimizerPanel from "./components/PortfolioOptimizerPanel";
import OpportunityAllocationPanel from "./components/OpportunityAllocationPanel";
import CommandCenterV10 from "./components/CommandCenterV10";
import EndToEndInvestmentCommittee from "./components/EndToEndInvestmentCommittee";
import ResearchWorkspaceV12 from "./components/ResearchWorkspaceV12";
import HoldingsMarketMonitor from "./components/HoldingsMarketMonitor";
import DividendCalendarPanel from "./components/DividendCalendarPanel";
import PortfolioTransactionOverride from "./components/PortfolioTransactionOverride";
import ExecutiveDashboard from "./components/ExecutiveDashboard";
import { InstitutionalPageHeader, InstitutionalSidebar, InstitutionalWorkspaceTabs, ResearchWorkflow, type InstitutionalSection } from "./components/InstitutionalShell";
import "./institutional-shell.css";
import "./portfolio-reconcile.css";
import "./sentinel-v8-ui.css";

export type AppLang = "en" | "th";

export default function Home() {
  const [section, setSection] = useState<InstitutionalSection>("home");
  const [lang, setLang] = useState<AppLang>("en");
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);
  const navigate = (id: string) => {
    setSection(id as InstitutionalSection);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const refreshPortfolio = () => setPortfolioRefresh((value) => value + 1);

  return (
    <div className="sentinel-shell sentinel-v12" data-sentinel-version="12.0" data-architecture="domain-workspaces" data-source-of-truth="portfolio-ledger">
      <header className="sentinel-topbar v11-topbar">
        <div className="sentinel-brand-lockup" aria-label="Sentinel Investment">
          <div className="sentinel-mark" aria-hidden="true">
            <svg viewBox="0 0 72 78" role="img"><defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset=".28" stopColor="#9fc7ff"/><stop offset=".58" stopColor="#317cff"/><stop offset=".82" stopColor="#8f5cff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs><path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/></svg>
          </div>
          <div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT OS</strong><span>Institutional Fund Operating System v12</span></div>
        </div>
        <div className="sentinel-control-cluster">
          <div className="sentinel-status"><span className="sentinel-status-dot"/>MARKET DATA ONLINE</div>
          <button className="btn ghost sm sentinel-lang-btn" type="button" onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "🇹🇭 ไทย" : "EN"}</button>
        </div>
      </header>

      <InstitutionalWorkspaceTabs active={section} onChange={navigate} lang={lang} />

      <div className="institutional-layout v11-layout">
        <InstitutionalSidebar active={section} onChange={navigate} lang={lang} />
        <div className="institutional-content">
          <InstitutionalPageHeader section={section} lang={lang} />
          {section === "research" && <ResearchWorkflow lang={lang} />}
          <main className="sentinel-main v11-main">
            {section === "home" && <ExecutiveDashboard lang={lang} onNavigate={navigate} />}

            {section === "command" && (
              <div className="workspace-stack" data-workspace="cio-command-center">
                <CommandCenterV10 lang={lang} onNavigate={navigate} />
                <EndToEndInvestmentCommittee lang={lang} />
              </div>
            )}

            {section === "portfolio" && (
              <div className="workspace-stack" data-workspace="portfolio-management">
                <PortfolioTruthSummary lang={lang} refreshKey={portfolioRefresh} />
                <PortfolioTransactionOverride lang={lang} onSaved={refreshPortfolio} />
                <HoldingsMarketMonitor key={`market-${portfolioRefresh}`} onUpdated={refreshPortfolio} />
                <PortfolioLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
                <DividendCalendarPanel lang={lang} />
                <section className="portfolio-operations-grid">
                  <CashLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
                  <CashBufferPanel lang={lang} refreshKey={portfolioRefresh} />
                  <DividendLedgerPanel lang={lang} refreshKey={portfolioRefresh} />
                </section>
                <details className="card advanced-tools-card">
                  <summary>{lang === "th" ? "เครื่องมือจัดสรรและปรับสมดุลขั้นสูง" : "Advanced allocation and rebalance tools"}</summary>
                  <div className="advanced-tools-body">
                    <PortfolioOptimizerPanel lang={lang} refreshKey={portfolioRefresh} />
                    <OpportunityAllocationPanel lang={lang} refreshKey={portfolioRefresh} />
                  </div>
                </details>
              </div>
            )}

            {section === "analyze" && <div className="workspace-stack" data-workspace="stock-analysis"><ResearchTabV2 lang={lang} /></div>}
            {section === "research" && <div className="workspace-stack" data-workspace="research-lab"><ResearchWorkspaceV12 lang={lang} /></div>}
          </main>
        </div>
      </div>

      <footer className="footer-note v11-footer">Sentinel Investment OS v12 · Research → Stock Analysis → CIO Committee → Portfolio Execution · Human approval remains mandatory.</footer>
    </div>
  );
}
