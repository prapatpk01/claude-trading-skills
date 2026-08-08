"use client";

import { useEffect } from "react";
import type { AppLang } from "../page";

const exact: Record<string, string> = {
  "MEETING RECORDED · FROZEN": "บันทึกการประชุมแล้ว · ล็อกผลการประชุม",
  "QUORUM READY": "องค์ประชุมครบ",
  "QUORUM BLOCKED": "องค์ประชุมไม่ครบ",
  "READY FOR APPROVAL": "พร้อมเสนออนุมัติ",
  "DEFERRED": "เลื่อนการตัดสินใจ",
  "FAILED": "ไม่ผ่าน",
  "HOLD CONFIRMED": "ยืนยันถือครอง",
  "RAISE BUFFER": "เพิ่มเงินสำรอง",
  "NEW BUY": "ซื้อหุ้นใหม่",
  "TRIM": "ลดน้ำหนัก",
  "EXIT": "ขายออก",
  "ADD": "เพิ่มน้ำหนัก",
  "HOLD": "ถือ",
  "complete": "ครบถ้วน",
  "size pending": "รอกำหนดขนาด",
  "portfolio ledger": "สมุดบัญชีพอร์ต",
  "UNAVAILABLE": "ไม่มีข้อมูล",
  "Research process unavailable": "ไม่สามารถใช้กระบวนการวิจัยได้",
  "No benchmark evidence": "ไม่มีหลักฐานจากดัชนีอ้างอิง",
  "CASH_RESERVE": "เงินสำรอง",
  "NEW_INVESTMENT": "การลงทุนใหม่",
  "ADD_HOLDING": "เพิ่มน้ำหนักหุ้นเดิม",
  "TEMPORARY_PARKING": "พักเงินชั่วคราว",
  "REVIEW ADD": "ทบทวนการเพิ่มน้ำหนัก",
  "KEEP RESERVE": "คงเป็นเงินสำรอง",
  "DECISION AUTHORITY": "ผู้มีอำนาจตัดสินใจ",
  "HEAD · DECIDES": "หัวหน้าทีม · ตัดสินใจ",
  "ADVISORY": "ที่ปรึกษา",
  "TEAM": "ทีม",
};

const replacements: Array<[RegExp, string | ((...args: any[]) => string)]> = [
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
  [/supportive/gi, "สนับสนุน"],
  [/opposed/gi, "คัดค้าน"],
  [/abstaining desk opinions remain on the evidence record/gi, "ความเห็นที่งดออกเสียงยังคงอยู่ในบันทึกหลักฐาน"],
  [/fails the shared technical BUY gate/gi, "ไม่ผ่านเกณฑ์ Technical BUY ร่วม"],
  [/minimum/gi, "ขั้นต่ำ"],
  [/hard block\(s\)/gi, "เงื่อนไขบังคับที่ไม่ผ่าน"],
  [/signal REJECT/gi, "สัญญาณ REJECT"],
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
  [/Temporary reserve/gi, "เงินสำรองชั่วคราว"],
  [/Without destination/gi, "เงินไม่มีปลายทาง"],
  [/Sources/gi, "แหล่งเงิน"],
  [/Destinations/gi, "ปลายทางเงิน"],
  [/Cash Buffer/gi, "เงินสำรอง Cash Buffer"],
  [/Raise Buffer/gi, "เพิ่มเงินสำรอง"],
];

function translateText(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return input;
  if (exact[trimmed]) return input.replace(trimmed, exact[trimmed]);
  let out = input;
  for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement as any);
  return out;
}

function translateRoot(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest("script,style,input,textarea")) continue;
    const next = translateText(node.nodeValue ?? "");
    if (next !== node.nodeValue) node.nodeValue = next;
  }
}

export default function ThaiMeetingTranslator({ lang }: { lang: AppLang }) {
  useEffect(() => {
    if (lang !== "th") return;
    const root = document.querySelector<HTMLElement>('[data-workspace="cio-v20"]');
    if (!root) return;
    translateRoot(root);
    const observer = new MutationObserver(() => translateRoot(root));
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [lang]);
  return null;
}
