"use client";

// The investment committee meeting, as a fund actually runs one.
//
// This is the decision half of the CIO command centre: the Analysis team's
// valuation work sits above it in CIOCommandCenterV16, and this panel turns
// that evidence into motions, a recorded vote, a funded capital plan and the
// approval that writes to the ledger.
//
// Everything here comes from /api/committee/meeting, which runs
// lib/team/committee.ts against the fund's own rulebook in
// lib/team/constitution.ts. The component formats; it decides nothing. If a
// number is missing it is because no desk could measure it, and the panel says
// so rather than filling the gap.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";
import MeetingApprovalPanel from "./MeetingApprovalPanel";

type Ballot = "FOR" | "AGAINST" | "ABSTAIN";
type MotionKind = "ADD" | "HOLD" | "TRIM" | "EXIT" | "NEW BUY" | "RAISE CASH";
type Outcome = "CARRIED" | "FAILED" | "DEFERRED";

type Vote = { member: string; role: string; desk: string; ballot: Ballot; rationale: string };
type Reason = { desk: string; member: string; finding: string };
type Motion = {
  id: string; ticker: string; kind: MotionKind; sizeUsd: number; approxShares: number | null;
  proposedBy: string; reasons: Reason[]; evidenceCoveragePct: number; missingEvidence: string[];
  votes: Vote[]; tally: { for: number; against: number; abstain: number };
  outcome: Outcome; outcomeReason: string; veto: { member: string; reason: string } | null;
};
type Proposal = {
  ticker: string; setupType: string; score: number; coveragePct: number;
  price: number; entryLow: number; entryHigh: number; stop: number; target: number;
  riskReward: number; expectedReturnPct: number; thesis: string; catalyst: string; unmeasured: string[];
};
type ScanSummary = {
  regime: { defensiveOnly: boolean; note: string } | null;
  universeSize: number; rejected: number; warnings: string[]; note: string;
};
type DeskRow = { label: string; value: string; tone?: "good" | "warn" | "bad" | "neutral"; note?: string };
type DeskReport = { member: string; role: string; desk: string; headline: string | null; rows: DeskRow[]; finding: string; gaps: string[] };
type Meeting = {
  meetingId: string; asOf: string; nav: number;
  agenda: { n: number; title: string; covered: boolean; summary: string }[];
  attendance: { member: string; role: string; desk: string; present: boolean; contribution: string }[];
  deskReports: DeskReport[];
  proposals?: Proposal[];
  scan?: ScanSummary;
  quorum: { present: number; required: number; met: boolean; note: string };
  regime: { score: number; regime: string; icon: string; cashMinPct: number; deployRule: string; note: string } | null;
  motions: Motion[];
  capitalPlan: {
    sourcesUsd: number; sourceLines: { label: string; amountUsd: number }[];
    usesUsd: number; useLines: { label: string; amountUsd: number }[];
    balanceUsd: number; funded: boolean;
    cutForFunding: { ticker: string; requestedUsd: number; reason: string }[];
    cashAfterPct: number | null; earmarkedForCashUsd: number; note: string;
  };
  blotter: { side: "BUY" | "SELL"; ticker: string; approxShares: number | null; approxUsd: number; referencePrice: number | null; reason: string }[];
  resolutions: { id: string; text: string; owner: string; reviewBy: string; status: "APPROVED" | "DEFERRED" | "REJECTED" }[];
  dissent: { ticker: string; member: string; rationale: string }[];
  riskRegister: { raisedBy: string; role: string; severity: "high" | "medium" | "low"; item: string; evidence: string; suggestedAction: string }[];
  roundTable: { member: string; role: string; desk: string; tabled: boolean; view: string }[];
  minutes: string[];
  disclosures: string[];
  standingDuty?: string;
};

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
// A trade level is quoted to the cent. Rounding an entry band to the dollar
// turns a $318.50 pivot into $319 and moves the stop with it.
const level = (v: number) => `$${v.toFixed(2)}`;

const KIND_TONE: Record<MotionKind, string> = { "RAISE CASH": "#facc15", EXIT: "#f87171", TRIM: "#fb923c", ADD: "#34d399", "NEW BUY": "#38bdf8", HOLD: "#94a3b8" };
const OUTCOME_TONE: Record<Outcome, string> = { CARRIED: "#34d399", DEFERRED: "#fbbf24", FAILED: "#94a3b8" };
const BALLOT_TONE: Record<Ballot, string> = { FOR: "#34d399", AGAINST: "#f87171", ABSTAIN: "#64748b" };
const ROW_TONE: Record<NonNullable<DeskRow["tone"]>, string> = { good: "#34d399", warn: "#fbbf24", bad: "#f87171", neutral: "var(--fg)" };

type Filter = "all" | "reduce" | "deploy" | "hold";

