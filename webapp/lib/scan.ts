import { dailyCandles } from "./marketData";
import { computeTechnicals, computeMomentumScore, buildSwingSetup } from "./analysis";
import { ema, pctReturn, sma } from "./indicators";
import type { MarketData, SwingSetup, Candle } from "./types";

// A pragmatic default liquid, high-beta momentum universe.
export const DEFAULT_UNIVERSE = [
  "NVDA", "AMD", "AVGO", "MSFT", "META", "AMZN", "GOOGL", "TSLA",
  "PLTR", "SMCI", "MU", "ARM", "CRWD", "NFLX", "UBER", "SHOP",
];

export interface MarketRegime {
  score: number; // 0-100
  stance: string;
  spyAboveEma20: boolean;
  spyReturn1m: number | null;
  realizedVol: number | null; // annualized %, VIX proxy
  note: string;
}

function realizedVolAnnualized(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const slice = candles.slice(-(lookback + 1));
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i].close / slice[i - 1].close));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varc) * Math.sqrt(252) * 100;
}

export function assessRegime(spy: Candle[]): MarketRegime {
  const closes = spy.map((c) => c.close);
  const price = closes[closes.length - 1] ?? 0;
  const ema20 = ema(closes, 20);
  const spyAboveEma20 = ema20 != null && price > ema20;
  const ret1m = pctReturn(spy, 21);
  const vol = realizedVolAnnualized(spy, 20);

  let score = 50;
  if (spyAboveEma20) score += 20; else score -= 20;
  if (ret1m != null) score += Math.max(-15, Math.min(15, ret1m * 1.5));
  if (vol != null) {
    if (vol < 15) score += 10;
    else if (vol > 22) score -= 15;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const stance = score >= 65 ? "Risk-On" : score >= 45 ? "Neutral / Selective" : "Risk-Off / Defensive";
  const note = spyAboveEma20
    ? `SPY holding above its 20-EMA; ${vol != null && vol > 18 ? "elevated vol — favor extreme RS outliers" : "constructive tape for momentum"}.`
    : "SPY below 20-EMA — restrict to defensive momentum & extreme relative-strength outliers.";
  return { score, stance, spyAboveEma20, spyReturn1m: ret1m, realizedVol: vol, note };
}

export interface ScanResult {
  regime: MarketRegime;
  setups: SwingSetup[];
  scanned: number;
  warnings: string[];
  asOf: string;
}

function lightMarketData(ticker: string, candles: Candle[], spy: Candle[]): MarketData {
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  return {
    ticker,
    quote: last
      ? {
          symbol: ticker,
          price: last.close,
          change: last.close - prev.close,
          changePercent: prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0,
          high: last.high,
          low: last.low,
          open: last.open,
          prevClose: prev.close,
          volume: last.volume,
          asOf: last.date,
        }
      : null,
    overview: null,
    financials: { income: [], balance: [], cashflow: [] },
    earnings: [],
    quarters: [],
    annualEps: [],
    candles,
    benchmarkCandles: spy,
    sources: ["Daily price history"],
    warnings: [],
  };
}

/** Run the momentum scan over a universe; returns the top N setups. */
export async function runScan(universe: string[], topN = 5): Promise<ScanResult> {
  const warnings: string[] = [];
  const spy = await dailyCandles("SPY", 150).catch((e) => {
    warnings.push(`SPY benchmark: ${e?.message ?? "failed"}`);
    return [] as Candle[];
  });
  const regime = assessRegime(spy);

  const candidates: SwingSetup[] = [];
  let scanned = 0;
  // sequential to stay polite to the data provider
  for (const ticker of universe) {
    try {
      const candles = await dailyCandles(ticker, 150);
      if (candles.length < 30) {
        warnings.push(`${ticker}: insufficient price history`);
        continue;
      }
      scanned++;
      const md = lightMarketData(ticker, candles, spy);
      const tech = computeTechnicals(md);
      const score = computeMomentumScore(tech, false);
      const setup = buildSwingSetup(md, tech, score, "Trend persistence / sector momentum (scan-derived).");
      if (setup) candidates.push(setup);
    } catch (e: any) {
      warnings.push(`${ticker}: ${e?.message ?? "failed"}`);
    }
  }

  const setups = candidates
    .sort((a, b) => b.momentumScore - a.momentumScore)
    .slice(0, topN);

  return { regime, setups, scanned, warnings, asOf: new Date().toISOString() };
}
