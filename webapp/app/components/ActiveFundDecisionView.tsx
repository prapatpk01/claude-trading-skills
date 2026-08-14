"use client";

import { useState } from "react";
import type { AppLang } from "../page";
import { money } from "./format";

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";

type CommitteeSnapshot = {
  meetingId: string | null;
  asOf: string | null;
  motions: any[];
  source: "FROZEN CIO MEETING" | "FRESH CIO GATE";
};

async function committeeSnapshot(): Promise<CommitteeSnapshot> {
  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(FROZEN_MEETING_KEY);
      if (saved) {
        const meeting = JSON.parse(saved);
        if (meeting?.meetingId && Array.isArray(meeting?.motions)) {
          return { meetingId: meeting.meetingId, asOf: meeting.asOf ?? null, motions: meeting.motions, source: "FROZEN CIO MEETING" };
        }
      }
    } catch {
      window.localStorage.removeItem(FROZEN_MEETING_KEY);
    }
  }

  const response = await fetch(`/api/committee/meeting?authority=${Date.now()}`, {
    cache: "no-store",
    headers: { Accept: "application/json", "Cache-Control": "no-cache" },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json?.error ?? "Committee authority snapshot failed");
  return {
    meetingId: json?.meetingId ?? null,
    asOf: json?.asOf ?? null,
    motions: Array.isArray(json?.motions) ? json.motions : [],
    source: "FRESH CIO GATE",
  };
}

function compactCommittee(snapshot: CommitteeSnapshot) {
  return {
    meetingId: snapshot.meetingId,
    asOf: snapshot.asOf,
    motions: snapshot.motions.map((motion: any) => ({
      ticker: motion?.ticker,
      kind: motion?.kind,
      outcome: motion?.outcome,
      outcomeReason: motion?.outcomeReason,
      veto: motion?.veto ?? null,
      decisionGates: Array.isArray(motion?.decisionGates) ? motion.decisionGates.map((gate: any) => ({
        stage: gate?.stage,
        status: gate?.status,
        rationale: gate?.rationale,
      })) : [],
    })),
  };
}

