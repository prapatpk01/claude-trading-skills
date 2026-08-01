"use client";

import { useState } from "react";
import type { AppLang } from "../page";
import { money } from "./format";

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);

export default function ActiveFundManager({ lang }: { lang: AppLang }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const [p, w] = await Promise.all([
        fetch("/api/portfolio").then((r) => r.json()),
        fetch("/api/watchlist").then((r) => r.json()).catch(() => ({ watchlist: [] })),
      ]);
      if (p.error) throw new Error(p.error);
      const holdings = (p.holdings ?? []).filter((h: any) => !h.closed_at && Number(h.shares) > 0);
      const tickers = Array.from(new Set(holdings.map((h: any) => String(h.ticker).toUpperCase()))) as string[];
      const candidateTickers = Array.from(
        new Set((w.watchlist ?? []).map((x: any) => String(x.ticker).toUpperCase()).filter((x: string) => !tickers.includes(x)))
      ) as string[];
      let quotes: Record<string, any> = {};
      if (tickers.length) {
        const q = await fetch(`/api/quote?tickers=${encodeURIComponent(tickers.join(","))}`).then((r) => r.json());
        quotes = q.quotes ?? {};
      }
      const positionValues = holdings.map((h: any) => ({
        ticker: String(h.ticker).toUpperCase(),
        marketValue: (quotes[h.ticker]?.price ?? Number(h.avg_cost)) * Number(h.shares),
      }));
      const nav = positionValues.reduce((s: number, x: any) => s + Number(x.marketValue || 0), 0);
      const r = await fetch("/api/active-fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, candidateTickers, positionValues, nav }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Review failed");
      setData(j);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card ai-card" style={{ marginTop: 18 }}>
      <h3 className="sub">🧠 {tr(lang, "Portfolio Opportunity & Investment Committee", "คณะกรรมการโอกาสลงทุนและบริหารพอร์ต")}</h3>
      <p className="muted" style={{ fontSize: 12, lineHeight: 1.65 }}>
        {tr(
          lang,
          "This review separates risk assets from the managed Liquidity Sleeve. SGOV, JAAA and approved short-duration instruments fund new opportunities before the committee considers selling a strong equity holding.",
          "การทบทวนนี้จะแยกสินทรัพย์เสี่ยงออกจาก Liquidity Sleeve อย่างชัดเจน โดย SGOV, JAAA และตราสารอายุสั้นที่กำหนดจะเป็นแหล่งเงินทุนสำหรับโอกาสใหม่ก่อนที่คณะกรรมการจะพิจารณาขายหุ้นเดิมที่ยังแข็งแรง"
        )}
      </p>
      <button className="btn" onClick={run} disabled={loading}>
        {loading ? tr(lang, "Running full investment committee…", "กำลังประชุมคณะกรรมการลงทุนทั้งทีม…") : tr(lang, "🏛 Run Portfolio Opportunity Review", "🏛 เริ่มประชุมค้นหาโอกาสและปรับพอร์ต")}
      </button>
      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      {data && <>
        {data.macro && <MacroPanel macro={data.macro} lang={lang} />}
        {data.liquidity && <LiquidityPanel liquidity={data.liquidity} plan={data.capitalPlan} lang={lang} />}

        <div className="grid cols-4" style={{ marginTop: 14 }}>
          <M l={tr(lang, "New opportunities", "โอกาสใหม่นอกพอร์ต")} v={data.discovery?.uniqueNew ?? 0} />
          <M l={tr(lang, "Initiate", "เสนอเปิดสถานะใหม่")} v={data.capitalPlan?.initiates ?? 0} />
          <M l={tr(lang, "Add existing", "เสนอเพิ่มหุ้นเดิม")} v={data.capitalPlan?.adds ?? 0} />
          <M l={tr(lang, "Review / Exit", "ทบทวน / ออก")} v={data.capitalPlan?.reviews ?? 0} />
        </div>
        <div className="grid cols-4" style={{ marginTop: 12 }}>
          <M l={tr(lang, "Requested deployment", "เงินลงทุนที่ร้องขอ")} v={money(data.capitalPlan?.requestedDeployUsd ?? 0)} />
          <M l={tr(lang, "Funded from liquidity", "ใช้จาก Liquidity Sleeve")} v={money(data.capitalPlan?.fundedFromLiquidityUsd ?? 0)} />
          <M l={tr(lang, "Funded by rotations", "ใช้จากการสับเปลี่ยน")} v={money(data.capitalPlan?.fundedFromRotationsUsd ?? 0)} />
          <M l={tr(lang, "Liquidity after plan", "Liquidity หลังดำเนินการ")} v={`${money(data.capitalPlan?.liquidityAfterUsd ?? 0)} · ${data.capitalPlan?.liquidityAfterPct ?? 0}%`} />
        </div>

        <h3 className="sub">🔭 {tr(lang, "Opportunity Discovery", "แหล่งค้นหาโอกาสลงทุน")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {tr(lang, "Watchlist / Research", "Watchlist / Research")} {data.discovery?.watchlist ?? 0} · Momentum {data.discovery?.momentum ?? 0} · {tr(lang, "Dividend Quality", "หุ้นปันผลคุณภาพ")} {data.discovery?.dividend ?? 0} · Thematic {data.discovery?.thematic ?? 0} · {data.discovery?.uniqueNew ?? 0} {tr(lang, "unique names outside the current book", "หลักทรัพย์ที่ไม่ซ้ำและอยู่นอกพอร์ต")}
        </p>

        <IdeaTable ideas={data.newIdeas ?? []} title={tr(lang, "New opportunities — fully researched", "โอกาสลงทุนใหม่ — ผ่านการวิเคราะห์และประชุมแล้ว")} lang={lang} />
        <OpportunityDecisionTable rows={data.opportunityDecisions ?? []} lang={lang} />
        <IdeaTable ideas={data.existing ?? []} title={tr(lang, "Risk holdings — committee review", "สินทรัพย์เสี่ยงที่ถืออยู่ — ผลทบทวนจากคณะกรรมการ")} lang={lang} />

        <h3 className="sub">🔄 {tr(lang, "Replacement Alpha", "การสับเปลี่ยนเพื่อเพิ่ม Alpha")}</h3>
        {data.replacements?.length ? (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>{tr(lang, "From", "ลดจาก")}</th><th>{tr(lang, "To", "ย้ายไป")}</th><th className="num">{tr(lang, "Rotate", "สัดส่วน")}</th><th>{tr(lang, "Why", "เหตุผล")}</th></tr></thead><tbody>{data.replacements.map((x: any, i: number) => <tr key={i}><td><strong>{x.from}</strong></td><td><strong>{x.to}</strong></td><td className="num">{x.rotatePct}% · {money(x.rotateUsd)}</td><td style={{ fontSize: 12 }}>{x.reason}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="notice">{tr(lang, "No risk holding needs to be sold. Either no opportunity clears the hurdle or deployable liquidity is sufficient.", "ยังไม่จำเป็นต้องขายสินทรัพย์เสี่ยง เพราะยังไม่มีโอกาสที่ผ่านเกณฑ์ หรือ Liquidity ส่วนเกินเพียงพอต่อแผนลงทุน")}</div>
        )}

        <h3 className="sub">🏛 {tr(lang, "Fund Operating Process", "กระบวนการทำงานของทีมกองทุน")}</h3>
        <ol style={{ fontSize: 12.5, lineHeight: 1.75 }}>{(data.process ?? []).map((x: string, i: number) => <li key={i}>{lang === "th" ? translateProcess(x) : x}</li>)}</ol>
        {data.warnings?.length > 0 && <div className="notice">{data.warnings.join(" · ")}</div>}
        <p className="muted" style={{ fontSize: 11 }}>{tr(lang, "Decision-support only. Committee proposals do not execute orders automatically.", "ใช้เพื่อสนับสนุนการตัดสินใจเท่านั้น ข้อเสนอของคณะกรรมการจะไม่ส่งคำสั่งซื้อขายโดยอัตโนมัติ")}</p>
      </>}
    </div>
  );
}

function MacroPanel({ macro, lang }: { macro: any; lang: AppLang }) {
  return <div className="card" style={{ marginTop: 14, background: "rgba(8,14,28,.48)" }}>
    <h3 className="sub">🌐 {tr(lang, "Macro, Sentiment & 3–6 Month Vision", "มุมมอง Macro, Sentiment และแนวโน้ม 3–6 เดือน")}</h3>
    <div className="grid cols-4">
      <M l={tr(lang, "Regime", "สภาวะตลาด")} v={lang === "th" ? macro.regimeTh : macro.regime} />
      <M l={tr(lang, "Macro score", "คะแนน Macro")} v={`${macro.score}/100`} />
      <M l={tr(lang, "Risk budget", "งบความเสี่ยง")} v={`${macro.riskBudgetPct}%`} />
      <M l={tr(lang, "Liquidity target", "เป้าหมาย Liquidity")} v={`${macro.cashFloorPct}%`} />
    </div>
    <div className="notice" style={{ marginTop: 10 }}><strong>{tr(lang, "Base vision:", "มุมมองกรณีฐาน:")}</strong> {lang === "th" ? macro.visionTh : macro.vision}</div>
    <div className="grid cols-3" style={{ marginTop: 10 }}>{(macro.scenarios ?? []).map((s: any) => <div className="metric" key={s.name}><div className="label">{lang === "th" ? s.nameTh : s.name} · {s.probability}%</div><div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6 }}>{lang === "th" ? s.thesisTh : s.thesis}</div></div>)}</div>
    {(macro.headlines ?? []).length > 0 && <><h4 style={{ marginBottom: 6 }}>{tr(lang, "Official policy/news inputs", "ข่าวและข้อมูลนโยบายจากแหล่งทางการ")}</h4><ul style={{ fontSize: 12, lineHeight: 1.6, marginTop: 0 }}>{macro.headlines.slice(0, 5).map((h: any, i: number) => <li key={i}>{h.title} <span className="muted">· {h.date}</span></li>)}</ul></>}
    <div className="muted" style={{ fontSize: 11 }}>{tr(lang, "Macro controls the target Liquidity Buffer, position sizing and the hurdle for initiating new positions.", "ทีม Macro ควบคุมเป้าหมาย Liquidity Buffer ขนาดสถานะ และเกณฑ์อนุมัติการลงทุนใหม่")}</div>
  </div>;
}

