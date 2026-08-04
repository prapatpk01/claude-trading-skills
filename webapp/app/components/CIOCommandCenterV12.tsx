"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";
import { useFundSnapshot, type FundHolding } from "./useFundSnapshot";

type TeamId = "macro" | "portfolio" | "research" | "analyze";
type Tab = "meeting" | TeamId | "resolution";
type AnyRow = Record<string, any>;

type Candidate = {
  ticker: string;
  rating: string;
  conviction: number;
  upside: number | null;
  target: number | null;
  price: number | null;
  valuation: string;
  thesis: string;
  catalyst: string;
  vision: string;
  source: string;
};

type HoldingDecision = {
  ticker: string;
  weight: number;
  marketValue: number;
  pnlPct: number | null;
  valuation: string;
  risk: string;
  action: "ADD" | "HOLD" | "TRIM" | "EXIT" | "REVIEW";
  reason: string;
};

type Allocation = {
  ticker: string;
  amount: number;
  weight: number;
  reason: string;
};

const TEAM_META: Array<{ id: TeamId; no: string; en: string; th: string; missionEn: string; missionTh: string }> = [
  { id: "macro", no: "01", en: "Macro & Sentiment", th: "ทีมมหภาคและอารมณ์ตลาด", missionEn: "Regime, momentum, sector rotation, rates, VIX, fear & greed and economic conditions.", missionTh: "วิเคราะห์ Regime, Momentum, Sector Rotation, ดอกเบี้ย, VIX, Fear & Greed และเศรษฐกิจ" },
  { id: "portfolio", no: "02", en: "Portfolio & Holdings", th: "ทีมพอร์ตและหุ้นที่ถือ", missionEn: "Portfolio health, concentration, risk, valuation and holding-level actions.", missionTh: "วิเคราะห์สุขภาพพอร์ต ความกระจุกตัว ความเสี่ยง มูลค่า และการจัดการหุ้นเดิม" },
  { id: "research", no: "03", en: "Research & Future Themes", th: "ทีมวิจัยและแนวโน้มอนาคต", missionEn: "Find new investments using vision, thesis, catalyst and future-return potential.", missionTh: "ค้นหาการลงทุนใหม่จาก Vision, Thesis, Catalyst และโอกาสสร้างผลตอบแทน" },
  { id: "analyze", no: "04", en: "Fundamental & Valuation", th: "ทีมวิเคราะห์พื้นฐานและมูลค่า", missionEn: "Analyze holdings and research candidates for fundamentals, fair value and risk/reward.", missionTh: "รับงานจาก Holdings และ Research เพื่อวิเคราะห์พื้นฐาน Fair Value และ Risk/Reward" },
];

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0);
const pct = (value: number | null, digits = 1) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: unknown, fallback = "Evidence not yet available") => {
  const result = String(value ?? "").trim();
  return result || fallback;
};
const tr = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;

async function getJson(path: string) {
  const response = await fetch(path, { cache: "no-store", headers: { Accept: "application/json" } });
  const raw = await response.text();
  const json = raw ? JSON.parse(raw) : {};
  if (!response.ok) throw new Error(json?.error ?? `${path} returned ${response.status}`);
  return json;
}

