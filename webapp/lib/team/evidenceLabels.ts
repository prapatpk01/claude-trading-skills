export function evidenceLabel(label: string, lang: "en" | "th" = "en"): string {
  const normalized = String(label ?? "").trim();
  const dynamicExecution = normalized.match(/^execution price for (.+)$/i);
  if (dynamicExecution) return lang === "th" ? `ราคาสำหรับส่งคำสั่ง ${dynamicExecution[1]}` : normalized;

  const map: Record<string, { en: string; th: string }> = {
    "concentration zone (Kai Tanaka)": { en: "Concentration zone · Kai Tanaka", th: "ระดับการกระจุกตัว · Kai Tanaka" },
    "momentum score (Maya Chen)": { en: "Momentum score · Maya Chen", th: "คะแนน Momentum · Maya Chen" },
    "valuation read (Thomas Eriksson)": { en: "Valuation read · Thomas Eriksson", th: "การประเมินมูลค่า · Thomas Eriksson" },
    "trend structure": { en: "Trend structure", th: "โครงสร้างแนวโน้ม" },
    "liquidity (Ryan Blackwood)": { en: "Liquidity · Ryan Blackwood", th: "สภาพคล่อง · Ryan Blackwood" },
    "current price (Leo Tanaka)": { en: "Current price · Leo Tanaka", th: "ราคาปัจจุบัน · Leo Tanaka" },
    "conviction score (Aisha Fontaine)": { en: "Conviction score · Aisha Fontaine", th: "คะแนน Conviction · Aisha Fontaine" },
    "price target (Thomas Eriksson)": { en: "Price target · Thomas Eriksson", th: "ราคาเป้าหมาย · Thomas Eriksson" },
    "upside to target": { en: "Upside to target", th: "Upside ถึงราคาเป้าหมาย" },
    "technical gate (Maya Chen)": { en: "Technical gate · Maya Chen", th: "Technical gate · Maya Chen" },
  };
  const hit = map[normalized];
  return hit ? hit[lang] : normalized;
}
