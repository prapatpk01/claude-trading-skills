"use client";

// Stage 5 reconciles real broker-side activity already recorded in Holdings.
// It never creates a second trade. Missing rows are refreshed automatically so
// a reconciliation that ran before the owner recorded the fill cannot stay
// stuck at NOT_FOUND.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReconciliationMatch } from "@/lib/committeeReconciliation";
import type { AppLang } from "../page";

type Verdict = "PENDING" | "APPROVED" | "AMENDED" | "REJECTED";

export interface ApprovalMotion {
  id: string;
  ticker: string;
  kind: string;
  sizeUsd: number;
  approxShares: number | null;
  referencePrice: number | null;
  outcome: string;
  outcomeReason: string;
}

interface Line extends ApprovalMotion {
  verdict: Verdict;
  note: string;
}

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const money = (value: number | null | undefined) => value == null
  ? "—"
  : `${value < 0 ? "−" : ""}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
const statusTone: Record<ReconciliationMatch["status"], string> = {
  MATCHED: "#34d399",
  DIFFERENT: "#fbbf24",
  NOT_FOUND: "#94a3b8",
};
const makeLines = (motions: ApprovalMotion[]): Line[] =>
  motions.filter((motion) => motion.kind !== "HOLD").map((motion) => ({ ...motion, verdict: "PENDING", note: "" }));

export default function MeetingApprovalPanel({
  lang, meetingId, meeting, motions, approvalReady = true, approvalBlockReason, onApplied,
}: {
  lang: AppLang;
  meetingId: string;
  meeting?: Record<string, unknown>;
  motions: ApprovalMotion[];
  approvalReady?: boolean;
  approvalBlockReason?: string;
  onApplied?: () => void;
}) {
  const initialDate = String(meeting?.asOf ?? new Date().toISOString()).slice(0, 10);
  const [approvedBy, setApprovedBy] = useState(() => typeof window === "undefined" ? "" : localStorage.getItem("sentinel.approverName") ?? "");
  const [tradeDate, setTradeDate] = useState(initialDate);
  const [lines, setLines] = useState<Line[]>(() => makeLines(motions));
  const [matches, setMatches] = useState<ReconciliationMatch[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkedOnce, setCheckedOnce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const initialCheckStarted = useRef(false);
  const activeMeeting = useRef(meetingId);

  useEffect(() => {
    if (activeMeeting.current === meetingId) return;
    activeMeeting.current = meetingId;
    initialCheckStarted.current = false;
    setTradeDate(String(meeting?.asOf ?? new Date().toISOString()).slice(0, 10));
    setLines(makeLines(motions));
    setMatches([]);
    setCheckedOnce(false);
    setResult(null);
    setError(null);
  }, [meetingId, meeting?.asOf, motions]);

  const matchById = useMemo(() => new Map(matches.map((match) => [match.resolutionId, match])), [matches]);
  const update = (id: string, patch: Partial<Line>) => setLines((previous) => previous.map((line) => line.id === id ? { ...line, ...patch } : line));

  const reconcile = useCallback(async () => {
    if (!lines.length || checking || result) return;
    setChecking(true);
    setError(null);
    try {
      const response = await fetch(`/api/committee/minutes?refresh=${Date.now()}`, {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingId,
          tradeDate,
          tolerancePct: 40,
          motions: lines.map((line) => ({
            id: line.id,
            ticker: line.ticker,
            kind: line.kind,
            proposedUsd: line.sizeUsd,
            proposedShares: line.approxShares,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? "Holdings reconciliation failed.");
      const found: ReconciliationMatch[] = Array.isArray(json.matches) ? json.matches : [];
      setMatches(found);
      const byId = new Map(found.map((match) => [match.resolutionId, match]));
      setLines((previous) => previous.map((line) => {
        if (line.verdict === "REJECTED") return line;
        const match = byId.get(line.id);
        return { ...line, verdict: match?.status === "MATCHED" ? "APPROVED" : "PENDING" };
      }));
      setCheckedOnce(true);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Holdings reconciliation failed.");
    } finally {
      setChecking(false);
    }
  }, [checking, lines, meetingId, result, tradeDate]);

  useEffect(() => {
    if (initialCheckStarted.current || !lines.length) return;
    initialCheckStarted.current = true;
    void reconcile();
  }, [lines.length, reconcile]);

  const hasNotFound = checkedOnce && matches.some((match) => match.status === "NOT_FOUND");

  // A common workflow is: run meeting -> open Holdings -> record the real fill
  // -> come back. The first check may therefore be earlier than the trade. Keep
  // rechecking only while a line is genuinely missing; stop as soon as it is
  // found or the checklist is recorded.
  useEffect(() => {
    if (!hasNotFound || checking || result || typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden") void reconcile();
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [hasNotFound, checking, reconcile, result]);

  // Also refresh immediately when the owner returns to this tab/window instead
  // of waiting for the next polling interval.
  useEffect(() => {
    if (typeof window === "undefined" || result) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "hidden" && checkedOnce && hasNotFound) void reconcile();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [checkedOnce, hasNotFound, reconcile, result]);

  const pending = lines.filter((line) => line.verdict === "PENDING");
  const confirmed = lines.filter((line) => line.verdict === "APPROVED" || line.verdict === "AMENDED");
  const blockers = useMemo(() => {
    const output: string[] = [];
    if (!approvalReady) output.push(approvalBlockReason ?? tr(lang, "The capital plan is incomplete.", "แผนเงินทุนยังไม่ครบถ้วน"));
    if (!approvedBy.trim()) output.push(tr(lang, "Enter the portfolio owner's name once.", "กรอกชื่อเจ้าของพอร์ตหนึ่งครั้ง"));
    if (!checkedOnce) output.push(tr(lang, "Check the actual Holdings transactions first.", "กดตรวจรายการจริงจาก Holdings ก่อน"));
    if (pending.length) output.push(tr(lang, `Decide the remaining ${pending.length} line(s): confirm or reject.`, `ตัดสินใจอีก ${pending.length} รายการ: ยืนยันหรือปฏิเสธ`));
    return output;
  }, [approvalReady, approvalBlockReason, approvedBy, checkedOnce, pending.length, lang]);

  async function submit() {
    if (blockers.length || submitting || result) return;
    setSubmitting(true);
    setError(null);
    try {
      localStorage.setItem("sentinel.approverName", approvedBy.trim());
      const response = await fetch("/api/committee/minutes", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "RECONCILE_EXISTING",
          tolerancePct: 40,
          humanApproved: true,
          approvedBy: approvedBy.trim(),
          meetingId,
          tradeDate,
          ...(meeting ?? {}),
          decisions: lines.map((line) => ({
            resolutionId: line.id,
            ticker: line.ticker,
            kind: line.kind,
            proposedUsd: line.sizeUsd,
            proposedShares: line.approxShares,
            verdict: line.verdict,
            note: line.note || null,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(json?.error ?? "The reconciliation could not be recorded.");
      setResult(json);
      onApplied?.();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The reconciliation could not be recorded.");
    } finally {
      setSubmitting(false);
    }
  }

  const locked = Boolean(result);

  return (
    <section className="card" data-approval-version="2.1-live-reconcile" style={{ borderTop: "2px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <span className="tag">{tr(lang, "STAGE 8 · RECONCILIATION & MINUTES", "ขั้นที่ 8 · กระทบยอดและปิดรายงานประชุม")}</span>
          <h3 className="sub" style={{ margin: "10px 0 6px" }}>{tr(lang, "After broker execution, update Holdings and confirm the matches", "หลังซื้อขายจริง ให้อัปเดต Holdings แล้วตรวจยืนยันรายการที่จับคู่ได้")}</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 820, fontSize: 13 }}>
            {tr(lang,
              "The system matches ticker, BUY/SELL direction and transactions from the meeting date. A size within ±40% is checked automatically. If a fill is recorded after the first check, missing lines refresh automatically. Recording this checklist does not create another trade.",
              "ระบบจับคู่ชื่อหุ้น ฝั่ง BUY/SELL และธุรกรรมตั้งแต่วันประชุม หากขนาดต่างไม่เกิน ±40% จะติ๊กให้อัตโนมัติ หากบันทึกรายการจริงหลังการตรวจครั้งแรก รายการที่ยังไม่พบจะตรวจซ้ำอัตโนมัติ การบันทึกเช็กลิสต์จะไม่สร้างรายการซื้อขายซ้ำ")}
          </p>
        </div>
        <span className="tag">{meetingId}</span>
      </div>

      {!approvalReady && <div className="err" style={{ marginTop: 16 }}>⚠ {tr(lang, "APPROVAL LOCKED", "ล็อกการอนุมัติ")} · {approvalBlockReason}</div>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
        <input type="date" value={tradeDate} disabled={locked || checking} onChange={(event) => { setTradeDate(event.target.value); setCheckedOnce(false); setMatches([]); initialCheckStarted.current = false; }} />
        <button className="btn" type="button" onClick={reconcile} disabled={locked || checking || !lines.length}>
          {checking ? tr(lang, "Checking Holdings…", "กำลังตรวจ Holdings…") : tr(lang, "↻ Check actual Holdings", "↻ ตรวจรายการจริงจาก Holdings")}
        </button>
        {checkedOnce && <span className="tag">{matches.filter((match) => match.status === "MATCHED").length} {tr(lang, "auto-matched", "ตรงอัตโนมัติ")} · {matches.filter((match) => match.status === "DIFFERENT").length} {tr(lang, "different size", "ขนาดต่าง")}</span>}
        {hasNotFound && !locked && <span className="tag" style={{ color: "#fbbf24", borderColor: "#fbbf24" }}>{tr(lang, "Auto-refreshing missing trades", "กำลังตรวจซ้ำรายการที่ยังไม่พบ")}</span>}
      </div>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="tbl">
          <thead><tr>
            <th>{tr(lang, "Proposal", "ข้อเสนอ")}</th>
            <th>{tr(lang, "Actual Holdings transaction", "รายการจริงใน Holdings")}</th>
            <th>{tr(lang, "Auto status", "ผลตรวจอัตโนมัติ")}</th>
            <th>{tr(lang, "Your checklist", "เช็กลิสต์ของคุณ")}</th>
            <th>{tr(lang, "Note", "หมายเหตุ")}</th>
          </tr></thead>
          <tbody>{lines.map((line) => {
            const match = matchById.get(line.id);
            const accepted = line.verdict === "APPROVED" || line.verdict === "AMENDED";
            return <tr key={line.id} style={{ opacity: line.verdict === "REJECTED" ? 0.55 : 1 }}>
              <td style={{ whiteSpace: "nowrap" }}><strong>{line.kind} {line.ticker}</strong><small style={{ display: "block", color: "var(--muted)" }}>{money(line.sizeUsd)} · ~{line.approxShares ?? "—"} {tr(lang, "shares", "หุ้น")}</small></td>
              <td>{match?.actualShares != null ? <><strong>{match.expectedSide} {match.actualShares} {tr(lang, "shares", "หุ้น")}</strong><small style={{ display: "block", color: "var(--muted)" }}>@ ${match.actualPrice?.toFixed(2)} · {money(match.actualValueUsd)}</small></> : <span className="muted">{tr(lang, "Not found", "ยังไม่พบรายการ")}</span>}</td>
              <td><span className="tag" style={{ color: match ? statusTone[match.status] : "#94a3b8", borderColor: match ? statusTone[match.status] : undefined }}>{match?.status ?? "NOT CHECKED"}</span>{match?.variancePct != null && <small style={{ display: "block", marginTop: 5, color: "var(--muted)" }}>{match.variancePct > 0 ? "+" : ""}{match.variancePct}% {tr(lang, "vs proposal", "เทียบข้อเสนอ")}</small>}</td>
              <td style={{ minWidth: 210 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <input type="checkbox" checked={accepted} disabled={locked || !match || match.status === "NOT_FOUND"} onChange={(event) => update(line.id, { verdict: event.target.checked ? (match?.status === "MATCHED" ? "APPROVED" : "AMENDED") : "PENDING" })} />
                  {tr(lang, "This is a trade I actually made", "นี่คือรายการที่ฉันซื้อขายจริง")}
                </label>
                <button className="btn ghost sm" type="button" disabled={locked} onClick={() => update(line.id, { verdict: line.verdict === "REJECTED" ? "PENDING" : "REJECTED" })} style={{ marginTop: 7, color: line.verdict === "REJECTED" ? "#f87171" : undefined }}>
                  {line.verdict === "REJECTED" ? tr(lang, "Rejected ✓", "ปฏิเสธแล้ว ✓") : tr(lang, "Reject proposal", "ไม่เห็นด้วย / ปฏิเสธ")}
                </button>
              </td>
              <td><input value={line.note} disabled={locked} onChange={(event) => update(line.id, { note: event.target.value })} placeholder={tr(lang, "optional", "ไม่บังคับ")} style={{ minWidth: 140 }} /></td>
            </tr>;
          })}</tbody>
        </table>
      </div>

      <div className="searchbar" style={{ marginTop: 16 }}>
        <input value={approvedBy} disabled={locked} onChange={(event) => setApprovedBy(event.target.value)} placeholder={tr(lang, "Portfolio owner name", "ชื่อเจ้าของพอร์ต")} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn" type="button" onClick={submit} disabled={locked || submitting || blockers.length > 0}>
          {submitting ? tr(lang, "Recording…", "กำลังบันทึก…") : locked ? tr(lang, "Recorded", "บันทึกแล้ว") : tr(lang, `Record checklist: ${confirmed.length} confirmed`, `บันทึกเช็กลิสต์: ยืนยัน ${confirmed.length} รายการ`)}
        </button>
      </div>

      {!locked && blockers.length > 0 && <div className="notice" style={{ marginTop: 12, borderColor: "var(--amber)" }}><b>{tr(lang, "Before recording", "ก่อนบันทึก")}</b><ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>{blockers.map((blocker, index) => <li key={index}>{blocker}</li>)}</ul></div>}
      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      {result && <div className="card" style={{ marginTop: 16, borderLeft: `3px solid ${result.failed?.length ? "#f87171" : "#34d399"}` }}>
        <h4 className="sub" style={{ marginTop: 0 }}>{tr(lang, "Reconciliation recorded", "บันทึกผลเทียบพอร์ตแล้ว")}</h4>
        <p><strong>{result.summary}</strong></p>
        {!!result.applied?.length && <div className="table-wrap"><table className="tbl"><thead><tr><th>{tr(lang, "Actual", "รายการจริง")}</th><th>{tr(lang, "Ticker", "หุ้น")}</th><th className="num">{tr(lang, "Shares", "จำนวนหุ้น")}</th><th className="num">{tr(lang, "Average price", "ราคาเฉลี่ย")}</th><th>{tr(lang, "Result", "ผล")}</th></tr></thead><tbody>{result.applied.map((item: any, index: number) => <tr key={index}><td>{item.side}</td><td><strong>{item.ticker}</strong></td><td className="num">{item.shares}</td><td className="num">${Number(item.price).toFixed(2)}</td><td>{item.verdict}{item.reconciliationStatus === "DIFFERENT" ? " · AMENDED SIZE" : ""}</td></tr>)}</tbody></table></div>}
        {!!result.failed?.length && <div className="err" style={{ marginTop: 12 }}><ul style={{ margin: 0, paddingLeft: 18 }}>{result.failed.map((item: any, index: number) => <li key={index}>{item.ticker} — {item.error}</li>)}</ul></div>}
        <p className="muted" style={{ fontSize: 12 }}>{result.note}</p>
      </div>}
    </section>
  );
}
