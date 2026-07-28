"use client";
import { useState } from "react";
import AnalyzeTab from "./components/AnalyzeTab";
import PortfolioTab from "./components/PortfolioTab";
import ScannerTab from "./components/ScannerTab";

const TABS = [
  { id: "analyze", label: "🔎 Ticker Analysis" },
  { id: "portfolio", label: "💼 Portfolio & Watchlist" },
  { id: "scanner", label: "📡 Momentum Scanner" },
] as const;

export default function Home() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("analyze");
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
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "analyze" && <AnalyzeTab />}
      {tab === "portfolio" && <PortfolioTab />}
      {tab === "scanner" && <ScannerTab />}

      <div className="footer-note">
        Data: Yahoo Finance (free, no key) · Persistence: Supabase (falls back to in-memory). <br />
        For research and education only — nothing here is investment advice. Always do your own research.
      </div>
    </div>
  );
}
