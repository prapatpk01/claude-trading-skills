import { getMarketData } from "./marketData";
import { buildAnalysis } from "./analyze";

export interface DividendPick {
  ticker: string;
  name: string;
  sector: string;
  score: number;
  yieldPct: number | null;
  revenueGrowthPct: number | null;
  roePct: number | null;
  profitMarginPct: number | null;
  payoutQuality: string;
  thesis: string;
  catalysts: { horizon: string; event: string; impact: string }[];
  risks: string[];
  dcfFairValue: number | null;
  targetPrice: number | null;
  upsidePct: number | null;
  reasons: string[];
}

const n = (v: any): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const pct = (v: number | null | undefined) => v == null ? null : Math.abs(v) <= 2 ? v * 100 : v;

function cheapScore(data: Awaited<ReturnType<typeof getMarketData>>) {
  const ov = data.overview;
  const inc = data.financials.income;
  const cf = data.financials.cashflow;
  const latest = inc[0];
  const oldest = inc[Math.min(inc.length - 1, 4)];
  const latestCf = cf[0];
  const yieldPct = pct(ov?.dividendYield);
  const roePct = pct(ov?.roe);
  const marginPct = pct(ov?.profitMargin);
  const rev0 = n(latest?.totalRevenue);
  const revOld = n(oldest?.totalRevenue);
  const years = Math.max(1, Math.min(4, inc.length - 1));
  const growth = rev0 && revOld && revOld > 0 ? (Math.pow(rev0 / revOld, 1 / years) - 1) * 100 : null;
  const ocf = n(latestCf?.operatingCashflow);
  const div = Math.abs(n(latestCf?.dividendPayout) ?? 0);
  const coverage = ocf && ocf > 0 ? div / ocf : null;

  let score = 0;
  const reasons: string[] = [];
  if ((yieldPct ?? 0) >= 5) { score += 25; reasons.push(`Yield ${yieldPct?.toFixed(1)}%`); }
  else if ((yieldPct ?? 0) >= 3) { score += 15; reasons.push(`Yield ${yieldPct?.toFixed(1)}%`); }
  if ((roePct ?? 0) >= 15) { score += 15; reasons.push(`ROE ${roePct?.toFixed(1)}%`); }
  if ((marginPct ?? 0) >= 12) { score += 10; reasons.push(`Margin ${marginPct?.toFixed(1)}%`); }
  if ((growth ?? 0) >= 8) { score += 15; reasons.push(`Revenue CAGR ${growth?.toFixed(1)}%`); }
  if (coverage != null && coverage <= 0.7) { score += 20; reasons.push(`Dividend/OCF ${(coverage * 100).toFixed(0)}%`); }
  else if (coverage != null && coverage <= 1) { score += 10; reasons.push(`Dividend/OCF ${(coverage * 100).toFixed(0)}%`); }
  if ((ov?.beta ?? 9) <= 1.2) score += 5;
  if ((ov?.peRatio ?? 999) <= 25) score += 10;
  return { score: Math.min(100, score), yieldPct, roePct, marginPct, growth, coverage, reasons };
}

export async function runDividendScan(universe: string[], topN = 5) {
  const ranked: { ticker: string; pre: ReturnType<typeof cheapScore> }[] = [];
  const rejected: { ticker: string; reason: string }[] = [];

  for (const ticker of universe.slice(0, 36)) {
    try {
      const data = await getMarketData(ticker);
      const pre = cheapScore(data);
      if ((pre.yieldPct ?? 0) < 2) {
        rejected.push({ ticker, reason: "Dividend yield below 2% quality-income floor" });
        continue;
      }
      ranked.push({ ticker, pre });
    } catch (e: any) {
      rejected.push({ ticker, reason: e?.message ?? "fundamental data unavailable" });
    }
  }

  ranked.sort((a,b) => b.pre.score - a.pre.score);
  const shortlist = ranked.slice(0, Math.max(topN * 2, 8));
  const picks: DividendPick[] = [];

  for (const row of shortlist) {
    try {
      const a = await buildAnalysis(row.ticker);
      const ov = a.data.overview;
      const scenario = a.thesis.find((s) => s.label === "Base");
      const thesis = scenario?.narrative ?? a.signalReasons?.join(" · ") ?? "No thesis available";
      const qualityBonus = (a.dcf && a.upsidePct > 0 ? 5 : 0) + (a.signal === "BUY" ? 5 : 0);
      picks.push({
        ticker: row.ticker,
        name: ov?.name ?? row.ticker,
        sector: ov?.sector ?? "n/a",
        score: Math.min(100, row.pre.score + qualityBonus),
        yieldPct: row.pre.yieldPct,
        revenueGrowthPct: row.pre.growth,
        roePct: row.pre.roePct,
        profitMarginPct: row.pre.marginPct,
        payoutQuality: row.pre.coverage == null ? "Unknown" : row.pre.coverage <= 0.7 ? "Strong" : row.pre.coverage <= 1 ? "Adequate" : "Stretched",
        thesis,
        catalysts: a.catalysts.slice(0, 4),
        risks: a.risks.slice(0, 4),
        dcfFairValue: a.dcf?.fairValue ?? null,
        targetPrice: a.targetPrice ?? null,
        upsidePct: a.upsidePct ?? null,
        reasons: row.pre.reasons,
      });
    } catch (e: any) {
      rejected.push({ ticker: row.ticker, reason: `Deep dive failed: ${e?.message ?? "unknown"}` });
    }
  }

  picks.sort((a,b) => b.score - a.score);
  return {
    mode: "dividend",
    scanned: Math.min(universe.length, 36),
    picks: picks.slice(0, topN),
    rejected,
    methodology: "Dividend quality score: yield, cash-flow coverage, ROE, profitability, 5Y revenue growth, valuation and deep-dive thesis/catalyst/DCF confirmation.",
  };
}