function LiquidityPanel({ liquidity, plan, lang }: { liquidity: any; plan: any; lang: AppLang }) {
  const status = liquidity.status === "EXCESS"
    ? tr(lang, "Excess liquidity available", "มี Liquidity ส่วนเกินพร้อมใช้")
    : liquidity.status === "BELOW TARGET"
      ? tr(lang, "Below target — rebuild buffer", "ต่ำกว่าเป้าหมาย — ต้องเติม Buffer")
      : tr(lang, "On target", "อยู่ในระดับเป้าหมาย");
  return <div className="card" style={{ marginTop: 14, background: "rgba(8,20,35,.55)" }}>
    <h3 className="sub">🛡️ {tr(lang, "Liquidity & Cash Buffer Committee", "คณะกรรมการ Liquidity และ Cash Buffer")}</h3>
    <p className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
      {tr(lang, "SGOV, JAAA and approved short-duration instruments are managed as capital reserves, not scored as equities.", "SGOV, JAAA และตราสารอายุสั้นที่กำหนดจะถูกบริหารเป็นเงินทุนสำรอง ไม่ถูกนำไปให้คะแนนเหมือนหุ้น")}
    </p>
    <div className="grid cols-4">
      <M l={tr(lang, "Current buffer", "Buffer ปัจจุบัน")} v={`${money(liquidity.currentUsd)} · ${liquidity.currentPct}%`} />
      <M l={tr(lang, "Macro target", "เป้าหมายจาก Macro")} v={`${money(liquidity.targetUsd)} · ${liquidity.targetPct}%`} />
      <M l={tr(lang, "Deployable excess", "ส่วนเกินที่นำไปลงทุนได้")} v={money(liquidity.deployableUsd)} />
      <M l={tr(lang, "Status", "สถานะ")} v={status} />
    </div>
    {liquidity.reserveGapUsd > 0 && <div className="notice" style={{ marginTop: 10 }}><strong>{tr(lang, "Reserve gap", "เงินสำรองที่ขาด")}: </strong>{money(liquidity.reserveGapUsd)} · {tr(lang, "new deployment is restricted until the buffer is rebuilt.", "จำกัดการลงทุนใหม่จนกว่าจะเติม Buffer กลับถึงเป้าหมาย")}</div>}
    <div className="table-wrap" style={{ marginTop: 10 }}><table className="tbl"><thead><tr><th>Ticker</th><th className="num">{tr(lang, "Market value", "มูลค่าตลาด")}</th><th>{tr(lang, "Portfolio role", "บทบาทในพอร์ต")}</th></tr></thead><tbody>{(liquidity.positions ?? []).map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td className="num">{money(x.marketValue)}</td><td>{tr(lang, "Liquidity / Cash Buffer", "Liquidity / เงินทุนสำรอง")}</td></tr>)}{!(liquidity.positions ?? []).length && <tr><td colSpan={3} className="muted">{tr(lang, "No qualifying liquidity instruments are currently held.", "ขณะนี้ยังไม่มีตราสารที่เข้าเกณฑ์ Liquidity Sleeve")}</td></tr>}</tbody></table></div>
    <div className="notice" style={{ marginTop: 10 }}>
      <strong>{tr(lang, "Funding waterfall", "ลำดับแหล่งเงินทุน")}: </strong>
      {tr(lang, "1) deployable liquidity above the Macro floor → 2) proceeds from approved trims/exits → 3) replacement of a weaker risk asset. Strong holdings are not sold merely to force a rebalance.", "1) Liquidity ส่วนเกินเหนือ Macro Floor → 2) เงินจากการลด/ออกที่ได้รับอนุมัติ → 3) สับเปลี่ยนจากสินทรัพย์เสี่ยงที่อ่อนกว่า โดยจะไม่ขายหุ้นแข็งแรงเพียงเพื่อบังคับ Rebalance")}
    </div>
    {plan && <p className="muted" style={{ fontSize: 11.5 }}>{tr(lang, "Planned liquidity use", "แผนใช้ Liquidity")}: {money(plan.fundedFromLiquidityUsd ?? 0)} · {tr(lang, "remaining after plan", "คงเหลือหลังแผน")} {money(plan.liquidityAfterUsd ?? 0)} ({plan.liquidityAfterPct ?? 0}%)</p>}
  </div>;
}

function OpportunityDecisionTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🧭 {tr(lang, "Opportunity-to-Portfolio Decisions", "ผลการนำ Opportunity Discovery เข้าปรับพอร์ต")}</h3>
    <p className="muted" style={{ fontSize: 11.5 }}>{tr(lang, "Every discovered name is compared with the current portfolio. Approved ideas draw from deployable liquidity first.", "หุ้นทุกตัวที่ค้นพบจะถูกเปรียบเทียบกับพอร์ต และ Candidate ที่ผ่านอนุมัติจะใช้ Liquidity ส่วนเกินเป็นแหล่งเงินทุนอันดับแรก")}</p>
    <div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Portfolio decision", "มติสำหรับพอร์ต")}</th><th>{tr(lang, "Funding source", "แหล่งเงินทุน")}</th><th>{tr(lang, "Compared with", "เปรียบเทียบกับ")}</th><th className="num">{tr(lang, "Relative edge", "ความได้เปรียบ")}</th><th className="num">{tr(lang, "Weight / capital", "น้ำหนัก / เงินลงทุน")}</th><th>{tr(lang, "Reason and trigger", "เหตุผลและเงื่อนไข")}</th></tr></thead><tbody>
      {rows.map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td><strong>{translateDecision(x.decision, lang)}</strong></td><td style={{ fontSize: 11 }}>{x.fundingSource ?? "—"}</td><td>{x.comparedWith ?? "—"}</td><td className="num">{x.relativeEdge == null ? "—" : `${x.relativeEdge >= 0 ? "+" : ""}${x.relativeEdge.toFixed(1)}`}</td><td className="num">{x.proposedWeightPct ? `${x.proposedWeightPct.toFixed(1)}% · ${money(x.proposedCapitalUsd)}` : "—"}</td><td style={{ fontSize: 11.5, lineHeight: 1.55 }}>{lang === "th" ? x.reasonTh : x.reason}<br/><span className="muted"><strong>{tr(lang, "Trigger", "เงื่อนไข")}: </strong>{lang === "th" ? x.triggerTh : x.trigger}</span></td></tr>)}
      {!rows.length && <tr><td colSpan={7} className="muted">{tr(lang, "No opportunity decisions returned.", "ยังไม่มีผลการตัดสินใจจากโอกาสลงทุน")}</td></tr>}
    </tbody></table></div></>;
}

