export type TradingViewAlertPayload = {
  source?: string;
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
  [key: string]: unknown;
};

export function normalizeTradingViewAlert(payload: TradingViewAlertPayload) {
  const ticker = String(payload.ticker ?? payload.symbol ?? "").trim().toUpperCase();
  const timeframe = String(payload.timeframe ?? payload.interval ?? "").trim().toUpperCase();
  const signal = String(payload.signal ?? payload.action ?? "ALERT").trim().toUpperCase();
  const rawPrice = payload.price ?? payload.close;
  const price = Number(rawPrice);
  return {
    ticker,
    timeframe,
    signal,
    price: Number.isFinite(price) ? price : null,
    strategy: String(payload.strategy ?? "TRADINGVIEW").trim(),
    timestamp: payload.timestamp ?? null,
    raw: payload,
  };
}
