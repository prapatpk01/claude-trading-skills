import type { Candle } from "@/lib/types";
import type { AnnualEps } from "@/lib/sec";
import type { DividendEvent } from "@/lib/dividends";
import { assessValuation } from "@/lib/team/positionValuation";
import { fetchYahooAnalystConsensus } from "@/lib/yahooAnalystConsensus";
import { getSupabase, getSupabaseAdmin } from "@/lib/supabase";

export type ThomasValuationStatus = "COMPLETE" | "INCOMPLETE";
export type ThomasModelRoute = "OPERATING_COMPANY" | "BANK_FINANCIAL" | "REIT" | "ETF_LOOK_THROUGH" | "CASH_EQUIVALENT";

export type ThomasValuationSnapshot = {
  ticker: string;
  status: ThomasValuationStatus;
  modelRoute: ThomasModelRoute;
  source: string;
  currentPrice: number;
  fairValue: number | null;
  bearValue: number | null;
  bullValue: number | null;
  valuationGapPct: number | null;
  verdict: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  anchors: Array<{ method: string; fairValue: number; weight: number; detail: string }>;
  note: string;
  warnings: string[];
  asOf: string;
  expiresAt: string;
};

const ETF = new Set(["SCHD", "VIG", "DGRO", "FDVV", "HDV", "JEPI", "JEPQ", "VOO", "SPY", "QQQ", "IWM", "AVDV", "VYMI", "GARP", "SPMO", "GPIQ", "QDVO", "GLD", "GLDM", "BINC"]);
const CASH = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA", "TBIL", "SHY", "MINT"]);
const BANKS = new Set(["JPM", "BAC", "C", "WFC", "GS", "MS", "USB", "HSBC", "ITUB", "SCHW", "BK", "TROW"]);
const REITS = new Set(["O", "NNN", "OHI", "PLD", "AMT", "EQIX", "WELL", "SPG", "VICI"]);
const memory = new Map<string, ThomasValuationSnapshot>();

const round2 = (value: number) => Math.round(value * 100) / 100;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modelRoute(ticker: string): ThomasModelRoute {
  if (CASH.has(ticker)) return "CASH_EQUIVALENT";
  if (ETF.has(ticker)) return "ETF_LOOK_THROUGH";
  if (BANKS.has(ticker)) return "BANK_FINANCIAL";
  if (REITS.has(ticker)) return "REIT";
  return "OPERATING_COMPANY";
}

function verdictForGap(gapPct: number, bandPct = 10) {
  if (gapPct >= bandPct * 2.5) return "DEEP VALUE";
  if (gapPct >= bandPct) return "UNDERVALUED";
  if (gapPct > -bandPct) return "FAIR";
  if (gapPct > -bandPct * 2.5) return "OVERVALUED";
  return "STRETCHED";
}

function expiry(asOf: Date, days: number) {
  return new Date(asOf.getTime() + days * 86400000).toISOString();
}

/**
 * ETF fallback when issuer NAV/holdings and a usable distribution history are
 * unavailable from the live feeds. This is deliberately labelled a
 * price-history proxy rather than fundamental NAV: it combines a log trend
 * endpoint with 3- and 6-month median prices, then widens Bear/Bull by realised
 * volatility. It gives the committee a transparent valuation gap without
 * pretending an ETF has company EPS or analyst coverage.
 */
