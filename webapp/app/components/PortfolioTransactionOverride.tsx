"use client";

import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import HoldingTransactionForm from "./HoldingTransactionForm";

type Props={onSaved:()=>void;lang?:"en"|"th"};

export default function PortfolioTransactionOverride({onSaved,lang="en"}:Props){
 const[target,setTarget]=useState<HTMLElement|null>(null);
 useEffect(()=>{
  let mount:HTMLDivElement|null=null;
  let legacy:HTMLFormElement|null=null;
  const attach=()=>{
   legacy=Array.from(document.querySelectorAll<HTMLFormElement>("form.searchbar")).find(form=>
    Boolean(form.querySelector('input[placeholder="Shares"]'))&&Boolean(form.querySelector('input[placeholder="Avg cost"]'))
   )??null;
   if(!legacy)return false;
   legacy.style.display="none";
   legacy.setAttribute("aria-hidden","true");
   mount=document.createElement("div");
   mount.dataset.portfolioTransactionOverride="true";
   legacy.parentElement?.insertBefore(mount,legacy);
   setTarget(mount);
   return true;
  };
  if(!attach()){
   const observer=new MutationObserver(()=>{if(attach())observer.disconnect()});
   observer.observe(document.body,{childList:true,subtree:true});
   return()=>observer.disconnect();
  }
  return()=>{
   if(legacy){legacy.style.display="";legacy.removeAttribute("aria-hidden")}
   mount?.remove();
  };
 },[]);
 if(!target)return null;
 return createPortal(
  <section style={{marginTop:14,padding:"16px",border:"1px solid rgba(111,132,255,.22)",borderRadius:14,background:"rgba(8,16,34,.48)"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
    <div>
     <div className="eyebrow">{lang==="th"?"MANUAL PORTFOLIO ADJUSTMENT":"MANUAL PORTFOLIO ADJUSTMENT"}</div>
     <h3 className="sub" style={{margin:"5px 0 4px"}}>{lang==="th"?"ปรับรายการซื้อหรือขายด้วยตนเอง":"Buy / Sell transaction override"}</h3>
     <p className="muted" style={{margin:0,fontSize:12,maxWidth:620}}>{lang==="th"?"ใช้เมื่อรายการอยู่นอกมติคณะกรรมการ หรือต้องแก้ไข Ticket ด้วยตนเอง รายการทั้งหมดจะเข้าสู่ Portfolio และ Ledger ชุดเดียวกัน":"Use for transactions outside a committee resolution or for manual ticket correction. Buy and sell entries flow into the same portfolio and ledger."}</p>
    </div>
    <HoldingTransactionForm onSaved={onSaved}/>
   </div>
  </section>,target
 );
}
