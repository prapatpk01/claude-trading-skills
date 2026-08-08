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
  const [dividendInput,setDividendInput]=useState("");
  const [dividendBusy,setDividendBusy]=useState(false);
  const [dividendMessage,setDividendMessage]=useState<string|null>(null);

  const loadBuffer=useCallback(async()=>{
    try{
      const r=await fetch("/api/portfolio/cash-buffer",{cache:"no-store"});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Cash buffer unavailable");
      setBuffer(j);
      setCashInput(Number.isFinite(Number(j.investmentCash??j.cashBalance))?String(Number(j.investmentCash??j.cashBalance).toFixed(2)):"");
      setDividendInput(Number(j.dividendAvailable??0)>0?String(Number(j.dividendAvailable).toFixed(2)):"");
    } catch { setBuffer(null); }
  },[]);

  useEffect(()=>{loadBuffer()},[loadBuffer,refreshKey]);

  const saveBrokerCash=async()=>{
    const value=Number(cashInput);
    if(!Number.isFinite(value)||value<0){setCashMessage(t("Enter a valid USD investment cash balance.","กรุณากรอกยอดเงินลงทุน USD ที่ถูกต้อง"));return;}
    setCashBusy(true);setCashMessage(null);
    try{
      const r=await fetch("/api/portfolio/cash",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"SET_BALANCE",balance:value,entry_date:new Date().toISOString().slice(0,10),notes:"Broker USD investment cash reconciliation from Portfolio Overview"})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Save failed");
      await loadBuffer();
      setCashMessage(t("Investment USD cash updated. It is added to Cash Buffer but excluded from Holdings/Fund NAV.","อัปเดตเงินลงทุน USD แล้ว เงินนี้นับเข้า Cash Buffer แต่ไม่รวมใน Holdings/Fund NAV"));
    } catch(e:any){setCashMessage(e?.message||"Save failed")}finally{setCashBusy(false)}
  };

  const withdrawDividend=async()=>{
    const value=Number(dividendInput);
    const available=Number(buffer?.dividendAvailable??0);
    if(!Number.isFinite(value)||value<=0){setDividendMessage(t("Enter a dividend amount to withdraw.","กรุณากรอกจำนวนปันผลที่ต้องการถอน"));return;}
    if(value>available+0.000001){setDividendMessage(t(`Only ${money(available)} is available.`,`มีปันผลพร้อมถอนเพียง ${money(available)}`));return;}
    setDividendBusy(true);setDividendMessage(null);
    try{
      const r=await fetch("/api/portfolio/cash",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"WITHDRAW_DIVIDEND",amount:value,entry_date:new Date().toISOString().slice(0,10),notes:"Dividend withdrawn for personal use"})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Withdrawal failed");
      await loadBuffer();
      setDividendMessage(t("Dividend withdrawn. It is now realized investment profit and is no longer investable Cash Buffer.","ถอนปันผลแล้ว เงินนี้ถูกนับเป็นกำไรจากการลงทุนที่รับรู้แล้วและไม่นับเป็น Cash Buffer สำหรับลงทุนต่อ"));
    } catch(e:any){setDividendMessage(e?.message||"Withdrawal failed")}finally{setDividendBusy(false)}
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
          <div>
            <div className="label">{t("CASH BUFFER CONTROL","ควบคุม CASH BUFFER")}</div>
            <h3 className="sub" style={{margin:"6px 0 3px"}}>{t("Investment USD Cash","เงินลงทุน USD")}</h3>
            <div className="muted" style={{fontSize:12}}>{t("USD cash you add is investment capital. It enters Cash Buffer but stays outside Holdings/Fund NAV.","USD Cash ที่เพิ่มถือเป็นเงินลงทุน เข้าสู่ Cash Buffer แต่ไม่รวมใน Holdings/Fund NAV")}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="label">{t("Total Cash Buffer","Cash Buffer รวม")}</div>
            <div className="value" style={{fontSize:24}}>{buffer?money(Number(buffer.totalReserveAssets??buffer.grossBuffer??0)):"—"}</div>
            <div className="sub">{buffer?t("USD investment cash + available net dividends + approved reserve holdings","เงินลงทุน USD + ปันผลสุทธิที่ยังไม่ถอน + สินทรัพย์สำรอง"):t("Loading buffer…","กำลังโหลด Buffer…")}</div>
          </div>
        </div>

        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
          <div style={{position:"relative",minWidth:180,flex:"0 1 240px"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontWeight:800}}>$</span><input inputMode="decimal" aria-label="Investment USD cash" value={cashInput} onChange={e=>setCashInput(e.target.value)} style={{width:"100%",paddingLeft:28}} placeholder="0.00"/></div>
          <button className="btn" type="button" disabled={cashBusy} onClick={saveBrokerCash}>{cashBusy?"…":t("Update USD Cash","บันทึก USD Cash")}</button>
          <span className="muted" style={{fontSize:12}}>{t("Current investment cash:","เงินลงทุน USD ปัจจุบัน:")} <strong>{buffer?money(Number(buffer.investmentCash??buffer.cashBalance??0)):"—"}</strong></span>
        </div>
        {cashMessage&&<div className="notice" style={{marginTop:10}}>{cashMessage}</div>}

        <div className="card" style={{marginTop:16,padding:16,background:"rgba(255,255,255,.02)"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div>
              <div className="label">{t("DIVIDEND CASH","เงินปันผล")}</div>
              <div className="muted" style={{fontSize:12,marginTop:4}}>{t("US dividends are tracked net of 15% withholding tax and enter Cash Buffer automatically until withdrawn.","ติดตามปันผลหลังหักภาษี 15% อัตโนมัติ และนับเข้า Cash Buffer จนกว่าจะถอน")}</div>
            </div>
            <div style={{textAlign:"right"}}><div className="label">{t("Available dividend","ปันผลพร้อมใช้")}</div><div className="value" style={{fontSize:22}}>{buffer?money(Number(buffer.dividendAvailable??0)):"—"}</div></div>
          </div>
          <div className="grid cols-4" style={{marginTop:12}}>
            <div className="metric"><div className="label">{t("Gross dividend","ปันผลก่อนภาษี")}</div><div className="value" style={{fontSize:17}}>{buffer?money(Number(buffer.dividendGrossCash??0)):"—"}</div></div>
            <div className="metric"><div className="label">{t("Tax 15%","ภาษี 15%")}</div><div className="value neg" style={{fontSize:17}}>{buffer?money(Number(buffer.dividendTax??0)):"—"}</div></div>
            <div className="metric"><div className="label">{t("Net dividend","ปันผลสุทธิ")}</div><div className="value pos" style={{fontSize:17}}>{buffer?money(Number(buffer.dividendNet??0)):"—"}</div></div>
            <div className="metric"><div className="label">{t("Withdrawn profit","กำไรที่ถอนแล้ว")}</div><div className="value pos" style={{fontSize:17}}>{buffer?money(Number(buffer.realizedInvestmentProfit??0)):"—"}</div></div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
            <div style={{position:"relative",minWidth:180,flex:"0 1 220px"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontWeight:800}}>$</span><input inputMode="decimal" aria-label="Dividend withdrawal amount" value={dividendInput} onChange={e=>setDividendInput(e.target.value)} style={{width:"100%",paddingLeft:28}} placeholder="0.00"/></div>
            <button className="btn" type="button" disabled={dividendBusy||Number(buffer?.dividendAvailable??0)<=0} onClick={withdrawDividend}>{dividendBusy?"…":t("Withdraw Dividend","ถอนปันผล")}</button>
            <button className="btn ghost" type="button" disabled={dividendBusy||Number(buffer?.dividendAvailable??0)<=0} onClick={()=>setDividendInput(String(Number(buffer?.dividendAvailable??0).toFixed(2)))}>{t("Use all","ถอนทั้งหมด")}</button>
          </div>
          {dividendMessage&&<div className="notice" style={{marginTop:10}}>{dividendMessage}</div>}
        </div>

        {buffer?.reserveHoldings?.length>0&&<div className="muted" style={{marginTop:12,fontSize:12}}>{t("Reserve holdings:","สินทรัพย์สำรอง:")} {buffer.reserveHoldings.map((r:any)=>`${r.ticker} ${money(Number(r.marketValue||0))}`).join(" · ")}</div>}
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
