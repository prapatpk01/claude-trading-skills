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

async function valuationBatch(tickers: string[]) {
  const response = await fetch(`/api/valuation-fallback?t=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({ tickers }),
  });
  if (!response.ok) return [] as any[];
  const payload = await response.json().catch(() => ({ rows: [] }));
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

async function enrichValuationGaps(review: any) {
  // New opportunities are enriched first. The old implementation stopped at 12
  // total names, so lower-ranked opportunities such as OKE/DDOG could stay blank
  // after existing holdings consumed the batch.
  const all = [...(review?.newIdeas ?? []), ...(review?.watchlistReviews ?? []), ...(review?.researchIncomplete ?? []), ...(review?.existing ?? [])];
  const tickers = Array.from(new Set(all
    .filter((row: any) => ["UNAVAILABLE", "INVALID"].includes(String(row?.valuationStatus ?? "UNAVAILABLE")))
    .map((row: any) => String(row?.ticker ?? "").trim().toUpperCase())
    .filter((ticker: string) => ticker)));
  if (!tickers.length) return review;

  const fallbackRows: any[] = [];
  for (let i = 0; i < tickers.length; i += 12) fallbackRows.push(...await valuationBatch(tickers.slice(i, i + 12)));
  const map = new Map(fallbackRows.map((row: any) => [String(row.ticker).toUpperCase(), row]));

  const patch = (row: any) => {
    if (!["UNAVAILABLE", "INVALID"].includes(String(row?.valuationStatus ?? "UNAVAILABLE"))) return row;
    const fallback: any = map.get(String(row?.ticker ?? "").toUpperCase());
    const valuation = fallback?.valuation;
    if (!valuation?.targetPrice || !(Number(valuation.targetPrice) > 0)) {
      return {
        ...row,
        valuationFallbackTried: true,
        valuationNote: row?.valuationNote || "Thomas + filing + Yahoo analyst/history fallbacks returned no defensible target. Keep as WATCH; do not manufacture fair value from spot.",
      };
    }
    const currentPrice = Number(row?.currentPrice) > 0 ? Number(row.currentPrice) : Number(fallback?.currentPrice) || null;
    const targetPrice = Number(valuation.targetPrice);
    const gap = currentPrice && currentPrice > 0 ? (targetPrice / currentPrice - 1) * 100 : null;
    const decisionReady = Boolean(valuation.decisionReady) && String(valuation.confidence ?? "LOW") !== "LOW";
    return {
      ...row,
      currentPrice,
      targetPrice,
      expectedReturnPct: gap,
      valuationGapPct: gap,
      valuationStatus: gap == null ? "UNAVAILABLE" : decisionReady ? Math.abs(gap) < .5 ? "NO_EDGE" : "VALID" : "LOW_CONFIDENCE",
      researchStatus: decisionReady ? "COMPLETE" : "INCOMPLETE",
      action: row?.action === "RESEARCH INCOMPLETE" && decisionReady ? "WATCH" : row?.action,
      valuationSource: valuation.source ?? "THOMAS_FUNDAMENTAL_RANGE",
      valuationConfidence: valuation.confidence,
      valuationDecisionReady: decisionReady,
      valuationBear: valuation.bearPrice ?? null,
      valuationBull: valuation.bullPrice ?? null,
      valuationAnchors: (valuation.anchors ?? []).map((anchor: any) => ({ method: anchor.label, fairValue: anchor.target, weight: anchor.weight, detail: anchor.detail })),
      valuationAsOf: valuation.asOf ?? null,
      valuationExpiresAt: valuation.expiresAt ?? null,
      valuationModelRoute: valuation.modelRoute ?? null,
      valuationWarnings: fallback?.warnings ?? [],
      valuationFallbackTried: true,
      valuationNote: `${valuation.method} Bear $${Number(valuation.bearPrice).toFixed(2)} · Base $${targetPrice.toFixed(2)} · Bull $${Number(valuation.bullPrice).toFixed(2)} · ${valuation.confidence} confidence.`,
    };
  };

  const patchedNew = (review?.newIdeas ?? []).map(patch);
  const patchedIncomplete = (review?.researchIncomplete ?? []).map(patch).map((row: any) => ({
    ...row,
    researchStatus: "INCOMPLETE",
    action: "RESEARCH INCOMPLETE",
    valuationNote: row?.valuationStatus === "UNAVAILABLE"
      ? row?.valuationNote
      : `${row?.valuationNote ?? "Fair Value fallback completed."} Governed research must be rerun before allocation.`,
  }));
  return {
    ...review,
    existing: (review?.existing ?? []).map(patch),
    newIdeas: patchedNew,
    watchlistReviews: (review?.watchlistReviews ?? []).map(patch),
    researchIncomplete: patchedIncomplete,
  };
}

async function enrichResearchOpportunities(review: any) {
  const rows = (review?.newIdeas ?? []).slice(0, 24);
  if (!rows.length) return review;
  const response = await fetch(`/api/research-opportunity-enrichment?t=${Date.now()}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify({ rows }),
  });
  if (!response.ok) return review;
  const payload = await response.json().catch(() => ({ rows: [] }));
  const map = new Map((payload?.rows ?? []).map((row: any) => [String(row.ticker).toUpperCase(), row]));
  return {
    ...review,
    researchOpportunityMethodology: payload?.methodology ?? null,
    newIdeas: (review?.newIdeas ?? []).map((row: any) => ({ ...row, ...(map.get(String(row.ticker).toUpperCase()) ?? {}) })),
  };
}

