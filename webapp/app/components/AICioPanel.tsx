"use client";

import { useEffect, useState } from "react";

export default function AICioPanel({ lang = "en" }: { lang?: "en" | "th" }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v10/cio", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error || "AI CIO unavailable");
      setData(body);
    } catch (e: any) {
      setError(e?.message || "AI CIO unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div className="eyebrow">SENTINEL INVESTMENT OS v10.0</div>
          <h2 className="section" style={{ margin: "4px 0" }}>{lang === "th" ? "AI CIO · ศูนย์ตัดสินใจบริหารกองทุน" : "AI CIO · Fund Decision Orchestrator"}</h2>
          <p className="muted" style={{ margin: 0 }}>{lang === "th" ? "รวม Macro, Risk, Liquidity, Portfolio, Opportunity และ Governance เป็นมุมมองเดียว โดยทุกการลงทุนยังต้องอนุมัติโดยมนุษย์" : "Combines macro, risk, liquidity, portfolio, opportunity and governance into one decision view. Human approval remains mandatory."}</p>
        </div>
        <button type="button" className="btn ghost sm" onClick={load}>{lang === "th" ? "ตรวจใหม่" : "Refresh"}</button>
      </div>

      {loading && <p className="muted">{lang === "th" ? "กำลังประชุมทีม AI CIO…" : "Running AI CIO council…"}</p>}
      {error && <div className="notice danger">{error}</div>}
      {data && <>
        <div className="grid cols-4" style={{ marginTop: 16 }}>
          <div className="metric"><span>{lang === "th" ? "ความพร้อม" : "Readiness"}</span><strong>{data.readinessPct}%</strong></div>
          <div className="metric"><span>{lang === "th" ? "สถานะ" : "Status"}</span><strong style={{ fontSize: 14 }}>{data.status}</strong></div>
          <div className="metric"><span>{lang === "th" ? "ท่าที CIO" : "CIO Posture"}</span><strong style={{ fontSize: 14 }}>{data.posture}</strong></div>
          <div className="metric"><span>{lang === "th" ? "การส่งคำสั่งอัตโนมัติ" : "Auto Execution"}</span><strong>{data.governance?.automaticExecution ? "ON" : "OFF"}</strong></div>
        </div>

        {Array.isArray(data.blockers) && data.blockers.length > 0 && <div className="notice warning" style={{ marginTop: 14 }}>
          <strong>{lang === "th" ? "สิ่งที่ต้องแก้ก่อนเพิ่มความเสี่ยง" : "Blockers before increasing risk"}</strong>
          {data.blockers.map((x: string) => <div key={x}>• {x}</div>)}
        </div>}

        <div className="grid cols-2" style={{ marginTop: 16 }}>
          {(data.decisions ?? []).map((item: any) => <div className="card compact" key={item.desk}>
            <div className="eyebrow">{item.desk}</div>
            <h3 style={{ margin: "5px 0" }}>{item.action}</h3>
            <p className="muted" style={{ margin: 0 }}>{item.reason}</p>
          </div>)}
        </div>

        <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>{lang === "th" ? "AI CIO เป็นระบบสนับสนุนการตัดสินใจ ไม่ส่งคำสั่งซื้อขายอัตโนมัติ และต้องมีหลักฐานพร้อม Audit Trail ก่อนอนุมัติ" : "AI CIO is decision support only. It never executes trades automatically and requires evidence plus an audit trail before approval."}</p>
      </>}
    </section>
  );
}
