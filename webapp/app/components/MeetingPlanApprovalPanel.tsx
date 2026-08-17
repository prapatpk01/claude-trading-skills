"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppLang } from "../page";

type Verdict = "PENDING" | "APPROVED" | "REJECTED";
type Motion = {
  id: string;
  ticker: string;
  kind: string;
  sizeUsd: number;
  approxShares: number | null;
  outcomeReason: string;
};

const tr = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;
const money = (value: number) => `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const storageKey = (meetingId: string) => `sentinel:cio:plan-approval:${meetingId}`;

export default function MeetingPlanApprovalPanel({ lang, meetingId, motions, approvalReady, approvalBlockReason, meeting, onApproved }: {
  lang: AppLang;
  meetingId: string;
  motions: Motion[];
  approvalReady: boolean;
  approvalBlockReason?: string;
  meeting?: Record<string, unknown>;
  onApproved?: () => void;
}) {
  const [approvedBy, setApprovedBy] = useState("");
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [recorded, setRecorded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedName = localStorage.getItem("sentinel.approverName") ?? "";
    setApprovedBy(savedName);
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey(meetingId)) ?? "null");
      if (saved?.approvedBy && saved?.verdicts) {
        setApprovedBy(saved.approvedBy);
        setVerdicts(saved.verdicts);
        setRecorded(true);
        onApproved?.();
      } else {
        setVerdicts(Object.fromEntries(motions.map((motion) => [motion.id, "PENDING"])));
        setRecorded(false);
      }
    } catch {
      localStorage.removeItem(storageKey(meetingId));
    }
  }, [meetingId, motions, onApproved]);

  const pending = motions.filter((motion) => (verdicts[motion.id] ?? "PENDING") === "PENDING");
  const approved = motions.filter((motion) => verdicts[motion.id] === "APPROVED");
  const blockers = useMemo(() => {
    const rows: string[] = [];
    if (!approvalReady) rows.push(approvalBlockReason ?? tr(lang, "Capital allocation is incomplete.", "แผนจัดสรรเงินยังไม่ครบ"));
    if (!approvedBy.trim()) rows.push(tr(lang, "Enter the portfolio owner's name.", "กรอกชื่อเจ้าของพอร์ต"));
    if (pending.length) rows.push(tr(lang, `Decide ${pending.length} remaining line(s).`, `ตัดสินใจอีก ${pending.length} รายการ`));
    return rows;
  }, [approvalReady, approvalBlockReason, approvedBy, pending.length, lang]);

  async function submit() {
    if (recorded || submitting || blockers.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/committee/minutes", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "PLAN_APPROVAL",
          humanApproved: true,
          approvedBy: approvedBy.trim(),
          meetingId,
          ...(meeting ?? {}),
          decisions: motions.map((motion) => ({
            resolutionId: motion.id,
            ticker: motion.ticker,
            kind: motion.kind,
            proposedUsd: motion.sizeUsd,
            proposedShares: motion.approxShares,
            verdict: verdicts[motion.id],
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok && response.status !== 207 && response.status !== 409) throw new Error(json?.error ?? "Plan approval failed.");
      localStorage.setItem("sentinel.approverName", approvedBy.trim());
      localStorage.setItem(storageKey(meetingId), JSON.stringify({ approvedBy: approvedBy.trim(), verdicts, recordedAt: new Date().toISOString() }));
      setRecorded(true);
      onApproved?.();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Plan approval failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="card" data-plan-approval="pre-execution" style={{ borderTop: "2px solid var(--accent)" }}>
    <span className="tag">06 · HUMAN PLAN APPROVAL</span>
    <h3 className="sub" style={{ margin: "10px 0 6px" }}>{tr(lang, "Approve the plan before any broker action", "อนุมัติแผนก่อนดำเนินการที่โบรกเกอร์")}</h3>
    <p className="muted" style={{ maxWidth: 900, lineHeight: 1.6 }}>{tr(lang, "Approve or reject every actionable line. This records authority only—it does not place a broker order and does not change Holdings.", "อนุมัติหรือปฏิเสธทุกรายการที่ต้องดำเนินการ ขั้นนี้บันทึกอำนาจอนุมัติเท่านั้น ไม่ส่งคำสั่งไปโบรกเกอร์และไม่เปลี่ยน Holdings")}</p>
    {!approvalReady && <div className="err">⚠ {approvalBlockReason}</div>}
    <div className="table-wrap" style={{ marginTop: 14 }}><table className="tbl"><thead><tr><th>{tr(lang, "Plan", "แผน")}</th><th>{tr(lang, "Size", "วงเงิน")}</th><th>{tr(lang, "Committee reason", "เหตุผล Committee")}</th><th>{tr(lang, "Owner decision", "การตัดสินใจของเจ้าของพอร์ต")}</th></tr></thead><tbody>{motions.map((motion) => <tr key={motion.id}><td><strong>{motion.kind} · {motion.ticker}</strong></td><td>{money(motion.sizeUsd)}<small className="muted" style={{ display: "block" }}>~{motion.approxShares ?? "—"} shares</small></td><td style={{ minWidth: 260, fontSize: 12 }}>{motion.outcomeReason}</td><td><div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}><button className={`btn sm ${verdicts[motion.id] === "APPROVED" ? "" : "ghost"}`} type="button" disabled={recorded} onClick={() => setVerdicts((previous) => ({ ...previous, [motion.id]: "APPROVED" }))}>{tr(lang, "Approve", "อนุมัติ")}</button><button className="btn ghost sm" type="button" disabled={recorded} style={{ color: verdicts[motion.id] === "REJECTED" ? "#f87171" : undefined }} onClick={() => setVerdicts((previous) => ({ ...previous, [motion.id]: "REJECTED" }))}>{tr(lang, "Reject", "ปฏิเสธ")}</button></div></td></tr>)}{!motions.length && <tr><td colSpan={4} className="muted">{tr(lang, "No actionable line requires approval.", "ไม่มีรายการที่ต้องอนุมัติ")}</td></tr>}</tbody></table></div>
    <div className="searchbar" style={{ marginTop: 14 }}><input value={approvedBy} disabled={recorded} onChange={(event) => setApprovedBy(event.target.value)} placeholder={tr(lang, "Portfolio owner name", "ชื่อเจ้าของพอร์ต")} /><button className="btn" type="button" disabled={recorded || submitting || blockers.length > 0 || !motions.length} onClick={submit}>{recorded ? tr(lang, "Plan authorized", "อนุมัติแผนแล้ว") : submitting ? tr(lang, "Recording…", "กำลังบันทึก…") : tr(lang, `Authorize ${approved.length} line(s)`, `รับรอง ${approved.length} รายการ`)}</button></div>
    {!recorded && blockers.length > 0 && <div className="notice" style={{ marginTop: 12 }}><strong>{tr(lang, "Before authorization", "ก่อนอนุมัติ")}</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{blockers.map((row) => <li key={row}>{row}</li>)}</ul></div>}
    {recorded && <div className="notice" style={{ marginTop: 12, borderColor: "#34d399" }}>✓ {tr(lang, "The execution plan is authorized. Open Stage 7 for the Trade Blotter; after real trades are entered in Holdings, finish Stage 8 reconciliation.", "แผนดำเนินการได้รับอนุมัติแล้ว เปิดขั้นที่ 7 เพื่อดู Trade Blotter และหลังบันทึกรายการจริงใน Holdings ให้ปิดงานด้วยการกระทบยอดขั้นที่ 8")}</div>}
    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
  </section>;
}
