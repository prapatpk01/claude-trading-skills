"use client";

// Tactical timing lens used after the broad Phase 1 research pipeline.
//
// The component formats. Every score, filter and rejection comes from
// /api/committee/swing-scan, which runs lib/team/swing.ts.

import { useCallback, useState } from "react";
import type { AppLang } from "../page";

type Ballot = { factor: string; label: string; points: number | null; max: number; detail: string };
type Setup = {
  ticker: string; setupType: string; momentumScore: number; coveragePct: number; unmeasured: string[];
  lines: Ballot[]; price: number; entryLow: number; entryHigh: number; target: number; stop: number;
  riskReward: number; expectedReturnPct: number; winProbabilityPct: number | null; winProbabilityNote: string;
  targetMethod: string; pivot: number; extensionPct: number;
  notes: { momentum: string; volume: string; catalyst: string; thesis: string };
};
type ResearchCandidate = {
  ticker: string; bucket: "NEAR_READY" | "RESEARCH" | "REJECT"; rankScore: number; coveragePct: number;
  price: number | null; setupType: string; timeframe: string; technicalTarget: number | null;
  valuationStatus: "PENDING"; primaryBlocker: string; whyNow: string; trigger: string;
};
type Result = {
  asOf: string;
  regime: { score: number; stance: string; vix: number | null; spyAboveEma20: boolean | null; qqqAboveEma20: boolean | null; note: string; defensiveOnly: boolean };
  setups: Setup[];
  nearReady: ResearchCandidate[];
  research: ResearchCandidate[];
  bucketCounts: { tradeReady: number; nearReady: number; research: number; rejected: number };
  engineVersion: string;
  rejected: { ticker: string; filter: string; reason: string }[];
  universeSize: number; evaluated: number;
  weights: { momentum: number; volume: number; structure: number; catalyst: number };
  methodology: string; disclosures: string[]; warnings?: string[];
};

const tr = (lang: AppLang, en: string, th: string) => (lang === "th" ? th : en);
const money = (v: number) => `$${v.toFixed(2)}`;
const SECTORS = ["All", "Technology", "Communication", "Consumer", "Financials", "Healthcare", "Industrials", "Energy", "Utilities", "RealEstate", "Materials"];
const FILTER_TONE: Record<string, string> = {
  "MARKET REGIME": "#a78bfa", "ENTRY RANGE": "#fb923c", "SWING TARGET": "#38bdf8",
  "RISK:REWARD": "#f87171", STRUCTURE: "#94a3b8", DATA: "#64748b",
};