export default function ActiveFundDecisionView({ lang }: { lang: AppLang }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [authoritySource, setAuthoritySource] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const authority = await committeeSnapshot();
      setAuthoritySource(authority.source);
      const response = await fetch(`/api/active-fund?t=${Date.now()}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ committee: compactCommittee(authority) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Review failed");
      setData(json);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return <div className="card ai-card" style={{ marginTop: 18 }}>
    <h3 className="sub">🧠 {tr(lang, "Portfolio Decision Layer", "ชั้นตัดสินใจและจัดสรรพอร์ต")}</h3>
    <p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>
      {tr(lang,
        "SELL/TRIM proceeds are pooled into the Cash Buffer first. The Cash Floor is restored before any new risk purchase, and an ADD/INITIATE is allowed only when the current Committee carried it through all authority gates.",
        "เงินจาก SELL/TRIM จะรวมเข้า Cash Buffer ก่อน ระบบเติม Cash Floor ให้ครบก่อนการลงทุนใหม่ และ ADD/INITIATE จะใช้เงินจริงได้ต่อเมื่อ Committee รอบปัจจุบันอนุมัติผ่าน Authority Gate ครบเท่านั้น")}
    </p>
    <button className="btn" onClick={run} disabled={loading}>{loading ? tr(lang, "Checking Committee + building cash-pool plan…", "กำลังตรวจ Committee และสร้างแผน Cash Pool…") : tr(lang, "🏛 Run Governed Portfolio Review", "🏛 วิเคราะห์พอร์ตตามมติ Committee")}</button>
    {authoritySource && <span className="tag" style={{ marginLeft: 10 }}>{authoritySource}</span>}
    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={tr(lang, "US universe", "จักรวาลหุ้น US")} value={data.discovery?.broadUniverse ?? 0} />
        <Metric label={tr(lang, "Deep analyzed", "วิเคราะห์เชิงลึก")} value={data.discovery?.detailedAnalyzed ?? 0} />
        <Metric label={tr(lang, "Qualified", "ผ่าน Research")} value={data.discovery?.qualified ?? 0} />
        <Metric label={tr(lang, "New names", "หุ้นใหม่นอกพอร์ต")} value={data.discovery?.uniqueNew ?? 0} />
      </div>

      <CashPoolPlan plan={data.cashPoolPlan} lang={lang} />
      <FundingSummary liquidity={data.liquidity} lang={lang} />
      <ExecutionTable rows={data.executionPlans ?? []} lang={lang} />
      <IdeaTable rows={data.existing ?? []} title={tr(lang, "Current holdings", "หุ้นที่ถืออยู่")} lang={lang} />
      <IdeaTable rows={data.newIdeas ?? []} title={tr(lang, "New opportunities", "โอกาสใหม่")} lang={lang} />
      <ReplacementTable rows={data.replacements ?? []} lang={lang} />

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>{tr(lang, "Decision-support only. No broker order is sent automatically.", "ใช้เพื่อสนับสนุนการตัดสินใจเท่านั้น ระบบไม่ส่งคำสั่งไปโบรกเกอร์อัตโนมัติ")}</p>
    </>}
  </div>;
}

function CashPoolPlan({ plan, lang }: { plan: any; lang: AppLang }) {
  if (!plan) return null;
  return <div className="card" style={{ marginTop: 14, borderTop: "2px solid var(--accent)" }}>
    <h3 className="sub">💵 {tr(lang, "Cash Buffer Pool — one source of funds", "Cash Buffer Pool — รวมเงินก่อนจัดสรร")}</h3>
    <div className="grid cols-4">
      <Metric label={tr(lang, "Buffer before trims", "Buffer ก่อนขาย")} value={money(plan.bufferBeforeUsd ?? 0)} />
      <Metric label={tr(lang, "TRIM/EXIT proceeds", "เงินจาก TRIM/EXIT")} value={money(plan.saleProceedsUsd ?? 0)} />
      <Metric label={tr(lang, "Required floor", "Cash Floor ที่ต้องมี")} value={money(plan.floorUsd ?? 0)} />
      <Metric label={tr(lang, "Deployable after trims", "ส่วนเกินหลังขาย")} value={money(plan.deployableAfterSalesUsd ?? 0)} />
    </div>
    <div className="grid cols-4" style={{ marginTop: 10 }}>
      <Metric label={tr(lang, "Approved purchases", "ซื้อที่ Committee อนุมัติ")} value={money(plan.approvedPurchasesUsd ?? 0)} />
      <Metric label={tr(lang, "Buffer remaining", "Cash Buffer คงเหลือ")} value={money(plan.remainingBufferUsd ?? 0)} />
      <Metric label={tr(lang, "Deployable remaining", "ส่วนเกินที่ยังเหลือ")} value={money(plan.remainingDeployableUsd ?? 0)} />
      <Metric label={tr(lang, "Committee meeting", "รอบ Committee")} value={plan.committeeMeetingId || "—"} />
    </div>
    <div className="notice" style={{ marginTop: 10 }}><strong>{tr(lang, "Capital flow", "ลำดับเงิน")}: </strong>{lang === "th" ? plan.ruleTh : plan.rule}</div>
    {(plan.blockedBuys ?? []).length > 0 && <div className="err" style={{ marginTop: 10 }}>
      <strong>{tr(lang, "Blocked purchases stay at $0:", "รายการซื้อที่ถูกบล็อกจะเป็น $0:")}</strong>
      {(plan.blockedBuys ?? []).map((x: any) => <div key={x.ticker} style={{ marginTop: 6 }}><strong>{x.ticker}</strong> — {lang === "th" ? x.reasonTh : x.reason}</div>)}
    </div>}
  </div>;
}

function FundingSummary({ liquidity, lang }: { liquidity: any; lang: AppLang }) {
  if (!liquidity) return null;
  return <div className="card" style={{ marginTop: 14, background: "rgba(8,20,35,.55)" }}>
    <h3 className="sub">🛡️ {tr(lang, "Current Cash Buffer composition", "องค์ประกอบ Cash Buffer ปัจจุบัน")}</h3>
    <div className="grid cols-4">
      <Metric label="USD cash" value={money(liquidity.cashBalance ?? 0)} />
      <Metric label={tr(lang, "Dividend cash", "เงินปันผลพร้อมใช้")} value={money(liquidity.dividendAvailable ?? 0)} />
      <Metric label={tr(lang, "Current excess", "ส่วนเกินปัจจุบัน")} value={money(liquidity.deployableUsd ?? 0)} />
      <Metric label={tr(lang, "Cash floor", "Cash Floor")} value={`${liquidity.targetPct ?? 0}%`} />
    </div>
    <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>{tr(lang, "Reserve", "สินทรัพย์สำรอง")}</th><th className="num">{tr(lang, "Value", "มูลค่า")}</th></tr></thead><tbody>{(liquidity.positions ?? []).map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td className="num">{money(x.marketValue)}</td></tr>)}{!(liquidity.positions ?? []).length && <tr><td colSpan={2} className="muted">—</td></tr>}</tbody></table></div>
  </div>;
}

function ExecutionTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">📋 {tr(lang, "Portfolio Action Sheet", "Portfolio Action Sheet")}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Decision", "มติรอบนี้")}</th><th className="num">{tr(lang, "Amount", "วงเงิน")}</th><th className="num">{tr(lang, "Approx. shares", "หุ้นโดยประมาณ")}</th><th>{tr(lang, "Funding / destination", "แหล่งเงิน / ปลายทาง")}</th><th>{tr(lang, "Note", "เหตุผล")}</th></tr></thead><tbody>
    {rows.map((x: any, i: number) => <tr key={`${x.ticker}-${i}`}><td><strong>{x.ticker}</strong></td><td><strong>{lang === "th" ? x.instructionTh : x.instruction}</strong></td><td className="num">{Number(x.amountUsd) > 0 ? money(x.amountUsd) : "—"}</td><td className="num">{x.sharesApprox == null ? "—" : Number(x.sharesApprox).toFixed(3)}</td><td style={{ fontSize: 11.5 }}>{fundingText(x, lang)}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{lang === "th" ? x.noteTh : x.note}</td></tr>)}
    {!rows.length && <tr><td colSpan={6} className="muted">{tr(lang, "No action rows returned.", "ยังไม่มีรายการมติพอร์ตในรอบนี้")}</td></tr>}
  </tbody></table></div></>;
}

function IdeaTable({ rows, title, lang }: { rows: any[]; title: string; lang: AppLang }) {
  return <><h3 className="sub">{title}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "State", "สถานะ")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">{tr(lang, "Target", "ราคาเป้าหมาย")}</th><th className="num">{tr(lang, "vs spot", "เทียบ Spot")}</th><th>{tr(lang, "Valuation", "Valuation")}</th><th className="num">Momentum</th><th>{tr(lang, "Thesis", "Thesis")}</th></tr></thead><tbody>
    {rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td>{x.action ?? "—"}</td><td className="num"><strong>{priceText(x.currentPrice)}</strong></td><td className="num">{view.target}</td><td className={`num ${view.className}`}>{view.upside}</td><td style={{ fontSize: 11 }}><strong>{view.status}</strong><br/><span className="muted">{sourceText(x.valuationSource, lang)}</span>{view.warning ? <><br/><span className="neg">{view.warning}</span></> : null}</td><td className="num">{x.momentum == null ? "—" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{x.thesis}</td></tr>; })}
    {!rows.length && <tr><td colSpan={8} className="muted">{tr(lang, "No analyzed names returned.", "รอบนี้ยังไม่มีหลักทรัพย์ที่ผ่านการวิเคราะห์")}</td></tr>}
  </tbody></table></div></>;
}

function ReplacementTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🔄 {tr(lang, "Replacement Alpha — ranking only, cash still pools first", "Replacement Alpha — ใช้จัดอันดับ แต่เงินต้องรวม Cash Pool ก่อน")}</h3>{rows.length ? <div className="table-wrap"><table className="tbl"><thead><tr><th>{tr(lang, "Funding pool", "แหล่งเงินรวม")}</th><th>{tr(lang, "Destination", "ปลายทาง")}</th><th className="num">{tr(lang, "Amount", "วงเงิน")}</th><th>{tr(lang, "Reason", "เหตุผล")}</th></tr></thead><tbody>{rows.map((x: any, i: number) => <tr key={i}><td><strong>{x.from}</strong>{x.sourceHolding ? <small style={{ display: "block", color: "var(--muted)" }}>{tr(lang, "weak-link contributor", "หุ้น Weak Link")}: {x.sourceHolding}</small> : null}</td><td><strong>{x.to}</strong></td><td className="num">{money(x.rotateUsd)} · {x.rotatePct}% NAV</td><td style={{ fontSize: 11.5 }}>{x.reason}</td></tr>)}</tbody></table></div> : <div className="notice">{tr(lang, "No Committee-approved rotation this cycle. Sale proceeds remain in the Cash Buffer Pool.", "รอบนี้ไม่มี Rotation ที่ Committee อนุมัติ เงินจากการขายจึงพักใน Cash Buffer Pool")}</div>}</>;
}

function fundingText(plan: any, lang: AppLang) {
  const legs = Array.isArray(plan.fundingLegs) ? plan.fundingLegs : [];
  if (legs.length) return legs.map((x: any) => `${x.source} ${money(x.amountUsd)}`).join(" + ");
  if (plan.proceedsDestination) return `${tr(lang, "Destination", "ปลายทาง")} → ${plan.proceedsDestination}`;
  return "—";
}

function valuationView(x: any, lang: AppLang) {
  const status = String(x.valuationStatus ?? "UNAVAILABLE");
  const price = Number(x.currentPrice);
  const target = Number(x.targetPrice);
  if (status === "UNAVAILABLE" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(target) || target <= 0) return { target: "N/A", upside: "N/A", className: "muted", status: tr(lang, "UNAVAILABLE", "ประเมินไม่ได้"), warning: tr(lang, "Spot fallback suppressed", "ไม่ใช้ Spot แทน Fair Value") };
  const gap = (target / price - 1) * 100;
  if (status === "NO_EDGE" || Math.abs(gap) < .5) return { target: money(target), upside: "≈0%", className: "muted", status: tr(lang, "NO EDGE", "ไม่มี Valuation Edge"), warning: "" };
  return { target: money(target), upside: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`, className: gap >= 0 ? "pos" : "neg", status: tr(lang, "VALID", "ใช้งานได้"), warning: "" };
}

function sourceText(source: string, lang: AppLang) {
  if (source === "THOMAS_MULTI_ANCHOR") return tr(lang, "Thomas multi-anchor", "Thomas Multi-Anchor");
  if (source === "RESEARCH_OS_TARGET") return tr(lang, "Research OS target", "เป้าหมายจาก Research OS");
  return tr(lang, "No defensible target", "ยังไม่มี Fair Value ที่เชื่อถือได้");
}

function priceText(value: any) { const n = Number(value); return Number.isFinite(n) && n > 0 ? money(n) : "—"; }
function Metric({ label, value }: { label: string; value: any }) { return <div className="metric"><div className="label">{label}</div><div className="value" style={{ fontSize: 19 }}>{value}</div></div>; }
