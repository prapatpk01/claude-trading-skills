"use client";

import type { AppLang } from "../page";

export type InstitutionalSection = "home" | "command" | "portfolio" | "analyze" | "research";

const NAV = [
  { id: "home", icon: "⌂", en: "Home", th: "หน้าหลัก", desk: "Executive overview" },
  { id: "command", icon: "1", en: "CIO Command Center", th: "ศูนย์บัญชาการ CIO", desk: "Strategy & decisions" },
  { id: "portfolio", icon: "2", en: "Portfolio Management", th: "บริหารพอร์ต", desk: "Holdings & operations" },
  { id: "analyze", icon: "3", en: "Stock Analysis", th: "วิเคราะห์หุ้น", desk: "Deep company analysis" },
  { id: "research", icon: "4", en: "Research Lab", th: "ศูนย์วิจัย", desk: "Ideas & watchlist" },
] as const;

const PAGE_META: Record<InstitutionalSection, { eyebrow: string; title: string; titleTh: string; description: string; descriptionTh: string; status: string }> = {
  home: { eyebrow: "SENTINEL INVESTMENT OS V11", title: "Executive Dashboard", titleTh: "แดชบอร์ดผู้บริหารกองทุน", description: "Real-time operating picture across portfolio value, risk, liquidity, research and committee activity.", descriptionTh: "ภาพรวมการทำงานแบบเรียลไทม์ของมูลค่าพอร์ต ความเสี่ยง สภาพคล่อง งานวิจัย และคณะกรรมการลงทุน", status: "SYSTEM ONLINE" },
  command: { eyebrow: "EXECUTIVE INTELLIGENCE", title: "CIO Command Center", titleTh: "ศูนย์บัญชาการ CIO", description: "Analyze market regime, portfolio health, valuation and risk; debate strategy and issue governed investment resolutions.", descriptionTh: "วิเคราะห์สภาวะตลาด สุขภาพพอร์ต มูลค่าและความเสี่ยง พร้อมประชุม วางกลยุทธ์ และออกมติลงทุน", status: "COMMITTEE READY" },
  portfolio: { eyebrow: "PORTFOLIO OPERATIONS", title: "Portfolio Management", titleTh: "ระบบบริหารพอร์ต", description: "Holdings, transactions, cash, dividends, risk controls and performance from one production ledger.", descriptionTh: "ดูแล Holdings ธุรกรรม เงินสด ปันผล ความเสี่ยง และผลการดำเนินงานจากบัญชีการลงทุนชุดเดียว", status: "LEDGER CONTROLLED" },
  analyze: { eyebrow: "SECURITY UNDERWRITING", title: "Stock Analysis", titleTh: "ศูนย์วิเคราะห์หุ้น", description: "Deep company analysis across valuation, quality, growth, thesis, catalysts, risks and monitoring evidence.", descriptionTh: "วิเคราะห์หุ้นเชิงลึกด้าน Valuation, Quality, Growth, Thesis, Catalyst, Risk และ Monitoring", status: "EVIDENCE FIRST" },
  research: { eyebrow: "OPPORTUNITY DISCOVERY", title: "Research Lab", titleTh: "ศูนย์วิจัยและค้นหาโอกาส", description: "Scan the investable universe, rank candidates, build the watchlist and promote qualified ideas to analysis and committee review.", descriptionTh: "สแกนตลาด จัดอันดับหุ้น สร้าง Watchlist และส่งไอเดียที่ผ่านเข้าสู่งานวิเคราะห์และคณะกรรมการ", status: "ALPHA SEARCH" },
};

export function InstitutionalWorkspaceTabs({ active, onChange, lang }: { active: InstitutionalSection; onChange: (id: string) => void; lang: AppLang }) {
  return (
    <nav className="workspace-tabs" aria-label="Primary workspace navigation" data-feature="persistent-workspace-navigation">
      {NAV.map((item) => (
        <button key={item.id} type="button" className={`workspace-tab ${active === item.id ? "active" : ""}`} onClick={() => onChange(item.id)} aria-current={active === item.id ? "page" : undefined}>
          <span className="workspace-tab-icon">{item.icon}</span>
          <span>{lang === "th" ? item.th : item.en}</span>
        </button>
      ))}
    </nav>
  );
}

export function InstitutionalSidebar({ active, onChange, lang }: { active: InstitutionalSection; onChange: (id: string) => void; lang: AppLang }) {
  return (
    <aside className="institutional-sidebar" aria-label="Sentinel Investment navigation">
      <div className="sidebar-brand-mini"><span className="sidebar-brand-glyph">S</span><div><strong>SENTINEL</strong><small>INVESTMENT OS V11</small></div></div>
      <div className="sidebar-cio-card sidebar-profile"><div className="cio-avatar">CIO</div><div><strong>Fund Owner</strong><small>Chief Investment Officer</small></div></div>
      <div className="sidebar-section-label">{lang === "th" ? "พื้นที่ทำงาน" : "WORKSPACES"}</div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button key={item.id} type="button" className={`sidebar-nav-item ${active === item.id ? "active" : ""}`} onClick={() => onChange(item.id)}>
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-copy"><strong>{lang === "th" ? item.th : item.en}</strong><small>{item.desk}</small></span>
            {active === item.id && <span className="sidebar-active-light" />}
          </button>
        ))}
      </nav>
      <div className="sidebar-section-label">{lang === "th" ? "ระบบควบคุม" : "CONTROL"}</div>
      <div className="sidebar-control-card"><div><span className="online-pulse" />{lang === "th" ? "ระบบออนไลน์" : "System online"}</div><strong>12 / 12</strong><small>{lang === "th" ? "ทีมงานพร้อมทำงาน" : "Fund desks operational"}</small></div>
    </aside>
  );
}

export function InstitutionalPageHeader({ section, lang }: { section: InstitutionalSection; lang: AppLang }) {
  const meta = PAGE_META[section];
  return (
    <section className="institutional-page-header">
      <div className="page-header-copy"><div className="page-eyebrow">{meta.eyebrow}</div><h1>{lang === "th" ? meta.titleTh : meta.title}</h1><p>{lang === "th" ? meta.descriptionTh : meta.description}</p></div>
      <div className="page-header-status"><span className="status-chip"><i />{meta.status}</span><div className="confidence-orb"><span>87</span><small>FUND SCORE</small></div></div>
    </section>
  );
}

export function ResearchWorkflow({ lang }: { lang: AppLang }) {
  const steps = lang === "th" ? ["ค้นหา", "คัดกรอง", "Watchlist", "วิเคราะห์", "ประชุม", "เข้าพอร์ต"] : ["Discover", "Screen", "Watchlist", "Analyze", "Committee", "Portfolio"];
  return <div className="opportunity-workflow" aria-label="Investment research workflow">{steps.map((step, index) => <div className="workflow-step" key={step}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step}</strong>{index < steps.length - 1 && <i>→</i>}</div>)}</div>;
}