export default function SwingScanPanel({ lang, onRefer }: { lang: AppLang; onRefer?: (ticker: string) => void }) {
  const [sector, setSector] = useState("All");
  const [tickers, setTickers] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [referred, setReferred] = useState<Set<string>>(new Set());
  const [showRejected, setShowRejected] = useState(false);

  const scan = useCallback(async () => {
    setLoading(true); setError(null); setResult(null); setReferred(new Set());
    try {
      const q = new URLSearchParams({ sector, top: "5" });
      const list = tickers.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).join(",");
      if (list) q.set("tickers", list);
      const response = await fetch(`/api/committee/swing-scan?${q}`, { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error ?? "The swing scan failed.");
      setResult(json);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "The swing scan failed.");
    } finally { setLoading(false); }
  }, [sector, tickers]);

  async function refer(s: Setup) {
    try {
      const response = await fetch("/api/analyze/actions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: s.ticker, action: "COMMITTEE", rating: "BUY", conviction: s.momentumScore,
          payload: { source: `Swing scan · ${s.setupType}`, price: s.price, target: s.target, dataQuality: `${s.coveragePct}% coverage`, thesis: s.notes.thesis.slice(0, 240) },
        }),
      });
      if (!response.ok) throw new Error("failed");
      setReferred((prev) => new Set(prev).add(s.ticker));
      onRefer?.(s.ticker);
    } catch { /* the button stays enabled so it can be retried */ }
  }

  const r = result?.regime;

  return (
    <section className="card" data-swing-version="2.0" style={{ borderTop: "2px solid var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <span className="tag">{tr(lang, "RESEARCH DISCOVERY · SWING SCAN V2", "ระบบค้นคว้า · สแกนสวิง V2")}</span>
          <h3 className="sub" style={{ margin: "10px 0 6px" }}>{tr(lang, "Discovery → ranking → setup readiness → execution", "ค้นพบ → จัดอันดับ → ตรวจความพร้อม → ส่งเพื่อพิจารณา")}</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 780, fontSize: 13 }}>
            {tr(lang,
              "The scanner ranks the full candidate set first, then separates trade-ready setups from near-ready and research inventory. Only trade-ready names can be referred to committee.",
              "ระบบจัดอันดับหุ้นทั้งชุดก่อน แล้วแยกเป็น พร้อมเสนอ · ใกล้พร้อม · ต้องวิจัยต่อ เฉพาะหุ้นที่ผ่าน Execution Gate เท่านั้นจึงส่งเข้าคณะกรรมการได้")}
          </p>
        </div>
        <span className="tag">{tr(lang, "REJECTIONS KEEP THEIR REASON", "การตัดทิ้งเก็บเหตุผล")}</span>
      </div>

      <div className="searchbar" style={{ marginTop: 16 }}>
        <select value={sector} onChange={(e) => setSector(e.target.value)}>{SECTORS.map((s) => <option key={s}>{s}</option>)}</select>
        <input value={tickers} onChange={(e) => setTickers(e.target.value)} placeholder={tr(lang, "Optional tickers, comma separated", "ระบุหุ้นเองได้ คั่นด้วย comma")} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn" type="button" onClick={scan} disabled={loading}>
          {loading ? tr(lang, "Scanning…", "กำลังสแกน…") : tr(lang, "Run swing scan", "เริ่มสแกนสวิง")}
        </button>
      </div>
      {error && <div className="err" style={{ marginTop: 12 }}>⚠ {error}</div>}

      {result && (
        <>
          {/* 🌐 Market regime & swing sentiment */}
          <div className="card" style={{ margin: "16px 0 0", borderLeft: `3px solid ${r!.defensiveOnly ? "#fbbf24" : "#34d399"}` }}>
            <h4 className="sub" style={{ marginTop: 0 }}>🌐 {tr(lang, "Market regime & swing sentiment", "สภาวะตลาดและ sentiment การสวิง")}</h4>
            <div className="grid cols-4">
              <M label={tr(lang, "Market outlook", "มุมมองตลาด")} value={`${r!.score}/100`} sub={r!.stance} />
              <M label="VIX" value={r!.vix == null ? "—" : r!.vix.toFixed(2)} />
              <M label={tr(lang, "SPY vs 20 EMA", "SPY เทียบ 20 EMA")} value={r!.spyAboveEma20 == null ? "—" : r!.spyAboveEma20 ? tr(lang, "Above", "เหนือ") : tr(lang, "Below", "ใต้")} />
              <M label={tr(lang, "QQQ vs 20 EMA", "QQQ เทียบ 20 EMA")} value={r!.qqqAboveEma20 == null ? "—" : r!.qqqAboveEma20 ? tr(lang, "Above", "เหนือ") : tr(lang, "Below", "ใต้")} />
            </div>
            <p className="muted" style={{ margin: "12px 0 0", fontSize: 13 }}>{r!.note}</p>
          </div>

          <p className="muted" style={{ marginTop: 14, fontSize: 12 }}>
            {tr(lang,
              `${result.universeSize} names scanned through the v${result.engineVersion} four-stage funnel.`,
              `สแกน ${result.universeSize} ตัวผ่าน funnel 4 ขั้นของระบบ v${result.engineVersion}`)}
          </p>

          <div className="grid cols-4" style={{ marginTop: 10 }}>
            <M label={tr(lang, "TRADE READY", "พร้อมเสนอ")} value={String(result.bucketCounts.tradeReady)} />
            <M label={tr(lang, "NEAR READY", "ใกล้พร้อม")} value={String(result.bucketCounts.nearReady)} />
            <M label={tr(lang, "RESEARCH", "วิจัยต่อ")} value={String(result.bucketCounts.research)} />
            <M label={tr(lang, "REJECT", "ตัดออก")} value={String(result.bucketCounts.rejected)} />
          </div>

          {result.setups.length === 0 && (
            <div className="notice" style={{ marginTop: 12 }}>
              {tr(lang, "No setup cleared all four filters. That is an answer, not a failure — the alternative is showing a trade the desk would not take.",
                "ยังไม่มีเซ็ตอัพผ่าน Execution Gate ครบ ระบบยังแสดงหุ้นใกล้พร้อมและหุ้นที่ต้องวิจัยต่อด้านล่าง โดยไม่ปลอมให้เป็นคำสั่งซื้อ")}
            </div>
          )}

          {result.setups.map((s, i) => (
            <article key={s.ticker} className="card" style={{ margin: "14px 0 0", borderLeft: "3px solid var(--accent)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div>
                  <span className="tag">#{i + 1} · {s.setupType}</span>
                  <h4 style={{ margin: "8px 0 2px", fontSize: 19 }}>{s.ticker}</h4>
                  <small className="muted">{tr(lang, "Momentum score", "คะแนนโมเมนตัม")} {s.momentumScore}/100 · {tr(lang, "coverage", "ความครอบคลุม")} {s.coveragePct}%</small>
                </div>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  <M label={tr(lang, "Expected return", "ผลตอบแทนคาดหวัง")} value={`+${s.expectedReturnPct}%`} />
                  <M label={tr(lang, "Win probability", "ความน่าจะชนะ")} value={s.winProbabilityPct == null ? tr(lang, "not quoted", "ไม่ระบุ") : `${s.winProbabilityPct}%`} />
                </div>
              </div>

              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="tbl">
                  <thead><tr><th>{tr(lang, "Timeframe", "กรอบเวลา")}</th><th>R:R</th><th>{tr(lang, "Entry range", "ช่วงเข้า")}</th><th>{tr(lang, "Target", "เป้าหมาย")}</th><th>{tr(lang, "Stop", "จุดตัดขาดทุน")}</th></tr></thead>
                  <tbody><tr>
                    <td>7–15 {tr(lang, "days", "วัน")}</td>
                    <td>1:{s.riskReward}</td>
                    <td><strong>{money(s.entryLow)} – {money(s.entryHigh)}</strong></td>
                    <td><strong style={{ color: "#34d399" }}>{money(s.target)}</strong></td>
                    <td><strong style={{ color: "#f87171" }}>{money(s.stop)}</strong></td>
                  </tr></tbody>
                </table>
              </div>

              <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.65 }}>
                <p style={{ margin: "0 0 8px" }}>📈 <strong>{tr(lang, "MOMENTUM & RELATIVE STRENGTH", "โมเมนตัมและความแข็งแกร่งเชิงเปรียบเทียบ")}:</strong> {s.notes.momentum}</p>
                <p style={{ margin: "0 0 8px" }}>📡 <strong>{tr(lang, "VOLUME ACCUMULATION", "การสะสมปริมาณ")}:</strong> {s.notes.volume}</p>
                <p style={{ margin: "0 0 8px" }}>⚡ <strong>{tr(lang, "CATALYST DRIFT", "แรงส่งจากปัจจัยพื้นฐาน")}:</strong> {s.notes.catalyst}</p>
                <p style={{ margin: 0 }}>💡 <strong>{tr(lang, "SWING THESIS & EXECUTION", "แนวคิดและการเข้าเทรด")}:</strong> {s.notes.thesis}</p>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button className="btn" type="button" onClick={() => refer(s)} disabled={referred.has(s.ticker)}>
                  {referred.has(s.ticker) ? tr(lang, "✓ Referred to committee", "✓ ส่งเข้าที่ประชุมแล้ว") : tr(lang, "Refer to committee", "ส่งเข้าที่ประชุม")}
                </button>
                <button className="btn ghost sm" type="button" onClick={() => setOpen(open === s.ticker ? null : s.ticker)}>
                  {open === s.ticker ? tr(lang, "Hide the score breakdown", "ซ่อนรายละเอียดคะแนน") : tr(lang, "Show the score breakdown", "ดูรายละเอียดคะแนน")}
                </button>
                <small className="muted">{tr(lang, "Target method", "วิธีคำนวณเป้าหมาย")}: {s.targetMethod} · {tr(lang, "pivot", "จุด pivot")} {money(s.pivot)} ({s.extensionPct >= 0 ? "+" : ""}{s.extensionPct}%)</small>
              </div>

              {open === s.ticker && (
                <div style={{ marginTop: 12 }}>
                  <div className="table-wrap">
                    <table className="tbl">
                      <thead><tr><th>{tr(lang, "Factor", "ปัจจัย")}</th><th>{tr(lang, "Line", "รายการ")}</th><th className="num">{tr(lang, "Points", "คะแนน")}</th><th>{tr(lang, "Measurement", "การวัด")}</th></tr></thead>
                      <tbody>
                        {s.lines.map((l, k) => (
                          <tr key={k}>
                            <td style={{ fontSize: 11, color: "var(--muted)" }}>{l.factor}</td>
                            <td>{l.label}</td>
                            <td className="num">{l.points == null ? <span style={{ color: "#f87171" }}>{tr(lang, "not measured", "วัดไม่ได้")}</span> : `${l.points.toFixed(1)} / ${l.max}`}</td>
                            <td style={{ fontSize: 13 }}>{l.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {s.unmeasured.length > 0 && (
                    <div className="notice" style={{ marginTop: 10, fontSize: 13 }}>
                      <b>{tr(lang, "Unmeasured — scores zero", "วัดไม่ได้ — ให้ 0 คะแนน")}:</b> {s.unmeasured.join(" · ")}. {tr(lang, "The 100-point denominator is unchanged.", "ตัวหาร 100 คะแนนไม่เปลี่ยน")}
                    </div>
                  )}
                  <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>{s.winProbabilityNote}</p>
                </div>
              )}
            </article>
          ))}

          {result.nearReady.length > 0 && (
            <ResearchBucket
              lang={lang}
              title={tr(lang, "NEAR READY — one execution blocker", "ใกล้พร้อม — ติด Execution Gate 1 จุด")}
              subtitle={tr(lang, "Monitor the stated trigger; these are not committee-ready yet.", "ติดตาม trigger ที่ระบุ หุ้นกลุ่มนี้ยังส่งเข้าคณะกรรมการไม่ได้")}
              rows={result.nearReady}
              tone="#fbbf24"
            />
          )}

          {result.research.length > 0 && (
            <ResearchBucket
              lang={lang}
              title={tr(lang, "RESEARCH QUEUE — momentum exists, underwriting incomplete", "คิววิจัย — มีสัญญาณ แต่หลักฐานยังไม่ครบ")}
              subtitle={tr(lang, "Investment team owns the next evidence step; valuation remains pending until defensible.", "ทีม Investment ต้องเติมหลักฐานขั้นถัดไป และ Valuation จะเป็น Pending จนกว่าจะประเมินได้อย่างมีเหตุผล")}
              rows={result.research}
              tone="#60a5fa"
            />
          )}

          {result.rejected.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <button className="btn ghost sm" type="button" onClick={() => setShowRejected((v) => !v)}>
                {showRejected ? tr(lang, "Hide rejections", "ซ่อนรายการที่ตัดทิ้ง") : tr(lang, `Show ${result.rejected.length} rejection(s) and why`, `ดู ${result.rejected.length} ตัวที่ตัดทิ้งและเหตุผล`)}
              </button>
              {showRejected && (
                <div className="table-wrap" style={{ marginTop: 10 }}>
                  <table className="tbl">
                    <thead><tr><th>{tr(lang, "Ticker", "หุ้น")}</th><th>{tr(lang, "Filter", "ฟิลเตอร์")}</th><th>{tr(lang, "Reason", "เหตุผล")}</th></tr></thead>
                    <tbody>
                      {result.rejected.map((x, k) => (
                        <tr key={k}>
                          <td><strong>{x.ticker}</strong></td>
                          <td style={{ color: FILTER_TONE[x.filter] ?? "#94a3b8", fontWeight: 600, whiteSpace: "nowrap" }}>{x.filter}</td>
                          <td style={{ fontSize: 13 }}>{x.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="notice" style={{ marginTop: 16, fontSize: 12 }}>
            <b>{tr(lang, "Method", "วิธีการ")}</b>
            <p style={{ margin: "6px 0 0" }}>{result.methodology}</p>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
              {result.disclosures.map((d, k) => <li key={k}>{d}</li>)}
            </ul>
          </div>
          {!!result.warnings?.length && <div className="notice" style={{ marginTop: 10, fontSize: 12, borderColor: "var(--amber)" }}>{result.warnings.join(" · ")}</div>}
        </>
      )}
    </section>
  );
}

function M({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="metric"><span>{label}</span><strong style={{ fontSize: 17 }}>{value}</strong>{sub && <small className="muted">{sub}</small>}</div>;
}

function ResearchBucket({ lang, title, subtitle, rows, tone }: { lang: AppLang; title: string; subtitle: string; rows: ResearchCandidate[]; tone: string }) {
  return <section style={{ marginTop: 18 }}>
    <h4 className="sub" style={{ margin: 0, color: tone }}>{title}</h4>
    <p className="muted" style={{ margin: "6px 0 10px", fontSize: 12 }}>{subtitle}</p>
    <div style={{ display: "grid", gap: 10 }}>
      {rows.map((row, i) => <article key={row.ticker} className="card" style={{ margin: 0, padding: 13, borderLeft: `3px solid ${tone}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div><span className="tag">#{i + 1} · {row.bucket}</span><h4 style={{ margin: "7px 0 2px" }}>{row.ticker}</h4><small className="muted">{tr(lang, "Research rank", "คะแนนจัดอันดับ")} {row.rankScore}/100 · {tr(lang, "coverage", "ความครอบคลุม")} {row.coveragePct}%</small></div>
          <div style={{ textAlign: "right" }}><small className="muted">VALUATION</small><strong style={{ display: "block", color: "#fbbf24" }}>{tr(lang, "PENDING", "รอประเมิน")}</strong><small className="muted">{row.timeframe}</small></div>
        </div>
        <p style={{ margin: "10px 0 5px", fontSize: 13 }}><b>{tr(lang, "Why now", "เหตุผลที่ค้นพบ")}:</b> {row.whyNow}</p>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}><b style={{ color: tone }}>{row.primaryBlocker}</b> · {tr(lang, "Trigger needed", "สิ่งที่ต้องเกิดก่อน")}: {row.trigger}</p>
      </article>)}
    </div>
  </section>;
}
