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
