import { loadThreeIndexUniverse } from "@/lib/research/marketUniverse";
import { fastScanApprovedUniverse, type FastUniverseRow } from "@/lib/research/universeFastScan";

export type SectorLeadershipStatus = "LEADING" | "IMPROVING" | "NEUTRAL" | "FADING" | "LAGGING";

export type SectorLeadershipRow = {
  rank: number;
  sector: string;
  sectorKey: string;
  etf: string;
  score: number;
  status: SectorLeadershipStatus;
  measured: boolean;
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
  dataQuality: {
    status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    sentimentMeasured: boolean;
    measuredSectors: number;
    totalSectors: number;
    provider: string | null;
  };
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

const MIN_MEASURED_SECTORS = 6;
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

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

function scoreSector(row: FastUniverseRow, spy: FastUniverseRow) {
  const relative1m = row.return1m - spy.return1m;
  const relative3m = row.return3m - spy.return3m;
  const acceleration = row.return1w - row.return1m / 4.2;
  const score = clamp(
    50
    + relative1m * 2.2
    + relative3m * .8
    + row.return1w * 1.3
    + acceleration * 1.1
    + (row.aboveEma20 ? 7 : -7)
    + (row.aboveEma50 ? 8 : -8),
  );
  return {
    score: round1(score),
    return1w: row.return1w,
    return1m: row.return1m,
    return3m: row.return3m,
    relative1m,
    relative3m,
    above20d: row.aboveEma20,
    above50d: row.aboveEma50,
    acceleration,
  };
}

function statusFor(score: number, acceleration: number | null): SectorLeadershipStatus {
  if (score >= 68) return "LEADING";
  if (score >= 57 && (acceleration ?? 0) >= 0) return "IMPROVING";
  if (score < 35) return "LAGGING";
  if (score < 47 && (acceleration ?? 0) < 0) return "FADING";
  return "NEUTRAL";
}

function unavailableSector(definition: typeof SECTORS[number]): SectorLeadershipRow {
  return {
    rank: 0,
    sector: definition.sector,
    sectorKey: definition.key,
    etf: definition.etf,
    score: 50,
    status: "NEUTRAL",
    measured: false,
    return1w: null,
    return1m: null,
    return3m: null,
    relative1m: null,
    relative3m: null,
    above20d: null,
    above50d: null,
    acceleration: null,
  };
}

function rotate(values: readonly string[], salt: number) {
  if (!values.length) return [];
  const offset = Math.abs(salt) % values.length;
  return [...values.slice(offset), ...values.slice(0, offset)];
}

export function sectorLeadershipFor(sector: unknown, map: MarketLeadershipMap | null | undefined) {
  const key = normalizeSectorKey(sector);
  const row = map?.sectors.find(item => item.sectorKey === key) ?? null;
  return row?.measured === false ? null : row;
}

export async function buildMarketLeadershipMap(): Promise<MarketLeadershipMap> {
  const warnings: string[] = [];
  const approvedUniversePromise = loadThreeIndexUniverse().catch(error => {
    warnings.push(`Approved index universe unavailable for sector-focus filtering: ${error instanceof Error ? error.message : "request failed"}. Focus ticker list is suppressed rather than widened.`);
    return null;
  });
  const symbols = ["SPY", ...SECTORS.map(row => row.etf)];
  let scan: Awaited<ReturnType<typeof fastScanApprovedUniverse>> | null = null;
  try {
    scan = await fastScanApprovedUniverse(symbols);
    warnings.push(...scan.warnings.map(warning => `Sector batch: ${warning}`));
  } catch (error) {
    warnings.push(`Sector batch unavailable: ${error instanceof Error ? error.message : "market request failed"}`);
  }

  const approvedUniverse = await approvedUniversePromise;
  const approvedTickers = new Set(approvedUniverse?.masterTickers ?? []);
  const rows = new Map((scan?.rows ?? []).map(row => [row.ticker, row]));
  const spy = rows.get("SPY") ?? null;

  const sectors = SECTORS.map(definition => {
    const row = rows.get(definition.etf);
    if (!row || !spy) return unavailableSector(definition);
    const scored = scoreSector(row, spy);
    return {
      rank: 0,
      sector: definition.sector,
      sectorKey: definition.key,
      etf: definition.etf,
      ...scored,
      measured: true,
      status: statusFor(scored.score, scored.acceleration),
    } satisfies SectorLeadershipRow;
  }).sort((left, right) => Number(right.measured) - Number(left.measured) || right.score - left.score)
    .map((row, index) => ({ ...row, rank: index + 1 }));

  const measuredSectors = sectors.filter(row => row.measured);
  const sentimentMeasured = Boolean(spy && measuredSectors.length >= MIN_MEASURED_SECTORS);
  const dataStatus = !spy || measuredSectors.length === 0 ? "UNAVAILABLE" : measuredSectors.length === SECTORS.length ? "COMPLETE" : "PARTIAL";
  const positiveBreadth = measuredSectors.filter(row => (row.relative1m ?? -Infinity) > 0 && row.above50d === true).length;
  const trendBreadth = measuredSectors.filter(row => row.above20d === true).length;
  const averageSectorScore = average(measuredSectors.map(row => row.score)) ?? 50;

  let sentimentScore = 50;
  let sentimentLabel: MarketLeadershipMap["sentimentLabel"] = "SELECTIVE";
  let sentimentLabelTh = "ข้อมูลตลาดไม่ครบ / รอข้อมูลยืนยัน";
  if (sentimentMeasured && spy) {
    sentimentScore = Math.round(clamp(
      42 + spy.return1m * 1.8 + spy.return3m * .65 + positiveBreadth * 2.2 + trendBreadth * 1.1 + (averageSectorScore - 50) * .35,
    ));
    sentimentLabel = sentimentScore >= 70 ? "RISK ON" : sentimentScore >= 52 ? "SELECTIVE" : sentimentScore >= 36 ? "DEFENSIVE" : "RISK OFF";
    sentimentLabelTh = sentimentLabel === "RISK ON" ? "รับความเสี่ยง" : sentimentLabel === "SELECTIVE" ? "เลือกกลุ่ม/เลือกหุ้น" : sentimentLabel === "DEFENSIVE" ? "เน้นป้องกัน" : "ลดความเสี่ยง";
  } else {
    warnings.push(`Sector leadership measured only ${measuredSectors.length}/${SECTORS.length}${spy ? "" : " with SPY unavailable"}; 50/100 is a neutral placeholder, not a market signal.`);
  }

  const focus = sentimentMeasured ? measuredSectors.filter(row => ["LEADING", "IMPROVING"].includes(row.status)).slice(0, 4) : [];
  const avoid = sentimentMeasured ? measuredSectors.filter(row => ["FADING", "LAGGING"].includes(row.status)).slice(-3).reverse() : [];
  const epoch3d = Math.floor(Date.now() / (3 * 86400000));
  const rawFocusTickers = focus.flatMap((row, index) => {
    const definition = SECTORS.find(item => item.key === row.sectorKey);
    return definition ? rotate(definition.tickers, epoch3d + index * 3).slice(0, 6) : [];
  });
  const focusTickers = rawFocusTickers.filter(ticker => approvedTickers.has(ticker));

  const researchStance = !sentimentMeasured
    ? "Market tape data is incomplete. Do not infer a defensive or risk-on stance from missing prices; continue stock-level research but withhold tape-based prioritization until data recovers."
    : sentimentLabel === "RISK ON"
      ? "Press leading sectors, prioritize accumulation and early-markup names, and upsize only while valuation room and breadth confirm."
      : sentimentLabel === "SELECTIVE"
        ? "Concentrate research in the strongest sectors and demand a clear marginal-alpha edge before replacing a current holding."
        : "Raise the entry hurdle, favor resilient leadership, and fund new risk primarily by trimming broken or fully valued positions.";
  const researchStanceTh = !sentimentMeasured
    ? "ข้อมูล Market Tape ยังไม่ครบ ห้ามตีความข้อมูลที่หายเป็น Risk-Off หรือ Risk-On ให้ทำวิจัยรายหุ้นต่อได้ แต่พักการจัดลำดับตาม Sector จนข้อมูลกลับมาครบ"
    : sentimentLabel === "RISK ON"
      ? "เร่งค้นหาใน Sector ผู้นำ เน้นหุ้นช่วงสะสมถึงเริ่มวิ่ง และเพิ่มขนาดเมื่อ Valuation room กับ Breadth ยืนยัน"
      : sentimentLabel === "SELECTIVE"
        ? "กระจุกงานวิจัยใน Sector ที่แข็งแรงที่สุด และต้องมี Marginal Alpha เหนือหุ้นเดิมชัดเจนก่อนสับเปลี่ยน"
        : "ยกระดับเกณฑ์เข้าลงทุน เน้นผู้นำที่ทนทาน และใช้เงินจากหุ้นที่ Thesis แตกหรือใกล้เต็มมูลค่าเป็นหลัก";

  return {
    asOf: scan?.asOf ?? new Date().toISOString(),
    sentimentScore,
    sentimentLabel,
    sentimentLabelTh,
    researchStance,
    researchStanceTh,
    focusSectors: focus.map(row => row.sector),
    avoidSectors: avoid.map(row => row.sector),
    focusTickers: Array.from(new Set(focusTickers)),
    sectors,
    dataQuality: {
      status: dataStatus,
      sentimentMeasured,
      measuredSectors: measuredSectors.length,
      totalSectors: SECTORS.length,
      provider: scan?.provider ?? null,
    },
    evidence: [
      `SPY return: ${spy ? `${round1(spy.return1m)}%` : "n/a"} 1M; ${spy ? `${round1(spy.return3m)}%` : "n/a"} 3M.`,
      `${measuredSectors.length}/${SECTORS.length} sectors measured; ${positiveBreadth} beat SPY over 1M while above their 50-day trend; ${trendBreadth} are above 20-day trend.`,
      `Research focus: ${focus.map(row => `${row.sector} ${row.score}/100`).join(" · ") || (sentimentMeasured ? "no sector clears leadership threshold" : "withheld until market-data coverage recovers")}.`,
      `Automatic ticker focus is restricted to S&P 500 + Nasdaq-100 + Russell 2000 constituents; ${focusTickers.length}/${rawFocusTickers.length} sector-priority names passed that universe gate.`,
    ],
    warnings,
    methodology: "V29 uses a single multi-symbol price/volume batch for SPY plus the 11 GICS sector ETFs. Sector leadership requires measured prices; missing data is shown as unavailable rather than converted to 0% returns, 50/100 sectors or a false defensive signal.",
  };
}
