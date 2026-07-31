"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./FundCommandCenter.module.css";

type Lang = "en" | "th";
type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type Quote = { price?: number } | null;
type Analysis = {
  momentum?: { total?: number };
  data?: {
    overview?: {
      dividendYield?: number | null;
      sector?: string | null;
      industry?: string | null;
      profitMargin?: number | null;
      roe?: number | null;
    };
    quarters?: Array<{ revenueYoY?: number | null }>;
  };
};

type Props = { holdings: Holding[]; quotes: Record<string, Quote>; lang: Lang };
type PrimarySleeve = "Growth" | "Income" | "Defensive" | "Unclassified";
type MomentumOverlay = "Strong" | "Positive" | "Neutral" | "Weak" | "Unknown";

// Primary allocation policy. Momentum is intentionally NOT a primary sleeve:
// it is a tactical overlay that can apply to Growth or Income holdings alike.
const TARGETS: Record<Exclude<PrimarySleeve, "Unclassified">, number> = {
  Growth: 45,
  Income: 40,
  Defensive: 15,
};

// Mandate hints are used only where ticker identity itself defines the product
// (ETFs / cash-like funds) or where provider gaps are common. Live fundamentals
// still take priority for ordinary equities.
const ROLE_HINTS: Record<string, Exclude<PrimarySleeve, "Unclassified">> = {
  SGOV: "Defensive",
  JAAA: "Defensive",
  BIL: "Defensive",
  SHV: "Defensive",
  TFLO: "Defensive",
  USFR: "Defensive",

  SCHD: "Income",
  VYMI: "Income",
  GPIQ: "Income",
  JEPI: "Income",
  JEPQ: "Income",
  QDVO: "Income",
  FDVV: "Income",
  O: "Income",
  MO: "Income",
  ENB: "Income",
  BTI: "Income",
  JNJ: "Income",
  USB: "Income",
  ITUB: "Income",

  VOO: "Growth",
  SPMO: "Growth",
  QQQ: "Growth",
  QQQM: "Growth",
  VUG: "Growth",
};

const tx = (lang: Lang, en: string, th: string) => lang === "th" ? th : en;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function normalizePct(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.abs(v) > 0 && Math.abs(v) < 1 ? v * 100 : v;
}

function normalizeYield(v: number | null | undefined) {
  const n = normalizePct(v);
  return n == null ? null : Math.max(0, n);
}

function momentumOverlay(score: number | null): MomentumOverlay {
  if (score == null) return "Unknown";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Positive";
  if (score >= 45) return "Neutral";
  return "Weak";
}

function classifyPrimary(
  ticker: string,
  yieldPct: number | null,
  growthPct: number | null,
  sector: string | null,
): { sleeve: PrimarySleeve; reasonEn: string; reasonTh: string } {
  const hint = ROLE_HINTS[ticker];
  if (hint) {
    const roleText = hint === "Income" ? "income mandate / dividend profile" : hint === "Defensive" ? "cash / fixed-income mandate" : "core growth / equity mandate";
    const roleTh = hint === "Income" ? "บทบาทสร้างรายได้ / ปันผล" : hint === "Defensive" ? "บทบาทเงินสด / ตราสารหนี้เชิงรับ" : "บทบาทเติบโต / หุ้นแกนหลัก";
    return { sleeve: hint, reasonEn: roleText, reasonTh: roleTh };
  }

  // Income classification must not require an extreme 5% yield. High-quality
  // dividend equities such as JNJ or large banks often yield ~3–5% while still
  // serving an income role. A 3% threshold is paired with business context.
  if (yieldPct != null && yieldPct >= 3) {
    return {
      sleeve: "Income",
      reasonEn: `income profile · yield ${yieldPct.toFixed(1)}%`,
      reasonTh: `ลักษณะสร้างรายได้ · ปันผล ${yieldPct.toFixed(1)}%`,
    };
  }

  if (growthPct != null && growthPct >= 12) {
    return {
      sleeve: "Growth",
      reasonEn: `revenue growth ${growthPct.toFixed(1)}%`,
      reasonTh: `รายได้เติบโต ${growthPct.toFixed(1)}%`,
    };
  }

  // Utilities / REIT-like real estate are generally income/defensive roles even
  // when a data vendor temporarily misses the current yield field.
  const s = (sector ?? "").toLowerCase();
  if (s.includes("utilit") || s.includes("real estate")) {
    return {
      sleeve: "Income",
      reasonEn: `${sector} income-oriented business model`,
      reasonTh: `${sector} มีบทบาทเน้นรายได้`,
    };
  }

  // Never silently call missing evidence "Growth". Unknown remains unknown so
  // the allocation engine cannot manufacture a rebalance signal from bad data.
  return {
    sleeve: "Unclassified",
    reasonEn: "insufficient evidence — no primary sleeve assigned",
    reasonTh: "ข้อมูลไม่เพียงพอ — ยังไม่จัดเข้ากลุ่มหลัก",
  };
}

