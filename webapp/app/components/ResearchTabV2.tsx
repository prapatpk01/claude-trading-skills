"use client";

import { useState } from "react";
import type { AppLang } from "../page";
import TickerInput from "./TickerInput";
import { money, pct, num } from "./format";

const t = (lang: AppLang, en: string, th: string) => lang === "th" ? th : en;
const bn = (v:any) => typeof v === "number" && Number.isFinite(v) ? `${v >= 1e9 ? (v/1e9).toFixed(1)+"B" : v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v.toLocaleString()}` : "—";

export default function ResearchTabV2({ lang }: { lang: AppLang }) {
  const [ticker,setTicker] = useState("");
  const [data,setData] = useState<any>(null);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState<string|null>(null);

  async function run(e?:React.FormEvent, override?:string){
    e?.preventDefault(); const x=(override??ticker).trim().toUpperCase(); if(!x)return;
    setLoading(true); setError(null); setData(null);
    try{const r=await fetch(`/api/analyze?ticker=${encodeURIComponent(x)}`); const j=await r.json(); if(!r.ok)throw new Error(j.error||"Analysis failed"); setData(j);}catch(e:any){setError(e.message)}finally{setLoading(false)}
  }

  return <div>
    <div className="card">
      <h2 className="section">🔎 {t(lang,"Institutional Equity Research","วิเคราะห์หุ้นระดับกองทุน")}</h2>
      <p className="muted" style={{fontSize:13}}>{t(lang,"Five-year fundamentals, latest four quarters, quality, thesis, catalysts, risks, valuation and DCF in one underwriting workflow.","วิเคราะห์งบ 5 ปี, 4 ไตรมาสล่าสุด, คุณภาพธุรกิจ, Thesis, Catalyst, Risk, Valuation และ DCF ใน workflow เดียว")}</p>
      <form className="searchbar" onSubmit={run}>
        <TickerInput value={ticker} onChange={setTicker} placeholder="NVDA" onSubmitTicker={(x)=>run(undefined,x)} />
        <button className="btn" disabled={loading}>{loading?t(lang,"Analyzing…","กำลังวิเคราะห์…"):t(lang,"Run Deep Dive","วิเคราะห์เชิงลึก")}</button>
      </form>
      {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}
    </div>
    {loading&&<div className="card"><span className="spinner"/> {t(lang,"Pulling filings, market data and valuation inputs…","กำลังดึงงบการเงิน ข้อมูลตลาด และข้อมูลสำหรับประเมินมูลค่า…")}</div>}
    {data&&<DeepDive data={data} lang={lang}/>} 
  </div>
}

