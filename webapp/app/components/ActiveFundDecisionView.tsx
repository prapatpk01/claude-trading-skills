"use client";

import { useEffect, useRef, useState } from "react";
import type { AppLang } from "../page";
import { money } from "./format";

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";

export type CommitteeMeetingAuthority = {
  meetingId: string | null;
  asOf: string | null;
  motions: any[];
};

type CommitteeSnapshot = CommitteeMeetingAuthority & {
  source: "CURRENT CIO MEETING" | "FROZEN CIO MEETING" | "FRESH CIO GATE";
};

function suppliedMeeting(meeting?: CommitteeMeetingAuthority | null): CommitteeSnapshot | null {
  if (!meeting?.meetingId || !Array.isArray(meeting.motions)) return null;
  return { meetingId: meeting.meetingId, asOf: meeting.asOf ?? null, motions: meeting.motions, source: "CURRENT CIO MEETING" };
}

async function committeeSnapshot(meeting?: CommitteeMeetingAuthority | null): Promise<CommitteeSnapshot> {
  const supplied = suppliedMeeting(meeting);
  if (supplied) return supplied;

  if (typeof window !== "undefined") {
    try {
      const saved = window.localStorage.getItem(FROZEN_MEETING_KEY);
      if (saved) {
        const frozen = JSON.parse(saved);
        if (frozen?.meetingId && Array.isArray(frozen?.motions)) {
          return { meetingId: frozen.meetingId, asOf: frozen.asOf ?? null, motions: frozen.motions, source: "FROZEN CIO MEETING" };
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
      sizeUsd: Number.isFinite(Number(motion?.sizeUsd)) ? Number(motion.sizeUsd) : null,
      approxShares: Number.isFinite(Number(motion?.approxShares)) ? Number(motion.approxShares) : null,
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

async function enrichValuationGaps(review: any) {
  const all = [...(review?.existing ?? []), ...(review?.newIdeas ?? [])];
  const tickers = Array.from(new Set(all
    .filter((row: any) => String(row?.valuationStatus ?? "UNAVAILABLE") === "UNAVAILABLE")
    .map((row: any) => String(row?.ticker ?? "").trim().toUpperCase())
    .filter((ticker: string) => ticker)))
    .slice(0, 12);
  if (!tickers.length) return review;

  const response = await fetch(`/api/valuation-fallback?t=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({ tickers }),
  });
  if (!response.ok) return review;
  const payload = await response.json().catch(() => ({ rows: [] }));
  const map = new Map((payload?.rows ?? []).map((row: any) => [String(row.ticker).toUpperCase(), row]));

  const patch = (row: any) => {
    if (String(row?.valuationStatus ?? "UNAVAILABLE") !== "UNAVAILABLE") return row;
    const fallback: any = map.get(String(row?.ticker ?? "").toUpperCase());
    const valuation = fallback?.valuation;
    if (!valuation?.targetPrice || !(Number(valuation.targetPrice) > 0)) return row;
    const currentPrice = Number(row?.currentPrice) > 0 ? Number(row.currentPrice) : Number(fallback?.currentPrice) || null;
    const targetPrice = Number(valuation.targetPrice);
    const gap = currentPrice && currentPrice > 0 ? (targetPrice / currentPrice - 1) * 100 : null;
    return {
      ...row,
      currentPrice,
      targetPrice,
      expectedReturnPct: gap,
      valuationStatus: gap != null && Math.abs(gap) < .5 ? "NO_EDGE" : "VALID",
      valuationSource: valuation.source ?? "THOMAS_FUNDAMENTAL_RANGE",
      valuationConfidence: valuation.confidence,
      valuationAnchors: valuation.anchors,
      valuationNote: `${valuation.method} Bear $${Number(valuation.bearPrice).toFixed(2)} · Base $${targetPrice.toFixed(2)} · Bull $${Number(valuation.bullPrice).toFixed(2)} · ${valuation.confidence} confidence.`,
    };
  };

  return {
    ...review,
    existing: (review?.existing ?? []).map(patch),
    newIdeas: (review?.newIdeas ?? []).map(patch),
  };
}

export default function ActiveFundDecisionView({
  lang,
  committeeMeeting = null,
  embedded = false,
}: {
  lang: AppLang;
  committeeMeeting?: CommitteeMeetingAuthority | null;
  embedded?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [authoritySource, setAuthoritySource] = useState<string | null>(null);
  const lastAutoMeeting = useRef<string | null>(null);

  async function run(authorityOverride?: CommitteeSnapshot) {
    setLoading(true);
    setError(null);
    try {
      const authority = authorityOverride ?? await committeeSnapshot(committeeMeeting);
      setAuthoritySource(authority.source);
      const response = await fetch(`/api/active-fund?t=${Date.now()}`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: JSON.stringify({ committee: compactCommittee(authority) }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Review failed");
      setData(await enrichValuationGaps(json));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const authority = suppliedMeeting(committeeMeeting);
    if (!embedded || !authority?.meetingId || lastAutoMeeting.current === authority.meetingId) return;
    lastAutoMeeting.current = authority.meetingId;
    void run(authority);
  }, [committeeMeeting?.meetingId, embedded]);

  const Wrapper = embedded ? "section" : "div";
  return <Wrapper className="card ai-card" style={embedded ? undefined : { marginTop: 18 }} data-portfolio-underwriting={embedded ? "same-cio-meeting" : "standalone"}>
    {embedded
      ? <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div><span className="tag">02 · PORTFOLIO UNDERWRITING</span><h3 className="sub" style={{ margin: "8px 0 0" }}>🧠 {tr(lang, "Allocation, valuation & cash-pool check", "วิเคราะห์จัดสรรพอร์ต Valuation และ Cash Pool")}</h3></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className="tag">{committeeMeeting?.meetingId ?? "—"}</span><button className="btn ghost sm" type="button" onClick={() => void run()} disabled={loading}>{loading ? "…" : tr(lang, "Refresh underwriting", "อัปเดตการวิเคราะห์")}</button></div>
        </div>
      : <><h3 className="sub">🧠 {tr(lang, "Portfolio Decision Layer", "ชั้นตัดสินใจและจัดสรรพอร์ต")}</h3><button className="btn" onClick={() => void run()} disabled={loading}>{loading ? tr(lang, "Checking Committee + building cash-pool plan…", "กำลังตรวจ Committee และสร้างแผน Cash Pool…") : tr(lang, "🏛 Run Governed Portfolio Review", "🏛 วิเคราะห์พอร์ตตามมติ Committee")}</button></>}

    <p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>
      {tr(lang,
        "This is part of the same CIO meeting. The Committee motion and exact approved size are the execution authority. Valuation uses the full research path first, then Thomas multi-anchor/fundamental valuation, with Yahoo price-history regression only as the last non-spot fallback.",
        "ส่วนนี้เป็นขั้นหนึ่งของ CIO Meeting เดียวกัน โดยมติ Committee และขนาดเงินที่อนุมัติเป็นแหล่งอ้างอิงการซื้อขายเพียงชุดเดียว ส่วน Valuation จะใช้ Full Research ก่อน ตามด้วย Thomas Multi-Anchor/Fundamental และใช้ Yahoo Price History Regression เป็น fallback สุดท้ายโดยไม่ใช้ Spot สร้าง Target ปลอม")}
    </p>
    {authoritySource && <span className="tag">{authoritySource}</span>}
    {loading && !data && <div className="notice" style={{ marginTop: 12 }}><span className="spinner" /> {tr(lang, "Building the portfolio underwriting package…", "กำลังสร้างชุดวิเคราะห์พอร์ตของการประชุมเดียวกัน…")}</div>}
    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={tr(lang, "US universe", "จักรวาลหุ้น US")} value={data.discovery?.broadUniverse ?? 0} />
        <Metric label={tr(lang, "Deep analyzed", "วิเคราะห์เชิงลึก")} value={data.discovery?.detailedAnalyzed ?? 0} />
        <Metric label={tr(lang, "Qualified", "ผ่าน Research")} value={data.discovery?.qualified ?? 0} />
        <Metric label={tr(lang, "New names", "หุ้นใหม่นอกพอร์ต")} value={data.discovery?.uniqueNew ?? 0} />
      </div>

      <ExecutionTable rows={data.executionPlans ?? []} lang={lang} />
      <CashPoolPlan plan={data.cashPoolPlan} lang={lang} />
      {!embedded && <FundingSummary liquidity={data.liquidity} lang={lang} />}
      <IdeaTable rows={data.existing ?? []} title={tr(lang, "Current holdings — valuation & momentum", "หุ้นที่ถืออยู่ — Valuation และ Momentum")} lang={lang} />
      <IdeaTable rows={data.newIdeas ?? []} title={tr(lang, "New opportunities — valuation & research", "โอกาสใหม่ — Valuation และ Research")} lang={lang} />
      <ReplacementTable rows={data.replacements ?? []} lang={lang} />

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>{tr(lang, "Valuation evidence never overrides Committee authority, and no broker order is sent automatically.", "หลักฐาน Valuation ไม่สามารถข้ามมติ Committee และระบบไม่ส่งคำสั่งไปโบรกเกอร์อัตโนมัติ")}</p>
    </>}
  </Wrapper>;
}

function CashPoolPlan({ plan, lang }: { plan: any; lang: AppLang }) {
  if (!plan) return null;
  return <div className="card" style={{ marginTop: 14, borderTop: "2px solid var(--accent)" }}>
    <h3 className="sub">💵 {tr(lang, "Cash Buffer Pool — Committee-authorized flow", "Cash Buffer Pool — กระแสเงินตามมติ Committee")}</h3>
    <div className="grid cols-4">
      <Metric label={tr(lang, "Buffer before Committee sales", "Buffer ก่อนรายการขาย Committee")} value={money(plan.bufferBeforeUsd ?? 0)} />
      <Metric label={tr(lang, "Cash-floor repair sales", "ขายเพื่อเติม Cash Floor")} value={money(plan.cashFloorRepairSalesUsd ?? plan.floorRepairUsd ?? 0)} />
      <Metric label={tr(lang, "Other Committee TRIM/EXIT", "TRIM/EXIT อื่นที่ Committee อนุมัติ")} value={money(plan.otherCommitteeSalesUsd ?? 0)} />
      <Metric label={tr(lang, "Required floor", "Cash Floor ที่ต้องมี")} value={money(plan.floorUsd ?? 0)} />
    </div>
    <div className="grid cols-4" style={{ marginTop: 10 }}>
      <Metric label={tr(lang, "Total authorized sales", "ยอดขายที่อนุมัติรวม")} value={money(plan.saleProceedsUsd ?? 0)} />
      <Metric label={tr(lang, "Deployable after authorized sales", "ส่วนเกินหลังรายการที่อนุมัติ")} value={money(plan.deployableAfterSalesUsd ?? 0)} />
      <Metric label={tr(lang, "Approved purchases", "ซื้อที่ Committee อนุมัติ")} value={money(plan.approvedPurchasesUsd ?? 0)} />
      <Metric label={tr(lang, "Buffer remaining", "Cash Buffer คงเหลือ")} value={money(plan.remainingBufferUsd ?? 0)} />
    </div>
    <div className="grid cols-4" style={{ marginTop: 10 }}>
      <Metric label={tr(lang, "Deployable remaining", "ส่วนเกินที่ยังเหลือ")} value={money(plan.remainingDeployableUsd ?? 0)} />
      <Metric label={tr(lang, "Committee meeting", "รอบ Committee")} value={plan.committeeMeetingId || "—"} />
    </div>
    <div className="notice" style={{ marginTop: 10 }}><strong>{tr(lang, "Capital flow", "ลำดับเงิน")}: </strong>{lang === "th" ? plan.ruleTh : plan.rule}</div>
    {(plan.blockedBuys ?? []).length > 0 && <div className="err" style={{ marginTop: 10 }}><strong>{tr(lang, "Blocked purchases stay at $0:", "รายการซื้อที่ถูกบล็อกจะเป็น $0:")}</strong>{(plan.blockedBuys ?? []).map((x: any) => <div key={x.ticker} style={{ marginTop: 6 }}><strong>{x.ticker}</strong> — {lang === "th" ? x.reasonTh : x.reason}</div>)}</div>}
  </div>;
}

function FundingSummary({ liquidity, lang }: { liquidity: any; lang: AppLang }) {
  if (!liquidity) return null;
  return <div className="card" style={{ marginTop: 14, background: "rgba(8,20,35,.55)" }}><h3 className="sub">🛡️ {tr(lang, "Current Cash Buffer composition", "องค์ประกอบ Cash Buffer ปัจจุบัน")}</h3><div className="grid cols-4"><Metric label="USD cash" value={money(liquidity.cashBalance ?? 0)} /><Metric label={tr(lang, "Dividend cash", "เงินปันผลพร้อมใช้")} value={money(liquidity.dividendAvailable ?? 0)} /><Metric label={tr(lang, "Current excess", "ส่วนเกินปัจจุบัน")} value={money(liquidity.deployableUsd ?? 0)} /><Metric label={tr(lang, "Cash floor", "Cash Floor")} value={`${liquidity.targetPct ?? 0}%`} /></div><div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>{tr(lang, "Reserve", "สินทรัพย์สำรอง")}</th><th className="num">{tr(lang, "Value", "มูลค่า")}</th></tr></thead><tbody>{(liquidity.positions ?? []).map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td className="num">{money(x.marketValue)}</td></tr>)}{!(liquidity.positions ?? []).length && <tr><td colSpan={2} className="muted">—</td></tr>}</tbody></table></div></div>;
}

function ExecutionTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">📋 {tr(lang, "Portfolio Action Sheet", "Portfolio Action Sheet")}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Decision", "มติรอบนี้")}</th><th className="num">{tr(lang, "Amount", "วงเงิน")}</th><th className="num">{tr(lang, "Approx. shares", "หุ้นโดยประมาณ")}</th><th>{tr(lang, "Funding / destination", "แหล่งเงิน / ปลายทาง")}</th><th>{tr(lang, "Note", "เหตุผล")}</th></tr></thead><tbody>{rows.map((x: any, i: number) => <tr key={`${x.ticker}-${i}`}><td><strong>{x.ticker}</strong></td><td><strong>{lang === "th" ? x.instructionTh : x.instruction}</strong></td><td className="num">{Number(x.amountUsd) > 0 ? money(x.amountUsd) : "—"}</td><td className="num">{x.sharesApprox == null ? "—" : Number(x.sharesApprox).toFixed(3)}</td><td style={{ fontSize: 11.5 }}>{fundingText(x, lang)}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{lang === "th" ? x.noteTh : x.note}</td></tr>)}{!rows.length && <tr><td colSpan={6} className="muted">{tr(lang, "No action rows returned.", "ยังไม่มีรายการมติพอร์ตในรอบนี้")}</td></tr>}</tbody></table></div></>;
}

function IdeaTable({ rows, title, lang }: { rows: any[]; title: string; lang: AppLang }) {
  return <><h3 className="sub">{title}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "State", "สถานะ")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">{tr(lang, "Target", "ราคาเป้าหมาย")}</th><th className="num">{tr(lang, "vs spot", "เทียบ Spot")}</th><th>{tr(lang, "Valuation", "Valuation")}</th><th className="num">Momentum</th><th>{tr(lang, "Thesis", "Thesis")}</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td>{x.action ?? "—"}</td><td className="num"><strong>{priceText(x.currentPrice)}</strong></td><td className="num"><strong>{view.target}</strong></td><td className={`num ${view.className}`}><strong>{view.upside}</strong></td><td style={{ fontSize: 11, minWidth: 190 }}><strong>{view.status}</strong><br/><span className="muted">{sourceText(x.valuationSource, lang)}{x.valuationConfidence ? ` · ${x.valuationConfidence}` : ""}</span>{x.valuationNote ? <small style={{ display: "block", marginTop: 5, lineHeight: 1.4 }}>{x.valuationNote}</small> : null}{view.warning ? <small className="neg" style={{ display: "block", marginTop: 4 }}>{view.warning}</small> : null}</td><td className="num">{x.momentum == null ? "—" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{x.thesis}</td></tr>; })}{!rows.length && <tr><td colSpan={8} className="muted">{tr(lang, "No analyzed names returned.", "รอบนี้ยังไม่มีหลักทรัพย์ที่ผ่านการวิเคราะห์")}</td></tr>}</tbody></table></div></>;
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
  if (status === "UNAVAILABLE" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(target) || target <= 0) return { target: "—", upside: "—", className: "muted", status: tr(lang, "DATA GAP", "ข้อมูล Valuation ยังไม่พอ"), warning: tr(lang, "All institutional and Yahoo-history fallback anchors were exhausted; no synthetic spot target is shown.", "ลองครบทั้ง Institutional และ Yahoo History fallback แล้ว จึงไม่ใช้ราคาปัจจุบันสร้าง Target ปลอม") };
  const gap = (target / price - 1) * 100;
  if (status === "NO_EDGE" || Math.abs(gap) < .5) return { target: money(target), upside: "≈0%", className: "muted", status: tr(lang, "NO EDGE", "ไม่มี Valuation Edge"), warning: "" };
  return { target: money(target), upside: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`, className: gap >= 0 ? "pos" : "neg", status: tr(lang, "VALUED", "มี Fair Value"), warning: "" };
}

function sourceText(source: string, lang: AppLang) {
  if (source === "THOMAS_MULTI_ANCHOR") return tr(lang, "Thomas DCF / multiple anchors", "Thomas DCF / Multiple Anchors");
  if (source === "THOMAS_PORTFOLIO_MULTI_ANCHOR") return tr(lang, "Thomas institutional multi-anchor", "Thomas Institutional Multi-Anchor");
  if (source === "THOMAS_FUNDAMENTAL_RANGE") return tr(lang, "Thomas filing-based fundamental range", "Thomas Fundamental Range จากงบการเงิน");
  if (source === "YAHOO_TREND_FALLBACK") return tr(lang, "Yahoo Finance history fallback", "Yahoo Finance History Fallback");
  if (source === "RESEARCH_OS_TARGET") return tr(lang, "Research OS target", "เป้าหมายจาก Research OS");
  return tr(lang, "No defensible target yet", "ยังไม่มี Fair Value ที่เชื่อถือได้");
}

function priceText(value: any) { const n = Number(value); return Number.isFinite(n) && n > 0 ? money(n) : "—"; }
function Metric({ label, value }: { label: string; value: any }) { return <div className="metric"><div className="label">{label}</div><div className="value" style={{ fontSize: 19 }}>{value}</div></div>; }
