"use client";
import { useMemo, useState } from "react";
import ResearchTabV2 from "./components/ResearchTabV2";
import PortfolioTab from "./components/PortfolioTab";
import AlphaScannerV2 from "./components/AlphaScannerV2";
import FundCommandCenter from "./components/FundCommandCenter";
import ActiveFundManager from "./components/ActiveFundManager";
import HoldingsIntelligence from "./components/HoldingsIntelligence";
import HoldingsMarketMonitor from "./components/HoldingsMarketMonitor";
import DividendCalendarPanel from "./components/DividendCalendarPanel";
import HoldingTransactionForm from "./components/HoldingTransactionForm";
import TabNav, { type TabDef } from "./components/TabNav";

export type AppLang = "en" | "th";

export default function Home() {
  const [tab, setTab] = useState<string>("command");
  const [lang, setLang] = useState<AppLang>("en");
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);

  const tabs = useMemo<TabDef[]>(() => lang === "th" ? [
    { id: "command", label: "◈ ศูนย์บัญชาการกองทุน" },
    { id: "analyze", label: "🔎 วิเคราะห์หุ้น" },
    { id: "portfolio", label: "💼 พอร์ตลงทุน" },
    { id: "scanner", label: "📡 สแกนหา Alpha" },
  ] : [
    { id: "command", label: "◈ Fund Command" },
    { id: "analyze", label: "🔎 Research" },
    { id: "portfolio", label: "💼 Portfolio" },
    { id: "scanner", label: "📡 Alpha Scanner" },
  ], [lang]);

  return (
    <div className="container">
      <header className="app">
        <div className="brand">
          <div className="logo">Σ</div>
          <div>
            <h1>Sentinel Capital</h1>
            <p>{lang === "th" ? "ระบบบริหารกองทุน · วิจัย · จัดพอร์ต · ควบคุมความเสี่ยง · ค้นหา Alpha" : "Fund Management OS · Research · Portfolio Construction · Risk · Alpha Discovery"}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn ghost sm" type="button" onClick={() => setLang(lang === "en" ? "th" : "en")} aria-label="Toggle Thai English language" title={lang === "en" ? "แปลหน้าเป็นภาษาไทย" : "Switch to English"}>
            {lang === "en" ? "🇹🇭 แปลไทย" : "EN English"}
          </button>
          <TabNav tabs={tabs} active={tab} onChange={setTab} />
        </div>
      </header>

      {tab === "command" && <FundCommandCenter onNavigate={setTab} lang={lang} />}
      {tab === "analyze" && <ResearchTabV2 lang={lang} />}
      {tab === "portfolio" && <>
        <ActiveFundManager />
        <HoldingsMarketMonitor />
        <DividendCalendarPanel lang={lang} />
        <HoldingsIntelligence lang={lang} />
        <div className="card" style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <div>
              <h2 className="section" style={{ margin: 0 }}>{lang === "th" ? "💼 จัดการรายการซื้อ / ขาย" : "💼 Holding Transactions"}</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>{lang === "th" ? "เพิ่ม ซื้อเพิ่ม หรือลดสถานะ รองรับเศษหุ้นสูงสุด 7 ตำแหน่ง" : "Add, accumulate or reduce positions with fractional shares up to 7 decimal places."}</p>
            </div>
            <HoldingTransactionForm onSaved={() => setPortfolioRefresh((v) => v + 1)} />
          </div>
        </div>
        <style jsx global>{`
          .card form.searchbar:has(input[type="date"]) { display: none !important; }
        `}</style>
        <div key={portfolioRefresh}><PortfolioTab /></div>
      </>}
      {tab === "scanner" && <AlphaScannerV2 lang={lang} />}

      <div className="footer-note">
        {lang === "th" ? (
          <>ระบบวิจัย Sentinel Capital · ข้อมูลตลาด: Yahoo Finance + SEC EDGAR · จัดเก็บข้อมูล: Supabase<br />ซอฟต์แวร์นี้ใช้เพื่อสนับสนุนการวิเคราะห์และบริหารพอร์ต ข้อมูลตลาดอาจล่าช้า ควรตรวจสอบข้อมูลก่อนตัดสินใจลงทุนจริง</>
        ) : (
          <>Sentinel Capital research system · Market data: Yahoo Finance + SEC EDGAR · Persistence: Supabase. <br />Decision-support software for research and portfolio management. Market data may be delayed; validate execution decisions independently.</>
        )}
      </div>
    </div>
  );
}