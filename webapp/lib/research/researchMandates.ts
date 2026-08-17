export type ResearchMandate = {
  searchBasis: string;
  searchBasisTh: string;
  investmentHorizon: string;
  investmentHorizonTh: string;
  reviewCadence: string;
  reviewCadenceTh: string;
};

export const FUND_HOLDING_POLICY = {
  baseWindow: "4–16 weeks",
  baseWindowTh: "4–16 สัปดาห์",
  extensionWindow: "3–12 months",
  extensionWindowTh: "3–12 เดือน",
  incomeWindow: "6–24 months",
  incomeWindowTh: "6–24 เดือน",
  reviewCadence: "Daily technical monitor · weekly full re-underwrite · immediate rerun after earnings, guidance or material news",
  reviewCadenceTh: "ติดตาม Technical รายวัน · ทบทวนงานวิจัยเต็มรูปแบบรายสัปดาห์ · รันทันทีหลังงบ Guidance หรือข่าวสำคัญ",
  exitRule: "No fixed expiry: trim or exit when momentum weakens, the thesis changes, or the price approaches/reaches Fair Value.",
  exitRuleTh: "ไม่ขายเพียงเพราะครบเวลา: ลดหรือออกเมื่อ Momentum อ่อนแรง Thesis เปลี่ยน หรือราคาเข้าใกล้/ถึง Fair Value",
} as const;

const DAILY_WEEKLY_REVIEW = {
  reviewCadence: FUND_HOLDING_POLICY.reviewCadence,
  reviewCadenceTh: FUND_HOLDING_POLICY.reviewCadenceTh,
};