export default function ActiveFundDecisionView({
  lang,
  committeeMeeting = null,
  embedded = false,
  mode = "full",
}: {
  lang: AppLang;
  committeeMeeting?: CommitteeMeetingAuthority | null;
  embedded?: boolean;
  mode?: "full" | "research" | "portfolio" | "execution";
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
      const valued = await enrichValuationGaps(json);
      setData(await enrichResearchOpportunities(valued));
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

  const showResearch = mode === "full" || mode === "research";
  const showPortfolio = mode === "full" || mode === "portfolio";
  const showExecution = mode === "full" || mode === "execution";
  const embeddedTitle = mode === "research"
    ? tr(lang, "Investment analysis & fresh discovery", "วิเคราะห์การลงทุนและค้นหาโอกาสใหม่")
    : mode === "execution"
      ? tr(lang, "Execution plan & technical levels", "แผนดำเนินการและระดับ Technical")
      : tr(lang, "Allocation, valuation & cash-pool check", "วิเคราะห์จัดสรรพอร์ต Valuation และ Cash Pool");
  const embeddedStage = mode === "research" ? "02 · INVESTMENT ANALYSIS" : mode === "execution" ? "07 · EXECUTION HANDOFF" : "03 · PORTFOLIO & CAPITAL";

  const Wrapper = embedded ? "section" : "div";
  return <Wrapper className="card ai-card" style={embedded ? undefined : { marginTop: 18 }} data-portfolio-underwriting={embedded ? "same-cio-meeting" : "standalone"}>
    {embedded
      ? <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div><span className="tag">{embeddedStage}</span><h3 className="sub" style={{ margin: "8px 0 0" }}>🧠 {embeddedTitle}</h3></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span className="tag">{committeeMeeting?.meetingId ?? "—"}</span><button className="btn ghost sm" type="button" onClick={() => void run()} disabled={loading}>{loading ? "…" : tr(lang, "Refresh underwriting", "อัปเดตการวิเคราะห์")}</button></div>
        </div>
      : <><h3 className="sub">🧠 {tr(lang, "Portfolio Decision Layer", "ชั้นตัดสินใจและจัดสรรพอร์ต")}</h3><button className="btn" type="button" onClick={() => void run()} disabled={loading}>{loading ? tr(lang, "Checking Committee + building cash-pool plan…", "กำลังตรวจ Committee และสร้างแผน Cash Pool…") : tr(lang, "🏛 Run Governed Portfolio Review", "🏛 วิเคราะห์พอร์ตตามมติ Committee")}</button></>}

    <p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>
      {tr(lang,
        "This is part of the same CIO meeting. Research OS V23 now searches with separate engines and an Active Momentum Lifecycle. Committee authority controls sizing; the shared Holdings technical overlay controls execution. Fair Value and T1/T2/S1 remain separate valuation vs execution evidence.",
        "ส่วนนี้อยู่ใน CIO Meeting เดียวกัน Research OS V23 แยก Engine ค้นหาหุ้นจริงและใช้ Active Momentum Lifecycle โดย Committee คุมขนาดรายการ ส่วน Technical Overlay ชุดเดียวกับ Holdings คุมจังหวะ Execution และ Fair Value แยกจาก T1/T2/S1 ชัดเจน")}
    </p>
    {authoritySource && <span className="tag">{authoritySource}</span>}
    {loading && !data && <div className="notice" style={{ marginTop: 12 }}><span className="spinner" /> {tr(lang, "Building the portfolio underwriting package…", "กำลังสร้างชุดวิเคราะห์พอร์ตของการประชุมเดียวกัน…")}</div>}
    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

    {data && <>
      {(data.technicalSignalAlignment?.blockedAdds ?? []).length > 0 && <div className="notice" style={{ marginTop: 12 }}>
        <strong>{tr(lang, "Technical ADD conflict blocked", "บล็อก ADD ที่ขัดกับ Technical แล้ว")}</strong><br/>
        {tr(lang,
          `No current holding may be added while Holdings says TRIM / HOLD / EXIT REVIEW. Blocked this cycle: ${(data.technicalSignalAlignment.blockedAdds ?? []).join(", ")}.`,
          `หุ้นที่ถืออยู่จะเพิ่มน้ำหนักไม่ได้ถ้า Holdings ยังเป็น TRIM / HOLD / EXIT REVIEW รายการที่ถูกบล็อกรอบนี้: ${(data.technicalSignalAlignment.blockedAdds ?? []).join(", ")}.`)}
      </div>}

      {showResearch && <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={tr(lang, "US universe", "จักรวาลหุ้น US")} value={data.discovery?.broadUniverse ?? 0} />
        <Metric label={tr(lang, "Deep analyzed", "วิเคราะห์เชิงลึก")} value={data.discovery?.detailedAnalyzed ?? 0} />
        <Metric label={tr(lang, "Research engines", "Research Engines")} value={data.discovery?.models ?? 0} />
        <Metric label={tr(lang, "Investment ready", "พร้อมพิจารณาลงทุน")} value={data.discovery?.uniqueNew ?? 0} />
        <Metric label={tr(lang, "Research incomplete", "ข้อมูลยังไม่ครบ")} value={data.researchIncomplete?.length ?? data.discovery?.incomplete ?? 0} />
      </div>}

      {showResearch && <><DiscoveryEnginePanel discovery={data.discovery} lang={lang} /><OpportunityTable rows={data.newIdeas ?? []} lang={lang} /><WatchlistReviewTable rows={data.watchlistReviews ?? []} lang={lang} /><IncompleteResearchTable rows={data.researchIncomplete ?? []} lang={lang} /></>}
      {showPortfolio && <><CashPoolPlan plan={data.cashPoolPlan} lang={lang} />{!embedded && <FundingSummary liquidity={data.liquidity} lang={lang} />}<IdeaTable rows={data.existing ?? []} title={tr(lang, "Current holdings — fund state, valuation & technical execution", "หุ้นที่ถืออยู่ — มติกองทุน Valuation และ Technical Execution")} lang={lang} /><ReplacementTable rows={data.replacements ?? []} lang={lang} /></>}
      {showExecution && <ExecutionTable rows={data.executionPlans ?? []} lang={lang} />}

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>{tr(lang, "Valuation evidence never overrides Committee authority or the Holdings technical execution gate, and no broker order is sent automatically.", "หลักฐาน Valuation ไม่สามารถข้ามมติ Committee หรือ Holdings Technical Execution Gate และระบบไม่ส่งคำสั่งไปโบรกเกอร์อัตโนมัติ")}</p>
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
  return <><h3 className="sub">📋 {tr(lang, "Portfolio Action Sheet", "Portfolio Action Sheet")}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Decision", "มติรอบนี้")}</th><th>{tr(lang, "Technical gate", "Technical Gate")}</th><th className="num">{tr(lang, "Amount", "วงเงิน")}</th><th className="num">{tr(lang, "Approx. shares", "หุ้นโดยประมาณ")}</th><th>{tr(lang, "Funding / destination", "แหล่งเงิน / ปลายทาง")}</th><th>{tr(lang, "Note", "เหตุผล")}</th></tr></thead><tbody>{rows.map((x: any, i: number) => <tr key={`${x.ticker}-${i}`}><td><strong>{x.ticker}</strong></td><td><strong>{lang === "th" ? x.instructionTh : x.instruction}</strong></td><td>{technicalGateCell(x, lang)}</td><td className="num">{Number(x.amountUsd) > 0 ? money(x.amountUsd) : "—"}</td><td className="num">{x.sharesApprox == null ? "—" : Number(x.sharesApprox).toFixed(3)}</td><td style={{ fontSize: 11.5 }}>{fundingText(x, lang)}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{lang === "th" ? x.noteTh : x.note}</td></tr>)}{!rows.length && <tr><td colSpan={7} className="muted">{tr(lang, "No action rows returned.", "ยังไม่มีรายการมติพอร์ตในรอบนี้")}</td></tr>}</tbody></table></div></>;
}

function DiscoveryEnginePanel({ discovery, lang }: { discovery: any; lang: AppLang }) {
  const engines = Array.isArray(discovery?.engines) ? discovery.engines : [];
  const rotations = Array.isArray(discovery?.rotationWindows) ? discovery.rotationWindows : [];
  const policy = discovery?.holdingPolicy ?? {};
  return <section className="card" style={{ marginTop: 14, borderTop: "2px solid var(--accent)" }} data-active-momentum-engines="23">
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div><span className="tag">ACTIVE MOMENTUM RESEARCH V23</span><h3 className="sub" style={{ margin: "9px 0 5px" }}>{tr(lang, "How the fund finds new stocks", "กองทุนค้นหาหุ้นใหม่อย่างไร")}</h3><p className="muted" style={{ margin: 0, maxWidth: 820, lineHeight: 1.6 }}>{discovery?.methodology}</p></div>
      <span className="tag">{discovery?.broadUniverse ?? 0} US → {discovery?.detailedAnalyzed ?? 0} deep dives</span>
    </div>
    {!!rotations.length && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 9, marginTop: 12 }}>
      {rotations.map((window: any) => <div className="metric" key={window.cadence}>
        <span>{window.label}</span><strong style={{ fontSize: 17, marginTop: 6 }}>{window.scheduledThisCycle} {tr(lang, "scheduled", "ตัวในรอบนี้")}</strong>
        <small className="muted" style={{ display: "block", marginTop: 6, lineHeight: 1.45 }}>{window.purpose}</small>
        <small style={{ display: "block", marginTop: 7 }}>{tr(lang, "Next", "รอบถัดไป")} · {String(window.nextRotationAt ?? "").slice(0, 10)}</small>
      </div>)}
    </div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(205px,1fr))", gap: 9, marginTop: 14 }}>
      {engines.map((engine: any) => <div className="metric" key={engine.id} style={{ minHeight: 118 }}>
        <span>{engine.role}</span><strong style={{ fontSize: 14, marginTop: 7 }}>{engine.name}</strong>
        <small className="muted" style={{ display: "block", marginTop: 7, lineHeight: 1.45 }}><strong>{tr(lang, "Searches", "ค้นจาก")}: </strong>{lang === "th" ? engine.searchBasisTh ?? engine.searches : engine.searchBasis ?? engine.searches}</small>
        <small className="muted" style={{ display: "block", marginTop: 7, lineHeight: 1.45 }}><strong>{tr(lang, "Holding window", "กรอบถือ")}: </strong>{lang === "th" ? engine.investmentHorizonTh ?? "ตามสัญญาณ" : engine.investmentHorizon ?? "Signal-driven"}</small>
        <small style={{ display: "block", marginTop: 8 }}>{tr(lang, "Qualified", "ผ่าน Engine")} · {engine.qualified ?? 0}</small>
      </div>)}
    </div>
    <div className="grid cols-3" style={{ marginTop: 12 }}>
      <Metric label={tr(lang, "Master source universe", "จักรวาลหุ้นต้นทาง")} value={lang === "th" ? `${discovery?.broadUniverse ?? 0} หลักทรัพย์จดทะเบียน` : `${discovery?.broadUniverse ?? 0} listed securities`} />
      <Metric label={tr(lang, "Normal holding window", "กรอบถือหลัก")} value={lang === "th" ? policy.baseWindowTh ?? "4–16 สัปดาห์" : policy.baseWindow ?? "4–16 weeks"} />
      <Metric label={tr(lang, "Conditional extension", "กรอบถือต่อเมื่อยังแข็งแรง")} value={lang === "th" ? policy.extensionWindowTh ?? "3–12 เดือน" : policy.extensionWindow ?? "3–12 months"} />
    </div>
    <div className="notice" style={{ marginTop: 12 }}><strong>{tr(lang, "Universe source", "แหล่ง Universe")}:</strong> {discovery?.universeSource ?? "SEC EDGAR + Sentinel liquid-US core"}</div>
    <div className="notice" style={{ marginTop: 12 }}><strong>{tr(lang, "Review and exit clock", "รอบทบทวนและจังหวะขาย")}:</strong> {lang === "th" ? policy.reviewCadenceTh ?? "ติดตาม Technical รายวัน และทบทวนงานวิจัยรายสัปดาห์" : policy.reviewCadence ?? "Daily technical monitor and weekly full re-underwrite"}. {lang === "th" ? policy.exitRuleTh ?? "ลดหรือออกเมื่อ Momentum อ่อนแรง Thesis เปลี่ยน หรือราคาเข้าใกล้ Fair Value" : policy.exitRule ?? "Trim or exit when momentum weakens, the thesis changes, or price approaches Fair Value."}</div>
    <div className="notice" style={{ marginTop: 12 }}><strong>{tr(lang, "Mandatory path", "เส้นทางบังคับ")}:</strong> Independent Engine → ACCUMULATION, EARLY_MARKUP or MOMENTUM_EXPANSION → defensible Fair Value gap ≥8% → Committee → Technical Execution → Human Approval.</div>
  </section>;
}

function DiscoveryIdeaTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🚀 {tr(lang, "Active Momentum opportunities — engine, lifecycle & fair value", "โอกาสใหม่แบบ Active Momentum — Engine, Stage และ Fair Value")}</h3><p className="muted" style={{ fontSize: 11.5 }}>{tr(lang, "Only valuation-complete names appear here. Research-incomplete names are isolated below and receive no capital.", "ส่วนนี้แสดงเฉพาะหุ้นที่ Valuation ครบ หุ้นที่ข้อมูลไม่ครบจะแยกไว้ด้านล่างและไม่ได้รับการจัดสรรเงิน")}</p><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Discovery engine", "Engine ที่ค้นพบ")}</th><th>{tr(lang, "Momentum lifecycle", "ช่วง Momentum")}</th><th>{tr(lang, "Fund state", "สถานะกองทุน")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">Fair Value</th><th className="num">Valuation Gap</th><th>{tr(lang, "Valuation evidence", "หลักฐาน Valuation")}</th><th className="num">Momentum</th><th>{tr(lang, "Why it surfaced", "เหตุผลที่ค้นพบ")}</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td style={{ minWidth: 170 }}><strong>{x.primaryEngine ?? "—"}</strong><small className="muted" style={{ display: "block", marginTop: 4, lineHeight: 1.4 }}>{(x.discoveryEngines ?? x.source ?? []).join(" · ")}</small></td><td style={{ minWidth: 150 }}><strong>{x.lifecycleStage ?? "UNCONFIRMED"}</strong><small className="muted" style={{ display: "block", marginTop: 4 }}>{x.lifecycleScore ?? "—"}/100</small></td><td>{x.action ?? "—"}</td><td className="num"><strong>{priceText(x.currentPrice)}</strong></td><td className="num"><strong>{view.target}</strong></td><td className={`num ${view.className}`}><strong>{view.upside}</strong></td><td><ValuationEvidenceCell x={x} lang={lang}/></td><td className="num">{x.momentum == null ? "—" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ minWidth: 230, fontSize: 11, lineHeight: 1.5 }}>{(x.lifecycleEvidence ?? []).slice(0, 4).join(" · ") || x.thesis}</td></tr>; })}{!rows.length && <tr><td colSpan={10} className="muted">{tr(lang, "No stock currently clears Momentum Stage and Fair Value together.", "รอบนี้ยังไม่มีหุ้นที่ผ่านทั้ง Momentum Stage และ Fair Value พร้อมกัน")}</td></tr>}</tbody></table></div></>;
}

function IncompleteResearchTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  if (!rows.length) return null;
  return <><h3 className="sub">🧩 {tr(lang, "Research incomplete — excluded from allocation", "Research Incomplete — ไม่เข้าสู่การจัดสรรเงิน")}</h3><div className="notice" style={{ marginBottom: 10 }}>{tr(lang, "These names may have interesting momentum, but required evidence or the governed rerun is still incomplete. They receive no capital.", "หุ้นเหล่านี้อาจมี Momentum ที่น่าสนใจ แต่หลักฐานหรือการรันระบบตาม Governance ยังไม่ครบ จึงไม่ได้รับการจัดสรรเงิน")}</div><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Discovery engine", "Engine ที่ค้นพบ")}</th><th>{tr(lang, "Lifecycle", "Momentum Stage")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">Fair Value</th><th className="num">Valuation Gap</th><th>{tr(lang, "Valuation evidence", "หลักฐาน Valuation")}</th><th>{tr(lang, "Missing evidence", "ข้อมูลที่ขาด")}</th><th>{tr(lang, "Next action", "งานถัดไป")}</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); const valued = view.target !== "PENDING" && view.target !== "—"; return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td>{x.primaryEngine ?? "—"}</td><td>{x.lifecycleStage ?? "UNCONFIRMED"}</td><td className="num">{priceText(x.currentPrice)}</td><td className="num">{view.target}</td><td className={`num ${view.className}`}>{view.upside}</td><td><ValuationEvidenceCell x={x} lang={lang}/></td><td className={valued ? "" : "neg"}>{valued ? tr(lang, "Governed research rerun pending", "รอรัน Governed Research ใหม่") : tr(lang, "Defensible Fair Value / Valuation Gap", "Fair Value / Valuation Gap ที่เชื่อถือได้")}</td><td style={{ fontSize: 11.5 }}>{valued ? tr(lang, "Rerun the Active Momentum lifecycle, valuation and committee gates.", "รัน Active Momentum Lifecycle, Valuation และ Committee Gate ใหม่") : tr(lang, "Complete filing, DCF, comparables or analyst-consensus valuation, then rerun the lifecycle gate.", "ทำ Valuation จากงบ DCF Comparable หรือ Analyst Consensus ให้ครบ แล้วรัน Lifecycle Gate ใหม่")}</td></tr>; })}</tbody></table></div></>;
}

