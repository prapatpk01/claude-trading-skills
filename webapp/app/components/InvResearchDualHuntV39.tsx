"use client";

import { useMemo, useState } from "react";
import type { AppLang } from "../page";

type Lane = "ranking" | "momentum" | "thesis";
type Breakdown = {
  momentum?: number;
  growth?: number;
  earningsAcceleration?: number;
  quality?: number;
  relativeStrength?: number;
  valuation?: number;
  catalyst?: number;
};
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
  rank?: number;
  totalScore?: number;
  actionBand?: "BUY_NOW" | "ACCUMULATE" | "WATCHLIST" | "REJECT";
  breakdown?: Breakdown;
  missingToUpgrade?: string[];
  deepResearchReady?: boolean;
};
type Ranking = {
  version?: string;
  methodology?: string;
  poolSize?: number;
  fastRankedPoolSize?: number;
  deepResearchSize?: number;
  finalists?: Row[];
  bestAvailable?: Row[];
  counts?: { BUY_NOW?: number; ACCUMULATE?: number; WATCHLIST?: number; REJECT?: number };
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
  ranking?: Ranking;
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

function actionColor(action?: string) {
  if (action === "BUY_NOW") return "#55d9ad";
  if (action === "ACCUMULATE") return "#63d6ff";
  if (action === "WATCHLIST") return "#ffd166";
  return "#9db1d2";
}
function stateColor(state?: string) {
  const key = String(state ?? "").toUpperCase();
  if (key === "COMMITTEE_READY") return "#55d9ad";
  if (key === "RESEARCH_READY") return "#63d6ff";
  if (key === "DATA_LIMITED") return "#ffb86b";
  return "#9db1d2";
}
function factorLabel(key: keyof Breakdown) {
  return key === "earningsAcceleration" ? "EARN ACCEL"
    : key === "relativeStrength" ? "REL STR"
    : key.toUpperCase();
}

export default function InvResearchDualHuntV39({ lang }: { lang: AppLang }) {
  const [lane, setLane] = useState<Lane>("ranking");
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
      const query = new URLSearchParams({ top: "20", sector, theme });
      const explicit = tickers.split(",").map(value => value.trim().toUpperCase()).filter(Boolean).join(",");
      if (explicit) query.set("tickers", explicit);
      const response = await fetch(`/api/research/dual-discovery?${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error ?? "INV Research scan failed");
      setResult(payload);
      setLane(payload?.ranking?.finalists?.length ? "ranking" : payload?.momentum?.length ? "momentum" : "thesis");
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
        reason: row.thesis ?? row.whyNow ?? row.discoveryReasons?.join(" · ") ?? `INV V40 ranked ${row.actionBand ?? "research"} idea`,
        source: `INV Research V40 · ${(row.lanes ?? [row.lane]).filter(Boolean).join("+") || "RANKING"}`,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? `Could not add ${row.ticker}`);
    setAdded(previous => new Set(previous).add(row.ticker));
  }

  const rows = useMemo(() => {
    if (!result) return [] as Row[];
    if (lane === "momentum") return result.momentum ?? [];
    if (lane === "thesis") return result.thesis ?? [];
    return result.ranking?.finalists?.length ? result.ranking.finalists : result.combined ?? [];
  }, [result, lane]);

  const coverage = num(result?.universe?.coveragePct);
  const ready = result?.status === "READY";
  const counts = result?.ranking?.counts ?? {};
  const buyNow = counts.BUY_NOW ?? 0;
  const accumulate = counts.ACCUMULATE ?? 0;
  const watch = counts.WATCHLIST ?? 0;

  return (
    <section className="card" data-inv-research-v40="ranking-funnel" style={{ borderTop: "2px solid #63d6ff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="tag">INV RESEARCH V40 · RANKING-FIRST FUNNEL</span>
          <h2 className="section" style={{ margin: "12px 0 6px" }}>{tr(lang, "Rank the market first. Underwrite capital second.", "จัดอันดับหุ้นก่อน แล้วค่อยเข้มงวดตอนอนุมัติเงินลงทุน")}</h2>
          <p className="muted" style={{ maxWidth: 900, margin: 0 }}>{tr(lang,
            "Stage A measures the approved three-index universe. V40 keeps a broad best-available ranking pool, deep-researches the leaders, and always retains finalists even when no name is BUY NOW. Coverage is data quality; it is not a BUY/NO BUY switch. BUY NOW still requires the strict Committee Ready gate.",
            "Stage A วัดข้อมูลทั้ง S&P 500 + Nasdaq-100 + Russell 2000 แล้ว V40 จะจัดอันดับ Best Available ก่อน ค่อย Deep Research ตัวนำ และยังเก็บ Finalist ไว้เสมอแม้รอบนั้นไม่มี BUY NOW โดย Coverage ใช้วัดคุณภาพข้อมูล ไม่ใช่สวิตช์ BUY/NO BUY ส่วน BUY NOW ยังต้องผ่าน Committee Ready แบบเข้มงวดเหมือนเดิม")}</p>
        </div>
        <button className="btn primary" type="button" onClick={scan} disabled={loading}>{loading ? tr(lang, "Ranking…", "กำลังจัดอันดับ…") : tr(lang, "Run V40 Ranking", "รัน V40 Ranking")}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 16 }}>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Sector", "Sector")}<select value={sector} onChange={event => setSector(event.target.value)} style={{ width: "100%", marginTop: 5 }}>{SECTORS.map(item => <option key={item}>{item}</option>)}</select></label>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Thesis seed", "ธีมตั้งต้น")}<select value={theme} onChange={event => setTheme(event.target.value)} style={{ width: "100%", marginTop: 5 }}>{THEMES.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label className="muted" style={{ fontSize: 12 }}>{tr(lang, "Optional tickers", "Ticker เฉพาะ (ไม่บังคับ)")}<input value={tickers} onChange={event => setTickers(event.target.value)} placeholder="NVDA, ANET, MELI" style={{ width: "100%", marginTop: 5 }} /></label>
      </div>

      {error && <div style={{ marginTop: 14, color: "#ff7088", fontSize: 13 }}>{error}</div>}
      {result && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(135px,1fr))", gap: 8, marginTop: 16 }}>
          <div className="metric-card"><span>RADAR COVERAGE</span><strong>{coverage == null ? "—" : `${coverage.toFixed(1)}%`}</strong><small style={{ color: ready ? "#55d9ad" : "#ffb86b" }}>{ready ? "DATA READY" : "DATA LIMITED"}</small></div>
          <div className="metric-card"><span>RANKED POOL</span><strong>{result.ranking?.fastRankedPoolSize ?? result.ranking?.poolSize ?? result.stats?.momentumSeeds ?? 0}</strong><small>best available</small></div>
          <div className="metric-card"><span>DEEP RESEARCH</span><strong>{result.ranking?.deepResearchSize ?? result.stats?.momentumDeepAnalyzed ?? 0}</strong><small>bounded expensive pass</small></div>
          <div className="metric-card"><span>FINALISTS</span><strong>{result.ranking?.finalists?.length ?? result.combined?.length ?? 0}</strong><small>ranked, not forced buys</small></div>
          <div className="metric-card"><span>BUY NOW</span><strong style={{ color: actionColor("BUY_NOW") }}>{buyNow}</strong><small>strict committee gate</small></div>
          <div className="metric-card"><span>ACCUMULATE</span><strong style={{ color: actionColor("ACCUMULATE") }}>{accumulate}</strong><small>research/action prep</small></div>
          <div className="metric-card"><span>WATCHLIST</span><strong style={{ color: actionColor("WATCHLIST") }}>{watch}</strong><small>near-buy / wait</small></div>
        </div>

        {buyNow === 0 && (result.ranking?.bestAvailable?.length ?? 0) > 0 && <div style={{ marginTop: 14, padding: "12px 14px", border: "1px solid rgba(255,209,102,.28)", borderRadius: 12, background: "rgba(255,209,102,.06)", fontSize: 12, lineHeight: 1.55 }}>
          <b style={{ color: "#ffd166" }}>NO BUY NOW ≠ NO IDEAS</b><div className="muted" style={{ marginTop: 3 }}>{tr(lang, "The strict capital gate found no immediate BUY NOW, but V40 keeps the strongest ACCUMULATE / WATCHLIST names ranked below instead of discarding the entire scan.", "รอบนี้ Gate เงินลงทุนยังไม่มี BUY NOW แต่ V40 จะเก็บหุ้นที่ดีที่สุดในระดับ ACCUMULATE / WATCHLIST ไว้ด้านล่าง ไม่ทิ้งผลสแกนทั้งหมด")}</div>
        </div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          {(["ranking","momentum","thesis"] as Lane[]).map(id => <button key={id} type="button" className={`btn ${lane === id ? "primary" : "ghost"} sm`} onClick={() => setLane(id)}>{id === "ranking" ? tr(lang,"V40 Finalists","V40 Finalists") : id === "momentum" ? "Momentum Hunt" : "Thesis Hunt"} ({id === "ranking" ? result.ranking?.finalists?.length ?? result.combined?.length ?? 0 : id === "momentum" ? result.momentum?.length ?? 0 : result.thesis?.length ?? 0})</button>)}
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {rows.length === 0 && <div className="muted" style={{ padding: 14 }}>{tr(lang, "No measurable candidate rows returned. Review provider warnings; V40 does not convert missing data into a false rejection.", "ยังไม่มี Candidate ที่วัดได้ ให้ตรวจ Provider warnings โดย V40 จะไม่ตีความข้อมูลที่หายเป็นการ Reject แบบเท็จ")}</div>}
          {rows.map((row, index) => {
            const state = String(row.state ?? "DISCOVERED");
            const lanes = row.lanes?.length ? row.lanes.join(" + ") : row.lane ?? "DISCOVERY";
            const action = row.actionBand ?? (row.committeeReady ? "BUY_NOW" : "WATCHLIST");
            const displayScore = row.totalScore ?? row.score ?? 0;
            const breakdown = row.breakdown ?? {};
            return <article key={`${lane}-${row.ticker}`} style={{ border: "1px solid rgba(143,164,200,.16)", borderRadius: 14, padding: 14, background: "rgba(9,22,43,.62)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div><b style={{ color: "#8fa4c8", marginRight: 8 }}>#{row.rank ?? index + 1}</b><strong style={{ fontSize: 18 }}>{row.ticker}</strong><span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{row.sector ?? "Unknown"} · {lanes}</span></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}><b style={{ color: actionColor(action), fontSize: 12 }}>{action.replaceAll("_", " ")}</b><span style={{ color: stateColor(state), fontSize: 10 }}>{state.replaceAll("_", " ")}</span><button type="button" className="btn ghost sm" disabled={added.has(row.ticker)} onClick={() => void addResearch(row).catch(reason => setError(reason instanceof Error ? reason.message : "Watchlist write failed"))}>{added.has(row.ticker) ? tr(lang,"Added","เพิ่มแล้ว") : tr(lang,"Add Research","เพิ่มเข้า Research")}</button></div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: 8, marginTop: 10, fontSize: 12 }}>
                <div><span className="muted">V40 SCORE</span><strong style={{ display: "block" }}>{Math.round(Number(displayScore))}/100</strong></div>
                <div><span className="muted">DISCOVERY</span><strong style={{ display: "block" }}>{Math.round(Number(row.score ?? 0))}/100</strong></div>
                <div><span className="muted">PRICE</span><strong style={{ display: "block" }}>{money(row.price)}</strong></div>
                <div><span className="muted">UPSIDE</span><strong style={{ display: "block" }}>{pct(row.expectedReturnPct)}</strong></div>
                <div><span className="muted">LIFECYCLE</span><strong style={{ display: "block" }}>{row.lifecycleStage ?? "—"}</strong></div>
                <div><span className="muted">RS 3M</span><strong style={{ display: "block" }}>{pct(row.rs3m)}</strong></div>
              </div>
              {Object.keys(breakdown).length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(92px,1fr))", gap: 5, marginTop: 10 }}>{(Object.entries(breakdown) as Array<[keyof Breakdown, number]>).map(([key,value]) => <div key={key} style={{ padding: "6px 7px", borderRadius: 8, background: "rgba(143,164,200,.06)", fontSize: 10 }}><span className="muted">{factorLabel(key)}</span><b style={{ display: "block" }}>{Math.round(Number(value ?? 0))}</b></div>)}</div>}
              {(row.theme || row.thesis || row.whyNow) && <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.5 }}><b style={{ color: "#63d6ff" }}>{row.theme ?? tr(lang,"Investment thesis","Thesis")}</b>{row.thesis && <div style={{ marginTop: 3 }}>{row.thesis}</div>}{row.catalyst && <div className="muted" style={{ marginTop: 3 }}>Catalyst · {row.catalyst}</div>}{row.whyNow && <div className="muted" style={{ marginTop: 3 }}>Why now · {row.whyNow}</div>}</div>}
              {!row.thesis && row.discoveryReasons?.length ? <div className="muted" style={{ marginTop: 9, fontSize: 12 }}>{row.discoveryReasons.join(" · ")}</div> : null}
              {(row.missingToUpgrade?.length ?? 0) > 0 && <div style={{ marginTop: 9, fontSize: 11, color: "#ffd166" }}>{tr(lang,"To upgrade","รอเพื่ออัปเกรด")}: {row.missingToUpgrade?.join(" · ")}</div>}
            </article>;
          })}
        </div>

        <details style={{ marginTop: 14 }}><summary className="muted" style={{ cursor: "pointer" }}>{tr(lang,"V40 ranking methodology","วิธีจัดอันดับ V40")}</summary><div className="muted" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>{result.ranking?.methodology ?? result.methodology}<div style={{ marginTop: 5 }}>{tr(lang, "No analyst revision dataset is fabricated: the 15% earnings-acceleration pillar currently uses measured earnings/revenue growth evidence as the proxy.", "ระบบจะไม่สร้างข้อมูล Analyst Revision ขึ้นมาเอง: น้ำหนัก Earnings Acceleration 15% ตอนนี้ใช้ข้อมูล Earnings/Revenue Growth ที่วัดได้เป็น proxy")}</div></div></details>
        {(result.warnings?.length ?? 0) > 0 && <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: "pointer" }}>{tr(lang,"Data / research warnings","คำเตือนข้อมูล / Research")} ({result.warnings?.length})</summary><div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 8 }}>{result.warnings?.slice(0,12).map((warning,index) => <div key={index}>• {warning}</div>)}</div></details>}
      </>}
    </section>
  );
}
