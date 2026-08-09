"use client";

import { useEffect } from "react";
import type { AppLang } from "../page";

const replacements: Array<[RegExp, string | ((...args: any[]) => string)]> = [
  [/^Risk-On (\d+)\/100; macro, fundamentals, valuation, catalysts, momentum and quant evidence assembled\.$/i, (_m, a) => `Risk-On ${a}/100; รวบรวมหลักฐานด้านมหภาค ปัจจัยพื้นฐาน มูลค่า Catalyst, Momentum และ Quant แล้ว`],
  [/^(\d+) name\(s\) presented\. Phase 1 uses every factor lens; the Swing model supplies tactical timing only\. (\d+) combined model proposal\(s\) are shown in the opportunity list\.$/i, (_m, a, b) => `นำเสนอหุ้น ${a} รายการ โดย Phase 1 วิเคราะห์ครบทุกปัจจัย ส่วน Swing model ใช้สำหรับกำหนดจังหวะเชิง Tactical เท่านั้น และมีข้อเสนอจากโมเดลรวม ${b} รายการแสดงใน Opportunity List`],
  [/^(\d+) position\(s\) reviewed; (\d+) priced\. Sizing, funding, cash and before\/after portfolio impact are owned here\.$/i, (_m, a, b) => `ทบทวน ${a} Position และมีราคายืนยัน ${b} Position โดยทีมนี้รับผิดชอบขนาดการลงทุน แหล่งเงิน เงินสด และผลกระทบต่อพอร์ตก่อน/หลังทำรายการ`],
  [/^CRO risk gate followed by CIO final resolution\. Specialist desk opinions are evidence, not votes\. (\d+) of (\d+) seats brought a measurement\. The meeting is quorate\.$/i, (_m, a, b) => `ผ่านด่านความเสี่ยงของ CRO ก่อนเข้าสู่มติสุดท้ายของ CIO ความเห็นจากทีมผู้เชี่ยวชาญใช้เป็นหลักฐาน ไม่ใช่คะแนนโหวต โดย ${a} จาก ${b} ที่นั่งส่งผลการประเมิน และองค์ประชุมครบ`],
  [/^Record actual broker activity in Holdings first\. The checklist then matches ticker, side and approximate size; the owner confirms or rejects each line without creating a duplicate trade\.$/i, "บันทึกรายการซื้อขายจริงจาก Broker ใน Holdings ก่อน จากนั้น Checklist จะจับคู่ Ticker, ฝั่งซื้อ/ขาย และขนาดโดยประมาณ ผู้รับผิดชอบยืนยันหรือปฏิเสธแต่ละรายการได้โดยไม่สร้างรายการซื้อขายซ้ำ"],
  [/^(\d+) carried · (\d+) blocked\/deferred$/i, (_m, a, b) => `${a} รายการผ่าน · ${b} รายการถูกบล็อก/เลื่อน`],
  [/^Phase 1 (\d+) analyzed · Swing (\d+) scanned$/i, (_m, a, b) => `Phase 1 วิเคราะห์ ${a} รายการ · Swing สแกน ${b} รายการ`],
  [/^(\$[\d,]+) temporary reserve$/i, (_m, a) => `${a} พักเป็นเงินสำรองชั่วคราว`],
  [/^(\$[\d,]+) has no destination$/i, (_m, a) => `${a} ยังไม่มีปลายทาง`],
  [/^cash floor ([\d.]+)%$/i, (_m, a) => `เงินสำรองขั้นต่ำ ${a}%`],
  [/^(\d+) source lines$/i, (_m, a) => `${a} แหล่งเงิน`],
  [/^(\$[\d,]+) deployable · (\d+) uses$/i, (_m, a, b) => `${a} พร้อมนำไปใช้ · ${b} รายการใช้เงิน`],
  [/^review (.+)$/i, (_m, a) => `ทบทวน ${a}`],
  [/^Cash after (.+)$/i, (_m, a) => `เงินสำรองหลังทำรายการ ${a}`],
  [/^~([\d,.]+) shares$/i, (_m, a) => `~${a} หุ้น`],
  [/^(\d+) gaps$/i, (_m, a) => `ขาดข้อมูล ${a} รายการ`],
  [/^Could not measure:\s*/i, "ไม่สามารถวัดได้: "],
  [/^Coverage\s+/i, "ความครอบคลุม "],
  [/^Expected\s+/i, "ผลตอบแทนคาดหวัง "],
  [/^VETO · ([^:]+):\s*/i, (_m, a) => `คัดค้าน · ${a}: `],
  [/^Vetoed by ([^:]+):\s*/i, (_m, a) => `ถูกคัดค้านโดย ${a}: `],
  [/^Signed by\s+/i, "รับรองโดย "],
  [/supportive/gi, "สนับสนุน"], [/opposed/gi, "คัดค้าน"],
  [/abstaining desk opinions remain on the evidence record/gi, "ความเห็นที่งดออกเสียงยังคงอยู่ในบันทึกหลักฐาน"],
  [/fails the shared technical BUY gate/gi, "ไม่ผ่านเกณฑ์ Technical BUY ร่วม"], [/minimum/gi, "ขั้นต่ำ"],
  [/hard block\(s\)/gi, "เงื่อนไขบังคับที่ไม่ผ่าน"], [/signal REJECT/gi, "สัญญาณ REJECT"],
  [/It remains a research candidate, not an executable purchase\./gi, "ยังคงเป็นหุ้นสำหรับการวิจัย ไม่ใช่รายการที่พร้อมซื้อจริง"],
  [/a trim may not be executed until research names a replacement/gi, "ยังห้ามลดน้ำหนักจนกว่าทีมวิจัยจะระบุหุ้นทดแทน"],
  [/sits in the Income\/Dividend sleeve/gi, "อยู่ในส่วน Income/Dividend"],
  [/the replacement needs comparable return or momentum/gi, "หุ้นทดแทนต้องมีผลตอบแทนหรือ Momentum ที่เทียบเคียงได้"],
  [/restore the total Cash Buffer floor/gi, "ฟื้นระดับขั้นต่ำของ Cash Buffer รวม"],
  [/being raised from risk assets to restore the total Cash Buffer/gi, "กำลังระดมจากสินทรัพย์เสี่ยงเพื่อฟื้น Cash Buffer รวม"],
  [/The proceeds stay as USD or an approved reserve instrument/gi, "เงินที่ได้จะคงเป็น USD หรืออยู่ในตราสารสำรองที่ได้รับอนุมัติ"],
  [/they are ring-fenced and do not fund anything on this agenda/gi, "เงินส่วนนี้ถูกกันไว้เฉพาะและไม่นำไปใช้กับรายการอื่นในการประชุมนี้"],
  [/No deployable proceeds remain after the cash-floor decision/gi, "หลังการตัดสินใจเติมเงินสำรองแล้ว ไม่มีเงินเหลือสำหรับนำไปลงทุน"],
  [/Investment and Asset Management must return by/gi, "ทีม Investment และ Asset Management ต้องกลับมาทบทวนภายใน"],
  [/with a qualified new idea or a ranked ADD plan before any excess capital is released/gi, "พร้อมหุ้นใหม่ที่ผ่านเกณฑ์หรือแผน ADD ที่จัดอันดับแล้ว ก่อนปล่อยเงินส่วนเกินไปลงทุน"],
  [/Every dollar has a named destination, owner and review date/gi, "เงินทุกส่วนมีปลายทาง ผู้รับผิดชอบ และวันทบทวนที่ชัดเจน"],
];

