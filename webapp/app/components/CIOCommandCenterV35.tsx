"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";
import MeetingPlanApprovalPanel from "./MeetingPlanApprovalPanel";
import MeetingApprovalPanel, { type ApprovalMotion } from "./MeetingApprovalPanel";
import styles from "./CIOCommandCenterV35.module.css";

type StepId = "status" | "opportunities" | "portfolio" | "capital" | "decision";
type MotionKind = "ADD" | "HOLD" | "TRIM" | "EXIT" | "NEW BUY" | "RAISE CASH";
type Outcome = "CARRIED" | "FAILED" | "DEFERRED";
type DecisionGate = { stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO"; owner: string; title: string; status: "PASS" | "DEFER" | "VETO"; rationale: string };
type Motion = {
  id: string;
  ticker: string;
  kind: MotionKind;
  sizeUsd: number;
  approxShares: number | null;
  evidenceCoveragePct: number;
  missingEvidence: string[];
  decisionGates: DecisionGate[];
  outcome: Outcome;
  outcomeReason: string;
  veto: { member: string; reason: string } | null;
};
type Proposal = {
  ticker: string;
  setupType: string;
  score: number;
  coveragePct: number;
  price: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  riskReward: number;
  expectedReturnPct: number;
  thesis: string;
  catalyst: string;
  unmeasured: string[];
};
type Meeting = {
  meetingId: string;
  asOf: string;
  nav: number;
  cashBuffer?: { valueUsd: number; pct: number | null; targetPct: number | null; reserveHoldings?: { ticker?: string; marketValue?: number }[] };
  quorum: { present: number; required: number; met: boolean; note: string };
  regime: { score: number; regime: string; icon: string; cashMinPct: number; deployRule: string; note: string } | null;
  proposals?: Proposal[];
  scan?: {
    status: "QUALIFIED" | "NO_BUY" | "DATA_BLOCKED";
    asOf: string;
    universeSize: number;
    rejected: number;
    warnings: string[];
    note: string;
    stages: { stage: string; owner: string; analyzed: number; passed: number; rejected: number; note: string }[];
    nearMisses: { ticker: string; engine: string; gate: string; reason: string; score: number | null }[];
    researchOS?: { universeSize: number; analyzed: number; rejected: number; models: string[]; methodology: string | null };
  };
  motions: Motion[];
  capitalPlan: {
    sourcesUsd: number;
    deployableSourcesUsd: number;
    sourceLines: { label: string; amountUsd: number }[];
    usesUsd: number;
    useLines: { label: string; amountUsd: number }[];
    balanceUsd: number;
    funded: boolean;
    cutForFunding: { ticker: string; requestedUsd: number; reason: string }[];
    cashAfterPct: number | null;
    earmarkedForCashUsd: number;
    temporaryParkingUsd: number;
    unallocatedUsd: number;
    allocationComplete: boolean;
    approvalReady: boolean;
    allocationStatus: "READY" | "INCOMPLETE";
    note: string;
  };
  blotter: { side: "BUY" | "SELL"; ticker: string; approxShares: number | null; approxUsd: number; referencePrice: number | null; reason: string }[];
  resolutions: { id: string; text: string; owner: string; reviewBy: string; status: "APPROVED" | "DEFERRED" | "REJECTED" }[];
  deskReports: { member: string; role: string; desk: string; headline: string | null; finding: string; gaps: string[] }[];
  riskRegister: { raisedBy: string; role: string; severity: "high" | "medium" | "low"; item: string; evidence: string; suggestedAction: string }[];
  minutes: string[];
  disclosures: string[];
  portfolioSnapshot?: { id: string; asOf: string; portfolioRevision: string; holdingsRevision: string; cashRevision: string; holdingsConsistent: boolean; cashFreshness: string } | null;
  sources?: { navFrom: string; priced: number; positions: number; snapshotId?: string | null; snapshotAsOf?: string | null };
};
type CapitalSnapshot = {
  totalNav: number | null;
  currentBufferUsd: number | null;
  currentBufferPct: number | null;
  cashFloorPct: number | null;
  targetValue: number | null;
  shortfallValue: number | null;
  deployableCash: number | null;
  posture: string;
  action: string;
  verified: boolean;
};
type MarketItem = { price?: number | null; momentumForecast?: any; technicalOverlay?: any };

type LoadPack = { meeting: Meeting; capital: CapitalSnapshot | null; market: Record<string, MarketItem> };

const FROZEN_KEY = "sentinel:cio:frozen-meeting:v35";
const PLAN_KEY = (meetingId: string) => `sentinel:cio:plan-approval:${meetingId}`;
const tr = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;
const safe = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const usd = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits }).format(value);
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;

