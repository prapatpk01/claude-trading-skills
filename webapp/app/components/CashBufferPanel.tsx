"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cls, money, pct } from "./format";
import type { AppLang } from "../page";

export default function CashBufferPanel({ lang, refreshKey }: { lang: AppLang; refreshKey: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (en: string, th: string) => lang === "th" ? th : en;
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/portfolio/cash-buffer", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Cash buffer analysis failed");
      setData(json);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onCashChange = () => void load();
    window.addEventListener("sentinel:cash-ledger-changed", onCashChange);
    return () => window.removeEventListener("sentinel:cash-ledger-changed", onCashChange);
  }, [load]);

  const posture = String(data?.posture ?? "UNVERIFIED");
  const accent = posture === "ON_TARGET" ? "pos" : posture === "UNVERIFIED" ? "muted" : "neg";
  const action = useMemo(() => {
    if (!data) return "—";
    if (data.action === "RAISE_BUFFER") return t("Raise total cash buffer", "เพิ่ม Cash Buffer รวม");
    if (data.action === "DEPLOY_EXCESS") return t("Deploy excess buffer selectively", "นำ Buffer ส่วนเกินไปลงทุนแบบคัดเลือก");
    if (data.action === "MAINTAIN") return t("Maintain current cash buffer", "คงระดับเงินสดปัจจุบัน");
    return t("Verify missing prices", "ตรวจสอบราคาที่ขาด");
  }, [data, lang]);

  return <div className="card" style={{ marginTop: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <h2 className="section" style={{ margin: 0 }}>🛡️ {t("Cash & Reserve Policy Engine", "ระบบนโยบายเงินสดและสินทรัพย์สำรอง")}</h2>
        <p className="muted" style={{ margin: "6px 0 0" }}>{t("Cash Buffer includes USD broker cash plus haircut-adjusted SGOV and approved short-duration reserve instruments. Converting SGOV to USD changes liquidity form, not total buffer size.", "Cash Buffer รวมเงินสด USD ในโบรกเกอร์กับ SGOV และตราสารพักเงินที่กำหนดหลังปรับ Haircut การขาย SGOV เป็น USD เป็นเพียงการเปลี่ยนรูปสภาพคล่อง ไม่ได้เพิ่ม Buffer รวม")}</p>
      </div>
      <button className="btn ghost sm" onClick={load} disabled={loading}>{loading ? "…" : "↻ Refresh"}</button>
    </div>
    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={t("Market regime", "สภาวะตลาด")} value={String(data.regime?.classification ?? "—").replaceAll("_", "-")} sub={`${data.regime?.score ?? "—"}/100`} />
        <Metric label={t("Total cash buffer", "Cash Buffer รวม")} value={data.bufferPct == null ? "—" : pct(data.bufferPct)} sub={money(data.liquidityBuffer ?? 0)} accent={accent} />
        <Metric label={t("Policy buffer target", "เป้าหมาย Buffer ตามนโยบาย")} value={pct(data.targetPct ?? 0)} sub={data.targetValue == null ? t("NAV unverified", "NAV ยังไม่ยืนยัน") : money(data.targetValue)} />
        <Metric label={t("Policy action", "คำแนะนำเชิงนโยบาย")} value={action} sub={posture.replaceAll("_", "-")} accent={accent} />
      </div>
      {!data.verified && <div className="err" style={{ marginTop: 12 }}>⚠ {t("NAV and cash-buffer ratio are suspended because prices are missing for", "ระงับการคำนวณ NAV และสัดส่วนเงินสด เนื่องจากไม่มีราคาของ")}: <strong>{(data.missingPrices ?? []).join(", ")}</strong></div>}
      {data.verified && <div className="grid cols-4" style={{ marginTop: 12 }}>
        <Metric label={t("Broker cash available now", "เงินสดโบรกเกอร์ที่ใช้ได้ทันที")} value={money(data.cashBalance ?? 0)} />
        <Metric label={t("Reserve instruments", "ตราสารใน Cash Buffer")} value={money(data.reserveMarketValue ?? 0)} />
        <Metric label={t("Haircut-adjusted reserve", "ตราสารสำรองหลัง Haircut")} value={money(data.reserveLiquidityValue ?? 0)} />
        <Metric label={t("Total buffer gap vs target", "ส่วนต่าง Buffer รวมจากเป้าหมาย")} value={money(data.gapValue ?? 0)} accent={(data.gapValue ?? 0) >= 0 ? "pos" : "neg"} />
      </div>}

      <h3 className="sub">{t("Reserve holdings", "สินทรัพย์สำรอง")}</h3>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>Ticker</th><th>{t("Class", "ประเภท")}</th><th className="num">{t("Market value", "มูลค่าตลาด")}</th><th className="num">{t("Haircut", "ส่วนลด")}</th><th className="num">{t("Adjusted reserve value", "มูลค่าสำรองหลังปรับ")}</th></tr></thead><tbody>
        {(data.reserveHoldings ?? []).map((row: any) => <tr key={row.ticker}><td><strong>{row.ticker}</strong><br/><span className="muted" style={{fontSize:11}}>{row.label}</span></td><td>{row.tier}</td><td className="num">{money(row.marketValue)}</td><td className="num">{pct((1 - Number(row.haircut)) * 100)}</td><td className="num pos">{money(row.liquidityValue)}</td></tr>)}
        {!(data.reserveHoldings ?? []).length && <tr><td colSpan={5} className="muted">{t("No approved reserve ETFs are currently held.", "ยังไม่มี ETF สำรองที่ได้รับอนุมัติในพอร์ต")}</td></tr>}
      </tbody></table></div>
      <p className="notice" style={{ marginTop: 12 }}>{t("Buffer targets: Risk-On 8%, Neutral 15%, Risk-Off 30% with a ±2% tolerance. USD cash counts at 100%; approved reserve instruments count after their policy haircut. New external capital is recorded in Fund Cash Flows as External capital in; the cash-balance reconciliation control is only for matching Sentinel to the broker.", "เป้าหมาย Buffer: Risk-On 8%, Neutral 15%, Risk-Off 30% พร้อมช่วงยอมรับ ±2% เงินสด USD นับ 100% ส่วนตราสารสำรองนับหลัง Haircut เงินเพิ่มทุนใหม่จากภายนอกให้บันทึกที่กระแสเงินกองทุนเป็น เพิ่มทุนจากภายนอก ส่วนช่องกระทบยอดเงินสดใช้เฉพาะทำให้ยอด Sentinel ตรงกับโบรกเกอร์")}</p>
    </>}
  </div>;
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return <div className="metric"><div className="label">{label}</div><div className={cls("value", accent)} style={{ fontSize: 19 }}>{value}</div>{sub && <div className="sub">{sub}</div>}</div>;
}
