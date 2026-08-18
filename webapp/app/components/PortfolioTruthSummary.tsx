"use client";

import type { AppLang } from "../page";
import { money, pct, cls } from "./format";
import { useFundSnapshot } from "./useFundSnapshot";
import { useCallback, useEffect, useRef, useState } from "react";
import CashLedgerPanel from "./CashLedgerPanel";

type CashView = "balance" | "flows" | "dividends";

export default function PortfolioTruthSummary({ lang, refreshKey = 0, cashOnly = false }: { lang: AppLang; refreshKey?: number; cashOnly?: boolean }) {
  const fund = useFundSnapshot(refreshKey);
  const t = (en: string, th: string) => lang === "th" ? th : en;
  const [buffer,setBuffer]=useState<any>(null);
  const [cashInput,setCashInput]=useState("");
  const [cashBusy,setCashBusy]=useState(false);
  const [cashMessage,setCashMessage]=useState<string|null>(null);
  const cashEditingRef=useRef(false);
  const [dividendInput,setDividendInput]=useState("");
  const [dividendBusy,setDividendBusy]=useState(false);
  const [dividendMessage,setDividendMessage]=useState<string|null>(null);
  const [cashView,setCashView]=useState<CashView>("balance");

  const loadBuffer=useCallback(async()=>{
    try{
      const r=await fetch(`/api/portfolio/cash-buffer?t=${Date.now()}`,{cache:"no-store",headers:{"Cache-Control":"no-cache"}});
      const j=await r.json();
      if(!r.ok)throw new Error(j.error||"Cash buffer unavailable");
      setBuffer(j);
      // Never overwrite a number while the owner is typing. Portfolio refreshes
      // can fire repeatedly while this screen is open; previously each refresh
      // re-injected the saved balance and made the controlled input feel locked.
      if(!cashEditingRef.current){
        setCashInput(Number.isFinite(Number(j.investmentCash??j.cashBalance))?String(Number(j.investmentCash??j.cashBalance).toFixed(2)):"");
      }
      setDividendInput(Number(j.dividendAvailable??0)>0?String(Number(j.dividendAvailable).toFixed(2)):"");
    } catch { setBuffer(null); }
  },[]);

  useEffect(()=>{loadBuffer()},[loadBuffer,refreshKey]);
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const refresh=()=>void loadBuffer();
    window.addEventListener("sentinel:cash-ledger-changed",refresh);
    return()=>window.removeEventListener("sentinel:cash-ledger-changed",refresh);
  },[loadBuffer]);

  const saveBrokerCash=async()=>{
    const value=Number(String(cashInput).replace(/,/g,""));
    if(!Number.isFinite(value)||value<0){setCashMessage(t("Enter a valid USD investment cash balance.","กรุณากรอกยอดเงินลงทุน USD ที่ถูกต้อง"));return;}
    setCashBusy(true);setCashMessage(null);
    try{
      const r=await fetch("/api/portfolio/cash",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","Cache-Control":"no-cache"},body:JSON.stringify({mode:"SET_BALANCE",balance:value,entry_date:new Date().toISOString().slice(0,10),notes:"Broker USD investment cash reconciliation from Portfolio Overview"})});
      const j=await r.json();if(!r.ok)throw new Error(j.error||"Save failed");
      cashEditingRef.current=false;
      setCashInput(value.toFixed(2));
      if(typeof window!=="undefined")window.dispatchEvent(new Event("sentinel:cash-ledger-changed"));
      setCashMessage(t(`Saved broker investable USD at ${money(value)}. This is the total balance, not an amount to add.`,`บันทึกยอด USD ที่ลงทุนได้จากโบรกเกอร์เป็น ${money(value)} แล้ว ตัวเลขนี้คือยอดรวม ไม่ใช่จำนวนเงินที่จะบวกเพิ่ม`));
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
      if(typeof window!=="undefined")window.dispatchEvent(new Event("sentinel:cash-ledger-changed"));
      setDividendMessage(t("Dividend withdrawn. It is now realized investment profit and is no longer investable Cash Buffer.","ถอนปันผลแล้ว เงินนี้ถูกนับเป็นกำไรจากการลงทุนที่รับรู้แล้วและไม่นับเป็น Cash Buffer สำหรับลงทุนต่อ"));
    } catch(e:any){setDividendMessage(e?.message||"Withdrawal failed")}finally{setDividendBusy(false)}
  };

  return (
    <section className="portfolio-truth-summary" aria-label={t("Verified portfolio summary", "สรุปพอร์ตที่ตรวจสอบแล้ว")}>
      {!cashOnly&&<div className="grid cols-3">
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
      </div>}

      <div className="card" style={{marginTop:14,padding:18,borderColor:"rgba(49,217,243,.35)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
          <div>
            <div className="label">{t("CASH BUFFER & CASH ACTIVITY","CASH BUFFER และรายการเงินสด")}</div>
            <h3 className="sub" style={{margin:"6px 0 3px"}}>{t("One cash center, one ledger","ศูนย์เงินสดเดียว ใช้ Ledger เดียวกัน")}</h3>
            <div className="muted" style={{fontSize:12}}>{t("Choose a topic below. Balance reconciliation, external cash flows and dividends all update the same authoritative cash ledger.","เลือกหัวข้อด้านล่าง การกระทบยอด เงินเข้า–ออกจากภายนอก และปันผลจะอัปเดตสมุดเงินสดชุดเดียวกัน")}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="label">{t("Total Cash Buffer","Cash Buffer รวม")}</div>
            <div className="value" style={{fontSize:24}}>{buffer?money(Number(buffer.totalReserveAssets??buffer.grossBuffer??0)):"—"}</div>
            <div className="sub">{buffer?t("USD investment cash + available net dividends + approved reserve holdings","เงินลงทุน USD + ปันผลสุทธิที่ยังไม่ถอน + สินทรัพย์สำรอง"):t("Loading buffer…","กำลังโหลด Buffer…")}</div>
          </div>
        </div>

        <div className="grid cols-4" style={{marginTop:14}}>
          <div className="metric"><div className="label">{t("Broker USD cash","เงินสด USD ในโบรกเกอร์")}</div><div className="value" style={{fontSize:18}}>{buffer?money(Number(buffer.investmentCash??buffer.cashBalance??0)):"—"}</div></div>
          <div className="metric"><div className="label">{t("Available dividend","ปันผลพร้อมใช้")}</div><div className="value pos" style={{fontSize:18}}>{buffer?money(Number(buffer.dividendAvailable??0)):"—"}</div></div>
          <div className="metric"><div className="label">{t("Reserve instruments","สินทรัพย์สำรอง")}</div><div className="value" style={{fontSize:18}}>{buffer?money(Number(buffer.reserveMarketValue??0)):"—"}</div></div>
          <div className="metric"><div className="label">{t("Policy Cash Floor","Cash Floor ตามนโยบาย")}</div><div className="value" style={{fontSize:18}}>{buffer?pct(Number(buffer.cashFloorPct??buffer.targetPct??0)):"—"}</div></div>
        </div>

        <div className="tabs cash-center-tabs" role="tablist" aria-label={t("Cash center topic","หัวข้อศูนย์เงินสด")} style={{marginTop:14,overflowX:"auto"}}>
          {([
            ["balance",t("USD Cash balance","ยอด USD Cash")],
            ["flows",t("Cash in / out","เงินเข้า–ออก")],
            ["dividends",t("Dividends","เงินปันผล")],
          ] as Array<[CashView,string]>).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={cashView===id} className={`tab ${cashView===id?"active":""}`} onClick={()=>setCashView(id)}>{label}</button>)}
        </div>

        {cashView==="balance"&&<div role="tabpanel" aria-label={t("USD Cash balance","ยอด USD Cash")}>
        <div className="notice" style={{marginTop:14,borderColor:"rgba(49,217,243,.35)"}}><strong>{t("Current broker balance — not Cash Floor","ยอดเงินสดจริงในโบรกเกอร์ — ไม่ใช่ Cash Floor")}</strong><br/>{t("Enter the TOTAL investable USD cash after settlement and fees. Saving replaces the current balance by posting only the reconciliation difference.","กรอกยอด USD ที่ลงทุนได้รวมหลัง settlement และค่าธรรมเนียม การบันทึกจะแทนที่ยอดปัจจุบันโดยสร้างเฉพาะส่วนต่างเพื่อกระทบยอด")}</div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:14}}>
          <div style={{position:"relative",minWidth:180,flex:"0 1 240px"}}>
            <span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontWeight:800}}>$</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Investment USD cash"
              value={cashInput}
              onFocus={()=>{cashEditingRef.current=true;setCashMessage(null)}}
              onChange={e=>{cashEditingRef.current=true;setCashInput(e.target.value)}}
              onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void saveBrokerCash()}}}
              style={{width:"100%",paddingLeft:28}}
              placeholder="0.00"
            />
          </div>
          <button className="btn" type="button" disabled={cashBusy} onClick={saveBrokerCash}>{cashBusy?"…":t("Update USD Cash","บันทึก USD Cash")}</button>
          <span className="muted" style={{fontSize:12}}>{t("Current saved broker cash:","ยอดเงินสดโบรกเกอร์ที่บันทึกอยู่:")} <strong>{buffer?money(Number(buffer.investmentCash??buffer.cashBalance??0)):"—"}</strong></span>
        </div>
        <div className="muted" style={{fontSize:11.5,marginTop:8}}>{t("You can replace this with a lower or higher balance at any time. Example: change 3,109.16 to 1,177.16 and press Update USD Cash.","แก้เป็นยอดที่ต่ำกว่าหรือสูงกว่าเดิมได้ตลอด เช่น เปลี่ยน 3,109.16 เป็น 1,177.16 แล้วกด บันทึก USD Cash")}</div>
        {cashMessage&&<div className="notice" style={{marginTop:10}}>{cashMessage}</div>}
        {buffer?.reserveHoldings?.length>0&&<div className="muted" style={{marginTop:12,fontSize:12}}>{t("Reserve holdings:","สินทรัพย์สำรอง:")} {buffer.reserveHoldings.map((r:any)=>`${r.ticker} ${money(Number(r.marketValue||0))}`).join(" · ")}</div>}
        </div>}

        {cashView==="flows"&&<div role="tabpanel" aria-label={t("Cash in and out","เงินเข้าและออก")} style={{marginTop:14}}><CashLedgerPanel lang={lang} refreshKey={refreshKey} embedded/></div>}

        {cashView==="dividends"&&<div role="tabpanel" aria-label={t("Dividends","เงินปันผล")} style={{marginTop:16,paddingTop:14,borderTop:"1px solid var(--border)"}}>
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
        </div>}
      </div>

      {!cashOnly&&!fund.loading && (fund.error || !fund.verified) && (
        <div className="notice" style={{ marginTop: 12 }}>
          <strong>{t("Portfolio valuation withheld", "ระงับการประเมินมูลค่าพอร์ต")}</strong>
          <div style={{ marginTop: 5 }}>{fund.error || t("Some required market prices are not verified.", "ราคาตลาดที่จำเป็นบางรายการยังไม่ได้รับการยืนยัน")}</div>
        </div>
      )}
    </section>
  );
}
