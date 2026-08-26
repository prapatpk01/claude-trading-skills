"use client";

import { useState } from "react";
import CIOCommandCenterV35 from "./components/CIOCommandCenterV351";
import ResearchWorkspaceV12 from "./components/ResearchWorkspaceV12";
import WatchlistIntelligenceV14 from "./components/WatchlistIntelligenceV14";
import StockAnalysisDashboardV12 from "./components/StockAnalysisDashboardV12";
import HoldingsDashboardV12 from "./components/HoldingsDashboardV12";
import PortfolioPerformanceV13 from "./components/PortfolioPerformanceV13";
import ExecutiveDashboard from "./components/ExecutiveDashboard";
import MomentumForecastWorkspace from "./components/MomentumForecastWorkspace";
import { InstitutionalPageHeader, InstitutionalSidebar, InstitutionalWorkspaceTabs, ResearchWorkflow, type InstitutionalSection } from "./components/InstitutionalShell";
import { SENTINEL_RELEASE, sentinelReleaseLabel } from "@/lib/release";
import "./institutional-shell.css";
import "./portfolio-reconcile.css";
import "./watchlist-controls.css";
import "./sentinel-v8-ui.css";

export type AppLang = "en" | "th";

const CIO_FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v35";

export default function Home() {
  const [section, setSection] = useState<InstitutionalSection>("home");
  const [lang, setLang] = useState<AppLang>("en");
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);
  const navigate = (id: string) => {
    const next = id as InstitutionalSection;
    // A recorded meeting is an audit snapshot, not a live portfolio source.
    // Clear it before mounting Command so a ledger update cannot resurrect an old decision package.
    if (next === "command") window.localStorage.removeItem(CIO_FROZEN_MEETING_KEY);
    setSection(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const refreshPortfolio = () => setPortfolioRefresh((value) => value + 1);
  return (
    <div className="sentinel-shell sentinel-v12" data-sentinel-version={SENTINEL_RELEASE.appVersion} data-capital-clarity-version={SENTINEL_RELEASE.capitalClarityVersion} data-forecast-version={SENTINEL_RELEASE.forecastVersion} data-technical-version={SENTINEL_RELEASE.technicalVersion} data-research-version={SENTINEL_RELEASE.researchVersion} data-architecture="unified-cio-command-path" data-source-of-truth="portfolio-ledger">
      <header className="sentinel-topbar v11-topbar"><div className="sentinel-brand-lockup" aria-label="Sentinel Investment"><div className="sentinel-mark" aria-hidden="true"><svg viewBox="0 0 72 78" role="img"><defs><linearGradient id="sentinelWing" x1="8" y1="8" x2="65" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f2f3ff"/><stop offset=".28" stopColor="#9fc7ff"/><stop offset=".58" stopColor="#317cff"/><stop offset=".82" stopColor="#8f5cff"/><stop offset="1" stopColor="#31d9f3"/></linearGradient></defs><path d="M36 4 63 17 55 27 36 18 17 27 9 17 36 4Z" fill="url(#sentinelWing)"/><path d="M12 25 34 35 34 47 20 41 27 52 34 55 34 73 22 64 8 42 12 25Z" fill="url(#sentinelWing)"/><path d="M60 25 38 35 38 47 52 41 45 52 38 55 38 73 50 64 64 42 60 25Z" fill="url(#sentinelWing)"/></svg></div><div className="sentinel-wordmark"><strong>SENTINEL</strong><strong>INVESTMENT OS</strong><span>Fund Decision OS V{SENTINEL_RELEASE.appVersion} · Capital Clarity</span></div></div><div className="sentinel-control-cluster"><div className="sentinel-status"><span className="sentinel-status-dot"/>MARKET DATA ONLINE</div><button className="btn ghost sm sentinel-lang-btn" type="button" onClick={() => setLang(lang === "en" ? "th" : "en")}>{lang === "en" ? "🇹🇭 ไทย" : "EN"}</button></div></header>
      <InstitutionalWorkspaceTabs active={section} onChange={navigate} lang={lang} />
      <div className="institutional-layout v11-layout"><InstitutionalSidebar active={section} onChange={navigate} lang={lang} /><div className="institutional-content"><InstitutionalPageHeader section={section} lang={lang} />{section === "research" && <ResearchWorkflow lang={lang} />}<main className="sentinel-main v11-main">{section === "home" && <ExecutiveDashboard lang={lang} onNavigate={navigate} />}{section === "command" && <div className="workspace-stack" data-workspace="cio-v35" data-command-steps="5"><CIOCommandCenterV35 lang={lang} onNavigate={navigate} /></div>}{section === "portfolio" && <div className="workspace-stack" data-workspace="portfolio-v13" data-forecast-version={SENTINEL_RELEASE.forecastVersion}><HoldingsDashboardV12 lang={lang} refreshKey={portfolioRefresh} onRefresh={refreshPortfolio} /><MomentumForecastWorkspace scope="holdings" lang={lang} /><PortfolioPerformanceV13 lang={lang} refreshKey={portfolioRefresh} /></div>}{section === "analyze" && <StockAnalysisDashboardV12 lang={lang} />}{section === "research" && <div className="workspace-stack" data-workspace="research-v14" data-forecast-version={SENTINEL_RELEASE.forecastVersion}><ResearchWorkspaceV12 lang={lang} onNavigate={navigate} /><WatchlistIntelligenceV14 lang={lang} onNavigate={navigate} /><MomentumForecastWorkspace scope="research" lang={lang} /></div>}</main></div></div>
      <footer className="footer-note v11-footer">{sentinelReleaseLabel} · Capital Clarity V{SENTINEL_RELEASE.capitalClarityVersion} · Research V{SENTINEL_RELEASE.researchVersion} · Technical V{SENTINEL_RELEASE.technicalVersion} · Forecast V{SENTINEL_RELEASE.forecastVersion} · STATUS → OPPORTUNITIES → PORTFOLIO → CAPITAL → CIO DECISION · Human approval remains mandatory · No automatic execution.</footer>
    </div>
  );
}