const tickerLike = /^[A-Z][A-Z.\-]{0,9}$/;
function translateText(input: string): string { const trimmed=input.trim(); if(!trimmed||tickerLike.test(trimmed)) return input; let out=input; for(const [pattern,replacement] of replacements) out=out.replace(pattern,replacement as any); return out; }
function shouldSkip(parent: HTMLElement) { return Boolean(parent.closest("script,style,input,textarea,h1,h2,h3,h4,h5,h6,th,button,.tag,.sentinel-wordmark")); }
function translateRoot(root: HTMLElement) { const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); const nodes:Text[]=[]; while(walker.nextNode()) nodes.push(walker.currentNode as Text); for(const node of nodes){const parent=node.parentElement;if(!parent||shouldSkip(parent))continue;const current=node.nodeValue??"";const next=translateText(current);if(next!==current)node.nodeValue=next;} }
export default function ThaiMeetingTranslator({lang}:{lang:AppLang}) { useEffect(()=>{if(lang!=="th")return;const root=document.querySelector<HTMLElement>('[data-workspace="cio-v20"]');if(!root)return;translateRoot(root);const observer=new MutationObserver((mutations)=>{if(mutations.some((m)=>m.type==="childList"&&m.addedNodes.length>0))translateRoot(root);});observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect();},[lang]);return null; }
