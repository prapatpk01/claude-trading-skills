"use client";
import { useState } from "react";
import AnalyzeTab from "./components/AnalyzeTab";
import PortfolioTab from "./components/PortfolioTab";
import ScannerTab from "./components/ScannerTab";
import FundCommandCenter from "./components/FundCommandCenter";
import TabNav, { type TabDef } from "./components/TabNav";

const TABS: TabDef[] = [
  { id: "command", label: "◈ Fund Command" },
  { id: "analyze", label: "🔎 Research" },
  { id: "portfolio", label: "💼 Portfolio" },
  { id: "scanner", label: "📡 Alpha Scanner" },
];

export default function Home() {
  const [tab, setTab] = useState<string>("command");
  return (
    <div className="container">
      <header className="app">
        <div className="brand">
          <div className="logo">Σ</div>
          <div>
            <h1>Sentinel Capital</h1>
            <p>Fund Management OS · Research · Portfolio Construction · Risk · Alpha Discovery</p>
          </div>
        </div>
        <TabNav tabs={TABS} active={tab} onChange={setTab} />
      </header>

      {tab === "command" && <FundCommandCenter onNavigate={setTab} />}
      {tab === "analyze" && <AnalyzeTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "scanner" && <ScannerTab />}

      <div className="footer-note">
        Sentinel Capital research system · Market data: Yahoo Finance + SEC EDGAR · Persistence: Supabase. <br />
        Decision-support software for research and portfolio management. Market data may be delayed; validate execution decisions independently.
      </div>
    </div>
  );
}
