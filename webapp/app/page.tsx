"use client";
import { useState } from "react";
import AnalyzeTab from "./components/AnalyzeTab";
import PortfolioTab from "./components/PortfolioTab";
import ScannerTab from "./components/ScannerTab";
import TabNav, { type TabDef } from "./components/TabNav";

const TABS: TabDef[] = [
  { id: "analyze", label: "🔎 Ticker Analysis" },
  { id: "portfolio", label: "💼 Portfolio & Watchlist" },
  { id: "scanner", label: "📡 Momentum Scanner" },
];

export default function Home() {
  const [tab, setTab] = useState<string>("analyze");
  return (
    <div className="container">
      <header className="app">
        <div className="brand">
          <div className="logo">Σ</div>
          <div>
            <h1>Equity Research Terminal</h1>
            <p>Type a ticker → institutional research workbook · portfolio tracking · momentum scans</p>
          </div>
        </div>
        <TabNav tabs={TABS} active={tab} onChange={setTab} />
      </header>

      {tab === "analyze" && <AnalyzeTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "scanner" && <ScannerTab />}

      <div className="footer-note">
        Data: Yahoo Finance + SEC EDGAR (free, no key) · Persistence: Supabase (falls back to in-memory). <br />
        For research and education only — nothing here is investment advice. Always do your own research.
      </div>
    </div>
  );
}