export default function CIOCommandCenterV12({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const fund = useFundSnapshot();
  const [tab, setTab] = useState<Tab>("meeting");
  const [refreshKey, setRefreshKey] = useState(0);
  const [data, setData] = useState<{ actions: AnyRow | null; performance: AnyRow | null }>({ actions: null, performance: null });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.allSettled([getJson("/api/analysis/actions"), getJson("/api/analysis/performance")]).then((results) => {
      if (!active) return;
      const actions = results[0].status === "fulfilled" ? results[0].value : null;
      const performance = results[1].status === "fulfilled" ? results[1].value : null;
      setData({ actions, performance });
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) setError(`${failed} supporting source(s) unavailable. The committee excluded missing evidence.`);
    });
    return () => { active = false; };
  }, [refreshKey]);

  const actionRows = useMemo<AnyRow[]>(() => {
    const payload = data.actions;
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.actions)) return payload.actions;
    if (Array.isArray(payload?.items)) return payload.items;
    return [];
  }, [data.actions]);

  const analysisByTicker = useMemo(() => {
    const map = new Map<string, AnyRow>();
    actionRows.forEach((row) => {
      const ticker = String(row?.ticker ?? row?.symbol ?? "").toUpperCase();
      if (ticker) map.set(ticker, row);
    });
    return map;
  }, [actionRows]);

  const candidates = useMemo<Candidate[]>(() => actionRows.map((row): Candidate => {
    const ticker = String(row?.ticker ?? row?.symbol ?? "").toUpperCase();
    return {
      ticker,
      rating: String(row?.rating ?? row?.decision ?? row?.action ?? "WATCH").toUpperCase(),
      conviction: Math.max(0, Math.min(100, finite(row?.conviction ?? row?.score) ?? 0)),
      upside: finite(row?.upside ?? row?.expected_upside ?? row?.upside_pct),
      target: finite(row?.target ?? row?.target_price ?? row?.fair_value),
      price: finite(row?.price ?? row?.current_price),
      valuation: text(row?.valuation ?? row?.valuation_label ?? row?.fair_value_status, "VALUATION PENDING"),
      thesis: text(row?.thesis ?? row?.investment_thesis, "Thesis requires analyst completion."),
      catalyst: text(row?.catalyst ?? row?.catalysts, "No verified catalyst supplied."),
      vision: text(row?.vision ?? row?.future_trend ?? row?.theme, "Future trend evidence pending."),
      source: text(row?.source ?? row?.engine, "Analyze Queue"),
    };
  }).filter((row) => row.ticker).sort((a, b) => {
    const upsideA = a.upside ?? 0;
    const upsideB = b.upside ?? 0;
    return (b.conviction + upsideB * 0.35) - (a.conviction + upsideA * 0.35);
  }).slice(0, 10), [actionRows]);

  const holdings = useMemo<HoldingDecision[]>(() => fund.holdings.map((holding: FundHolding): HoldingDecision => {
    const analysis = analysisByTicker.get(holding.ticker);
    const pnlPct = holding.avgCost > 0 ? (holding.price / holding.avgCost - 1) * 100 : null;
    const explicitValuation = String(analysis?.valuation ?? analysis?.valuation_label ?? analysis?.fair_value_status ?? "").toUpperCase();
    const valuation = explicitValuation || (pnlPct == null ? "UNVERIFIED" : pnlPct >= 25 ? "FULL / OVER" : pnlPct <= -12 ? "UNDER / VERIFY" : "FAIR");
    const noFuture = /NO GROWTH|WEAK THESIS|DETERIORAT|SELL|EXIT/.test(String(analysis?.risk ?? analysis?.thesis_status ?? analysis?.rating ?? "").toUpperCase());
    const overWeight = holding.weightPct >= 18;
    const deepWeakness = pnlPct != null && pnlPct <= -18;
    const fullValuation = /OVER|FULL|EXPENSIVE|PREMIUM/.test(valuation);
    const positive = /BUY|ADD|UNDERVALUED|ATTRACTIVE/.test(String(analysis?.rating ?? analysis?.decision ?? analysis?.action ?? valuation).toUpperCase());
    let action: HoldingDecision["action"] = "HOLD";
    if (noFuture || deepWeakness) action = "EXIT";
    else if (overWeight || fullValuation) action = "TRIM";
    else if (positive) action = "ADD";
    else if (!analysis) action = "REVIEW";
    const risk = overWeight ? "CONCENTRATION" : deepWeakness ? "THESIS / DRAWDOWN" : fullValuation ? "VALUATION" : "WITHIN POLICY";
    const reason = action === "EXIT"
      ? "Thesis, trend or drawdown evidence requires an exit review."
      : action === "TRIM"
        ? "Valuation is full or position weight is high; recycle capital selectively."
        : action === "ADD"
          ? "Fundamental/valuation evidence remains supportive and position is within limits."
          : action === "REVIEW"
            ? "No current Analyze evidence is linked to this holding."
            : "No verified evidence currently justifies a portfolio change.";
    return { ticker: holding.ticker, weight: holding.weightPct, marketValue: holding.marketValue, pnlPct, valuation, risk, action, reason };
  }).sort((a, b) => b.weight - a.weight), [analysisByTicker, fund.holdings]);

  const macro = fund.raw?.macro ?? {};
  const bufferRegime = fund.raw?.buffer?.regime ?? {};
  const vix = finite(bufferRegime?.vix ?? macro?.vix ?? macro?.sentiment?.vix);
  const fearGreed = finite(macro?.sentiment?.fearGreed ?? macro?.fearGreed ?? macro?.fear_greed?.value);
  const rates = finite(macro?.economy?.policyRate ?? macro?.rates?.fedFunds ?? macro?.fedFundsRate);
  const inflation = finite(macro?.economy?.inflation ?? macro?.cpi?.yoy ?? macro?.inflation);
  const growth = finite(macro?.economy?.gdpGrowth ?? macro?.gdp?.growth ?? macro?.gdpGrowth);
  const sectorRows = Array.isArray(macro?.sectors) ? macro.sectors : Array.isArray(macro?.sectorRotation) ? macro.sectorRotation : [];
  const leadingSectors = sectorRows.slice(0, 4).map((row: AnyRow) => text(row?.sector ?? row?.name ?? row?.ticker, "Unknown")).join(" · ") || "Sector-rotation data unavailable";
  const macroPosture = fund.macroScore >= 65 ? "RISK-ON · SELECTIVE EXPANSION" : fund.macroScore <= 40 ? "RISK-OFF · CAPITAL DEFENSE" : "NEUTRAL · BALANCED SELECTIVITY";

  const trimCandidates = holdings.filter((row) => row.action === "TRIM" || row.action === "EXIT");
  const suggestedBudget = Math.min(800, Math.max(0, fund.deployableCash + trimCandidates.reduce((sum, row) => sum + Math.min(row.marketValue * 0.1, 300), 0)));
  const addCandidates = candidates.filter((row) => /BUY|ADD|ACCUMULATE|OUTPERFORM/.test(row.rating) || (row.upside ?? 0) > 8).slice(0, 3);
  const allocation = useMemo<Allocation[]>(() => {
    if (!addCandidates.length || suggestedBudget <= 0) return [];
    const weights = addCandidates.length === 1 ? [1] : addCandidates.length === 2 ? [0.62, 0.38] : [0.5, 0.3125, 0.1875];
    let used = 0;
    return addCandidates.map((candidate, index) => {
      const amount = index === addCandidates.length - 1 ? Math.max(0, suggestedBudget - used) : Math.round(suggestedBudget * weights[index]);
      used += amount;
      return {
        ticker: candidate.ticker,
        amount,
        weight: suggestedBudget > 0 ? amount / suggestedBudget * 100 : 0,
        reason: `${candidate.valuation} · conviction ${candidate.conviction}/100 · catalyst: ${candidate.catalyst}`,
      };
    });
  }, [addCandidates, suggestedBudget]);

  const teamVotes = [
    { team: "Macro & Sentiment", score: fund.macroScore, vote: fund.macroScore >= 60 ? "DEPLOY SELECTIVELY" : fund.macroScore < 40 ? "RAISE DEFENSE" : "BALANCED" },
    { team: "Portfolio & Holdings", score: fund.portfolioHealth, vote: trimCandidates.length ? "REBALANCE" : "HOLD CORE" },
    { team: "Research & Future Themes", score: addCandidates[0]?.conviction ?? 0, vote: addCandidates.length ? `ADD ${addCandidates.length}` : "NO NEW ADD" },
    { team: "Fundamental & Valuation", score: fund.qualityScore, vote: candidates.some((row) => /UNDER|ATTRACTIVE/.test(row.valuation.toUpperCase())) ? "VALUE AVAILABLE" : "PRICE DISCIPLINE" },
  ];
  const consensus = Math.round(teamVotes.reduce((sum, row) => sum + row.score, 0) / teamVotes.length);
  const resolution = allocation.length
    ? `Rebalance selectively, review ${trimCandidates.length} funding source(s), and add ${allocation.length} new investment(s) with ${money(suggestedBudget)} proposed capital.`
    : "Hold current portfolio, complete missing analysis and preserve capital until risk/reward improves.";

  const visible = (id: TeamId | "resolution") => tab === "meeting" || tab === id;

  if (fund.loading) return <section className="card"><p>Loading verified committee evidence…</p></section>;

  return <div className="workspace-stack" data-cio-version="14.0" data-workspace="four-team-investment-committee" data-source-of-truth="fund-snapshot analyze-action-queue">
    <section className="card" style={{ borderTop: "3px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="tag">CIO COMMAND CENTER · FOUR-TEAM COMMITTEE</span>
          <h2 className="section" style={{ margin: "10px 0 6px" }}>{tr(lang, "Investment Strategy Meeting", "ประชุมวางแผนกลยุทธ์การลงทุน")}</h2>
          <p className="muted" style={{ margin: 0, maxWidth: 920 }}>{tr(lang, "Four specialist teams review macro conditions, holdings, new research and fundamental valuation before issuing one governed portfolio resolution.", "4 ทีมผู้เชี่ยวชาญวิเคราะห์ Macro, Holdings, Research และ Fundamental Valuation ก่อนลงความเห็นปรับพอร์ตเป็นข้อสรุปเดียว")}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><span className="tag">{fund.verified ? "VERIFIED SNAPSHOT" : "PARTIAL DATA"}</span><button className="btn ghost" type="button" onClick={() => setRefreshKey((value) => value + 1)}>↻ Refresh Meeting</button></div>
      </div>
      {error && <div className="notice" style={{ marginTop: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 16, paddingBottom: 4, position: "sticky", top: 0, zIndex: 6 }}>
        <button className={`btn ${tab === "meeting" ? "" : "ghost"}`} onClick={() => setTab("meeting")}>Full Meeting</button>
        {TEAM_META.map((team) => <button key={team.id} className={`btn ${tab === team.id ? "" : "ghost"}`} onClick={() => setTab(team.id)}>{team.no} · {lang === "th" ? team.th : team.en}</button>)}
        <button className={`btn ${tab === "resolution" ? "" : "ghost"}`} onClick={() => setTab("resolution")}>05 · Resolution</button>
      </div>
      <div className="grid cols-4" style={{ marginTop: 14 }}><Metric label="Verified NAV" value={money(fund.totalNav)} /><Metric label="Portfolio Health" value={`${fund.portfolioHealth}/100`} /><Metric label="Broker Cash" value={money(fund.cashBalance)} /><Metric label="Committee Consensus" value={`${consensus}/100`} /></div>
    </section>

    {TEAM_META.map((team) => visible(team.id) && <section key={team.id} id={`cio-${team.id}`} className="card" style={{ scrollMarginTop: 130 }}>
      <TeamHeader no={team.no} title={lang === "th" ? team.th : team.en} mission={lang === "th" ? team.missionTh : team.missionEn} />
      {team.id === "macro" && <>
        <div className="grid cols-4"><Metric label="Market Regime" value={fund.macroLabel.toUpperCase()} /><Metric label="Macro Score" value={`${fund.macroScore.toFixed(0)}/100`} /><Metric label="VIX" value={vix == null ? "—" : vix.toFixed(1)} /><Metric label="Fear & Greed" value={fearGreed == null ? "—" : `${fearGreed.toFixed(0)}/100`} /></div>
        <div className="grid cols-4" style={{ marginTop: 12 }}><Metric label="Policy Rate" value={rates == null ? "—" : `${rates.toFixed(2)}%`} /><Metric label="Inflation" value={inflation == null ? "—" : `${inflation.toFixed(2)}%`} /><Metric label="GDP Growth" value={growth == null ? "—" : `${growth.toFixed(2)}%`} /><Metric label="Strategy" value={macroPosture} /></div>
        <div className="grid cols-2" style={{ marginTop: 14 }}><Panel title="Momentum & Sentiment" body={fund.macroVision} /><Panel title="Sector Rotation" body={leadingSectors} /></div>
      </>}
      {team.id === "portfolio" && <>
        <div className="grid cols-4"><Metric label="Open Holdings" value={String(fund.openPositions)} /><Metric label="Unrealized P/L" value={`${money(fund.unrealizedPnl)} · ${pct(fund.unrealizedPnlPct)}`} /><Metric label="Largest Weight" value={`${(holdings[0]?.weight ?? 0).toFixed(1)}%`} /><Metric label="Action Reviews" value={String(trimCandidates.length)} /></div>
        <DataTable headers={["Ticker", "Weight", "Market Value", "Vs Cost", "Valuation", "Risk", "Team View"]} rows={holdings.map((row) => [row.ticker, `${row.weight.toFixed(1)}%`, money(row.marketValue), pct(row.pnlPct), row.valuation, row.risk, `${row.action} — ${row.reason}`])} />
      </>}
      {team.id === "research" && <>
        <div className="notice"><b>Research mandate</b><p>Search for durable future trends, identify the thesis and catalysts, then send only qualified ideas to Analyze for fundamental and valuation review.</p></div>
        {candidates.length ? <div className="grid cols-2" style={{ marginTop: 14 }}>{candidates.map((row, index) => <article className="metric" key={`${row.ticker}-${index}`}><span>#{index + 1} · {row.source}</span><strong>{row.ticker} · {row.rating}</strong><small>Conviction {row.conviction}/100 · Upside {pct(row.upside)} · Target {row.target == null ? "—" : money(row.target)}</small><small style={{ marginTop: 7 }}><b>Vision:</b> {row.vision}</small><small><b>Thesis:</b> {row.thesis}</small><small><b>Catalyst:</b> {row.catalyst}</small></article>)}</div> : <div className="notice" style={{ marginTop: 14 }}>No qualified research candidate is in the Analyze queue.</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}><button className="btn ghost" onClick={() => onNavigate("research")}>Open Research Lab</button><button className="btn ghost" onClick={() => onNavigate("analyze")}>Send to Analyze</button></div>
      </>}
      {team.id === "analyze" && <>
        <div className="grid cols-4"><Metric label="Quality Score" value={`${fund.qualityScore}/100`} /><Metric label="Risk Score" value={`${fund.riskScore}/100`} /><Metric label="Holdings Reviewed" value={String(holdings.length)} /><Metric label="Candidates Reviewed" value={String(candidates.length)} /></div>
        <DataTable headers={["Ticker", "Fundamental View", "Valuation", "Upside", "Catalyst", "Analyze Decision"]} rows={candidates.map((row) => [row.ticker, row.thesis, row.valuation, pct(row.upside), row.catalyst, row.rating])} empty="No completed fundamental and valuation analysis is available." />
      </>}
    </section>)}

    {visible("resolution") && <section id="cio-resolution" className="card" style={{ borderTop: "3px solid #8f5cff", scrollMarginTop: 130 }}>
      <TeamHeader no="05" title={tr(lang, "Committee Resolution & Capital Plan", "มติคณะกรรมการและแผนจัดสรรเงิน")} mission={tr(lang, "Combine all four team views into one human-approved rebalance and funding proposal.", "รวมความเห็นทั้ง 4 ทีมเป็นข้อเสนอ Rebalance และจัดสรรเงินที่มนุษย์ต้องอนุมัติ")} />
      <div className="grid cols-4">{teamVotes.map((vote) => <article className="metric" key={vote.team}><span>{vote.team}</span><strong>{vote.vote}</strong><small>{vote.score}/100</small></article>)}</div>
      <div className="notice" style={{ marginTop: 14 }}><b>Final committee view</b><p>{resolution}</p></div>
      <div className="grid cols-4" style={{ marginTop: 14 }}><Metric label="Broker Cash" value={money(fund.cashBalance)} /><Metric label="Deployable Cash" value={money(fund.deployableCash)} /><Metric label="Potential Trim Sources" value={money(trimCandidates.reduce((sum, row) => sum + Math.min(row.marketValue * 0.1, 300), 0))} /><Metric label="Proposed New Capital" value={money(suggestedBudget)} /></div>
      <h3 className="sub" style={{ marginTop: 18 }}>Holding actions</h3>
      <DataTable headers={["Ticker", "Decision", "Reason", "Potential Source"]} rows={trimCandidates.map((row) => [row.ticker, row.action, row.reason, money(Math.min(row.marketValue * 0.1, 300))])} empty="No holding is currently proposed for trim or exit." />
      <h3 className="sub" style={{ marginTop: 18 }}>New investment allocation</h3>
      <DataTable headers={["Ticker", "Allocation", "% of Plan", "Valuation / Catalyst Rationale"]} rows={allocation.map((row) => [row.ticker, money(row.amount), `${row.weight.toFixed(1)}%`, row.reason])} empty="No new allocation is approved. Complete research and valuation work first." />
      {allocation.length === 3 && suggestedBudget === 800 && <div className="notice" style={{ marginTop: 12 }}><b>Example meeting outcome:</b> Add {allocation[0].ticker} {money(allocation[0].amount)}, {allocation[1].ticker} {money(allocation[1].amount)} and {allocation[2].ticker} {money(allocation[2].amount)} based on valuation, conviction and catalyst quality.</div>}
      <div className="grid cols-3" style={{ marginTop: 14 }}><Guard title="PROPOSAL ONLY" text="The committee never changes Holdings automatically." /><Guard title="HUMAN APPROVAL" text="A person must approve tickers, amounts and capital source." /><Guard title="LEDGER EXECUTION" text="Only recorded BUY/SELL transactions update the portfolio." /></div>
    </section>}
  </div>;
}

function TeamHeader({ no, title, mission }: { no: string; title: string; mission: string }) {
  return <div style={{ display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 14 }}><span className="tag" style={{ fontSize: 16 }}>{no}</span><div><h3 className="sub" style={{ margin: 0 }}>{title}</h3><p className="muted" style={{ margin: "5px 0 0" }}>{mission}</p></div></div>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong style={{ fontSize: 20, lineHeight: 1.25 }}>{value}</strong></div>;
}
function Panel({ title, body }: { title: string; body: string }) {
  return <div className="notice"><b>{title}</b><p>{body}</p></div>;
}
function Guard({ title, text }: { title: string; text: string }) {
  return <div className="metric"><span>{title}</span><strong style={{ fontSize: 14, lineHeight: 1.4 }}>{text}</strong></div>;
}
function DataTable({ headers, rows, empty = "No rows available." }: { headers: string[]; rows: string[][]; empty?: string }) {
  return <div style={{ overflowX: "auto", marginTop: 14 }}><table style={{ width: "100%", minWidth: 980, borderCollapse: "collapse" }}><thead><tr>{headers.map((header) => <th key={header} style={th}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => <tr key={`${row[0]}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} style={td}>{cellIndex === 0 ? <b>{cell}</b> : cell}</td>)}</tr>) : <tr><td colSpan={headers.length} style={td}>{empty}</td></tr>}</tbody></table></div>;
}

const th: React.CSSProperties = { textAlign: "left", padding: "12px 10px", borderBottom: "1px solid var(--border)", fontSize: 12, letterSpacing: ".08em", color: "var(--muted)", verticalAlign: "top" };
const td: React.CSSProperties = { padding: "12px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top", fontSize: 13, lineHeight: 1.45 };
