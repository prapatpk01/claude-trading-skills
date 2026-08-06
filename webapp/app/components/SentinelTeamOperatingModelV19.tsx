"use client";

import type { AppLang } from "../page";

type Group = "Investment Team" | "Asset Management Team" | "Executive Management";
type Seat = { id: string; name: string; role: string; group: Group; owns: string; output: string; authority: boolean };

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);

const SEATS: Seat[] = [
  { id: "01", name: "Sofia Reyes", role: "Head of Investment Research", group: "Investment Team", owns: "Research mandate, thesis quality and security selection", output: "Signed BUY / WATCH / REJECT investment proposal", authority: true },
  { id: "02", name: "Daniel Cho", role: "Macro & Market Strategist", group: "Investment Team", owns: "Regime, liquidity and sector rotation", output: "Risk envelope and market scenario", authority: false },
  { id: "03", name: "Marcus Webb", role: "Financial Modeling Analyst", group: "Investment Team", owns: "Revenue, margins, FCF and scenario forecasts", output: "Auditable base / bull / bear model", authority: false },
  { id: "04", name: "Thomas Eriksson", role: "Head of Valuation", group: "Investment Team", owns: "DCF, multiples and margin of safety", output: "Fair-value, entry and trim ranges", authority: false },
  { id: "05", name: "Aisha Fontaine", role: "Catalyst & Event Analyst", group: "Investment Team", owns: "Dated catalysts and invalidation", output: "Catalyst map with probability and timing", authority: false },
  { id: "06", name: "Maya Chen", role: "Momentum & Market Structure Analyst", group: "Investment Team", owns: "Automatic scan, relative strength and entry structure", output: "New candidates, entry, stop and chase risk", authority: false },
  { id: "07", name: "Priya Nair", role: "Quantitative Strategist", group: "Investment Team", owns: "Expected return, factors and robustness", output: "Quant validation and confidence range", authority: false },
  { id: "08", name: "Leo Tanaka", role: "Live Market Intelligence Analyst", group: "Investment Team", owns: "Live price, news and volatility changes", output: "Decision-change and execution-window alerts", authority: false },
  { id: "09", name: "Lena Müller", role: "Head of Asset Management", group: "Asset Management Team", owns: "Portfolio construction, sizing, funding and sequencing", output: "Signed before / after portfolio plan", authority: true },
  { id: "10", name: "Kai Tanaka", role: "Portfolio Risk & Construction Analyst", group: "Asset Management Team", owns: "Position caps, concentration, correlation and stress", output: "Risk-adjusted size and portfolio impact", authority: false },
  { id: "11", name: "Ryan Blackwood", role: "Execution & Trading Operations", group: "Asset Management Team", owns: "Liquidity, order staging and slippage", output: "Executable trade blotter and fill review", authority: false },
  { id: "12", name: "Nina Okonkwo", role: "Portfolio Data & Control Lead", group: "Asset Management Team", owns: "Ledger, cash, holdings and cost-basis reconciliation", output: "Verified portfolio dataset and exception report", authority: false },
  { id: "13", name: "Miriam Osei", role: "CRO / Executive Risk", group: "Executive Management", owns: "Independent risk and governance gate", output: "PASS / CONDITIONAL / VETO", authority: true },
  { id: "14", name: "James Hartwell", role: "CIO / Executive Chair", group: "Executive Management", owns: "Final portfolio-level decision", output: "APPROVE / DEFER / REJECT resolution", authority: true },
];

const GROUPS: { name: Group; mission: string }[] = [
  { name: "Investment Team", mission: "Analyze the market, source new investments and present a signed investment case." },
  { name: "Asset Management Team", mission: "Review holdings and cash, then present a fully funded rebalance plan." },
  { name: "Executive Management", mission: "Apply the independent risk gate and issue the final resolution." },
];

export default function SentinelTeamOperatingModelV19({ lang }: { lang: AppLang }) {
  return <section className="card" data-team-operating-model="20.0" style={{ borderTop: "3px solid var(--accent)" }}>
    <span className="tag">SENTINEL FUND TEAM · OPERATING MODEL V20</span>
    <h2 className="section" style={{ margin: "10px 0 6px" }}>{tr(lang, "Two accountable teams, one executive decision chain", "สองทีมรับผิดชอบ หนึ่งลำดับการตัดสินใจของฝ่ายบริหาร")}</h2>
    <p className="muted" style={{ marginTop: 0 }}>{tr(lang, "Specialists present evidence. Only the two team heads, CRO and CIO can sign a decision; execution still requires human approval.", "ผู้เชี่ยวชาญนำเสนอหลักฐาน มีเพียงหัวหน้าสองทีม CRO และ CIO ที่ลงนามตัดสินใจได้ และยังต้องผ่าน Human Approval ก่อนดำเนินการ")}</p>

    <div className="grid cols-4" style={{ marginTop: 16 }}>
      <div className="metric"><span>Total people</span><strong>14</strong></div>
      <div className="metric"><span>Operating teams</span><strong>2</strong></div>
      <div className="metric"><span>Decision authorities</span><strong>4</strong></div>
      <div className="metric"><span>Execution mode</span><strong>HUMAN APPROVAL</strong></div>
    </div>

    <div style={{ display: "grid", gap: 16, marginTop: 18 }}>
      {GROUPS.map((group) => <article className="metric" key={group.name} style={{ padding: 18 }}>
        <span className="tag">{group.name.toUpperCase()} · {SEATS.filter((seat) => seat.group === group.name).length}</span>
        <p style={{ lineHeight: 1.55 }}>{group.mission}</p>
        <div className="grid cols-2">{SEATS.filter((seat) => seat.group === group.name).map((seat) => <div className="notice" key={seat.id}>
          <strong>{seat.name} · {seat.role}</strong>{seat.authority ? <span className="tag" style={{ marginLeft: 8 }}>DECISION AUTHORITY</span> : null}
          <br /><small>Owns: {seat.owns}</small><br /><small>Output: {seat.output}</small>
        </div>)}</div>
      </article>)}
    </div>

    <div className="notice" style={{ marginTop: 18 }}><strong>Decision chain:</strong> Investment Team → Sofia sign-off → Asset Management Team → Lena sign-off → Miriam CRO gate → James CIO resolution → Human approval → Execution → Ledger reconciliation.</div>
  </section>;
}