function M({ l, v }: { l: string; v: any }) { return <div className="metric"><div className="label">{l}</div><div className="value" style={{ fontSize: 19 }}>{v}</div></div>; }

function IdeaTable({ ideas, title, lang }: { ideas: any[]; title: string; lang: AppLang }) {
  return <><h3 className="sub">{title}</h3><div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Action", "ข้อเสนอ")}</th><th>{tr(lang, "Discovery", "ที่มา")}</th><th className="num">Conviction</th><th className="num">{tr(lang, "Exp. return", "ผลตอบแทนคาดหวัง")}</th><th className="num">{tr(lang, "Target weight", "น้ำหนักเป้าหมาย")}</th><th className="num">{tr(lang, "Capital", "เงินลงทุน")}</th><th>{tr(lang, "Committee / thesis", "มติคณะกรรมการ / Thesis")}</th></tr></thead><tbody>{ideas.map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td><strong>{translateAction(x.action, lang)}</strong></td><td style={{ fontSize: 11 }}>{x.source?.join(" · ") || tr(lang, "Current book", "พอร์ตปัจจุบัน")}</td><td className="num">{x.conviction}/100</td><td className="num">{x.expectedReturnPct == null ? "—" : `${x.expectedReturnPct >= 0 ? "+" : ""}${x.expectedReturnPct.toFixed(1)}%`}</td><td className="num">{x.targetWeightPct ? `${x.targetWeightPct.toFixed(1)}%` : "—"}</td><td className="num">{x.capitalUsd ? money(x.capitalUsd) : "—"}</td><td style={{ fontSize: 11.5, lineHeight: 1.5 }}><strong>{x.committee} · {x.confidence}</strong><br />{x.thesis}{x.dissent?.length ? <><br /><span className="neg">{tr(lang, "Dissent", "ความเห็นต่าง")}: {x.dissent.join(" · ")}</span></> : null}</td></tr>)}{!ideas.length && <tr><td colSpan={8} className="muted">{tr(lang, "No fully analyzed ideas returned in this run.", "รอบนี้ยังไม่มีหลักทรัพย์ที่ผ่านการวิเคราะห์ครบถ้วน")}</td></tr>}</tbody></table></div></>;
}

