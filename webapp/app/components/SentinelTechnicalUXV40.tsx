"use client";

import { useCallback, useEffect, useRef } from "react";
import type { AppLang } from "../page";

type MarketItem = { price?: number | null; technicalOverlay?: any; momentumForecast?: any };
type Props = { lang: AppLang };

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const RESERVED = new Set(["ADD","BEAR","BULL","CARRIED","CIO","COMPLETE","CURRENT","DEFERRED","EXIT","FLOW","HOLD","LOCATION","MARKET","NEUTRAL","PASS","PROFIT","READY","SELL","STRONG","TRIM","VETO","WATCH"]);
const clean = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown): number | null => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const signed = (value: unknown, digits = 0) => { const n = finite(value); return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`; };
const pct = (value: unknown, digits = 1) => { const n = finite(value); return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`; };
const setText = (node: HTMLElement | null | undefined, value: string) => { if (node && node.textContent !== value) node.textContent = value; };

function powerBar(value: unknown) {
  const p = Math.round(Math.max(-100, Math.min(100, finite(value) ?? 0)) / 25);
  return p <= -4 ? "◆───○────" : p === -3 ? "─◆──○────" : p === -2 ? "──◆─○────" : p === -1 ? "───◆○────" : p === 0 ? "────◆────" : p === 1 ? "────○◆───" : p === 2 ? "────○─◆──" : p === 3 ? "────○──◆─" : "────○───◆";
}
function forecastTone(direction: string, veto: boolean) { return veto || direction === "BEARISH" ? "#ff7088" : direction === "BULLISH" ? "#55d9ad" : "#ffd166"; }
function compact(value: unknown) { return String(value ?? "NEUTRAL").replaceAll("_", " "); }
function findTicker(node: Element): string | null {
  return Array.from(node.querySelectorAll("strong")).map(el => clean(el.textContent)).find(value => TICKER.test(value) && !RESERVED.has(value) && !/^V\d/.test(value)) ?? null;
}
function findSection(root: ParentNode, patterns: string[]) {
  const heading = Array.from(root.querySelectorAll("h2")).find(node => patterns.some(pattern => clean(node.textContent).includes(clean(pattern))));
  if (!heading) return null;
  let current: HTMLElement | null = heading.parentElement;
  for (let i = 0; current && i < 6; i += 1, current = current.parentElement) if (current.querySelector("article") || current.querySelector("table")) return current;
  return heading.parentElement;
}
function replaceExact(root: ParentNode, selector: string, from: string, to: string) {
  for (const node of Array.from(root.querySelectorAll<HTMLElement>(selector))) if ((node.textContent ?? "").trim() === from) node.textContent = to;
}

