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
type OpportunityBookRow = {
  ticker?: string;
  state?: string;
  reviewState?: string;
  theme?: string;
  sector?: string;
  opportunityScore?: number | null;
  confidenceScore?: number | null;
  thesisAgeDays?: number | null;
  daysRemaining?: number | null;
  winnerRank?: number | null;
  winnerCount?: number | null;
  scoreDelta?: number | null;
};
type ThemeSummary = {
  theme?: string;
  sector?: string;
  state?: string;
  opportunityScore?: number | null;
  confidenceScore?: number | null;
  leaders?: string[];
  ready?: number;
  watch?: number;
  horizonMinDays?: number;
  horizonMaxDays?: number;
};
type ResearchBookStatus = {
  version?: string;
  cycle?: { asOf?: string; ageHours?: number; fresh?: boolean; nextFullDiscoveryAt?: string } | null;
  opportunityBook?: OpportunityBookRow[];
  themes?: ThemeSummary[];
  policy?: { sectorThemeTargetPct?: number; radarPct?: number; openingWebsiteTriggersFullScan?: boolean; architecture?: string };
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

function researchStateColor(state: string) {
  if (state === "READY") return "#55d9ad";
  if (state === "WATCH") return "#ffd166";
  if (state === "INVALIDATED" || state === "ARCHIVED") return "#ff7088";
  return "#8fa4c8";
}

function formatResearchTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CIOCommandCenterV37({ lang, onNavigate }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef<Map<string, Position>>(new Map());
  const forecastsRef = useRef<Map<string, ForecastRead>>(new Map());
  const researchBookRef = useRef<ResearchBookStatus | null>(null);
  const marketKeyRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const th = String(lang).toLowerCase().startsWith("th");

  const decorateResearchBook = useCallback(() => {
    const root = rootRef.current;
    const status = researchBookRef.current;
    if (!root || !status) return;
    const marker = Array.from(root.querySelectorAll("span")).find(node => clean(node.textContent) === "02 · INV");
    const sectionHead = marker?.parentElement?.parentElement;
    const content = sectionHead?.parentElement;
    if (!sectionHead || !content) return;
    let card = content.querySelector<HTMLElement>("[data-inv-v38-book]");
    if (!card) {
      card = document.createElement("section");
      card.dataset.invV38Book = "true";
      card.style.margin = "14px 0 18px";
      card.style.padding = "16px";
      card.style.borderRadius = "18px";
      card.style.border = "1px solid rgba(85,217,173,.24)";
      card.style.background = "rgba(10,25,48,.78)";
      sectionHead.insertAdjacentElement("afterend", card);
    }
    const themes = (status.themes ?? []).slice(0, 4);
    const book = (status.opportunityBook ?? []).filter(row => !["ARCHIVED", "INVALIDATED"].includes(clean(row.state))).slice(0, 6);
    const cycle = status.cycle;
    const cycleText = cycle
      ? (th ? `ใช้ Research Cycle เดิม · อายุ ${Number(cycle.ageHours ?? 0).toFixed(1)} ชม. · Full scan ถัดไป ${formatResearchTime(cycle.nextFullDiscoveryAt)}` : `Reusing research cycle · ${Number(cycle.ageHours ?? 0).toFixed(1)}h old · next full scan ${formatResearchTime(cycle.nextFullDiscoveryAt)}`)
      : (th ? "ยังไม่มี Research Cycle ที่บันทึกไว้" : "No persisted research cycle yet");
    const themeHtml = themes.length
      ? themes.map(row => `<span style="display:inline-block;margin:4px 6px 0 0;padding:5px 8px;border-radius:999px;background:rgba(78,124,255,.12);font-size:11px;color:#b7c8e8"><b>${row.theme ?? row.sector ?? "Theme"}</b> · ${row.state ?? "ACTIVE"} · ${Math.round(Number(row.opportunityScore ?? 0))}/${Math.round(Number(row.confidenceScore ?? 0))}</span>`).join("")
      : `<span style="color:#8fa4c8;font-size:12px">${th ? "รอ Thesis ที่ผ่านการวิจัย" : "Waiting for an underwritten thesis"}</span>`;
    const bookHtml = book.length
      ? book.map(row => {
          const state = clean(row.state || "DISCOVERED");
          const delta = row.scoreDelta == null ? "" : ` · Δ ${Number(row.scoreDelta) >= 0 ? "+" : ""}${Number(row.scoreDelta).toFixed(0)}`;
          const winner = row.winnerRank ? ` · #${row.winnerRank}/${row.winnerCount ?? "?"} winner` : "";
          const daysRemaining = Math.max(0, Math.round(Number(row.daysRemaining ?? 0)));
          const reviewCountdown = th ? `ทบทวนใน ${daysRemaining} วัน` : `Review in ${daysRemaining}d`;
          return `<div style="display:grid;grid-template-columns:minmax(58px,.7fr) minmax(72px,.8fr) 1.5fr;gap:8px;padding:7px 0;border-top:1px solid rgba(143,164,200,.10);font-size:11px;line-height:1.35"><b style="color:#eef4ff">${row.ticker ?? "—"}</b><b style="color:${researchStateColor(state)}">${state}</b><span style="color:#8fa4c8">${row.theme ?? row.sector ?? "—"} · O ${Math.round(Number(row.opportunityScore ?? 0))} · C ${Math.round(Number(row.confidenceScore ?? 0))}${delta}${winner} · ${reviewCountdown}</span></div>`;
        }).join("")
      : `<div style="margin-top:8px;color:#8fa4c8;font-size:12px">${th ? "ยังไม่มีหุ้นใน Persistent Opportunity Book" : "Persistent Opportunity Book is empty"}</div>`;
    card.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap"><div><div style="font-size:11px;letter-spacing:.16em;color:#63d6ff;font-weight:800">INV RESEARCH V38 · PERSISTENT THESIS & WINNER BOOK</div><div style="margin-top:5px;font-size:12px;color:#9db1d2">${cycleText}</div></div><div style="font-size:11px;color:#8fa4c8;text-align:right">${th ? "Sector/Theme 80% · Radar 20% · Horizon 14–90D · ลดสถานะเมื่ออ่อน 2 รอบ" : "Sector/Theme 80% · Radar 20% · 14–90D horizon · 2-review downgrade hysteresis"}</div></div><div style="margin-top:8px">${themeHtml}</div><div style="margin-top:8px">${bookHtml}</div>`;
  }, [th]);

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
    decorateResearchBook();
  }, [decorateResearchBook, th]);

  const refreshPortfolio = useCallback(async () => {
    try {
      const response = await fetch(`/api/portfolio?v37pnl=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      positionsRef.current = aggregatePositions(payload?.holdings ?? []);
      decorate();
    } catch { /* keep CIO usable if the PnL annotation source is temporarily unavailable */ }
  }, [decorate]);

  const refreshResearchBook = useCallback(async () => {
    try {
      const response = await fetch(`/api/research/opportunity-book?v38=${Date.now()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return;
      researchBookRef.current = payload as ResearchBookStatus;
      decorateResearchBook();
    } catch { /* Research cycle remains usable even when the diagnostic card cannot load. */ }
  }, [decorateResearchBook]);

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
    void refreshResearchBook();
    const root = rootRef.current;
    if (!root) return;
    const observer = new MutationObserver(scheduleDecorate);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    scheduleDecorate();
    const refresh = () => { marketKeyRef.current = ""; void refreshPortfolio(); void refreshResearchBook(); scheduleDecorate(); };
    window.addEventListener("sentinel:portfolio-updated", refresh);
    return () => {
      observer.disconnect();
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      window.removeEventListener("sentinel:portfolio-updated", refresh);
    };
  }, [refreshPortfolio, refreshResearchBook, scheduleDecorate]);

  return <div ref={rootRef} data-cio-wrapper="v38-persistent-research-v37.1-forecast"><CIOCommandCenterV351 lang={lang} onNavigate={onNavigate} /></div>;
}