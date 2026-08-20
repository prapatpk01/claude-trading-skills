"use client";

import { useEffect, useMemo, useState } from "react";
import { forecastActionPolicy, type ForecastActionRead, type ForecastOwner } from "@/lib/research/forecastActionPolicy";
import MomentumForecastCard from "./MomentumForecastCard";
import styles from "./MomentumForecastWorkspace.module.css";

type Scope = "holdings" | "research" | "cio";
type Filter = "ALL" | "FAVORABLE" | "RISK";
type HoldingPosition = { shares: number; avgCost: number | null };
type NamedRow = { ticker: string; owner: ForecastOwner; forecast: any; item: any; research?: any; holding?: HoldingPosition };
type ActionRow = NamedRow & { decision: ForecastActionRead };
type TrimPlan = { pct: number; heldShares: number; trimShares: number; remainingShares: number; price: number | null; trimValue: number | null; remainingValue: number | null };

type InvResearchPack = { asOf: string | null; stage: string; candidates: any[]; source: string };

const INV_CACHE_KEY = "sentinel:inv-research-forecast:v26";
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
  const response = await fetch(`/api/alpha-discovery?mode=multifactor&sector=All&top=8&t=${Date.now()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error ?? "INV Research unavailable");
  const preferred = ["selected", "valuation", "momentum", "qualified", "analyzed"];
  const stage = preferred.find(name => Array.isArray(payload?.stageCandidates?.[name]) && payload.stageCandidates[name].length > 0) ?? "analyzed";
  const candidates = (payload?.stageCandidates?.[stage] ?? payload?.picks ?? []).slice(0, 8);
  const pack: InvResearchPack = {
    asOf: payload?.asOf ?? null,
    stage,
    candidates,
    source: `INV Cross-Engine Research · ${String(payload?.mode ?? "multifactor").toUpperCase()} · ${stage.toUpperCase()}`,
  };
  try { window.sessionStorage.setItem(INV_CACHE_KEY, JSON.stringify({ ...pack, savedAt: Date.now() })); } catch { /* browser storage is optional */ }
  return pack;
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
  const [activeOwner, setActiveOwner] = useState<ForecastOwner>(defaultOwner(scope));
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => { setActiveOwner(defaultOwner(scope)); setFilter("ALL"); }, [scope]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setError(null); setResearchWarning(null);
      try {
        const needResearch = scope !== "holdings";
        const [portfolioResponse, watchResponse, invResult] = await Promise.all([
          fetch("/api/portfolio", { cache: "no-store" }),
          fetch("/api/watchlist", { cache: "no-store" }),
          needResearch ? loadInvResearch().catch((cause) => ({ error: cause instanceof Error ? cause.message : "INV Research unavailable" })) : Promise.resolve(null),
        ]);
        const [portfolio, watch] = await Promise.all([portfolioResponse.json(), watchResponse.json()]);
        if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Portfolio unavailable");
        if (!watchResponse.ok) throw new Error(watch?.error ?? "Watchlist unavailable");

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

  const title = scope === "holdings"
    ? "AM Momentum Forecast · Holdings"
    : scope === "research"
      ? "Investment Research Forecast Board"
      : "CIO Momentum Forecast Board";
  const subtitle = scope === "holdings"
    ? (lang === "th" ? "ทีม Asset Management ใช้ Forecast เพื่อทบทวน ADD / HOLD / TRIM / SELL REVIEW ของหุ้นที่ถือจริง" : "Asset Management review of ADD / HOLD / TRIM / SELL REVIEW for actual holdings.")
    : scope === "research"
      ? (lang === "th" ? "แยก INV Research ออกจาก Watchlist ชัดเจน: Research หาโอกาสใหม่ ส่วน Watchlist เป็นคิวติดตาม" : "Separates INV Research from Watchlist: Research sources new ideas; Watchlist remains a monitoring pipeline.")
      : (lang === "th" ? "แยกความรับผิดชอบ 3 ส่วน: INV Research · AM Holdings · Watchlist แล้วสรุปเป็น Action Queue ให้ CIO" : "Three-owner CIO view: INV Research · AM Holdings · Watchlist, followed by a team-owned Action Queue.");

  const renderActionGroup = (label: string, group: ActionRow[], emptyText: string) => <div className={styles.actionGroup}>
    <div className={styles.actionGroupHead}><strong>{label}</strong><span>{group.length}</span></div>
    {group.length ? group.slice(0, 8).map(row => {
      const plan = trimPlan(row);
      const heldShares = Number(row.holding?.shares);
      const currentPrice = Number(row.item?.price);
      const currentValue = Number.isFinite(heldShares) && heldShares > 0 && Number.isFinite(currentPrice) && currentPrice > 0 ? heldShares * currentPrice : null;
      return <div className={styles.actionRow} key={`${label}:${row.owner}:${row.ticker}`}>
        <div className={styles.actionIdentity}><strong>{row.ticker}</strong><small>{compactOwner(row.owner)} · Confidence {Number(row.forecast?.confidence ?? 0)}/100 · Weighted {Number(row.forecast?.expectedReturnPct ?? 0) >= 0 ? "+" : ""}{Number(row.forecast?.expectedReturnPct ?? 0).toFixed(1)}%</small></div>
        <span className={`${styles.actionBadge} ${actionTone(row.decision.action)}`}>{row.decision.action}</span>
        {plan && <div className={styles.trimPlan}>
          <strong>TRIM {plan.pct}%</strong>
          <span>{lang === "th" ? `ขาย ≈ ${formatShares(plan.trimShares)} หุ้น · ≈ ${formatUsd(plan.trimValue)}` : `Sell ≈ ${formatShares(plan.trimShares)} shares · ≈ ${formatUsd(plan.trimValue)}`}</span>
          <small>{lang === "th" ? `ถือปัจจุบัน ${formatShares(plan.heldShares)} หุ้น · หลัง Trim เหลือ ≈ ${formatShares(plan.remainingShares)} หุ้น · ≈ ${formatUsd(plan.remainingValue)}` : `Current ${formatShares(plan.heldShares)} shares · after trim ≈ ${formatShares(plan.remainingShares)} shares · ≈ ${formatUsd(plan.remainingValue)}`}</small>
        </div>}
        {row.decision.action === "SELL REVIEW" && row.holding && <div className={styles.reviewPosition}>
          <strong>{lang === "th" ? "POSITION UNDER REVIEW" : "POSITION UNDER REVIEW"}</strong>
          <span>{formatShares(row.holding.shares)} {lang === "th" ? "หุ้น" : "shares"} · ≈ {formatUsd(currentValue)}</span>
          <small>{lang === "th" ? "ยังไม่กำหนดจำนวนขายจนกว่า Thesis / Fundamental Exit Gate จะอนุมัติ" : "No sell quantity is assigned until the Thesis / Fundamental Exit Gate approves the exit."}</small>
        </div>}
        <p>{row.decision.reason}</p>
      </div>;
    }) : <div className={styles.actionEmpty}>{emptyText}</div>}
  </div>;

  return <section className={styles.workspace} data-forecast-workspace={`v26-${scope}`} data-team-separation="INV-AM-WATCHLIST" data-trim-sizing="shares-usd">
    <div className={styles.head}><div><h3 className={styles.title}>🔭 {title}</h3><p className={styles.subtitle}>{subtitle}</p></div><div className={styles.badges}><span className={styles.badge}>V26.2 · POSITION SIZING</span><span className={styles.badge}>TEAM OWNERSHIP</span><span className={styles.badge}>NO AUTO TRADE</span></div></div>

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
    {loading ? <div className={styles.empty}>Calculating team-owned probability forecasts…</div> : error ? <div className={styles.empty}>⚠ {error}</div> : visible.length ? <div className={styles.grid}>{visible.map(row => <div key={`${row.owner}:${row.ticker}`}><div className={styles.rowHead}><span className={styles.ticker}>{row.ticker}</span><span className={styles.context}>{compactOwner(row.owner)} · {row.item?.price ? `$${Number(row.item.price).toFixed(2)}` : "PRICE —"}</span></div><MomentumForecastCard forecast={row.forecast} context={row.owner === "AM_HOLDING" ? "holding" : row.owner === "WATCHLIST" ? "watchlist" : "cio"}/>{row.owner === "INV_RESEARCH" && row.research && <div className={styles.researchMeta}>INV gate · {String(row.research?.status ?? "RESEARCH")} · Valuation {row.research?.valuationReady ? "READY" : "REVIEW"} · Research upside {Number.isFinite(Number(row.research?.expectedReturnPct)) ? `${Number(row.research.expectedReturnPct).toFixed(1)}%` : "—"}</div>}</div>)}</div> : <div className={styles.empty}>{activeOwner === "INV_RESEARCH" ? "No INV Research names are available in this cycle. The board does not substitute Watchlist names for Research." : "No names in this source/filter."}</div>}

    <section className={styles.actionPanel} aria-label="Portfolio action summary">
      <div className={styles.actionHead}><div><span>FORECAST → DECISION → SIZE</span><h4>Portfolio Action Summary</h4><p>{lang === "th" ? "สรุปสิ่งที่ควรทำต่อจาก Forecast พร้อมขนาด TRIM เป็น % / จำนวนหุ้น / มูลค่า $ โดยใช้ Holdings จริง" : "Recommended next actions after Forecast, with TRIM sized as percent / shares / dollars from the actual holding."}</p></div><strong className={styles.posture}>{posture}</strong></div>
      <div className={styles.actionGrid}>
        {renderActionGroup(lang === "th" ? "BUY / ADD · เงินใหม่หรือเพิ่มของเดิม" : "BUY / ADD · CAPITAL DEPLOYMENT", deploy, lang === "th" ? "ยังไม่มี BUY/ADD ที่ผ่านเงื่อนไข" : "No qualified BUY/ADD action.")}
        {renderActionGroup(lang === "th" ? "TRIM / SELL REVIEW · ลดความเสี่ยง" : "TRIM / SELL REVIEW · RISK REDUCTION", reduce, lang === "th" ? "ยังไม่มีหุ้นที่ต้องลดหรือทบทวนขาย" : "No trim/sell review is required by the current forecast.")}
        {renderActionGroup(lang === "th" ? "WATCHLIST → INV · ส่งต่อให้ทีมลงทุน" : "WATCHLIST → INV · RESEARCH PROMOTION", promote, lang === "th" ? "ยังไม่มี Watchlist ที่ควรเลื่อนเข้า INV" : "No Watchlist name qualifies for INV promotion.")}
        {renderActionGroup("HOLD / WATCH / RESERVE", passive, lang === "th" ? "ไม่มีรายการรอ" : "No passive monitoring items.")}
      </div>
      <div className={styles.actionFoot}>{lang === "th" ? "TRIM sizing คำนวณจากจำนวนหุ้นใน Portfolio Ledger × ราคาตลาดล่าสุด และเป็นค่าประมาณจนกว่าจะ Fill จริง · ขนาด TRIM ปรับตามความรุนแรงของ Forecast (ประมาณ 20–35%) · SELL REVIEW ยังไม่กำหนดจำนวนขายจนกว่าจะผ่าน Thesis/Fundamental Exit Gate · ไม่มีการส่งคำสั่งซื้อขายอัตโนมัติ" : "TRIM sizing uses Portfolio Ledger shares × latest market price and remains approximate until fill. Trim size adapts to forecast severity (about 20–35%). SELL REVIEW receives no sell quantity until the Thesis/Fundamental Exit Gate passes. No automatic order is sent."}</div>
    </section>

    <div className={styles.foot}>MCDX remains a synthetic price/volume proxy. Scenario probability is a model weight, not a calibrated guarantee. Forecast confidence measures evidence quality/coverage and is intentionally separate from probability.</div>
  </section>;
}
