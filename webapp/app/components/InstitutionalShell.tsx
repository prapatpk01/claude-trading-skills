"use client";

import type { AppLang } from "../page";

export type InstitutionalSection = "command" | "analyze" | "portfolio" | "scanner";

const NAV = [
  { id: "command", icon: "◈", en: "CIO Command", th: "ศูนย์บัญชาการ CIO", desk: "Executive intelligence" },
  { id: "portfolio", icon: "◇", en: "Portfolio", th: "พอร์ตลงทุน", desk: "Construction & risk" },
  { id: "analyze", icon: "◉", en: "AI Research", th: "วิจัยด้วย AI", desk: "Underwriting desk" },
  { id: "scanner", icon: "⌁", en: "Opportunity Pipeline", th: "สายงานโอกาสลงทุน", desk: "Discovery to committee" },
] as const;

const PAGE_META: Record<InstitutionalSection, { eyebrow: string; title: string; titleTh: string; description: string; descriptionTh: string; status: string }> = {
  command: {
    eyebrow: "EXECUTIVE INTELLIGENCE",
    title: "CIO Command Center",
    titleTh: "ศูนย์บัญชาการ CIO",
    description: "Portfolio health, macro posture, risk budget, liquidity and the investment committee operating picture.",
    descriptionTh: "ภาพรวมสุขภาพพอร์ต สภาวะ Macro งบความเสี่ยง สภาพคล่อง และการทำงานของคณะกรรมการลงทุน",
    status: "LIVE BOOK",
  },
  portfolio: {
    eyebrow: "PORTFOLIO CONSTRUCTION",
    title: "Institutional Portfolio Terminal",
    titleTh: "ระบบบริหารพอร์ตระดับสถาบัน",
    description: "Holdings intelligence, liquidity sleeve, dividend engine, valuation review and capital-allocation decisions.",
    descriptionTh: "วิเคราะห์ Holdings, Liquidity Sleeve, เงินปันผล, Valuation และการตัดสินใจจัดสรรเงินทุน",
    status: "RISK CONTROLLED",
  },
  analyze: {
    eyebrow: "SECURITY UNDERWRITING",
    title: "AI Research Workbench",
    titleTh: "ศูนย์วิจัยหลักทรัพย์ด้วย AI",
    description: "Institutional research across industry structure, five-year financials, catalysts, scenarios, valuation and committee evidence.",
    descriptionTh: "วิจัยเชิงสถาบันทั้งอุตสาหกรรม งบการเงิน 5 ปี Catalyst, Scenario, Valuation และหลักฐานของคณะกรรมการ",
    status: "EVIDENCE FIRST",
  },
  scanner: {
    eyebrow: "OPPORTUNITY DISCOVERY",
    title: "Investment Opportunity Pipeline",
    titleTh: "สายงานค้นหาโอกาสลงทุน",
    description: "Discover momentum, dividend and thematic candidates, then promote qualified ideas into research, watchlist and committee review.",
    descriptionTh: "ค้นหา Momentum หุ้นปันผลและ Thematic แล้วส่ง Candidate ที่ผ่านเข้าสู่งานวิจัย Watchlist และการประชุมกองทุน",
    status: "ALPHA SEARCH",
  },
};

export function InstitutionalSidebar({ active, onChange, lang }: { active: InstitutionalSection; onChange: (id: string) => void; lang: AppLang }) {
  return (
    <aside className="institutional-sidebar" aria-label="Sentinel Investment navigation">
      <div className="sidebar-brand-mini">
        <span className="sidebar-brand-glyph">S</span>
        <div><strong>SENTINEL</strong><small>INVESTMENT</small></div>
      </div>
      <div className="sidebar-section-label">{lang === "th" ? "ระบบกองทุน" : "FUND OS"}</div>
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
      <div className="sidebar-control-card">
        <div><span className="online-pulse" />{lang === "th" ? "ระบบออนไลน์" : "System online"}</div>
        <strong>12 / 12</strong>
        <small>{lang === "th" ? "ทีม AI พร้อมทำงาน" : "AI desks operational"}</small>
      </div>
      <div className="sidebar-cio-card">
        <div className="cio-avatar">JH</div>
        <div><strong>James Hartwell</strong><small>CIO · Human approval</small></div>
      </div>
    </aside>
  );
}

export function InstitutionalPageHeader({ section, lang }: { section: InstitutionalSection; lang: AppLang }) {
  const meta = PAGE_META[section];
  return (
    <section className="institutional-page-header">
      <div className="page-header-copy">
        <div className="page-eyebrow">{meta.eyebrow}</div>
        <h1>{lang === "th" ? meta.titleTh : meta.title}</h1>
        <p>{lang === "th" ? meta.descriptionTh : meta.description}</p>
      </div>
      <div className="page-header-status">
        <span className="status-chip"><i />{meta.status}</span>
        <div className="confidence-orb"><span>87</span><small>AI CONF.</small></div>
      </div>
    </section>
  );
}

export function OpportunityWorkflow({ lang }: { lang: AppLang }) {
  const steps = lang === "th"
    ? ["ค้นหา", "วิจัย", "Watchlist", "ประชุม", "อนุมัติ", "เข้าพอร์ต"]
    : ["Discover", "Research", "Watchlist", "Committee", "Approved", "Portfolio"];
  return (
    <div className="opportunity-workflow" aria-label="Investment opportunity workflow">
      {steps.map((step, index) => (
        <div className="workflow-step" key={step}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{step}</strong>
          {index < steps.length - 1 && <i>→</i>}
        </div>
      ))}
    </div>
  );
}
