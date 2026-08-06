"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";
import MeetingApprovalPanel from "./MeetingApprovalPanel";
import styles from "./CIOCommandCenterV20.module.css";

type MotionKind = "ADD" | "HOLD" | "TRIM" | "EXIT" | "NEW BUY" | "RAISE CASH";
type Outcome = "CARRIED" | "FAILED" | "DEFERRED";
type View = "decisions" | "opportunities" | "teams" | "evidence" | "approval";

type DecisionGate = {
  stage: "INVESTMENT" | "ASSET_MANAGEMENT" | "RISK" | "CIO";
  owner: string;
  title: string;
  status: "PASS" | "DEFER" | "VETO";
  rationale: string;
};

type Motion = {
  id: string;
  ticker: string;
  kind: MotionKind;
  sizeUsd: number;
  approxShares: number | null;
  evidenceCoveragePct: number;
  missingEvidence: string[];
  decisionGates: DecisionGate[];
  tally: { for: number; against: number; abstain: number };
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

type DeskReport = {
  member: string;
  role: string;
  desk: string;
  headline: string | null;
  rows: { label: string; value: string; tone?: string; note?: string }[];
  finding: string;
  gaps: string[];
};

type Meeting = {
  meetingId: string;
  asOf: string;
  nav: number;
  quorum: { present: number; required: number; met: boolean; note: string };
  regime: { score: number; regime: string; icon: string; cashMinPct: number; deployRule: string; note: string } | null;
  stages?: { n: number; name: string; owner: string; ready: boolean; detail: string }[];
  proposals?: Proposal[];
  scan?: { universeSize: number; rejected: number; warnings: string[]; note: string };
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
    reviewOwner: string;
    reviewBy: string;
    destinationLines: {
      category: "CASH_RESERVE" | "NEW_INVESTMENT" | "ADD_HOLDING" | "TEMPORARY_PARKING";
      label: string;
      amountUsd: number;
      owner: string;
      reviewBy: string | null;
    }[];
    fallbackOptions: { ticker: string; action: "REVIEW ADD" | "KEEP RESERVE"; maxUsd: number; rationale: string }[];
    note: string;
  };
  blotter: { side: "BUY" | "SELL"; ticker: string; approxShares: number | null; approxUsd: number; referencePrice: number | null; reason: string }[];
  resolutions: { id: string; text: string; owner: string; reviewBy: string; status: "APPROVED" | "DEFERRED" | "REJECTED" }[];
  deskReports: DeskReport[];
  riskRegister: { raisedBy: string; role: string; severity: "high" | "medium" | "low"; item: string; evidence: string; suggestedAction: string }[];
  minutes: string[];
  disclosures: string[];
  sources?: { navFrom: string; priced: number; positions: number };
  sentiment?: { value: number; band: string } | null;
};

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const pct = (value: number | null | undefined) => value == null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
const priority: Record<MotionKind, number> = { "RAISE CASH": 0, EXIT: 1, TRIM: 2, "NEW BUY": 3, ADD: 4, HOLD: 5 };

const INVESTMENT_TEAM = [
  ["Sofia Reyes", "Head of Investment Research", "Signs the investment proposal and presents BUY / WATCH / REJECT"],
  ["Daniel Cho", "Macro & Market Strategy", "Regime, liquidity, sector rotation and risk envelope"],
  ["Marcus Webb", "Financial Modeling", "Revenue, margins, FCF and scenario forecasts"],
  ["Thomas Eriksson", "Valuation", "Fair-value range, DCF, multiples and margin of safety"],
  ["Aisha Fontaine", "Catalyst & Events", "Dated catalysts, event probability and invalidation"],
  ["Maya Chen", "Momentum & Structure", "Automatic scan, relative strength, volume and entry zone"],
  ["Priya Nair", "Quant Validation", "Expected return, factor exposure and robustness"],
  ["Leo Tanaka", "Live Intelligence", "Live price, news and decision-change alerts"],
] as const;

const ASSET_TEAM = [
  ["Lena Müller", "Head of Asset Management", "Signs sizing, funding and the before/after portfolio plan"],
  ["Kai Tanaka", "Portfolio Risk & Construction", "Position caps, concentration, correlation and stress loss"],
  ["Ryan Blackwood", "Execution & Trading Operations", "Liquidity, staging, limit prices, shares and slippage"],
  ["Nina Okonkwo", "Portfolio Data & Control", "Ledger, cash, holdings, cost basis and reconciliation"],
] as const;