function IdeaTable({ rows, title, lang }: { rows: any[]; title: string; lang: AppLang }) {
  return <><h3 className="sub">{title}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Fund state", "สถานะกองทุน")}</th><th>{tr(lang, "Technical gate", "Technical Gate")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">Fair Value</th><th className="num">Valuation Gap</th><th>{tr(lang, "Execution levels", "ระดับ Execution")}</th><th>Valuation</th><th className="num">Momentum</th><th>Thesis</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td>{x.action ?? "—"}</td><td>{technicalGateCell(x, lang)}</td><td className="num"><strong>{priceText(x.currentPrice)}</strong></td><td className="num"><strong>{view.target}</strong></td><td className={`num ${view.className}`}><strong>{view.upside}</strong></td><td>{executionLevelsCell(x, lang)}</td><td><ValuationEvidenceCell x={x} lang={lang}/></td><td className="num">{x.momentum == null ? "—" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}>{x.thesis}</td></tr>; })}{!rows.length && <tr><td colSpan={10} className="muted">{tr(lang, "No analyzed names returned.", "รอบนี้ยังไม่มีหลักทรัพย์ที่ผ่านการวิเคราะห์")}</td></tr>}</tbody></table></div></>;
}

function OpportunityTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🚀 {tr(lang, "Fresh market discoveries — outside Holdings and Watchlist", "หุ้นค้นพบใหม่จากตลาด — ไม่ซ้ำ Holdings และ Watchlist")}</h3><p className="muted" style={{ fontSize: 11.5, lineHeight: 1.55 }}>{tr(lang, "These names came from the rotating market universe. The holding window is a planning range, not an expiry date.", "หุ้นส่วนนี้มาจาก Market Universe ที่หมุนเวียนจริง กรอบถือเป็นช่วงวางแผน ไม่ใช่วันหมดอายุ")}</p><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Fund state", "สถานะกองทุน")}</th><th>{tr(lang, "Research engine", "Research Engine")}</th><th>{tr(lang, "Found from", "ค้นพบจากอะไร")}</th><th>{tr(lang, "Holding window", "กรอบถือ")}</th><th>{tr(lang, "Momentum stage", "Momentum Stage")}</th><th>{tr(lang, "Technical gate", "Technical Gate")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">Fair Value</th><th className="num">Valuation Gap</th><th>{tr(lang, "Valuation evidence", "หลักฐาน Valuation")}</th><th>{tr(lang, "Execution levels", "ระดับ Execution")}</th><th className="num">Momentum</th><th>{tr(lang, "Why selected / thesis", "เหตุผลที่ค้นพบ / Thesis")}</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong><small className="muted" style={{ display: "block", marginTop: 4 }}>{x.rotationCadence ?? "—"} · {x.universeSource ?? "BROAD MARKET"}</small></td><td>{x.action ?? "WATCH"}</td><td style={{ minWidth: 150 }}><strong>{x.researchEngine ?? researchEngineFromSource(x.source)}</strong><small className="muted" style={{ display: "block", marginTop: 4 }}>{Array.isArray(x.source) ? x.source.slice(1, 4).join(" · ") : ""}</small></td><td style={{ minWidth: 230, fontSize: 11.5, lineHeight: 1.5 }}>{lang === "th" ? x.searchBasisTh ?? "รอระบุแหล่งค้นหา" : x.searchBasis ?? "Search basis pending"}</td><td style={{ minWidth: 190, fontSize: 11.5, lineHeight: 1.5 }}><strong>{lang === "th" ? x.investmentHorizonTh ?? "ตามสัญญาณ" : x.investmentHorizon ?? "Signal-driven"}</strong><small className="muted" style={{ display: "block", marginTop: 5 }}>{lang === "th" ? x.reviewCadenceTh ?? "ทบทวนรายวัน/รายสัปดาห์" : x.reviewCadence ?? "Daily/weekly review"}</small></td><td style={{ minWidth: 155 }}>{lifecycleCell(x, lang)}</td><td>{technicalGateCell(x, lang)}</td><td className="num"><strong>{priceText(x.currentPrice)}</strong></td><td className="num"><strong>{view.target}</strong></td><td className={`num ${view.className}`}><strong>{view.upside}</strong></td><td><ValuationEvidenceCell x={x} lang={lang}/></td><td>{executionLevelsCell(x, lang)}</td><td className="num">{x.momentum == null ? "PENDING" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ fontSize: 11.5, lineHeight: 1.5, minWidth: 220 }}>{x.thesis}{view.warning ? <small className="neg" style={{ display: "block", marginTop: 5 }}>{view.warning}</small> : null}</td></tr>; })}{!rows.length && <tr><td colSpan={14} className="muted">{tr(lang, "No fresh name clears every Active Momentum and Fair Value gate yet; the rotation schedule above still shows what is being searched next.", "ยังไม่มีหุ้นใหม่ที่ผ่าน Active Momentum และ Fair Value ครบ แต่ตาราง Rotation ด้านบนจะแสดงว่ารอบถัดไปกำลังค้นหากลุ่มใด")}</td></tr>}</tbody></table></div></>;
}

function WatchlistReviewTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  if (!rows.length) return null;
  return <><h3 className="sub">👁️ {tr(lang, "Watchlist re-underwrite — tracked names, not fresh discoveries", "ทบทวน Watchlist — หุ้นเดิมที่ติดตาม ไม่ใช่หุ้นค้นพบใหม่")}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "State", "สถานะ")}</th><th>{tr(lang, "Lifecycle", "Momentum Stage")}</th><th className="num">{tr(lang, "Current", "ราคาปัจจุบัน")}</th><th className="num">Fair Value</th><th className="num">Valuation Gap</th><th>{tr(lang, "Valuation evidence", "หลักฐาน Valuation")}</th><th className="num">Momentum</th><th>{tr(lang, "Next trigger", "Trigger ถัดไป")}</th></tr></thead><tbody>{rows.map((x: any) => { const view = valuationView(x, lang); return <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td>{x.action ?? "WATCH"}</td><td>{lifecycleCell(x, lang)}</td><td className="num">{priceText(x.currentPrice)}</td><td className="num">{view.target}</td><td className={`num ${view.className}`}>{view.upside}</td><td><ValuationEvidenceCell x={x} lang={lang}/></td><td className="num">{x.momentum == null ? "—" : `${Number(x.momentum).toFixed(0)}/100`}</td><td style={{ minWidth: 240, fontSize: 11.5 }}>{lang === "th" ? x.reviewCadenceTh : x.reviewCadence}</td></tr>; })}</tbody></table></div></>;
}

function ReplacementTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🔄 {tr(lang, "Replacement Alpha — ranking only, cash still pools first", "Replacement Alpha — ใช้จัดอันดับ แต่เงินต้องรวม Cash Pool ก่อน")}</h3>{rows.length ? <div className="table-wrap"><table className="tbl"><thead><tr><th>{tr(lang, "Funding pool", "แหล่งเงินรวม")}</th><th>{tr(lang, "Destination", "ปลายทาง")}</th><th className="num">{tr(lang, "Amount", "วงเงิน")}</th><th>{tr(lang, "Reason", "เหตุผล")}</th></tr></thead><tbody>{rows.map((x: any, i: number) => <tr key={i}><td><strong>{x.from}</strong>{x.sourceHolding ? <small style={{ display: "block", color: "var(--muted)" }}>{tr(lang, "weak-link contributor", "หุ้น Weak Link")}: {x.sourceHolding}</small> : null}</td><td><strong>{x.to}</strong></td><td className="num">{money(x.rotateUsd)} · {x.rotatePct}% NAV</td><td style={{ fontSize: 11.5 }}>{x.reason}</td></tr>)}</tbody></table></div> : <div className="notice">{tr(lang, "No Committee-approved rotation this cycle. Sale proceeds remain in the Cash Buffer Pool.", "รอบนี้ไม่มี Rotation ที่ Committee อนุมัติ เงินจากการขายจึงพักใน Cash Buffer Pool")}</div>}</>;
}

