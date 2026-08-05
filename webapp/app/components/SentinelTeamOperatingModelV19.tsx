"use client";

import type { AppLang } from "../page";

type Seat = {
  id: string;
  name: string;
  role: string;
  desk: string;
  mandate: string;
  primaryWork: string[];
  inputs: string[];
  outputs: string[];
  authority: string;
  kpis: string[];
  handoff: string;
};

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);

const SEATS: Seat[] = [
  { id:"01", name:"James Hartwell", role:"Chief Investment Officer / Chair", desk:"Executive Committee", mandate:"Own the investment mandate, chair debate, resolve conflicts and approve the final capital plan.", primaryWork:["Set return objective and risk budget","Approve portfolio-level trade-offs","Issue final ADD / HOLD / TRIM / EXIT resolution"], inputs:["Macro regime","Research pipeline","Valuation ranges","Portfolio risk","Execution constraints"], outputs:["Signed committee resolution","Priority list","Capital-allocation decision","Review date"], authority:"Final investment decision, subject to CRO veto and human approval.", kpis:["Excess return vs mandate","Decision hit rate","Capital efficiency","Drawdown discipline"], handoff:"CIO → CRO governance gate → Human approval → Execution" },
  { id:"02", name:"Miriam Osei", role:"Chief Risk Officer", desk:"Risk & Governance", mandate:"Protect capital and stop weak, incomplete or oversized decisions from reaching execution.", primaryWork:["Challenge assumptions and downside cases","Check concentration, liquidity and correlation","Enforce data quality and governance"], inputs:["Portfolio plan","Stress tests","Position sizing","Evidence confidence"], outputs:["PASS / CONDITIONAL / VETO","Risk limits","Kill criteria","Monitoring conditions"], authority:"Independent veto over any proposal that violates risk policy.", kpis:["Max drawdown containment","Risk-limit breaches","Loss severity","Governance completeness"], handoff:"CRO → CIO for amendment or → Human approval when passed" },
  { id:"03", name:"Daniel Cho", role:"Head of Macro Strategy", desk:"Macro & Regime", mandate:"Define the investable environment and the amount of risk the fund should carry now.", primaryWork:["Regime classification","Rates, inflation, growth and liquidity analysis","VIX, sentiment and sector-rotation view"], inputs:["Macro data","Yield curve","VIX and breadth","Policy data","Cross-asset signals"], outputs:["Risk-on / Neutral / Risk-off score","Sector preference","Cash / SGOV band","3–6 month scenario map"], authority:"Sets macro risk envelope; cannot choose individual stocks alone.", kpis:["Regime accuracy","Timeliness","Sector-call hit rate","Scenario calibration"], handoff:"Macro → Research, Portfolio and Risk" },
  { id:"04", name:"Sofia Reyes", role:"Lead Fundamental Analyst", desk:"Fundamental Research", mandate:"Determine whether the business quality and earnings engine justify ownership.", primaryWork:["Business model and moat","Revenue, margin and cash-flow durability","Management and balance-sheet assessment"], inputs:["Filings","Earnings calls","Industry data","Competitor evidence"], outputs:["Bull / base / bear thesis","Quality score","Key risks","Monitoring checklist"], authority:"Can reject weak business quality before valuation work begins.", kpis:["Earnings-thesis accuracy","Estimate revisions","Thesis-break detection","Research freshness"], handoff:"Fundamental → Financial Modeling → Valuation" },
  { id:"05", name:"Marcus Webb", role:"Senior Financial Analyst", desk:"Financial Modeling", mandate:"Translate the business thesis into auditable forecasts and scenario financials.", primaryWork:["Revenue and margin model","FCF and balance-sheet model","Scenario sensitivity"], inputs:["Fundamental thesis","Historical statements","Guidance","Consensus"], outputs:["Base / bull / bear forecasts","Normalized earnings","FCF bridge","Model confidence"], authority:"Owns forecast integrity; flags unsupported assumptions.", kpis:["Forecast error","Model update speed","Scenario coverage","Accounting-quality alerts"], handoff:"Financial Model → Valuation and Quant" },
  { id:"06", name:"Thomas Eriksson", role:"Head of Valuation", desk:"Valuation", mandate:"Produce a defensible fair-value range and margin-of-safety assessment.", primaryWork:["DCF","Relative multiples","Scenario-weighted valuation","Terminal-risk review"], inputs:["Financial model","Cost of capital","Peer set","Catalyst timing"], outputs:["Fair-value range","Upside / downside","Valuation status","Entry and trim bands"], authority:"No security may be labeled ADD without a valuation range and confidence grade.", kpis:["Target-price calibration","Range accuracy","Valuation dispersion","Margin-of-safety discipline"], handoff:"Valuation → Analysis Committee → Portfolio" },
  { id:"07", name:"Aisha Fontaine", role:"Catalyst & Event Analyst", desk:"Catalyst Intelligence", mandate:"Identify what can unlock value, when it may happen and what can invalidate the thesis.", primaryWork:["Earnings and product catalysts","Regulatory and corporate events","Event probability and timing"], inputs:["News","Company calendar","Industry events","Research thesis"], outputs:["Catalyst map","Probability","Expected timing","Invalidation trigger"], authority:"Can delay entry when catalyst quality is weak or timing is poor.", kpis:["Catalyst hit rate","Timing error","False-positive rate","Event reaction accuracy"], handoff:"Catalyst → Momentum / Quant → Portfolio" },
  { id:"08", name:"Maya Chen", role:"Momentum & Market Structure Analyst", desk:"Momentum", mandate:"Confirm that price, relative strength and institutional participation support the thesis.", primaryWork:["Relative strength","Trend and breadth","Volume accumulation","Entry structure"], inputs:["Price and volume","Sector benchmark","Market breadth","Catalyst map"], outputs:["Momentum score","Entry zone","Chase risk","Trend failure signal"], authority:"Can block poor timing but cannot override a strong fundamental rejection.", kpis:["Entry efficiency","Breakout follow-through","False-signal rate","Relative-strength persistence"], handoff:"Momentum → Quant validation → Portfolio sizing" },
  { id:"09", name:"Priya Nair", role:"Quantitative Strategist", desk:"Quant Research", mandate:"Test whether the proposed edge survives data, history and alternative explanations.", primaryWork:["Factor decomposition","Backtest and robustness","Scenario probability","Expected-return ranking"], inputs:["Fundamental scores","Valuation","Momentum","Macro regime"], outputs:["Expected return","Confidence interval","Factor exposures","Robustness grade"], authority:"Can downgrade conviction when evidence is unstable or overfit.", kpis:["Out-of-sample accuracy","Calibration","Model decay detection","False-confidence rate"], handoff:"Quant → Risk → Portfolio" },
  { id:"10", name:"Kai Tanaka", role:"Portfolio Risk Analyst", desk:"Portfolio Risk", mandate:"Convert security ideas into portfolio-safe sizes and expose hidden interactions.", primaryWork:["Position and concentration risk","Correlation and factor crowding","Stress and drawdown analysis"], inputs:["Proposed trades","Current holdings","Volatility","Liquidity","Macro risk"], outputs:["Max position size","Portfolio impact","Stress loss","Risk-adjusted rank"], authority:"Sets maximum size and may require staged entry.", kpis:["Risk forecast accuracy","Concentration control","Stress-loss accuracy","Correlation surprise"], handoff:"Portfolio Risk → Portfolio Manager → CRO" },
  { id:"11", name:"Lena Müller", role:"Portfolio Manager", desk:"Portfolio Construction", mandate:"Build the highest-quality portfolio from approved ideas within capital and risk constraints.", primaryWork:["Rebalance design","Funding source selection","Add / trim / exit sizing","Cash and SGOV routing"], inputs:["Approved analyses","Risk limits","Macro envelope","Available cash"], outputs:["Trade plan","Before / after weights","Funding map","Expected portfolio effect"], authority:"Chooses sizing and sequencing inside CIO/CRO limits.", kpis:["Portfolio alpha","Turnover efficiency","Sizing accuracy","Capital recycling effectiveness"], handoff:"Portfolio Plan → CIO resolution → CRO gate" },
  { id:"12", name:"Ryan Blackwood", role:"Head of Execution", desk:"Execution", mandate:"Translate approved decisions into low-slippage, auditable transactions.", primaryWork:["Order strategy","Liquidity and spread review","Staging and limit prices","Post-trade review"], inputs:["Approved blotter","Price and volume","Liquidity constraints","Deadline"], outputs:["Executable order plan","Expected slippage","Fill report","Execution exception"], authority:"May delay or stage orders for market-quality reasons; cannot change investment intent.", kpis:["Implementation shortfall","Fill quality","Slippage","Operational errors"], handoff:"Execution → Ledger → Performance attribution" },
  { id:"13", name:"Nina Okonkwo", role:"Data & Source Engineering Lead", desk:"Data Governance", mandate:"Ensure every committee number has a reliable source, timestamp and lineage.", primaryWork:["Source validation","Data normalization","Staleness detection","Ledger consistency"], inputs:["Market feeds","Filings","Supabase ledger","External APIs"], outputs:["Verified dataset","Data-quality status","Lineage record","Exception report"], authority:"Can withhold any metric that is stale, inconsistent or unverifiable.", kpis:["Data completeness","Freshness","Reconciliation error","Pipeline uptime"], handoff:"Data → All desks; exception → CRO" },
  { id:"14", name:"Leo Tanaka", role:"Real-Time Market Intelligence Analyst", desk:"Live Intelligence", mandate:"Monitor live changes that may alter the committee decision before execution.", primaryWork:["Price, volume and volatility alerts","News and event monitoring","Pre/post-market change detection"], inputs:["Live market feed","News stream","Approved thesis and kill criteria"], outputs:["Live risk alert","Catalyst confirmation","Decision-change trigger","Execution window"], authority:"Can trigger emergency re-review before an order is sent.", kpis:["Alert precision","Detection speed","Missed-event rate","Noise control"], handoff:"Live Intelligence → CIO / CRO / Execution" },
];

