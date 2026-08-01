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
import SentinelInvestmentLogo from "./components/SentinelInvestmentLogo";
import TabNav, { type TabDef } from "./components/TabNav";
import "./sentinel-investment.css";

export type AppLang = "en" | "th";

export default function Home() {
  const [tab, setTab] = useState<string>("command");
  const [lang, setLang] = useState<AppLang>("en");
  const [portfolioRefresh, setPortfolioRefresh] = useState(0);

  const tabs = useMemo<TabDef[]>(() => lang === "th" ? [
    { id: "command", label: "◈ ศูนย์บัญชาการ" },
    { id: "analyze", label: "◉ วิจัยหลักทรัพย์" },
    { id: "portfolio", label: "◇ พอร์ตลงทุน" },
    { id: "scanner", label: "⌁ ค้นหาโอกาส" },
  ] : [
    { id: "command", label: "◈ Command Center" },
    { id: "analyze", label: "◉ Research" },
    { id: "portfolio", label: "◇ Portfolio" },
    { id: "scanner", label: "⌁ Opportunity Pipeline" },
  ], [lang]);

  const activeLabel = tabs.find((item) => item.id === tab)?.label ?? tabs[0]?.label;

  return (
    <div className="sentinel-shell">
      <header className="sentinel-topbar">
        <SentinelInvestmentLogo subtitle={lang === "th" ? "ระบบปฏิบัติการลงทุนสถาบันขับเคลื่อนด้วย AI" : "Institutional AI Investment Operating System"} />
        <div className="sentinel-control-cluster">
          <div className="sentinel-status"><span className="sentinel-status-dot" />SYSTEM ONLINE</div>
          <div className="sentinel-confidence" title="Institutional governance and evidence coverage">
            <span>AI CONFIDENCE</span>
            <span className="sentinel-confidence-bar"><span /></span>
            <strong>87%</strong>
          </div>
        </div>
      </header>

      <div className="sentinel-nav-wrap">
        <button className="btn ghost sm sentinel-lang-btn" type="button" onClick={() => setLang(lang === "en" ? "th" : "en")} aria-label="Toggle Thai English language" title={lang === "en" ? "แปลหน้าเป็นภาษาไทย" : "Switch to English"}>
          {lang === "en" ? "🇹🇭 แปลไทย" : "EN English"}
        </button>
        <TabNav tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div className="sentinel-command-strip">
        <strong>{activeLabel}</strong>
        <span>{lang === "th" ? "Institutional Grade · AI Powered · Human Oversight" : "Institutional Grade · AI Powered · Human Oversight"}</span>
      </div>

      <main className="sentinel-main">
        {tab === "command" && <FundCommandCenter onNavigate={setTab} lang={lang} />}
        {tab === "analyze" && <ResearchTabV2 lang={lang} />}
        {tab === "portfolio" && <>
          <ActiveFundManager lang={lang} />
          <HoldingsMarketMonitor />
          <DividendCalendarPanel lang={lang} />
          <HoldingsIntelligence lang={lang} />
          <div className="card" style={{ marginTop: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <h2 className="section" style={{ margin: 0 }}>{lang === "th" ? "◇ จัดการรายการซื้อ / ขาย" : "◇ Holding Transactions"}</h2>
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
      </main>

      <div className="footer-note">
        {lang === "th" ? (
          <>Sentinel Investment · ข้อมูลตลาด: Yahoo Finance + SEC EDGAR · จัดเก็บข้อมูล: Supabase<br />ระบบสนับสนุนการตัดสินใจลงทุนโดย AI ภายใต้การกำกับดูแลของมนุษย์ โปรดตรวจสอบข้อมูลก่อนดำเนินการจริง</>
        ) : (
          <>Sentinel Investment · Market data: Yahoo Finance + SEC EDGAR · Persistence: Supabase.<br />AI-powered institutional decision support with human oversight. Validate execution decisions independently.</>
        )}
      </div>
    </div>
  );
}