const STEPS: { id: StepId; n: string; en: string; th: string; owner: string }[] = [
  { id: "status", n: "01", en: "Fund Status", th: "สถานะกองทุน", owner: "CIO" },
  { id: "opportunities", n: "02", en: "Opportunities", th: "โอกาสลงทุน", owner: "INV" },
  { id: "portfolio", n: "03", en: "Portfolio Actions", th: "จัดการพอร์ต", owner: "AM" },
  { id: "capital", n: "04", en: "Capital Plan", th: "แผนเงินทุน", owner: "AM / RISK" },
  { id: "decision", n: "05", en: "CIO Decision", th: "อนุมัติแผน", owner: "CIO" },
];

async function loadMeeting(): Promise<Meeting> {
  const response = await fetch(`/api/committee/meeting?v35=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? `Committee meeting failed (${response.status})`);
  return payload as Meeting;
}

async function loadIdentity() {
  const response = await fetch(`/api/portfolio/cash-buffer?v35identity=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Portfolio identity unavailable");
  return { snapshotId: payload?.snapshotId ?? null };
}

async function loadCapital(): Promise<CapitalSnapshot | null> {
  try {
    const response = await fetch(`/api/capital-recycling?v35=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => ({}));
    return response.ok ? payload as CapitalSnapshot : null;
  } catch { return null; }
}

async function marketBatch(tickers: string[]) {
  const items: Record<string, MarketItem> = {};
  for (let index = 0; index < tickers.length; index += 25) {
    const chunk = tickers.slice(index, index + 25);
    if (!chunk.length) continue;
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&v35=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({ items: {} }));
    Object.assign(items, payload.items ?? {});
  }
  return items;
}

function carriedAction(motion: Motion) { return motion.outcome === "CARRIED" && motion.kind !== "HOLD" && Math.abs(safe(motion.sizeUsd)) > 0; }
function actionTone(kind: MotionKind | string) {
  if (["ADD", "NEW BUY"].includes(kind)) return styles.positive;
  if (["TRIM", "EXIT", "RAISE CASH"].includes(kind)) return styles.risk;
  return styles.neutral;
}
function decisionTone(action: string) {
  if (action === "ADD") return styles.positive;
  if (action === "PROFIT WATCH" || action === "HOLD") return styles.neutral;
  return styles.risk;
}

export default function CIOCommandCenterV35({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const [pack, setPack] = useState<LoadPack | null>(null);
  const [step, setStep] = useState<StepId>("status");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [frozen, setFrozen] = useState(false);
  const [executionAuthorized, setExecutionAuthorized] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (refreshKey === 0) {
        const saved = window.localStorage.getItem(FROZEN_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as LoadPack;
            const identity = await loadIdentity();
            if (parsed?.meeting?.meetingId && parsed.meeting.portfolioSnapshot?.id === identity.snapshotId) {
              setPack(parsed); setFrozen(true); setLoading(false); return;
            }
          } catch { /* stale local audit snapshot */ }
          window.localStorage.removeItem(FROZEN_KEY);
        }
      }
      const [meeting, capital] = await Promise.all([loadMeeting(), loadCapital()]);
      const tickers = Array.from(new Set([
        ...(meeting.proposals ?? []).map(row => clean(row.ticker)),
        ...(meeting.motions ?? []).map(row => clean(row.ticker)),
      ].filter(Boolean)));
      const market = await marketBatch(tickers);
      setPack({ meeting, capital, market });
      setFrozen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CIO command package unavailable");
    } finally { setLoading(false); }
  }, [refreshKey]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!pack?.meeting?.meetingId) return;
    setExecutionAuthorized(Boolean(window.localStorage.getItem(PLAN_KEY(pack.meeting.meetingId))));
  }, [pack?.meeting?.meetingId]);
  useEffect(() => {
    const refresh = () => { window.localStorage.removeItem(FROZEN_KEY); setRefreshKey(value => value + 1); setStep("status"); };
    window.addEventListener("sentinel:portfolio-updated", refresh);
    window.addEventListener("sentinel:cash-ledger-changed", refresh);
    return () => { window.removeEventListener("sentinel:portfolio-updated", refresh); window.removeEventListener("sentinel:cash-ledger-changed", refresh); };
  }, []);

  const freeze = () => {
    if (!pack) return;
    window.localStorage.setItem(FROZEN_KEY, JSON.stringify(pack));
    setFrozen(true);
  };
  const newMeeting = () => {
    window.localStorage.removeItem(FROZEN_KEY);
    setFrozen(false); setExecutionAuthorized(false); setStep("status"); setRefreshKey(value => value + 1);
  };

  if (loading && !pack) return <section className="card"><span className="spinner" /> {tr(lang, "Building the CIO decision package…", "กำลังจัดทำชุดตัดสินใจ CIO…")}</section>;
  if (error || !pack) return <section className="card"><span className="tag">CIO V35</span><h2>{tr(lang, "Command package unavailable", "ยังสร้างชุด Command ไม่ได้")}</h2><div className="err">⚠ {error}</div><button className="btn" onClick={() => setRefreshKey(value => value + 1)}>↻ Retry</button></section>;

  const { meeting, capital, market } = pack;
  const proposals = [...(meeting.proposals ?? [])].sort((a, b) => b.score - a.score || b.expectedReturnPct - a.expectedReturnPct);
  const motions = [...(meeting.motions ?? [])];
  const actionMotions = motions.filter(carriedAction);
  const blockedMotions = motions.filter(row => row.outcome === "DEFERRED" || row.veto);
  const highRisks = (meeting.riskRegister ?? []).filter(row => row.severity === "high");
  const planApprovalReady = Boolean(meeting.capitalPlan?.approvalReady && meeting.capitalPlan?.funded && !highRisks.length && meeting.quorum?.met);
  const approvalBlockReason = !meeting.quorum?.met ? "Committee quorum is not met."
    : highRisks.length ? `${highRisks.length} high-severity risk item(s) remain open.`
      : !meeting.capitalPlan?.funded ? "Capital plan is not fully funded."
        : !meeting.capitalPlan?.approvalReady ? "Capital allocation is incomplete."
          : undefined;
  const approvalMotions: ApprovalMotion[] = actionMotions.map(motion => ({
    id: motion.id, ticker: motion.ticker, kind: motion.kind, sizeUsd: motion.sizeUsd, approxShares: motion.approxShares,
    referencePrice: meeting.blotter?.find(line => line.ticker === motion.ticker)?.referencePrice ?? null,
    outcome: motion.outcome, outcomeReason: motion.outcomeReason,
  }));
  const buyNeed = actionMotions.filter(row => row.kind === "NEW BUY" || row.kind === "ADD").reduce((sum, row) => sum + Math.abs(safe(row.sizeUsd)), 0);
  const cashExcess = Math.max(0, safe(capital?.deployableCash));
  const saleGap = Math.max(0, buyNeed - cashExcess);
  const noSaleRequired = buyNeed > 0 && saleGap < 1;
  const currentStepIndex = STEPS.findIndex(row => row.id === step);

  return <section className={styles.shell} data-cio-version="35.0" data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION">
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>SENTINEL INVESTMENT OS · CIO COMMAND V35</span>
        <h1>{tr(lang, "One decision path. No duplicate workspaces.", "เส้นทางตัดสินใจเดียว ไม่ซ้ำซ้อน")}</h1>
        <p>{tr(lang,
          "Research, portfolio management, capital allocation, risk and approval now converge into five steps. Engine details remain available on demand.",
          "Research, การจัดการพอร์ต, เงินทุน, Risk และการอนุมัติถูกรวมเป็น 5 ขั้นเดียว รายละเอียดเชิงลึกเปิดดูเมื่อจำเป็น")}</p>
      </div>
      <div className={styles.heroActions}>
        <span className={`${styles.liveBadge} ${frozen ? styles.audit : ""}`}>{frozen ? "AUDIT SNAPSHOT" : "LIVE PACKAGE"}</span>
        <button className="btn ghost sm" type="button" onClick={frozen ? newMeeting : freeze}>{frozen ? "↻ New meeting" : "▣ Freeze audit"}</button>
      </div>
    </header>

    <nav className={styles.stepper} aria-label="CIO decision workflow">
      {STEPS.map((row, index) => <button key={row.id} className={`${styles.step} ${step === row.id ? styles.active : ""} ${index < currentStepIndex ? styles.done : ""}`} onClick={() => setStep(row.id)}>
        <span>{row.n}</span><div><strong>{tr(lang, row.en, row.th)}</strong><small>{row.owner}</small></div>
      </button>)}
    </nav>

    {step === "status" && <StatusStep lang={lang} meeting={meeting} capital={capital} actionCount={actionMotions.length} blockerCount={blockedMotions.length} highRiskCount={highRisks.length} onNext={() => setStep("opportunities")} />}
    {step === "opportunities" && <OpportunityStep lang={lang} meeting={meeting} proposals={proposals} market={market} onNavigate={onNavigate} onNext={() => setStep("portfolio")} />}
    {step === "portfolio" && <PortfolioStep lang={lang} motions={motions} market={market} onNavigate={onNavigate} onNext={() => setStep("capital")} />}
    {step === "capital" && <CapitalStep lang={lang} meeting={meeting} capital={capital} buyNeed={buyNeed} cashExcess={cashExcess} saleGap={saleGap} noSaleRequired={noSaleRequired} onNext={() => setStep("decision")} />}
    {step === "decision" && <DecisionStep lang={lang} meeting={meeting} actionMotions={actionMotions} approvalMotions={approvalMotions} planApprovalReady={planApprovalReady} approvalBlockReason={approvalBlockReason} executionAuthorized={executionAuthorized} onApproved={() => setExecutionAuthorized(true)} onNewMeeting={newMeeting} />}
  </section>;
}

function StatusStep({ lang, meeting, capital, actionCount, blockerCount, highRiskCount, onNext }: { lang: AppLang; meeting: Meeting; capital: CapitalSnapshot | null; actionCount: number; blockerCount: number; highRiskCount: number; onNext: () => void }) {
  const bufferPct = capital?.currentBufferPct ?? meeting.cashBuffer?.pct ?? null;
  const targetPct = capital?.cashFloorPct ?? meeting.cashBuffer?.targetPct ?? meeting.regime?.cashMinPct ?? null;
  const priced = meeting.sources?.priced ?? 0, positions = meeting.sources?.positions ?? 0;
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>01 · CIO</span><h2>{tr(lang, "Fund Status", "สถานะกองทุน")}</h2><p>{tr(lang, "Answer one question first: what state is the fund in right now?", "ตอบคำถามเดียวก่อน: ตอนนี้กองทุนอยู่ในสภาวะไหน")}</p></div><button className="btn" onClick={onNext}>{tr(lang, "Review opportunities →", "ดูโอกาสลงทุน →")}</button></div>
    <div className={styles.kpiGrid}>
      <Kpi label="NAV" value={usd(meeting.nav)} note={meeting.portfolioSnapshot?.holdingsConsistent === false ? "LEDGER CHECK" : "authoritative ledger"} tone="normal" />
      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={`${meeting.regime?.icon ?? "●"} ${meeting.regime?.regime ?? "UNAVAILABLE"}`} note={meeting.regime ? `${meeting.regime.score}/100` : "data unavailable"} tone={meeting.regime && meeting.regime.score >= 60 ? "good" : "normal"} />
      <Kpi label="Cash Buffer" value={usd(capital?.currentBufferUsd ?? meeting.cashBuffer?.valueUsd)} note={`${pct(bufferPct)} · target ${pct(targetPct)}`} tone={safe(bufferPct) >= safe(targetPct) ? "good" : "risk"} />
      <Kpi label={tr(lang, "Deployable cash", "เงินพร้อมใช้")} value={usd(capital?.deployableCash)} note={capital?.action ?? "cash-floor protected"} tone={safe(capital?.deployableCash) > 0 ? "good" : "normal"} />
      <Kpi label={tr(lang, "Pending actions", "รายการรอดำเนินการ")} value={String(actionCount)} note={`${blockerCount} blocked/deferred`} tone={blockerCount ? "risk" : "normal"} />
      <Kpi label="Data Health" value={positions ? `${priced}/${positions}` : "—"} note={positions && priced === positions ? "COMPLETE" : "CHECK SOURCE"} tone={positions && priced === positions ? "good" : "risk"} />
    </div>
    <div className={styles.briefGrid}>
      <article><span className={styles.label}>CIO POSTURE</span><strong>{meeting.regime?.deployRule ?? "No deployment rule available"}</strong><p>{meeting.regime?.note ?? "Market regime evidence is unavailable."}</p></article>
      <article><span className={styles.label}>GOVERNANCE</span><strong>{meeting.quorum.met ? "READY" : "BLOCKED"} · {meeting.quorum.present}/{meeting.quorum.required}</strong><p>{highRiskCount ? `${highRiskCount} high-severity risk item(s) require resolution.` : meeting.quorum.note}</p></article>
    </div>
    <details className={styles.details}><summary>{tr(lang, "Diagnostics & source identity", "Diagnostics และแหล่งข้อมูล")}</summary><div className={styles.detailBody}><p>Meeting: {meeting.meetingId} · As of {meeting.asOf}</p><p>Snapshot: {meeting.portfolioSnapshot?.id ?? "—"} · Cash freshness: {meeting.portfolioSnapshot?.cashFreshness ?? "—"}</p><p>Capital snapshot: {capital?.verified ? "VERIFIED" : "partial/unavailable"}</p></div></details>
  </div>;
}

function OpportunityStep({ lang, meeting, proposals, market, onNavigate, onNext }: { lang: AppLang; meeting: Meeting; proposals: Proposal[]; market: Record<string, MarketItem>; onNavigate: (id: string) => void; onNext: () => void }) {
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>02 · INV</span><h2>{tr(lang, "Investment Opportunities", "โอกาสลงทุน")}</h2><p>{tr(lang, "Only the strongest current candidates belong here. Research evidence opens on demand.", "แสดงเฉพาะ Candidate ที่ดีที่สุด รายละเอียด Research เปิดดูเมื่อจำเป็น")}</p></div><div className={styles.headButtons}><button className="btn ghost" onClick={() => onNavigate("research")}>{tr(lang, "Open Research", "เปิด Research")}</button><button className="btn" onClick={onNext}>{tr(lang, "Portfolio actions →", "จัดการพอร์ต →")}</button></div></div>
    <div className={styles.pipelineBar}><strong>{meeting.scan?.status ?? (proposals.length ? "QUALIFIED" : "NO BUY")}</strong><span>{meeting.scan?.researchOS?.universeSize ?? meeting.scan?.universeSize ?? 0} universe</span><span>{meeting.scan?.researchOS?.analyzed ?? 0} analyzed</span><span>{proposals.length} decision-ready</span></div>
    {proposals.length ? <div className={styles.opportunityList}>{proposals.slice(0, 8).map((row, index) => {
      const item = market[clean(row.ticker)], forecast = item?.momentumForecast;
      const forecastReturn = forecast?.expectedReturnPct == null ? null : safe(forecast.expectedReturnPct);
      const confidence = forecast?.confidence == null ? null : safe(forecast.confidence);
      return <article key={row.ticker} className={styles.opportunityCard}>
        <div className={styles.rank}>#{index + 1}</div><div className={styles.opMain}><div className={styles.opTitle}><strong>{row.ticker}</strong><span>{row.setupType}</span></div><div className={styles.opMetrics}><Metric label="Research upside" value={pct(row.expectedReturnPct)} good={row.expectedReturnPct >= 12}/><Metric label="Forecast 20–60D" value={forecastReturn == null ? "—" : pct(forecastReturn)} good={forecastReturn != null && forecastReturn >= 6}/><Metric label="Confidence" value={confidence == null ? "—" : `${Math.round(confidence)}/100`} good={confidence != null && confidence >= 62}/><Metric label="R:R" value={`${row.riskReward.toFixed(1)}R`} good={row.riskReward >= 1.5}/></div><p>{row.thesis}</p><small>{row.catalyst}</small></div>
        <details><summary>{tr(lang, "Evidence", "หลักฐาน")}</summary><div className={styles.detailBody}><p>Price {usd(item?.price ?? row.price, 2)} · Entry {usd(row.entryLow, 2)}–{usd(row.entryHigh, 2)} · Stop {usd(row.stop, 2)} · Target {usd(row.target, 2)}</p><p>Coverage {row.coveragePct}% · Score {row.score}/100 · Lifecycle {forecast?.lifecycleStage ?? "—"}</p>{row.unmeasured?.length ? <p>Unmeasured: {row.unmeasured.join(", ")}</p> : null}</div></details>
      </article>;
    })}</div> : <NoOpportunity lang={lang} meeting={meeting} />}
  </div>;
}

function NoOpportunity({ lang, meeting }: { lang: AppLang; meeting: Meeting }) {
  const misses = meeting.scan?.nearMisses ?? [];
  return <div className={styles.emptyState}><strong>{meeting.scan?.status === "DATA_BLOCKED" ? "DATA BLOCKED" : "NO QUALIFIED BUY"}</strong><p>{meeting.scan?.note ?? tr(lang, "INV found no opportunity worth deploying new capital into yet.", "INV ยังไม่พบหุ้นที่คุ้มกับการใช้เงินใหม่")}</p>{misses.length ? <details><summary>{tr(lang, "Top near-misses", "ตัวที่เกือบผ่าน")}</summary>{misses.slice(0, 5).map(row => <p key={`${row.ticker}-${row.gate}`}><b>{row.ticker}</b> · {row.gate} · {row.reason}</p>)}</details> : null}</div>;
}

function PortfolioStep({ lang, motions, market, onNavigate, onNext }: { lang: AppLang; motions: Motion[]; market: Record<string, MarketItem>; onNavigate: (id: string) => void; onNext: () => void }) {
  const priority: Record<MotionKind, number> = { EXIT: 0, TRIM: 1, ADD: 2, "NEW BUY": 3, HOLD: 4, "RAISE CASH": 5 };
  const rows = [...motions].sort((a, b) => priority[a.kind] - priority[b.kind] || Math.abs(b.sizeUsd) - Math.abs(a.sizeUsd));
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>03 · AM</span><h2>{tr(lang, "Portfolio Action Queue", "คิวจัดการพอร์ต")}</h2><p>{tr(lang, "One queue for ADD / HOLD / PROFIT WATCH / TRIM REVIEW / EXIT REVIEW evidence.", "รวม Action ของพอร์ตไว้จุดเดียว โดยใช้ Technical V34 เป็นภาษากลาง")}</p></div><div className={styles.headButtons}><button className="btn ghost" onClick={() => onNavigate("portfolio")}>{tr(lang, "Open Portfolio", "เปิด Portfolio")}</button><button className="btn" onClick={onNext}>{tr(lang, "Capital plan →", "แผนเงินทุน →")}</button></div></div>
    <div className={styles.actionList}>{rows.map(row => {
      const item = market[clean(row.ticker)], overlay = item?.technicalOverlay, decision = overlay?.decision, forecast = item?.momentumForecast;
      return <article key={row.id} className={styles.actionRow}>
        <div><span className={`${styles.actionChip} ${actionTone(row.kind)}`}>{row.kind}</span><strong>{row.ticker}</strong><small>{row.outcome}</small></div>
        <div className={styles.actionFacts}><Metric label="Current" value={usd(item?.price, 2)}/><Metric label="Size" value={row.kind === "HOLD" ? "—" : usd(Math.abs(row.sizeUsd))}/><Metric label="Forecast" value={forecast?.expectedReturnPct == null ? "—" : pct(safe(forecast.expectedReturnPct))} good={safe(forecast?.expectedReturnPct) >= 6}/><Metric label="V34" value={decision?.action ?? "—"} toneClass={decisionTone(decision?.action ?? "HOLD")}/></div>
        <p>{row.outcomeReason}</p>
        <details><summary>{tr(lang, "Trend / Flow / Location / gates", "Trend / Flow / Location / gates")}</summary><div className={styles.detailBody}><p>Trend {decision?.trendLabel ?? overlay?.sentinel?.coreState ?? "—"} · Flow {decision?.flowLabel ?? overlay?.mcdx?.state ?? "—"} · Location {decision?.location ?? "—"}</p>{row.decisionGates?.map(gate => <p key={gate.stage}><b>{gate.stage}</b> · {gate.status} · {gate.rationale}</p>)}</div></details>
      </article>;
    })}</div>
  </div>;
}

function CapitalStep({ lang, meeting, capital, buyNeed, cashExcess, saleGap, noSaleRequired, onNext }: { lang: AppLang; meeting: Meeting; capital: CapitalSnapshot | null; buyNeed: number; cashExcess: number; saleGap: number; noSaleRequired: boolean; onNext: () => void }) {
  const trimNeeded = Math.min(saleGap, Math.max(0, safe(meeting.capitalPlan?.sourcesUsd) - cashExcess));
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>04 · AM / RISK</span><h2>{tr(lang, "Capital Plan", "แผนเงินทุน")}</h2><p>{tr(lang, "Funding waterfall is explicit: excess cash first, approved trims second, executed sells last.", "แหล่งเงินชัดเจน: Cash ส่วนเกินก่อน → TRIM ที่อนุมัติ → SELL ที่เกิดขึ้นจริง")}</p></div><button className="btn" onClick={onNext}>{tr(lang, "CIO decision →", "ไปอนุมัติ CIO →")}</button></div>
    <div className={styles.waterfall}>
      <div><span>1</span><p>Cash Buffer Excess<strong>{usd(cashExcess)}</strong></p></div><i>→</i><div><span>2</span><p>Approved TRIM if required<strong>{usd(trimNeeded)}</strong></p></div><i>→</i><div><span>3</span><p>Executed SELL only<strong>{usd(0)}</strong></p></div><i>→</i><div><span>4</span><p>Investment Need<strong>{usd(buyNeed)}</strong></p></div>
    </div>
    <div className={`${styles.fundingVerdict} ${noSaleRequired ? styles.ok : saleGap > 0 ? styles.warn : ""}`}><strong>{buyNeed <= 0 ? "NO NEW CAPITAL REQUIRED" : noSaleRequired ? "NO SALE REQUIRED" : `FUNDING GAP ${usd(saleGap)}`}</strong><p>{buyNeed <= 0 ? tr(lang, "There is no approved BUY/ADD use of capital in this package.", "รอบนี้ไม่มี BUY/ADD ที่ต้องใช้เงินใหม่") : noSaleRequired ? tr(lang, "Excess Cash Buffer fully covers the approved BUY/ADD plan. Do not sell holdings just to raise cash.", "Cash Buffer ส่วนเกินเพียงพอ ไม่ต้องขายหุ้นเพื่อหาเงิน") : tr(lang, "Use only approved TRIM/realized SELL proceeds for the residual gap; protect the Cash Floor.", "ใช้ TRIM ที่อนุมัติหรือเงินจาก SELL จริงเฉพาะส่วนที่ขาด โดยรักษา Cash Floor")}</p></div>
    <div className={styles.capitalGrid}>
      <article><span className={styles.label}>SOURCES</span>{meeting.capitalPlan?.sourceLines?.length ? meeting.capitalPlan.sourceLines.map(row => <p key={row.label}><span>{row.label}</span><strong>{usd(row.amountUsd)}</strong></p>) : <p><span>Deployable cash</span><strong>{usd(capital?.deployableCash)}</strong></p>}</article>
      <article><span className={styles.label}>DESTINATIONS</span>{meeting.capitalPlan?.useLines?.length ? meeting.capitalPlan.useLines.map(row => <p key={row.label}><span>{row.label}</span><strong>{usd(row.amountUsd)}</strong></p>) : <p><span>No destination</span><strong>BUFFER</strong></p>}</article>
    </div>
    <div className={styles.capitalFooter}><span>Cash after plan <strong>{pct(meeting.capitalPlan?.cashAfterPct)}</strong></span><span>Unallocated <strong>{usd(meeting.capitalPlan?.unallocatedUsd)}</strong></span><span>Status <strong>{meeting.capitalPlan?.allocationStatus ?? "—"}</strong></span></div>
    <details className={styles.details}><summary>{tr(lang, "Capital policy details", "รายละเอียดนโยบายเงินทุน")}</summary><div className={styles.detailBody}><p>{meeting.capitalPlan?.note}</p><p>Cash Floor repair: {usd(capital?.shortfallValue)} · Verified: {capital?.verified ? "YES" : "NO"}</p>{meeting.capitalPlan?.cutForFunding?.map(row => <p key={row.ticker}>{row.ticker} · {usd(row.requestedUsd)} · {row.reason}</p>)}</div></details>
  </div>;
}

function DecisionStep({ lang, meeting, actionMotions, approvalMotions, planApprovalReady, approvalBlockReason, executionAuthorized, onApproved, onNewMeeting }: { lang: AppLang; meeting: Meeting; actionMotions: Motion[]; approvalMotions: ApprovalMotion[]; planApprovalReady: boolean; approvalBlockReason?: string; executionAuthorized: boolean; onApproved: () => void; onNewMeeting: () => void }) {
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>05 · CIO</span><h2>{tr(lang, "Decision Package", "ชุดอนุมัติสุดท้าย")}</h2><p>{tr(lang, "This is the only primary approval surface. Approval records authority; it never sends a broker order automatically.", "นี่คือจุดอนุมัติหลักจุดเดียว การอนุมัติบันทึกอำนาจเท่านั้น ไม่ส่งคำสั่งโบรกเกอร์อัตโนมัติ")}</p></div><button className="btn ghost" onClick={onNewMeeting}>↻ {tr(lang, "New meeting", "ประชุมใหม่")}</button></div>
    <div className={styles.decisionSummary}>
      <div><span>INV</span><strong>{meeting.proposals?.length ?? 0} candidates</strong></div><div><span>AM</span><strong>{actionMotions.length} actions</strong></div><div><span>RISK</span><strong>{meeting.riskRegister?.filter(row => row.severity === "high").length ? "BLOCKED" : "PASS"}</strong></div><div><span>CIO</span><strong>{planApprovalReady ? "READY" : "WAIT"}</strong></div>
    </div>
    <div className={styles.finalPlan}>{actionMotions.length ? actionMotions.map(row => <div key={row.id}><span className={`${styles.actionChip} ${actionTone(row.kind)}`}>{row.kind}</span><strong>{row.ticker}</strong><span>{usd(Math.abs(row.sizeUsd))}</span><small>≈ {row.approxShares ?? "—"} shares</small></div>) : <div className={styles.noAction}>NO ACTION · HOLD CAPITAL / PORTFOLIO</div>}</div>
    <MeetingPlanApprovalPanel lang={lang} meetingId={meeting.meetingId} motions={approvalMotions} approvalReady={planApprovalReady} approvalBlockReason={approvalBlockReason} meeting={meeting as unknown as Record<string, unknown>} onApproved={onApproved} />
    {executionAuthorized && <section className={styles.postApproval}><span className={styles.label}>POST-APPROVAL · EXECUTION CONTROL</span><h3>{tr(lang, "Trade Blotter", "รายการสำหรับดำเนินการ")}</h3><p>{tr(lang, "Execute manually at the broker. Sentinel does not auto-trade. Update Holdings after fills, then reconcile below.", "ดำเนินการเองที่โบรกเกอร์ Sentinel ไม่ Auto Trade หลัง fill ให้อัปเดต Holdings แล้วกระทบยอดด้านล่าง")}</p><div className={styles.blotter}>{meeting.blotter?.map((row, index) => <div key={`${row.ticker}-${index}`}><span className={row.side === "BUY" ? styles.positive : styles.risk}>{row.side}</span><strong>{row.ticker}</strong><span>{usd(row.approxUsd)}</span><span>≈ {row.approxShares ?? "—"} sh</span><small>@ {usd(row.referencePrice, 2)}</small></div>)}</div><details className={styles.reconcile}><summary>{tr(lang, "After fills: reconciliation & minutes", "หลังซื้อขายจริง: กระทบยอดและปิดรายงาน")}</summary><MeetingApprovalPanel lang={lang} meetingId={meeting.meetingId} meeting={meeting as unknown as Record<string, unknown>} motions={approvalMotions} approvalReady={true} onApplied={onNewMeeting} /></details></section>}
    <details className={styles.details}><summary>{tr(lang, "Governance, risk register & committee evidence", "Governance, Risk Register และหลักฐาน Committee")}</summary><div className={styles.detailBody}>{meeting.riskRegister?.map((row, i) => <p key={`${row.raisedBy}-${i}`}><b>{row.severity.toUpperCase()} · {row.raisedBy}</b> — {row.item} · {row.suggestedAction}</p>)}{meeting.resolutions?.map(row => <p key={row.id}><b>{row.status}</b> · {row.text}</p>)}{meeting.deskReports?.slice(0, 10).map(row => <p key={`${row.member}-${row.desk}`}><b>{row.member} · {row.desk}</b> — {row.finding}</p>)}</div></details>
  </div>;
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: "good" | "risk" | "normal" }) {
  return <article className={`${styles.kpi} ${tone === "good" ? styles.kpiGood : tone === "risk" ? styles.kpiRisk : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function Metric({ label, value, good, toneClass }: { label: string; value: string; good?: boolean; toneClass?: string }) {
  return <div className={styles.metric}><span>{label}</span><strong className={toneClass ?? (good ? styles.positive : "")}>{value}</strong></div>;
}
