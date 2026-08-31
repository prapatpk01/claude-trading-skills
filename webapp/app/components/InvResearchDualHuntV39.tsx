"use client";

import { useMemo, useState } from "react";
import type { AppLang } from "../page";

type Lane = "combined" | "momentum" | "thesis";
type Row = {
  ticker: string;
  name?: string;
  sector?: string;
  lane?: string;
  lanes?: string[];
  state?: string;
  score?: number;
  confidenceScore?: number;
  price?: number | null;
  targetPrice?: number | null;
  expectedReturnPct?: number | null;
  lifecycleStage?: string;
  momentumScore?: number | null;
  fastScore?: number | null;
  rs3m?: number | null;
  return1m?: number | null;
  volumeRatio?: number | null;
  sectorLeadershipScore?: number | null;
  sectorLeadershipStatus?: string | null;
  theme?: string | null;
  thesis?: string | null;
  catalyst?: string | null;
  whyNow?: string | null;
  invalidation?: string | null;
  committeeReady?: boolean;
  discoveryReasons?: string[];
  hardBlocks?: string[];
  failedGates?: string[];
};
type Result = {
  version?: string;
  asOf?: string;
  status?: string;
  universe?: { approvedSize?: number; requested?: number; scanned?: number; coveragePct?: number; minimumCoveragePct?: number; provider?: string };
  market?: { sentimentLabel?: string; focusSectors?: string[] };
  momentum?: Row[];
  thesis?: Row[];
  combined?: Row[];
  stats?: { momentumSeeds?: number; momentumDeepAnalyzed?: number; thesisSeeds?: number; thesisDeepAnalyzed?: number; thesisUnderwritten?: number; committeeReady?: number };
  warnings?: string[];
  methodology?: string;
};