function DeepDive({data,lang}:{data:any;lang:AppLang}){
  const ov=data.data?.overview; const fin=data.data?.financials; const qs=(data.data?.quarters??[]).slice(0,4); const dcf=data.dcf;
  const years=(fin?.income??[]).slice(0,5);
  return <>
    <div className="card">
      <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
        <div><h2 className="section" style={{marginBottom:4}}>{data.ticker} · {ov?.name??""}</h2><div className="muted">{ov?.sector??"—"} · {ov?.industry??"—"}</div></div>
        <div style={{textAlign:"right"}}><div style={{fontSize:30,fontWeight:900}}>{money(data.data?.quote?.price)}</div><span className={`pill ${data.signal?.toLowerCase()}`}>{data.signal}</span></div>
      </div>
      <div className="grid cols-4" style={{marginTop:14}}>
        <Metric label={t(lang,"Blended Target","ราคาเป้าหมายผสม")} value={money(data.targetPrice)} sub={`${data.upsidePct>=0?"+":""}${pct(data.upsidePct)}`} />
        <Metric label="DCF" value={dcf?money(dcf.fairValue):"—"} sub={dcf?`WACC ${(dcf.wacc*100).toFixed(1)}%`:""}/>
        <Metric label={t(lang,"Momentum","โมเมนตัม")} value={`${data.momentum?.total??"—"}/100`} />
        <Metric label={t(lang,"Quality Snapshot","คุณภาพเบื้องต้น")} value={qualityLabel(ov,years)} />
      </div>
    </div>

    <div className="card">
      <h3 className="sub">📚 {t(lang,"5-Year Financial History","งบการเงินย้อนหลัง 5 ปี")}</h3>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>{t(lang,"Fiscal Year","ปี")}</th><th className="num">Revenue</th><th className="num">Gross Profit</th><th className="num">Operating Income</th><th className="num">Net Income</th><th className="num">Op. Cash Flow</th><th className="num">Capex</th></tr></thead><tbody>
        {years.map((r:any,i:number)=>{const cf=fin?.cashflow?.[i]??{}; return <tr key={r.fiscalDate}><td><strong>{r.fiscalDate}</strong></td><td className="num">{bn(r.totalRevenue)}</td><td className="num">{bn(r.grossProfit)}</td><td className="num">{bn(r.operatingIncome)}</td><td className="num">{bn(r.netIncome)}</td><td className="num">{bn(cf.operatingCashflow)}</td><td className="num">{bn(cf.capitalExpenditures)}</td></tr>})}
      </tbody></table></div>
    </div>

    <div className="card">
      <h3 className="sub">🧾 {t(lang,"Latest 4 Quarters","4 ไตรมาสล่าสุด")}</h3>
      <div className="table-wrap"><table className="tbl"><thead><tr><th>{t(lang,"Quarter","ไตรมาส")}</th><th className="num">Revenue</th><th className="num">Net Income</th><th className="num">Net Margin</th><th className="num">EPS</th><th className="num">Revenue YoY</th></tr></thead><tbody>
        {qs.map((q:any)=><tr key={q.end}><td><strong>{q.end}</strong></td><td className="num">{bn(q.revenue)}</td><td className="num">{bn(q.netIncome)}</td><td className="num">{q.netMargin==null?"—":`${(q.netMargin*100).toFixed(1)}%`}</td><td className="num">{q.eps==null?"—":money(q.eps)}</td><td className="num">{q.revenueYoY==null?"—":`${q.revenueYoY>=0?"+":""}${(q.revenueYoY*100).toFixed(1)}%`}</td></tr>)}
      </tbody></table></div>
    </div>

    <div className="grid cols-2">
      <div className="card"><h3 className="sub">🧠 {t(lang,"Investment Thesis","Thesis การลงทุน")}</h3>{data.thesis?.map((s:any)=><div className="notice" style={{marginBottom:8}} key={s.label}><strong>{s.label} · {s.probability}% · {money(s.targetPrice)}</strong><br/>{s.narrative}</div>)}</div>
      <div className="card"><h3 className="sub">🚀 {t(lang,"Catalyst Map","แผน Catalyst")}</h3>{data.catalysts?.map((c:any,i:number)=><div className="notice" style={{marginBottom:8}} key={i}><strong>{c.horizon} · {c.event}</strong><br/>{c.impact}</div>)}</div>
    </div>

    <div className="grid cols-2">
      <div className="card"><h3 className="sub">⚠ {t(lang,"Risk Underwriting","วิเคราะห์ความเสี่ยง")}</h3>{data.risks?.map((r:string,i:number)=><div className="notice" style={{marginBottom:7}} key={i}>{r}</div>)}</div>
      <div className="card"><h3 className="sub">🏦 {t(lang,"Quality & Balance Sheet","คุณภาพธุรกิจและงบดุล")}</h3><KV k="ROE" v={ov?.roe==null?"—":`${(ov.roe*100).toFixed(1)}%`}/><KV k={t(lang,"Profit Margin","อัตรากำไรสุทธิ")} v={ov?.profitMargin==null?"—":`${(ov.profitMargin*100).toFixed(1)}%`}/><KV k="P/E" v={num(ov?.peRatio,1)}/><KV k="Forward P/E" v={num(ov?.forwardPE,1)}/><KV k="Beta" v={num(ov?.beta,2)}/><KV k={t(lang,"52W Range","กรอบราคา 52 สัปดาห์")} v={`${money(ov?.week52Low)} – ${money(ov?.week52High)}`}/></div>
    </div>

    <div className="card"><h3 className="sub">💎 {t(lang,"Valuation & DCF","การประเมินมูลค่าและ DCF")}</h3><div className="grid cols-4"><Metric label="DCF Fair Value" value={dcf?money(dcf.fairValue):"—"}/><Metric label="WACC" value={dcf?`${(dcf.wacc*100).toFixed(1)}%`:"—"}/><Metric label={t(lang,"Terminal Growth","Terminal Growth")} value={dcf?`${(dcf.terminalGrowth*100).toFixed(1)}%`:"—"}/><Metric label={t(lang,"Expected Return","ผลตอบแทนคาดหวัง")} value={data.expectedReturnPct==null?"—":`${data.expectedReturnPct>=0?"+":""}${pct(data.expectedReturnPct)}`}/></div><p className="notice" style={{marginTop:12}}>{data.valuationNote}</p></div>
  </>
}

function qualityLabel(ov:any,years:any[]){let s=0;if((ov?.roe??0)>.15)s++;if((ov?.profitMargin??0)>.1)s++;if(years.length>=4&&years[0]?.totalRevenue>years[years.length-1]?.totalRevenue)s++;if((ov?.beta??2)<1.3)s++;return s>=4?"High":s>=2?"Good":"Mixed"}
function Metric({label,value,sub}:{label:string;value:any;sub?:string}){return <div className="metric"><div className="label">{label}</div><div className="value" style={{fontSize:18}}>{value}</div>{sub&&<div className="sub">{sub}</div>}</div>}
function KV({k,v}:{k:string;v:any}){return <div className="kv"><span className="k">{k}</span><strong>{v}</strong></div>}
