"use client";

import { useEffect, useMemo, useState } from "react";
import { buildCapitalRecyclingPlan } from "@/lib/research/capitalRecyclingPolicy";
import { forecastActionPolicy, type ForecastActionRead, type ForecastOwner } from "@/lib/research/forecastActionPolicy";
import MomentumForecastCard from "./MomentumForecastCard";
import styles from "./MomentumForecastWorkspace.module.css";

type Scope = "holdings" | "research" | "cio";
type Filter = "ALL" | "FAVORABLE" | "RISK";
type HoldingPosition = { shares: number; avgCost: number | null };
type NamedRow = { ticker: string; owner: ForecastOwner; forecast: any; item: any; research?: any; holding?: HoldingPosition };
type ActionRow = NamedRow & { decision: ForecastActionRead };
type TrimPlan = { pct: number; heldShares: number; trimShares: number; remainingShares: number; price: number | null; trimValue: number | null; remainingValue: number | null };
type CapitalSnapshot = {
  totalNav: number | null;
  currentBufferUsd: number | null;
  currentBufferPct: number | null;
  cashFloorPct: number | null;
  targetValue: number | null;
  shortfallValue: number | null;
  deployableCash: number | null;
  posture: string;
  action: string;
  verified: boolean;
};
type InvResearchPack = { asOf: string | null; stage: string; candidates: any[]; source: string };

const INV_CACHE_KEY = "sentinel:inv-research-forecast:v27";
const INV_CACHE_MS = 15 * 60 * 1000;
const clean = (value: unknown): string => String(value ?? "").trim().toUpperCase();
const favorable = new Set<string>(["BULLISH", "SELECTIVE_BULLISH"]);
const risky = new Set<string>(["DEFENSIVE", "BEARISH"]);
const ownerOrder: ForecastOwner[] = ["INV_RESEARCH", "AM_HOLDING", "WATCHLIST"];
const roundShares = (value: number) => Math.round(value * 1e7) / 1e7;

const ownerLabel = (owner: ForecastOwner, lang: "en" | "th") => owner === "INV_RESEARCH"
  ? (lang === "th" ? "INV RESEARCH · ทีมลงทุน" : "INV RESEARCH · INVESTMENT TEAM")
  : owner === "AM_HOLDING"
    ? (lang === "th" ? "AM HOLDINGS · ทีมบริหารสินทรัพย์" : "AM HOLDINGS · ASSET MANAGEMENT")
    : (lang === "th" ? "WATCHLIST · รายการติดตาม" : "WATCHLIST · RESEARCH PIPELINE");

const compactOwner = (owner: ForecastOwner) => owner === "INV_RESEARCH" ? "INV RESEARCH" : owner === "AM_HOLDING" ? "AM HOLDINGS" : "WATCHLIST";
const formatShares = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 7 }).format(value);
const formatUsd = (value: number | null) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const safeNumber = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

function buildHoldingPositions(rows: any[]): Map<string, HoldingPosition> {
  const positions = new Map<string, { shares: number; costValue: number }>();
  for (const row of rows ?? []) {
    if (row?.closed_at) continue;
    const ticker = clean(row?.ticker);
    const shares = Number(row?.shares ?? 0);
    if (!ticker || !Number.isFinite(shares) || shares <= 0) continue;
    const avgCost = Number(row?.avg_cost);
    const previous = positions.get(ticker) ?? { shares: 0, costValue: 0 };
    previous.shares += shares;
    if (Number.isFinite(avgCost) && avgCost >= 0) previous.costValue += shares * avgCost;
    positions.set(ticker, previous);
  }
  return new Map(Array.from(positions.entries()).map(([ticker, row]) => [ticker, {
    shares: roundShares(row.shares),
    avgCost: row.shares > 0 && row.costValue > 0 ? row.costValue / row.shares : null,
  }]));
}

