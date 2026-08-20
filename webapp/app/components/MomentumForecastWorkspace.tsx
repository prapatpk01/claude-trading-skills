"use client";

import { useEffect, useMemo, useState } from "react";
import MomentumForecastCard from "./MomentumForecastCard";
import styles from "./MomentumForecastWorkspace.module.css";

type Scope = "holdings" | "watchlist" | "cio";
type Filter = "ALL" | "FAVORABLE" | "RISK";
type NamedRow = { ticker: string; kind: "HOLDING" | "WATCHLIST"; forecast: any; item: any };

const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const favorable = new Set(["BULLISH", "SELECTIVE_BULLISH"]);
const risky = new Set(["DEFENSIVE", "BEARISH"]);

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

export default function MomentumForecastWorkspace({ scope, lang = "en" }: { scope: Scope; lang?: "en" | "th" }) {
  const [rows, setRows] = useState<NamedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true); setError(null);
      try {
        const [portfolioResponse, watchResponse] = await Promise.all([
          fetch("/api/portfolio", { cache: "no-store" }),
          fetch("/api/watchlist", { cache: "no-store" }),
        ]);
        const [portfolio, watch] = await Promise.all([portfolioResponse.json(), watchResponse.json()]);
        if (!portfolioResponse.ok) throw new Error(portfolio?.error ?? "Portfolio unavailable");
        if (!watchResponse.ok) throw new Error(watch?.error ?? "Watchlist unavailable");
        const holdings = (portfolio?.holdings ?? [])
          .filter((row: any) => !row?.closed_at && Number(row?.shares) > 0)
          .map((row: any) => clean(row.ticker)).filter(Boolean);
        const held = new Set(holdings);
        const watchlist = (watch?.watchlist ?? []).map((row: any) => clean(row.ticker)).filter((ticker: string) => ticker && !held.has(ticker));
        const selected = scope === "holdings" ? holdings : scope === "watchlist" ? watchlist : [...holdings, ...watchlist];
        const tickers = Array.from(new Set(selected));
        const market = await marketBatch(tickers);
        const result: NamedRow[] = tickers.map(ticker => ({
          ticker,
          kind: held.has(ticker) ? "HOLDING" : "WATCHLIST",
          forecast: market[ticker]?.momentumForecast ?? null,
          item: market[ticker] ?? null,
        }));
        if (active) setRows(result);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Momentum Forecast unavailable");
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [scope]);

  const sorted = useMemo(() => rows.slice().sort((a, b) => {
    const fa = a.forecast, fb = b.forecast;
    const classA = favorable.has(fa?.outlook) ? 2 : risky.has(fa?.outlook) ? 0 : 1;
    const classB = favorable.has(fb?.outlook) ? 2 : risky.has(fb?.outlook) ? 0 : 1;
    return classB - classA || Number(fb?.confidence ?? 0) - Number(fa?.confidence ?? 0) || Number(fb?.expectedReturnPct ?? -999) - Number(fa?.expectedReturnPct ?? -999);
  }), [rows]);
  const visible = sorted.filter(row => filter === "ALL" || filter === "FAVORABLE" ? filter === "ALL" || favorable.has(row.forecast?.outlook) : risky.has(row.forecast?.outlook));
  const withForecast = rows.filter(row => row.forecast);
  const favorableCount = withForecast.filter(row => favorable.has(row.forecast.outlook)).length;
  const riskCount = withForecast.filter(row => risky.has(row.forecast.outlook)).length;
  const highConfidence = withForecast.filter(row => Number(row.forecast.confidence) >= 75).length;
  const avgExpected = withForecast.length ? withForecast.reduce((sum, row) => sum + Number(row.forecast.expectedReturnPct ?? 0), 0) / withForecast.length : null;

  const title = scope === "holdings"
    ? (lang === "th" ? "Momentum Forecast · Holdings" : "Momentum Forecast · Holdings")
    : scope === "watchlist"
      ? (lang === "th" ? "Momentum Forecast · Watchlist" : "Momentum Forecast · Watchlist")
      : (lang === "th" ? "CIO Momentum Forecast Board" : "CIO Momentum Forecast Board");
  const subtitle = scope === "holdings"
    ? (lang === "th" ? "มองเส้นทางราคา 20–60 วันทำการเพื่อช่วยตัดสินใจ ADD / HOLD / TRIM โดยไม่แทนที่ Thesis และ Fair Value" : "20–60 trading-day scenario view for ADD / HOLD / TRIM review without replacing thesis or Fair Value.")
    : scope === "watchlist"
      ? (lang === "th" ? "จัดลำดับ Watchlist จาก Momentum Lifecycle, Sentinel X และ MCDX Proxy พร้อม Trigger ก่อนส่งเข้า INV/CIO" : "Ranks Watchlist momentum paths with Lifecycle, Sentinel X and MCDX Proxy before INV/CIO review.")
      : (lang === "th" ? "ภาพเดียวสำหรับ CIO: Bear / Base / Bull Probability, Forecast Confidence และ Momentum Lifecycle ของ Holdings + Watchlist" : "One CIO view of Bear / Base / Bull probability, forecast confidence and Momentum Lifecycle across Holdings + Watchlist.");

  return <section className={styles.workspace} data-forecast-workspace={`v26-${scope}`}>
    <div className={styles.head}><div><h3 className={styles.title}>🔭 {title}</h3><p className={styles.subtitle}>{subtitle}</p></div><div className={styles.badges}><span className={styles.badge}>V26 · PROBABILITY</span><span className={styles.badge}>CONFIDENCE ≠ PROBABILITY</span><span className={styles.badge}>NO AUTO TRADE</span></div></div>
    <div className={styles.summary}>
      <div className={styles.metric}><small>FAVORABLE</small><strong>{favorableCount}</strong></div>
      <div className={styles.metric}><small>HIGH CONFIDENCE</small><strong>{highConfidence}</strong></div>
      <div className={styles.metric}><small>RISK / DEFENSIVE</small><strong>{riskCount}</strong></div>
      <div className={styles.metric}><small>AVG WEIGHTED RETURN</small><strong>{avgExpected == null ? "—" : `${avgExpected >= 0 ? "+" : ""}${avgExpected.toFixed(1)}%`}</strong></div>
    </div>
    <div className={styles.tabs}>{(["ALL", "FAVORABLE", "RISK"] as Filter[]).map(value => <button key={value} type="button" className={`${styles.tab} ${filter === value ? styles.active : ""}`} onClick={() => setFilter(value)}>{value} · {value === "ALL" ? rows.length : value === "FAVORABLE" ? favorableCount : riskCount}</button>)}</div>
    {loading ? <div className={styles.empty}>Calculating probability-weighted Momentum Forecast…</div> : error ? <div className={styles.empty}>⚠ {error}</div> : visible.length ? <div className={styles.grid}>{visible.map(row => <div key={`${row.kind}:${row.ticker}`}><div className={styles.rowHead}><span className={styles.ticker}>{row.ticker}</span><span className={styles.context}>{row.kind} · {row.item?.price ? `$${Number(row.item.price).toFixed(2)}` : "PRICE —"}</span></div><MomentumForecastCard forecast={row.forecast} context={scope === "holdings" ? "holding" : scope === "watchlist" ? "watchlist" : "cio"}/></div>)}</div> : <div className={styles.empty}>No names in this forecast filter.</div>}
    <div className={styles.foot}>MCDX remains a synthetic price/volume proxy. Scenario probability is a model weight, not a calibrated guarantee. Forecast confidence measures evidence quality/coverage and is intentionally separate from probability.</div>
  </section>;
}