const SECTORS = ["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const THEMES = [
  ["ai-infrastructure","AI Infrastructure"],
  ["semiconductors","Semiconductors"],
  ["cloud-software","Cloud & Software"],
  ["cybersecurity","Cybersecurity"],
  ["aerospace-defense","Aerospace & Defense"],
  ["energy-transition","Energy Transition"],
  ["biotech","Biotech"],
  ["regional-banks","Regional Banks"],
] as const;
const tr = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;
const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : null;
const pct = (value: unknown) => num(value) == null ? "—" : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
const money = (value: unknown) => num(value) == null ? "—" : `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function stateColor(state?: string) {
  const key = String(state ?? "").toUpperCase();
  if (key === "COMMITTEE_READY") return "#55d9ad";
  if (key === "RESEARCH_READY") return "#63d6ff";
  if (key === "DATA_LIMITED") return "#ffb86b";
  return "#9db1d2";
}

export default function InvResearchDualHuntV39({ lang }: { lang: AppLang }) {
  const [lane, setLane] = useState<Lane>("combined");
  const [sector, setSector] = useState("All");
  const [theme, setTheme] = useState("ai-infrastructure");
  const [tickers, setTickers] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  async function scan() {
    setLoading(true); setError(null); setAdded(new Set());
    try {
      const query = new URLSearchParams({ top: "10", sector, theme });
      const explicit = tickers.split(",").map(value => value.trim().toUpperCase()).filter(Boolean).join(",");
      if (explicit) query.set("tickers", explicit);
      const response = await fetch(`/api/research/dual-discovery?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "INV Research scan failed");
      setResult(payload);
      const combined = payload?.combined ?? [];
      const momentum = payload?.momentum ?? [];
      const thesisRows = payload?.thesis ?? [];
      setLane(combined.length ? "combined" : momentum.length ? "momentum" : thesisRows.length ? "thesis" : "combined");
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "INV Research scan failed");
    } finally { setLoading(false); }
  }

  async function addResearch(row: Row) {
    const response = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: row.ticker,
        stage: "RESEARCH",
        target_price: row.targetPrice ?? null,
        reason: row.thesis ?? row.whyNow ?? row.discoveryReasons?.join(" · ") ?? `INV V39 ${row.lane ?? "dual"} discovery`,
        source: `INV Research V39 · ${(row.lanes ?? [row.lane]).filter(Boolean).join("+")}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? `Could not add ${row.ticker}`);
    setAdded(previous => new Set(previous).add(row.ticker));
  }

  const rows = useMemo(() => {
    if (!result) return [] as Row[];
    return lane === "momentum" ? result.momentum ?? [] : lane === "thesis" ? result.thesis ?? [] : result.combined ?? [];
  }, [result, lane]);

  const coverage = num(result?.universe?.coveragePct);
  const ready = result?.status === "READY";
  return (
    <section className="card" data-inv-research-v39="dual-hunt" style={{ borderTop: "2px solid #63d6ff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="tag">INV RESEARCH V39 · MOMENTUM + THESIS HUNT</span>
          <h2 className="section" style={{ margin: "12px 0 6px" }}>{tr(lang, "Find the move first. Underwrite it second.", "ค้นหาหุ้นที่กำลังมาให้เจอก่อน แล้วค่อย Underwrite")}</h2>
          <p className="muted" style={{ maxWidth: 860, margin: 0 }}>{tr(lang,
            "Momentum Hunt scans measured price/volume evidence across the approved three-index universe without requiring valuation just to show a candidate. Thesis Hunt searches leading sectors and catalysts, then deep-researches the strongest names. Valuation is required only before Committee Ready.",
            "Momentum Hunt ค้นจากราคา/Volume/Relative Strength ทั้ง universe โดยไม่บังคับ Valuation ก่อนถึงจะแสดงหุ้น ส่วน Thesis Hunt เริ่มจาก Sector ผู้นำ + Catalyst แล้วค่อยลงลึก Valuation จะบังคับเฉพาะตอนจะขึ้น Committee Ready เท่านั้น")}</p>
        </div>
        <button className="btn primary" type="button" onClick={scan} disabled={loading}>{loading ? tr(lang, "Scanning…", "กำลังสแกน…") : tr(lang, "Scan Momentum + Thesis", "สแกน Momentum + Thesis")}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 16 }}>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Sector", "Sector")}<select value={sector} onChange={event => setSector(event.target.value)} style={{ width: "100%", marginTop: 5 }}>{SECTORS.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Thesis seed", "ธีมตั้งต้น")}<select value={theme} onChange={event => setTheme(event.target.value)} style={{ width: "100%", marginTop: 5 }}>{THEMES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Optional tickers", "Ticker เฉพาะ (ไม่บังคับ)")}<input value={tickers} onChange={event => setTickers(event.target.value)} placeholder="NVDA, ANET, MELI" style={{ width: "100%", marginTop: 5 }} /></label>
      </div>

      {error && <div style={{ marginTop: 14, color: "#ff7088", fontSize: 13 }}>{error}</div>}
      {result && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 8, marginTop: 16 }}>
          <div className="metric-card"><span>RADAR COVERAGE</span><strong>{coverage == null ? "—" : `${coverage.toFixed(1)}%`}</strong><small style={{ color: ready ? "#55d9ad" : "#ffb86b" }}>{ready ? "MEASURED" : "DATA LIMITED"}</small></div>
          <div className="metric-card"><span>MOMENTUM SEEDS</span><strong>{result.stats?.momentumSeeds ?? 0}</strong><small>full-universe first pass</small></div>
          <div className="metric-card"><span>THESIS UNDERWRITTEN</span><strong>{result.stats?.thesisUnderwritten ?? 0}</strong><small>{(result.market?.focusSectors ?? []).slice(0,2).join(" · ") || "sector map"}</small></div>
          <div className="metric-card"><span>COMMITTEE READY</span><strong>{result.stats?.committeeReady ?? 0}</strong><small>strict gate retained</small></div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {(["combined","momentum","thesis"] as Lane[]).map(id => <button key={id} type="button" className={`btn ${lane === id ? "primary" : "ghost"} sm`} onClick={() => setLane(id)}>{id === "combined" ? tr(lang,"Best Ideas","ไอเดียรวม") : id === "momentum" ? "Momentum Hunt" : "Thesis Hunt"} ({id === "combined" ? result.combined?.length ?? 0 : id === "momentum" ? result.momentum?.length ?? 0 : result.thesis?.length ?? 0})</button>)}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {rows.length === 0 && <div className="muted" style={{ padding: 14 }}>{tr(lang, "No candidates returned. Review the warnings below; discovery no longer treats missing valuation as a reason to hide momentum candidates.", "ยังไม่พบ Candidate ให้ดู Warnings ด้านล่าง โดย V39 จะไม่ซ่อน Momentum เพียงเพราะ Valuation ยังไม่ครบแล้ว")}</div>}
          {rows.map(row => {
            const state = String(row.state ?? "DISCOVERED");
            const lanes = row.lanes?.length ? row.lanes.join(" + ") : row.lane ?? "DISCOVERY";
            return <article key={`${lane}-${row.ticker}`} style={{ border: "1px solid rgba(143,164,200,.16)", borderRadius: 14, padding: 14, background: "rgba(9,22,43,.62)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><strong style={{ fontSize: 18 }}>{row.ticker}</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{row.sector ?? "Unknown"} · {lanes}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ color: stateColor(state), fontSize: 12 }}>{state.replaceAll("_", " ")}</b><button type="button" className="btn ghost sm" disabled={added.has(row.ticker)} onClick={() => void addResearch(row).catch(reason => setError(reason instanceof Error ? reason.message : "Watchlist write failed"))}>{added.has(row.ticker) ? tr(lang,"Added","เพิ่มแล้ว") : tr(lang,"Add Research","เพิ่มเข้า Research")}</button></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: 8, marginTop: 10, fontSize: 12 }}>
                <div><span className="muted">DISCOVERY</span><strong style={{ display: "block" }}>{Math.round(Number(row.score ?? 0))}/100</strong></div>
                <div><span className="muted">CONFIDENCE</span><strong style={{ display: "block" }}>{Math.round(Number(row.confidenceScore ?? 0))}/100</strong></div>
                <div><span className="muted">PRICE</span><strong style={{ display: "block" }}>{money(row.price)}</strong></div>
                <div><span className="muted">UPSIDE</span><strong style={{ display: "block" }}>{pct(row.expectedReturnPct)}</strong></div>
                <div><span className="muted">LIFECYCLE</span><strong style={{ display: "block" }}>{row.lifecycleStage ?? "—"}</strong></div>
                <div><span className="muted">RS 3M</span><strong style={{ display: "block" }}>{pct(row.rs3m)}</strong></div>
              </div>
              {(row.theme || row.thesis || row.whyNow) && <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}><b style={{ color: "#63d6ff" }}>{row.theme ?? tr(lang,"Investment thesis","Thesis")}</b>{row.thesis && <div style={{ marginTop: 3 }}>{row.thesis}</div>}{row.catalyst && <div className="muted" style={{ marginTop: 3 }}>Catalyst · {row.catalyst}</div>}{row.whyNow && <div className="muted" style={{ marginTop: 3 }}>Why now · {row.whyNow}</div>}</div>}
              {!row.thesis && row.discoveryReasons?.length ? <div className="muted" style={{ marginTop: 9, fontSize: 12 }}>{row.discoveryReasons.join(" · ")}</div> : null}
            </article>;
          })}
        </div>

        {(result.warnings?.length ?? 0) > 0 && <details style={{ marginTop: 14 }}><summary className="muted" style={{ cursor: "pointer" }}>{tr(lang,"Data / research warnings","คำเตือนข้อมูล / Research")} ({result.warnings?.length})</summary><div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>{result.warnings?.slice(0,12).map((warning,index) => <div key={index}>• {warning}</div>)}</div></details>}
      </>}
    </section>
  );
}
