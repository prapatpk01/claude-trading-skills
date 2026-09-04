"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AppLang } from "../page";

type MarketItem = {
  price?: number | null;
  technicalOverlay?: any;
  momentumForecast?: any;
};

type Props = { lang: AppLang };

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const RESERVED = new Set([
  "ADD", "BEAR", "BULL", "CARRIED", "CIO", "COMPLETE", "CURRENT", "DEFERRED", "EXIT", "FLOW", "HOLD",
  "LOCATION", "MARKET", "NEUTRAL", "PASS", "PROFIT", "READY", "SELL", "STRONG", "TRIM", "VETO", "WATCH",
]);
const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const signed = (value: unknown, digits = 0) => {
  const n = finite(value);
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;
};
const pct = (value: unknown, digits = 1) => {
  const n = finite(value);
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
};
const money = (value: unknown) => {
  const n = finite(value);
  return n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
};

function powerBar(value: unknown) {
  const n = Math.max(-100, Math.min(100, finite(value) ?? 0));
  const p = Math.round(n / 25);
  if (p <= -4) return "◆───○────";
  if (p === -3) return "─◆──○────";
  if (p === -2) return "──◆─○────";
  if (p === -1) return "───◆○────";
  if (p === 0) return "────◆────";
  if (p === 1) return "────○◆───";
  if (p === 2) return "────○─◆──";
  if (p === 3) return "────○──◆─";
  return "────○───◆";
}

function forecastTone(direction: string, veto: boolean) {
  if (veto) return "#ff7088";
  if (direction === "BULLISH") return "#55d9ad";
  if (direction === "BEARISH") return "#ff7088";
  return "#ffd166";
}

function findTicker(node: Element): string | null {
  const candidates = Array.from(node.querySelectorAll("strong"))
    .map(element => clean(element.textContent))
    .filter(value => TICKER.test(value) && !RESERVED.has(value) && !/^V\d/.test(value));
  return candidates[0] ?? null;
}

function findSectionByHeading(root: ParentNode, patterns: string[]) {
  const heading = Array.from(root.querySelectorAll("h2")).find(node => {
    const value = clean(node.textContent);
    return patterns.some(pattern => value.includes(clean(pattern)));
  });
  if (!heading) return null;
  let current: HTMLElement | null = heading.parentElement;
  for (let i = 0; current && i < 6; i += 1, current = current.parentElement) {
    if (current.querySelector("article") || current.querySelector("table")) return current;
  }
  return heading.parentElement;
}

function setTextExact(root: ParentNode, selector: string, from: string, to: string) {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if ((node.textContent ?? "").trim() === from) node.textContent = to;
  }
}

function compactState(value: unknown) {
  return String(value ?? "NEUTRAL").replaceAll("_", " ");
}

function createPowerPanel(item: MarketItem, lang: AppLang) {
  const overlay = item.technicalOverlay;
  const sentinel = overlay?.sentinel;
  const mcdx = overlay?.mcdx;
  const forecast = sentinel?.forecast;
  const flow = finite(mcdx?.flowPower) ?? 0;
  const power = finite(sentinel?.degreesOfPower) ?? 0;
  const absorption = mcdx?.liquidity?.bullAbsorption ? "SSL ABSORB" : mcdx?.liquidity?.bearAbsorption ? "BSL ABSORB" : "NO ABSORPTION";
  const htf = mcdx?.htf?.direction ?? "UNAVAILABLE";

  const panel = document.createElement("div");
  panel.dataset.sentinelPowerPanelV40 = "true";
  panel.style.margin = "10px 0";
  panel.style.padding = "10px 12px";
  panel.style.border = "1px solid rgba(99,214,255,.18)";
  panel.style.borderRadius = "12px";
  panel.style.background = "rgba(7,18,38,.62)";
  panel.style.fontSize = "10px";
  panel.style.lineHeight = "1.55";
  panel.style.letterSpacing = ".02em";

  const row = (label: string, bar: string, value: number, extra: string) => {
    const div = document.createElement("div");
    div.style.display = "grid";
    div.style.gridTemplateColumns = "minmax(92px,.8fr) minmax(145px,1.4fr) auto";
    div.style.gap = "7px";
    div.style.alignItems = "center";
    const name = document.createElement("b");
    name.textContent = label;
    name.style.color = "#9db1d2";
    const meter = document.createElement("span");
    meter.textContent = `Bear ${bar} Bull`;
    meter.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, monospace";
    meter.style.whiteSpace = "nowrap";
    meter.style.color = value > 12 ? "#55d9ad" : value < -12 ? "#ff7088" : "#8fa4c8";
    const tail = document.createElement("span");
    tail.textContent = `${signed(value)}${extra ? ` · ${extra}` : ""}`;
    tail.style.whiteSpace = "nowrap";
    tail.style.color = "#b7c8e8";
    div.append(name, meter, tail);
    return div;
  };

  panel.append(
    row("SENTINEL POWER", powerBar(power), power, sentinel?.qualityLabel ?? ""),
    row("MCDX FLOW", powerBar(flow), flow, compactState(mcdx?.flowState)),
  );

  const footer = document.createElement("div");
  footer.style.marginTop = "5px";
  footer.style.paddingTop = "5px";
  footer.style.borderTop = "1px solid rgba(143,164,200,.10)";
  footer.style.color = "#8fa4c8";
  footer.textContent = lang === "th"
    ? `Forecast ${forecast?.direction ?? "NEUTRAL"} · Conf ${Math.round(finite(forecast?.confidence) ?? 0)} · MCDX Δ ${signed(mcdx?.flowDelta, 1)} · Accel ${signed(mcdx?.flowAccel, 1)} · HTF ${htf} · ${absorption}`
    : `Forecast ${forecast?.direction ?? "NEUTRAL"} · Conf ${Math.round(finite(forecast?.confidence) ?? 0)} · MCDX Δ ${signed(mcdx?.flowDelta, 1)} · Accel ${signed(mcdx?.flowAccel, 1)} · HTF ${htf} · ${absorption}`;
  panel.appendChild(footer);
  return panel;
}

