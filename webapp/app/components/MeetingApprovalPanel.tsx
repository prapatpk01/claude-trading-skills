"use client";

// Stage 5: the human approval screen.
//
// This is the only place in the app where a person turns the committee's
// recommendation into a ledger entry. Three things it deliberately will not do:
//
//   It does not pre-approve anything. Every line starts undecided, including
//   the ones the committee carried unanimously.
//   It does not carry the committee's reference price into the ledger. That
//   number is an estimate; a fill is a fact, and the two must not be confused.
//   It does not submit twice. Once a meeting is applied the form locks.

import { useMemo, useState } from "react";
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
  shares: string;
  price: string;
  note: string;
}

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const money = (v: number) => `${v < 0 ? "−" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
const SELLS = new Set(["EXIT", "TRIM", "RAISE CASH"]);
const VERDICT_TONE: Record<Verdict, string> = { PENDING: "#64748b", APPROVED: "#34d399", AMENDED: "#38bdf8", REJECTED: "#f87171" };

export default function MeetingApprovalPanel({
  lang, meetingId, meeting, motions, onApplied,
}: {
  lang: AppLang;
  meetingId: string;
  /** The meeting object, passed through to the minutes record verbatim. */
  meeting?: Record<string, unknown>;
  motions: ApprovalMotion[];
  onApplied?: () => void;
}) {
  const [approvedBy, setApprovedBy] = useState("");
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<Line[]>(() =>
    motions.filter((m) => m.kind !== "HOLD").map((m) => ({
      ...m,
      verdict: "PENDING" as Verdict,
      shares: m.approxShares != null ? String(m.approxShares) : "",
      price: "",
      note: "",
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const decided = lines.filter((l) => l.verdict !== "PENDING");
  const willTrade = lines.filter((l) => l.verdict === "APPROVED" || l.verdict === "AMENDED");
  const missingPrice = willTrade.filter((l) => !(Number(l.price) > 0));
  const missingShares = willTrade.filter((l) => !(Number(l.shares) > 0));

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!approvedBy.trim()) out.push(tr(lang, "An approver name is required.", "ต้องระบุชื่อผู้อนุมัติ"));
    if (!decided.length) out.push(tr(lang, "No line has been decided yet.", "ยังไม่ได้ตัดสินใจรายการใดเลย"));
    if (missingPrice.length) out.push(tr(lang, `An execution price is missing for ${missingPrice.map((l) => l.ticker).join(", ")}.`, `ยังไม่ได้กรอกราคาที่ซื้อขายจริงของ ${missingPrice.map((l) => l.ticker).join(", ")}`));
    if (missingShares.length) out.push(tr(lang, `A share count is missing for ${missingShares.map((l) => l.ticker).join(", ")}.`, `ยังไม่ได้กรอกจำนวนหุ้นของ ${missingShares.map((l) => l.ticker).join(", ")}`));
    return out;
  }, [approvedBy, decided.length, missingPrice, missingShares, lang]);

  async function submit() {
    if (blockers.length || submitting || result?.recorded) return;
    setSubmitting(true); setError(null);
    try {
      const response = await fetch("/api/committee/minutes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          humanApproved: true,
          approvedBy: approvedBy.trim(),
          meetingId,
          tradeDate,
          ...(meeting ?? {}),
          decisions: decided.map((l) => ({
            resolutionId: l.id, ticker: l.ticker, kind: l.kind,
            proposedUsd: l.sizeUsd, proposedShares: l.approxShares,
            verdict: l.verdict,
            approvedShares: Number(l.shares) || null,
            approvedPrice: Number(l.price) || null,
            note: l.note || null,
          })),
        }),
      });
      const json = await response.json();
      if (!response.ok && response.status !== 207) throw new Error(json?.error ?? "The approval could not be submitted.");
      setResult(json);
      onApplied?.();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The approval could not be submitted.");
    } finally { setSubmitting(false); }
  }

  const locked = Boolean(result);

  return (
    <section className="card" data-approval-version="1.0" style={{ borderTop: "2px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <span className="tag">{tr(lang, "STAGE 5 · HUMAN APPROVAL", "ขั้นที่ 5 · การอนุมัติโดยมนุษย์")}</span>
          <h3 className="sub" style={{ margin: "10px 0 6px" }}>{tr(lang, "Approve, amend or reject each line", "อนุมัติ แก้ไข หรือปฏิเสธทีละรายการ")}</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 780, fontSize: 13 }}>
            {tr(lang,
              "Every line starts undecided, including the ones the committee carried unanimously. Record the price the trade actually filled at — the committee's reference price is an estimate, and the ledger holds facts.",
              "ทุกรายการเริ่มต้นที่ยังไม่ตัดสินใจ แม้แต่รายการที่ที่ประชุมผ่านเป็นเอกฉันท์ ให้กรอกราคาที่ซื้อขายได้จริง — ราคาอ้างอิงของที่ประชุมเป็นค่าประมาณ ส่วน ledger เก็บข้อเท็จจริง")}
          </p>
        </div>
        <span className="tag">{meetingId}</span>
      </div>

      {lines.length === 0 ? (
        <div className="notice" style={{ marginTop: 16 }}>
          {tr(lang, "No motion carried with a trade attached. Nothing to approve.", "ไม่มีญัตติที่ผ่านพร้อมรายการซื้อขาย ไม่มีอะไรให้อนุมัติ")}
        </div>
      ) : (
        <>
          <div className="table-wrap" style={{ marginTop: 16 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{tr(lang, "Motion", "ญัตติ")}</th>
                  <th>{tr(lang, "Committee proposed", "ที่ประชุมเสนอ")}</th>
                  <th>{tr(lang, "Decision", "การตัดสินใจ")}</th>
                  <th className="num">{tr(lang, "Shares", "จำนวนหุ้น")}</th>
                  <th className="num">{tr(lang, "Fill price", "ราคาที่ได้จริง")}</th>
                  <th>{tr(lang, "Note", "หมายเหตุ")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const side = SELLS.has(l.kind) ? "SELL" : "BUY";
                  return (
                    <tr key={l.id} style={{ opacity: l.verdict === "REJECTED" ? 0.55 : 1 }}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <strong>{l.ticker}</strong>
                        <small style={{ display: "block", color: side === "SELL" ? "#f87171" : "#34d399", fontWeight: 600 }}>{side} · {l.kind}</small>
                      </td>
                      <td style={{ fontSize: 13 }}>
                        {money(l.sizeUsd)}{l.approxShares != null ? ` · ~${l.approxShares.toLocaleString()} ${tr(lang, "shares", "หุ้น")}` : ""}
                        <small style={{ display: "block", color: "var(--muted)" }}>{l.referencePrice == null ? tr(lang, "no reference price", "ไม่มีราคาอ้างอิง") : `${tr(lang, "ref", "อ้างอิง")} $${l.referencePrice.toFixed(2)}`}</small>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {(["APPROVED", "AMENDED", "REJECTED"] as Verdict[]).map((v) => (
                            <button
                              key={v} type="button" disabled={locked}
                              className={`btn ${l.verdict === v ? "" : "ghost"} sm`}
                              style={l.verdict === v ? { borderColor: VERDICT_TONE[v], color: VERDICT_TONE[v] } : undefined}
                              onClick={() => update(l.id, { verdict: l.verdict === v ? "PENDING" : v })}
                            >
                              {v === "APPROVED" ? tr(lang, "Approve", "อนุมัติ") : v === "AMENDED" ? tr(lang, "Amend", "แก้ไข") : tr(lang, "Reject", "ปฏิเสธ")}
                            </button>
                          ))}
                        </div>
                      </td>
                      <td className="num">
                        <input value={l.shares} disabled={locked || l.verdict === "REJECTED" || l.verdict === "PENDING"} inputMode="decimal"
                          onChange={(e) => update(l.id, { shares: e.target.value })} style={{ width: 90, textAlign: "right" }} />
                      </td>
                      <td className="num">
                        <input value={l.price} disabled={locked || l.verdict === "REJECTED" || l.verdict === "PENDING"} inputMode="decimal"
                          placeholder={tr(lang, "required", "ต้องกรอก")} onChange={(e) => update(l.id, { price: e.target.value })}
                          style={{ width: 100, textAlign: "right", borderColor: (l.verdict === "APPROVED" || l.verdict === "AMENDED") && !(Number(l.price) > 0) ? "#f87171" : undefined }} />
                      </td>
                      <td>
                        <input value={l.note} disabled={locked} onChange={(e) => update(l.id, { note: e.target.value })}
                          placeholder={tr(lang, "optional", "ไม่บังคับ")} style={{ minWidth: 130 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="searchbar" style={{ marginTop: 16 }}>
            <input value={approvedBy} disabled={locked} onChange={(e) => setApprovedBy(e.target.value)}
              placeholder={tr(lang, "Approver name — required", "ชื่อผู้อนุมัติ — ต้องกรอก")} style={{ flex: 1, minWidth: 200 }} />
            <input type="date" value={tradeDate} disabled={locked} onChange={(e) => setTradeDate(e.target.value)} />
            <button className="btn" type="button" onClick={submit} disabled={locked || submitting || blockers.length > 0}>
              {submitting ? tr(lang, "Applying…", "กำลังบันทึก…") : locked ? tr(lang, "Applied", "บันทึกแล้ว") : tr(lang, `Apply ${willTrade.length} trade(s) and record the minutes`, `บันทึก ${willTrade.length} รายการและเก็บรายงานการประชุม`)}
            </button>
          </div>

          {!locked && blockers.length > 0 && (
            <div className="notice" style={{ marginTop: 12, borderColor: "var(--amber)" }}>
              <b>{tr(lang, "Before this can be applied", "ก่อนบันทึกได้ ต้อง")}</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                {blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          )}
          {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
        </>
      )}

      {result && (
        <div className="card" style={{ marginTop: 16, borderLeft: `3px solid ${result.failed?.length ? "#f87171" : "#34d399"}` }}>
          <h4 className="sub" style={{ marginTop: 0 }}>{tr(lang, "Result", "ผลลัพธ์")}</h4>
          <p style={{ margin: "0 0 10px", fontSize: 14 }}><strong>{result.summary}</strong></p>
          {!!result.applied?.length && (
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>{tr(lang, "Side", "ฝั่ง")}</th><th>{tr(lang, "Ticker", "หุ้น")}</th><th className="num">{tr(lang, "Shares", "หุ้น")}</th><th className="num">{tr(lang, "Price", "ราคา")}</th><th>{tr(lang, "Verdict", "มติ")}</th></tr></thead>
                <tbody>
                  {result.applied.map((a: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: a.side === "SELL" ? "#f87171" : "#34d399", fontWeight: 700 }}>{a.side}</td>
                      <td><strong>{a.ticker}</strong></td>
                      <td className="num">{a.shares}</td>
                      <td className="num">${Number(a.price).toFixed(2)}</td>
                      <td>{a.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!result.failed?.length && (
            <div className="err" style={{ marginTop: 12 }}>
              <b>{tr(lang, "Not recorded", "ไม่ได้บันทึก")}</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {result.failed.map((f: any, i: number) => <li key={i}>{f.ticker} {f.kind} — {f.error}</li>)}
              </ul>
            </div>
          )}
          {!!result.skipped?.length && (
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              {tr(lang, "Required no transaction", "ไม่ต้องมีรายการซื้อขาย")}: {result.skipped.map((s: any) => `${s.ticker} (${s.reason})`).join(" · ")}
            </p>
          )}
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>{result.note}</p>
          <ul className="muted" style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
            {(result.disclosures ?? []).map((d: string, i: number) => <li key={i}>{d}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