function translateAction(action: string, lang: AppLang) {
  if (lang === "en") return action;
  const m: Record<string, string> = { INITIATE: "เปิดสถานะใหม่", ADD: "เพิ่มน้ำหนัก", HOLD: "ถือต่อ", "TRIM REVIEW": "ทบทวนการลด", REPLACE: "สับเปลี่ยน", "EXIT REVIEW": "ทบทวนการออก", WATCH: "เฝ้าดูพร้อมเงื่อนไข" };
  return m[action] ?? action;
}

function translateDecision(decision: string, lang: AppLang) {
  if (lang === "en") return decision;
  const m: Record<string, string> = { "INITIATE FROM LIQUIDITY": "เปิดสถานะจาก Liquidity", "ROTATE / REPLACE": "ใช้ Liquidity ก่อนแล้วสับเปลี่ยนส่วนที่เหลือ", "WATCH WITH TRIGGER": "เฝ้าดูพร้อมเงื่อนไขลงทุน", REJECT: "ปฏิเสธ" };
  return m[decision] ?? decision;
}

function translateProcess(x: string) {
  if (x.startsWith("Macro")) return "ทีม Macro และ Market Regime กำหนดเป้าหมาย Liquidity Buffer ระดับความเสี่ยง และเพดานการลงทุนรวม";
  if (x.startsWith("SGOV")) return "SGOV, JAAA และตราสารอายุสั้นที่กำหนดจะถูกบริหารเป็น Liquidity Sleeve ไม่ถูกจัดอันดับเหมือนหุ้น";
  if (x.startsWith("Every Opportunity")) return "หุ้นทุกตัวจาก Opportunity Discovery จะเข้าสู่การประชุมจัดสรรเงินทุน แม้เป็น WATCH ก็ยังถูกเปรียบเทียบกับพอร์ต";
  if (x.startsWith("Research")) return "ทีม Research วิเคราะห์ธุรกิจ การแข่งขัน Thesis Catalyst ความเสี่ยง แบบจำลอง 5 ปี และ Valuation ของทุก Candidate";
  if (x.startsWith("Portfolio Construction")) return "ทีมจัดพอร์ตใช้ Liquidity ส่วนเกินเหนือ Macro Floor ก่อนพิจารณาขายสินทรัพย์เสี่ยง";
  if (x.startsWith("Replacement Alpha")) return "Replacement Alpha จะสับเปลี่ยนจากสินทรัพย์เสี่ยงที่อ่อนกว่าเฉพาะเมื่อ Liquidity ส่วนเกินไม่พอและ Candidate มีความได้เปรียบชัดเจน";
  if (x.startsWith("If the Liquidity")) return "หาก Liquidity Sleeve ต่ำกว่าเป้าหมาย ระบบจะจำกัดการลงทุนใหม่และให้ความสำคัญกับการเติม Buffer ก่อน";
  return x;
}