function createPowerPanel(item: MarketItem, lang: AppLang) {
  const overlay = item.technicalOverlay, sentinel = overlay?.sentinel, mcdx = overlay?.mcdx, forecast = sentinel?.forecast;
  const flow = finite(mcdx?.flowPower) ?? 0, power = finite(sentinel?.degreesOfPower) ?? 0;
  const absorption = mcdx?.liquidity?.bullAbsorption ? "SSL ABSORB" : mcdx?.liquidity?.bearAbsorption ? "BSL ABSORB" : "NO ABSORPTION";
  const htf = mcdx?.htf?.direction ?? "UNAVAILABLE";
  const signature = [lang,power,flow,sentinel?.qualityLabel,mcdx?.flowState,forecast?.direction,forecast?.confidence,mcdx?.flowDelta,mcdx?.flowAccel,htf,absorption].join("|");
  const panel = document.createElement("div");
  panel.dataset.sentinelPowerPanelV40 = "true";
  panel.dataset.signature = signature;
  Object.assign(panel.style,{margin:"10px 0",padding:"10px 12px",border:"1px solid rgba(99,214,255,.18)",borderRadius:"12px",background:"rgba(7,18,38,.62)",fontSize:"10px",lineHeight:"1.55",letterSpacing:".02em"});
  const row = (label:string, value:number, extra:string) => {
    const div=document.createElement("div"); Object.assign(div.style,{display:"grid",gridTemplateColumns:"minmax(92px,.8fr) minmax(145px,1.4fr) auto",gap:"7px",alignItems:"center"});
    const name=document.createElement("b"); name.textContent=label; name.style.color="#9db1d2";
    const meter=document.createElement("span"); meter.textContent=`Bear ${powerBar(value)} Bull`; Object.assign(meter.style,{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",whiteSpace:"nowrap",color:value>12?"#55d9ad":value< -12?"#ff7088":"#8fa4c8"});
    const tail=document.createElement("span"); tail.textContent=`${signed(value)}${extra?` · ${extra}`:""}`; Object.assign(tail.style,{whiteSpace:"nowrap",color:"#b7c8e8"});
    div.append(name,meter,tail); return div;
  };
  panel.append(row("SENTINEL POWER",power,sentinel?.qualityLabel??""),row("MCDX FLOW",flow,compact(mcdx?.flowState)));
  const footer=document.createElement("div"); Object.assign(footer.style,{marginTop:"5px",paddingTop:"5px",borderTop:"1px solid rgba(143,164,200,.10)",color:"#8fa4c8"});
  footer.textContent=`Forecast ${forecast?.direction??"NEUTRAL"} · Conf ${Math.round(finite(forecast?.confidence)??0)} · MCDX Δ ${signed(mcdx?.flowDelta,1)} · Accel ${signed(mcdx?.flowAccel,1)} · HTF ${htf} · ${absorption}`;
  panel.appendChild(footer); return panel;
}
function ensurePowerPanel(container: HTMLElement, item: MarketItem, lang: AppLang, before: Element | null) {
  const existing=container.querySelector<HTMLElement>("[data-sentinel-power-panel-v40]");
  const next=createPowerPanel(item,lang);
  if (existing?.dataset.signature===next.dataset.signature) return;
  if (existing) existing.replaceWith(next); else if (before) before.insertAdjacentElement("beforebegin",next); else container.appendChild(next);
}

export default function SentinelTechnicalUXV40({ lang }: Props) {
  const marketRef=useRef<Map<string,MarketItem>>(new Map());
  const marketKeyRef=useRef("");
  const timerRef=useRef<number|null>(null);
  const loadingRef=useRef(false);

  const replaceLegacy=useCallback(()=>{
    replaceExact(document,"th,span,small","V34 UNIFIED DECISION","V40 UNIFIED DECISION");
    replaceExact(document,"span","UNIFIED V34","UNIFIED V40");
    replaceExact(document,"span","V34 · TREND → FLOW → LOCATION → ACTION","V40 · SENTINEL DIRECTION → MCDX CONVICTION → LOCATION → ACTION");
    replaceExact(document,"p","Committee action and V34 review are shown as separate approval layers.","Committee action and Sentinel X 6.4 / MCDX 4.0 review are separate approval layers.");
    replaceExact(document,"p","แยกมติ Committee ออกจาก Technical V34 Review ให้ชัด","แยกมติ Committee ออกจาก Sentinel X 6.4 / MCDX 4.0 Review ให้ชัด");
    for(const node of Array.from(document.querySelectorAll<HTMLElement>("small,span,p"))){
      const text=(node.textContent??"").trim();
      if(text==="Policy V34") node.textContent="Policy V40 · Sentinel X 6.4 + MCDX 4.0";
      else if(/^V34\s+(ADD|HOLD|PROFIT WATCH|TRIM REVIEW|EXIT REVIEW|—)$/.test(text)) node.textContent=text.replace(/^V34/,"V40");
      else if(text.startsWith("V34 uses one policy everywhere:")) node.textContent="V40: Sentinel X 6.4 owns direction, setup and forecast; MCDX 4.0 owns institutional-flow conviction. Location alone never forces a trim.";
    }
  },[]);

  const collectTickers=useCallback(()=>{
    const result=new Set<string>();
    for(const section of [findSection(document,["Portfolio Action Queue","คิวจัดการพอร์ต"]),findSection(document,["Portfolio & Watchlist Market Monitor"])]){
      if(!section) continue;
      for(const node of Array.from(section.querySelectorAll("article,tbody tr"))){const ticker=findTicker(node);if(ticker)result.add(ticker);}
    }
    return [...result];
  },[]);

  const decorateActionQueue=useCallback(()=>{
    const section=findSection(document,["Portfolio Action Queue","คิวจัดการพอร์ต"]); if(!section)return;
    for(const article of Array.from(section.querySelectorAll<HTMLElement>("article"))){
      const ticker=findTicker(article),item=ticker?marketRef.current.get(ticker):null,overlay=item?.technicalOverlay; if(!ticker||!item||!overlay)continue;
      const sentinel=overlay.sentinel,mcdx=overlay.mcdx,forecast=sentinel?.forecast,companion=sentinel?.companion;
      const direction=String(forecast?.direction??"NEUTRAL"),veto=companion?.forecastStatus==="VETO";
      const metricLabel=Array.from(article.querySelectorAll<HTMLElement>("span")).find(node=>clean(node.textContent).startsWith("FORECAST"));
      const metric=metricLabel?.parentElement,main=metric?.querySelector<HTMLElement>("strong");
      if(metricLabel&&metric&&main){
        setText(metricLabel,"SENTINEL X FORECAST");
        const price=finite(item.price),target1=finite(forecast?.target1),targetPct=price!=null&&price>0&&target1!=null?(target1/price-1)*100:null;
        setText(main,forecast?.valid&&targetPct!=null?`T1 ${pct(targetPct)}`:direction); main.style.color=forecastTone(direction,veto);
        let note=metric.querySelector<HTMLElement>("[data-sentinel-forecast-v40]");
        if(!note){note=document.createElement("small");note.dataset.sentinelForecastV40="true";Object.assign(note.style,{display:"block",marginTop:"6px",fontSize:"10px",fontWeight:"750",lineHeight:"1.45"});metric.appendChild(note);}
        const setup=sentinel?.setup&&sentinel.setup!=="NONE"?`${sentinel.setup} ${sentinel.setupGrade??""}`.trim():"NO SETUP";
        setText(note,`${direction} · CONF ${Math.round(finite(forecast?.confidence)??0)}% · ${setup} · MCDX ${companion?.forecastStatus??"NEUTRAL"} ${signed(mcdx?.flowPower)}`); note.style.color=forecastTone(direction,veto);
        const legacy=metric.querySelector<HTMLElement>("[data-forecast-meta-v37]"),momentum=item.momentumForecast;
        if(legacy&&momentum){setText(legacy,`Momentum 20D ${pct(momentum.expectedReturnPct)} · Up ${finite(momentum.probabilityPositivePct)==null?"—":`${Math.round(Number(momentum.probabilityPositivePct))}%`} · Down >5% ${finite(momentum.probabilityLoss5Pct)==null?"—":`${Math.round(Number(momentum.probabilityLoss5Pct))}%`}`);legacy.style.color="#8fa4c8";}
        const summary=metric.querySelector<HTMLDetailsElement>("[data-forecast-detail-v37]")?.querySelector<HTMLElement>("summary"); setText(summary,"Momentum Forecast V37 · secondary model");
      }
      ensurePowerPanel(article,item,lang,article.querySelector("details"));
      for(const span of Array.from(article.querySelectorAll<HTMLElement>("span"))){const text=(span.textContent??"").trim();if(/^V34\s/.test(text))span.textContent=text.replace(/^V34/,"V40");}
    }
  },[lang]);

  const decorateMonitor=useCallback(()=>{
    const section=findSection(document,["Portfolio & Watchlist Market Monitor"]); if(!section)return;
    for(const row of Array.from(section.querySelectorAll<HTMLTableRowElement>("tbody tr"))){
      const ticker=findTicker(row),item=ticker?marketRef.current.get(ticker):null,overlay=item?.technicalOverlay;if(!ticker||!item||!overlay)continue;
      const sentinel=overlay.sentinel,mcdx=overlay.mcdx,forecast=sentinel?.forecast;
      for(const small of Array.from(row.querySelectorAll<HTMLElement>("small"))){
        const text=(small.textContent??"").trim();
        if(text.includes("Policy V34")) setText(small,`Confidence ${Math.round(finite(overlay.confidence)??0)}% · Policy V40 · Sentinel X 6.4 + MCDX 4.0`);
        else if(text.startsWith("RSI ")) setText(small,`RSI ${finite(sentinel?.rsi)?.toFixed(1)??"—"} / SMA ${finite(sentinel?.rsiSma)?.toFixed(1)??"—"} · ${sentinel?.structurePattern??"—"} · ${sentinel?.trigger??"—"}`);
        else if(text.startsWith("Smart ")){const absorb=mcdx?.liquidity?.bullAbsorption?"SSL ABSORB":mcdx?.liquidity?.bearAbsorption?"BSL ABSORB":"NO ABSORB";setText(small,`State ${compact(mcdx?.flowState)} · HTF ${mcdx?.htf?.direction??"—"} · ${absorb} · Smart ${finite(mcdx?.smartMoneyProxy)?.toFixed(1)??"—"}`);}
      }
      for(const span of Array.from(row.querySelectorAll<HTMLElement>("span"))){
        const text=(span.textContent??"").trim();
        if(text.startsWith("Sentinel D ")) setText(span,`Sentinel X 6.4 · Power D ${signed(sentinel?.degreesOfPower)} · W ${signed(sentinel?.weekly?.degreesOfPower)} · Quality ${Math.round(finite(sentinel?.qualityScore)??0)}`);
        else if(text.startsWith("MCDX Flow ")) setText(span,`MCDX 4.0 · Flow ${signed(mcdx?.flowPower,1)} · Δ ${signed(mcdx?.flowDelta,1)} · Accel ${signed(mcdx?.flowAccel,1)}`);
      }
      const decisionCell=Array.from(row.querySelectorAll<HTMLElement>("td")).find(td=>td.textContent?.includes("TREND ·")&&td.textContent?.includes("FLOW ·"));
      if(decisionCell){
        ensurePowerPanel(decisionCell,item,lang,decisionCell.querySelector(".overlay-reason"));
        const tagWrap=Array.from(decisionCell.querySelectorAll<HTMLElement>("div")).find(div=>div.textContent?.includes("TREND ·")&&div.textContent?.includes("FLOW ·")&&div.textContent?.includes("LOCATION ·"));
        if(tagWrap){let fc=tagWrap.querySelector<HTMLElement>("[data-fc-tag-v40]");if(!fc){fc=document.createElement("span");fc.dataset.fcTagV40="true";fc.className="tag";tagWrap.appendChild(fc);}setText(fc,`FC · ${forecast?.direction??"NEUTRAL"} ${Math.round(finite(forecast?.confidence)??0)}%`);fc.style.color=forecastTone(String(forecast?.direction??"NEUTRAL"),sentinel?.companion?.forecastStatus==="VETO");}
      }
    }
  },[lang]);

  const decorate=useCallback(()=>{replaceLegacy();decorateActionQueue();decorateMonitor();},[replaceLegacy,decorateActionQueue,decorateMonitor]);
  const refreshMarket=useCallback(async()=>{
    const tickers=collectTickers().sort(),key=tickers.join(","); if(!key){decorate();return;} if(key===marketKeyRef.current&&marketRef.current.size){decorate();return;} if(loadingRef.current)return;
    loadingRef.current=true;
    try{const next=new Map<string,MarketItem>();for(let i=0;i<tickers.length;i+=25){const chunk=tickers.slice(i,i+25);const response=await fetch(`/api/holding-market?tickers=${encodeURIComponent(chunk.join(","))}&technicalUxV40=${Date.now()}`,{cache:"no-store"});const payload=await response.json().catch(()=>({}));if(!response.ok)continue;for(const [ticker,item] of Object.entries(payload?.items??{}))next.set(clean(ticker),item as MarketItem);}if(next.size){marketRef.current=next;marketKeyRef.current=key;}decorate();}finally{loadingRef.current=false;}
  },[collectTickers,decorate]);
  const schedule=useCallback(()=>{if(timerRef.current!=null)window.clearTimeout(timerRef.current);timerRef.current=window.setTimeout(()=>{void refreshMarket();},140);},[refreshMarket]);

  useEffect(()=>{
    document.documentElement.dataset.fundTechnicalUx="sentinel-x-6.4-mcdx-4.0-v40";
    const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,characterData:true});schedule();
    const refresh=()=>{marketKeyRef.current="";schedule();};window.addEventListener("sentinel:portfolio-updated",refresh);window.addEventListener("sentinel:cash-ledger-changed",refresh);
    return()=>{observer.disconnect();if(timerRef.current!=null)window.clearTimeout(timerRef.current);window.removeEventListener("sentinel:portfolio-updated",refresh);window.removeEventListener("sentinel:cash-ledger-changed",refresh);delete document.documentElement.dataset.fundTechnicalUx;};
  },[schedule]);
  return null;
}
