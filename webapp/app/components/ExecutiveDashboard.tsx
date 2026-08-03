"use client";

import type { AppLang } from "../page";
import { useFundSnapshot } from "./useFundSnapshot";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const pct = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export default function ExecutiveDashboard({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const fund = useFundSnapshot();
  if (fund.loading) return <section className="card dashboard-loading">Loading verified fund snapshot…</section>;
  if (fund.error) return <section className="card dashboard-loading">{fund.error}</section>;

  const allocation = [...fund.holdings].sort((a, b) => b.marketValue - a.marketValue).slice(0, 6);

  return <div className="executive-dashboard" data-source="fund-snapshot">
    <section className="dashboard-kpis">
      <Kpi label="Total Portfolio Value" value={money(fund.totalNav)} note={`${fund.openPositions} open holdings · ${fund.verified ? "VERIFIED" : "PARTIAL"}`} tone="blue" />
      <Kpi label="Unrealized P/L" value={money(fund.unrealizedPnl)} note={pct(fund.unrealizedPnlPct)} tone={fund.unrealizedPnl >= 0 ? "green" : "red"} />
      <Kpi label="Cash & Equivalents" value={money(fund.cashAndEquivalents)} note={`${fund.cashBufferPct.toFixed(1)}% of NAV · reserve sleeve`} tone="gold" />
      <Kpi label="Deployable Cash" value={money(fund.deployableCash)} note={`Excess above ${fund.targetCashPct.toFixed(0)}% target`} tone="cyan" />
      <Kpi label="Macro Score" value={`${fund.macroScore.toFixed(0)}/100`} note={`${fund.macroLabel} · ${fund.macroConfidence} confidence`} tone="purple" />
    </section>

    <section className="dashboard-grid-primary">
      <div className="dashboard-panel"><PanelTitle title="Portfolio Health" subtitle="Single-source institutional composite" /><div className="gauge-row"><Gauge label="Health" value={fund.portfolioHealth}/><Gauge label="Quality" value={fund.qualityScore}/><Gauge label="Liquidity" value={fund.liquidityScore}/><Gauge label="Risk Control" value={fund.riskScore}/></div></div>
      <div className="dashboard-panel"><PanelTitle title="Top Holdings" subtitle="Largest verified positions" /><div className="mini-table">{allocation.map((row)=><div className="mini-table-row" key={row.ticker}><strong>{row.ticker}</strong><span>{money(row.marketValue)} · {row.weightPct.toFixed(1)}%</span></div>)}</div></div>
      <div className="dashboard-panel"><PanelTitle title="Fund Operating Status" subtitle="One portfolio ledger for every workspace" /><div className="status-stack"><StatusRow label="Portfolio Snapshot" value={fund.verified?"VERIFIED":"PARTIAL"}/><StatusRow label="CIO Committee" value="READY"/><StatusRow label="Stock Analysis" value="ACTIVE"/><StatusRow label="Research Pipeline" value="MONITORING"/></div></div>
    </section>

    <section className="workspace-launch-grid">
      <WorkspaceCard index="1" title="CIO Command Center" description="Market regime, portfolio health, debate, voting and governed resolutions." action="Enter Command Center" tone="blue" onClick={()=>onNavigate("command")}/>
      <WorkspaceCard index="2" title="Portfolio Management" description="Holdings, reconciliation, Buy/Sell records, cash, dividends and ledger." action="Manage Portfolio" tone="purple" onClick={()=>onNavigate("portfolio")}/>
      <WorkspaceCard index="3" title="Stock Analysis" description="Valuation, quality, growth, thesis, catalysts, risks and monitoring." action="Analyze a Stock" tone="orange" onClick={()=>onNavigate("analyze")}/>
      <WorkspaceCard index="4" title="Research Lab" description="Scan, rank, watchlist and promote qualified investment ideas." action="Open Research Lab" tone="green" onClick={()=>onNavigate("research")}/>
    </section>

    <section className="dashboard-grid-secondary">
      <div className="dashboard-panel"><PanelTitle title="Recent Activity" subtitle="Latest ledger events" /><div className="activity-list">{fund.ledger.slice(0,5).map((row:any,index:number)=><div className="activity-row" key={`${row?.ticker??"activity"}-${index}`}><span className={`activity-badge ${String(row?.side??row?.action??"").toLowerCase()}`}>{String(row?.side??row?.action??"EVENT")}</span><strong>{String(row?.ticker??"PORTFOLIO")}</strong><span>{row?.date??row?.trade_date??"—"}</span></div>)}{!fund.ledger.length&&<div className="empty-state">No ledger activity recorded</div>}</div></div>
      <div className="dashboard-panel executive-brief"><PanelTitle title="CIO Executive Brief" subtitle="What requires attention now" /><p>{lang==="th"?`พอร์ตมี ${fund.openPositions} สถานะ มูลค่ารวม ${money(fund.totalNav)} เงินสดและสินทรัพย์เทียบเท่าเงินสด ${money(fund.cashAndEquivalents)} และเงินพร้อมลงทุน ${money(fund.deployableCash)}`:`The fund holds ${fund.openPositions} positions with ${money(fund.totalNav)} NAV, ${money(fund.cashAndEquivalents)} in cash equivalents and ${money(fund.deployableCash)} deployable above policy.`}</p><button className="btn" type="button" onClick={()=>onNavigate("command")}>Open Investment Committee</button></div>
    </section>
  </div>;
}

function Kpi({label,value,note,tone}:{label:string;value:string;note:string;tone:string}){return <div className={`dashboard-kpi tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>}
function PanelTitle({title,subtitle}:{title:string;subtitle:string}){return <div className="panel-title"><div><strong>{title}</strong><small>{subtitle}</small></div><span>●</span></div>}
function Gauge({label,value}:{label:string;value:number}){const safe=Math.max(0,Math.min(100,value));return <div className="pro-gauge"><div className="gauge-ring" style={{background:`conic-gradient(#39d6ff 0 ${safe}%,rgba(255,255,255,.06) ${safe}% 100%)`}}><div><strong>{safe}</strong><small>/100</small></div></div><span>{label}</span></div>}
function StatusRow({label,value}:{label:string;value:string}){return <div className="status-row"><span><i/>{label}</span><strong>{value}</strong></div>}
function WorkspaceCard({index,title,description,action,tone,onClick}:{index:string;title:string;description:string;action:string;tone:string;onClick:()=>void}){return <button type="button" className={`workspace-launch tone-${tone}`} onClick={onClick}><div className="workspace-launch-head"><span>{index}</span><strong>{title}</strong></div><p>{description}</p><small>{action} →</small></button>}
