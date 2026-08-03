"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";

type PortfolioPayload = { holdings?: any[]; ledger?: any[] };
type DashboardData = { portfolio: PortfolioPayload; allocation: any; macro: any };

function finite(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function ExecutiveDashboard({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      fetch("/api/portfolio", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/portfolio/opportunity-allocation", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/macro/intelligence", { cache: "no-store" }).then((r) => r.json()),
    ]).then((results) => {
      if (!active) return;
      const value = (index: number) => results[index]?.status === "fulfilled" ? (results[index] as PromiseFulfilledResult<any>).value : {};
      setData({ portfolio: value(0), allocation: value(1), macro: value(2) });
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const view = useMemo(() => {
    const holdings = (Array.isArray(data?.portfolio?.holdings) ? data?.portfolio?.holdings : []).filter((row: any) => !row?.closed_at);
    const ledger = Array.isArray(data?.portfolio?.ledger) ? data?.portfolio?.ledger : [];
    const marketValue = holdings.reduce((sum: number, row: any) => sum + Math.max(0, finite(row?.shares)) * Math.max(0, finite(row?.price ?? row?.current_price ?? row?.avg_cost)), 0);
    const costValue = holdings.reduce((sum: number, row: any) => sum + Math.max(0, finite(row?.shares)) * Math.max(0, finite(row?.avg_cost)), 0);
    const pnl = marketValue - costValue;
    const pnlPct = costValue > 0 ? pnl / costValue * 100 : 0;
    const reserve = finite(data?.allocation?.portfolio?.deployableCapitalUsd ?? data?.allocation?.deployableCapitalUsd);
    const macroScore = finite(data?.macro?.regime?.score) || 50;
    const health = Math.max(0, Math.min(100, Math.round(68 + Math.min(12, holdings.length / 2) + (macroScore - 50) * .18)));
    const quality = Math.max(0, Math.min(100, Math.round(70 + (macroScore - 50) * .15)));
    const liquidity = Math.max(0, Math.min(100, Math.round(80 + Math.min(15, reserve / 100))));
    const risk = Math.max(0, Math.min(100, Math.round(100 - (100 - macroScore) * .55)));
    const allocation = holdings.slice(0, 6).map((row: any) => ({
      ticker: String(row?.ticker ?? "—").toUpperCase(),
      value: Math.max(0, finite(row?.shares)) * Math.max(0, finite(row?.price ?? row?.current_price ?? row?.avg_cost)),
    })).sort((a, b) => b.value - a.value);
    return { holdings, ledger, marketValue, pnl, pnlPct, reserve, macroScore, health, quality, liquidity, risk, allocation };
  }, [data]);

  if (loading) return <section className="card dashboard-loading">Loading Sentinel fund intelligence…</section>;

  return (
    <div className="executive-dashboard">
      <section className="dashboard-kpis">
        <Kpi label="Total Portfolio Value" value={money(view.marketValue)} note={`${view.holdings.length} open holdings`} tone="blue" />
        <Kpi label="Unrealized P/L" value={money(view.pnl)} note={pct(view.pnlPct)} tone={view.pnl >= 0 ? "green" : "red"} />
        <Kpi label="Cash & Equivalents" value={money(view.reserve)} note="SGOV / reserve sleeve" tone="gold" />
        <Kpi label="Deployable Cash" value={money(view.reserve)} note="Available after policy checks" tone="cyan" />
        <Kpi label="Macro Score" value={`${view.macroScore.toFixed(0)}/100`} note="Market regime composite" tone="purple" />
      </section>

      <section className="dashboard-grid-primary">
        <div className="dashboard-panel">
          <PanelTitle title="Portfolio Health" subtitle="Institutional operating composite" />
          <div className="gauge-row">
            <Gauge label="Health" value={view.health} />
            <Gauge label="Quality" value={view.quality} />
            <Gauge label="Liquidity" value={view.liquidity} />
            <Gauge label="Risk Control" value={view.risk} />
          </div>
        </div>
        <div className="dashboard-panel">
          <PanelTitle title="Top Holdings" subtitle="Largest live positions" />
          <div className="mini-table">
            {view.allocation.length ? view.allocation.map((row) => (
              <div className="mini-table-row" key={row.ticker}>
                <strong>{row.ticker}</strong><span>{money(row.value)}</span>
              </div>
            )) : <div className="empty-state">No holdings available</div>}
          </div>
        </div>
        <div className="dashboard-panel">
          <PanelTitle title="Fund Operating Status" subtitle="Clear ownership by workspace" />
          <div className="status-stack">
            <StatusRow label="CIO Committee" value="READY" />
            <StatusRow label="Portfolio Ledger" value="CONNECTED" />
            <StatusRow label="Stock Analysis" value="ACTIVE" />
            <StatusRow label="Research Pipeline" value="MONITORING" />
          </div>
        </div>
      </section>

      <section className="workspace-launch-grid">
        <WorkspaceCard index="1" title="CIO Command Center" description="Market regime, portfolio health, professional debate, voting and governed resolutions." action="Enter Command Center" tone="blue" onClick={() => onNavigate("command")} />
        <WorkspaceCard index="2" title="Portfolio Management" description="Holdings, Buy/Sell records, cash, dividends, ledger, risk and performance." action="Manage Portfolio" tone="purple" onClick={() => onNavigate("portfolio")} />
        <WorkspaceCard index="3" title="Stock Analysis" description="Valuation, quality, growth, thesis, catalysts, risks and monitoring." action="Analyze a Stock" tone="orange" onClick={() => onNavigate("analyze")} />
        <WorkspaceCard index="4" title="Research Lab" description="Scan, rank, watchlist and promote qualified investment ideas." action="Open Research Lab" tone="green" onClick={() => onNavigate("research")} />
      </section>

      <section className="dashboard-grid-secondary">
        <div className="dashboard-panel">
          <PanelTitle title="Recent Activity" subtitle="Latest ledger events" />
          <div className="activity-list">
            {view.ledger.slice(0, 5).map((row: any, index: number) => (
              <div className="activity-row" key={`${row?.ticker ?? "activity"}-${index}`}>
                <span className={`activity-badge ${String(row?.side ?? row?.action ?? "").toLowerCase()}`}>{String(row?.side ?? row?.action ?? "EVENT")}</span>
                <strong>{String(row?.ticker ?? "PORTFOLIO")}</strong>
                <span>{row?.date ?? row?.trade_date ?? "—"}</span>
              </div>
            ))}
            {!view.ledger.length && <div className="empty-state">No ledger activity recorded</div>}
          </div>
        </div>
        <div className="dashboard-panel executive-brief">
          <PanelTitle title="CIO Executive Brief" subtitle="What requires attention now" />
          <p>{lang === "th"
            ? `พอร์ตมี ${view.holdings.length} สถานะ มูลค่ารวม ${money(view.marketValue)} สภาพคล่องพร้อมใช้ ${money(view.reserve)} และ Macro Score ${view.macroScore.toFixed(0)}/100`
            : `The fund holds ${view.holdings.length} live positions with ${money(view.marketValue)} in market value, ${money(view.reserve)} deployable liquidity and a ${view.macroScore.toFixed(0)}/100 macro score.`}</p>
          <button className="btn" type="button" onClick={() => onNavigate("command")}>Open Investment Committee</button>
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }) {
  return <div className={`dashboard-kpi tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="panel-title"><div><strong>{title}</strong><small>{subtitle}</small></div><span>●</span></div>;
}

function Gauge({ label, value }: { label: string; value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div className="pro-gauge"><div className="gauge-ring" style={{ background: `conic-gradient(#39d6ff 0 ${safe}%, rgba(255,255,255,.06) ${safe}% 100%)` }}><div><strong>{safe}</strong><small>/100</small></div></div><span>{label}</span></div>;
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return <div className="status-row"><span><i />{label}</span><strong>{value}</strong></div>;
}

function WorkspaceCard({ index, title, description, action, tone, onClick }: { index: string; title: string; description: string; action: string; tone: string; onClick: () => void }) {
  return <button type="button" className={`workspace-launch tone-${tone}`} onClick={onClick}><div className="workspace-launch-head"><span>{index}</span><strong>{title}</strong></div><p>{description}</p><small>{action} →</small></button>;
}
