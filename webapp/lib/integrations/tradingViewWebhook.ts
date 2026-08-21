export type TradingViewEarningsPayload = {
  epsActual?: number | string;
  epsEstimate?: number | string;
  epsSurprisePct?: number | string;
  revenueActual?: number | string;
  revenueEstimate?: number | string;
  revenueSurprisePct?: number | string;
  nextEarningsAt?: string | number;
  fiscalPeriod?: string;
  guidance?: string;
  aiSummary?: string;
  [key: string]: unknown;
};

export type TradingViewAlertPayload = {
  source?: string;
  eventType?: string;
  event_type?: string;
  symbol?: string;
  ticker?: string;
  exchange?: string;
  timeframe?: string;
  interval?: string;
  price?: number | string;
  close?: number | string;
  signal?: string;
  action?: string;
  strategy?: string;
  timestamp?: string | number;
  secret?: string;
  earnings?: TradingViewEarningsPayload;
  financials?: Record<string, unknown>;
  epsActual?: number | string;
  epsEstimate?: number | string;
  epsSurprisePct?: number | string;
  revenueActual?: number | string;
  revenueEstimate?: number | string;
  revenueSurprisePct?: number | string;
  nextEarningsAt?: string | number;
  fiscalPeriod?: string;
  guidance?: string;
  aiSummary?: string;
  [key: string]: unknown;
};

export type TradingViewEventType = "TECHNICAL" | "EARNINGS" | "FINANCIAL" | "EARNINGS_FINANCIAL";

export type NormalizedTradingViewAlert = {
  ticker: string;
  timeframe: string;
  signal: string;
  price: number | null;
  strategy: string;
  source: "TRADINGVIEW";
  eventType: TradingViewEventType;
  timestamp: string | null;
  earnings: {
    epsActual: number | null;
    epsEstimate: number | null;
    epsSurprisePct: number | null;
    revenueActual: number | null;
    revenueEstimate: number | null;
    revenueSurprisePct: number | null;
    nextEarningsAt: string | null;
    fiscalPeriod: string | null;
    guidance: string | null;
    aiSummary: string | null;
  };
  financials: Record<string, unknown>;
  raw: Record<string, unknown>;
};

const finite = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
};

const isoDate = (value: unknown): string | null => {
  if (value == null || value === "") return null;
  const numeric = finite(value);
  const date = numeric != null && typeof value !== "string"
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const surprisePct = (actual: number | null, estimate: number | null, supplied: unknown): number | null => {
  const direct = finite(supplied);
  if (direct != null) return direct;
  if (actual == null || estimate == null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
};

function sanitizeRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const lowered = key.toLowerCase();
    if (lowered.includes("secret") || lowered.includes("password") || lowered.includes("token")) continue;
    out[key] = sanitizeRaw(nested);
  }
  return out;
}

export function normalizeTradingViewAlert(payload: TradingViewAlertPayload): NormalizedTradingViewAlert {
  const nested = payload.earnings ?? {};
  const ticker = String(payload.ticker ?? payload.symbol ?? "").trim().toUpperCase().replace(/^.*:/, "");
  const timeframe = String(payload.timeframe ?? payload.interval ?? "").trim().toUpperCase();
  const signal = String(payload.signal ?? payload.action ?? "ALERT").trim().toUpperCase();
  const price = finite(payload.price ?? payload.close);

  const epsActual = finite(nested.epsActual ?? payload.epsActual);
  const epsEstimate = finite(nested.epsEstimate ?? payload.epsEstimate);
  const revenueActual = finite(nested.revenueActual ?? payload.revenueActual);
  const revenueEstimate = finite(nested.revenueEstimate ?? payload.revenueEstimate);
  const epsSurprisePct = surprisePct(epsActual, epsEstimate, nested.epsSurprisePct ?? payload.epsSurprisePct);
  const revenueSurprisePct = surprisePct(revenueActual, revenueEstimate, nested.revenueSurprisePct ?? payload.revenueSurprisePct);
  const nextEarningsAt = isoDate(nested.nextEarningsAt ?? payload.nextEarningsAt);
  const fiscalPeriod = text(nested.fiscalPeriod ?? payload.fiscalPeriod);
  const guidance = text(nested.guidance ?? payload.guidance);
  const aiSummary = text(nested.aiSummary ?? payload.aiSummary);
  const financials = payload.financials && typeof payload.financials === "object" && !Array.isArray(payload.financials)
    ? payload.financials
    : {};

  const hasEarnings = [epsActual, epsEstimate, epsSurprisePct, revenueActual, revenueEstimate, revenueSurprisePct, nextEarningsAt, fiscalPeriod, guidance, aiSummary]
    .some(value => value != null);
  const hasFinancials = Object.keys(financials).length > 0;
  const requested = String(payload.eventType ?? payload.event_type ?? "").trim().toUpperCase();
  const eventType: TradingViewEventType = requested === "EARNINGS_FINANCIAL"
    ? "EARNINGS_FINANCIAL"
    : requested === "EARNINGS"
      ? "EARNINGS"
      : requested === "FINANCIAL"
        ? "FINANCIAL"
        : hasEarnings && hasFinancials
          ? "EARNINGS_FINANCIAL"
          : hasEarnings
            ? "EARNINGS"
            : hasFinancials
              ? "FINANCIAL"
              : "TECHNICAL";

  return {
    ticker,
    timeframe,
    signal,
    price,
    strategy: String(payload.strategy ?? "TRADINGVIEW").trim(),
    source: "TRADINGVIEW",
    eventType,
    timestamp: isoDate(payload.timestamp),
    earnings: {
      epsActual,
      epsEstimate,
      epsSurprisePct,
      revenueActual,
      revenueEstimate,
      revenueSurprisePct,
      nextEarningsAt,
      fiscalPeriod,
      guidance,
      aiSummary,
    },
    financials,
    raw: sanitizeRaw(payload) as Record<string, unknown>,
  };
}
