import { dailyCandles } from "@/lib/marketData";
import type { Candle } from "@/lib/types";

export type SectorLeadershipStatus = "LEADING" | "IMPROVING" | "NEUTRAL" | "FADING" | "LAGGING";

export type SectorLeadershipRow = {
  rank: number;
  sector: string;
  sectorKey: string;
  etf: string;
  score: number;
  status: SectorLeadershipStatus;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  relative1m: number | null;
  relative3m: number | null;
  above20d: boolean | null;
  above50d: boolean | null;
  acceleration: number | null;
};

export type MarketLeadershipMap = {
  asOf: string;
  sentimentScore: number;
  sentimentLabel: "RISK ON" | "SELECTIVE" | "DEFENSIVE" | "RISK OFF";
  sentimentLabelTh: string;
  researchStance: string;
  researchStanceTh: string;
  focusSectors: string[];
  avoidSectors: string[];
  focusTickers: string[];
  sectors: SectorLeadershipRow[];
  evidence: string[];
  warnings: string[];
  methodology: string;
};

const SECTORS = [
  { key: "TECHNOLOGY", sector: "Technology", etf: "XLK", tickers: ["NVDA", "MSFT", "AVGO", "ORCL", "CRM", "NOW", "PLTR", "PANW", "CRWD", "ANET", "AMD", "MU"] },
  { key: "COMMUNICATION", sector: "Communication Services", etf: "XLC", tickers: ["META", "GOOGL", "NFLX", "TMUS", "DIS", "TTD", "SPOT", "RDDT"] },
  { key: "CONSUMER_DISCRETIONARY", sector: "Consumer Discretionary", etf: "XLY", tickers: ["AMZN", "TSLA", "HD", "LOW", "BKNG", "TJX", "NKE", "DASH", "RCL", "GM"] },
  { key: "FINANCIALS", sector: "Financials", etf: "XLF", tickers: ["JPM", "BAC", "GS", "MS", "V", "MA", "AXP", "COF", "SCHW", "KKR"] },
  { key: "INDUSTRIALS", sector: "Industrials", etf: "XLI", tickers: ["GE", "CAT", "ETN", "PH", "UBER", "RTX", "LMT", "DE", "URI", "PWR"] },
  { key: "ENERGY", sector: "Energy", etf: "XLE", tickers: ["XOM", "CVX", "COP", "EOG", "SLB", "OKE", "WMB", "MPC", "VLO", "FANG"] },
  { key: "HEALTHCARE", sector: "Health Care", etf: "XLV", tickers: ["LLY", "UNH", "ABBV", "MRK", "ISRG", "TMO", "BSX", "VRTX", "SYK", "GEHC"] },
  { key: "STAPLES", sector: "Consumer Staples", etf: "XLP", tickers: ["WMT", "COST", "PG", "KO", "PEP", "PM", "CL", "KMB"] },
  { key: "UTILITIES", sector: "Utilities", etf: "XLU", tickers: ["NEE", "SO", "DUK", "CEG", "VST", "AEP", "SRE", "EXC"] },
  { key: "REAL_ESTATE", sector: "Real Estate", etf: "XLRE", tickers: ["PLD", "AMT", "EQIX", "WELL", "DLR", "SPG", "O", "PSA"] },
  { key: "MATERIALS", sector: "Materials", etf: "XLB", tickers: ["LIN", "SHW", "FCX", "NEM", "ECL", "APD", "MLM", "VMC"] },
] as const;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const ret = (candles: Candle[], periods: number) => {
  if (candles.length <= periods) return null;
  const start = candles[candles.length - 1 - periods]?.close;
  const end = candles.at(-1)?.close;
  return start && end ? (end / start - 1) * 100 : null;
};
const sma = (candles: Candle[], periods: number) => {
  const values = candles.slice(-periods).map(candle => candle.close).filter(Number.isFinite);
  return values.length === periods ? values.reduce((sum, value) => sum + value, 0) / periods : null;
};

