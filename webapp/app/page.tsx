"use client";

import { useState } from "react";
import CIOCommandCenterV18 from "./components/CIOCommandCenterV18";
import SentinelTeamOperatingModelV19 from "./components/SentinelTeamOperatingModelV19";
import ResearchWorkspaceV12 from "./components/ResearchWorkspaceV12";
import WatchlistIntelligenceV13 from "./components/WatchlistIntelligenceV13";
import StockAnalysisDashboardV12 from "./components/StockAnalysisDashboardV12";
import HoldingsDashboardV12 from "./components/HoldingsDashboardV12";
import PortfolioPerformanceV13 from "./components/PortfolioPerformanceV13";
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
    <div className="sentinel-shell sentinel-v12" data-sentinel-version="19.0" data-architecture="elite-seat-accountability-model" data-source-of-truth="portfolio-ledger">
      <header className="sentinel-topbar v11-topbar">
        <div className="sentinel-brand-lockup" aria-label="Sentinel Investment">
          <div className="sentinel-mark" aria-hidden="true">
            <svg viewBox="0 0 72 78" role="img"><defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset=".28" stopColor="#9fc7ff"/><stop offset=".58" stopColor="#317cff"/><stop offset=".82" stopColor="#8f5cff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs><path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/></svg>
          </div>
          <div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT OS</strong><span>Institutional Fund Operating System v19</span></div>
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
            {section === "command" && <div className="workspace-stack" data-workspace="cio-v19"><CIOCommandCenterV18 lang={lang} onNavigate={navigate} /><SentinelTeamOperatingModelV19 lang={lang} /></div>}
            {section === "portfolio" && <div className="workspace-stack" data-workspace="portfolio-v13"><HoldingsDashboardV12 lang={lang} refreshKey={portfolioRefresh} onRefresh={refreshPortfolio} /><PortfolioPerformanceV13 lang={lang} refreshKey={portfolioRefresh} /></div>}
            {section === "analyze" && <StockAnalysisDashboardV12 lang={lang} />}
            {section === "research" && <div className="workspace-stack" data-workspace="research-v13"><ResearchWorkspaceV12 lang={lang} onNavigate={navigate} /><WatchlistIntelligenceV13 lang={lang} onNavigate={navigate} /></div>}
          </main>
        </div>
      </div>

      <footer className="footer-note v11-footer">Sentinel Investment OS v19 · Seat Ownership → Evidence → Decision → Risk Gate → Human Approval · No automatic execution.</footer>
    </div>
  );
}
