import type { TradingViewIntelligenceEventRow } from "@/lib/integrations/tradingViewIntelligenceStore";

export type EarningsIntelligenceRead = {
  version: "30.0";
  source: "TRADINGVIEW";
  quality: "MEASURED" | "PARTIAL" | "UNAVAILABLE";
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNAVAILABLE";
  score: number | null;
  confidence: number;
  epsSurprisePct: number | null;
  revenueSurprisePct: number | null;
  nextEarningsAt: string | null;
  fiscalPeriod: string | null;
  guidanceBias: "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNAVAILABLE";
  probabilityAdjustmentPct: number;
  providerAiSummary: string | null;
  sentinelView: string;
  evidence: string[];
  risks: string[];
  aiSummaryAffectsScore: false;
  automaticTrading: false;
};

const clamp = (value: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, value));
const finite = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const round1 = (value: number) => Math.round(value * 10) / 10;

function guidanceBias(guidance: string | null | undefined): EarningsIntelligenceRead["guidanceBias"] {
  const normalized = String(guidance ?? "").trim().toLowerCase();
  if (!normalized) return "UNAVAILABLE";
  const positive = ["raise", "raised", "raises", "above", "strong", "accelerat", "improv", "higher", "beat", "growth"].some(token => normalized.includes(token));
  const negative = ["cut", "lower", "below", "weak", "slow", "declin", "pressure", "miss", "reduce"].some(token => normalized.includes(token));
  if (positive && !negative) return "POSITIVE";
  if (negative && !positive) return "NEGATIVE";
  return "NEUTRAL";
}

export function assessTradingViewEarnings(event: TradingViewIntelligenceEventRow | null | undefined): EarningsIntelligenceRead {
  const eps = finite(event?.eps_surprise_pct);
  const revenue = finite(event?.revenue_surprise_pct);
  const guidance = guidanceBias(event?.guidance);
  const measuredCount = [eps, revenue].filter(value => value != null).length;
  const hasMeasured = measuredCount > 0;
  const hasSupporting = guidance !== "UNAVAILABLE" || Boolean(event?.next_earnings_at) || Boolean(event?.fiscal_period);

  if (!event || (!hasMeasured && !hasSupporting)) {
    return {
      version: "30.0",
      source: "TRADINGVIEW",
      quality: "UNAVAILABLE",
      sentiment: "UNAVAILABLE",
      score: null,
      confidence: 0,
      epsSurprisePct: eps,
      revenueSurprisePct: revenue,
      nextEarningsAt: event?.next_earnings_at ?? null,
      fiscalPeriod: event?.fiscal_period ?? null,
      guidanceBias: guidance,
      probabilityAdjustmentPct: 0,
      providerAiSummary: event?.ai_summary ?? null,
      sentinelView: "No measured TradingView earnings surprise was available; Sentinel does not infer a negative or positive catalyst from missing data.",
      evidence: [],
      risks: [],
      aiSummaryAffectsScore: false,
      automaticTrading: false,
    };
  }

  let score = 50;
  if (eps != null) score += clamp(eps * 1.5, -18, 18);
  if (revenue != null) score += clamp(revenue * 1.2, -15, 15);
  if (guidance === "POSITIVE") score += 8;
  if (guidance === "NEGATIVE") score -= 8;
  score = Math.round(clamp(score));

  let confidence = 35 + measuredCount * 22;
  if (guidance !== "UNAVAILABLE") confidence += 8;
  if (event?.fiscal_period) confidence += 4;
  confidence = Math.round(clamp(confidence, 0, 92));

  const sentiment: EarningsIntelligenceRead["sentiment"] = score >= 60 ? "POSITIVE" : score <= 40 ? "NEGATIVE" : "NEUTRAL";
  const quality: EarningsIntelligenceRead["quality"] = measuredCount >= 2 ? "MEASURED" : "PARTIAL";
  const probabilityAdjustmentPct = Math.round(clamp((score - 50) * .2, -8, 8));
  const evidence = [
    ...(eps == null ? [] : [`EPS surprise ${eps >= 0 ? "+" : ""}${round1(eps)}%`]),
    ...(revenue == null ? [] : [`Revenue surprise ${revenue >= 0 ? "+" : ""}${round1(revenue)}%`]),
    ...(guidance === "UNAVAILABLE" ? [] : [`Guidance bias ${guidance}`]),
    ...(event?.fiscal_period ? [`Fiscal period ${event.fiscal_period}`] : []),
  ];
  const risks = [
    ...(event?.next_earnings_at ? [`Next earnings event ${event.next_earnings_at}`] : []),
    ...(sentiment === "NEGATIVE" ? ["Measured earnings evidence is negative; re-underwrite thesis and forward estimates before adding capital."] : []),
  ];
  const sentinelView = sentiment === "POSITIVE"
    ? `Measured earnings evidence supports the catalyst layer (${score}/100), but price structure, valuation and funding still govern any investment action.`
    : sentiment === "NEGATIVE"
      ? `Measured earnings evidence weakens the catalyst layer (${score}/100); Sentinel requires thesis and valuation re-underwriting before new capital.`
      : `Measured earnings evidence is mixed/neutral (${score}/100); do not use the earnings event alone to change portfolio action.`;

  return {
    version: "30.0",
    source: "TRADINGVIEW",
    quality,
    sentiment,
    score,
    confidence,
    epsSurprisePct: eps,
    revenueSurprisePct: revenue,
    nextEarningsAt: event?.next_earnings_at ?? null,
    fiscalPeriod: event?.fiscal_period ?? null,
    guidanceBias: guidance,
    probabilityAdjustmentPct,
    providerAiSummary: event?.ai_summary ?? null,
    sentinelView,
    evidence,
    risks,
    aiSummaryAffectsScore: false,
    automaticTrading: false,
  };
}