const EXECUTIVE_TEAM = [
  ["Miriam Osei", "CRO / Executive Risk", "PASS, CONDITIONAL or VETO after both team presentations"],
  ["James Hartwell", "CIO / Executive Chair", "Final APPROVE, DEFER or REJECT resolution"],
] as const;

async function loadMeeting(): Promise<Meeting> {
  const response = await fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" } });
  const type = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (!type.includes("application/json")) throw new Error(`Committee returned ${response.status} ${type || "non-JSON response"}`);
  const payload = JSON.parse(text || "{}");
  if (!response.ok) throw new Error(payload?.error ?? `Committee meeting failed (${response.status})`);
  return payload as Meeting;
}

export default function CIOCommandCenterV20({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [view, setView] = useState<View>("decisions");
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    loadMeeting()
      .then((payload) => { if (active) setMeeting(payload); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Committee meeting unavailable"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  const motions = useMemo(() => [...(meeting?.motions ?? [])].sort((a, b) => priority[a.kind] - priority[b.kind] || Math.abs(b.sizeUsd) - Math.abs(a.sizeUsd)), [meeting]);
  const proposals = useMemo(() => [...(meeting?.proposals ?? [])].sort((a, b) => b.score - a.score), [meeting]);
  const carried = motions.filter((motion) => motion.outcome === "CARRIED");
  const actionLines = carried.filter((motion) => motion.sizeUsd !== 0);
  const blockers = motions.filter((motion) => motion.outcome === "DEFERRED" || motion.veto);
  const highRisks = meeting?.riskRegister.filter((risk) => risk.severity === "high") ?? [];

  if (loading && !meeting) return <section className="card"><span className="spinner" /> {tr(lang, "Running the fund meeting and scanning for new ideas…", "กำลังประชุมกองทุนและสแกนหาไอเดียใหม่…")}</section>;
  if (error || !meeting) return <section className="card"><span className="tag">CIO V20</span><h2>{tr(lang, "No decision package was produced", "ยังไม่สามารถสร้างชุดมติได้")}</h2><div className="err">⚠ {error}</div><button className="btn ghost" type="button" onClick={() => setRefreshKey((value) => value + 1)} style={{ marginTop: 12 }}>↻ {tr(lang, "Try again", "ลองใหม่")}</button></section>;

  const approvalMotions = meeting.motions
    .filter((motion) => motion.outcome === "CARRIED" && motion.sizeUsd !== 0)
    .map((motion) => ({
      id: motion.id,
      ticker: motion.ticker,
      kind: motion.kind,
      sizeUsd: motion.sizeUsd,
      approxShares: motion.approxShares,
      referencePrice: meeting.blotter.find((line) => line.ticker === motion.ticker)?.referencePrice ?? null,
      outcome: motion.outcome,
      outcomeReason: motion.outcomeReason,
    }));

  return <div className={`workspace-stack ${styles.command}`} data-cio-version="20.0" data-workspace="decision-execution-command-center" data-source-of-truth="committee-meeting">
    <section className={`card ${styles.hero}`}>
      <div>
        <span className="tag">SENTINEL CIO V20 · ONE FUND → ONE MEETING → ONE ACTION LIST</span>
        <h2 className="section">{tr(lang, "Decision & Execution Command Center", "ศูนย์ตัดสินใจและดำเนินการกองทุน")}</h2>
        <p className="muted">{tr(lang, "The desks work in the background. This screen shows what changed, what the fund should do, how it is funded and what still needs human approval.", "ทีมวิเคราะห์ทำงานอยู่เบื้องหลัง หน้านี้แสดงเฉพาะสิ่งที่เปลี่ยน สิ่งที่กองทุนควรทำ แหล่งเงินทุน และรายการที่รออนุมัติ")}</p>
      </div>
      <div className={styles.heroActions}>
        <span className={`tag ${meeting.quorum.met ? styles.good : styles.bad}`}>{meeting.quorum.met ? "QUORUM READY" : "QUORUM BLOCKED"}</span>
        <button className="btn ghost" type="button" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)}>↻ {loading ? tr(lang, "Running…", "กำลังประมวลผล…") : tr(lang, "Run new meeting", "ประชุมใหม่")}</button>
      </div>
    </section>

    <section className={styles.kpis}>
      <Kpi label={tr(lang, "Fund NAV", "มูลค่าพอร์ต")} value={money(meeting.nav)} note={meeting.sources?.navFrom ?? "portfolio ledger"} />
      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime}` : "UNAVAILABLE"} note={meeting.regime ? `${meeting.regime.score}/100 · cash floor ${meeting.regime.cashMinPct}%` : "No benchmark evidence"} />
      <Kpi label={tr(lang, "New ideas", "หุ้นใหม่ที่เสนอ")} value={String(proposals.length)} note={meeting.scan ? `${meeting.scan.universeSize} scanned · ${meeting.scan.rejected} rejected` : "Research scan unavailable"} />
      <Kpi label={tr(lang, "Actions awaiting approval", "รายการรออนุมัติ")} value={String(actionLines.length)} note={`${carried.length} carried · ${blockers.length} blocked/deferred`} />
      <Kpi label={tr(lang, "Capital allocation", "แผนจัดสรรเงิน")} value={meeting.capitalPlan.allocationStatus} note={meeting.capitalPlan.allocationComplete ? `${money(meeting.capitalPlan.temporaryParkingUsd)} temporary reserve` : `${money(meeting.capitalPlan.unallocatedUsd)} has no destination`} />
    </section>

    <section className={`card ${styles.stageCard}`}>
      <div className={styles.stageRail}>
        {(meeting.stages ?? []).map((stage) => <div className={styles.stage} key={stage.n}>
          <span className={stage.ready ? styles.stageReady : styles.stageWait}>{stage.ready ? "✓" : stage.n}</span>
          <div><strong>{stage.name}</strong><small>{stage.owner}</small><p>{stage.detail}</p></div>
        </div>)}
      </div>
    </section>

    <nav className={`card ${styles.views}`} aria-label="CIO decision views">
      {([
        ["decisions", tr(lang, `Decisions (${motions.length})`, `มติ (${motions.length})`)],
        ["opportunities", tr(lang, `New ideas (${proposals.length})`, `หุ้นใหม่ (${proposals.length})`)],
        ["teams", tr(lang, "Teams & authority", "ทีมและสิทธิ์ตัดสินใจ")],
        ["evidence", tr(lang, `Evidence & risk (${highRisks.length})`, `หลักฐานและความเสี่ยง (${highRisks.length})`)],
        ["approval", tr(lang, `Human approval (${actionLines.length})`, `อนุมัติโดยมนุษย์ (${actionLines.length})`)],
      ] as [View, string][]).map(([id, label]) => <button key={id} type="button" className={`btn ${view === id ? "" : "ghost"}`} onClick={() => setView(id)}>{label}</button>)}
    </nav>

    {view === "decisions" && <>
      <section className="card">
        <SectionTitle eyebrow="01 · CIO RESOLUTION" title={tr(lang, "One prioritized decision list", "รายการตัดสินใจเรียงตามความสำคัญ")} />
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tr(lang, "Priority", "ลำดับ")}</th><th>{tr(lang, "Action", "คำสั่ง")}</th><th>{tr(lang, "Size", "ขนาด")}</th><th>{tr(lang, "Evidence", "หลักฐาน")}</th><th>{tr(lang, "Authority gates", "ผู้มีอำนาจอนุมัติ")}</th><th>{tr(lang, "Status and reason", "สถานะและเหตุผล")}</th></tr></thead>
            <tbody>{motions.map((motion, index) => <tr key={motion.id}>
              <td><strong>{String(index + 1).padStart(2, "0")}</strong></td>
              <td><DecisionTag kind={motion.kind} /> <strong>{motion.ticker}</strong></td>
              <td>{motion.kind === "HOLD" ? "—" : money(motion.sizeUsd)}<small className="muted" style={{ display: "block" }}>{motion.approxShares ? `~${motion.approxShares.toLocaleString()} shares` : ""}</small></td>
              <td>{motion.evidenceCoveragePct}%<small className="muted" style={{ display: "block" }}>{motion.missingEvidence.length ? `${motion.missingEvidence.length} gaps` : "complete"}</small></td>
              <td><AuthorityGates gates={motion.decisionGates ?? []} /></td>
              <td><OutcomeTag outcome={motion.outcome} kind={motion.kind} /><p className={styles.reason}>{motion.outcomeReason}</p>{motion.veto && <small className={styles.veto}>VETO · {motion.veto.member}: {motion.veto.reason}</small>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.twoCol}>
        <article className="card">
          <SectionTitle eyebrow="02 · FUNDING" title={tr(lang, "Every use names its source", "ทุกการใช้เงินต้องระบุแหล่งเงิน")} />
          <div className={styles.capitalMetrics}>
            <Kpi label={tr(lang, "Sale / cash sources", "เงินจากการขาย/เงินพร้อมใช้")} value={money(meeting.capitalPlan.sourcesUsd)} note={`${meeting.capitalPlan.sourceLines.length} source lines`} />
            <Kpi label={tr(lang, "Approved investment", "เงินลงทุนที่อนุมัติ")} value={money(meeting.capitalPlan.usesUsd)} note={`${money(meeting.capitalPlan.deployableSourcesUsd)} deployable · ${meeting.capitalPlan.useLines.length} uses`} />
            <Kpi label={tr(lang, "Temporary reserve", "พักเงินชั่วคราว")} value={money(meeting.capitalPlan.temporaryParkingUsd)} note={`${meeting.capitalPlan.reviewOwner} · review ${meeting.capitalPlan.reviewBy}`} />
            <Kpi label={tr(lang, "Without destination", "เงินไม่มีปลายทาง")} value={money(meeting.capitalPlan.unallocatedUsd)} note={`Cash after ${pct(meeting.capitalPlan.cashAfterPct)}`} />
          </div>
          <div className={`${styles.allocationStatus} ${meeting.capitalPlan.allocationComplete ? styles.allocationReady : styles.allocationBlocked}`}>
            <strong>{meeting.capitalPlan.allocationComplete ? tr(lang, "CAPITAL PLAN COMPLETE", "แผนเงินทุนครบถ้วน") : tr(lang, "INCOMPLETE CAPITAL PLAN", "แผนเงินทุนยังไม่ครบ")}</strong>
            <span>{meeting.capitalPlan.allocationComplete ? tr(lang, "Every dollar has a destination, owner and review date.", "เงินทุกส่วนมีปลายทาง ผู้รับผิดชอบ และวันทบทวนแล้ว") : tr(lang, "Human approval is locked until Unallocated equals $0.", "ล็อกการอนุมัติจนกว่าเงินไม่มีปลายทางจะเป็น $0")}</span>
          </div>
          <div className={styles.flowGrid}>
            <div><b>{tr(lang, "Sources", "แหล่งเงิน")}</b>{meeting.capitalPlan.sourceLines.length ? meeting.capitalPlan.sourceLines.map((line) => <div className={styles.flowLine} key={line.label}><span>{line.label}</span><strong>{money(line.amountUsd)}</strong></div>) : <p className="muted">—</p>}</div>
            <div><b>{tr(lang, "Destinations", "ปลายทางเงิน")}</b>{meeting.capitalPlan.destinationLines.map((line) => <div className={styles.flowLine} key={`${line.category}-${line.label}`}><span>{line.label}<small>{line.owner}{line.reviewBy ? ` · ${tr(lang, "review", "ทบทวน")} ${line.reviewBy}` : ""}</small></span><strong>{money(line.amountUsd)}</strong></div>)}</div>
          </div>
          <p className="notice" style={{ marginTop: 14 }}>{meeting.capitalPlan.note}</p>
          {!!meeting.capitalPlan.cutForFunding.length && <div className="err" style={{ marginTop: 12 }}>{meeting.capitalPlan.cutForFunding.map((line) => `${line.ticker}: ${line.reason}`).join(" · ")}</div>}
          <div className={styles.fallbackPlan}>
            <b>{tr(lang, "Asset Management fallback review", "แผนสำรองของทีม Asset Management")}</b>
            <p>{tr(lang, "If Investment has no qualified new idea, Lena must rank existing holdings for an ADD. Nothing is bought until it is re-underwritten and approved.", "หากทีม Investment ไม่มีหุ้นใหม่ที่ผ่านเกณฑ์ Lena ต้องจัดอันดับ Holdings เดิมสำหรับการเพิ่มน้ำหนัก โดยยังไม่ซื้อจนกว่าจะวิเคราะห์ใหม่และผ่านการอนุมัติ")}</p>
            {meeting.capitalPlan.fallbackOptions.map((option, index) => <div className={styles.fallbackLine} key={`${option.ticker}-${index}`}><span>{index + 1}</span><div><strong>{option.ticker} · {option.action}</strong><small>{option.rationale}</small></div><b>{money(option.maxUsd)} max</b></div>)}
          </div>
        </article>
        <article className="card">
          <SectionTitle eyebrow="03 · TRADE BLOTTER" title={tr(lang, "What a human must enter", "รายการที่มนุษย์ต้องบันทึก")} />
          {!meeting.blotter.length ? <div className="notice">{tr(lang, "No funded trade carried this meeting.", "ไม่มีรายการซื้อขายที่ผ่านและมีเงินทุนในการประชุมนี้")}</div> : <div className={styles.blotter}>{meeting.blotter.map((line, index) => <div className={styles.blotterLine} key={`${line.side}-${line.ticker}-${index}`}><span className={line.side === "BUY" ? styles.buy : styles.sell}>{line.side}</span><strong>{line.ticker}</strong><span>{money(line.approxUsd)}</span><small>{line.approxShares ? `~${line.approxShares.toLocaleString()} shares` : "size pending"}</small></div>)}</div>}
          <button className="btn ghost" type="button" onClick={() => setView("approval")} style={{ marginTop: 14 }}>{tr(lang, "Review approval package →", "ตรวจชุดอนุมัติ →")}</button>
        </article>
      </section>
    </>}

    {view === "opportunities" && <section className="card">
      <SectionTitle eyebrow="AUTOMATIC RESEARCH DESK" title={tr(lang, "New names proposed before every meeting", "หุ้นใหม่ที่ฝ่ายวิจัยเสนออัตโนมัติก่อนประชุม")} />
      <p className="notice">{meeting.scan?.note ?? tr(lang, "The research scan did not return a summary.", "ไม่มีผลสรุปจากฝ่ายวิจัย")}</p>
      {!proposals.length ? <div className={styles.empty}><strong>{tr(lang, "No candidate cleared every hard filter", "ไม่มีหุ้นผ่านตัวกรองบังคับทั้งหมด")}</strong><p>{tr(lang, "This is a valid NO BUY result—not permission to force the weakest candidate into the portfolio.", "นี่คือผลลัพธ์ NO BUY ที่ถูกต้อง ไม่ใช่เหตุผลให้บังคับเลือกหุ้นที่อ่อนที่สุดเข้าพอร์ต")}</p></div> : <div className={styles.proposalGrid}>{proposals.map((proposal, index) => <article className={`metric ${styles.proposal}`} key={proposal.ticker}>
        <div className={styles.proposalHead}><span className="tag">#{index + 1} · {proposal.setupType}</span><strong>{proposal.ticker}</strong><span>{proposal.score}/100</span></div>
        <div className="grid cols-3"><Mini label="Entry" value={`$${proposal.entryLow.toFixed(2)}–$${proposal.entryHigh.toFixed(2)}`} /><Mini label="Stop" value={`$${proposal.stop.toFixed(2)}`} /><Mini label="Target" value={`$${proposal.target.toFixed(2)}`} /></div>
        <p>{proposal.thesis}</p><p className="muted">{proposal.catalyst}</p>
        <div className={styles.proposalFoot}><span>Coverage {proposal.coveragePct}%</span><span>R:R {proposal.riskReward.toFixed(1)}</span><span>Expected {pct(proposal.expectedReturnPct)}</span></div>
      </article>)}</div>}
      <div className={styles.inlineActions}><button className="btn ghost" type="button" onClick={() => onNavigate("research")}>{tr(lang, "Open Research Lab", "เปิดศูนย์วิจัย")}</button><button className="btn ghost" type="button" onClick={() => onNavigate("analyze")}>{tr(lang, "Open Stock Analysis", "เปิดวิเคราะห์หุ้น")}</button></div>
    </section>}

    {view === "teams" && <>
      <section className="card">
        <SectionTitle eyebrow="OPERATING MODEL · 14 PEOPLE · 4 DECISION AUTHORITIES" title={tr(lang, "Two teams present; management decides", "สองทีมนำเสนอ ฝ่ายบริหารตัดสินใจ")} />
        <p className="notice">{tr(lang, "Ten specialists provide measured evidence but do not vote. Sofia and Lena sign their team packages, Miriam owns the independent risk gate, and James issues the final resolution. Human approval is still required before the ledger changes.", "ผู้เชี่ยวชาญ 10 คนมีหน้าที่ส่งหลักฐานแต่ไม่มีสิทธิ์ลงมติ Sofia และ Lena รับรองผลงานของแต่ละทีม Miriam ควบคุม Risk Gate และ James ออกมติสุดท้าย ก่อนเปลี่ยน Ledger ยังต้องได้รับ Human Approval")}</p>
        <div className={styles.authorityFlow} aria-label={tr(lang, "Decision authority sequence", "ลำดับสิทธิ์ตัดสินใจ")}>
          {["Sofia · Investment", "Lena · Asset Management", "Miriam · CRO", "James · CIO", "Human approval"].map((label, index) => <div key={label}><span>{index + 1}</span><strong>{label}</strong></div>)}
        </div>
      </section>
      <section className={styles.teamGrid}>
        <TeamPanel title={tr(lang, "Investment Team · 8 people", "ทีม Investment · 8 คน")} mission={tr(lang, "Analyze the market, find new investments and present a signed investment case.", "วิเคราะห์ตลาด ค้นหาการลงทุนใหม่ และนำเสนอ Investment Case ที่หัวหน้าทีมรับรอง")} members={INVESTMENT_TEAM} />
        <TeamPanel title={tr(lang, "Asset Management Team · 4 people", "ทีม Asset Management · 4 คน")} mission={tr(lang, "Review holdings, reconcile cash, build the rebalance and present a funded portfolio plan.", "วิเคราะห์ Holdings กระทบยอดเงินสด สร้างแผนปรับพอร์ต และนำเสนอแผนที่มีแหล่งเงินครบ")} members={ASSET_TEAM} />
      </section>
      <section className="card">
        <SectionTitle eyebrow="EXECUTIVE MANAGEMENT · 2 PEOPLE" title={tr(lang, "Independent control and final resolution", "ฝ่ายบริหารควบคุมความเสี่ยงและออกมติสุดท้าย")} />
        <div className={styles.executiveGrid}>{EXECUTIVE_TEAM.map(([name, role, owns]) => <article className={`metric ${styles.member}`} key={name}><span>DECISION AUTHORITY</span><strong>{name}</strong><b>{role}</b><small>{owns}</small></article>)}</div>
      </section>
    </>}

    {view === "evidence" && <>
      <section className="card">
        <SectionTitle eyebrow="RISK GATE" title={tr(lang, "Only exceptions and material risks", "แสดงเฉพาะข้อยกเว้นและความเสี่ยงสำคัญ")} />
        {!meeting.riskRegister.length ? <div className="notice">{tr(lang, "No desk filed a measurable portfolio risk.", "ไม่มีฝ่ายใดยื่นความเสี่ยงของพอร์ตที่วัดได้")}</div> : <div className={styles.risks}>{meeting.riskRegister.map((risk, index) => <article className={`metric ${styles.risk}`} key={`${risk.raisedBy}-${index}`}><span className={`tag ${risk.severity === "high" ? styles.bad : risk.severity === "medium" ? styles.warn : styles.good}`}>{risk.severity.toUpperCase()}</span><strong>{risk.item}</strong><p>{risk.evidence}</p><small>{risk.raisedBy} · {risk.suggestedAction}</small></article>)}</div>}
      </section>
      <section className="card">
        <SectionTitle eyebrow="10 SPECIALISTS · ADVISORY EVIDENCE" title={tr(lang, "Specialist work is available on demand", "เปิดดูงานของผู้เชี่ยวชาญเมื่อต้องการ")} />
        <p className="muted">{tr(lang, "All 14 people remain active, but specialist opinions are evidence—not votes. Open only the work needed to challenge a team-head recommendation or executive gate.", "ทีมงานทั้ง 14 คนยังทำงานครบ แต่ความเห็นของผู้เชี่ยวชาญเป็นหลักฐาน ไม่ใช่คะแนนเสียง เปิดเฉพาะงานที่ต้องใช้ตรวจสอบข้อเสนอของหัวหน้าทีมหรือฝ่ายบริหาร")}</p>
        <div className={styles.deskList}>{meeting.deskReports.map((desk) => <details className={styles.desk} key={`${desk.member}-${desk.desk}`}><summary><span><strong>{desk.desk}</strong><small>{desk.member} · {desk.role}</small></span><span>{desk.gaps.length ? `${desk.gaps.length} gaps` : "complete"}</span></summary><p><strong>{desk.headline ?? desk.finding}</strong></p><p>{desk.finding}</p>{!!desk.rows.length && <div className="grid cols-3">{desk.rows.map((row, index) => <Mini key={`${row.label}-${index}`} label={row.label} value={row.value} />)}</div>}{!!desk.gaps.length && <div className="notice" style={{ marginTop: 10 }}>Could not measure: {desk.gaps.join(" · ")}</div>}</details>)}</div>
      </section>
    </>}

    {view === "approval" && <MeetingApprovalPanel key={`${meeting.meetingId}-${meeting.asOf}`} lang={lang} meetingId={meeting.meetingId} approvalReady={meeting.capitalPlan.approvalReady} approvalBlockReason={meeting.capitalPlan.allocationComplete ? undefined : tr(lang, `${money(meeting.capitalPlan.unallocatedUsd)} has no approved destination.`, `${money(meeting.capitalPlan.unallocatedUsd)} ยังไม่มีปลายทางที่อนุมัติ`)} meeting={{ asOf: meeting.asOf, regime: meeting.regime, quorum: meeting.quorum, capitalPlan: meeting.capitalPlan, minutes: meeting.minutes, resolutions: meeting.resolutions }} motions={approvalMotions} onApplied={() => setRefreshKey((value) => value + 1)} />}

    <section className={`card ${styles.guardrail}`}><strong>HUMAN APPROVAL REQUIRED · NO AUTO EXECUTION</strong><span>{tr(lang, "Portfolio and cash come from the production ledger. Recommendations cannot alter holdings until an approved fill is recorded.", "ข้อมูลพอร์ตและเงินสดมาจาก ledger จริง คำแนะนำไม่สามารถเปลี่ยน holdings ได้จนกว่าจะบันทึกรายการที่อนุมัติและซื้อขายจริง")}</span></section>
  </div>;
}

function Kpi({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className={styles.sectionTitle}><span>{eyebrow}</span><h3 className="sub">{title}</h3></div>; }
function DecisionTag({ kind }: { kind: MotionKind }) { const tone = kind === "ADD" || kind === "NEW BUY" ? styles.buy : kind === "TRIM" || kind === "EXIT" || kind === "RAISE CASH" ? styles.sell : styles.hold; return <span className={`${styles.decision} ${tone}`}>{kind}</span>; }
function OutcomeTag({ outcome, kind }: { outcome: Outcome; kind: MotionKind }) { return <span className={`${styles.outcome} ${outcome === "CARRIED" ? styles.good : outcome === "DEFERRED" ? styles.warn : styles.muted}`}>{outcome === "CARRIED" ? kind === "HOLD" ? "HOLD CONFIRMED" : "READY FOR APPROVAL" : outcome}</span>; }
function AuthorityGates({ gates }: { gates: DecisionGate[] }) { return <div className={styles.gates}>{gates.map((gate) => <span key={gate.stage} className={gate.status === "PASS" ? styles.gatePass : gate.status === "VETO" ? styles.gateVeto : styles.gateWait} title={`${gate.owner} · ${gate.rationale}`}>{gate.stage === "ASSET_MANAGEMENT" ? "AM" : gate.stage === "INVESTMENT" ? "INV" : gate.stage} {gate.status === "PASS" ? "✓" : gate.status}</span>)}</div>; }
function TeamPanel({ title, mission, members }: { title: string; mission: string; members: readonly (readonly [string, string, string])[] }) { return <article className="card"><SectionTitle eyebrow="TEAM" title={title} /><p className={styles.teamMission}>{mission}</p><div className={styles.memberList}>{members.map(([name, role, owns], index) => <div className={styles.memberRow} key={name}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{name}</strong><b>{role}</b><small>{owns}</small></div>{index === 0 ? <em>HEAD · DECIDES</em> : <em>ADVISORY</em>}</div>)}</div></article>; }