export function normalizeSectorKey(value: unknown) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return "UNKNOWN";
  if (text.includes("TECH")) return "TECHNOLOGY";
  if (text.includes("COMMUNICATION")) return "COMMUNICATION";
  if (text.includes("CONSUMER CYCLICAL") || text.includes("DISCRETIONARY")) return "CONSUMER_DISCRETIONARY";
  if (text.includes("FINANC")) return "FINANCIALS";
  if (text.includes("INDUSTR")) return "INDUSTRIALS";
  if (text.includes("ENERGY")) return "ENERGY";
  if (text.includes("HEALTH")) return "HEALTHCARE";
  if (text.includes("CONSUMER DEFENSIVE") || text.includes("STAPLE")) return "STAPLES";
  if (text.includes("UTILIT")) return "UTILITIES";
  if (text.includes("REAL ESTATE")) return "REAL_ESTATE";
  if (text.includes("BASIC MATERIAL") || text.includes("MATERIAL")) return "MATERIALS";
  return text.replace(/[^A-Z0-9]+/g, "_");
}

function scoreSector(candles: Candle[], spy: Candle[]) {
  const return1w = ret(candles, 5);
  const return1m = ret(candles, 21);
  const return3m = ret(candles, 63);
  const spy1m = ret(spy, 21);
  const spy3m = ret(spy, 63);
  const relative1m = return1m == null || spy1m == null ? null : return1m - spy1m;
  const relative3m = return3m == null || spy3m == null ? null : return3m - spy3m;
  const close = candles.at(-1)?.close ?? null;
  const average20 = sma(candles, 20);
  const average50 = sma(candles, 50);
  const above20d = close == null || average20 == null ? null : close > average20;
  const above50d = close == null || average50 == null ? null : close > average50;
  const acceleration = return1w == null || return1m == null ? null : return1w - return1m / 4.2;
  const score = clamp(
    50
    + (relative1m ?? 0) * 2.2
    + (relative3m ?? 0) * .8
    + (return1w ?? 0) * 1.3
    + (acceleration ?? 0) * 1.1
    + (above20d === true ? 7 : above20d === false ? -7 : 0)
    + (above50d === true ? 8 : above50d === false ? -8 : 0),
  );
  return { score: round1(score), return1w, return1m, return3m, relative1m, relative3m, above20d, above50d, acceleration };
}

function statusFor(score: number, acceleration: number | null): SectorLeadershipStatus {
  if (score >= 68) return "LEADING";
  if (score >= 57 && (acceleration ?? 0) >= 0) return "IMPROVING";
  if (score < 35) return "LAGGING";
  if (score < 47 && (acceleration ?? 0) < 0) return "FADING";
  return "NEUTRAL";
}