const MANDATES: Record<string, ResearchMandate> = {
  MOMENTUM_LIFECYCLE: {
    searchBasis: "Liquid US leaders: relative strength vs SPY, 1M/3M return, EMA structure, MACD and volume",
    searchBasisTh: "หุ้นสหรัฐฯ สภาพคล่องสูง: RS เทียบ SPY, ผลตอบแทน 1/3 เดือน, โครงสร้าง EMA, MACD และ Volume",
    investmentHorizon: "2–12 weeks; extend while trend, thesis and Fair Value room survive",
    investmentHorizonTh: "2–12 สัปดาห์; ถือต่อได้ขณะที่ Trend, Thesis และ Fair Value Gap ยังแข็งแรง",
    ...DAILY_WEEKLY_REVIEW,
  },
  INSTITUTIONAL_ACCUMULATION: {
    searchBasis: "Accumulation universe: 5D/20D volume, up/down volume, relative-strength stabilization and price compression",
    searchBasisTh: "กลุ่มหุ้นสะสม: Volume 5D/20D, Up/Down Volume, RS เริ่มทรงตัว และราคาบีบตัวก่อนวิ่ง",
    investmentHorizon: "4–16 weeks through accumulation and early markup",
    investmentHorizonTh: "4–16 สัปดาห์ ตั้งแต่ช่วงสะสมถึง Early Markup",
    ...DAILY_WEEKLY_REVIEW,
  },
  GROWTH_ACCELERATION: {
    searchBasis: "Growth universe: revenue/EPS/margin acceleration, estimate revisions and a momentum gate",
    searchBasisTh: "กลุ่ม Growth: รายได้/EPS/Margin เร่งตัว, ประมาณการปรับขึ้น และต้องผ่าน Momentum Gate",
    investmentHorizon: "1–2 quarters while revisions and price confirmation improve",
    investmentHorizonTh: "1–2 ไตรมาส ตราบใดที่ประมาณการและราคายืนยันดีขึ้น",
    ...DAILY_WEEKLY_REVIEW,
  },
  QUALITY_LEADERSHIP: {
    searchBasis: "Quality universe: ROIC/ROE, free cash flow, margins, balance sheet and emerging relative strength",
    searchBasisTh: "กลุ่ม Quality: ROIC/ROE, Free Cash Flow, Margin, งบดุล และ RS ที่เริ่มนำตลาด",
    investmentHorizon: "1–3 quarters while quality, trend and valuation headroom hold",
    investmentHorizonTh: "1–3 ไตรมาส ขณะที่คุณภาพ Trend และ Valuation Headroom ยังอยู่",
    ...DAILY_WEEKLY_REVIEW,
  },
  VALUATION_ROOM: {
    searchBasis: "Valuation universe: filing-backed DCF, comparable multiples or reliable consensus plus a momentum gate",
    searchBasisTh: "กลุ่ม Valuation: DCF จากงบ, Comparable หรือ Consensus ที่เชื่อถือได้ และต้องผ่าน Momentum Gate",
    investmentHorizon: "Until the Fair Value gap closes; typically 1–6 months",
    investmentHorizonTh: "จน Fair Value Gap ปิดลง; โดยทั่วไป 1–6 เดือน",
    ...DAILY_WEEKLY_REVIEW,
  },
  CATALYST_AI: {
    searchBasis: "AI/innovation universe: product adoption, revenue exposure, capex, earnings evidence and catalyst momentum",
    searchBasisTh: "กลุ่ม AI/Innovation: Product Adoption, สัดส่วนรายได้, Capex, หลักฐานจากงบ และ Catalyst Momentum",
    investmentHorizon: "1–3 months around the catalyst/theme-leadership cycle",
    investmentHorizonTh: "1–3 เดือน ตามรอบ Catalyst และ Theme Leadership",
    ...DAILY_WEEKLY_REVIEW,
  },
  INCOME_MOMENTUM: {
    searchBasis: "Income universe: yield, payout coverage, free cash flow, balance-sheet durability and price trend",
    searchBasisTh: "กลุ่ม Income: Yield, ความครอบคลุมเงินปันผล, Free Cash Flow, ความแข็งแรงงบดุล และ Price Trend",
    investmentHorizon: "6–24 months unless distribution quality, thesis or momentum breaks",
    investmentHorizonTh: "6–24 เดือน เว้นแต่คุณภาพปันผล Thesis หรือ Momentum เสีย",
    ...DAILY_WEEKLY_REVIEW,
  },
  WATCHLIST_REUNDERWRITE: {
    searchBasis: "Existing watchlist re-screen: lifecycle, RS vs SPY, 5D/20D volume, 1M/3M return, Fair Value and technical gate",
    searchBasisTh: "คัด Watchlist ใหม่: Lifecycle, RS เทียบ SPY, Volume 5D/20D, ผลตอบแทน 1/3 เดือน, Fair Value และ Technical Gate",
    investmentHorizon: "No position until eligible; after entry, normally 4–16 weeks and event-driven",
    investmentHorizonTh: "ยังไม่ถือจนกว่าจะผ่านเกณฑ์; หลังเข้าโดยทั่วไป 4–16 สัปดาห์และปรับตามเหตุการณ์",
    ...DAILY_WEEKLY_REVIEW,
  },
  PORTFOLIO_MONITOR: {
    searchBasis: "Current holding re-underwrite: momentum lifecycle, thesis, Fair Value gap and portfolio-relative edge",
    searchBasisTh: "ทบทวนหุ้นเดิม: Momentum Lifecycle, Thesis, Fair Value Gap และความได้เปรียบเทียบกับทั้งพอร์ต",
    investmentHorizon: "Hold while momentum, thesis and Fair Value room survive; no fixed expiry",
    investmentHorizonTh: "ถือต่อขณะที่ Momentum, Thesis และ Fair Value Gap ยังอยู่; ไม่มีวันหมดอายุตายตัว",
    ...DAILY_WEEKLY_REVIEW,
  },
  MULTI_ENGINE: {
    searchBasis: "Broad liquid-US universe, then independent factor-engine evidence and common lifecycle/valuation gates",
    searchBasisTh: "เริ่มจากหุ้นสหรัฐฯ สภาพคล่องสูง แล้วใช้ Engine อิสระก่อนผ่าน Lifecycle และ Valuation Gate ร่วมกัน",
    investmentHorizon: "Normally 4–16 weeks; extend to 3–12 months while evidence survives",
    investmentHorizonTh: "โดยทั่วไป 4–16 สัปดาห์; ต่อได้ถึง 3–12 เดือนถ้าหลักฐานยังอยู่",
    ...DAILY_WEEKLY_REVIEW,
  },
};

const ALIASES: Record<string, string> = {
  "MOMENTUM LIFECYCLE": "MOMENTUM_LIFECYCLE",
  "INSTITUTIONAL ACCUMULATION": "INSTITUTIONAL_ACCUMULATION",
  "GROWTH ACCELERATION": "GROWTH_ACCELERATION",
  "QUALITY LEADERSHIP": "QUALITY_LEADERSHIP",
  "VALUATION ROOM-TO-RUN": "VALUATION_ROOM",
  "CATALYST / AI THEME": "CATALYST_AI",
  "INCOME MOMENTUM": "INCOME_MOMENTUM",
  "WATCHLIST RE-UNDERWRITE": "WATCHLIST_REUNDERWRITE",
  "PORTFOLIO MOMENTUM MONITOR": "PORTFOLIO_MONITOR",
};

export function researchMandate(engine: unknown): ResearchMandate {
  const token = String(engine ?? "").trim().toUpperCase();
  return MANDATES[ALIASES[token] ?? token] ?? MANDATES.MULTI_ENGINE;
}