function researchEngineFromSource(source: unknown) {
  const rows = Array.isArray(source) ? source.map(value => String(value).toUpperCase()) : [];
  const map: Record<string, string> = { MOMENTUM: "Momentum Lifecycle", INSTITUTIONAL: "Institutional Accumulation", GROWTH: "Growth Acceleration", QUALITY: "Quality Leadership", VALUE: "Valuation Room-to-Run", AI: "Catalyst / AI Theme", DIVIDEND: "Income Momentum" };
  for (const row of rows) for (const [key, label] of Object.entries(map)) if (row === key) return label;
  return rows.some(row => row.includes("WATCHLIST")) ? "Watchlist Re-underwrite" : "Research OS / Multi-engine";
}

function lifecycleCell(x: any, lang: AppLang) {
  const stage = String(x?.lifecycleStage ?? "UNCONFIRMED");
  const good = ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(stage);
  const bad = ["MATURE", "WEAKENING", "BROKEN"].includes(stage);
  const label = stage.replaceAll("_", " ");
  return <div><strong className={good ? "pos" : bad ? "neg" : ""}>{label}</strong>{x.lifecycleScore != null ? <small className="muted" style={{ display: "block", marginTop: 3 }}>{tr(lang, "Lifecycle", "Lifecycle")} {Number(x.lifecycleScore).toFixed(0)}/100</small> : null}</div>;
}

function technicalGateCell(x: any, lang: AppLang) {
  const decision = String(x?.technicalDecision ?? "").trim();
  if (!decision) return <span className="muted">PENDING</span>;
  const cls = decision === "ADD" ? "pos" : decision === "TRIM" || decision === "EXIT REVIEW" ? "neg" : "";
  return <div style={{ minWidth: 125 }}><strong className={cls}>{decision}</strong>{x.technicalConfidence != null ? <small className="muted" style={{ display: "block", marginTop: 3 }}>{tr(lang, "Confidence", "ความมั่นใจ")} {Number(x.technicalConfidence).toFixed(0)}%</small> : null}</div>;
}

function executionLevelsCell(x: any, lang: AppLang) {
  if (x?.technicalTarget1 == null && x?.technicalTarget2 == null && x?.technicalSupport1 == null) return <span className="muted">WAIT GATE</span>;
  return <div style={{ minWidth: 145, lineHeight: 1.5 }}><span style={{ display: "block" }}>T1 <strong>{priceText(x.technicalTarget1)}</strong></span><span style={{ display: "block" }}>T2 <strong>{x.technicalTarget2 == null ? tr(lang, "Conditional", "มีเงื่อนไข") : priceText(x.technicalTarget2)}</strong></span><span style={{ display: "block" }}>S1 <strong>{priceText(x.technicalSupport1)}</strong></span>{x.technicalRoomAtr != null ? <small className="muted">Room {Number(x.technicalRoomAtr).toFixed(2)} ATR</small> : null}</div>;
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
  if (status === "INVALID") return { target: "BLOCKED", upside: "BLOCKED", className: "neg", status: tr(lang, "INVALID — BLOCKED", "ค่าไม่ผ่านเกณฑ์ — บล็อกแล้ว"), warning: tr(lang, "Fair Value failed the live-price basis, expiry or evidence rail. It is display-blocked and cannot drive a fund action.", "Fair Value ไม่ผ่านเกณฑ์เทียบราคาปัจจุบัน วันหมดอายุ หรือหลักฐาน จึงถูกบล็อกและห้ามใช้ตัดสินใจลงทุน") };
  if (status === "UNAVAILABLE" || !Number.isFinite(price) || price <= 0 || !Number.isFinite(target) || target <= 0) return { target: "PENDING", upside: "PENDING", className: "muted", status: tr(lang, "DATA GAP", "ข้อมูล Valuation ยังไม่พอ"), warning: tr(lang, "Thomas, filing and Yahoo analyst/history fallbacks were attempted. This name cannot become BUY-ready until a defensible target exists; spot is never used to invent fair value.", "ระบบลอง Thomas, Filing และ Yahoo Analyst/History แล้ว หุ้นนี้จะยังเป็น BUY-ready ไม่ได้จนกว่าจะมี Fair Value ที่เชื่อถือได้ และจะไม่ใช้ Spot สร้างราคาเป้าหมายปลอม") };
  const gap = (target / price - 1) * 100;
  if (status === "LOW_CONFIDENCE" || x.valuationDecisionReady === false) return { target: money(target), upside: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`, className: "muted", status: tr(lang, "DISPLAY ONLY", "แสดงผลเท่านั้น"), warning: tr(lang, "Low-confidence, price-only or extreme-gap evidence cannot authorize INITIATE, ADD or a valuation-driven exit until the share basis is confirmed.", "หลักฐานความเชื่อมั่นต่ำ อิงราคาอย่างเดียว หรือมี Gap รุนแรง ห้ามใช้อนุมัติ INITIATE, ADD หรือขายด้วยเหตุผล Valuation จนกว่าจะยืนยันฐานต่อหุ้น") };
  if (status === "NO_EDGE" || Math.abs(gap) < .5) return { target: money(target), upside: "≈0%", className: "muted", status: tr(lang, "NO EDGE", "ไม่มี Valuation Edge"), warning: "" };
  return { target: money(target), upside: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`, className: gap >= 0 ? "pos" : "neg", status: tr(lang, "VALUED", "มี Fair Value"), warning: "" };
}