export default function SentinelTeamOperatingModelV19({ lang }: { lang: AppLang }) {
  return (
    <section className="card" data-team-operating-model="19.0" style={{ borderTop: "3px solid var(--accent)" }}>
      <span className="tag">SENTINEL FUND TEAM · OPERATING MODEL V19</span>
      <h2 className="section" style={{ margin: "10px 0 6px" }}>{tr(lang, "Elite Fund Team — Clear Ownership by Seat", "ทีมกองทุนระดับสูง — กำหนดเจ้าของงานรายบุคคล")}</h2>
      <p className="muted" style={{ marginTop: 0 }}>{tr(lang, "Each person owns a distinct decision, receives defined evidence, produces a required deliverable and hands work to the next control point.", "แต่ละคนมีอำนาจตัดสินใจ ข้อมูลนำเข้า ผลงานส่งมอบ KPI และจุดส่งต่องานที่ชัดเจน")}</p>

      <div className="grid cols-4" style={{ marginTop: 16 }}>
        <div className="metric"><span>Investment seats</span><strong>14</strong></div>
        <div className="metric"><span>Independent risk gates</span><strong>2</strong><small>Portfolio Risk + CRO</small></div>
        <div className="metric"><span>Final decision owner</span><strong>CIO</strong></div>
        <div className="metric"><span>Execution mode</span><strong>HUMAN APPROVAL</strong></div>
      </div>

      <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
        {SEATS.map((seat) => (
          <article key={seat.id} className="metric" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <span className="tag">SEAT {seat.id} · {seat.desk}</span>
                <h3 style={{ margin: "10px 0 2px" }}>{seat.name}</h3>
                <strong>{seat.role}</strong>
              </div>
              <span className="tag">ACCOUNTABLE OWNER</span>
            </div>
            <p style={{ lineHeight: 1.55 }}><strong>Mandate:</strong> {seat.mandate}</p>
            <div className="grid cols-3" style={{ marginTop: 12 }}>
              <div><span className="muted">Primary work</span><ul>{seat.primaryWork.map(x => <li key={x}>{x}</li>)}</ul></div>
              <div><span className="muted">Required inputs</span><ul>{seat.inputs.map(x => <li key={x}>{x}</li>)}</ul></div>
              <div><span className="muted">Required outputs</span><ul>{seat.outputs.map(x => <li key={x}>{x}</li>)}</ul></div>
            </div>
            <div className="grid cols-3" style={{ marginTop: 12 }}>
              <div className="notice"><strong>Authority</strong><br />{seat.authority}</div>
              <div className="notice"><strong>KPI</strong><br />{seat.kpis.join(" · ")}</div>
              <div className="notice"><strong>Handoff</strong><br />{seat.handoff}</div>
            </div>
          </article>
        ))}
      </div>

      <div className="notice" style={{ marginTop: 18 }}>
        <strong>Decision chain:</strong> Data verification → Macro regime → Fundamental research → Financial model → Valuation → Catalyst / Momentum → Quant validation → Portfolio risk → Portfolio construction → CIO resolution → CRO gate → Human approval → Execution → Ledger and performance review.
      </div>
    </section>
  );
}