function rotate(values: readonly string[], salt: number) {
  if (!values.length) return [];
  const offset = Math.abs(salt) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

export function sectorLeadershipFor(sector: unknown, map: MarketLeadershipMap | null | undefined) {
  const key = normalizeSectorKey(sector);
  return map?.sectors.find(row => row.sectorKey === key) ?? null;
}

export async function buildMarketLeadershipMap(): Promise<MarketLeadershipMap> {
  const warnings: string[] = [];
  const symbols = ["SPY", ...SECTORS.map(row => row.etf)];
  const entries = await Promise.all(symbols.map(async symbol => {
    const candles = await dailyCandles(symbol, 150).catch(error => {
      warnings.push(`${symbol}: ${error instanceof Error ? error.message : "price history unavailable"}`);
      return [] as Candle[];
    });
    return [symbol, candles] as const;
  }));
  const histories = new Map(entries);
  const spy = histories.get("SPY") ?? [];
  const sectors = SECTORS.map(definition => {
    const scored = scoreSector(histories.get(definition.etf) ?? [], spy);
    return {
      rank: 0,
      sector: definition.sector,
      sectorKey: definition.key,
      etf: definition.etf,
      ...scored,
      status: statusFor(scored.score, scored.acceleration),
    } satisfies SectorLeadershipRow;
  }).sort((left, right) => right.score - left.score).map((row, index) => ({ ...row, rank: index + 1 }));

  const spy1m = ret(spy, 21);
  const spy3m = ret(spy, 63);
  const positiveBreadth = sectors.filter(row => (row.relative1m ?? -Infinity) > 0 && row.above50d === true).length;
  const trendBreadth = sectors.filter(row => row.above20d === true).length;
  const averageSectorScore = average(sectors.map(row => row.score)) ?? 50;
  const sentimentScore = Math.round(clamp(
    42 + (spy1m ?? 0) * 1.8 + (spy3m ?? 0) * .65 + positiveBreadth * 2.2 + trendBreadth * 1.1 + (averageSectorScore - 50) * .35,
  ));
  const sentimentLabel = sentimentScore >= 70 ? "RISK ON" : sentimentScore >= 52 ? "SELECTIVE" : sentimentScore >= 36 ? "DEFENSIVE" : "RISK OFF";
  const sentimentLabelTh = sentimentLabel === "RISK ON" ? "รับความเสี่ยง" : sentimentLabel === "SELECTIVE" ? "เลือกกลุ่ม/เลือกหุ้น" : sentimentLabel === "DEFENSIVE" ? "เน้นป้องกัน" : "ลดความเสี่ยง";
  const focus = sectors.filter(row => ["LEADING", "IMPROVING"].includes(row.status)).slice(0, 4);
  const avoid = sectors.filter(row => ["FADING", "LAGGING"].includes(row.status)).slice(-3).reverse();
  const epoch3d = Math.floor(Date.now() / (3 * 86400000));
  const focusTickers = focus.flatMap((row, index) => {
    const definition = SECTORS.find(item => item.key === row.sectorKey);
    return definition ? rotate(definition.tickers, epoch3d + index * 3).slice(0, 6) : [];
  });
  const researchStance = sentimentLabel === "RISK ON"
    ? "Press leading sectors, prioritize accumulation and early-markup names, and upsize only while valuation room and breadth confirm."
    : sentimentLabel === "SELECTIVE"
      ? "Concentrate research in the strongest sectors and demand a clear marginal-alpha edge before replacing a current holding."
      : "Raise the entry hurdle, favor resilient leadership, and fund new risk primarily by trimming broken or fully valued positions.";
  const researchStanceTh = sentimentLabel === "RISK ON"
    ? "เร่งค้นหาใน Sector ผู้นำ เน้นหุ้นช่วงสะสมถึงเริ่มวิ่ง และเพิ่มขนาดเมื่อ Valuation room กับ Breadth ยืนยัน"
    : sentimentLabel === "SELECTIVE"
      ? "กระจุกงานวิจัยใน Sector ที่แข็งแรงที่สุด และต้องมี Marginal Alpha เหนือหุ้นเดิมชัดเจนก่อนสับเปลี่ยน"
      : "ยกระดับเกณฑ์เข้าลงทุน เน้นผู้นำที่ทนทาน และใช้เงินจากหุ้นที่ Thesis แตกหรือใกล้เต็มมูลค่าเป็นหลัก";

  return {
    asOf: new Date().toISOString(), sentimentScore, sentimentLabel, sentimentLabelTh, researchStance, researchStanceTh,
    focusSectors: focus.map(row => row.sector), avoidSectors: avoid.map(row => row.sector),
    focusTickers: Array.from(new Set(focusTickers)), sectors,
    evidence: [
      `SPY return: ${spy1m == null ? "n/a" : `${round1(spy1m)}%`} 1M; ${spy3m == null ? "n/a" : `${round1(spy3m)}%`} 3M.`,
      `${positiveBreadth}/${sectors.length} sectors beat SPY over 1M while above their 50-day average; ${trendBreadth}/${sectors.length} are above 20-day trend.`,
      `Research focus: ${focus.map(row => `${row.sector} ${row.score}/100`).join(" · ") || "no sector clears leadership threshold"}.`,
    ],
    warnings,
    methodology: "Price-based tape sentiment and sector leadership are measured from SPY plus the 11 GICS sector ETFs using 1-week acceleration, 1/3-month relative strength and 20/50-day trend. This determines research priority; it is not a standalone buy signal.",
  };
}
