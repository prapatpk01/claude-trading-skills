"use client";

import { useState } from "react";
import type { AppLang } from "../page";
import { money, pct } from "./format";

const SECTORS = ["All","Technology","Communication","Consumer","Financials","Healthcare","Industrials","Energy","Utilities","RealEstate","Materials"];
const t = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;

export default function AlphaScannerV2({ lang }: { lang: AppLang }) {
  const [mode, setMode] = useState<"momentum"|"dividend">("momentum");
  const [sector, setSector] = useState("All");
  const [tickers, setTickers] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function scan() {
    setLoading(true); setError(null); setResult(null);
    try {
      const qs = new URLSearchParams({ mode, sector, top: "5" });
      if (tickers.trim()) qs.set("tickers", tickers.trim());
      const r = await fetch(`/api/scan?${qs.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Scan failed");
      setResult(j);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }

  return <div>
    <div className="card">
      <h2 className="section">📡 {t(lang,"Alpha Discovery Scanner","ระบบสแกนหา Alpha")}</h2>
      <div className="grid cols-2">
        <button className={`btn ${mode === "momentum" ? "" : "ghost"}`} onClick={() => setMode("momentum")}>
          ⚡ {t(lang,"Momentum Pick","หุ้น Momentum")}
        </button>
        <button className={`btn ${mode === "dividend" ? "" : "ghost"}`} onClick={() => setMode("dividend")}>
          💰 {t(lang,"Dividend Quality","หุ้นปันผลคุณภาพ")}
        </button>
      </div>
      <p className="notice" style={{marginTop:12}}>
        {mode === "momentum"
          ? t(lang,"Find speculative names already accelerating: relative strength, volume expansion, structure, catalyst and entry geometry. Designed to catch stocks that are moving now, not merely cheap stocks.","ค้นหาหุ้นเก็งกำไรที่กำลังเร่งตัวจริง โดยดู Relative Strength, Volume, Structure, Catalyst และจังหวะเข้า เน้นหุ้นที่กำลังวิ่ง ไม่ใช่เพียงหุ้นราคาถูก")
          : t(lang,"Find durable income businesses using dividend yield, cash-flow coverage, ROE, profitability, 5-year growth, valuation, thesis, catalysts, risks and DCF confirmation.","ค้นหาหุ้นปันผลคุณภาพจาก Dividend Yield, ความสามารถจ่ายปันผลจากกระแสเงินสด, ROE, กำไร, การเติบโต 5 ปี, Valuation, Thesis, Catalyst, Risk และ DCF")}
      </p>
      <div className="searchbar" style={{marginTop:12}}>
        <select value={sector} onChange={e => setSector(e.target.value)}>
          {SECTORS.map(s => <option key={s} value={s}>{s === "All" ? t(lang,"All sectors","ทุก Sector") : s}</option>)}
        </select>
        <input value={tickers} onChange={e => setTickers(e.target.value)} placeholder={t(lang,"Optional tickers: NVDA, AVGO, JPM…","ระบุหุ้นเองได้: NVDA, AVGO, JPM…")} style={{flex:1,minWidth:240}} />
        <button className="btn" onClick={scan} disabled={loading}>{loading ? t(lang,"Scanning…","กำลังสแกน…") : t(lang,"Run Scan","เริ่มสแกน")}</button>
      </div>
      {error && <div className="err" style={{marginTop:12}}>⚠ {error}</div>}
    </div>

    {result?.mode === "dividend" && <DividendResults result={result} lang={lang} />}
    {result?.mode === "momentum" && <MomentumResults result={result} lang={lang} />}
  </div>;
}

function DividendResults({result,lang}:{result:any;lang:AppLang}) {
  return <>
    <div className="card"><h3 className="sub">💰 {t(lang,"Dividend Quality Ranking","อันดับหุ้นปันผลคุณภาพ")}</h3><p className="muted" style={{fontSize:12}}>{result.methodology}</p></div>
    {result.picks?.map((p:any,i:number)=><div className="card setup-card" key={p.ticker}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
        <div><h2 className="section" style={{margin:0}}>{i+1}. {p.ticker} · {p.name}</h2><div className="muted" style={{fontSize:12}}>{p.sector}</div></div>
        <div className="badge-score">{p.score}<span style={{fontSize:14}}>/100</span></div>
      </div>
      <div className="grid cols-4" style={{marginTop:14}}>
        <Metric label={t(lang,"Yield","Dividend Yield")} value={p.yieldPct == null ? "—" : `${p.yieldPct.toFixed(2)}%`} />
        <Metric label={t(lang,"5Y Revenue CAGR","รายได้โต 5 ปี")} value={p.revenueGrowthPct == null ? "—" : `${p.revenueGrowthPct.toFixed(1)}%`} />
        <Metric label="ROE" value={p.roePct == null ? "—" : `${p.roePct.toFixed(1)}%`} />
        <Metric label={t(lang,"Payout Quality","คุณภาพการจ่ายปันผล")} value={p.payoutQuality} />
      </div>
      <h3 className="sub">🧠 {t(lang,"Investment Thesis","Thesis การลงทุน")}</h3><p style={{lineHeight:1.65}}>{p.thesis}</p>
      <div className="grid cols-2">
        <div><h3 className="sub">🚀 {t(lang,"Catalysts","Catalyst")}</h3>{p.catalysts?.map((c:any,ix:number)=><div className="notice" style={{marginBottom:7}} key={ix}><strong>{c.horizon} · {c.event}</strong><br/>{c.impact}</div>)}</div>
        <div><h3 className="sub">⚠ {t(lang,"Risks","ความเสี่ยง")}</h3>{p.risks?.map((r:string,ix:number)=><div className="notice" style={{marginBottom:7}} key={ix}>{r}</div>)}</div>
      </div>
      <div className="grid cols-3" style={{marginTop:12}}>
        <Metric label="DCF Fair Value" value={p.dcfFairValue == null ? "—" : money(p.dcfFairValue)} />
        <Metric label={t(lang,"Blended Target","ราคาเป้าหมายผสม")} value={p.targetPrice == null ? "—" : money(p.targetPrice)} />
        <Metric label={t(lang,"Upside","Upside")} value={p.upsidePct == null ? "—" : `${p.upsidePct >= 0 ? "+" : ""}${pct(p.upsidePct)}`} />
      </div>
    </div>)}
  </>;
}

function MomentumResults({result,lang}:{result:any;lang:AppLang}) {
  return <>
    {result.regime && <div className="card"><h3 className="sub">🌐 {t(lang,"Market Regime","สภาวะตลาด")}</h3><div className="grid cols-4"><Metric label="Regime" value={`${result.regime.score}/100`} /><Metric label="Stance" value={result.regime.stance} /><Metric label="SPY 1M" value={result.regime.spyReturn1m == null ? "—" : `${pct(result.regime.spyReturn1m)}`} /><Metric label="Vol" value={result.regime.realizedVol == null ? "—" : result.regime.realizedVol.toFixed(1)} /></div></div>}
    {result.noQualifiers && <div className="card"><div className="notice">{result.noQualifiers}</div></div>}
    {result.setups?.map((s:any,i:number)=><div className="card setup-card" key={s.ticker}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10}}><h2 className="section">{i+1}. {s.ticker} · {s.name}</h2><span className="pill buy">MOMENTUM</span></div>
      <div className="grid cols-4">
        <Metric label={t(lang,"Entry","จุดเข้า")} value={money(s.entry)} />
        <Metric label={t(lang,"Stop","Stop Loss")} value={money(s.stop)} />
        <Metric label={t(lang,"Target","เป้าหมาย")} value={money(s.target)} />
        <Metric label="R:R" value={s.riskReward == null ? "—" : `1:${s.riskReward.toFixed(1)}`} />
      </div>
      {result.catalysts?.[s.ticker] && <><h3 className="sub">🔥 {t(lang,"Why it can move","เหตุผลที่มีโอกาสวิ่ง")}</h3><p>{result.catalysts[s.ticker].thesis}</p></>}
    </div>)}
  </>;
}

function Metric({label,value}:{label:string;value:any}) { return <div className="metric"><div className="label">{label}</div><div className="value" style={{fontSize:18}}>{value}</div></div>; }