function trimPlan(row: ActionRow): TrimPlan | null {
  if (row.decision.action !== "TRIM") return null;
  const pct = Number(row.decision.recommendedTrimPct);
  const heldShares = Number(row.holding?.shares);
  if (!Number.isFinite(pct) || pct <= 0 || !Number.isFinite(heldShares) || heldShares <= 0) return null;
  const trimShares = Math.min(heldShares, roundShares(heldShares * pct / 100));
  const remainingShares = roundShares(Math.max(0, heldShares - trimShares));
  const marketPrice = Number(row.item?.price);
  const price = Number.isFinite(marketPrice) && marketPrice > 0 ? marketPrice : null;
  return {
    pct,
    heldShares,
    trimShares,
    remainingShares,
    price,
    trimValue: price == null ? null : trimShares * price,
    remainingValue: price == null ? null : remainingShares * price,
  };
}

function positionValue(row: ActionRow) {
  const shares = Number(row.holding?.shares);
  const price = Number(row.item?.price);
  return Number.isFinite(shares) && shares > 0 && Number.isFinite(price) && price > 0 ? shares * price : 0;
}

async function marketBatch(tickers: string[]) {
  const items: Record<string, any> = {};
  for (let index = 0; index < tickers.length; index += 25) {
    const chunk = tickers.slice(index, index + 25);
    const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) continue;
    const payload = await response.json().catch(() => ({ items: {} }));
    Object.assign(items, payload.items ?? {});
  }
  return items;
}

function readInvCache(): InvResearchPack | null {
  try {
    const raw = window.sessionStorage.getItem(INV_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.candidates) || !parsed.candidates.length) return null;
    if (Date.now() - Number(parsed.savedAt ?? 0) > INV_CACHE_MS) return null;
    return { asOf: parsed.asOf ?? null, stage: String(parsed.stage ?? "selected"), candidates: parsed.candidates, source: String(parsed.source ?? "INV Cross-Engine Research") };
  } catch { return null; }
}

async function loadInvResearch(): Promise<InvResearchPack> {
  const cached = readInvCache();
  if (cached) return cached;
  const response = await fetch(`/api/alpha-discovery?mode=multifactor&sector=All&top=10&t=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "INV Research unavailable");
  const preferred = ["selected", "valuation", "momentum", "qualified", "analyzed"];
  const stage = preferred.find(name => Array.isArray(payload?.stageCandidates?.[name]) && payload.stageCandidates[name].length > 0) ?? "analyzed";
  const candidates = (payload?.stageCandidates?.[stage] ?? payload?.picks ?? []).slice(0, 10);
  const fast = payload?.fastScan ?? payload?.pipeline?.fastScan ?? null;
  const source = fast?.scanned
    ? `INV Full-Universe Fast Scan · ${fast.scanned}/${fast.requested} screened · ${stage.toUpperCase()}`
    : `INV Cross-Engine Research · ${String(payload?.mode ?? "multifactor").toUpperCase()} · ${stage.toUpperCase()}`;
  const pack: InvResearchPack = { asOf: payload?.asOf ?? null, stage, candidates, source };
  try { window.sessionStorage.setItem(INV_CACHE_KEY, JSON.stringify({ ...pack, savedAt: Date.now() })); } catch { /* browser storage is optional */ }
  return pack;
}

async function loadCapitalSnapshot(): Promise<CapitalSnapshot> {
  const response = await fetch(`/api/capital-recycling?t=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "Capital recycling snapshot unavailable");
  return payload as CapitalSnapshot;
}

function allowedOwners(scope: Scope): ForecastOwner[] {
  if (scope === "holdings") return ["AM_HOLDING"];
  if (scope === "research") return ["INV_RESEARCH", "WATCHLIST"];
  return ownerOrder;
}

function defaultOwner(scope: Scope): ForecastOwner {
  return scope === "holdings" ? "AM_HOLDING" : "INV_RESEARCH";
}

function actionTone(action: string) {
  if (["BUY CANDIDATE", "ADD", "PROMOTE TO INV"].includes(action)) return styles.actionPositive;
  if (["TRIM", "SELL REVIEW", "AVOID"].includes(action)) return styles.actionRisk;
  return styles.actionNeutral;
}

