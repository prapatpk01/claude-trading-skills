"use client";

import type { AppLang } from "../page";

const tr = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;

const AUTHORITIES = [
  {
    name: "Sofia Reyes",
    roleEn: "Chief Investment Underwriter",
    roleTh: "หัวหน้ารับรองคุณภาพการลงทุน",
    questionEn: "Is this company worth owning?",
    questionTh: "บริษัทนี้คู่ควรกับการถือในกองทุนหรือไม่?",
    skillsEn: "Business quality · earnings revisions · industry/TAM · fair value · 12M expected return · catalysts",
    skillsTh: "คุณภาพธุรกิจ · Earnings Revision · Industry/TAM · Fair Value · Expected Return 12 เดือน · Catalyst",
  },
  {
    name: "Lena Müller",
    roleEn: "Portfolio Capital Allocator",
    roleTh: "ผู้จัดสรรเงินทุนและพอร์ต",
    questionEn: "Is this the best use of the next dollar?",
    questionTh: "เงิน $1 ถัดไปควรอยู่ที่นี่หรือมีที่อื่นดีกว่า?",
    skillsEn: "Sizing · Cash Floor · source of funds · sleeve drift · opportunity cost · replacement sequencing",
    skillsTh: "Sizing · Cash Floor · แหล่งเงิน · Sleeve Drift · Opportunity Cost · Replacement Sequencing",
  },
  {
    name: "Miriam Osei",
    roleEn: "Forward Risk Officer",
    roleTh: "หัวหน้าความเสี่ยงเชิงคาดการณ์",
    questionEn: "Is the downside acceptable now?",
    questionTh: "Downside และความเสี่ยง ณ ตอนนี้ยอมรับได้หรือไม่?",
    skillsEn: "PASS / CONDITIONAL / VETO · hard blocks · near-miss triggers · concentration · evidence quality · event risk",
    skillsTh: "PASS / CONDITIONAL / VETO · Hard Block · Near-miss Trigger · Concentration · Evidence Quality · Event Risk",
  },
  {
    name: "James Hartwell",
    roleEn: "Chief Portfolio Decision Maker",
    roleTh: "ผู้ตัดสินใจพอร์ตขั้นสุดท้าย",
    questionEn: "What should the fund actually do now?",
    questionTh: "ตอนนี้กองทุนต้องทำอะไรจริง?",
    skillsEn: "BUY/ADD NOW · WAIT FOR TRIGGER · ROTATE/REPLACE · TRIM/EXIT · HOLD · HOLD CASH/SGOV",
    skillsTh: "BUY/ADD NOW · WAIT FOR TRIGGER · ROTATE/REPLACE · TRIM/EXIT · HOLD · HOLD CASH/SGOV",
  },
] as const;

export default function DecisionAuthorityV22Panel({ lang }: { lang: AppLang }) {
  return <section className="card" data-decision-authority-version="22.0">
    <span className="tag">DECISION AUTHORITY V22</span>
    <h3 className="sub" style={{ marginTop: 10 }}>{tr(lang, "Four sequential decision authorities", "4 ผู้มีอำนาจตัดสินใจตามลำดับ")}</h3>
    <p className="muted" style={{ lineHeight: 1.6 }}>
      {tr(lang,
        "Ownership quality, capital allocation, risk timing and the final portfolio action are separate decisions. CONDITIONAL means wait for a named trigger; it is never executable. A true hard block remains VETO.",
        "แยกการตัดสินใจเป็น คุณภาพการลงทุน → การจัดสรรเงิน → ความเสี่ยง/จังหวะ → มติพอร์ตสุดท้าย โดย CONDITIONAL หมายถึงรอ Trigger ที่ระบุและห้ามดำเนินการจริง ส่วน Hard Block จริงยังเป็น VETO")}
    </p>
    <div className="grid cols-4" style={{ marginTop: 12 }}>
      {AUTHORITIES.map((row, index) => <article className="metric" key={row.name}>
        <div className="label">0{index + 1} · {row.name}</div>
        <div className="value" style={{ fontSize: 16 }}>{lang === "th" ? row.roleTh : row.roleEn}</div>
        <p style={{ margin: "8px 0 4px", fontWeight: 700 }}>{lang === "th" ? row.questionTh : row.questionEn}</p>
        <small className="muted" style={{ lineHeight: 1.5 }}>{lang === "th" ? row.skillsTh : row.skillsEn}</small>
      </article>)}
    </div>
    <div className="notice" style={{ marginTop: 12 }}>
      <strong>{tr(lang, "Gate semantics:", "ความหมาย Gate:")}</strong>{" "}
      PASS = {tr(lang, "ready", "พร้อม")} · CONDITIONAL = {tr(lang, "wait for trigger", "รอ Trigger")} · DEFER = {tr(lang, "evidence/package incomplete", "ข้อมูลหรือแพ็กเกจยังไม่ครบ")} · VETO = {tr(lang, "true blocking risk", "ความเสี่ยงบังคับที่ขวางการลงทุน")}
    </div>
  </section>;
}