function ValuationEvidenceCell({ x, lang }: { x: any; lang: AppLang }) {
  const view = valuationView(x, lang);
  const anchors = Array.isArray(x.valuationAnchors) ? x.valuationAnchors : [];
  const ready = x.valuationDecisionReady === true;
  const dates = [x.valuationAsOf ? `${tr(lang, "As of", "ณ วันที่")} ${String(x.valuationAsOf).slice(0, 10)}` : null, x.valuationExpiresAt ? `${tr(lang, "Expires", "หมดอายุ")} ${String(x.valuationExpiresAt).slice(0, 10)}` : null].filter(Boolean).join(" · ");
  return <div style={{ fontSize: 11, minWidth: 220, lineHeight: 1.45 }}>
    <strong className={ready ? "pos" : view.className}>{view.status}</strong>
    <small className="muted" style={{ display: "block", marginTop: 3 }}>{sourceText(x.valuationSource, lang)}{x.valuationConfidence ? ` · ${x.valuationConfidence}` : ""}</small>
    {x.valuationModelRoute ? <small className="muted" style={{ display: "block" }}>{x.valuationModelRoute}</small> : null}
    <small style={{ display: "block", marginTop: 5 }}>{tr(lang, "Bear", "Bear")} <strong>{priceText(x.valuationBear)}</strong> · Base <strong>{priceText(x.targetPrice)}</strong> · Bull <strong>{priceText(x.valuationBull)}</strong></small>
    <small className={ready ? "pos" : "neg"} style={{ display: "block", marginTop: 4 }}>{ready ? tr(lang, "✓ Decision-ready", "✓ ใช้ตัดสินใจได้") : tr(lang, "⛔ Display only / no capital action", "⛔ แสดงผลเท่านั้น / ห้ามสั่งลงทุน")}</small>
    {dates ? <small className="muted" style={{ display: "block", marginTop: 3 }}>{dates}</small> : null}
    {anchors.length ? <details style={{ marginTop: 5 }}><summary>{tr(lang, "Anchors", "สมมติฐาน")} ({anchors.length})</summary>{anchors.map((anchor: any, index: number) => { const weight = Number(anchor.weight); const weightText = Number.isFinite(weight) ? weight <= 1 ? `${(weight * 100).toFixed(0)}%` : `w ${weight.toFixed(1)}` : ""; return <small key={`${anchor.method}-${index}`} style={{ display: "block", marginTop: 4 }}><strong>{anchor.method}</strong> · {priceText(anchor.fairValue ?? anchor.target)}{weightText ? ` · ${weightText}` : ""}{anchor.detail ? <span className="muted"> · {anchor.detail}</span> : null}</small>; })}</details> : null}
    {x.valuationNote ? <small style={{ display: "block", marginTop: 5 }}>{x.valuationNote}</small> : null}
    {view.warning ? <small className="neg" style={{ display: "block", marginTop: 4 }}>{view.warning}</small> : null}
    {(x.valuationWarnings ?? []).map((warning: string, index: number) => <small className="neg" style={{ display: "block", marginTop: 3 }} key={index}>{warning}</small>)}
  </div>;
}

function sourceText(source: string, lang: AppLang) {
  if (source === "THOMAS_DCF_MULTI_ANCHOR") return tr(lang, "Thomas DCF / governed multi-anchor", "Thomas DCF / Governed Multi-Anchor");
  if (source === "THOMAS_ETF_PRICE_HISTORY_PROXY") return tr(lang, "Thomas ETF price-history proxy", "Thomas ETF Price-History Proxy");
  if (source === "THOMAS_CASH_EQUIVALENT") return tr(lang, "Thomas cash-equivalent NAV", "Thomas Cash-Equivalent NAV");
  if (source === "THOMAS_MULTI_ANCHOR") return tr(lang, "Thomas DCF / multiple anchors", "Thomas DCF / Multiple Anchors");
  if (source === "THOMAS_PORTFOLIO_MULTI_ANCHOR") return tr(lang, "Thomas institutional multi-anchor", "Thomas Institutional Multi-Anchor");
  if (source === "THOMAS_FUNDAMENTAL_RANGE") return tr(lang, "Thomas filing-based fundamental range", "Thomas Fundamental Range จากงบการเงิน");
  if (source === "YAHOO_ANALYST_CONSENSUS") return tr(lang, "Yahoo Finance analyst consensus", "Yahoo Finance Analyst Consensus");
  if (source === "YAHOO_TREND_FALLBACK") return tr(lang, "Yahoo Finance history fallback", "Yahoo Finance History Fallback");
  if (source === "RESEARCH_OS_TARGET") return tr(lang, "Research OS target", "เป้าหมายจาก Research OS");
  return tr(lang, "No defensible target yet", "ยังไม่มี Fair Value ที่เชื่อถือได้");
}

function priceText(value: any) { const n = Number(value); return Number.isFinite(n) && n > 0 ? money(n) : "—"; }
function Metric({ label, value }: { label: string; value: any }) { return <div className="metric"><div className="label">{label}</div><div className="value" style={{ fontSize: 19 }}>{value}</div></div>; }
