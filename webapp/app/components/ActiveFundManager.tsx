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
      const nav = holdings.reduce((s: number, h: any) => s + ((quotes[h.ticker]?.price ?? h.avg_cost) * Number(h.shares)), 0);
      const r = await fetch("/api/active-fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickers, candidateTickers, nav }),
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
          "This review is not limited to existing holdings. Every Opportunity Discovery candidate is compared with the current portfolio before the committee decides whether to initiate, add, hold cash, watch with a trigger, replace or reject.",
          "การทบทวนนี้ไม่ได้จำกัดเฉพาะหุ้นที่ถืออยู่ หุ้นทุกตัวจาก Opportunity Discovery จะถูกเปรียบเทียบกับพอร์ตปัจจุบันก่อนที่คณะกรรมการจะตัดสินใจว่าจะเปิดสถานะใหม่ เพิ่มน้ำหนัก ถือเงินสด เฝ้าดูพร้อมเงื่อนไข สับเปลี่ยน หรือปฏิเสธ"
        )}
      </p>
      <button className="btn" onClick={run} disabled={loading}>
        {loading ? tr(lang, "Running full investment committee…", "กำลังประชุมคณะกรรมการลงทุนทั้งทีม…") : tr(lang, "🏛 Run Portfolio Opportunity Review", "🏛 เริ่มประชุมค้นหาโอกาสและปรับพอร์ต")}
      </button>
      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      {data && <>
        {data.macro && <MacroPanel macro={data.macro} lang={lang} />}
        <div className="grid cols-4" style={{ marginTop: 14 }}>
          <M l={tr(lang, "New opportunities", "โอกาสใหม่นอกพอร์ต")} v={data.discovery?.uniqueNew ?? 0} />
          <M l={tr(lang, "Initiate", "เสนอเปิดสถานะใหม่")} v={data.capitalPlan?.initiates ?? 0} />
          <M l={tr(lang, "Add existing", "เสนอเพิ่มหุ้นเดิม")} v={data.capitalPlan?.adds ?? 0} />
          <M l={tr(lang, "Review / Exit", "ทบทวน / ออก")} v={data.capitalPlan?.reviews ?? 0} />
        </div>
        <div className="grid cols-3" style={{ marginTop: 12 }}>
          <M l={tr(lang, "Proposed deployment", "เงินที่เสนอให้นำไปลงทุน")} v={money(data.capitalPlan?.deployUsd ?? 0)} />
          <M l={tr(lang, "Capital raised by rotations", "เงินที่ได้จากการสับเปลี่ยน")} v={money(data.capitalPlan?.raiseUsd ?? 0)} />
          <M l={tr(lang, "Residual cash", "เงินสดคงเหลือ")} v={money(data.capitalPlan?.cashAfterUsd ?? 0)} />
        </div>

        <h3 className="sub">🔭 {tr(lang, "Opportunity Discovery", "แหล่งค้นหาโอกาสลงทุน")}</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          {tr(lang, "Watchlist / Research", "Watchlist / Research")} {data.discovery?.watchlist ?? 0} · Momentum {data.discovery?.momentum ?? 0} · {tr(lang, "Dividend Quality", "หุ้นปันผลคุณภาพ")} {data.discovery?.dividend ?? 0} · Thematic {data.discovery?.thematic ?? 0} · {data.discovery?.uniqueNew ?? 0} {tr(lang, "unique names outside the current book", "หลักทรัพย์ที่ไม่ซ้ำและอยู่นอกพอร์ต")}
        </p>

        <IdeaTable ideas={data.newIdeas ?? []} title={tr(lang, "New opportunities — fully researched", "โอกาสลงทุนใหม่ — ผ่านการวิเคราะห์และประชุมแล้ว")} lang={lang} />
        <OpportunityDecisionTable rows={data.opportunityDecisions ?? []} lang={lang} />
        <IdeaTable ideas={data.existing ?? []} title={tr(lang, "Existing holdings — committee review", "หุ้นที่ถืออยู่ — ผลทบทวนจากคณะกรรมการ")} lang={lang} />

        <h3 className="sub">🔄 {tr(lang, "Replacement Alpha", "การสับเปลี่ยนเพื่อเพิ่ม Alpha")}</h3>
        {data.replacements?.length ? (
          <div className="table-wrap"><table className="tbl"><thead><tr><th>{tr(lang, "From", "ลดจาก")}</th><th>{tr(lang, "To", "ย้ายไป")}</th><th className="num">{tr(lang, "Rotate", "สัดส่วน")}</th><th>{tr(lang, "Why", "เหตุผล")}</th></tr></thead><tbody>{data.replacements.map((x: any, i: number) => <tr key={i}><td><strong>{x.from}</strong></td><td><strong>{x.to}</strong></td><td className="num">{x.rotatePct}% · {money(x.rotateUsd)}</td><td style={{ fontSize: 12 }}>{x.reason}</td></tr>)}</tbody></table></div>
        ) : (
          <div className="notice">{tr(lang, "No outside idea clears the replacement hurdle. WATCH candidates remain in the allocation meeting with explicit promotion triggers.", "ยังไม่มีหุ้นใหม่นอกพอร์ตที่ผ่านเกณฑ์สับเปลี่ยน แต่ Candidate ที่เป็น WATCH ยังคงอยู่ในการประชุมจัดพอร์ตพร้อมเงื่อนไขเลื่อนเป็นลงทุนจริงอย่างชัดเจน")}</div>
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
      <M l={tr(lang, "Cash floor", "เงินสดขั้นต่ำ")} v={`${macro.cashFloorPct}%`} />
    </div>
    <div className="notice" style={{ marginTop: 10 }}><strong>{tr(lang, "Base vision:", "มุมมองกรณีฐาน:")}</strong> {lang === "th" ? macro.visionTh : macro.vision}</div>
    <div className="grid cols-3" style={{ marginTop: 10 }}>{(macro.scenarios ?? []).map((s: any) => <div className="metric" key={s.name}><div className="label">{lang === "th" ? s.nameTh : s.name} · {s.probability}%</div><div style={{ fontSize: 12, lineHeight: 1.55, marginTop: 6 }}>{lang === "th" ? s.thesisTh : s.thesis}</div></div>)}</div>
    {(macro.headlines ?? []).length > 0 && <><h4 style={{ marginBottom: 6 }}>{tr(lang, "Official policy/news inputs", "ข่าวและข้อมูลนโยบายจากแหล่งทางการ")}</h4><ul style={{ fontSize: 12, lineHeight: 1.6, marginTop: 0 }}>{macro.headlines.slice(0, 5).map((h: any, i: number) => <li key={i}>{h.title} <span className="muted">· {h.date}</span></li>)}</ul></>}
    <div className="muted" style={{ fontSize: 11 }}>{tr(lang, "Macro has veto power: it changes position sizing, cash reserve and the hurdle for initiating new positions.", "ทีม Macro มีสิทธิ์ยับยั้งและปรับขนาดการลงทุน โดยมีผลต่อเงินสดสำรอง น้ำหนักสถานะ และเกณฑ์อนุมัติหุ้นใหม่")}</div>
  </div>;
}

function OpportunityDecisionTable({ rows, lang }: { rows: any[]; lang: AppLang }) {
  return <><h3 className="sub">🧭 {tr(lang, "Opportunity-to-Portfolio Decisions", "ผลการนำ Opportunity Discovery เข้าปรับพอร์ต")}</h3>
    <p className="muted" style={{ fontSize: 11.5 }}>{tr(lang, "Every discovered name is compared with the current portfolio. WATCH means capital is not approved yet; it does not mean the idea was excluded.", "หุ้นทุกตัวที่ค้นพบจะถูกเปรียบเทียบกับพอร์ตปัจจุบัน คำว่า WATCH หมายถึงยังไม่อนุมัติเงินลงทุน ไม่ได้หมายความว่าถูกตัดออกจากการวิเคราะห์พอร์ต")}</p>
    <div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{tr(lang, "Portfolio decision", "มติสำหรับพอร์ต")}</th><th>{tr(lang, "Compared with", "เปรียบเทียบกับ")}</th><th className="num">{tr(lang, "Relative edge", "ความได้เปรียบ")}</th><th className="num">{tr(lang, "Weight / capital", "น้ำหนัก / เงินลงทุน")}</th><th>{tr(lang, "Reason and trigger", "เหตุผลและเงื่อนไข")}</th></tr></thead><tbody>
      {rows.map((x: any) => <tr key={x.ticker}><td><strong>{x.ticker}</strong></td><td><strong>{translateDecision(x.decision, lang)}</strong></td><td>{x.comparedWith ?? "—"}</td><td className="num">{x.relativeEdge == null ? "—" : `${x.relativeEdge >= 0 ? "+" : ""}${x.relativeEdge.toFixed(1)}`}</td><td className="num">{x.proposedWeightPct ? `${x.proposedWeightPct.toFixed(1)}% · ${money(x.proposedCapitalUsd)}` : "—"}</td><td style={{ fontSize: 11.5, lineHeight: 1.55 }}>{lang === "th" ? x.reasonTh : x.reason}<br/><span className="muted"><strong>{tr(lang, "Trigger", "เงื่อนไข")}: </strong>{lang === "th" ? x.triggerTh : x.trigger}</span></td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="muted">{tr(lang, "No opportunity decisions returned.", "ยังไม่มีผลการตัดสินใจจากโอกาสลงทุน")}</td></tr>}
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
  const m: Record<string, string> = { "INITIATE FROM CASH": "เปิดสถานะจากเงินสด", "ROTATE / REPLACE": "สับเปลี่ยนจากหุ้นเดิม", "WATCH WITH TRIGGER": "เฝ้าดูพร้อมเงื่อนไขลงทุน", REJECT: "ปฏิเสธ" };
  return m[decision] ?? decision;
}

function translateProcess(x: string) {
  if (x.startsWith("Macro")) return "ทีม Macro และ Market Regime กำหนดระดับความเสี่ยง เงินสดสำรอง และเพดานการลงทุนรวม";
  if (x.startsWith("Every Opportunity")) return "หุ้นทุกตัวจาก Opportunity Discovery จะเข้าสู่การประชุมจัดสรรเงินทุน แม้เป็น WATCH ก็ยังถูกเปรียบเทียบกับพอร์ต เพียงแต่ยังไม่อนุมัติเงินลงทุน";
  if (x.startsWith("Watchlist")) return "หุ้นจาก Watchlist และทีม Research จะเข้าสู่กลุ่มโอกาสเดียวกับผลสแกน Momentum หุ้นปันผลคุณภาพ และ Thematic";
  if (x.startsWith("Research")) return "ทีม Research วิเคราะห์ธุรกิจ การแข่งขัน Thesis Catalyst ความเสี่ยง แบบจำลอง 5 ปี และ Valuation ของทุก Candidate";
  if (x.startsWith("Specialist")) return "ทีมผู้เชี่ยวชาญให้คะแนนอย่างอิสระ ฝ่าย Risk มีสิทธิ์ยับยั้ง และคณะกรรมการสรุปเป็นอนุมัติ เฝ้าดู หรือปฏิเสธ";
  if (x.startsWith("Portfolio Construction")) return "ทีมจัดพอร์ตเปรียบเทียบหุ้นใหม่นอกพอร์ตกับหุ้นที่ถืออยู่ทุกตัวจาก Replacement Alpha ผลตอบแทนคาดหวัง และต้นทุนค่าเสียโอกาส";
  if (x.startsWith("Capital")) return "เงินทุนสามารถใช้เปิดสถานะใหม่ เพิ่มหุ้นเดิมที่ยังแข็งแรง ถือเป็นเงินสด ลดหุ้นอ่อนแอ หรือหมุนไปยังสินทรัพย์ที่มีคุณภาพสูงกว่า";
  return x;
}