function etfHistorySnapshot(input: {
  ticker: string;
  candles: Candle[];
  price: number;
  asOf: Date;
  ttlDays: number;
}): ThomasValuationSnapshot | null {
  const window = input.candles
    .filter(candle => Number.isFinite(candle.close) && candle.close > 0)
    .slice(-252);
  if (window.length < 120 || !(input.price > 0)) return null;

  const closes = window.map(candle => candle.close);
  const median63 = median(closes.slice(-63));
  const median126 = median(closes.slice(-126));
  if (!(median63 && median126)) return null;

  const logs = closes.map(Math.log);
  const n = logs.length;
  const sx = n * (n - 1) / 2;
  const sxx = n * (n - 1) * (2 * n - 1) / 6;
  const sy = logs.reduce((sum, value) => sum + value, 0);
  const sxy = logs.reduce((sum, value, index) => sum + value * index, 0);
  const denominator = n * sxx - sx * sx;
  if (!denominator) return null;
  const slope = (n * sxy - sx * sy) / denominator;
  const intercept = (sy - slope * sx) / n;
  const trendValue = Math.exp(intercept + slope * (n - 1));
  if (!(trendValue > 0) || !Number.isFinite(trendValue)) return null;

  const meanLog = sy / n;
  let totalVariation = 0;
  let residualVariation = 0;
  for (let index = 0; index < n; index += 1) {
    const fit = intercept + slope * index;
    totalVariation += (logs[index] - meanLog) ** 2;
    residualVariation += (logs[index] - fit) ** 2;
  }
  const r2 = totalVariation > 0 ? clamp(1 - residualVariation / totalVariation, 0, 1) : 0;

  // The regression carries more weight when the ETF has a coherent trend;
  // medians carry more weight in a range. Neither anchor is spot itself.
  const trendWeight = 0.4 + r2 * 0.35;
  const median63Weight = 0.4 - r2 * 0.2;
  const median126Weight = 1 - trendWeight - median63Weight;
  const rawFair = trendValue * trendWeight + median63 * median63Weight + median126 * median126Weight;
  const ratio = rawFair / input.price;
  if (!Number.isFinite(rawFair) || ratio < 0.6 || ratio > 1.6) return null;

  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  const meanReturn = returns.reduce((sum, value) => sum + value, 0) / Math.max(1, returns.length);
  const variance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(1, returns.length - 1);
  const realisedVolPct = Math.sqrt(variance) * Math.sqrt(252) * 100;
  const scenarioBandPct = clamp(realisedVolPct * 0.75, 8, 20);
  const fair = round2(rawFair);
  const gap = round2((fair / input.price - 1) * 100);

  return {
    ticker: input.ticker,
    status: "COMPLETE",
    modelRoute: "ETF_LOOK_THROUGH",
    source: "THOMAS_ETF_PRICE_HISTORY_PROXY",
    currentPrice: input.price,
    fairValue: fair,
    bearValue: round2(fair * (1 - scenarioBandPct / 100)),
    bullValue: round2(fair * (1 + scenarioBandPct / 100)),
    valuationGapPct: gap,
    verdict: verdictForGap(gap, Math.max(8, scenarioBandPct * 0.6)),
    confidence: "LOW",
    anchors: [
      {
        method: "ETF price-history proxy",
        fairValue: fair,
        weight: 1,
        detail: `${n} sessions; log-trend $${round2(trendValue).toFixed(2)} (R² ${r2.toFixed(2)}), 3M median $${round2(median63).toFixed(2)}, 6M median $${round2(median126).toFixed(2)}, realised volatility ${realisedVolPct.toFixed(1)}%.`,
      },
    ],
    note: `Issuer NAV/holdings and distribution-yield anchors were unavailable. Thomas therefore uses a low-confidence ETF price-history proxy; Bear/Base/Bull are volatility-scaled and must not be presented as fundamental NAV.`,
    warnings: ["ETF fair value is a price-history proxy until issuer NAV/holdings or a usable distribution history is available."],
    asOf: input.asOf.toISOString(),
    expiresAt: expiry(input.asOf, Math.min(input.ttlDays, 7)),
  };
}

function valid(snapshot: ThomasValuationSnapshot | null | undefined, now = new Date()) {
  return Boolean(snapshot && snapshot.status === "COMPLETE" && new Date(snapshot.expiresAt).getTime() > now.getTime());
}

function fromLedger(row: any): ThomasValuationSnapshot {
  return {
    ticker: String(row.ticker), status: row.status, modelRoute: row.model_route, source: row.source,
    currentPrice: Number(row.current_price), fairValue: row.fair_value == null ? null : Number(row.fair_value),
    bearValue: row.bear_value == null ? null : Number(row.bear_value), bullValue: row.bull_value == null ? null : Number(row.bull_value),
    valuationGapPct: row.valuation_gap_pct == null ? null : Number(row.valuation_gap_pct), verdict: row.verdict,
    confidence: row.confidence, anchors: Array.isArray(row.anchors) ? row.anchors : [], note: String(row.note ?? ""),
    warnings: Array.isArray(row.warnings) ? row.warnings.map(String) : [], asOf: String(row.as_of), expiresAt: String(row.expires_at),
  };
}

export async function loadThomasValuationLedger(tickers: string[]) {
  const output = new Map<string, ThomasValuationSnapshot>();
  for (const ticker of tickers) {
    const hit = memory.get(ticker);
    if (valid(hit)) output.set(ticker, hit!);
  }
  const missing = tickers.filter(ticker => !output.has(ticker));
  const sb = getSupabase();
  if (!sb || !missing.length) return output;
  const { data, error } = await sb.from("thomas_valuation_ledger").select("*").in("ticker", missing).gt("expires_at", new Date().toISOString());
  if (error) return output; // migration may not be installed yet; live computation remains available.
  for (const row of data ?? []) {
    const snapshot = fromLedger(row);
    if (!valid(snapshot)) continue;
    output.set(snapshot.ticker, snapshot);
    memory.set(snapshot.ticker, snapshot);
  }
  return output;
}

export async function saveThomasValuationLedger(rows: ThomasValuationSnapshot[]) {
  for (const row of rows) memory.set(row.ticker, row);
  const admin = getSupabaseAdmin();
  if (!admin || !rows.length) return { persistence: "memory" as const };
  const payload = rows.map(row => ({
    ticker: row.ticker, status: row.status, model_route: row.modelRoute, source: row.source,
    current_price: row.currentPrice, fair_value: row.fairValue, bear_value: row.bearValue, bull_value: row.bullValue,
    valuation_gap_pct: row.valuationGapPct, verdict: row.verdict, confidence: row.confidence,
    anchors: row.anchors, note: row.note, warnings: row.warnings, as_of: row.asOf, expires_at: row.expiresAt,
  }));
  const { error } = await admin.from("thomas_valuation_ledger").upsert(payload, { onConflict: "ticker" });
  return { persistence: error ? "memory" as const : "supabase" as const };
}