export default function CommitteeMeetingPanel({ lang, onNavigate }: { lang: AppLang; onNavigate: (id: string) => void }) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [openMotion, setOpenMotion] = useState<string | null>(null);
  const [openDesks, setOpenDesks] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    // Only blank the page on the first load. A refresh triggered by an approval
    // must not unmount the tree — doing so throws away the result the person
    // just produced, which is the one thing they need to read.
    setLoading((wasLoading) => (meeting == null ? true : wasLoading));
    setError(null);
    fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error ?? `The meeting could not be assembled (${response.status}).`);
        return payload as Meeting;
      })
      .then((payload) => { if (active) setMeeting(payload); })
      .catch((cause) => { if (active) setError(cause?.message ?? "The meeting could not be assembled."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  const jump = useCallback((id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), []);

  const motions = useMemo(() => {
    const all = meeting?.motions ?? [];
    // The liquidity motion sorts first wherever it appears: while the fund is
    // below its own cash floor, it is the meeting.
    const rank: Record<MotionKind, number> = { "RAISE CASH": -1, EXIT: 0, TRIM: 1, "NEW BUY": 2, ADD: 3, HOLD: 4 };
    const filtered =
      filter === "reduce" ? all.filter((m) => m.kind === "EXIT" || m.kind === "TRIM" || m.kind === "RAISE CASH")
      : filter === "deploy" ? all.filter((m) => m.kind === "ADD" || m.kind === "NEW BUY")
      : filter === "hold" ? all.filter((m) => m.kind === "HOLD")
      : all;
    return [...filtered].sort((a, b) => rank[a.kind] - rank[b.kind] || Math.abs(b.sizeUsd) - Math.abs(a.sizeUsd));
  }, [meeting?.motions, filter]);

  const counts = useMemo(() => {
    const all = meeting?.motions ?? [];
    return {
      all: all.length,
      reduce: all.filter((m) => m.kind === "EXIT" || m.kind === "TRIM" || m.kind === "RAISE CASH").length,
      deploy: all.filter((m) => m.kind === "ADD" || m.kind === "NEW BUY").length,
      hold: all.filter((m) => m.kind === "HOLD").length,
      carried: all.filter((m) => m.outcome === "CARRIED").length,
      deferred: all.filter((m) => m.outcome === "DEFERRED").length,
    };
  }, [meeting?.motions]);

  // Highest score first: the desk ranks its own shortlist rather than leaving
  // the reader to work out which name it likes best.
  const proposals = useMemo(
    () => [...(meeting?.proposals ?? [])].sort((a, b) => b.score - a.score),
    [meeting?.proposals]
  );

  const deskStats = useMemo(() => {
    const desks = meeting?.deskReports ?? [];
    return {
      total: desks.length,
      withRows: desks.filter((d) => d.rows.length > 0).length,
      rows: desks.reduce((sum, d) => sum + d.rows.length, 0),
      gaps: desks.reduce((sum, d) => sum + d.gaps.length, 0),
    };
  }, [meeting?.deskReports]);

  if (loading) return <section className="card"><p className="muted">{tr(lang, "Convening the committee — gathering each desk's measurements…", "กำลังเรียกประชุม — รวบรวมการวัดผลจากแต่ละฝ่าย…")}</p></section>;
  if (error || !meeting) {
    return (
      <section className="card">
        <span className="tag">CIO</span>
        <h2 className="section" style={{ margin: "10px 0 6px" }}>{tr(lang, "The meeting could not be convened", "ไม่สามารถเปิดประชุมได้")}</h2>
        <div className="err" style={{ marginTop: 10 }}>⚠ {error}</div>
        <p className="muted" style={{ marginTop: 10 }}>{tr(lang, "No motion is shown rather than a motion built on missing evidence.", "ระบบไม่แสดงญัตติที่สร้างจากข้อมูลที่ขาดหาย")}</p>
        <button className="btn ghost" type="button" onClick={() => setRefreshKey((v) => v + 1)} style={{ marginTop: 12 }}>↻ {tr(lang, "Try again", "ลองใหม่")}</button>
      </section>
    );
  }

  const plan = meeting.capitalPlan;

  return (
    <div className="workspace-stack" data-committee-version="1.0" data-workspace="investment-committee" data-source-of-truth="committee-meeting">

      {/* ── Call to order ── */}
      <section className="card" style={{ borderTop: "2px solid var(--accent)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div>
            <span className="tag">{meeting.meetingId}</span>
            <h2 className="section" style={{ margin: "10px 0 6px" }}>{tr(lang, "Investment Committee", "การประชุมคณะกรรมการลงทุน")}</h2>
            <p className="muted" style={{ margin: 0, maxWidth: 900 }}>
              {tr(lang,
                "One motion per position and per referred idea. Every seat votes on what it measured and abstains on what it did not. Sources must fund uses. Nothing here places an order.",
                "หนึ่งญัตติต่อหนึ่งหุ้นที่ถือและต่อหนึ่งหุ้นที่เสนอเข้ามา ทุกที่นั่งลงมติเฉพาะสิ่งที่ตนวัดได้ และงดออกเสียงในสิ่งที่วัดไม่ได้ แหล่งเงินต้องพอกับการใช้เงิน และไม่มีการส่งคำสั่งซื้อขายใดๆ")}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <span className="tag" style={{ borderColor: meeting.quorum.met ? "#34d399" : "#fbbf24", color: meeting.quorum.met ? "#34d399" : "#fbbf24" }}>
              {meeting.quorum.met ? tr(lang, "QUORATE", "ครบองค์ประชุม") : tr(lang, "NOT QUORATE", "ไม่ครบองค์ประชุม")} {meeting.quorum.present}/{meeting.attendance.length}
            </span>
            <button className="btn ghost" type="button" onClick={() => setRefreshKey((v) => v + 1)}>↻ {tr(lang, "Reconvene", "ประชุมใหม่")}</button>
          </div>
        </div>

        <div className="grid cols-4" style={{ marginTop: 16 }}>
          <Metric label={tr(lang, "NAV", "มูลค่าสุทธิ")} value={money(meeting.nav)} />
          <Metric label={tr(lang, "New names proposed", "หุ้นใหม่ที่เสนอ")} value={String(proposals.length)} />
          <Metric label={tr(lang, "Motions carried", "ญัตติที่ผ่าน")} value={`${counts.carried} / ${counts.all}`} />
          <Metric label={tr(lang, "Deferred", "เลื่อนพิจารณา")} value={String(counts.deferred)} />
          <Metric label={tr(lang, "Capital committed", "เงินที่อนุมัติใช้")} value={money(plan.usesUsd)} />
        </div>

        {!meeting.quorum.met && <div className="notice" style={{ marginTop: 14, borderColor: "#fbbf24" }}><b>{tr(lang, "Inquorate", "องค์ประชุมไม่ครบ")}</b><p style={{ margin: "6px 0 0" }}>{meeting.quorum.note}</p></div>}

        <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 14, paddingBottom: 4 }}>
          {[
            ["agenda", tr(lang, "Agenda", "ระเบียบวาระ")],
            ["attendance", tr(lang, "Attendance", "ผู้เข้าประชุม")],
            ["desks", tr(lang, "Desk reports", "รายงานแต่ละฝ่าย")],
            ["proposals", tr(lang, "New proposals", "หุ้นใหม่ที่เสนอ")],
            ["motions", tr(lang, "Motions", "ญัตติ")],
            ["capital", tr(lang, "Capital plan", "แผนเงินทุน")],
            ["blotter", tr(lang, "Trade blotter", "รายการซื้อขาย")],
            ["resolutions", tr(lang, "Resolutions", "มติ")],
            ["approval", tr(lang, "Approve & apply", "อนุมัติและบันทึก")],
            ["risk", tr(lang, "Risk register", "ทะเบียนความเสี่ยง")],
            ["minutes", tr(lang, "Minutes", "รายงานการประชุม")],
          ].map(([id, label]) => (
            <button key={id} className="btn ghost sm" type="button" onClick={() => jump(`ic-${id}`)}>{label}</button>
          ))}
        </div>
      </section>

      {/* ── 1. Agenda ── */}
      <section className="card" id="ic-agenda">
        <Head n="1" title={tr(lang, "Agenda", "ระเบียบวาระการประชุม")} />
        <div className="grid cols-2">
          {meeting.agenda.map((item) => (
            <article key={item.n} className="metric" style={{ alignItems: "flex-start", opacity: item.covered ? 1 : 0.65 }}>
              <div className="label">{item.covered ? "●" : "○"} {tr(lang, "Item", "วาระที่")} {item.n} · {item.title}</div>
              <strong className="value" style={{ fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>{item.summary}</strong>
            </article>
          ))}
        </div>
      </section>

      {/* ── 2. Attendance ── */}
      <section className="card" id="ic-attendance">
        <Head n="2" title={tr(lang, "Attendance and quorum", "ผู้เข้าประชุมและองค์ประชุม")} />
        <p className="muted" style={{ marginTop: 0 }}>
          {tr(lang,
            "A seat counts as present when it brought a measurement to the table. A seat with nothing to measure is marked absent and says why — it does not vote on someone else's number.",
            "ที่นั่งจะนับว่าเข้าประชุมเมื่อมีผลการวัดมานำเสนอ ที่นั่งที่ไม่มีข้อมูลจะถูกบันทึกว่าไม่เข้าร่วมพร้อมเหตุผล และจะไม่ลงมติโดยใช้ตัวเลขของคนอื่น")}
        </p>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>{tr(lang, "Member", "สมาชิก")}</th><th>{tr(lang, "Desk", "ฝ่าย")}</th><th>{tr(lang, "Status", "สถานะ")}</th><th>{tr(lang, "Brought to the meeting", "สิ่งที่นำเสนอ")}</th></tr></thead>
            <tbody>
              {meeting.attendance.map((seat) => (
                <tr key={seat.member} style={{ opacity: seat.present ? 1 : 0.7 }}>
                  <td><strong>{seat.member}</strong><small style={{ display: "block", color: "var(--muted)" }}>{seat.role}</small></td>
                  <td>{seat.desk}</td>
                  <td><span style={{ color: seat.present ? "#34d399" : "#94a3b8", fontWeight: 600 }}>{seat.present ? tr(lang, "PRESENT", "เข้าประชุม") : tr(lang, "ABSENT", "ไม่เข้าร่วม")}</span></td>
                  <td style={{ fontSize: 13 }}>{seat.contribution}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 3. Desk reports — the work itself, not the remit ── */}
      <section className="card" id="ic-desks">
        <Head n="3" title={tr(lang, "Desk reports — what each seat measured", "รายงานของแต่ละฝ่าย — ผลการวัดจริง")} />
        <p className="muted" style={{ marginTop: 0 }}>
          {tr(lang,
            "The table above says what each desk is responsible for. This is what each desk actually found in this book: the readings, the conclusion drawn from them, and what it could not measure. Every motion below is built from these lines and nothing else.",
            "ตารางด้านบนบอกว่าแต่ละฝ่ายรับผิดชอบอะไร ส่วนนี้คือสิ่งที่แต่ละฝ่ายวัดได้จริงจากพอร์ตนี้ — ตัวเลขที่อ่านได้ ข้อสรุปจากตัวเลขนั้น และสิ่งที่วัดไม่ได้ ทุกญัตติด้านล่างสร้างจากบรรทัดเหล่านี้เท่านั้น")}
        </p>
        <div className="grid cols-3" style={{ marginTop: 14 }}>
          <Metric label={tr(lang, "Desks reporting", "ฝ่ายที่มีผลการวัด")} value={`${deskStats.withRows} / ${deskStats.total}`} />
          <Metric label={tr(lang, "Measurements tabled", "จำนวนรายการที่วัดได้")} value={String(deskStats.rows)} />
          <Metric label={tr(lang, "Gaps declared", "ช่องว่างที่ประกาศไว้")} value={String(deskStats.gaps)} />
        </div>

        <div className="grid cols-2" style={{ marginTop: 16 }}>
          {(meeting.deskReports ?? []).map((desk) => {
            const open = openDesks.has(desk.member);
            const shown = open ? desk.rows : desk.rows.slice(0, 4);
            return (
              <article key={desk.member} className="card" style={{ margin: 0, opacity: desk.rows.length ? 1 : 0.75 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ fontSize: 15 }}>{desk.member}</strong>
                    <small className="muted" style={{ display: "block" }}>{desk.role} · {desk.desk}</small>
                  </div>
                  {desk.headline && <span className="tag" style={{ whiteSpace: "nowrap" }}>{desk.headline}</span>}
                </div>

                {shown.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    {shown.map((row, i) => (
                      <div key={i} style={{ padding: "7px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
                          <span className="muted">{row.label}</span>
                          <strong style={{ color: ROW_TONE[row.tone ?? "neutral"], textAlign: "right" }}>{row.value}</strong>
                        </div>
                        {row.note && <small className="muted" style={{ display: "block", marginTop: 2, fontSize: 11.5, lineHeight: 1.45 }}>{row.note}</small>}
                      </div>
                    ))}
                    {desk.rows.length > 4 && (
                      <button className="btn ghost sm" type="button" style={{ marginTop: 10 }}
                        onClick={() => setOpenDesks((prev) => { const next = new Set(prev); next.has(desk.member) ? next.delete(desk.member) : next.add(desk.member); return next; })}>
                        {open ? tr(lang, "Show fewer", "แสดงน้อยลง") : `+ ${desk.rows.length - 4} ${tr(lang, "more measurements", "รายการเพิ่มเติม")}`}
                      </button>
                    )}
                  </div>
                )}

                <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.6 }}>{desk.finding}</p>

                {desk.gaps.length > 0 && (
                  <div className="notice" style={{ marginTop: 12, fontSize: 12 }}>
                    <b>{tr(lang, "Could not measure", "วัดไม่ได้")}</b>
                    <p style={{ margin: "5px 0 0", lineHeight: 1.55 }}>{desk.gaps.join(" · ")}</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ── 4. Macro ── */}
      <section className="card">
        <Head n="4" title={tr(lang, "Macro regime and cash policy", "สภาวะตลาดและนโยบายเงินสด")} />
        {meeting.regime ? (
          <>
            <div className="grid cols-4">
              <Metric label={tr(lang, "Regime", "สภาวะ")} value={`${meeting.regime.icon} ${meeting.regime.regime}`} />
              <Metric label={tr(lang, "Score", "คะแนน")} value={`${meeting.regime.score}/100`} />
              <Metric label={tr(lang, "Cash floor", "เงินสดขั้นต่ำ")} value={`${meeting.regime.cashMinPct}%`} />
              <Metric label={tr(lang, "Cash after plan", "เงินสดหลังแผน")} value={pct(plan.cashAfterPct)} />
            </div>
            <div className="notice" style={{ marginTop: 14 }}><b>{tr(lang, "Deployment rule", "กติกาการลงทุน")}</b><p style={{ margin: "6px 0 0" }}>{meeting.regime.deployRule}</p><p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>{meeting.regime.note}</p></div>
          </>
        ) : (
          <div className="notice">{tr(lang, "No regime read this meeting — the benchmark history the macro desk needs was unavailable. Cash policy stands at its last setting and Daniel Cho abstained on every motion.", "ไม่มีการอ่านสภาวะตลาดในการประชุมนี้ เนื่องจากไม่มีข้อมูลดัชนีอ้างอิง นโยบายเงินสดคงเดิม และ Daniel Cho งดออกเสียงทุกญัตติ")}</div>
        )}
      </section>

      {/* ── 5. What research brought in ── */}
      <section className="card" id="ic-proposals">
        <Head n="5" title={tr(lang, "New investment proposals from the research desk", "หุ้นใหม่ที่ฝ่ายวิจัยเสนอเข้าที่ประชุม")} />
        <p className="muted" style={{ marginTop: 0 }}>
          {tr(lang,
            "The desk runs its own scan before every meeting rather than waiting for someone to hand it a name. Each proposal below cleared all four hard filters and is tabled as a NEW BUY motion in the next section, where the committee votes on it.",
            "ฝ่ายวิจัยรันสแกนของตัวเองก่อนการประชุมทุกครั้ง ไม่ต้องรอให้ใครส่งชื่อหุ้นมาให้ ทุกตัวด้านล่างผ่านตัวกรองบังคับครบทั้ง 4 ข้อ และถูกยื่นเป็นญัตติ NEW BUY ในหัวข้อถัดไปเพื่อให้ที่ประชุมลงมติ")}
        </p>

        {meeting.scan && (
          <div className="grid cols-3" style={{ marginTop: 14 }}>
            <Metric label={tr(lang, "Names swept", "จำนวนหุ้นที่สแกน")} value={String(meeting.scan.universeSize)} />
            <Metric label={tr(lang, "Cleared every filter", "ผ่านตัวกรองทั้งหมด")} value={String(proposals.length)} />
            <Metric label={tr(lang, "Rejected with a reason", "ถูกคัดออกพร้อมเหตุผล")} value={String(meeting.scan.rejected)} />
          </div>
        )}

        {proposals.length === 0 ? (
          <div className="notice" style={{ marginTop: 14 }}>
            <b>{tr(lang, "The desk proposes nothing today", "วันนี้ฝ่ายวิจัยไม่เสนอหุ้นใดเลย")}</b>
            <p style={{ margin: "6px 0 0" }}>{meeting.scan?.note ?? tr(lang, "The scan did not run.", "สแกนไม่ทำงาน")}</p>
            {meeting.scan?.regime?.defensiveOnly && <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>{meeting.scan.regime.note}</p>}
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
              {tr(lang,
                "An empty shortlist is a finding. The alternative — tabling the least-bad candidate so the meeting has something to vote on — is how a fund buys its worst positions.",
                "การไม่มีหุ้นเสนอคือผลการวิเคราะห์อย่างหนึ่ง ทางเลือกอีกทางคือเสนอตัวที่แย่น้อยที่สุดเพื่อให้มีอะไรให้โหวต ซึ่งเป็นวิธีที่กองทุนได้หุ้นที่แย่ที่สุดมาถือ")}
            </p>
          </div>
        ) : (
          <div className="grid cols-2" style={{ marginTop: 16 }}>
            {proposals.map((p) => (
              <article key={p.ticker} className="card" style={{ margin: 0, borderLeft: "3px solid #38bdf8" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div>
                    <strong style={{ fontSize: 18 }}>{p.ticker}</strong>
                    <small className="muted" style={{ display: "block" }}>{p.setupType}</small>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <strong style={{ fontSize: 18, color: p.score >= 70 ? "#34d399" : "#fbbf24" }}>{p.score}/100</strong>
                    <small className="muted" style={{ display: "block" }}>{tr(lang, "alpha score", "คะแนน alpha")} · {p.coveragePct}% {tr(lang, "measured", "วัดได้")}</small>
                  </div>
                </div>

                <div className="grid cols-2" style={{ marginTop: 12 }}>
                  <Metric label={tr(lang, "Entry", "ราคาเข้า")} value={`${level(p.entryLow)}–${level(p.entryHigh)}`} />
                  <Metric label={tr(lang, "Stop", "จุดตัดขาดทุน")} value={level(p.stop)} />
                  <Metric label={tr(lang, "Target", "เป้าหมาย")} value={`${level(p.target)} · ${pct(p.expectedReturnPct)}`} />
                  <Metric label={tr(lang, "Reward:risk", "ผลตอบแทนต่อความเสี่ยง")} value={`1:${p.riskReward}`} />
                </div>

                <p style={{ margin: "12px 0 0", fontSize: 13, lineHeight: 1.6 }}>{p.thesis}</p>
                {p.catalyst && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>{tr(lang, "Catalyst", "ตัวเร่ง")}: {p.catalyst}</p>}

                {p.unmeasured.length > 0 && (
                  <div className="notice" style={{ marginTop: 12, fontSize: 12 }}>
                    <b>{tr(lang, "Scored zero, kept in the denominator", "ให้ศูนย์และยังนับในตัวหาร")}</b>
                    <p style={{ margin: "5px 0 0", lineHeight: 1.5 }}>{p.unmeasured.join(" · ")}</p>
                  </div>
                )}

                <button className="btn ghost sm" type="button" style={{ marginTop: 12 }} onClick={() => jump("ic-motions")}>
                  {tr(lang, "See the vote on this name", "ดูผลโหวตของหุ้นตัวนี้")}
                </button>
              </article>
            ))}
          </div>
        )}

        {(meeting.scan?.warnings?.length ?? 0) > 0 && (
          <div className="notice" style={{ marginTop: 14, fontSize: 12 }}>
            <b>{tr(lang, "Limits on this sweep", "ข้อจำกัดของการสแกนรอบนี้")}</b>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              {meeting.scan!.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* ── 6. Motions ── */}
      <section className="card" id="ic-motions">
        <Head n="6" title={tr(lang, "Motions", "ญัตติ")} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {([
            ["all", tr(lang, "All", "ทั้งหมด"), counts.all],
            ["reduce", tr(lang, "Exit & trim", "ขาย/ลดน้ำหนัก"), counts.reduce],
            ["deploy", tr(lang, "Add & new buy", "เพิ่ม/ซื้อใหม่"), counts.deploy],
            ["hold", tr(lang, "Hold", "ถือต่อ"), counts.hold],
          ] as [Filter, string, number][]).map(([id, label, n]) => (
            <button key={id} className={`btn ${filter === id ? "" : "ghost"} sm`} type="button" onClick={() => setFilter(id)}>{label} · {n}</button>
          ))}
        </div>

        {motions.length === 0 ? (
          <div className="notice">{tr(lang, "No motion in this category.", "ไม่มีญัตติในหมวดนี้")}</div>
        ) : motions.map((motion) => {
          const open = openMotion === motion.id;
          return (
            <article key={motion.id} className="card" style={{ margin: "0 0 12px", borderLeft: `3px solid ${KIND_TONE[motion.kind]}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ minWidth: 220 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 18 }}>{motion.ticker}</strong>
                    <span className="tag" style={{ borderColor: KIND_TONE[motion.kind], color: KIND_TONE[motion.kind] }}>{motion.kind}</span>
                    <span className="tag" style={{ borderColor: OUTCOME_TONE[motion.outcome], color: OUTCOME_TONE[motion.outcome] }}>{motion.outcome}</span>
                  </div>
                  <small className="muted" style={{ display: "block", marginTop: 6 }}>{tr(lang, "Proposed by", "เสนอโดย")} {motion.proposedBy}</small>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <div><small className="muted" style={{ display: "block" }}>{tr(lang, "Size", "ขนาด")}</small><strong style={{ fontSize: 16, color: motion.sizeUsd > 0 ? "#34d399" : motion.sizeUsd < 0 ? "#f87171" : "inherit" }}>{motion.sizeUsd === 0 ? "—" : money(motion.sizeUsd)}</strong>{motion.approxShares != null && <small className="muted" style={{ display: "block" }}>~{motion.approxShares.toLocaleString()} {tr(lang, "shares", "หุ้น")}</small>}</div>
                  <div><small className="muted" style={{ display: "block" }}>{tr(lang, "Vote", "ผลโหวต")}</small><strong style={{ fontSize: 16 }}>{motion.tally.for}–{motion.tally.against}</strong><small className="muted" style={{ display: "block" }}>{motion.tally.abstain} {tr(lang, "abstained", "งดออกเสียง")}</small></div>
                  <div style={{ minWidth: 120 }}><small className="muted" style={{ display: "block" }}>{tr(lang, "Evidence", "หลักฐาน")}</small><Coverage value={motion.evidenceCoveragePct} /></div>
                </div>
              </div>

              <p style={{ margin: "12px 0 0", fontSize: 13 }}>{motion.outcomeReason}</p>
              {motion.veto && <div className="err" style={{ marginTop: 10, fontSize: 13 }}>⚠ {tr(lang, "Veto", "ยับยั้ง")} · {motion.veto.member}: {motion.veto.reason}</div>}

              <button className="btn ghost sm" type="button" onClick={() => setOpenMotion(open ? null : motion.id)} style={{ marginTop: 12 }}>
                {open ? tr(lang, "Hide the record", "ซ่อนบันทึก") : tr(lang, "Show reasons and the full vote", "ดูเหตุผลและผลโหวตทั้งหมด")}
              </button>

              {open && (
                <div style={{ marginTop: 14 }}>
                  <h4 className="sub" style={{ marginTop: 0 }}>{tr(lang, "Findings behind the motion", "ผลการวิเคราะห์ที่มาของญัตติ")}</h4>
                  <ul style={{ margin: "0 0 14px", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                    {motion.reasons.map((reason, i) => <li key={i}><strong>{reason.member}</strong> <span className="muted">({reason.desk})</span> — {reason.finding}</li>)}
                  </ul>

                  {motion.missingEvidence.length > 0 && (
                    <div className="notice" style={{ marginBottom: 14 }}>
                      <b>{tr(lang, "Not measured", "วัดไม่ได้")}</b>
                      <p style={{ margin: "6px 0 0", fontSize: 13 }}>{motion.missingEvidence.join(" · ")}</p>
                    </div>
                  )}

                  <h4 className="sub">{tr(lang, "Vote sheet", "ใบลงมติ")}</h4>
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead><tr><th>{tr(lang, "Member", "สมาชิก")}</th><th>{tr(lang, "Ballot", "มติ")}</th><th>{tr(lang, "Rationale", "เหตุผล")}</th></tr></thead>
                      <tbody>
                        {motion.votes.map((vote) => (
                          <tr key={vote.member}>
                            <td style={{ whiteSpace: "nowrap" }}><strong>{vote.member}</strong><small style={{ display: "block", color: "var(--muted)" }}>{vote.role}</small></td>
                            <td style={{ color: BALLOT_TONE[vote.ballot], fontWeight: 600, whiteSpace: "nowrap" }}>{vote.ballot}</td>
                            <td style={{ fontSize: 13 }}>{vote.rationale}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </section>

      {/* ── 5. Capital plan ── */}
      <section className="card" id="ic-capital">
        <Head n="7" title={tr(lang, "Capital plan", "แผนการใช้เงินทุน")} />
        <p className="muted" style={{ marginTop: 0 }}>
          {tr(lang, "Uses may not exceed sources. When the meeting approves more buying than it has funded, the lowest-conviction uses are cut and named — never dropped quietly.",
            "การใช้เงินต้องไม่เกินแหล่งเงิน หากที่ประชุมอนุมัติซื้อมากกว่าเงินที่มี ญัตติที่มีความเชื่อมั่นต่ำสุดจะถูกตัดออกและระบุชื่อไว้ ไม่ตัดทิ้งเงียบๆ")}
        </p>
        <div className="grid cols-4" style={{ marginTop: 14 }}>
          <Metric label={tr(lang, "Sources", "แหล่งเงิน")} value={money(plan.sourcesUsd)} />
          <Metric label={tr(lang, "Uses", "การใช้เงิน")} value={money(plan.usesUsd)} />
          <Metric label={tr(lang, "Uncommitted", "เงินคงเหลือ")} value={money(plan.balanceUsd)} />
          <Metric label={tr(lang, "Cash after", "เงินสดหลังแผน")} value={pct(plan.cashAfterPct)} />
        </div>
        {plan.earmarkedForCashUsd > 0 && (
          <div className="notice" style={{ marginTop: 14, borderColor: "#facc15" }}>
            <b>{tr(lang, "Ring-fenced for the liquidity buffer", "กันไว้สำหรับเงินสดสำรอง")} · {money(plan.earmarkedForCashUsd)}</b>
            <p style={{ margin: "6px 0 0" }}>
              {tr(lang,
                "This money is raised to restore the cash floor and stays as settled cash. It is not a source of funds for anything on this agenda — restoring the buffer is what it buys.",
                "เงินก้อนนี้ระดมมาเพื่อคืนเงินสดขั้นต่ำและจะคงอยู่เป็นเงินสด ไม่ใช่แหล่งเงินสำหรับรายการอื่นในวาระนี้ — การคืนระดับเงินสดสำรองคือปลายทางของมันเอง")}
            </p>
          </div>
        )}
        <div className="grid cols-2" style={{ marginTop: 14 }}>
          <div className="card" style={{ margin: 0 }}>
            <h4 className="sub" style={{ marginTop: 0 }}>{tr(lang, "Where the money comes from", "เงินมาจากไหน")}</h4>
            {plan.sourceLines.length ? plan.sourceLines.map((line, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}><span>{line.label}</span><strong>{money(line.amountUsd)}</strong></div>
            )) : <p className="muted" style={{ fontSize: 13 }}>{tr(lang, "No source of funds this meeting.", "ไม่มีแหล่งเงินในการประชุมนี้")}</p>}
          </div>
          <div className="card" style={{ margin: 0 }}>
            <h4 className="sub" style={{ marginTop: 0 }}>{tr(lang, "Where it goes", "เงินไปไหน")}</h4>
            {plan.useLines.length ? plan.useLines.map((line, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}><span>{line.label}</span><strong>{money(line.amountUsd)}</strong></div>
            )) : <p className="muted" style={{ fontSize: 13 }}>{tr(lang, "No approved use of capital. Cash stays where it is.", "ไม่มีการอนุมัติใช้เงิน เงินสดคงเดิม")}</p>}
          </div>
        </div>
        {plan.cutForFunding.length > 0 && (
          <div className="notice" style={{ marginTop: 14, borderColor: "#fbbf24" }}>
            <b>{tr(lang, "Cut or reduced to make the plan balance", "ถูกตัดหรือลดเพื่อให้แผนสมดุล")}</b>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {plan.cutForFunding.map((cut, i) => <li key={i}><strong>{cut.ticker}</strong> — {cut.reason}</li>)}
            </ul>
          </div>
        )}
        <p style={{ marginTop: 14, fontSize: 13 }}>{plan.note}</p>
      </section>

      {/* ── 6. Blotter ── */}
      <section className="card" id="ic-blotter">
        <Head n="8" title={tr(lang, "Trade blotter — for human entry", "รายการซื้อขาย — ให้คนบันทึกเอง")} />
        {meeting.blotter.length ? (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>{tr(lang, "Side", "ฝั่ง")}</th><th>{tr(lang, "Ticker", "หุ้น")}</th><th className="num">{tr(lang, "Approx shares", "จำนวนหุ้นโดยประมาณ")}</th><th className="num">{tr(lang, "Approx value", "มูลค่าโดยประมาณ")}</th><th className="num">{tr(lang, "Reference price", "ราคาอ้างอิง")}</th></tr></thead>
                <tbody>
                  {meeting.blotter.map((line, i) => (
                    <tr key={i}>
                      <td><span style={{ color: line.side === "BUY" ? "#34d399" : "#f87171", fontWeight: 700 }}>{line.side}</span></td>
                      <td><strong>{line.ticker}</strong></td>
                      <td className="num">{line.approxShares == null ? "—" : line.approxShares.toLocaleString()}</td>
                      <td className="num">{money(line.approxUsd)}</td>
                      <td className="num">{line.referencePrice == null ? "—" : money(line.referencePrice)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="notice" style={{ marginTop: 14 }}>
              {tr(lang,
                "Share counts are approximations from the reference price, not orders. Record the actual fills in the transaction ledger — the ledger, not this page, is the fund's record.",
                "จำนวนหุ้นเป็นค่าประมาณจากราคาอ้างอิง ไม่ใช่คำสั่งซื้อขาย ให้บันทึกราคาที่ซื้อขายจริงลงใน transaction ledger ซึ่งเป็นบันทึกจริงของกองทุน ไม่ใช่หน้านี้")}
            </div>
            <button className="btn ghost" type="button" onClick={() => onNavigate("portfolio")} style={{ marginTop: 12 }}>{tr(lang, "Open the transaction ledger", "เปิด transaction ledger")}</button>
          </>
        ) : (
          <div className="notice">{tr(lang, "Nothing to hand over. No motion carried with a size attached.", "ไม่มีรายการส่งต่อ ไม่มีญัตติที่ผ่านพร้อมจำนวนเงิน")}</div>
        )}
      </section>

      {/* ── 7. Resolutions and dissent ── */}
      <section className="card" id="ic-resolutions">
        <Head n="9" title={tr(lang, "Resolutions", "มติที่ประชุม")} />
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>{tr(lang, "Status", "สถานะ")}</th><th>{tr(lang, "Resolution", "มติ")}</th><th>{tr(lang, "Owner", "ผู้รับผิดชอบ")}</th><th>{tr(lang, "Review by", "ทบทวนภายใน")}</th></tr></thead>
            <tbody>
              {meeting.resolutions.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap", color: r.status === "APPROVED" ? "#34d399" : r.status === "DEFERRED" ? "#fbbf24" : "#94a3b8", fontWeight: 600 }}>{r.status}</td>
                  <td style={{ fontSize: 13 }}>{r.text}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.owner}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.reviewBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {meeting.dissent.length > 0 && (
          <>
            <h4 className="sub" style={{ marginTop: 20 }}>{tr(lang, "Dissent on the record", "ความเห็นแย้งที่บันทึกไว้")}</h4>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              {tr(lang, "These desks voted against a motion that carried. The objection stands until the review date — if it turns out to have been right, the record shows who said so.",
                "ฝ่ายเหล่านี้ลงมติคัดค้านญัตติที่ผ่าน ความเห็นแย้งจะคงอยู่จนถึงวันทบทวน หากภายหลังพบว่าถูกต้อง บันทึกนี้จะแสดงว่าใครเป็นผู้ทักท้วง")}
            </p>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
              {meeting.dissent.map((d, i) => <li key={i}><strong>{d.ticker}</strong> · {d.member} — {d.rationale}</li>)}
            </ul>
          </>
        )}
      </section>

      {/* ── 8. Risk register and round table ── */}
      <section className="card" id="ic-risk">
        <Head n="10" title={tr(lang, "Risk register and round table", "ทะเบียนความเสี่ยงและความเห็นรอบโต๊ะ")} />
        <p className="muted" style={{ marginTop: 0 }}>
          {tr(lang, "Any desk may file a risk, with the measurement behind it. Risk is not one person's column.",
            "ทุกฝ่ายสามารถแจ้งความเสี่ยงได้ พร้อมหลักฐานการวัด ความเสี่ยงไม่ใช่หน้าที่ของคนเดียว")}
        </p>
        {meeting.riskRegister.length ? (
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="tbl">
              <thead><tr><th>{tr(lang, "Severity", "ระดับ")}</th><th>{tr(lang, "Risk", "ความเสี่ยง")}</th><th>{tr(lang, "Evidence", "หลักฐาน")}</th><th>{tr(lang, "Raised by", "แจ้งโดย")}</th><th>{tr(lang, "Suggested action", "ข้อเสนอ")}</th></tr></thead>
              <tbody>
                {meeting.riskRegister.map((risk, i) => (
                  <tr key={i}>
                    <td style={{ color: risk.severity === "high" ? "#f87171" : risk.severity === "medium" ? "#fbbf24" : "#94a3b8", fontWeight: 600, textTransform: "uppercase" }}>{risk.severity}</td>
                    <td style={{ fontSize: 13 }}>{risk.item}</td>
                    <td style={{ fontSize: 13 }} className="muted">{risk.evidence}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{risk.raisedBy}</td>
                    <td style={{ fontSize: 13 }}>{risk.suggestedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="notice" style={{ marginTop: 14 }}>{tr(lang, "No desk filed a risk with evidence behind it this meeting.", "ไม่มีฝ่ายใดแจ้งความเสี่ยงพร้อมหลักฐานในการประชุมนี้")}</div>}

        {meeting.roundTable.length > 0 && (
          <>
            <h4 className="sub" style={{ marginTop: 20 }}>{tr(lang, "Round table", "ความเห็นรอบโต๊ะ")}</h4>
            <div className="grid cols-2" style={{ marginTop: 10 }}>
              {meeting.roundTable.map((entry) => (
                <article key={entry.member} className="metric" style={{ alignItems: "flex-start", opacity: entry.tabled ? 1 : 0.65 }}>
                  <div className="label">{entry.member} · {entry.role}</div>
                  <strong className="value" style={{ fontSize: 13, lineHeight: 1.5, fontWeight: 500 }}>{entry.view}</strong>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      {/* ── Stage 5: the only place a decision becomes a ledger entry ── */}
      <div id="ic-approval">
        <MeetingApprovalPanel
          lang={lang}
          meetingId={meeting.meetingId}
          meeting={{ asOf: meeting.asOf, regime: meeting.regime, quorum: meeting.quorum, agenda: meeting.agenda, minutes: meeting.minutes, resolutions: meeting.resolutions, dissent: meeting.dissent }}
          motions={meeting.motions
            .filter((m) => m.outcome === "CARRIED" && m.sizeUsd !== 0)
            .map((m) => ({
              id: m.id, ticker: m.ticker, kind: m.kind, sizeUsd: m.sizeUsd, approxShares: m.approxShares,
              referencePrice: meeting.blotter.find((b) => b.ticker === m.ticker)?.referencePrice ?? null,
              outcome: m.outcome, outcomeReason: m.outcomeReason,
            }))}
          onApplied={() => setRefreshKey((v) => v + 1)}
        />
      </div>

      {/* ── 9. Minutes ── */}
      <section className="card" id="ic-minutes">
        <Head n="11" title={tr(lang, "Minutes", "รายงานการประชุม")} />
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
          {meeting.minutes.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
        <h4 className="sub" style={{ marginTop: 20 }}>{tr(lang, "Disclosures", "ข้อเปิดเผย")}</h4>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }} className="muted">
          {meeting.disclosures.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
        {meeting.standingDuty && <div className="notice" style={{ marginTop: 16 }}><b>{tr(lang, "Standing duty", "หน้าที่ประจำ")}</b><p style={{ margin: "6px 0 0" }}>{meeting.standingDuty}</p></div>}
      </section>

      <section className="card">
        <div className="grid cols-3">
          <Guard title={tr(lang, "NO AUTO EXECUTION", "ไม่มีการส่งคำสั่งอัตโนมัติ")} text={tr(lang, "The committee produces proposals. It has no path to a broker.", "ที่ประชุมออกข้อเสนอเท่านั้น ไม่มีช่องทางเชื่อมต่อโบรกเกอร์")} />
          <Guard title={tr(lang, "ABSTENTION IS HONEST", "การงดออกเสียงคือความซื่อตรง")} text={tr(lang, "A desk that could not measure its input says so instead of voting.", "ฝ่ายที่วัดข้อมูลของตนไม่ได้จะแจ้งไว้ แทนการลงมติ")} />
          <Guard title={tr(lang, "SOURCES FUND USES", "แหล่งเงินต้องพอกับการใช้")} text={tr(lang, "An approval the fund cannot pay for is not a decision.", "การอนุมัติที่กองทุนจ่ายไม่ไหว ไม่ถือเป็นการตัดสินใจ")} />
        </div>
      </section>
    </div>
  );
}

function Head({ n, title }: { n: string; title: string }) {
  return <h3 className="sub" style={{ marginTop: 0 }}><span className="tag" style={{ marginRight: 8 }}>{n}</span>{title}</h3>;
}
function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><div className="label">{label}</div><strong className="value" style={{ fontSize: 20, lineHeight: 1.25 }}>{value}</strong></div>;
}
function Guard({ title, text }: { title: string; text: string }) {
  return <div className="metric"><div className="label">{title}</div><strong className="value" style={{ fontSize: 13, lineHeight: 1.45, fontWeight: 500 }}>{text}</strong></div>;
}
function Coverage({ value }: { value: number }) {
  const tone = value >= 80 ? "#34d399" : value >= 50 ? "#fbbf24" : "#f87171";
  return (
    <div>
      <strong style={{ fontSize: 16, color: tone }}>{value}%</strong>
      <div style={{ height: 5, borderRadius: 999, background: "rgba(148,163,184,.18)", overflow: "hidden", marginTop: 4 }}>
        <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, value))}%`, background: tone }} />
      </div>
    </div>
  );
}
