"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { money, cls } from "./format";
import type { AppLang } from "../page";

type Entry = { id:string; entry_type:string; amount:number|string; currency:string; entry_date:string; ticker?:string|null; transaction_id?:string|null; dividend_id?:string|null; notes?:string|null };
type FlowType = "ADD_CAPITAL" | "WITHDRAW_AUTO" | "WITHDRAW_CAPITAL" | "FEE" | "ADJUSTMENT";

export default function CashLedgerPanel({ lang, refreshKey, embedded = false }: { lang: AppLang; refreshKey: number; embedded?: boolean }) {
  const [data,setData]=useState<any>(null); const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null);
  const [form,setForm]=useState<{ flow_type:FlowType; amount:string; entry_date:string; notes:string }>({ flow_type:"ADD_CAPITAL", amount:"", entry_date:new Date().toISOString().slice(0,10), notes:"" });
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{ setLoading(true); setError(null); try { const r=await fetch("/api/portfolio/cash?limit=300",{cache:"no-store"}); const j=await r.json(); if(!r.ok) throw new Error(j.error||"Cash ledger failed"); setData(j); } catch(e:any){ setError(e.message); } finally { setLoading(false); } },[]);
  useEffect(()=>{ load(); },[load,refreshKey]);
  const rows:Entry[]=data?.entries??[];
  const audit=useMemo(()=>({ tradesLinked:(data?.unlinkedTrades??0)===0, dividendsLinked:(data?.unlinkedDividends??0)===0, hasOpeningBalance:rows.some(r=>["DEPOSIT","ADJUSTMENT"].includes(r.entry_type)) }),[data,rows]);
  const t=(en:string,th:string)=>lang==="th"?th:en;
  const emitCashChange=()=>{ if(typeof window!=="undefined") window.dispatchEvent(new Event("sentinel:cash-ledger-changed")); };
  useEffect(()=>{
    if(typeof window==="undefined")return;
    const refresh=()=>void load();
    window.addEventListener("sentinel:cash-ledger-changed",refresh);
    return()=>window.removeEventListener("sentinel:cash-ledger-changed",refresh);
  },[load]);

  const flowHelp = form.flow_type === "ADD_CAPITAL"
    ? t("New money from outside the fund. Example: if you receive $300 of new capital, enter 300 here. This is investment capital, not dividend or profit.","เงินใหม่จากภายนอกกองทุน เช่น ได้รับเพิ่มทุน $300 ให้กรอก 300 ตรงนี้ เงินนี้เป็นเงินลงทุน ไม่ใช่ปันผลหรือกำไร")
    : form.flow_type === "WITHDRAW_AUTO"
      ? t("Withdraw one total amount. Sentinel uses available dividend cash first; any excess is automatically classified as a withdrawal of invested capital.","กรอกยอดถอนรวมครั้งเดียว Sentinel จะตัดจากเงินปันผลที่ถอนได้ก่อน และส่วนที่เกินจะนับเป็นการถอนเงินลงทุนอัตโนมัติ")
      : form.flow_type === "WITHDRAW_CAPITAL"
        ? t("Withdraw invested capital directly and leave available dividend cash untouched.","ถอนเงินลงทุนโดยตรง โดยไม่ตัดจากยอดปันผลที่พร้อมถอนไปก่อน")
        : form.flow_type === "ADJUSTMENT"
          ? t("Reconciliation/correction only. Do not use ADJUSTMENT for new external capital or normal withdrawals.","ใช้เฉพาะปรับยอด/กระทบยอด ไม่ใช้ ADJUSTMENT สำหรับเงินเพิ่มทุนใหม่หรือการถอนปกติ")
          : t("Broker or fund fee paid from cash.","ค่าธรรมเนียมที่จ่ายออกจากเงินสดของกองทุน");

  const content=<>
    {!embedded&&<div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}><div><h2 className="section" style={{margin:0}}>💵 {t("Fund Cash Flows & Audit","กระแสเงินเข้าออกกองทุนและการตรวจสอบ")}</h2><p className="muted" style={{margin:"6px 0 0"}}>{t("BUY and SELL cash movements post automatically. Use this form only for money entering or leaving the fund from outside, fees, or a genuine reconciliation adjustment.","เงินจากการ BUY/SELL บันทึกอัตโนมัติ ใช้แบบฟอร์มนี้เฉพาะเงินที่เข้า/ออกกองทุนจากภายนอก ค่าธรรมเนียม หรือการปรับยอดเพื่อกระทบยอดจริง")}</p></div><button className="btn ghost sm" onClick={load} disabled={loading}>{loading?"…":"↻ Refresh"}</button></div>}
    {embedded&&<div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}><div><h3 className="sub" style={{margin:0}}>{t("Record external cash activity","บันทึกเงินเข้า–ออกจากภายนอก")}</h3><p className="muted" style={{margin:"5px 0 0",fontSize:12}}>{t("Trades and dividends are linked automatically. Record only outside capital, withdrawals, fees or a real reconciliation correction.","รายการซื้อขายและปันผลเชื่อมอัตโนมัติ ให้กรอกเฉพาะเงินทุนภายนอก การถอน ค่าธรรมเนียม หรือการกระทบยอดจริง")}</p></div><button className="btn ghost sm" type="button" onClick={load} disabled={loading}>{loading?"…":"↻ Refresh"}</button></div>}
    {error&&<div className="err" style={{marginTop:12}}>⚠ {error}</div>}

    {!embedded&&<div className="grid cols-4" style={{marginTop:14}}>
      <Metric label={t("Ledger cash","เงินสดตามสมุด")} value={money(data?.balance??0)} accent={(data?.balance??0)>=0?"pos":"neg"}/>
      <Metric label={t("Investment USD cash","เงินสดจากเงินลงทุน")} value={money(data?.investmentCash??0)}/>
      <Metric label={t("Available dividend","ปันผลที่พร้อมถอน")} value={money(data?.dividendAvailable??0)} accent="pos"/>
      <Metric label={t("Net external capital","เงินทุนภายนอกสุทธิ")} value={money(data?.netExternalCapital??0)} />
    </div>}
    <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
      <span className={cls("pill",audit.tradesLinked?"buy":"sell")}>{t("Trade linkage","เชื่อมรายการซื้อขาย")}: {audit.tradesLinked?"PASS":"FAILED"}</span>
      <span className={cls("pill",audit.dividendsLinked?"buy":"sell")}>{t("Dividend linkage","เชื่อมรายการปันผล")}: {audit.dividendsLinked?"PASS":"FAILED"}</span>
      <span className="pill hold">{t("Capital in","เพิ่มทุน")}: {money(data?.capitalContributed??0)}</span>
      <span className="pill hold">{t("Capital out","ถอนเงินลงทุน")}: {money(data?.capitalWithdrawn??0)}</span>
    </div>

    {!audit.hasOpeningBalance&&<div className="notice" style={{marginTop:12}}>{t("No opening cash/deposit exists yet. If this is the first setup, reconcile the current broker cash once. After setup, new outside money must be recorded as External capital in — not as a balance adjustment.","ยังไม่มียอดเงินสดตั้งต้น หากเป็นการตั้งระบบครั้งแรกให้กระทบยอดเงินสดโบรกเกอร์ครั้งเดียว หลังจากนั้นเงินใหม่จากภายนอกต้องบันทึกเป็น เพิ่มทุนจากภายนอก ไม่ใช่รายการปรับยอด")}</div>}

    <div className="notice" style={{marginTop:12,borderColor:"var(--accent)"}}>
      <strong>{t("How to record cash","วิธีกรอกเงิน")}</strong><br/>
      {t("External $300 → choose External capital in and enter $300. Selling GPIQ or another holding → do not enter it here; the SELL transaction adds the proceeds automatically. Withdrawing more than available dividends → choose Withdraw cash (dividend first); Sentinel splits the excess into capital withdrawal automatically.","เพิ่มทุนจากภายนอก $300 → เลือก เพิ่มทุนจากภายนอก แล้วกรอก $300 · ขาย GPIQ หรือหุ้นอื่น → ไม่ต้องกรอกเงินขายซ้ำตรงนี้ เพราะรายการ SELL จะเพิ่มเงินให้อัตโนมัติ · ถอนมากกว่าปันผลที่มี → เลือก ถอนเงิน (ตัดปันผลก่อน) ระบบจะแยกส่วนที่เกินเป็นถอนเงินลงทุนอัตโนมัติ")}
    </div>

    <form className="cash-ledger-form" style={{marginTop:14,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}} onSubmit={async e=>{
      e.preventDefault();setBusy(true);setError(null);
      try{
        const base={amount:form.amount,entry_date:form.entry_date,notes:form.notes};
        const body = form.flow_type === "ADD_CAPITAL" ? {...base,entry_type:"DEPOSIT"}
          : form.flow_type === "WITHDRAW_AUTO" ? {...base,mode:"WITHDRAW_CASH"}
          : form.flow_type === "WITHDRAW_CAPITAL" ? {...base,entry_type:"WITHDRAWAL"}
          : form.flow_type === "FEE" ? {...base,entry_type:"FEE"}
          : {...base,entry_type:"ADJUSTMENT"};
        const r=await fetch("/api/portfolio/cash",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw new Error(j.error||"Save failed");setForm({...form,amount:"",notes:""});emitCashChange();
      }catch(e:any){setError(e.message)}finally{setBusy(false)}
    }}>
      <select value={form.flow_type} onChange={e=>setForm({...form,flow_type:e.target.value as FlowType})}>
        <option value="ADD_CAPITAL">{t("External capital in","เพิ่มทุนจากภายนอก")}</option>
        <option value="WITHDRAW_AUTO">{t("Withdraw cash — dividend first","ถอนเงิน — ตัดปันผลก่อน")}</option>
        <option value="WITHDRAW_CAPITAL">{t("Investment capital withdrawal only","ถอนเงินลงทุนโดยตรง")}</option>
        <option value="FEE">{t("Fee","ค่าธรรมเนียม")}</option>
        <option value="ADJUSTMENT">{t("Reconciliation adjustment","ปรับยอดเพื่อกระทบยอด")}</option>
      </select>
      <input inputMode="decimal" placeholder={t("Amount USD","จำนวน USD")} value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><input type="date" value={form.entry_date} onChange={e=>setForm({...form,entry_date:e.target.value})}/><input style={{flex:1,minWidth:180}} placeholder={t("Source / note","ที่มา / หมายเหตุ")} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/><button className="btn" disabled={busy}>{busy?"…":t("Record cash flow","บันทึกเงินเข้าออก")}</button>
    </form>
    <p className="muted" style={{fontSize:12,margin:"7px 0 0"}}>{flowHelp}</p>

    <details style={{marginTop:14}} open={embedded?undefined:true}>
      <summary style={{cursor:"pointer",fontWeight:750,color:"var(--text)"}}>{t(`Cash ledger history (${rows.length})`,`ประวัติสมุดเงินสด (${rows.length})`)}</summary>
      <div className="table-wrap" style={{marginTop:10,maxHeight:420,overflowY:"auto"}}><table className="tbl"><thead><tr><th>{t("Date","วันที่")}</th><th>{t("Type","ประเภท")}</th><th>Ticker</th><th className="num">{t("Amount","จำนวนเงิน")}</th><th>{t("Source","ที่มา")}</th><th></th></tr></thead><tbody>{rows.map(r=>{const amount=Number(r.amount);const system=!!(r.transaction_id||r.dividend_id)||["BUY","SELL","DIVIDEND","TAX"].includes(r.entry_type);const note=String(r.notes??"").replace("[DIVIDEND_WITHDRAWAL]","").replace("[CAPITAL_WITHDRAWAL]","").trim();return <tr key={r.id}><td>{r.entry_date}</td><td><strong>{r.entry_type}</strong>{String(r.notes??"").includes("[DIVIDEND_WITHDRAWAL]")&&<small style={{display:"block",color:"var(--muted)"}}>{t("dividend","ปันผล")}</small>}{String(r.notes??"").includes("[CAPITAL_WITHDRAWAL]")&&<small style={{display:"block",color:"var(--muted)"}}>{t("investment capital","เงินลงทุน")}</small>}</td><td>{r.ticker??"—"}</td><td className={cls("num",amount>=0?"pos":"neg")}>{money(amount)}</td><td className="muted" style={{fontSize:11.5}}>{system?t("Automatic","อัตโนมัติ"):note||t("Manual","กรอกเอง")}</td><td>{!system&&<button type="button" className="btn danger sm" onClick={async()=>{if(!window.confirm(t("Delete this cash entry?","ลบรายการเงินสดนี้หรือไม่?")))return;const res=await fetch(`/api/portfolio/cash?id=${r.id}`,{method:"DELETE"});const j=await res.json().catch(()=>({}));if(!res.ok){setError(j.error||"Delete failed");return;}emitCashChange();}}>✕</button>}</td></tr>})}{!rows.length&&!loading&&<tr><td colSpan={6} className="muted">{t("No cash entries yet.","ยังไม่มีรายการเงินสด")}</td></tr>}</tbody></table></div>
    </details>
    <p className="notice" style={{marginTop:12}}>{t("Fund cash equation: external capital + sale proceeds + net dividends − purchases − withdrawals − fees ± reconciliation adjustments = ledger cash. A balance reconciliation changes the ledger to match the broker; it is not a new capital contribution.","สมการเงินสดกองทุน: เงินเพิ่มทุนภายนอก + เงินจากการขาย + ปันผลสุทธิ − เงินซื้อสินทรัพย์ − เงินถอน − ค่าธรรมเนียม ± รายการกระทบยอด = เงินสดตามสมุด การกระทบยอดเป็นเพียงการทำให้ตรงกับโบรกเกอร์ ไม่ใช่การเพิ่มทุนใหม่")}</p>
  </>;
  return embedded?<div style={{paddingTop:4}}>{content}</div>:<div className="card" style={{marginTop:18}}>{content}</div>;
}
function Metric({label,value,accent}:{label:string;value:string;accent?:string}){return <div className="metric"><div className="label">{label}</div><div className={cls("value",accent)} style={{fontSize:19}}>{value}</div></div>}