export default function MomentumForecastWorkspace({ scope, lang = "en" }: { scope: Scope; lang?: "en" | "th" }) {
  const [rows, setRows] = useState<NamedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [researchWarning, setResearchWarning] = useState<string | null>(null);
  const [capitalWarning, setCapitalWarning] = useState<string | null>(null);
  const [capitalSnapshot, setCapitalSnapshot] = useState<CapitalSnapshot | null>(null);
  const [activeOwner, setActiveOwner] = useState<ForecastOwner>(defaultOwner(scope));
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => { setActiveOwner(defaultOwner(scope)); setFilter("ALL"); }, [scope]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setError(null); setResearchWarning(null); setCapitalWarning(null);
      try {
        const needResearch = scope !== "holdings";
        const capitalPromise = scope === "cio"
          ? loadCapitalSnapshot().then(data => ({ data, error: null as string | null })).catch((cause) => ({ data: null, error: cause instanceof Error ? cause.message : "Capital snapshot unavailable" }))
          : Promise.resolve({ data: null, error: null as string | null });
        const [portfolioResponse, watchResponse, invResult, capitalResult] = await Promise.all([
          fetch("/api/portfolio", { cache: "no-store" }),
          fetch("/api/watchlist", { cache: "no-store" }),
          needResearch ? loadInvResearch().catch((cause) => ({ error: cause instanceof Error ? cause.message : "INV Research unavailable" })) : Promise.resolve(null),
          capitalPromise,
        ]);
        const [portfolio, watch] = await Promise.all([portfolioResponse.json(), watchResponse.json()]);
        if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Portfolio unavailable");
        if (!watchResponse.ok) throw new Error(watch?.error ?? "Watchlist unavailable");
        if (active) {
          setCapitalSnapshot(capitalResult.data);
          if (capitalResult.error) setCapitalWarning(capitalResult.error);
        }

        const holdingPositions = buildHoldingPositions(portfolio?.holdings ?? []);
        const holdings = Array.from(holdingPositions.keys());
        const held = new Set<string>(holdings);
        const watchlist: string[] = (watch?.watchlist ?? [])
          .map((row: any) => clean(row.ticker))
          .filter((ticker: string) => Boolean(ticker) && !held.has(ticker));

        const invPack = invResult && !("error" in invResult) ? invResult as InvResearchPack : null;
        if (invResult && "error" in invResult && active) setResearchWarning(invResult.error);
        const invCandidates = (invPack?.candidates ?? []).filter((candidate: any) => Boolean(clean(candidate?.ticker)));
        const marketTickers = Array.from(new Set<string>([
          ...holdings,
          ...watchlist,
          ...invCandidates.map((candidate: any) => clean(candidate.ticker)),
        ]));
        const market = await marketBatch(marketTickers);

        const result: NamedRow[] = [];
        if (scope !== "holdings") {
          for (const candidate of invCandidates) {
            const ticker = clean(candidate.ticker);
            result.push({ ticker, owner: "INV_RESEARCH", forecast: market[ticker]?.momentumForecast ?? null, item: market[ticker] ?? null, research: { ...candidate, researchSource: invPack?.source, researchAsOf: invPack?.asOf } });
          }
        }
        if (scope === "holdings" || scope === "cio") {
          for (const ticker of holdings) result.push({ ticker, owner: "AM_HOLDING", forecast: market[ticker]?.momentumForecast ?? null, item: market[ticker] ?? null, holding: holdingPositions.get(ticker) });
        }
        if (scope === "research" || scope === "cio") {
          for (const ticker of watchlist) result.push({ ticker, owner: "WATCHLIST", forecast: market[ticker]?.momentumForecast ?? null, item: market[ticker] ?? null });
        }
        if (active) setRows(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Momentum Forecast unavailable");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [scope]);

  const owners = allowedOwners(scope);
  const sourceRows = useMemo(() => rows.filter(row => row.owner === activeOwner), [rows, activeOwner]);
  const sorted = useMemo(() => sourceRows.slice().sort((a, b) => {
    const fa = a.forecast, fb = b.forecast;
    const classA = favorable.has(fa?.outlook) ? 2 : risky.has(fa?.outlook) ? 0 : 1;
    const classB = favorable.has(fb?.outlook) ? 2 : risky.has(fb?.outlook) ? 0 : 1;
    return classB - classA || Number(fb?.confidence ?? 0) - Number(fa?.confidence ?? 0) || Number(fb?.expectedReturnPct ?? -999) - Number(fa?.expectedReturnPct ?? -999);
  }), [sourceRows]);
  const visible = sorted.filter(row => filter === "ALL" || (filter === "FAVORABLE" ? favorable.has(row.forecast?.outlook) : risky.has(row.forecast?.outlook)));
  const sourceForecasts = sourceRows.filter(row => row.forecast);
  const favorableCount = sourceForecasts.filter(row => favorable.has(row.forecast.outlook)).length;
  const riskCount = sourceForecasts.filter(row => risky.has(row.forecast.outlook)).length;
  const highConfidence = sourceForecasts.filter(row => Number(row.forecast.confidence) >= 75).length;
  const avgExpected = sourceForecasts.length ? sourceForecasts.reduce((sum, row) => sum + Number(row.forecast.expectedReturnPct ?? 0), 0) / sourceForecasts.length : null;

  const actions = useMemo<ActionRow[]>(() => rows
    .filter(row => row.forecast)
    .map(row => ({ ...row, decision: forecastActionPolicy({ ticker: row.ticker, owner: row.owner, forecast: row.forecast, research: row.research }) }))
    .sort((a, b) => b.decision.priority - a.decision.priority || Number(b.forecast?.confidence ?? 0) - Number(a.forecast?.confidence ?? 0)), [rows]);
  const deploy = actions.filter(row => ["BUY CANDIDATE", "ADD"].includes(row.decision.action));
  const reduce = actions.filter(row => ["TRIM", "SELL REVIEW"].includes(row.decision.action));
  const promote = actions.filter(row => row.decision.action === "PROMOTE TO INV");
  const passive = actions.filter(row => ["HOLD", "WATCH", "AVOID", "RESERVE"].includes(row.decision.action));
  const posture = reduce.length > deploy.length
    ? (lang === "th" ? "DEFENSIVE REBALANCE REVIEW · เน้นลดความเสี่ยง" : "DEFENSIVE REBALANCE REVIEW")
    : deploy.length > 0
      ? (lang === "th" ? "SELECTIVE DEPLOYMENT · เลือกเพิ่มเฉพาะตัวที่ผ่าน" : "SELECTIVE DEPLOYMENT")
      : (lang === "th" ? "HOLD / RESEARCH · ยังไม่ต้องเร่งปรับพอร์ต" : "HOLD / RESEARCH");

  const proposedTrimProceedsUsd = reduce.reduce((sum, row) => sum + (trimPlan(row)?.trimValue ?? 0), 0);
  const sellReviewPotentialUsd = reduce.filter(row => row.decision.action === "SELL REVIEW").reduce((sum, row) => sum + positionValue(row), 0);
  const recyclingPlan = useMemo(() => buildCapitalRecyclingPlan({
    proposedTrimProceedsUsd,
    sellReviewPotentialUsd,
    existingDeployableCashUsd: safeNumber(capitalSnapshot?.deployableCash),
    cashFloorShortfallUsd: safeNumber(capitalSnapshot?.shortfallValue),
    totalNavUsd: safeNumber(capitalSnapshot?.totalNav),
    candidates: deploy.map(row => ({
      ticker: row.ticker,
      action: row.decision.action as "BUY CANDIDATE" | "ADD",
      priority: row.decision.priority,
      confidence: safeNumber(row.forecast?.confidence),
      expectedReturnPct: safeNumber(row.forecast?.expectedReturnPct),
    })),
  }), [proposedTrimProceedsUsd, sellReviewPotentialUsd, capitalSnapshot, deploy]);

  const title = scope === "holdings"
    ? "AM Momentum Forecast · Holdings"
    : scope === "research"
      ? "Investment Research Forecast Board"
      : "CIO Momentum Forecast Board";
  const subtitle = scope === "holdings"
    ? (lang === "th" ? "ทีม Asset Management ใช้ Forecast เพื่อทบทวน ADD / HOLD / TRIM / SELL REVIEW ของหุ้นที่ถือจริง" : "Asset Management review of ADD / HOLD / TRIM / SELL REVIEW for actual holdings.")
    : scope === "research"
      ? (lang === "th" ? "แยก INV Research ออกจาก Watchlist ชัดเจน: Research หาโอกาสใหม่ ส่วน Watchlist เป็นคิวติดตาม" : "Separates INV Research from Watchlist: Research sources new ideas; Watchlist remains a monitoring pipeline.")
      : (lang === "th" ? "INV ค้นหาจาก Approved 3-Index universe แบบ full-universe fast scan ก่อน deep research และ CIO นำเงินจาก TRIM กลับมาใช้หลังเติม Cash Floor" : "INV full-universe fast-screens the approved three-index universe before deep research; CIO recycles approved trim proceeds after repairing the Cash Floor.");

  const renderActionGroup = (label: string, group: ActionRow[], emptyText: string) => <div className={styles.actionGroup}>
    <div className={styles.actionGroupHead}><strong>{label}</strong><span>{group.length}</span></div>
    {group.length ? group.slice(0, 8).map(row => {
      const plan = trimPlan(row);
      const currentValue = positionValue(row) || null;
      return <div className={styles.actionRow} key={`${label}:${row.owner}:${row.ticker}`}>
        <div className={styles.actionIdentity}><strong>{row.ticker}</strong><small>{compactOwner(row.owner)} · Confidence {Number(row.forecast?.confidence ?? 0)}/100 · Weighted {Number(row.forecast?.expectedReturnPct ?? 0) >= 0 ? "+" : ""}{Number(row.forecast?.expectedReturnPct ?? 0).toFixed(1)}%</small></div>
        <span className={`${styles.actionBadge} ${actionTone(row.decision.action)}`}>{row.decision.action}</span>
        {plan && <div className={styles.trimPlan}>
          <strong>TRIM {plan.pct}%</strong>
          <span>{lang === "th" ? `ขาย ≈ ${formatShares(plan.trimShares)} หุ้น · ≈ ${formatUsd(plan.trimValue)}` : `Sell ≈ ${formatShares(plan.trimShares)} shares · ≈ ${formatUsd(plan.trimValue)}`}</span>
          <small>{lang === "th" ? `ถือปัจจุบัน ${formatShares(plan.heldShares)} หุ้น · หลัง Trim เหลือ ≈ ${formatShares(plan.remainingShares)} หุ้น · ≈ ${formatUsd(plan.remainingValue)}` : `Current ${formatShares(plan.heldShares)} shares · after trim ≈ ${formatShares(plan.remainingShares)} shares · ≈ ${formatUsd(plan.remainingValue)}`}</small>
        </div>}
        {row.decision.action === "SELL REVIEW" && row.holding && <div className={styles.reviewPosition}>
          <strong>POSITION UNDER REVIEW</strong>
          <span>{formatShares(row.holding.shares)} {lang === "th" ? "หุ้น" : "shares"} · ≈ {formatUsd(currentValue)}</span>
          <small>{lang === "th" ? "ยังไม่นับเป็นเงินลงทุนใหม่จนกว่า Thesis / Fundamental Exit Gate จะอนุมัติและขายจริง" : "Not counted as recyclable capital until the Thesis / Fundamental Exit Gate approves and the sale is executed."}</small>
        </div>}
        <p>{row.decision.reason}</p>
      </div>;
    }) : <div className={styles.actionEmpty}>{emptyText}</div>}
  </div>;

  return <section className={styles.workspace} data-forecast-workspace={`v27-${scope}`} data-team-separation="INV-AM-WATCHLIST" data-trim-sizing="shares-usd" data-capital-recycling="cash-floor-first">
    <div className={styles.head}><div><h3 className={styles.title}>🔭 {title}</h3><p className={styles.subtitle}>{subtitle}</p></div><div className={styles.badges}><span className={styles.badge}>V27 · FULL-UNIVERSE FUNNEL</span><span className={styles.badge}>CAPITAL RECYCLING</span><span className={styles.badge}>NO AUTO TRADE</span></div></div>

    <div className={styles.sourceTabs} aria-label="Forecast source owner">
      {owners.map(owner => <button key={owner} type="button" className={`${styles.sourceTab} ${activeOwner === owner ? styles.sourceActive : ""}`} onClick={() => { setActiveOwner(owner); setFilter("ALL"); }}>
        <span>{ownerLabel(owner, lang)}</span><strong>{rows.filter(row => row.owner === owner).length}</strong>
      </button>)}
    </div>

    <div className={styles.summary}>
      <div className={styles.metric}><small>FAVORABLE</small><strong>{favorableCount}</strong></div>
      <div className={styles.metric}><small>HIGH CONFIDENCE</small><strong>{highConfidence}</strong></div>
      <div className={styles.metric}><small>RISK / DEFENSIVE</small><strong>{riskCount}</strong></div>
      <div className={styles.metric}><small>AVG WEIGHTED RETURN</small><strong>{avgExpected == null ? "—" : `${avgExpected >= 0 ? "+" : ""}${avgExpected.toFixed(1)}%`}</strong></div>
    </div>

    <div className={styles.filterBar}><span>{compactOwner(activeOwner)} FILTER</span><div className={styles.tabs}>{(["ALL", "FAVORABLE", "RISK"] as Filter[]).map(value => <button key={value} type="button" className={`${styles.tab} ${filter === value ? styles.active : ""}`} onClick={() => setFilter(value)}>{value} · {value === "ALL" ? sourceRows.length : value === "FAVORABLE" ? favorableCount : riskCount}</button>)}</div></div>

    {researchWarning && owners.includes("INV_RESEARCH") && <div className={styles.warning}>INV Research feed unavailable this cycle: {researchWarning}. Holdings/Watchlist remain independent and continue to display.</div>}
    {loading ? <div className={styles.empty}>Calculating team-owned probability forecasts…</div> : error ? <div className={styles.empty}>⚠ {error}</div> : visible.length ? <div className={styles.grid}>{visible.map(row => <div key={`${row.owner}:${row.ticker}`}><div className={styles.rowHead}><span className={styles.ticker}>{row.ticker}</span><span className={styles.context}>{compactOwner(row.owner)} · {row.item?.price ? `$${Number(row.item.price).toFixed(2)}` : "PRICE —"}</span></div><MomentumForecastCard forecast={row.forecast} context={row.owner === "AM_HOLDING" ? "holding" : row.owner === "WATCHLIST" ? "watchlist" : "cio"}/>{row.owner === "INV_RESEARCH" && row.research && <div className={styles.researchMeta}>INV gate · {String(row.research?.status ?? "RESEARCH")} · Valuation {row.research?.valuationReady ? "READY" : "REVIEW"} · Research upside {Number.isFinite(Number(row.research?.expectedReturnPct)) ? `${Number(row.research.expectedReturnPct).toFixed(1)}%` : "—"} · {String(row.research?.researchSource ?? "V27 Research")}</div>}</div>)}</div> : <div className={styles.empty}>{activeOwner === "INV_RESEARCH" ? "No INV Research names are available in this cycle. The board does not substitute Watchlist names for Research." : "No names in this source/filter."}</div>}

    <section className={styles.actionPanel} aria-label="Portfolio action summary">
      <div className={styles.actionHead}><div><span>FORECAST → DECISION → SIZE → RECYCLE</span><h4>Portfolio Action Summary</h4><p>{lang === "th" ? "TRIM/SELL ลดความเสี่ยง แต่เงินที่ได้ต้องถูกจัดเส้นทาง: เติม Cash Floor ก่อน แล้วค่อยหมุนกลับไปยัง BUY/ADD ที่ผ่านเกณฑ์" : "Risk reductions feed a governed capital loop: repair the Cash Floor first, then recycle excess into qualified BUY/ADD candidates."}</p></div><strong className={styles.posture}>{posture}</strong></div>
      <div className={styles.actionGrid}>
        {renderActionGroup(lang === "th" ? "BUY / ADD · เงินใหม่หรือเพิ่มของเดิม" : "BUY / ADD · CAPITAL DEPLOYMENT", deploy, lang === "th" ? "ยังไม่มี BUY/ADD ที่ผ่านเงื่อนไข" : "No qualified BUY/ADD action.")}
        {renderActionGroup(lang === "th" ? "TRIM / SELL REVIEW · ลดความเสี่ยง" : "TRIM / SELL REVIEW · RISK REDUCTION", reduce, lang === "th" ? "ยังไม่มีหุ้นที่ต้องลดหรือทบทวนขาย" : "No trim/sell review is required by the current forecast.")}
        {renderActionGroup(lang === "th" ? "WATCHLIST → INV · ส่งต่อให้ทีมลงทุน" : "WATCHLIST → INV · RESEARCH PROMOTION", promote, lang === "th" ? "ยังไม่มี Watchlist ที่ควรเลื่อนเข้า INV" : "No Watchlist name qualifies for INV promotion.")}
        {renderActionGroup("HOLD / WATCH / RESERVE", passive, lang === "th" ? "ไม่มีรายการรอ" : "No passive monitoring items.")}
      </div>

      {scope === "cio" && <section className={styles.recyclePanel} aria-label="Capital recycling plan">
        <div className={styles.recycleHead}><div><span>CAPITAL RECYCLING LOOP</span><h5>{lang === "th" ? "ใช้เงินจาก TRIM ให้เกิดประโยชน์ โดยรักษา Cash Floor ก่อน" : "Put trim proceeds back to work after protecting the Cash Floor"}</h5></div><strong>{capitalSnapshot?.posture ?? "VERIFY"}</strong></div>
        {capitalWarning && <div className={styles.recycleWarning}>⚠ {capitalWarning}</div>}
        <div className={styles.recycleMetrics}>
          <div><small>{lang === "th" ? "TRIM ที่เสนอ" : "PROPOSED TRIMS"}</small><strong>{formatUsd(recyclingPlan.proposedTrimProceedsUsd)}</strong></div>
          <div><small>{lang === "th" ? "เติม CASH FLOOR" : "CASH FLOOR REPAIR"}</small><strong>{formatUsd(recyclingPlan.cashFloorRepairUsd)}</strong></div>
          <div><small>{lang === "th" ? "พร้อมหมุนลงทุน" : "RECYCLABLE POOL"}</small><strong>{formatUsd(recyclingPlan.totalDeployablePoolUsd)}</strong></div>
          <div><small>{lang === "th" ? "SELL REVIEW (ยังไม่นับ)" : "SELL REVIEW · NOT COUNTED"}</small><strong>{formatUsd(recyclingPlan.sellReviewPotentialUsd)}</strong></div>
        </div>
        <div className={styles.recycleContext}>
          <span>{lang === "th" ? `Cash Buffer ${capitalSnapshot?.currentBufferPct == null ? "—" : `${Number(capitalSnapshot.currentBufferPct).toFixed(1)}%`} · Floor ${capitalSnapshot?.cashFloorPct == null ? "—" : `${Number(capitalSnapshot.cashFloorPct).toFixed(1)}%`}` : `Cash Buffer ${capitalSnapshot?.currentBufferPct == null ? "—" : `${Number(capitalSnapshot.currentBufferPct).toFixed(1)}%`} · Floor ${capitalSnapshot?.cashFloorPct == null ? "—" : `${Number(capitalSnapshot.cashFloorPct).toFixed(1)}%`}`}</span>
          <span>{lang === "th" ? `Shortfall ก่อน TRIM ${formatUsd(recyclingPlan.cashFloorShortfallUsd)}` : `Pre-trim shortfall ${formatUsd(recyclingPlan.cashFloorShortfallUsd)}`}</span>
        </div>
        {recyclingPlan.allocations.length ? <div className={styles.recycleAllocations}>
          <div className={styles.recycleAllocationHead}><strong>{lang === "th" ? "PROVISIONAL REINVESTMENT QUEUE" : "PROVISIONAL REINVESTMENT QUEUE"}</strong><span>{formatUsd(recyclingPlan.allocatedUsd)} allocated</span></div>
          {recyclingPlan.allocations.map(row => <div className={styles.recycleAllocation} key={`${row.action}:${row.ticker}`}>
            <div><strong>{row.ticker}</strong><small>{row.action} · Confidence {Math.round(row.confidence)}/100 · Weighted {row.expectedReturnPct >= 0 ? "+" : ""}{row.expectedReturnPct.toFixed(1)}%</small></div>
            <strong>{formatUsd(row.suggestedUsd)}</strong>
          </div>)}
          {recyclingPlan.unallocatedUsd > 0 && <div className={styles.recycleResidual}>{lang === "th" ? `คงเหลือ ${formatUsd(recyclingPlan.unallocatedUsd)} ใน Buffer จนกว่าจะมีปลายทางที่ผ่านเกณฑ์เพิ่ม` : `${formatUsd(recyclingPlan.unallocatedUsd)} remains in buffer pending additional qualified destinations.`}</div>}
        </div> : <div className={styles.recycleEmpty}>
          {recyclingPlan.totalDeployablePoolUsd > 0
            ? (lang === "th" ? `มีเงินพร้อมใช้ ${formatUsd(recyclingPlan.totalDeployablePoolUsd)} แต่ยังไม่มี BUY/ADD ที่ผ่านครบ จึงพักไว้ใน Buffer และให้ INV Full-Universe Scan ค้นหาปลายทางต่อ` : `${formatUsd(recyclingPlan.totalDeployablePoolUsd)} is deployable, but no BUY/ADD has passed every gate. Keep it in buffer while the full-universe INV scan searches for a qualified destination.`)
            : recyclingPlan.proposedTrimProceedsUsd > 0
              ? (lang === "th" ? "เงินจาก TRIM รอบนี้ถูกใช้เติม Cash Floor ก่อนทั้งหมด/เกือบทั้งหมด ยังไม่มีส่วนเกินสำหรับซื้อหุ้นใหม่" : "Current trim proceeds are consumed by Cash Floor repair, leaving no excess for new deployment yet.")
              : (lang === "th" ? "ยังไม่มีเงินจาก TRIM ที่อนุมัติเป็นแหล่งทุนใหม่" : "No proposed trim proceeds are available for recycling yet.")}
        </div>}
        <div className={styles.recycleFoot}>{lang === "th" ? "จำนวนเงินใน Reinvestment Queue เป็น sizing เบื้องต้น: BUY CANDIDATE จำกัดราว 3% NAV/ตัว และ ADD ราว 2% NAV/ตัว พร้อม cap ต่อ pool · ต้องผ่าน Funding/Risk/CIO ก่อนซื้อจริง · SELL REVIEW จะเข้าวงจรนี้หลังอนุมัติและเกิดรายการขายจริงเท่านั้น" : "Reinvestment sizing is provisional: BUY CANDIDATE is capped near 3% NAV/name and ADD near 2% NAV/name, with pool caps. Funding/Risk/CIO approval remains mandatory. SELL REVIEW proceeds enter this loop only after an approved, executed sale."}</div>
      </section>}

      <div className={styles.actionFoot}>{lang === "th" ? "TRIM sizing คำนวณจาก Portfolio Ledger × ราคาตลาดล่าสุด · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ · เงินจากการลดพอร์ตจะไม่ถูกปล่อยทิ้ง: Cash Floor มาก่อน แล้วค่อย Recycle ไปยังหุ้นที่ผ่าน Research/Forecast" : "TRIM sizing uses Portfolio Ledger shares × latest price. No automatic orders are sent. Risk-reduction proceeds are routed deliberately: Cash Floor first, then qualified research/forecast destinations."}</div>
    </section>

    <div className={styles.foot}>MCDX remains a synthetic price/volume proxy. Scenario probability is a model weight, not a calibrated guarantee. Forecast confidence measures evidence quality/coverage and is intentionally separate from probability.</div>
  </section>;
}
