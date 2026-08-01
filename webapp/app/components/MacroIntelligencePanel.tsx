"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppLang } from "../page";
import { pct, cls } from "./format";

export default function MacroIntelligencePanel({ lang }: { lang: AppLang }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = (en: string, th: string) => lang === "th" ? th : en;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/macro/intelligence", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Macro intelligence failed");
      setData(json);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return <div className="card ai-card" style={{ marginTop: 18 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div>
        <h2 className="section" style={{ margin: 0 }}>🌐 {t("Macro Intelligence — 1/3/6/12 Month Outlook", "Macro Intelligence — มุมมอง 1/3/6/12 เดือน")}</h2>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>{t("Separates evidence completeness from conviction and sets horizon-specific risk budgets.", "แยกความครบถ้วนของหลักฐานออกจากระดับความเชื่อมั่น และกำหนดงบความเสี่ยงต่างกันตามช่วงเวลา")}</p>
      </div>
      <button className="btn ghost sm" onClick={load} disabled={loading}>{loading ? "…" : "↻ Refresh"}</button>
    </div>

    {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}
    {data && <>
      <div className="grid cols-4" style={{ marginTop: 14 }}>
        <Metric label={t("Regime", "สภาวะตลาด")} value={lang === "th" ? data.regime?.labelTh : data.regime?.label} />
        <Metric label={t("Macro score", "คะแนน Macro")} value={`${data.regime?.score ?? "—"}/100`} />
        <Metric label={t("Evidence complete", "หลักฐานครบถ้วน")} value={pct(data.evidenceCompletenessPct)} accent={data.evidenceCompletenessPct >= 80 ? "pos" : "neg"} />
        <Metric label={t("Confidence", "ความเชื่อมั่น")} value={data.confidence ?? "—"} accent={data.confidence === "HIGH" ? "pos" : data.confidence === "LOW" ? "neg" : undefined} />
      </div>

      <div className="grid cols-4" style={{ marginTop: 12 }}>
        {(data.horizons ?? []).map((h: any) => <div className="metric" key={h.label}>
          <div className="label">{h.label} · {h.stance}</div>
          <div style={{ fontSize: 12, lineHeight: 1.65, marginTop: 6 }}>
            <span className="pos">Bull {h.probabilities?.bull}%</span> · Base {h.probabilities?.base}% · <span className="neg">Bear {h.probabilities?.bear}%</span>
          </div>
          <div className="sub">{t("Risk budget", "งบความเสี่ยง")} {h.riskBudgetPct}% · {t("Cash floor", "เงินสดขั้นต่ำ")} {h.cashFloorPct}%</div>
        </div>)}
      </div>

      <div className="notice" style={{ marginTop: 12 }}><strong>{t("Base vision", "มุมมองกรณีฐาน")}:</strong> {lang === "th" ? data.vision?.th : data.vision?.en}</div>
      {(data.allocationTilt?.[lang === "th" ? "th" : "en"] ?? []).length > 0 && <ul style={{ fontSize: 12.5, lineHeight: 1.7, marginBottom: 0 }}>
        {data.allocationTilt[lang === "th" ? "th" : "en"].map((x: string, i: number) => <li key={i}>{x}</li>)}
      </ul>}
      {(data.warnings ?? []).length > 0 && <div className="notice" style={{ marginTop: 12 }}>{t("Missing evidence lowers confidence", "ข้อมูลที่ขาดจะลดระดับความเชื่อมั่น")}: {data.warnings.join(" · ")}</div>}
    </>}
  </div>;
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return <div className="metric"><div className="label">{label}</div><div className={cls("value", accent)} style={{ fontSize: 18 }}>{value}</div></div>;
}