export async function resolveThomasValuation(input: {
  ticker: string;
  candles: Candle[];
  price: number;
  annualEps?: AnnualEps[];
  epsTTM?: number | null;
  dividends?: DividendEvent[];
  asOf?: Date;
  ttlDays?: number;
}): Promise<ThomasValuationSnapshot> {
  const ticker = input.ticker.trim().toUpperCase();
  const asOf = input.asOf ?? new Date();
  const route = modelRoute(ticker);
  const primary = assessValuation({
    candles: input.candles,
    price: input.price,
    annualEps: input.annualEps ?? [],
    epsTTM: input.epsTTM ?? null,
    dividends: input.dividends ?? [],
  });
  const warnings: string[] = [];

  if (primary.fairValue != null && primary.fairValue > 0 && primary.verdict) {
    const fair = round2(primary.fairValue);
    const band = primary.fairBandPct / 100;
    const gap = round2((fair / input.price - 1) * 100);
    return {
      ticker, status: "COMPLETE", modelRoute: primary.cashLike ? "CASH_EQUIVALENT" : route,
      source: primary.cashLike ? "THOMAS_CASH_EQUIVALENT" : primary.anchors.some(anchor => anchor.method === "Discounted cash flow") ? "THOMAS_DCF_MULTI_ANCHOR" : "THOMAS_MULTI_ANCHOR",
      currentPrice: input.price, fairValue: fair, bearValue: round2(fair * (1 - band)), bullValue: round2(fair * (1 + band)),
      valuationGapPct: gap, verdict: primary.verdict, confidence: primary.confidence.toUpperCase() as "HIGH" | "MEDIUM" | "LOW",
      anchors: primary.anchors, note: primary.note, warnings, asOf: asOf.toISOString(), expiresAt: expiry(asOf, input.ttlDays ?? 7),
    };
  }

  if (route === "ETF_LOOK_THROUGH") {
    const fallback = etfHistorySnapshot({
      ticker,
      candles: input.candles,
      price: input.price,
      asOf,
      ttlDays: input.ttlDays ?? 7,
    });
    if (fallback) return fallback;
    warnings.push("ETF price-history proxy unavailable because fewer than 120 valid sessions or an implausible anchor was returned.");
  }

  // Analyst consensus is a governed secondary anchor, never a target derived
  // from spot.  It is requested only after Thomas's filing/yield/trend stack
  // cannot establish value, keeping the normal path fast.
  const consensus = await Promise.race([
    fetchYahooAnalystConsensus(ticker),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 6500)),
  ]).catch(() => null);
  if (consensus?.targetMeanPrice && consensus.targetMeanPrice > 0) {
    const fair = round2(consensus.targetMeanPrice);
    const ratio = fair / input.price;
    if (ratio >= .4 && ratio <= 2.5) {
      const low = consensus.targetLowPrice && consensus.targetLowPrice > 0 ? consensus.targetLowPrice : fair * .85;
      const high = consensus.targetHighPrice && consensus.targetHighPrice > 0 ? consensus.targetHighPrice : fair * 1.15;
      const gap = round2((fair / input.price - 1) * 100);
      const count = consensus.analystCount ?? 0;
      const confidence = count >= 15 ? "HIGH" : count >= 5 ? "MEDIUM" : "LOW";
      return {
        ticker, status: "COMPLETE", modelRoute: route, source: "YAHOO_ANALYST_CONSENSUS",
        currentPrice: input.price, fairValue: fair, bearValue: round2(Math.min(low, high)), bullValue: round2(Math.max(low, high)),
        valuationGapPct: gap, verdict: verdictForGap(gap), confidence,
        anchors: [{ method: "Analyst consensus", fairValue: fair, weight: 1, detail: `${count || "n/a"} analyst opinion(s); transport ${consensus.transport ?? "Yahoo Finance"}.` }],
        note: `Thomas secondary consensus range after filing/yield/trend anchors were insufficient. Bear $${round2(Math.min(low, high)).toFixed(2)} · Base $${fair.toFixed(2)} · Bull $${round2(Math.max(low, high)).toFixed(2)}.`,
        warnings, asOf: asOf.toISOString(), expiresAt: expiry(asOf, Math.min(input.ttlDays ?? 7, 7)),
      };
    }
    warnings.push(`Analyst target ${ratio.toFixed(2)}x spot failed Thomas's 0.4x–2.5x basis rail.`);
  }

  return {
    ticker, status: "INCOMPLETE", modelRoute: route, source: "UNAVAILABLE", currentPrice: input.price,
    fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, verdict: null, confidence: "LOW", anchors: [],
    note: `${primary.note} Filing/yield/trend and analyst-consensus paths were attempted. Thomas keeps the line in research rather than manufacturing Fair Value from spot.`,
    warnings, asOf: asOf.toISOString(), expiresAt: expiry(asOf, 1),
  };
}
