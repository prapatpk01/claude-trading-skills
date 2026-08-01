"use client";

import { useMemo, useState } from "react";
import type { AppLang } from "../page";
import TickerInput from "./TickerInput";
import { money, num } from "./format";

const t = (l: AppLang, en: string, th: string) => (l === "th" ? th : en);
const n = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const bn = (v: unknown) => n(v) == null ? "—" : Math.abs(n(v)!) >= 1e9 ? `${(n(v)! / 1e9).toFixed(1)}B` : Math.abs(n(v)!) >= 1e6 ? `${(n(v)! / 1e6).toFixed(1)}M` : n(v)!.toLocaleString();
const pc = (v: unknown) => n(v) == null ? "—" : `${n(v)! >= 0 ? "+" : ""}${n(v)!.toFixed(1)}%`;
const rp = (v: unknown) => n(v) == null ? "—" : `${(Math.abs(n(v)!) < 1 ? n(v)! * 100 : n(v)!).toFixed(1)}%`;

export default function ResearchTabV2({ lang }: { lang: AppLang }) {
  const [ticker, setTicker] = useState("");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent, override?: string) {
    e?.preventDefault();
    const symbol = (override ?? ticker).trim().toUpperCase();
    if (!symbol) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const response = await fetch(`/api/analyze?ticker=${encodeURIComponent(symbol)}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "Analysis failed");
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return <div>
    <div className="card research-search-card">
      <h2 className="section">🔎 {t(lang, "Sentinel Institutional Equity Research", "Sentinel วิเคราะห์หุ้นระดับสถาบัน")}</h2>
      <p className="muted">{t(lang,
        "Evidence-gated underwriting. Missing statements, valuation inputs or peer evidence remain unavailable and can block committee approval.",
        "ระบบวิเคราะห์แบบมี Evidence Gate หากงบ ตัวแปร Valuation หรือข้อมูลคู่แข่งไม่ครบ ระบบจะแสดงว่าไม่พร้อมและสามารถบล็อกมติคณะกรรมการได้")}</p>
      <form className="searchbar" onSubmit={run}>
        <TickerInput value={ticker} onChange={setTicker} placeholder="AVGO" onSubmitTicker={(x) => run(undefined, x)} />
        <button className="btn" disabled={loading}>{loading ? t(lang, "Underwriting…", "กำลังวิเคราะห์…") : t(lang, "Analyze Ticker", "วิเคราะห์หุ้น")}</button>
      </form>
      {error && <div className="err">⚠ {error}</div>}
    </div>
    {loading && <div className="card"><span className="spinner" /> {t(lang, "Building institutional research pack…", "กำลังสร้างรายงานวิจัยระดับสถาบัน…")}</div>}
    {data && <Report data={data} lang={lang} />}
  </div>;
}

function Report({ data, lang }: { data: any; lang: AppLang }) {
  const d = data.data ?? {};
  const ov = d.overview ?? {};
  const fin = d.financials ?? {};
  const years = (fin.income ?? []).slice(0, 5);
  const cashflows = fin.cashflow ?? [];
  const balances = fin.balance ?? [];
  const quarters = (d.quarters ?? []).slice(0, 4);
  const research = data.research ?? {};
  const model = data.institutionalModel ?? {};
  const committee = data.committee ?? {};
  const latest = years[0] ?? {};
  const latestCf = cashflows[0] ?? {};
  const latestBalance = balances[0] ?? {};

  const revenue = n(latest.totalRevenue);
  const ocf = n(latestCf.operatingCashflow);
  const capex = n(latestCf.capitalExpenditures);
  const fcf = ocf != null && capex != null ? ocf - Math.abs(capex) : null;
  const longDebt = n(latestBalance.longTermDebt);
  const shortDebt = n(latestBalance.shortTermDebt);
  const debt = longDebt == null && shortDebt == null ? null : (longDebt ?? 0) + (shortDebt ?? 0);
  const cash = n(latestBalance.cashAndEquivalents);
  const netDebt = debt == null || cash == null ? null : debt - cash;

  const coverage = useMemo(() => {
    const checks = {
      quote: n(d.quote?.price) != null,
      annualIncome: years.length >= 2 && revenue != null,
      cashflow: cashflows.length > 0 && ocf != null,
      balance: balances.length > 0 && (cash != null || debt != null),
      quarters: quarters.length > 0,
      peers: (research.peers ?? []).filter((x: any) => !x.isSubject).length >= 2,
      valuation: Boolean(data.dcf || data.multiples),
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return { checks, passed, total: Object.keys(checks).length, pct: Math.round(passed / Object.keys(checks).length * 100) };
  }, [d.quote?.price, years.length, revenue, cashflows.length, ocf, balances.length, cash, debt, quarters.length, research.peers, data.dcf, data.multiples]);

  const criticalMissing = !coverage.checks.quote || !coverage.checks.annualIncome || !coverage.checks.cashflow || !coverage.checks.balance;
  const valuationReady = coverage.checks.valuation && !criticalMissing;
  const committeeBlocked = criticalMissing || (committee.hardBlocks?.length ?? 0) > 0;

  return <>
    <div className="card research-hero">
      <div className="research-hero-row">
        <div>
          <h2 className="section">{data.ticker} · {ov.name ?? ""}</h2>
          <div className="muted">{ov.sector ?? "—"} · {ov.industry ?? "—"} · {ov.country ?? "—"}</div>
        </div>
        <div className="research-price"><div>{money(d.quote?.price)}</div><span className={`pill ${committeeBlocked ? "hold" : data.signal?.toLowerCase()}`}>{committeeBlocked ? t(lang, "RESEARCH HOLD", "รอข้อมูล") : data.signal}</span></div>
      </div>
      <div className="data-coverage-banner">
        <div><strong>{t(lang, "Evidence coverage", "ความครบถ้วนของหลักฐาน")}</strong><span>{coverage.passed}/{coverage.total} · {coverage.pct}%</span></div>
        <div className="coverage-track"><span style={{ width: `${coverage.pct}%` }} /></div>
        <small>{criticalMissing ? t(lang, "Critical financial inputs are missing. No investment-ready conclusion should be used.", "ข้อมูลการเงินที่จำเป็นยังขาด ห้ามใช้ผลนี้เป็นมติพร้อมลงทุน") : t(lang, "Core evidence is present; review source freshness before approval.", "ข้อมูลหลักมีแล้ว แต่ต้องตรวจสอบความสดของแหล่งข้อมูลก่อนอนุมัติ")}</small>
      </div>
      <div className="grid cols-4 research-kpis">
        <Metric l={t(lang, "Target Price", "ราคาเป้าหมาย")} v={valuationReady ? money(data.targetPrice) : "—"} s={valuationReady ? pc(data.upsidePct) : t(lang, "Blocked: incomplete inputs", "บล็อก: ข้อมูลไม่ครบ")} />
        <Metric l={t(lang, "Expected Return", "ผลตอบแทนคาดหวัง")} v={valuationReady ? pc(data.expectedReturnPct) : "—"} />
        <Metric l={t(lang, "Committee", "มติคณะกรรมการ")} v={committeeBlocked ? t(lang, "BLOCKED", "บล็อก") : committee.decision ?? "—"} s={`${committee.conviction ?? "—"}/100`} />
        <Metric l={t(lang, "Momentum", "โมเมนตัม")} v={`${data.momentum?.total ?? "—"}/100`} />
      </div>
    </div>

    <Section title={t(lang, "1 · Executive Summary", "1 · บทสรุปผู้บริหาร")}>
      <div className="grid cols-4">
        <Metric l="DCF" v={valuationReady && data.dcf ? money(data.dcf.fairValue) : "—"} />
        <Metric l="ROIC" v={research.returns?.roicPct == null ? "—" : pc(research.returns.roicPct)} />
        <Metric l="FCF" v={bn(fcf)} />
        <Metric l={t(lang, "Net Debt", "หนี้สุทธิ")} v={bn(netDebt)} />
      </div>
      {criticalMissing ? <EmptyState title={t(lang, "Executive conclusion unavailable", "ยังสรุปการลงทุนไม่ได้")} text={t(lang, "Annual income, cash-flow and balance-sheet evidence must be available before a valuation-backed thesis is produced.", "ต้องมีงบกำไรขาดทุน กระแสเงินสด และงบดุลก่อนสร้าง Thesis ที่รองรับด้วย Valuation")} /> : <p className="notice">{data.thesis?.find((x: any) => x.label === "Base")?.narrative ?? "—"}</p>}
      {(committee.reasons?.length ?? 0) > 0 && <p><strong>{t(lang, "Committee support:", "เหตุผลสนับสนุน:")}</strong> {committee.reasons.join(" · ")}</p>}
      {(committee.dissent?.length ?? 0) > 0 && <p className="err"><strong>{t(lang, "Dissent:", "ความเห็นคัดค้าน:")}</strong> {committee.dissent.join(" · ")}</p>}
      {(committee.hardBlocks?.length ?? 0) > 0 && <div className="err"><strong>{t(lang, "Hard blocks:", "เงื่อนไขบล็อก:")}</strong> {committee.hardBlocks.join(" · ")}</div>}
    </Section>

    <Section title={t(lang, "2 · Industry & Competition", "2 · อุตสาหกรรมและการแข่งขัน")}>
      <p className="notice">{research.peerSet?.basis ?? t(lang, "Industry evidence is limited by available verified sources.", "ข้อมูลอุตสาหกรรมถูกจำกัดตามแหล่งข้อมูลที่ตรวจสอบได้")}</p>
      {coverage.checks.peers ? <>
        <div className="grid cols-3"><Metric l={t(lang, "Peer revenue pool", "รายได้รวมกลุ่มคู่แข่ง")} v={bn(research.sizing?.peerPoolRevenue)} /><Metric l={t(lang, "Subject share", "สัดส่วนบริษัทในกลุ่ม")} v={research.sizing?.subjectSharePct == null ? "—" : pc(research.sizing.subjectSharePct)} /><Metric l={t(lang, "Peer-pool CAGR", "CAGR กลุ่มคู่แข่ง")} v={research.sizing?.poolCagrPct == null ? "—" : pc(research.sizing.poolCagrPct)} /></div>
        <Table heads={["Ticker", "Revenue TTM", "Net Margin", "P/E", "Revenue CAGR"]} rows={(research.peers ?? []).map((x: any) => [`${x.isSubject ? "★ " : ""}${x.ticker}`, bn(x.revenueTTM), x.netMargin == null ? "—" : pc(x.netMargin), x.peTTM == null ? "—" : `${x.peTTM.toFixed(1)}x`, x.revenueCagrPct == null ? "—" : pc(x.revenueCagrPct)])} />
      </> : <EmptyState title={t(lang, "Peer analysis unavailable", "ยังวิเคราะห์คู่แข่งไม่ได้")} text={t(lang, "At least two verified comparable companies are required. The subject company alone is not treated as a peer group.", "ต้องมีบริษัทคู่แข่งที่ตรวจสอบแล้วอย่างน้อย 2 บริษัท หุ้นที่กำลังวิเคราะห์เพียงตัวเดียวไม่ถือเป็นกลุ่มคู่แข่ง")} />}
      <h4>{t(lang, "Moat / switching-cost evidence", "หลักฐาน Moat / Switching Cost")}</h4>
      {(research.moat?.sources?.length ?? 0) > 0 ? research.moat.sources.map((x: any, i: number) => <div className="notice" key={i}><strong>{x.source} · {x.strength}</strong><br />{x.evidence}</div>) : <EmptyState title={t(lang, "Moat not graded", "ยังไม่ให้คะแนน Moat")} text={t(lang, "No verified margin, reinvestment or switching-cost evidence was available.", "ยังไม่มีหลักฐาน Margin, Reinvestment หรือ Switching Cost ที่ตรวจสอบได้")} />}
    </Section>

    <Section title={t(lang, "3 · Financials & Earnings", "3 · งบการเงินและผลประกอบการ")}>
      {years.length > 0 ? <Table heads={[t(lang, "Fiscal Year", "ปี"), "Revenue", "Gross Profit", "Operating Income", "Net Income", "OCF", "Capex", "FCF"]} rows={years.map((x: any, i: number) => { const z = cashflows[i] ?? {}; const o = n(z.operatingCashflow); const cap = n(z.capitalExpenditures); return [x.fiscalDate, bn(x.totalRevenue), bn(x.grossProfit), bn(x.operatingIncome), bn(x.netIncome), bn(o), bn(cap), o == null || cap == null ? "—" : bn(o - Math.abs(cap))]; })} /> : <EmptyState title={t(lang, "Annual statements unavailable", "ไม่มีงบรายปี")} text={t(lang, "The analysis cannot grade profitability or cash generation without annual statements.", "ระบบไม่สามารถประเมินกำไรและกระแสเงินสดได้หากไม่มีงบรายปี")} />}
      <h4>{t(lang, "Latest 4 quarters", "4 ไตรมาสล่าสุด")}</h4>
      {quarters.length > 0 ? <Table heads={[t(lang, "Quarter", "ไตรมาส"), "Revenue", "Net Income", "Margin", "EPS", "Revenue YoY"]} rows={quarters.map((q: any) => [q.end, bn(q.revenue), bn(q.netIncome), rp(q.netMargin), q.eps == null ? "—" : money(q.eps), rp(q.revenueYoY)])} /> : <EmptyState title={t(lang, "Quarterly statements unavailable", "ไม่มีงบรายไตรมาส")} text={t(lang, "Quarterly trend, margin direction and earnings momentum are not gradable.", "ยังไม่สามารถวัดแนวโน้มรายไตรมาส ทิศทาง Margin และ Earnings Momentum ได้")} />}
      <div className="grid cols-4"><Metric l="ROE" v={rp(ov.roe)} /><Metric l="ROIC" v={research.returns?.roicPct == null ? "—" : pc(research.returns.roicPct)} /><Metric l={t(lang, "Debt", "หนี้")} v={bn(debt)} /><Metric l={t(lang, "Cash", "เงินสด")} v={bn(cash)} /></div>
      {data.quality?.summary && <p className="notice">{data.quality.summary}</p>}
    </Section>

    <Section title={t(lang, "4 · Thesis, Catalysts & Risks", "4 · Thesis, Catalyst และความเสี่ยง")}>
      {!criticalMissing && data.thesis?.length ? <div className="grid cols-3">{data.thesis.map((x: any) => <div className="notice" key={x.label}><strong>{x.label} · {x.probability}% · {money(x.targetPrice)}</strong><br />{x.narrative}</div>)}</div> : <EmptyState title={t(lang, "Scenario thesis withheld", "ระงับ Scenario Thesis")} text={t(lang, "The system will not publish investment scenarios when critical financial evidence is missing.", "ระบบจะไม่เผยแพร่ Scenario การลงทุนเมื่อข้อมูลการเงินสำคัญยังขาด")} />}
      <h4>{t(lang, "12-month catalyst timeline", "Catalyst 12 เดือน")}</h4>
      {((research.timeline?.length ? research.timeline : data.catalysts) ?? []).map((x: any, i: number) => <div className="notice" key={i}><strong>{x.date ?? x.window ?? x.horizon ?? "—"} · {x.event}</strong><br />{x.impact}</div>)}
      <h4>{t(lang, "Risk factors / thesis breaks", "ความเสี่ยง / เงื่อนไข Thesis พัง")}</h4>
      {(data.risks ?? []).map((x: string, i: number) => <div className="notice" key={i}>{x}</div>)}
    </Section>

    <Section title={t(lang, "5 · 3-Statement Model · 5-Year Forecast", "5 · โมเดล 3 งบ · คาดการณ์ 5 ปี")}>
      {coverage.checks.annualIncome && coverage.checks.cashflow ? <>
        <div className="grid cols-4"><Metric l={t(lang, "Starting revenue growth", "สมมติฐานการเติบโตเริ่มต้น")} v={pc(model.assumptions?.revenueGrowthPct)} /><Metric l={t(lang, "Terminal revenue growth", "การเติบโตระยะยาว")} v={pc(model.assumptions?.terminalRevenueGrowthPct)} /><Metric l={t(lang, "Operating margin", "Operating Margin")} v={pc(model.assumptions?.operatingMarginPct)} /><Metric l={t(lang, "FCF conversion", "FCF Conversion")} v={pc(model.assumptions?.fcfConversionPct)} /></div>
        <Table heads={["Year", "Revenue", "Growth", "Operating Income", "Op Margin", "Net Income", "OCF", "Capex", "FCF"]} rows={(model.forecast ?? []).map((x: any) => [x.year, bn(x.revenue), pc(x.revenueGrowthPct), bn(x.operatingIncome), pc(x.operatingMarginPct), bn(x.netIncome), bn(x.operatingCashFlow), bn(x.capex), bn(x.freeCashFlow)])} />
        <p className="muted">{t(lang, "Forecasts are model outputs, not reported facts. Assumptions should be stress-tested before capital allocation.", "ตัวเลขคาดการณ์เป็นผลจากโมเดล ไม่ใช่งบที่รายงานจริง ต้อง stress-test สมมติฐานก่อนจัดสรรเงินลงทุน")}</p>
      </> : <EmptyState title={t(lang, "Forecast model disabled", "ปิดโมเดลคาดการณ์")} text={t(lang, "A five-year model requires reported revenue, margins and cash-flow history.", "โมเดล 5 ปีต้องมีประวัติรายได้ Margin และกระแสเงินสดที่รายงานจริง")} />}
    </Section>

    <Section title={t(lang, "6 · Valuation & Scenarios", "6 · Valuation และ Scenario")}>
      <div className="grid cols-4"><Metric l="P/E" v={num(ov.peRatio, 1)} /><Metric l="Forward P/E" v={num(ov.forwardPE, 1)} /><Metric l="DCF" v={valuationReady && data.dcf ? money(data.dcf.fairValue) : "—"} /><Metric l="WACC" v={valuationReady && data.dcf ? pc(data.dcf.wacc * 100) : "—"} /></div>
      {valuationReady ? <>
        <p className="notice">{data.valuationNote}</p>
        {data.multiples && <Table heads={["Scenario", "Target", "P/E"]} rows={[["Bear", money(data.multiples.bear), `${data.multiples.peLow}x`], ["Base", money(data.multiples.base), `${data.multiples.peMid}x`], ["Bull", money(data.multiples.bull), `${data.multiples.peHigh}x`]]} />}
        {data.dcf && <><h4>{t(lang, "DCF sensitivity", "DCF Sensitivity")}</h4><Table heads={["WACC", "Terminal Growth", "Fair Value"]} rows={(model.sensitivity ?? []).filter((x: any) => x.fairValue != null).map((x: any) => [pc(x.waccPct), pc(x.terminalGrowthPct), money(x.fairValue)])} /></>}
      </> : <EmptyState title={t(lang, "Valuation unavailable", "ยังทำ Valuation ไม่ได้")} text={t(lang, "Generic ±20% price bands and empty DCF sensitivity tables are suppressed. Supply verified statements or valuation inputs first.", "ระบบซ่อนกรอบราคา ±20% และตาราง DCF ที่ไม่มีข้อมูล ต้องมีงบหรือข้อมูล Valuation ที่ตรวจสอบได้ก่อน")} />}
    </Section>

    {(d.warnings?.length > 0 || research.sources?.length > 0) && <Section title={t(lang, "Data Quality & Sources", "คุณภาพข้อมูลและแหล่งข้อมูล")}>{d.warnings?.map((x: string, i: number) => <div className="err" key={i}>⚠ {x}</div>)}{research.sources?.map((x: string, i: number) => <div className="muted" key={i} style={{ marginTop: 6 }}>• {x}</div>)}</Section>}
  </>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="card research-section"><h3 className="sub">{title}</h3>{children}</div>;
}
function Metric({ l, v, s }: { l: string; v: any; s?: string }) {
  return <div className="metric"><div className="label">{l}</div><div className="value research-metric-value">{v}</div>{s && <div className="muted research-metric-sub">{s}</div>}</div>;
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="research-empty"><strong>{title}</strong><p>{text}</p></div>;
}
function Table({ heads, rows }: { heads: string[]; rows: any[][] }) {
  if (!rows.length) return null;
  return <div className="table-wrap research-table-wrap"><table className="tbl research-table"><thead><tr>{heads.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j}>{v}</td>)}</tr>)}</tbody></table></div>;
}
