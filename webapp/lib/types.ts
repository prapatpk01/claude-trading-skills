// Shared types across the app

export interface Quote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  volume?: number;
  asOf: string;
}

export interface Overview {
  symbol: string;
  name: string;
  description: string;
  sector: string;
  industry: string;
  currency: string;
  country: string;
  marketCap: number | null;
  peRatio: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  eps: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  operatingMargin: number | null;
  roe: number | null;
  roa: number | null;
  revenueTTM: number | null;
  grossProfitTTM: number | null;
  ebitda: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  sma50: number | null;
  sma200: number | null;
  analystTargetPrice: number | null;
  sharesOutstanding: number | null;
}

export interface FinancialRow {
  fiscalDate: string;
  [key: string]: number | string;
}

export interface Financials {
  income: FinancialRow[]; // annual, most-recent first
  balance: FinancialRow[];
  cashflow: FinancialRow[];
}

export interface EarningsRow {
  fiscalDate: string;
  reportedDate?: string;
  reportedEPS: number | null;
  estimatedEPS: number | null;
  surprise: number | null;
  surprisePercent: number | null;
}

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuarterlyRow {
  end: string;
  revenue: number | null;
  netIncome: number | null;
  eps: number | null;
  netMargin: number | null;
  /** Year-over-year revenue growth vs the same quarter a year earlier. */
  revenueYoY?: number | null;
}

export interface MarketData {
  ticker: string;
  quote: Quote | null;
  overview: Overview | null;
  financials: Financials;
  earnings: EarningsRow[];
  /** Last 8 reported quarters (SEC), newest first. */
  quarters: QuarterlyRow[];
  /**
   * The trailing-twelve-month income statement, summed from the last four filed
   * quarters. Annual statements can be nearly a year stale; this is what "latest"
   * actually means, and `through` says which quarter it runs to.
   */
  ttm: {
    through: string | null;
    revenue: number | null;
    grossProfit: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    /** Quarters that were summed — fewer than four is not a full year. */
    quartersUsed: number;
  } | null;
  /** Annual diluted EPS history, newest first. */
  annualEps: { year: number; end: string; eps: number }[];
  candles: Candle[]; // daily, oldest → newest
  benchmarkCandles: Candle[]; // SPY daily, oldest → newest
  sources: string[];
  warnings: string[];
}

// ── Derived analytics ────────────────────────────────────────────────

export interface TechnicalSignals {
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  ema10: number | null;
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  atr14: number | null;
  rs30: number | null; // relative strength vs benchmark over 30d (ratio, 1.0 = inline)
  vol5: number | null;
  vol20: number | null;
  volRatio: number | null; // vol5 / vol20
  upDownVolRatio: number | null;
  return1m: number | null;
  return3m: number | null;
  return6m: number | null;
  aboveEma10: boolean;
  aboveEma20: boolean;
  maFanning: boolean; // ema10 > ema20 > sma50
}

export interface MomentumScore {
  total: number; // 0-100
  momentumRS: number; // /40
  volume: number; // /25
  structure: number; // /20
  catalyst: number; // /15
  breakdown: string[];
}

export interface SwingSetup {
  ticker: string;
  name: string;
  setupType: string;
  momentumScore: number;
  expectedReturnPct: number;
  winProbability: number;
  entryLow: number;
  entryHigh: number;
  target: number;
  stop: number;
  riskReward: number;
  momentumNote: string;
  volumeNote: string;
  catalystNote: string;
  thesis: string;
  price: number;
}

export interface DcfResult {
  wacc: number;
  terminalGrowth: number;
  /** Share of enterprise value contributed by the terminal value, percent. */
  terminalSharePct: number;
  /** False when the terminal value dominates — treat the output as indicative. */
  reliable: boolean;
  fairValue: number;
  upsidePct: number;
  projectedFcf: number[];
  pvFcf: number[];
  terminalValue: number;
  pvTerminal: number;
  enterpriseValue: number;
  equityValue: number;
}
