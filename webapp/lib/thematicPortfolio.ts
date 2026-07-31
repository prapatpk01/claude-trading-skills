import { dailyCandles } from "./marketData";
import { pctReturn, sma } from "./indicators";
import { THEME_UNIVERSE, THEME_MEMBERS, rankGroups } from "./team/thematic";
import type { Candle } from "./types";

export type RebalanceCadence = "monthly" | "quarterly";

export interface ThematicHolding {
  ticker: string;
  theme: string;
  proxy: string;
  weightPct: number;
  score: number;
  return1m: number | null;
  return3m: number | null;
  aboveSma50: boolean;
  rationale: string;
}

export interface ThematicPortfolioResult {
  mode: "thematic";
  cadence: RebalanceCadence;
  requestedHoldings: number;
  holdings: ThematicHolding[];
  themes: ReturnType<typeof rankGroups>;
  methodology: string;
  rebalanceRule: string;
  cashPct: number;
  asOf: string;
  warnings: string[];
}

function stockScore(c: Candle[], spy: Candle[]) {
  if (c.length < 70) return null;
  const closes = c.map(x => x.close);
  const price = closes.at(-1) ?? 0;
  const s50 = sma(closes, 50);
  const r1 = pctReturn(c, 21);
  const r3 = pctReturn(c, 63);
  const spy1 = pctReturn(spy, 21);
  const spy3 = pctReturn(spy, 63);
  const rs1 = r1 != null && spy1 != null ? r1 - spy1 : null;
  const rs3 = r3 != null && spy3 != null ? r3 - spy3 : null;
  let score = 50;
  if (rs1 != null) score += Math.max(-15, Math.min(15, rs1 * 1.0));
  if (rs3 != null) score += Math.max(-22, Math.min(22, rs3 * 1.25));
  if (s50 != null) score += price > s50 ? 10 : -12;
  return { score: Math.max(0, Math.min(100, Math.round(score))), r1, r3, aboveSma50: s50 != null && price > s50 };
}

export async function runThematicPortfolio(holdings = 8, cadence: RebalanceCadence = "monthly"): Promise<ThematicPortfolioResult> {
  const count = Math.max(5, Math.min(10, holdings));
  const warnings: string[] = [];
  const spy = await dailyCandles("SPY", 300).catch(e => { warnings.push(`SPY: ${e?.message ?? "unavailable"}`); return [] as Candle[]; });
  if (!spy.length) throw new Error("Benchmark history unavailable — thematic portfolio cannot be ranked reliably.");

  const proxyCandles: Record<string, Candle[]> = {};
  await Promise.all(THEME_UNIVERSE.map(async g => {
    const c = await dailyCandles(g.proxy, 300).catch(() => [] as Candle[]);
    if (c.length) proxyCandles[g.proxy] = c;
  }));
  const ranked = rankGroups(proxyCandles, spy).filter(g => g.kind === "theme" && g.trending && g.leadership >= 55 && THEME_MEMBERS[g.proxy]);
  const selectedThemes = ranked.slice(0, Math.min(5, ranked.length));
  const candidates: Array<{ticker:string;theme:string;proxy:string;score:number;r1:number|null;r3:number|null;aboveSma50:boolean}> = [];

  for (const group of selectedThemes) {
    for (const ticker of (THEME_MEMBERS[group.proxy] ?? []).slice(0, 8)) {
      const c = await dailyCandles(ticker, 150).catch(() => [] as Candle[]);
      const s = stockScore(c, spy);
      if (!s || s.score < 52) continue;
      candidates.push({ ticker, theme: group.label, proxy: group.proxy, score: Math.round(s.score * .7 + group.leadership * .3), r1: s.r1, r3: s.r3, aboveSma50: s.aboveSma50 });
    }
  }

  candidates.sort((a,b) => b.score - a.score);
  const picked: typeof candidates = [];
  const themeCounts = new Map<string, number>();
  for (const c of candidates) {
    if (picked.some(x => x.ticker === c.ticker)) continue;
    if ((themeCounts.get(c.proxy) ?? 0) >= 3) continue;
    picked.push(c); themeCounts.set(c.proxy, (themeCounts.get(c.proxy) ?? 0) + 1);
    if (picked.length >= count) break;
  }

  const cashPct = picked.length < 5 ? 20 : 5;
  const investPct = 100 - cashPct;
  const raw = picked.map(p => Math.max(1, p.score));
  const total = raw.reduce((a,b) => a+b, 0) || 1;
  let weights = raw.map(x => Math.min(18, Math.max(7, x / total * investPct)));
  const scale = investPct / (weights.reduce((a,b)=>a+b,0) || 1);
  weights = weights.map(w => Math.round(w * scale * 10) / 10);

  const out = picked.map((p,i): ThematicHolding => ({
    ticker: p.ticker, theme: p.theme, proxy: p.proxy, weightPct: weights[i], score: p.score,
    return1m: p.r1, return3m: p.r3, aboveSma50: p.aboveSma50,
    rationale: `${p.theme} is a leading theme; ${p.ticker} combines theme leadership with ${p.r3 == null ? "measurable trend strength" : `${p.r3 >= 0 ? "+" : ""}${p.r3.toFixed(1)}% 3-month return`} and ${p.aboveSma50 ? "an intact 50-day trend" : "a weakening 50-day trend"}.`,
  }));

  return {
    mode: "thematic", cadence, requestedHoldings: count, holdings: out, themes: selectedThemes,
    methodology: "Theme rotation portfolio: rank investable themes vs SPY across 1/3/6 months, require an intact trend, then rank liquid constituents by relative strength and 50-day trend. Diversification cap: maximum 3 stocks per theme.",
    rebalanceRule: cadence === "monthly"
      ? "Review every month: replace holdings that lose theme leadership, fall below the 50-day trend, or drop out of the top-ranked constituent set. Re-normalize weights across 5–10 leaders."
      : "Review every 3 months: keep turnover lower, but replace holdings whose theme loses leadership or whose stock trend breaks. Re-rank all themes and constituents each quarter.",
    cashPct, asOf: new Date().toISOString(), warnings,
  };
}