export default function SentinelTechnicalUXV40({ lang }: Props) {
  const marketRef = useRef<Map<string, MarketItem>>(new Map());
  const marketKeyRef = useRef("");
  const timerRef = useRef<number | null>(null);
  const loadingRef = useRef(false);

  const replaceLegacyV34 = useCallback(() => {
    const root = document;
    setTextExact(root, "th,span,small", "V34 UNIFIED DECISION", "V40 UNIFIED DECISION");
    setTextExact(root, "span", "UNIFIED V34", "UNIFIED V40");
    setTextExact(root, "span", "V34 · TREND → FLOW → LOCATION → ACTION", "V40 · SENTINEL DIRECTION → MCDX CONVICTION → LOCATION → ACTION");
    setTextExact(root, "p", "Committee action and V34 review are shown as separate approval layers.", "Committee action and Sentinel X 6.4 / MCDX 4.0 review are separate approval layers.");
    setTextExact(root, "p", "แยกมติ Committee ออกจาก Technical V34 Review ให้ชัด", "แยกมติ Committee ออกจาก Sentinel X 6.4 / MCDX 4.0 Review ให้ชัด");

    for (const node of Array.from(root.querySelectorAll<HTMLElement>("small,span,p"))) {
      const text = (node.textContent ?? "").trim();
      if (text === "Policy V34") node.textContent = "Policy V40 · Sentinel X 6.4 + MCDX 4.0";
      else if (/^V34\s+(ADD|HOLD|PROFIT WATCH|TRIM REVIEW|EXIT REVIEW|—)$/.test(text)) node.textContent = text.replace(/^V34/, "V40");
      else if (text.startsWith("V34 uses one policy everywhere:")) node.textContent = "V40: Sentinel X 6.4 owns direction, setup and forecast; MCDX 4.0 owns institutional-flow conviction. Location alone never forces a trim.";
    }
  }, []);

  const collectTickers = useCallback(() => {
    const result = new Set<string>();
    const action = findSectionByHeading(document, ["Portfolio Action Queue", "คิวจัดการพอร์ต"]);
    const monitor = findSectionByHeading(document, ["Portfolio & Watchlist Market Monitor"]);
    for (const container of [action, monitor]) {
      if (!container) continue;
      for (const node of Array.from(container.querySelectorAll("article,tbody tr"))) {
        const ticker = findTicker(node);
        if (ticker) result.add(ticker);
      }
    }
    return [...result];
  }, []);

  const decorateActionQueue = useCallback(() => {
    const section = findSectionByHeading(document, ["Portfolio Action Queue", "คิวจัดการพอร์ต"]);
    if (!section) return;
    for (const article of Array.from(section.querySelectorAll<HTMLElement>("article"))) {
      const ticker = findTicker(article);
      const item = ticker ? marketRef.current.get(ticker) : null;
      const overlay = item?.technicalOverlay;
      if (!ticker || !item || !overlay) continue;
      const sentinel = overlay.sentinel;
      const mcdx = overlay.mcdx;
      const forecast = sentinel?.forecast;
      const companion = sentinel?.companion;
      const direction = String(forecast?.direction ?? "NEUTRAL");
      const veto = companion?.forecastStatus === "VETO";
      const metricLabel = Array.from(article.querySelectorAll<HTMLElement>("span")).find(node => clean(node.textContent).startsWith("FORECAST"));
      const metric = metricLabel?.parentElement;
      const main = metric?.querySelector<HTMLElement>("strong");
      if (metricLabel && metric && main) {
        metricLabel.textContent = "SENTINEL X FORECAST";
        const price = finite(item.price);
        const target1 = finite(forecast?.target1);
        const targetPct = price != null && price > 0 && target1 != null ? (target1 / price - 1) * 100 : null;
        main.textContent = forecast?.valid && targetPct != null ? `T1 ${pct(targetPct)}` : direction;
        main.style.color = forecastTone(direction, veto);

        let note = metric.querySelector<HTMLElement>("[data-sentinel-forecast-v40]");
        if (!note) {
          note = document.createElement("small");
          note.dataset.sentinelForecastV40 = "true";
          note.style.display = "block";
          note.style.marginTop = "6px";
          note.style.fontSize = "10px";
          note.style.fontWeight = "750";
          note.style.lineHeight = "1.45";
          metric.appendChild(note);
        }
        const setup = sentinel?.setup && sentinel.setup !== "NONE" ? `${sentinel.setup} ${sentinel.setupGrade ?? ""}`.trim() : "NO SETUP";
        note.textContent = `${direction} · CONF ${Math.round(finite(forecast?.confidence) ?? 0)}% · ${setup} · MCDX ${companion?.forecastStatus ?? "NEUTRAL"} ${signed(mcdx?.flowPower)}`;
        note.style.color = forecastTone(direction, veto);

        const legacy = metric.querySelector<HTMLElement>("[data-forecast-meta-v37]");
        const momentum = item.momentumForecast;
        if (legacy && momentum) {
          legacy.textContent = `Momentum 20D ${pct(momentum.expectedReturnPct)} · Up ${finite(momentum.probabilityPositivePct) == null ? "—" : `${Math.round(Number(momentum.probabilityPositivePct))}%`} · Down >5% ${finite(momentum.probabilityLoss5Pct) == null ? "—" : `${Math.round(Number(momentum.probabilityLoss5Pct))}%`}`;
          legacy.style.color = "#8fa4c8";
        }
        const legacyDetails = metric.querySelector<HTMLDetailsElement>("[data-forecast-detail-v37]");
        const legacySummary = legacyDetails?.querySelector("summary");
        if (legacySummary) legacySummary.textContent = "Momentum Forecast V37 · secondary model";
      }

      let power = article.querySelector<HTMLElement>("[data-sentinel-power-panel-v40]");
      if (power) power.replaceWith(createPowerPanel(item, lang));
      else {
        power = createPowerPanel(item, lang);
        const details = article.querySelector("details");
        if (details) details.insertAdjacentElement("beforebegin", power);
        else article.appendChild(power);
      }

      for (const span of Array.from(article.querySelectorAll<HTMLElement>("span"))) {
        const text = (span.textContent ?? "").trim();
        if (/^V34\s/.test(text)) span.textContent = text.replace(/^V34/, "V40");
      }
    }
  }, [lang]);

  const decorateHoldingsMonitor = useCallback(() => {
    const section = findSectionByHeading(document, ["Portfolio & Watchlist Market Monitor"]);
    if (!section) return;
    for (const row of Array.from(section.querySelectorAll<HTMLTableRowElement>("tbody tr"))) {
      const ticker = findTicker(row);
      const item = ticker ? marketRef.current.get(ticker) : null;
      const overlay = item?.technicalOverlay;
      if (!ticker || !item || !overlay) continue;
      const sentinel = overlay.sentinel;
      const mcdx = overlay.mcdx;
      const forecast = sentinel?.forecast;

      for (const small of Array.from(row.querySelectorAll<HTMLElement>("small"))) {
        const text = (small.textContent ?? "").trim();
        if (text.includes("Policy V34")) small.textContent = `Confidence ${Math.round(finite(overlay.confidence) ?? 0)}% · Policy V40 · Sentinel X 6.4 + MCDX 4.0`;
        else if (text.startsWith("RSI ")) small.textContent = `RSI ${finite(sentinel?.rsi)?.toFixed(1) ?? "—"} / SMA ${finite(sentinel?.rsiSma)?.toFixed(1) ?? "—"} · ${sentinel?.structurePattern ?? "—"} · ${sentinel?.trigger ?? "—"}`;
        else if (text.startsWith("Smart ")) {
          const absorb = mcdx?.liquidity?.bullAbsorption ? "SSL ABSORB" : mcdx?.liquidity?.bearAbsorption ? "BSL ABSORB" : "NO ABSORB";
          small.textContent = `State ${compactState(mcdx?.flowState)} · HTF ${mcdx?.htf?.direction ?? "—"} · ${absorb} · Smart ${finite(mcdx?.smartMoneyProxy)?.toFixed(1) ?? "—"}`;
        }
      }
      for (const span of Array.from(row.querySelectorAll<HTMLElement>("span"))) {
        const text = (span.textContent ?? "").trim();
        if (text.startsWith("Sentinel D ")) span.textContent = `Sentinel X 6.4 · Power D ${signed(sentinel?.degreesOfPower)} · W ${signed(sentinel?.weekly?.degreesOfPower)} · Quality ${Math.round(finite(sentinel?.qualityScore) ?? 0)}`;
        else if (text.startsWith("MCDX Flow ")) span.textContent = `MCDX 4.0 · Flow ${signed(mcdx?.flowPower, 1)} · Δ ${signed(mcdx?.flowDelta, 1)} · Accel ${signed(mcdx?.flowAccel, 1)}`;
      }

      const decisionCell = Array.from(row.querySelectorAll<HTMLElement>("td")).find(td => td.textContent?.includes("TREND ·") && td.textContent?.includes("FLOW ·"));
      if (decisionCell) {
        let panel = decisionCell.querySelector<HTMLElement>("[data-sentinel-power-panel-v40]");
        const replacement = createPowerPanel(item, lang);
        if (panel) panel.replaceWith(replacement);
        else {
          const reason = decisionCell.querySelector<HTMLElement>(".overlay-reason");
          if (reason) reason.insertAdjacentElement("beforebegin", replacement);
          else decisionCell.appendChild(replacement);
        }
        const tagWrap = Array.from(decisionCell.querySelectorAll<HTMLElement>("div")).find(div => div.textContent?.includes("TREND ·") && div.textContent?.includes("FLOW ·") && div.textContent?.includes("LOCATION ·"));
        if (tagWrap) {
          let fc = tagWrap.querySelector<HTMLElement>("[data-fc-tag-v40]");
          if (!fc) {
            fc = document.createElement("span");
            fc.dataset.fcTagV40 = "true";
            fc.className = "tag";
            tagWrap.appendChild(fc);
          }
          fc.textContent = `FC · ${forecast?.direction ?? "NEUTRAL"} ${Math.round(finite(forecast?.confidence) ?? 0)}%`;
          fc.style.color = forecastTone(String(forecast?.direction ?? "NEUTRAL"), sentinel?.companion?.forecastStatus === "VETO");
        }
      }
    }
  }, [lang]);

  const decorate = useCallback(() => {
    replaceLegacyV34();
    decorateActionQueue();
    decorateHoldingsMonitor();
  }, [decorateActionQueue, decorateHoldingsMonitor, replaceLegacyV34]);

  const refreshMarket = useCallback(async () => {
    const tickers = collectTickers().sort();
    const key = tickers.join(",");
    if (!key) { decorate(); return; }
    if (key === marketKeyRef.current && marketRef.current.size) { decorate(); return; }
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const next = new Map<string, MarketItem>();
      for (let i = 0; i < tickers.length; i += 25) {
        const chunk = tickers.slice(i, i + 25);
        const response = await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&technicalUxV40=${Date.now()}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) continue;
        for (const [ticker, item] of Object.entries(payload?.items ?? {})) next.set(clean(ticker), item as MarketItem);
      }
      if (next.size) {
        marketRef.current = next;
        marketKeyRef.current = key;
      }
      decorate();
    } finally {
      loadingRef.current = false;
    }
  }, [collectTickers, decorate]);

  const schedule = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { void refreshMarket(); }, 140);
  }, [refreshMarket]);

  useEffect(() => {
    document.documentElement.dataset.fundTechnicalUx = "sentinel-x-6.4-mcdx-4.0-v40";
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    schedule();
    const refresh = () => { marketKeyRef.current = ""; schedule(); };
    window.addEventListener("sentinel:portfolio-updated", refresh);
    window.addEventListener("sentinel:cash-ledger-changed", refresh);
    return () => {
      observer.disconnect();
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      window.removeEventListener("sentinel:portfolio-updated", refresh);
      window.removeEventListener("sentinel:cash-ledger-changed", refresh);
      delete document.documentElement.dataset.fundTechnicalUx;
    };
  }, [schedule]);

  return null;
}
