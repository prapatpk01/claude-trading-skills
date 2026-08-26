"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppLang } from "../page";
import MeetingPlanApprovalPanel from "./MeetingPlanApprovalPanel";
import MeetingApprovalPanel, { type ApprovalMotion } from "./MeetingApprovalPanel";
import styles from "./CIOCommandCenterV35.module.css";

type StepId = "status" | "opportunities" | "portfolio" | "capital" | "decision";
type MotionKind = "ADD" | "HOLD" | "TRIM" | "EXIT" | "NEW BUY" | "RAISE CASH";
type Outcome = "CARRIED" | "FAILED" | "DEFERRED";
type DecisionGate = { stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO"; owner: string; title: string; status: "PASS" | "DEFER" | "VETO"; rationale: string };
type Motion = {
  id: string; ticker: string; kind: MotionKind; sizeUsd: number; approxShares: number | null;
  evidenceCoveragePct: number; missingEvidence: string[]; decisionGates: DecisionGate[];
  outcome: Outcome; outcomeReason: string; veto: { member: string; reason: string } | null;
};
type Proposal = {
  ticker: string; setupType: string; score: number; coveragePct: number; price: number;
  entryLow: number; entryHigh: number; stop: number; target: number; riskReward: number;
  expectedReturnPct: number; thesis: string; catalyst: string; unmeasured: string[];
};
type DestinationLine = {
  category: "CASH_RESERVE" | "NEW_INVESTMENT" | "ADD_HOLDING" | "TEMPORARY_PARKING";
  label: string; amountUsd: number; owner: string; reviewBy: string | null;
};
type FastScanSummary = {
  provider?: string;
  requested: number;
  scanned: number;
  failed?: number;
  coveragePct: number;
  minimumCoveragePct?: number;
  coverageReady?: boolean;
  asOf?: string;
  fallbackUsed?: boolean;
};
type ResearchOSSummary = {
  universeSize: number;
  analyzed: number;
  rejected: number;
  models: string[];
  methodology: string | null;
  fastScan?: FastScanSummary | null;
  screenedUniverseSize?: number;
  screenRequestedSize?: number;
  screenCoveragePct?: number;
  minimumScreenCoveragePct?: number;
  screenCoverageReady?: boolean;
  deepResearchSize?: number;
};
type Meeting = {
  meetingId: string; asOf: string; nav: number;
  cashBuffer?: { valueUsd: number; pct: number | null; targetPct: number | null; reserveHoldings?: { ticker?: string; marketValue?: number }[] };
  quorum: { present: number; required: number; met: boolean; note: string };
  regime: { score: number; regime: string; icon: string; cashMinPct: number; deployRule: string; note: string } | null;
  proposals?: Proposal[];
  scan?: {
    status: "QUALIFIED" | "NO_BUY" | "DATA_BLOCKED"; asOf: string; universeSize: number; rejected: number;
    screenedUniverseSize?: number; screenRequestedSize?: number; screenCoveragePct?: number; minimumScreenCoveragePct?: number; deepResearchSize?: number;
    warnings: string[]; note: string;
    stages: { stage: string; owner: string; analyzed: number; passed: number; rejected: number; note: string }[];
    nearMisses: { ticker: string; engine: string; gate: string; reason: string; score: number | null }[];
    researchOS?: ResearchOSSummary;
  };
  motions: Motion[];
  capitalPlan: {
    sourcesUsd: number; deployableSourcesUsd: number; sourceLines: { label: string; amountUsd: number }[];
    usesUsd: number; useLines: { label: string; amountUsd: number }[]; destinationLines?: DestinationLine[];
    balanceUsd: number; funded: boolean; cutForFunding: { ticker: string; requestedUsd: number; reason: string }[];
    cashAfterPct: number | null; earmarkedForCashUsd: number; temporaryParkingUsd: number; unallocatedUsd: number;
    allocationComplete: boolean; approvalReady: boolean; allocationStatus: "READY" | "INCOMPLETE"; note: string;
  };
  blotter: { side: "BUY" | "SELL"; ticker: string; approxShares: number | null; approxUsd: number; referencePrice: number | null; reason: string }[];
  resolutions: { id: string; text: string; owner: string; reviewBy: string; status: "APPROVED" | "DEFERRED" | "REJECTED" }[];
  deskReports: { member: string; role: string; desk: string; headline: string | null; finding: string; gaps: string[] }[];
  riskRegister: { raisedBy: string; role: string; severity: "high" | "medium" | "low"; item: string; evidence: string; suggestedAction: string }[];
  minutes: string[]; disclosures: string[];
  portfolioSnapshot?: { id: string; asOf: string; portfolioRevision: string; holdingsRevision: string; cashRevision: string; holdingsConsistent: boolean; cashFreshness: string } | null;
  sources?: { navFrom: string; priced: number; positions: number; snapshotId?: string | null; snapshotAsOf?: string | null };
};
type ReserveHolding = { ticker?: string; marketValue?: number; liquidityValue?: number; tier?: string; label?: string };
type CapitalSnapshot = {
  totalNav: number | null; currentBufferUsd: number | null; currentBufferPct: number | null; cashFloorPct: number | null;
  targetPct?: number | null; targetValue: number | null; shortfallValue: number | null; deployableCash: number | null;
  brokerUsdCash?: number | null; dividendCash?: number | null; liquidCash?: number | null; reserveMarketValue?: number | null;
  reserveHoldings?: ReserveHolding[]; totalReserveAssets?: number | null;
  posture: string; action: string; verified: boolean;
};
type MarketItem = { price?: number | null; momentumForecast?: any; technicalOverlay?: any };
type LoadPack = { meeting: Meeting; capital: CapitalSnapshot | null; market: Record<string, MarketItem> };
type MarketBrief = {
  stance: string; breadth: string; momentum: string; regime: string; narrative: string; evidence: string;
};

const FROZEN_KEY = "sentinel:cio:frozen-meeting:v35";
const PLAN_KEY = (meetingId: string) => `sentinel:cio:plan-approval:${meetingId}`;
const MARKET_BENCHMARKS = ["SPY", "QQQ", "IWM", "HYG"] as const;
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
  const response = await fetch(`/api/committee/meeting?v352=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? `Committee meeting failed (${response.status})`);
  return payload as Meeting;
}
async function loadIdentity() {
  const response = await fetch(`/api/portfolio/cash-buffer?v352identity=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Portfolio identity unavailable");
  return { snapshotId: payload?.snapshotId ?? null };
}
async function loadCapital(): Promise<CapitalSnapshot | null> {
  try {
    const response = await fetch(`/api/capital-recycling?v352=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const payload = await response.json().catch(() => ({}));
    return response.ok ? payload as CapitalSnapshot : null;
  } catch { return null; }
}
async function marketBatch(tickers: string[]) {
  const items: Record<string, MarketItem> = {};
  for (let index = 0; index < tickers.length; index += 25) {
    const chunk = tickers.slice(index, index + 25);
    if (!chunk.length) continue;
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&v352=${Date.now()}`, { cache: "no-store" });
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
function motionTitle(row: Motion) {
  if (row.kind === "NEW BUY" && row.outcome !== "CARRIED") return "BUY CANDIDATE";
  if (row.kind === "NEW BUY") return "APPROVED BUY";
  if (row.kind === "RAISE CASH" && row.outcome !== "CARRIED") return "LIQUIDITY REPAIR CANDIDATE";
  return row.kind;
}
function benchmarkTrend(item: MarketItem | undefined) {
  const label = clean(item?.technicalOverlay?.decision?.trendLabel ?? item?.technicalOverlay?.sentinel?.coreState);
  if (label.includes("BULL")) return 1;
  if (label.includes("BEAR")) return -1;
  return 0;
}
function buildMarketBrief(lang: AppLang, meeting: Meeting, capital: CapitalSnapshot | null, market: Record<string, MarketItem>, proposals: Proposal[], highRisks: Meeting["riskRegister"]): MarketBrief {
  const reads = MARKET_BENCHMARKS.map(ticker => ({ ticker, item: market[ticker] })).filter(row => row.item?.price != null || row.item?.technicalOverlay || row.item?.momentumForecast);
  const bullCount = reads.filter(row => benchmarkTrend(row.item) > 0).length;
  const bearCount = reads.filter(row => benchmarkTrend(row.item) < 0).length;
  const forecastReads = reads.map(row => row.item?.momentumForecast?.expectedReturnPct).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  const avgForecast = forecastReads.length ? forecastReads.reduce((sum, value) => sum + value, 0) / forecastReads.length : null;
  const enoughMarketData = reads.length >= 3 && meeting.regime != null;
  const breadth = !enoughMarketData ? "DATA LIMITED" : bullCount >= 3 ? "BROAD POSITIVE" : bullCount >= 2 ? "MIXED POSITIVE" : bearCount >= 3 ? "DEFENSIVE" : "MIXED";
  const momentum = avgForecast == null ? (bullCount >= 2 ? "POSITIVE" : "UNCONFIRMED") : avgForecast >= 3 ? "POSITIVE" : avgForecast > 0 ? "MIXED POSITIVE" : avgForecast <= -2 ? "WEAK" : "MIXED";
  const regimeLabel = meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime} ${meeting.regime.score}/100` : "DATA UNAVAILABLE";
  const bufferPct = capital?.currentBufferPct ?? meeting.cashBuffer?.pct ?? null;
  const floorPct = capital?.cashFloorPct ?? meeting.cashBuffer?.targetPct ?? meeting.regime?.cashMinPct ?? null;
  const liquidityRepair = bufferPct != null && floorPct != null && bufferPct + 0.05 < floorPct;
  const score = meeting.regime?.score ?? null;
  const stance = !enoughMarketData ? "DATA LIMITED" : score != null && (score <= 45 || bearCount >= 3) ? "DEFENSIVE" : score != null && score >= 70 && bullCount >= 2 ? "SELECTIVE RISK-ON" : score != null && score >= 58 ? "SELECTIVE" : "BALANCED / WAIT";
  const opportunityText = meeting.scan?.status === "DATA_BLOCKED"
    ? tr(lang, "Research is data-blocked, so no new-risk conclusion is allowed.", "Research มีข้อมูลไม่พอ จึงยังไม่อนุญาตให้สรุปเพื่อเพิ่มความเสี่ยงใหม่")
    : proposals.length
      ? tr(lang, `${proposals.length} research candidate(s) are live, but funding still depends on technical, risk and capital gates.`, `มี Research Candidate ${proposals.length} ตัว แต่การใช้เงินจริงยังต้องผ่าน Technical, Risk และ Capital gate`)
      : tr(lang, "INV has no decision-ready opportunity worth new capital yet.", "INV ยังไม่มีโอกาสที่คุ้มกับการใช้เงินใหม่ในรอบนี้");
  const liquidityText = liquidityRepair
    ? tr(lang, `The fund is below its ${floorPct?.toFixed(1)}% liquidity floor, so buffer repair takes priority over new risk.`, `Liquidity Buffer ต่ำกว่า floor ${floorPct?.toFixed(1)}% จึงต้องซ่อม Buffer ก่อนเพิ่มความเสี่ยงใหม่`)
    : tr(lang, "Liquidity is inside policy; only deployable excess may fund new risk.", "สภาพคล่องอยู่ในกรอบนโยบาย เงินลงทุนใหม่ใช้ได้เฉพาะส่วนเกินที่ Deployable เท่านั้น");
  const marketText = !enoughMarketData
    ? tr(lang, `Only ${reads.length}/4 benchmark reads are measurable. Keep the market stance provisional until SPY/QQQ/IWM/HYG evidence is complete.`, `อ่าน Benchmark ได้เพียง ${reads.length}/4 ตัว จึงให้ Market Stance เป็นแบบชั่วคราวจน SPY/QQQ/IWM/HYG ครบ`)
    : tr(lang,
      `The market regime is ${meeting.regime?.regime} at ${meeting.regime?.score}/100. Breadth is ${breadth.toLowerCase()} across SPY, QQQ, IWM and HYG, while cross-benchmark momentum is ${momentum.toLowerCase()}.`,
      `ตลาดอยู่ในสภาวะ ${meeting.regime?.regime} ที่ ${meeting.regime?.score}/100 โดย Breadth ของ SPY, QQQ, IWM และ HYG อยู่ในภาวะ ${breadth} และ Momentum รวมเป็น ${momentum}`);
  const riskText = highRisks.length
    ? tr(lang, `${highRisks.length} high-severity portfolio risk item(s) remain open; they override an otherwise favorable market tape for execution.`, `ยังมี High-severity portfolio risk ${highRisks.length} รายการ จึงมีสิทธิ์บล็อกการดำเนินการแม้ภาพตลาดจะเป็นบวก`)
    : tr(lang, "No high-severity portfolio risk is currently overriding the market stance.", "ขณะนี้ไม่มี High-severity portfolio risk มาหักล้าง Market Stance");
  const research = meeting.scan?.researchOS;
  const fast = research?.fastScan;
  const screened = fast?.scanned ?? research?.screenedUniverseSize ?? meeting.scan?.screenedUniverseSize ?? 0;
  const requested = fast?.requested ?? research?.screenRequestedSize ?? meeting.scan?.screenRequestedSize ?? research?.universeSize ?? 0;
  const coverage = fast?.coveragePct ?? research?.screenCoveragePct ?? meeting.scan?.screenCoveragePct ?? null;
  return {
    stance,
    breadth,
    momentum,
    regime: regimeLabel,
    narrative: `${marketText} ${liquidityText} ${opportunityText} ${riskText}`,
    evidence: `As of ${meeting.asOf} · Benchmarks ${reads.length}/4 · Data Health ${meeting.sources?.priced ?? 0}/${meeting.sources?.positions ?? 0} · Research ${meeting.scan?.status ?? "—"} · Screen ${screened}/${requested}${coverage == null ? "" : ` (${coverage.toFixed(1)}%)`}`,
  };
}

export default function CIOCommandCenterV351({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
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
        ...MARKET_BENCHMARKS,
        ...(meeting.proposals ?? []).map(row => clean(row.ticker)),
        ...(meeting.motions ?? []).map(row => clean(row.ticker)),
      ].filter(Boolean)));
      const market = await marketBatch(tickers);
      setPack({ meeting, capital, market }); setFrozen(false);
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

  const freeze = () => { if (pack) { window.localStorage.setItem(FROZEN_KEY, JSON.stringify(pack)); setFrozen(true); } };
  const newMeeting = () => { window.localStorage.removeItem(FROZEN_KEY); setFrozen(false); setExecutionAuthorized(false); setStep("status"); setRefreshKey(value => value + 1); };

  if (loading && !pack) return <section className="card"><span className="spinner" /> {tr(lang, "Building the CIO decision package…", "กำลังจัดทำชุดตัดสินใจ CIO…")}</section>;
  if (error || !pack) return <section className="card"><span className="tag">CIO V35.2</span><h2>{tr(lang, "Command package unavailable", "ยังสร้างชุด Command ไม่ได้")}</h2><div className="err">⚠ {error}</div><button className="btn" onClick={() => setRefreshKey(value => value + 1)}>↻ Retry</button></section>;

  const { meeting, capital, market } = pack;
  const proposals = [...(meeting.proposals ?? [])].sort((a, b) => b.score - a.score || b.expectedReturnPct - a.expectedReturnPct);
  const motions = [...(meeting.motions ?? [])];
  const actionMotions = motions.filter(carriedAction);
  const deferredBuys = motions.filter(row => row.kind === "NEW BUY" && row.outcome !== "CARRIED");
  const blockedMotions = motions.filter(row => row.outcome === "DEFERRED" || row.veto);
  const highRisks = (meeting.riskRegister ?? []).filter(row => row.severity === "high");
  const marketBrief = buildMarketBrief(lang, meeting, capital, market, proposals, highRisks);
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

  return <section className={styles.shell} data-cio-version="35.2" data-research-scan-version="32.1" data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION">
    <header className={styles.hero}>
      <div>
        <span className={styles.eyebrow}>SENTINEL INVESTMENT OS · CIO MARKET BRIEF · V35.2</span>
        <h1>{tr(lang, "Executive Market Brief", "บทวิเคราะห์สภาวะตลาด")} · {marketBrief.stance}</h1>
        <p>{marketBrief.narrative}</p>
        <div className={styles.capitalFooter}>
          <span>REGIME <strong>{marketBrief.regime}</strong></span>
          <span>BREADTH <strong>{marketBrief.breadth}</strong></span>
          <span>MOMENTUM <strong>{marketBrief.momentum}</strong></span>
          <span>CIO STANCE <strong>{marketBrief.stance}</strong></span>
        </div>
        <small className={styles.neutral}>{marketBrief.evidence}</small>
      </div>
      <div className={styles.heroActions}>
        <span className={`${styles.liveBadge} ${frozen ? styles.audit : ""}`}>{frozen ? "AUDIT SNAPSHOT" : "LIVE PACKAGE"}</span>
        <button className="btn ghost sm" type="button" onClick={frozen ? newMeeting : freeze}>{frozen ? "↻ New meeting" : "▣ Freeze audit"}</button>
      </div>
    </header>
    <div className={styles.pipelineBar}><strong>CAPITAL CLARITY</strong><span>{tr(lang, "Capital Governance · every dollar requires source → destination → approval", "Capital Governance · ทุกดอลลาร์ต้องมี source → destination → approval")}</span><span>{tr(lang, "No automatic execution", "ไม่มีการดำเนินการอัตโนมัติ")}</span></div>
    <nav className={styles.stepper} aria-label="CIO decision workflow">{STEPS.map((row, index) => <button key={row.id} className={`${styles.step} ${step === row.id ? styles.active : ""} ${index < currentStepIndex ? styles.done : ""}`} onClick={() => setStep(row.id)}><span>{row.n}</span><div><strong>{tr(lang, row.en, row.th)}</strong><small>{row.owner}</small></div></button>)}</nav>
    {step === "status" && <StatusStep lang={lang} meeting={meeting} capital={capital} actionCount={actionMotions.length} blockerCount={blockedMotions.length} highRiskCount={highRisks.length} onNext={() => setStep("opportunities")} />}
    {step === "opportunities" && <OpportunityStep lang={lang} meeting={meeting} proposals={proposals} market={market} onNavigate={onNavigate} onNext={() => setStep("portfolio")} />}
    {step === "portfolio" && <PortfolioStep lang={lang} motions={motions} market={market} onNavigate={onNavigate} onNext={() => setStep("capital")} />}
    {step === "capital" && <CapitalStep lang={lang} meeting={meeting} capital={capital} buyNeed={buyNeed} cashExcess={cashExcess} saleGap={saleGap} noSaleRequired={noSaleRequired} deferredBuys={deferredBuys} onNext={() => setStep("decision")} />}
    {step === "decision" && <DecisionStep lang={lang} meeting={meeting} actionMotions={actionMotions} deferredBuys={deferredBuys} approvalMotions={approvalMotions} planApprovalReady={planApprovalReady} approvalBlockReason={approvalBlockReason} executionAuthorized={executionAuthorized} onApproved={() => setExecutionAuthorized(true)} onNewMeeting={newMeeting} />}
  </section>;
}

function StatusStep({ lang, meeting, capital, actionCount, blockerCount, highRiskCount, onNext }: { lang: AppLang; meeting: Meeting; capital: CapitalSnapshot | null; actionCount: number; blockerCount: number; highRiskCount: number; onNext: () => void }) {
  const bufferPct = capital?.currentBufferPct ?? meeting.cashBuffer?.pct ?? null;
  const targetPct = capital?.cashFloorPct ?? meeting.cashBuffer?.targetPct ?? meeting.regime?.cashMinPct ?? null;
  const priced = meeting.sources?.priced ?? 0, positions = meeting.sources?.positions ?? 0;
  const reserves = capital?.reserveHoldings ?? [];
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>01 · CIO</span><h2>{tr(lang, "Fund Status", "สถานะกองทุน")}</h2><p>{tr(lang, "Liquidity is decomposed into cash and approved reserve instruments.", "แยกสภาพคล่องเป็นเงินสดและ Reserve ที่อนุมัติแล้ว")}</p></div><button className="btn" onClick={onNext}>{tr(lang, "Review opportunities →", "ดูโอกาสลงทุน →")}</button></div>
    <div className={styles.kpiGrid}>
      <Kpi label="NAV" value={usd(meeting.nav)} note={meeting.portfolioSnapshot?.holdingsConsistent === false ? "LEDGER CHECK" : "authoritative ledger"} tone="normal" />
      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={`${meeting.regime?.icon ?? "●"} ${meeting.regime?.regime ?? "UNAVAILABLE"}`} note={meeting.regime ? `${meeting.regime.score}/100` : "data unavailable"} tone={meeting.regime && meeting.regime.score >= 60 ? "good" : "normal"} />
      <Kpi label="TOTAL LIQUIDITY BUFFER" value={usd(capital?.currentBufferUsd ?? meeting.cashBuffer?.valueUsd)} note={`${pct(bufferPct)} · target ${pct(targetPct)}`} tone={safe(bufferPct) >= safe(targetPct) ? "good" : "risk"} />
      <Kpi label="BROKER USD CASH" value={usd(capital?.brokerUsdCash)} note={tr(lang, "Uninvested broker cash", "เงินสด USD ที่ยังไม่ได้ลงทุน")} tone="normal" />
      <Kpi label="DIVIDEND CASH" value={usd(capital?.dividendCash)} note={tr(lang, "Net dividend cash available", "เงินปันผลสุทธิที่ยังใช้ได้")} tone="normal" />
      <Kpi label="RESERVE ASSETS" value={usd(capital?.reserveMarketValue)} note={reserves.length ? reserves.map(row => row.ticker).filter(Boolean).join(" / ") : "SGOV / JAAA / approved reserves"} tone="normal" />
      <Kpi label={tr(lang, "Deployable excess", "ส่วนเกินพร้อมลงทุน")} value={usd(capital?.deployableCash)} note={capital?.action ?? "cash-floor protected"} tone={safe(capital?.deployableCash) > 0 ? "good" : "normal"} />
      <Kpi label={tr(lang, "Pending actions", "รายการรอดำเนินการ")} value={String(actionCount)} note={`${blockerCount} blocked/deferred`} tone={blockerCount ? "risk" : "normal"} />
      <Kpi label="Data Health" value={positions ? `${priced}/${positions}` : "—"} note={positions && priced === positions ? "COMPLETE" : "CHECK SOURCE"} tone={positions && priced === positions ? "good" : "risk"} />
    </div>
    <div className={styles.briefGrid}><article><span className={styles.label}>BUFFER POLICY</span><strong>USD Cash + Dividend Cash + Approved Reserves</strong><p>{tr(lang, "Selling SGOV into USD changes the form of liquidity; it does not increase the total buffer.", "ขาย SGOV เป็น USD เป็นเพียงเปลี่ยนรูปสภาพคล่อง ไม่ได้เพิ่มขนาด Buffer")}</p></article><article><span className={styles.label}>GOVERNANCE</span><strong>{meeting.quorum.met ? "READY" : "BLOCKED"} · {meeting.quorum.present}/{meeting.quorum.required}</strong><p>{highRiskCount ? `${highRiskCount} high-severity risk item(s) require resolution.` : meeting.quorum.note}</p></article></div>
    <details className={styles.details}><summary>{tr(lang, "Reserve composition & diagnostics", "องค์ประกอบ Reserve และ Diagnostics")}</summary><div className={styles.detailBody}>{reserves.map((row, index) => <p key={`${row.ticker}-${index}`}><b>{row.ticker}</b> · {usd(row.marketValue)} · {row.label ?? row.tier ?? "approved reserve"}</p>)}<p>Meeting: {meeting.meetingId} · Snapshot: {meeting.portfolioSnapshot?.id ?? "—"}</p></div></details>
  </div>;
}

function OpportunityStep({ lang, meeting, proposals, market, onNavigate, onNext }: { lang: AppLang; meeting: Meeting; proposals: Proposal[]; market: Record<string, MarketItem>; onNavigate: (id: string) => void; onNext: () => void }) {
  const research = meeting.scan?.researchOS;
  const fast = research?.fastScan;
  const universe = research?.universeSize ?? meeting.scan?.universeSize ?? 0;
  const screened = fast?.scanned ?? research?.screenedUniverseSize ?? meeting.scan?.screenedUniverseSize ?? 0;
  const requested = fast?.requested ?? research?.screenRequestedSize ?? meeting.scan?.screenRequestedSize ?? universe;
  const coverage = fast?.coveragePct ?? research?.screenCoveragePct ?? meeting.scan?.screenCoveragePct ?? null;
  const minimumCoverage = fast?.minimumCoveragePct ?? research?.minimumScreenCoveragePct ?? meeting.scan?.minimumScreenCoveragePct ?? 80;
  const deepResearch = research?.deepResearchSize ?? meeting.scan?.deepResearchSize ?? research?.analyzed ?? 0;
  const dataBlocked = meeting.scan?.status === "DATA_BLOCKED";
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>02 · INV</span><h2>{tr(lang, "Investment Opportunities", "โอกาสลงทุน")}</h2><p>{tr(lang, "Research candidates are not funded orders. Approval state is shown in the portfolio queue.", "Candidate จาก Research ยังไม่ใช่คำสั่งซื้อ สถานะอนุมัติดูต่อใน Portfolio Queue")}</p></div><div className={styles.headButtons}><button className="btn ghost" onClick={() => onNavigate("research")}>{tr(lang, "Open Research", "เปิด Research")}</button><button className="btn" onClick={onNext}>{tr(lang, "Portfolio actions →", "จัดการพอร์ต →")}</button></div></div>
    <div className={styles.pipelineBar}><strong>{meeting.scan?.status ?? (proposals.length ? "QUALIFIED" : "NO BUY")}</strong><span>{universe} universe</span><span>{screened}/{requested} screened</span><span>{coverage == null ? "coverage —" : `${coverage.toFixed(1)}% coverage`}</span><span>{deepResearch} deep research</span><span>{proposals.length} candidates</span></div>
    <div className={styles.capitalFooter}><span>STAGE A <strong>FULL-UNIVERSE FAST SCREEN</strong></span><span>STAGE B <strong>BOUNDED DEEP RESEARCH</strong></span><span>NO_BUY GATE <strong>≥ {minimumCoverage}% SCREEN COVERAGE</strong></span></div>
    {proposals.length ? <div className={styles.opportunityList}>{proposals.slice(0, 8).map((row, index) => { const item = market[clean(row.ticker)], forecast = item?.momentumForecast; const forecastReturn = forecast?.expectedReturnPct == null ? null : safe(forecast.expectedReturnPct); const confidence = forecast?.confidence == null ? null : safe(forecast.confidence); return <article key={row.ticker} className={styles.opportunityCard}><div className={styles.rank}>#{index + 1}</div><div className={styles.opMain}><div className={styles.opTitle}><strong>{row.ticker}</strong><span>RESEARCH CANDIDATE · NOT FUNDED</span></div><div className={styles.opMetrics}><Metric label="Research upside" value={pct(row.expectedReturnPct)} good={row.expectedReturnPct >= 12}/><Metric label="Forecast 20–60D" value={forecastReturn == null ? "—" : pct(forecastReturn)} good={forecastReturn != null && forecastReturn >= 6}/><Metric label="Confidence" value={confidence == null ? "—" : `${Math.round(confidence)}/100`} good={confidence != null && confidence >= 62}/><Metric label="R:R" value={`${row.riskReward.toFixed(1)}R`} good={row.riskReward >= 1.5}/></div><p>{row.thesis}</p><small>{row.catalyst}</small></div><details><summary>{tr(lang, "Evidence", "หลักฐาน")}</summary><div className={styles.detailBody}><p>Price {usd(item?.price ?? row.price, 2)} · Entry {usd(row.entryLow, 2)}–{usd(row.entryHigh, 2)} · Stop {usd(row.stop, 2)} · Target {usd(row.target, 2)}</p><p>Coverage {row.coveragePct}% · Score {row.score}/100 · Lifecycle {forecast?.lifecycleStage ?? "—"}</p></div></details></article>; })}</div> : <div className={styles.emptyState}><strong>{dataBlocked ? "SCAN INCOMPLETE · NO_BUY CONCLUSION BLOCKED" : "NO QUALIFIED BUY"}</strong><p>{meeting.scan?.note ?? tr(lang, "INV found no opportunity worth deploying new capital into yet.", "INV ยังไม่พบหุ้นที่คุ้มกับการใช้เงินใหม่")}</p></div>}
  </div>;
}

function PortfolioStep({ lang, motions, market, onNavigate, onNext }: { lang: AppLang; motions: Motion[]; market: Record<string, MarketItem>; onNavigate: (id: string) => void; onNext: () => void }) {
  const priority: Record<MotionKind, number> = { EXIT: 0, TRIM: 1, ADD: 2, "NEW BUY": 3, HOLD: 4, "RAISE CASH": 5 };
  const rows = [...motions].sort((a, b) => priority[a.kind] - priority[b.kind] || Math.abs(b.sizeUsd) - Math.abs(a.sizeUsd));
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>03 · AM</span><h2>{tr(lang, "Portfolio Action Queue", "คิวจัดการพอร์ต")}</h2><p>{tr(lang, "Committee action and V34 review are shown as separate approval layers.", "แยกมติ Committee ออกจาก Technical V34 Review ให้ชัด")}</p></div><div className={styles.headButtons}><button className="btn ghost" onClick={() => onNavigate("portfolio")}>{tr(lang, "Open Portfolio", "เปิด Portfolio")}</button><button className="btn" onClick={onNext}>{tr(lang, "Capital plan →", "แผนเงินทุน →")}</button></div></div>
    <div className={styles.actionList}>{rows.map(row => {
      const item = market[clean(row.ticker)], overlay = item?.technicalOverlay, decision = overlay?.decision, forecast = item?.momentumForecast;
      const technicalReview = decision?.action === "TRIM REVIEW" || decision?.action === "EXIT REVIEW" || decision?.action === "PROFIT WATCH";
      const approvedFunding = row.outcome === "CARRIED" && (row.kind === "NEW BUY" || row.kind === "ADD") ? Math.abs(row.sizeUsd) : 0;
      const displaySize = row.kind === "HOLD" ? "—" : row.outcome === "CARRIED" ? usd(Math.abs(row.sizeUsd)) : `Proposed ${usd(Math.abs(row.sizeUsd))}`;
      return <article key={row.id} className={styles.actionRow}>
        <div><span className={`${styles.actionChip} ${actionTone(row.kind)}`}>{motionTitle(row)}</span><strong>{row.ticker}</strong><small>{row.outcome}</small></div>
        <div className={styles.actionFacts}><Metric label="Current" value={usd(item?.price, 2)}/><Metric label={row.outcome === "CARRIED" ? "Approved Size" : "Proposed Size"} value={displaySize}/><Metric label="Approved Funding" value={usd(approvedFunding)} good={approvedFunding > 0}/><Metric label="Forecast" value={forecast?.expectedReturnPct == null ? "—" : pct(safe(forecast.expectedReturnPct))} good={safe(forecast?.expectedReturnPct) >= 6}/></div>
        <p>{row.kind === "NEW BUY" && row.outcome !== "CARRIED" ? `NOT FUNDED · WAIT FOR TRIGGER · ${row.outcomeReason}` : row.outcomeReason}</p>
        <div className={styles.capitalFooter}><span>V34 <strong className={decisionTone(decision?.action ?? "HOLD")}>{decision?.action ?? "—"}</strong></span>{technicalReview && row.kind === "HOLD" ? <span><strong>NOT APPROVED</strong> · Approved Trim Size —</span> : null}</div>
        <details><summary>{tr(lang, "Trend / Flow / Location / gates", "Trend / Flow / Location / gates")}</summary><div className={styles.detailBody}><p>Trend {decision?.trendLabel ?? overlay?.sentinel?.coreState ?? "—"} · Flow {decision?.flowLabel ?? overlay?.mcdx?.state ?? "—"} · Location {decision?.location ?? "—"}</p>{row.decisionGates?.map(gate => <p key={gate.stage}><b>{gate.stage}</b> · {gate.status} · {gate.rationale}</p>)}</div></details>
      </article>;
    })}</div>
  </div>;
}

function CapitalStep({ lang, meeting, capital, buyNeed, cashExcess, saleGap, noSaleRequired, deferredBuys, onNext }: { lang: AppLang; meeting: Meeting; capital: CapitalSnapshot | null; buyNeed: number; cashExcess: number; saleGap: number; noSaleRequired: boolean; deferredBuys: Motion[]; onNext: () => void }) {
  const trimNeeded = Math.min(saleGap, Math.max(0, safe(meeting.capitalPlan?.sourcesUsd) - cashExcess));
  const destinations = meeting.capitalPlan?.destinationLines ?? [];
  const liquidityDestinations = destinations.filter(row => row.category === "CASH_RESERVE" || row.category === "TEMPORARY_PARKING");
  const investmentDestinations = destinations.filter(row => row.category === "NEW_INVESTMENT" || row.category === "ADD_HOLDING");
  const liquiditySources = meeting.capitalPlan?.sourceLines?.filter(row => /cash floor|raise buffer|raise cash|proposed sell/i.test(row.label)) ?? [];
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>04 · AM / RISK</span><h2>{tr(lang, "Capital Plan", "แผนเงินทุน")}</h2><p>{tr(lang, "Two lanes: liquidity repair is ring-fenced; investment funding can use only deployable excess and approved proceeds.", "แยก 2 ทาง: เงินซ่อม Liquidity Buffer ถูกกันไว้ ส่วนเงินลงทุนใช้ได้เฉพาะส่วนเกินและ proceeds ที่อนุมัติแล้ว")}</p></div><button className="btn" onClick={onNext}>{tr(lang, "CIO decision →", "ไปอนุมัติ CIO →")}</button></div>
    <div className={styles.briefGrid}>
      <article><span className={styles.label}>LANE A · LIQUIDITY REPAIR</span><strong>{safe(meeting.capitalPlan?.earmarkedForCashUsd) > 0 ? usd(meeting.capitalPlan.earmarkedForCashUsd) : capital?.shortfallValue && capital.shortfallValue > 0 ? usd(capital.shortfallValue) : "NO REPAIR NEEDED"}</strong><p>{liquiditySources.length ? liquiditySources.map(row => `${row.label} → ${usd(row.amountUsd)}`).join(" · ") : tr(lang, "No approved liquidity-repair sale in this package.", "รอบนี้ยังไม่มีการขายเพื่อซ่อม Buffer ที่อนุมัติแล้ว")}</p><p><b>Destination:</b> {liquidityDestinations.length ? liquidityDestinations.map(row => `${row.label} ${usd(row.amountUsd)}`).join(" · ") : "Broker USD Cash (default parking)"}</p><p>{tr(lang, "SGOV/JAAA requires a separate approved BUY action; reserve conversion is never automatic.", "ถ้าจะซื้อ SGOV/JAAA ต้องมี BUY ที่อนุมัติแยกต่างหาก ระบบไม่แปลง Reserve อัตโนมัติ")}</p></article>
      <article><span className={styles.label}>LANE B · INVESTMENT FUNDING</span><strong>{buyNeed > 0 ? `APPROVED NEED ${usd(buyNeed)}` : "NO APPROVED BUY/ADD"}</strong><p>Cash Buffer Excess {usd(cashExcess)} → Approved TRIM {usd(trimNeeded)} → Executed SELL only</p><p>{investmentDestinations.length ? investmentDestinations.map(row => `${row.label} ${usd(row.amountUsd)}`).join(" · ") : deferredBuys.length ? `${deferredBuys.length} BUY candidate(s) remain NOT FUNDED.` : "No investment destination."}</p></article>
    </div>
    <div className={styles.waterfall}><div><span>1</span><p>Deployable Excess<strong>{usd(cashExcess)}</strong></p></div><i>→</i><div><span>2</span><p>Approved TRIM<strong>{usd(trimNeeded)}</strong></p></div><i>→</i><div><span>3</span><p>Executed SELL<strong>{usd(0)}</strong></p></div><i>→</i><div><span>4</span><p>Approved Investment Need<strong>{usd(buyNeed)}</strong></p></div></div>
    <div className={`${styles.fundingVerdict} ${noSaleRequired ? styles.ok : saleGap > 0 ? styles.warn : ""}`}><strong>{buyNeed <= 0 ? "NO NEW CAPITAL REQUIRED" : noSaleRequired ? "NO SALE REQUIRED" : `FUNDING GAP ${usd(saleGap)}`}</strong><p>{buyNeed <= 0 ? tr(lang, "Deferred BUY candidates do not create a funding need. Approved Funding remains $0 until every gate clears.", "BUY Candidate ที่ Deferred จะไม่สร้างความต้องการเงิน Approved Funding ยังคง $0 จนผ่านทุก gate") : noSaleRequired ? tr(lang, "Deployable excess fully covers the approved BUY/ADD plan. Do not sell holdings just to raise cash.", "เงินส่วนเกินเพียงพอกับ BUY/ADD ที่อนุมัติแล้ว ไม่ต้องขายหุ้นเพิ่ม") : tr(lang, "Use only approved trim or executed sell proceeds for the residual gap; never spend liquidity-repair proceeds on risk assets.", "ใช้เฉพาะ TRIM ที่อนุมัติหรือ SELL ที่เกิดจริงสำหรับส่วนขาด และห้ามใช้เงินซ่อม Buffer ไปซื้อสินทรัพย์เสี่ยง")}</p></div>
    <div className={styles.capitalGrid}><article><span className={styles.label}>SOURCES</span>{meeting.capitalPlan?.sourceLines?.length ? meeting.capitalPlan.sourceLines.map(row => <p key={row.label}><span>{row.label}</span><strong>{usd(row.amountUsd)}</strong></p>) : <p><span>Broker USD Cash / deployable excess</span><strong>{usd(capital?.deployableCash)}</strong></p>}</article><article><span className={styles.label}>DESTINATIONS · SOURCE OF TRUTH</span>{destinations.length ? destinations.map((row, index) => <p key={`${row.label}-${index}`}><span>{row.category} · {row.label}</span><strong>{usd(row.amountUsd)}</strong></p>) : <p><span>No approved destination</span><strong>—</strong></p>}</article></div>
    <div className={styles.capitalFooter}><span>Cash after plan <strong>{pct(meeting.capitalPlan?.cashAfterPct)}</strong></span><span>Unallocated <strong>{usd(meeting.capitalPlan?.unallocatedUsd)}</strong></span><span>Status <strong>{meeting.capitalPlan?.allocationStatus ?? "—"}</strong></span></div>
    <details className={styles.details}><summary>{tr(lang, "Capital policy details", "รายละเอียดนโยบายเงินทุน")}</summary><div className={styles.detailBody}><p>{meeting.capitalPlan?.note}</p><p>Cash Floor repair: {usd(capital?.shortfallValue)} · Verified: {capital?.verified ? "YES" : "NO"}</p></div></details>
  </div>;
}

function DecisionStep({ lang, meeting, actionMotions, deferredBuys, approvalMotions, planApprovalReady, approvalBlockReason, executionAuthorized, onApproved, onNewMeeting }: { lang: AppLang; meeting: Meeting; actionMotions: Motion[]; deferredBuys: Motion[]; approvalMotions: ApprovalMotion[]; planApprovalReady: boolean; approvalBlockReason?: string; executionAuthorized: boolean; onApproved: () => void; onNewMeeting: () => void }) {
  const liquidityActions = actionMotions.filter(row => row.kind === "RAISE CASH");
  return <div className={styles.content}>
    <div className={styles.sectionHead}><div><span>05 · CIO</span><h2>{tr(lang, "Decision Package", "ชุดอนุมัติสุดท้าย")}</h2><p>{tr(lang, "Only carried motions are executable proposals. Deferred candidates are shown separately with $0 approved funding.", "เฉพาะ CARRIED motion เท่านั้นที่เป็นรายการพร้อมขออนุมัติ Candidate ที่ Deferred แยกไว้และ Approved Funding = $0")}</p></div><button className="btn ghost" onClick={onNewMeeting}>↻ {tr(lang, "New meeting", "ประชุมใหม่")}</button></div>
    <div className={styles.decisionSummary}><div><span>INV</span><strong>{meeting.proposals?.length ?? 0} candidates</strong></div><div><span>AM</span><strong>{actionMotions.length} carried actions</strong></div><div><span>RISK</span><strong>{meeting.riskRegister?.filter(row => row.severity === "high").length ? "BLOCKED" : "PASS"}</strong></div><div><span>CIO</span><strong>{planApprovalReady ? "READY" : "WAIT"}</strong></div></div>
    {deferredBuys.length ? <div className={styles.fundingVerdict}><strong>BUY CANDIDATES · NOT FUNDED</strong><p>{deferredBuys.map(row => `${row.ticker} proposed ${usd(Math.abs(row.sizeUsd))} · Approved Funding $0`).join(" · ")}</p></div> : null}
    {liquidityActions.length ? <div className={styles.fundingVerdict}><strong>LIQUIDITY REPAIR</strong><p>{liquidityActions.map(row => `${row.ticker} ${usd(Math.abs(row.sizeUsd))} → Broker USD Cash / Cash Buffer repair`).join(" · ")}</p><p>SGOV/JAAA purchase requires a separate approved BUY action.</p></div> : null}
    <div className={styles.finalPlan}>{actionMotions.length ? actionMotions.map(row => <div key={row.id}><span className={`${styles.actionChip} ${actionTone(row.kind)}`}>{row.kind}</span><strong>{row.ticker}</strong><span>{usd(Math.abs(row.sizeUsd))}</span><small>≈ {row.approxShares ?? "—"} shares</small></div>) : <div className={styles.noAction}>NO ACTION · HOLD CAPITAL / PORTFOLIO</div>}</div>
    {!planApprovalReady ? <div className={`${styles.fundingVerdict} ${styles.warn}`}><strong>NO BROKER ACTION AUTHORIZED</strong><p>{approvalBlockReason ?? "Complete all governance gates before approval."}</p></div> : null}
    <MeetingPlanApprovalPanel lang={lang} meetingId={meeting.meetingId} motions={approvalMotions} approvalReady={planApprovalReady} approvalBlockReason={approvalBlockReason} meeting={meeting as unknown as Record<string, unknown>} onApproved={onApproved} />
    {executionAuthorized && <section className={styles.postApproval}><span className={styles.label}>POST-APPROVAL · EXECUTION CONTROL</span><h3>{tr(lang, "Trade Blotter", "รายการสำหรับดำเนินการ")}</h3><p>{tr(lang, "Execute manually at the broker. Sentinel does not auto-trade. Update Holdings after fills, then reconcile below.", "ดำเนินการเองที่โบรกเกอร์ Sentinel ไม่ Auto Trade หลัง fill ให้อัปเดต Holdings แล้วกระทบยอดด้านล่าง")}</p><div className={styles.blotter}>{meeting.blotter?.map((row, index) => <div key={`${row.ticker}-${index}`}><span className={row.side === "BUY" ? styles.positive : styles.risk}>{row.side}</span><strong>{row.ticker}</strong><span>{usd(row.approxUsd)}</span><span>≈ {row.approxShares ?? "—"} sh</span><small>@ {usd(row.referencePrice, 2)}</small></div>)}</div><details className={styles.reconcile}><summary>{tr(lang, "After fills: reconciliation & minutes", "หลังซื้อขายจริง: กระทบยอดและปิดรายงาน")}</summary><MeetingApprovalPanel lang={lang} meetingId={meeting.meetingId} meeting={meeting as unknown as Record<string, unknown>} motions={approvalMotions} approvalReady={true} onApplied={onNewMeeting} /></details></section>}
    <details className={styles.details}><summary>{tr(lang, "Governance, risk register & committee evidence", "Governance, Risk Register และหลักฐาน Committee")}</summary><div className={styles.detailBody}>{meeting.riskRegister?.map((row, i) => <p key={`${row.raisedBy}-${i}`}><b>{row.severity.toUpperCase()} · {row.raisedBy}</b> — {row.item} · {row.suggestedAction}</p>)}{meeting.resolutions?.map(row => <p key={row.id}><b>{row.status}</b> · {row.text}</p>)}</div></details>
  </div>;
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone: "good" | "risk" | "normal" }) {
  return <article className={`${styles.kpi} ${tone === "good" ? styles.kpiGood : tone === "risk" ? styles.kpiRisk : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function Metric({ label, value, good, toneClass }: { label: string; value: string; good?: boolean; toneClass?: string }) {
  return <div className={styles.metric}><span>{label}</span><strong className={toneClass ?? (good ? styles.positive : "")}>{value}</strong></div>;
}
