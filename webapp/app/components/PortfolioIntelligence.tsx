"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./FundCommandCenter.module.css";

type Lang = "en" | "th";
type Holding = { id: string; ticker: string; shares: number; avg_cost: number; closed_at?: string | null };
type Quote = { price?: number } | null;
type Analysis = {
  momentum?: { total?: number };
  data?: { overview?: { dividendYield?: number | null }; quarters?: Array<{ revenueYoY?: number | null }> };
};

type Props = { holdings: Holding[]; quotes: Record<string, Quote>; lang: Lang };
type Sleeve = "Growth" | "Momentum" | "High Dividend";
const TARGETS: Record<Sleeve, number> = { Growth: 40, Momentum: 35, "High Dividend": 25 };
const tx = (lang: Lang, en: string, th: string) => lang === "th" ? th : en;
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

function normalizeYield(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return null;
  return v > 0 && v < 1 ? v * 100 : v;
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
    const tickers = Array.from(new Set(holdings.filter(h => !h.closed_at).map(h => h.ticker))).slice(0, 12);
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
      const growth = latestGrowthRaw == null ? null : Math.abs(latestGrowthRaw) <= 2 ? latestGrowthRaw * 100 : latestGrowthRaw;
      const yieldPct = normalizeYield(a?.data?.overview?.dividendYield);

      let sleeve: Sleeve = "Growth";
      let reasonEn = "core growth / incomplete data";
      let reasonTh = "กลุ่มเติบโตหลัก / ข้อมูลยังไม่ครบ";
      if ((yieldPct ?? 0) >= 5) { sleeve = "High Dividend"; reasonEn = `yield ${yieldPct?.toFixed(1)}%`; reasonTh = `ปันผล ${yieldPct?.toFixed(1)}%`; }
      else if ((momentum ?? 0) >= 70) { sleeve = "Momentum"; reasonEn = `momentum ${momentum}`; reasonTh = `โมเมนตัม ${momentum}`; }
      else if ((growth ?? 0) >= 12) { sleeve = "Growth"; reasonEn = `growth ${growth?.toFixed(1)}%`; reasonTh = `เติบโต ${growth?.toFixed(1)}%`; }
      else if ((momentum ?? 0) >= 55) { sleeve = "Momentum"; reasonEn = `momentum ${momentum}`; reasonTh = `โมเมนตัม ${momentum}`; }

      return { ...h, value, momentum, growth, yieldPct, sleeve, reasonEn, reasonTh };
    });

    const sleeves = (Object.keys(TARGETS) as Sleeve[]).map(sleeve => {
      const members = positions.filter(p => p.sleeve === sleeve);
      const value = members.reduce((s,p) => s + p.value, 0);
      const actual = nav ? value / nav * 100 : 0;
      const target = TARGETS[sleeve];
      return { sleeve, members, value, actual, target, drift: actual - target };
    });

    const proposals = sleeves.filter(s => Math.abs(s.drift) >= 3).sort((a,b) => Math.abs(b.drift) - Math.abs(a.drift));
    return { nav, positions, sleeves, proposals };
  }, [holdings, quotes, analysis]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelTitle}>
        <h3>{tx(lang, "Portfolio Intelligence Engine", "ระบบวิเคราะห์พอร์ตอัจฉริยะ")}</h3>
        <span>{loading ? tx(lang, "analyzing holdings", "กำลังวิเคราะห์สินทรัพย์") : tx(lang, "Growth · Momentum · Income", "เติบโต · โมเมนตัม · ปันผล")}</span>
      </div>

      <div className={styles.intelGrid}>
        {model.sleeves.map(s => (
          <div className={styles.intelCard} key={s.sleeve}>
            <div className={styles.intelHead}>
              <strong>{tx(lang, s.sleeve, s.sleeve === "Growth" ? "เติบโต" : s.sleeve === "Momentum" ? "โมเมนตัม" : "ปันผลสูง")}</strong>
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
        <div className={styles.rebalanceTitle}>{tx(lang, "Rebalance Proposal", "ข้อเสนอการรีบาลานซ์")}</div>
        {model.proposals.length === 0 ? (
          <div className={styles.rebalanceOk}>{tx(lang, "Sleeves are within the ±3% policy band. No rebalance required.", "สัดส่วนแต่ละกลุ่มอยู่ในกรอบนโยบาย ±3% ยังไม่จำเป็นต้องรีบาลานซ์")}</div>
        ) : (
          <div className={styles.queue}>
            {model.proposals.map(s => {
              const deltaValue = model.nav * Math.abs(s.drift) / 100;
              const overweight = s.drift > 0;
              return <div className={styles.queueItem} key={s.sleeve}><span className={styles.queueDot}/><div>
                <strong>{overweight ? tx(lang, "Trim", "ลด") : tx(lang, "Add", "เพิ่ม")} {tx(lang, s.sleeve, s.sleeve === "Growth" ? "กลุ่มเติบโต" : s.sleeve === "Momentum" ? "กลุ่มโมเมนตัม" : "กลุ่มปันผลสูง")}</strong>
                <div className={styles.intelNote}>{tx(lang,
                  `${s.actual.toFixed(1)}% vs ${s.target}% target. Indicative rebalance ${deltaValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}.`,
                  `ปัจจุบัน ${s.actual.toFixed(1)}% เทียบเป้า ${s.target}% มูลค่าที่ควรปรับโดยประมาณ ${deltaValue.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`
                )}</div>
              </div></div>;
            })}
          </div>
        )}
      </div>

      <div className={styles.tableWrapLocal}>
        <table className={styles.intelTable}>
          <thead><tr><th>{tx(lang,"Ticker","หุ้น")}</th><th>{tx(lang,"Sleeve","กลุ่ม")}</th><th>{tx(lang,"Momentum","โมเมนตัม")}</th><th>{tx(lang,"Growth","การเติบโต")}</th><th>{tx(lang,"Yield","ปันผล")}</th><th>{tx(lang,"Classification","เหตุผลจัดกลุ่ม")}</th></tr></thead>
          <tbody>{model.positions.map(p => <tr key={p.id}>
            <td><strong>{p.ticker}</strong></td>
            <td>{tx(lang, p.sleeve, p.sleeve === "Growth" ? "เติบโต" : p.sleeve === "Momentum" ? "โมเมนตัม" : "ปันผลสูง")}</td>
            <td>{p.momentum ?? "—"}</td><td>{p.growth == null ? "—" : `${p.growth.toFixed(1)}%`}</td><td>{p.yieldPct == null ? "—" : `${p.yieldPct.toFixed(1)}%`}</td>
            <td>{lang === "th" ? p.reasonTh : p.reasonEn}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className={styles.disclaimer}>{tx(lang,
        "Classification is rule-based and uses available live analyzer data. Up to 12 holdings are analyzed in batches of three to protect data-provider reliability. It is a portfolio-construction aid, not an automatic trade instruction.",
        "การจัดกลุ่มใช้กฎจากข้อมูลวิเคราะห์จริง โดยวิเคราะห์สูงสุด 12 สินทรัพย์และจำกัดครั้งละ 3 ตัวเพื่อรักษาความเสถียรของแหล่งข้อมูล ใช้ช่วยจัดพอร์ตเท่านั้น ไม่ใช่คำสั่งซื้อขายอัตโนมัติ"
      )}</div>
    </section>
  );
}
