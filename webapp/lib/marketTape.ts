import { fastScanApprovedUniverse, type FastUniverseRow } from "./research/universeFastScan";

export type MarketTapeSnapshot = {
  score: number;
  label: "RISK ON" | "SELECTIVE" | "DEFENSIVE" | "RISK OFF";
  labelTh: string;
  asOf: string;
  positiveBreadth: number;
  trendBreadth: number;
  sectorCount: number;
  averageSectorScore: number;
  spy1m: number | null;
  spy3m: number | null;
  dataQuality: {
    status: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
    sentimentMeasured: boolean;
    measuredSectors: number;
    requiredSectors: number;
    provider: string | null;
  };
  warnings: string[];
  methodology: string;
};

const SECTOR_ETFS = ["XLK", "XLC", "XLY", "XLF", "XLI", "XLE", "XLV", "XLP", "XLU", "XLRE", "XLB"] as const;
const MIN_MEASURED_SECTORS = 6;

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function scoreSector(row: FastUniverseRow, spy: FastUniverseRow) {
  const relative1m = row.return1m - spy.return1m;
  const relative3m = row.return3m - spy.return3m;
  const acceleration = row.return1w - row.return1m / 4.2;
  const score = clamp(
    50
    + relative1m * 2.2
    + relative3m * 0.8
    + row.return1w * 1.3
    + acceleration * 1.1
    + (row.aboveEma20 ? 7 : -7)
    + (row.aboveEma50 ? 8 : -8),
  );
  return { score, relative1m, above20d: row.aboveEma20, above50d: row.aboveEma50 };
}

/**
 * Lightweight tape engine used by capital controls.
 *
 * V29 uses Yahoo's multi-symbol spark endpoint in one batch instead of making
 * twelve independent chart requests. Missing data is never translated into a
 * bearish tape reading: when SPY or enough sectors cannot be measured, the
 * returned 50/100 is explicitly an UNAVAILABLE neutral placeholder and callers
 * can exclude it from capital decisions via dataQuality.sentimentMeasured.
 */
export async function buildMarketTapeSnapshot(): Promise<MarketTapeSnapshot> {
  const symbols = ["SPY", ...SECTOR_ETFS];
  const warnings: string[] = [];
  let scan: Awaited<ReturnType<typeof fastScanApprovedUniverse>> | null = null;
  try {
    scan = await fastScanApprovedUniverse(symbols);
    warnings.push(...scan.warnings.map(warning => `Batch tape: ${warning}`));
  } catch (error) {
    warnings.push(`Batch tape unavailable: ${error instanceof Error ? error.message : "market request failed"}`);
  }

  const rows = new Map((scan?.rows ?? []).map(row => [row.ticker, row]));
  const spy = rows.get("SPY") ?? null;
  const measured = SECTOR_ETFS.map(etf => rows.get(etf)).filter((row): row is FastUniverseRow => Boolean(row));
  const status = !spy || measured.length === 0 ? "UNAVAILABLE" : measured.length === SECTOR_ETFS.length ? "COMPLETE" : "PARTIAL";

  // Keep the guard explicit so TypeScript and human reviewers can see the
  // authoritative-data requirement directly. Below this point SPY is measured.
  if (!spy || measured.length < MIN_MEASURED_SECTORS) {
    warnings.push(`Market tape has ${measured.length}/${SECTOR_ETFS.length} measured sectors${spy ? "" : " and no SPY benchmark"}; neutral placeholder is shown and must not be interpreted as DEFENSIVE/RISK-OFF evidence.`);
    return {
      score: 50,
      label: "SELECTIVE",
      labelTh: "ข้อมูลตลาดไม่ครบ / รอข้อมูลยืนยัน",
      asOf: scan?.asOf ?? new Date().toISOString(),
      positiveBreadth: 0,
      trendBreadth: 0,
      sectorCount: measured.length,
      averageSectorScore: 50,
      spy1m: spy?.return1m ?? null,
      spy3m: spy?.return3m ?? null,
      dataQuality: {
        status,
        sentimentMeasured: false,
        measuredSectors: measured.length,
        requiredSectors: SECTOR_ETFS.length,
        provider: scan?.provider ?? null,
      },
      warnings,
      methodology: "V29 batch tape: SPY plus the 11 GICS sector ETFs from one multi-symbol price/volume request. Missing tape evidence is DATA UNAVAILABLE, never a bearish signal.",
    };
  }

  const sectors = measured.map(row => scoreSector(row, spy));
  const positiveBreadth = sectors.filter(row => row.relative1m > 0 && row.above50d).length;
  const trendBreadth = sectors.filter(row => row.above20d).length;
  const averageSectorScore = average(sectors.map(row => row.score)) ?? 50;
  const score = Math.round(clamp(
    42
    + spy.return1m * 1.8
    + spy.return3m * 0.65
    + positiveBreadth * 2.2
    + trendBreadth * 1.1
    + (averageSectorScore - 50) * 0.35,
  ));
  const label = score >= 70 ? "RISK ON" : score >= 52 ? "SELECTIVE" : score >= 36 ? "DEFENSIVE" : "RISK OFF";
  const labelTh = label === "RISK ON" ? "รับความเสี่ยง" : label === "SELECTIVE" ? "เลือกกลุ่ม/เลือกหุ้น" : label === "DEFENSIVE" ? "เน้นป้องกัน" : "ลดความเสี่ยง";

  return {
    score,
    label,
    labelTh,
    asOf: scan?.asOf ?? new Date().toISOString(),
    positiveBreadth,
    trendBreadth,
    sectorCount: measured.length,
    averageSectorScore: Math.round(averageSectorScore * 10) / 10,
    spy1m: spy.return1m,
    spy3m: spy.return3m,
    dataQuality: {
      status,
      sentimentMeasured: true,
      measuredSectors: measured.length,
      requiredSectors: SECTOR_ETFS.length,
      provider: scan?.provider ?? null,
    },
    warnings,
    methodology: "V29 batch tape: SPY plus the measured GICS sector ETFs using 1-week acceleration, 1/3-month relative strength and 20/50-day trend. The tape only becomes authoritative when SPY and at least six sectors are measured.",
  };
}