async function analyzeTicker(ticker: string): Promise<[string, Analysis | null]> {
  try {
    const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(ticker)}`);
    if (!r.ok) return [ticker, null];
    return [ticker, await r.json()];
  } catch {
    return [ticker, null];
  }
}

async function analyzeInBatches(tickers: string[], batchSize = 3) {
  const rows: Array<[string, Analysis | null]> = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    rows.push(...await Promise.all(tickers.slice(i, i + batchSize).map(analyzeTicker)));
  }
  return rows;
}

export default function PortfolioIntelligence({ holdings, quotes, lang }: Props) {
  const [analysis, setAnalysis] = useState<Record<string, Analysis | null>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Analyze ALL holdings. Concurrency is limited by batching instead of
    // truncating the book; truncation previously caused later holdings to fall
    // through to the old default-Growth branch.
    const tickers = Array.from(new Set(holdings.filter(h => !h.closed_at).map(h => h.ticker)));
    if (!tickers.length) { setAnalysis({}); return; }
    let cancelled = false;
    setLoading(true);
    analyzeInBatches(tickers, 3).then(rows => {
      if (!cancelled) setAnalysis(Object.fromEntries(rows));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [holdings]);

  const model = useMemo(() => {
    const open = holdings.filter(h => !h.closed_at);
    let nav = 0;
    const positions = open.map(h => {
      const price = quotes[h.ticker]?.price ?? h.avg_cost;
      const value = Math.max(0, price * h.shares);
      nav += value;

      const a = analysis[h.ticker];
      const momentum = a?.momentum?.total ?? null;
      const latestGrowthRaw = a?.data?.quarters?.find(q => q.revenueYoY != null)?.revenueYoY ?? null;
      const growthPct = normalizePct(latestGrowthRaw);
      const yieldPct = normalizeYield(a?.data?.overview?.dividendYield);
      const sector = a?.data?.overview?.sector ?? null;
      const primary = classifyPrimary(h.ticker, yieldPct, growthPct, sector);
      const overlay = momentumOverlay(momentum);

      return {
        ...h,
        value,
        momentum,
        momentumOverlay: overlay,
        growthPct,
        yieldPct,
        sector,
        sleeve: primary.sleeve,
        reasonEn: primary.reasonEn,
        reasonTh: primary.reasonTh,
      };
    });

    const classifiedNav = positions.filter(p => p.sleeve !== "Unclassified").reduce((s,p) => s + p.value, 0);
    const sleeves = (Object.keys(TARGETS) as Array<Exclude<PrimarySleeve, "Unclassified">>).map(sleeve => {
      const members = positions.filter(p => p.sleeve === sleeve);
      const value = members.reduce((s,p) => s + p.value, 0);
      const actual = classifiedNav ? value / classifiedNav * 100 : 0;
      const target = TARGETS[sleeve];
      return { sleeve, members, value, actual, target, drift: actual - target };
    });

    const unknown = positions.filter(p => p.sleeve === "Unclassified");
    const unknownValue = unknown.reduce((s,p) => s + p.value, 0);
    const unknownPct = nav ? unknownValue / nav * 100 : 0;

    // Only issue a rebalance proposal when classification coverage is high
    // enough to trust the result. This prevents missing data from manufacturing
    // a false trim/add instruction.
    const coveragePct = nav ? classifiedNav / nav * 100 : 0;
    const proposals = coveragePct >= 85
      ? sleeves.filter(s => Math.abs(s.drift) >= 3).sort((a,b) => Math.abs(b.drift) - Math.abs(a.drift))
      : [];

    const momentumStats = {
      strong: positions.filter(p => p.momentumOverlay === "Strong"),
      positive: positions.filter(p => p.momentumOverlay === "Positive"),
      weak: positions.filter(p => p.momentumOverlay === "Weak"),
    };

    return { nav, classifiedNav, coveragePct, positions, sleeves, proposals, unknown, unknownPct, momentumStats };
  }, [holdings, quotes, analysis]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitle}>
        <h3>{tx(lang, "Portfolio Intelligence Engine", "ระบบวิเคราะห์พอร์ตอัจฉริยะ")}</h3>
        <span>{loading ? tx(lang, "analyzing full book", "กำลังวิเคราะห์ทั้งพอร์ต") : tx(lang, "Growth · Income · Defensive + Momentum Overlay", "เติบโต · รายได้ · เชิงรับ + Momentum Overlay")}</span>
      </div>

      <div className={styles.intelGrid}>
        {model.sleeves.map(s => (
          <div className={styles.intelCard} key={s.sleeve}>
            <div className={styles.intelHead}>
              <strong>{tx(lang, s.sleeve, s.sleeve === "Growth" ? "เติบโต" : s.sleeve === "Income" ? "รายได้ / ปันผล" : "เชิงรับ / เงินสด")}</strong>
              <span>{s.actual.toFixed(1)}% / {s.target}%</span>
            </div>
            <div className={styles.intelBar}><span style={{ width: `${Math.min(100, s.actual)}%` }} /></div>
            <div className={styles.intelMeta}>
              <span className={Math.abs(s.drift) >= 3 ? styles.neg : styles.pos}>{tx(lang, "Drift", "ส่วนเบี่ยงเบน")} {pct(s.drift)}</span>
              <span>{s.members.map(m => m.ticker).join(", ") || "—"}</span>
            </div>
          </div>
        ))}
      </div>

      <div className={styles.rebalanceBox}>
        <div className={styles.rebalanceTitle}>{tx(lang, "Momentum Overlay", "Momentum Overlay")}</div>
        <div className={styles.queue}>
          <div className={styles.queueItem}><span className={styles.queueDot}/><div><strong>{tx(lang,"Strong momentum","โมเมนตัมแข็งแรง")}</strong><div className={styles.intelNote}>{model.momentumStats.strong.map(p=>p.ticker).join(", ") || "—"}</div></div></div>
          <div className={styles.queueItem}><span className={styles.queueDot}/><div><strong>{tx(lang,"Positive momentum","โมเมนตัมเป็นบวก")}</strong><div className={styles.intelNote}>{model.momentumStats.positive.map(p=>p.ticker).join(", ") || "—"}</div></div></div>
          <div className={styles.queueItem}><span className={styles.queueDot}/><div><strong>{tx(lang,"Weak momentum / review","โมเมนตัมอ่อน / ควรทบทวน")}</strong><div className={styles.intelNote}>{model.momentumStats.weak.map(p=>p.ticker).join(", ") || "—"}</div></div></div>
        </div>
      </div>

      <div className={styles.rebalanceBox}>
        <div className={styles.rebalanceTitle}>{tx(lang, "Rebalance Proposal", "ข้อเสนอการรีบาลานซ์")}</div>
        {model.coveragePct < 85 ? (
          <div className={styles.rebalanceOk}>{tx(lang,
            `Classification coverage is ${model.coveragePct.toFixed(1)}%. Rebalance is withheld until at least 85% of NAV is classified.`,
            `ความครอบคลุมการจัดกลุ่มอยู่ที่ ${model.coveragePct.toFixed(1)}% ระบบจะยังไม่เสนอรีบาลานซ์จนกว่าจะจัดกลุ่มได้อย่างน้อย 85% ของ NAV`
          )}</div>
        ) : model.proposals.length === 0 ? (
          <div className={styles.rebalanceOk}>{tx(lang, "Primary sleeves are within the ±3% policy band. No rebalance required.", "สัดส่วนกลุ่มหลักอยู่ในกรอบนโยบาย ±3% ยังไม่จำเป็นต้องรีบาลานซ์")}</div>
        ) : (
          <div className={styles.queue}>{model.proposals.map(s => {
            const deltaValue = model.classifiedNav * Math.abs(s.drift) / 100;
            const overweight = s.drift > 0;
            return <div className={styles.queueItem} key={s.sleeve}><span className={styles.queueDot}/><div>
              <strong>{overweight ? tx(lang,"Trim","ลด") : tx(lang,"Add","เพิ่ม")} {tx(lang,s.sleeve,s.sleeve === "Growth" ? "กลุ่มเติบโต" : s.sleeve === "Income" ? "กลุ่มรายได้ / ปันผล" : "กลุ่มเชิงรับ")}</strong>
              <div className={styles.intelNote}>{tx(lang,
                `${s.actual.toFixed(1)}% vs ${s.target}% target. Indicative rebalance ${deltaValue.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}.`,
                `ปัจจุบัน ${s.actual.toFixed(1)}% เทียบเป้า ${s.target}% มูลค่าที่ควรปรับโดยประมาณ ${deltaValue.toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0})}`
              )}</div>
            </div></div>;
          })}</div>
        )}
      </div>

      <div className={styles.tableWrapLocal}>
        <table className={styles.intelTable}>
          <thead><tr>
            <th>{tx(lang,"Ticker","หุ้น")}</th>
            <th>{tx(lang,"Primary Role","บทบาทหลัก")}</th>
            <th>{tx(lang,"Momentum Overlay","Momentum Overlay")}</th>
            <th>{tx(lang,"Growth","การเติบโต")}</th>
            <th>{tx(lang,"Yield","ปันผล")}</th>
            <th>{tx(lang,"Classification","เหตุผลจัดกลุ่ม")}</th>
          </tr></thead>
          <tbody>{model.positions.map(p => <tr key={p.id}>
            <td><strong>{p.ticker}</strong></td>
            <td>{tx(lang,p.sleeve,p.sleeve === "Growth" ? "เติบโต" : p.sleeve === "Income" ? "รายได้ / ปันผล" : p.sleeve === "Defensive" ? "เชิงรับ / เงินสด" : "ยังไม่จัดกลุ่ม")}</td>
            <td>{tx(lang,p.momentumOverlay,p.momentumOverlay === "Strong" ? "แข็งแรง" : p.momentumOverlay === "Positive" ? "เป็นบวก" : p.momentumOverlay === "Neutral" ? "กลาง" : p.momentumOverlay === "Weak" ? "อ่อน" : "ไม่ทราบ")}{p.momentum != null ? ` (${p.momentum})` : ""}</td>
            <td>{p.growthPct == null ? "—" : `${p.growthPct.toFixed(1)}%`}</td>
            <td>{p.yieldPct == null ? "—" : `${p.yieldPct.toFixed(1)}%`}</td>
            <td>{lang === "th" ? p.reasonTh : p.reasonEn}</td>
          </tr>)}</tbody>
        </table>
      </div>

      {model.unknown.length > 0 && <div className={styles.disclaimer}>{tx(lang,
        `Unclassified: ${model.unknown.map(p=>p.ticker).join(", ")} (${model.unknownPct.toFixed(1)}% of NAV). Missing evidence is left unclassified instead of being forced into Growth.`,
        `ยังไม่จัดกลุ่ม: ${model.unknown.map(p=>p.ticker).join(", ")} (${model.unknownPct.toFixed(1)}% ของ NAV) เมื่อข้อมูลไม่พอ ระบบจะไม่บังคับให้เข้า Growth อีกต่อไป`
      )}</div>}
      <div className={styles.disclaimer}>{tx(lang,
        "Primary role is Growth / Income / Defensive. Momentum is a tactical overlay, so an income stock can simultaneously have strong momentum without changing its strategic sleeve. All open holdings are analyzed in batches of three; no position is silently dropped from classification.",
        "บทบาทหลักแบ่งเป็น Growth / Income / Defensive ส่วน Momentum เป็น tactical overlay ดังนั้นหุ้นปันผลสามารถมีโมเมนตัมแข็งแรงได้โดยไม่เปลี่ยนบทบาทหลัก ระบบวิเคราะห์ holdings ที่เปิดอยู่ทั้งหมดครั้งละ 3 ตัวและจะไม่ตัดสินทรัพย์ท้ายพอร์ตออกเงียบ ๆ อีกต่อไป"
      )}</div>
    </section>
  );
}
