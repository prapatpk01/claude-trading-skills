"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AppLang } from "../page";
import CIOCommandCenterV351 from "./CIOCommandCenterV351";

type Position = { shares: number; avgCost: number };
type HorizonRead = {
  expectedReturnPct?: number | null;
  expectedAlphaPct?: number | null;
  probabilityPositivePct?: number | null;
  probabilityGain5Pct?: number | null;
  probabilityLoss5Pct?: number | null;
  rangeP10Pct?: number | null;
  rangeP90Pct?: number | null;
};
type ForecastRead = HorizonRead & {
  engineVersion?: string | null;
  modelAgreementPct?: number | null;
  confidence?: number | null;
  confidenceBand?: string | null;
  benchmark?: string | null;
  horizons?: Record<string, HorizonRead> | null;
};

type Props = { lang: AppLang; onNavigate: (id: string) => void };

const tickerPattern = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const money = (value: number) => `${value >= 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
const pct = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(1)}%`;
const probability = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? "—" : `${Math.round(Number(value))}%`;

function parsePrice(text: string | null | undefined) {
  const n = Number(String(text ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function aggregatePositions(rows: any[]) {
  const map = new Map<string, { shares: number; costValue: number }>();
  for (const row of rows ?? []) {
    if (row?.closed_at) continue;
    const ticker = clean(row?.ticker);
    const shares = Number(row?.shares ?? 0);
    const avgCost = Number(row?.avg_cost ?? 0);
    if (!tickerPattern.test(ticker) || !Number.isFinite(shares) || shares <= 0 || !Number.isFinite(avgCost) || avgCost <= 0) continue;
    const previous = map.get(ticker) ?? { shares: 0, costValue: 0 };
    previous.shares += shares;
    previous.costValue += shares * avgCost;
    map.set(ticker, previous);
  }
  return new Map<string, Position>(Array.from(map.entries()).map(([ticker, value]) => [ticker, {
    shares: value.shares,
    avgCost: value.shares > 0 ? value.costValue / value.shares : 0,
  }]));
}

function articleTicker(article: Element, positions: Map<string, Position>) {
  const candidates = Array.from(article.querySelectorAll("strong"))
    .map(node => clean(node.textContent))
    .filter(value => tickerPattern.test(value));
  return candidates.find(value => positions.has(value)) ?? candidates[0] ?? null;
}

function styleAnnotation(node: HTMLElement, positive: boolean | null) {
  node.style.display = "block";
  node.style.marginTop = "6px";
  node.style.fontSize = "11px";
  node.style.fontWeight = "700";
  node.style.letterSpacing = ".01em";
  node.style.lineHeight = "1.45";
  node.style.color = positive == null ? "#8fa4c8" : positive ? "#55d9ad" : "#ff7088";
}

function styleForecastDetails(details: HTMLDetailsElement) {
  details.style.marginTop = "8px";
  details.style.paddingTop = "7px";
  details.style.borderTop = "1px solid rgba(143,164,200,.16)";
  details.style.color = "#8fa4c8";
  details.style.fontSize = "10px";
  details.style.lineHeight = "1.5";
}

function actionTone(forecast: ForecastRead) {
  const expected = Number(forecast.expectedReturnPct ?? NaN);
  const pUp = Number(forecast.probabilityPositivePct ?? NaN);
  const pDown = Number(forecast.probabilityLoss5Pct ?? NaN);
  if (!Number.isFinite(expected) || !Number.isFinite(pUp)) return "WATCH";
  if (expected >= 5 && pUp >= 60 && (!Number.isFinite(pDown) || pDown <= 25)) return "ATTRACTIVE";
  if (expected < 0 || pUp < 45 || (Number.isFinite(pDown) && pDown >= 35)) return "DEFENSIVE";
  return "WATCH";
}

export default function CIOCommandCenterV37({ lang, onNavigate }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef<Map<string, Position>>(new Map());
  const forecastsRef = useRef<Map<string, ForecastRead>>(new Map());
  const marketKeyRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const th = String(lang).toLowerCase().startsWith("th");

  const decorate = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const positions = positionsRef.current;

    for (const label of Array.from(root.querySelectorAll("span"))) {
      if (clean(label.textContent) !== "CURRENT") continue;
      const metric = label.parentElement;
      const article = metric?.closest("article");
      const valueNode = metric?.querySelector("strong");
      if (!metric || !article || !valueNode) continue;
      const ticker = articleTicker(article, positions);
      const position = ticker ? positions.get(ticker) : null;
      const price = parsePrice(valueNode.textContent);
      let note = metric.querySelector<HTMLElement>("[data-current-pnl-v37]");
      if (!note) {
        note = document.createElement("small");
        note.dataset.currentPnlV37 = "true";
        metric.appendChild(note);
      }
      if (!position || price == null || position.avgCost <= 0) {
        const next = th ? "NEW POSITION · ยังไม่มี PnL" : "NEW POSITION · PnL unavailable";
        if (note.textContent !== next) note.textContent = next;
        styleAnnotation(note, null);
        continue;
      }
      const pnlUsd = (price - position.avgCost) * position.shares;
      const pnlPct = (price / position.avgCost - 1) * 100;
      const next = `PnL ${money(pnlUsd)} (${pct(pnlPct)}) · Avg ${position.avgCost.toFixed(2)}`;
      if (note.textContent !== next) note.textContent = next;
      styleAnnotation(note, pnlUsd >= 0);
    }

    for (const label of Array.from(root.querySelectorAll("span"))) {
      if (clean(label.textContent) !== "FORECAST" && !clean(label.textContent).startsWith("FORECAST ·")) continue;
      const metric = label.parentElement;
      const article = metric?.closest("article");
      if (!metric || !article) continue;
      const ticker = articleTicker(article, positions);
      const forecast = ticker ? forecastsRef.current.get(ticker) : null;
      if (!forecast) continue;
      if (label.textContent !== "FORECAST · 20D") label.textContent = "FORECAST · 20D";

      let note = metric.querySelector<HTMLElement>("[data-forecast-meta-v37]");
      if (!note) {
        note = document.createElement("small");
        note.dataset.forecastMetaV37 = "true";
        metric.appendChild(note);
      }
      const tone = actionTone(forecast);
      const next = th
        ? `โอกาสขึ้น ${probability(forecast.probabilityPositivePct)} · เสี่ยงลง >5% ${probability(forecast.probabilityLoss5Pct)}`
        : `Up chance ${probability(forecast.probabilityPositivePct)} · Downside >5% ${probability(forecast.probabilityLoss5Pct)}`;
      if (note.textContent !== next) note.textContent = next;
      styleAnnotation(note, tone === "ATTRACTIVE" ? true : tone === "DEFENSIVE" ? false : null);

      let details = metric.querySelector<HTMLDetailsElement>("[data-forecast-detail-v37]");
      if (!details) {
        details = document.createElement("details");
        details.dataset.forecastDetailV37 = "true";
        const summary = document.createElement("summary");
        summary.textContent = th ? "รายละเอียด Forecast" : "Forecast details";
        summary.style.cursor = "pointer";
        summary.style.fontWeight = "700";
        summary.style.color = "#8fa4c8";
        details.appendChild(summary);
        const body = document.createElement("div");
        body.dataset.forecastDetailBodyV37 = "true";
        body.style.marginTop = "6px";
        details.appendChild(body);
        metric.appendChild(details);
      }
      styleForecastDetails(details);
      const body = details.querySelector<HTMLElement>("[data-forecast-detail-body-v37]");
      const h5 = forecast.horizons?.["5D"];
      const h60 = forecast.horizons?.["60D"];
      if (body) {
        body.textContent = th
          ? `เหนือ ${forecast.benchmark ?? "SPY"} ${pct(forecast.expectedAlphaPct)} · โอกาส +5% ${probability(forecast.probabilityGain5Pct)} · ช่วง P10–P90 ${pct(forecast.rangeP10Pct)} → ${pct(forecast.rangeP90Pct)} · 5D ${pct(h5?.expectedReturnPct)} · 60D ${pct(h60?.expectedReturnPct)} · Model agreement ${probability(forecast.modelAgreementPct)}`
          : `Alpha vs ${forecast.benchmark ?? "SPY"} ${pct(forecast.expectedAlphaPct)} · Chance +5% ${probability(forecast.probabilityGain5Pct)} · P10–P90 ${pct(forecast.rangeP10Pct)} → ${pct(forecast.rangeP90Pct)} · 5D ${pct(h5?.expectedReturnPct)} · 60D ${pct(h60?.expectedReturnPct)} · Model agreement ${probability(forecast.modelAgreementPct)}`;
      }
      details.title = `Forecast V${forecast.engineVersion ?? "37.1"} · ${tone}`;
    }
  }, [th]);

  const refreshPortfolio = useCallback(async () => {
    try {
      const response = await fetch(`/api/portfolio?v37pnl=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      positionsRef.current = aggregatePositions(payload?.holdings ?? []);
      decorate();
    } catch { /* keep CIO usable if the PnL annotation source is temporarily unavailable */ }
  }, [decorate]);

  const refreshForecasts = useCallback(async () => {
    const root = rootRef.current;
    if (!root) return;
    const tickers = Array.from(root.querySelectorAll("article"))
      .flatMap(article => Array.from(article.querySelectorAll("strong")).map(node => clean(node.textContent)))
      .filter(value => tickerPattern.test(value));
    const unique = Array.from(new Set(tickers)).slice(0, 30);
    const key = unique.sort().join(",");
    if (!key || key === marketKeyRef.current) { decorate(); return; }
    marketKeyRef.current = key;
    try {
      const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(key)}&v37meta=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      forecastsRef.current = new Map(Object.entries(payload?.items ?? {}).map(([ticker, item]: [string, any]) => [clean(ticker), item?.momentumForecast ?? {}]));
      decorate();
    } catch { /* Forecast headline from the child remains visible without the annotation */ }
  }, [decorate]);

  const scheduleDecorate = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      decorate();
      void refreshForecasts();
    }, 120);
  }, [decorate, refreshForecasts]);

  useEffect(() => {
    void refreshPortfolio();
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    scheduleDecorate();
    const refresh = () => { marketKeyRef.current = ""; void refreshPortfolio(); scheduleDecorate(); };
    window.addEventListener("sentinel:portfolio-updated", refresh);
    return () => {
      observer.disconnect();
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      window.removeEventListener("sentinel:portfolio-updated", refresh);
    };
  }, [refreshPortfolio, scheduleDecorate]);

  return <div ref={rootRef} data-cio-wrapper="v37.1-decision-first"><CIOCommandCenterV351 lang={lang} onNavigate={onNavigate} /></div>;
}
