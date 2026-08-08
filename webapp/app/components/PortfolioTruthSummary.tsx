"use client";

import type { AppLang } from "../page";
import { money, pct, cls } from "./format";
import { useFundSnapshot } from "./useFundSnapshot";
import { useCallback, useEffect, useState } from "react";

export default function PortfolioTruthSummary({ lang, refreshKey = 0 }: { lang: AppLang; refreshKey?: number }) {
  const fund = useFundSnapshot(refreshKey);
  const t = (en: string, th: string) => lang === "th" ? th : en;
  const [buffer,setBuffer]=useState<any>(null);
  const [cashInput,setCashInput]=useState("");
  const [cashBusy,setCashBusy]=useState(false);
  const [cashMessage,setCashMessage]=useState<string|null>(null);
  const loadBuffer=useCallback(async()=>{
    try{const r=await fetch("/api/portfolio/cash-buffer",{cache:"no-store"});const j=await r.json();if(!r.ok)throw new Error(j.error||"Cash buffer unavailable");setBuffer(j);setCashInput(Number.isFinite(Number(j.cashBalance))?String(Number(j.cashBalance).toFixed(2)):"");}
    catch{setBuffer(null)}
  },[]);
  useEffect(()=>{loadBuffer()},[loadBuffer,refreshKey]);
  const saveBrokerCash=async()=>{
    const value=Number(cashInput);if(!Number.isFinite(value)||value<0){setCashMessage(t("Enter a valid USD cash balance.","กรุณากรอกยอดเงินสด USD ที่ถูกต้อง"));return;}
    setCashBusy(true);setCashMessage(null);
    try{const r=await fetch("/api/portfolio/cash",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"SET_BALANCE",balance:value,entry_date:new Date().toISOString().slice(0,10),notes:"Broker USD cash reconciliation from Portfolio Overview"})});const j=await r.json();if(!r.ok)throw new Error(j.error||"Save failed");await loadBuffer();setCashMessage(t("USD cash updated. Holdings value is unchanged.","อัปเดต USD Cash แล้ว โดยมูลค่า Holdings ไม่เปลี่ยน"));}
    catch(e:any){setCashMessage(e?.message||"Save failed")}finally{setCashBusy(false)}
  };

  return (
    <section className="portfolio-truth-summary" aria-label={t("Verified portfolio summary", "สรุปพอร์ตที่ตรวจสอบแล้ว")}>
      <div className="grid cols-3">
        <div className="metric">
          <div className="label">{t("Verified Holdings Value", "มูลค่าหลักทรัพย์ที่ยืนยันแล้ว")}</div>
          <div className="value">{fund.loading ? "…" : fund.verified ? money(fund.securitiesValue) : "—"}</div>
          <div className="sub">{fund.openPositions} {t("open positions · USD cash excluded", "สถานะเปิด · ไม่รวม USD Cash")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Unrealized P/L", "กำไร/ขาดทุนที่ยังไม่รับรู้")}</div>
          <div className={cls("value", fund.unrealizedPnl >= 0 ? "pos" : "neg")}>{fund.loading ? "…" : fund.verified ? money(fund.unrealizedPnl) : "—"}</div>
          <div className="sub">{fund.verified ? t("Same verified snapshot used by Dashboard and CIO", "ใช้ Snapshot เดียวกับ Dashboard และ CIO") : t("Withheld until prices are complete", "ระงับจนกว่าราคาจะครบ")}</div>
        </div>
        <div className="metric">
          <div className="label">{t("Verified Return", "ผลตอบแทนที่ยืนยันแล้ว")}</div>
          <div className={cls("value", fund.unrealizedPnlPct >= 0 ? "pos" : "neg")}>
            {fund.loading ? "…" : fund.verified ? `${fund.unrealizedPnlPct >= 0 ? "+" : ""}${pct(fund.unrealizedPnlPct)}` : "—"}
          </div>
          <div className="sub">{t("Cost basis remains internal for P/L calculation", "เก็บต้นทุนไว้ภายในเพื่อคำนวณกำไร/ขาดทุน")}</div>
        </div>
      </div>

      <div className="card" style={{marginTop:14,padding:18,borderColor:"rgba(49,217,243,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div><div className="label">{t("CASH BUFFER CONTROL","ควบคุม CASH BUFFER")}</div><h3 className="sub" style={{margin:"6px 0 3px"}}>{t("Broker USD Cash","เงินสด USD ในโบรกเกอร์")}</h3><div className="muted" style={{fontSize:12}}>{t("Cash is excluded from Holdings/Fund NAV and counted only in Cash Buffer.","USD Cash ไม่รวมใน Holdings/Fund NAV และนับเฉพาะใน Cash Buffer")}</div></div>
          <div style={{textAlign:"right"}}><div className="label">{t("Total Cash Buffer","Cash Buffer รวม")}</div><div className="value" style={{fontSize:24}}>{buffer?money(Number(buffer.totalReserveAssets??buffer.grossBuffer??0)):"—"}</div><div className="sub">{buffer?t("USD cash + approved reserve holdings","USD Cash + สินทรัพย์สำรองที่อนุมัติ"):t("Loading buffer…","กำลังโหลด Buffer…")}</div></div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
          <div style={{position:"relative",minWidth:180,flex:"0 1 240px"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontWeight:800}}>$</span><input inputMode="decimal" aria-label="Broker USD cash" value={cashInput} onChange={e=>setCashInput(e.target.value)} style={{width:"100%",paddingLeft:28}} placeholder="0.00"/></div>
          <button className="btn" type="button" disabled={cashBusy} onClick={saveBrokerCash}>{cashBusy?"…":t("Update USD Cash","บันทึก USD Cash")}</button>
          <span className="muted" style={{fontSize:12}}>{t("Current ledger cash:","USD Cash ปัจจุบัน:")} <strong>{buffer?money(Number(buffer.cashBalance??0)):"—"}</strong></span>
        </div>
        {cashMessage&&<div className="notice" style={{marginTop:10}}>{cashMessage}</div>}
        {buffer?.reserveHoldings?.length>0&&<div className="muted" style={{marginTop:10,fontSize:12}}>{t("Reserve holdings:","สินทรัพย์สำรอง:")} {buffer.reserveHoldings.map((r:any)=>`${r.ticker} ${money(Number(r.marketValue||0))}`).join(" · ")}</div>}
      </div>

      {!fund.loading && (fund.error || !fund.verified) && (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>{t("Portfolio valuation withheld", "ระงับการประเมินมูลค่าพอร์ต")}</strong>
          <div style={{ marginTop: 5 }}>{fund.error || t("Some required market prices are not verified.", "ราคาตลาดที่จำเป็นบางรายการยังไม่ได้รับการยืนยัน")}</div>
        </div>
      )}
    </section>
  );
}
