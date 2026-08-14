import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/lib/marketData";
import { fetchDividends } from "@/lib/dividends";
import { fundamentalValuationFallback } from "@/lib/fundamentalValuationFallback";
import { assessValuation } from "@/lib/team/positionValuation";
import { fetchYahooAnalystConsensus, type YahooAnalystConsensus } from "@/lib/yahooAnalystConsensus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const cleanTickers = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value
      .map((item) => String(item ?? "").trim().toUpperCase())
      .filter((ticker) => /^[A-Z.\-]{1,10}$/.test(ticker))))
      .slice(0, 12)
  : [];

const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) break;
      output[index] = await fn(items[index]);
    }
  }));
  return output;
}

function trailingDividendYieldPct(
  events: Awaited<ReturnType<typeof fetchDividends>>["events"],
  price: number,
) {
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const ttm = events
    .filter((event) => event.date >= cutoff)
    .reduce((sum, event) => sum + Math.max(0, finite(event.amount) ?? 0), 0);
  return price > 0 ? (ttm / price) * 100 : 0;
}

function portfolioValuation(
  data: Awaited<ReturnType<typeof getMarketData>>,
  dividends: Awaited<ReturnType<typeof fetchDividends>>["events"],
) {
  const price = finite(data.quote?.price) ?? finite(data.candles.at(-1)?.close);
  if (price == null || price <= 0) return null;

  const read = assessValuation({
    candles: data.candles,
    price,
    annualEps: data.annualEps,
    epsTTM: finite(data.overview?.eps),
    dividends,
  });
  if (read.fairValue == null || read.fairValue <= 0 || !read.anchors.length) return null;

  const dividendYieldPct = trailingDividendYieldPct(dividends, price);
  const rejected: string[] = [];

  // A tiny dividend is not an economic valuation anchor for growth stocks.
  // Capitalising a 0.x% yield can create a huge target after a payout change,
  // which is exactly how a growth name can print a nonsensical 200%+ upside.
  let anchors = read.anchors.filter((anchor) => {
    const ratio = anchor.fairValue / price;
    if (ratio < 0.4 || ratio > 2.5) {
      rejected.push(`${anchor.method}: ${ratio.toFixed(2)}x spot failed the basis sanity rail`);
      return false;
    }
    if (anchor.method === "Dividend yield" && dividendYieldPct < 1.5) {
      rejected.push(`${anchor.method}: ${dividendYieldPct.toFixed(2)}% TTM yield is too small to value a growth stock reliably`);
      return false;
    }
    return true;
  });
  if (!anchors.length) return null;

  // Do not average two mutually incompatible answers. If the pair differs by
  // more than 75%, prefer a genuine fundamental anchor over trend/yield. If no
  // such anchor remains, the institutional read is considered unresolved and
  // the caller may use analyst consensus instead.
  if (anchors.length >= 2) {
    const values = anchors.map((anchor) => anchor.fairValue);
    const pairRatio = Math.max(...values) / Math.max(0.01, Math.min(...values));
    if (pairRatio > 1.75) {
      const fundamentals = anchors.filter((anchor) => !["Trend regression", "Dividend yield"].includes(anchor.method));
      if (fundamentals.length) {
        rejected.push(`Anchor conflict ${pairRatio.toFixed(2)}x: trend/yield anchors removed in favour of fundamental evidence`);
        anchors = fundamentals;
      } else {
        return null;
      }
    }
  }

  const totalWeight = anchors.reduce((sum, anchor) => sum + anchor.weight, 0);
  if (!(totalWeight > 0)) return null;
  const fairValue = anchors.reduce((sum, anchor) => sum + anchor.fairValue * anchor.weight, 0) / totalWeight;
  if (!(fairValue > 0)) return null;

  const values = anchors.map((anchor) => anchor.fairValue);
  const spread = anchors.length > 1
    ? (Math.max(...values) - Math.min(...values)) / fairValue
    : 0;
  const fairBandPct = Math.max(8, Math.min(16, 8 * (1 + Math.min(1, spread))));
  const band = fairBandPct / 100;
  const targetPrice = round2(fairValue);
  const nonTrendAnchors = anchors.filter((anchor) => anchor.method !== "Trend regression");
  const onlyYahooTrend = anchors.length > 0 && nonTrendAnchors.length === 0;
  const heavy = anchors.filter((anchor) => anchor.weight >= 2).length;
  const confidence = anchors.length >= 2 && heavy >= 1 && spread < 0.25
    ? "HIGH"
    : heavy >= 1 || anchors.length >= 2
      ? "MEDIUM"
      : "LOW";

  return {
    targetPrice,
    bearPrice: round2(targetPrice * (1 - band)),
    bullPrice: round2(targetPrice * (1 + band)),
    upsidePct: round2((targetPrice / price - 1) * 100),
    confidence,
    anchors: anchors.map((anchor) => ({
      label: anchor.method,
      target: round2(anchor.fairValue),
      weight: anchor.weight,
      detail: anchor.detail,
    })),
    source: onlyYahooTrend ? "YAHOO_TREND_FALLBACK" : "THOMAS_PORTFOLIO_MULTI_ANCHOR",
    method: onlyYahooTrend
      ? `Yahoo Finance price-history fallback: ${read.note} This is a low-order valuation anchor used only after the full research/fundamental path could not establish fair value; it is not a spot-price target.`
      : `Thomas institutional multi-anchor valuation after quality guards.${rejected.length ? ` Rejected: ${rejected.join("; ")}.` : ""}`,
  };
}

function yahooAnalystValuation(consensus: YahooAnalystConsensus | null, currentPrice: number | null) {
  if (!consensus || !(consensus.targetMeanPrice > 0)) return null;
  const targetPrice = round2(consensus.targetMeanPrice);
  const low = consensus.targetLowPrice != null && consensus.targetLowPrice > 0
    ? consensus.targetLowPrice
    : targetPrice * 0.85;
  const high = consensus.targetHighPrice != null && consensus.targetHighPrice > 0
    ? consensus.targetHighPrice
    : targetPrice * 1.15;
  const analystCount = consensus.analystCount ?? 0;
  const confidence = analystCount >= 15 ? "HIGH" : analystCount >= 5 ? "MEDIUM" : "LOW";
  const range = low <= high ? { low, high } : { low: high, high: low };

  return {
    targetPrice,
    bearPrice: round2(range.low),
    bullPrice: round2(range.high),
    upsidePct: currentPrice != null && currentPrice > 0
      ? round2((targetPrice / currentPrice - 1) * 100)
      : null,
    confidence,
    anchors: [{
      label: "Yahoo analyst consensus",
      target: targetPrice,
      weight: 1,
      detail: `${analystCount || "n/a"} analyst opinion(s); mean $${targetPrice.toFixed(2)}${consensus.targetMedianPrice != null ? `, median $${round2(consensus.targetMedianPrice).toFixed(2)}` : ""}${consensus.recommendationKey ? `, recommendation ${consensus.recommendationKey}` : ""}.`,
    }],
    source: "YAHOO_ANALYST_CONSENSUS",
    method: `Yahoo Finance analyst consensus fallback. Bear/low $${round2(range.low).toFixed(2)} · mean/base $${targetPrice.toFixed(2)} · bull/high $${round2(range.high).toFixed(2)}. This is external analyst consensus, not a target manufactured from the current share price.`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = cleanTickers(body?.tickers);
    if (!tickers.length) return NextResponse.json({ rows: [] }, { headers: { "Cache-Control": "no-store" } });

    const rows = await mapLimit(tickers, 3, async (ticker) => {
      try {
        const [data, dividendPack, analystConsensus] = await Promise.all([
          getMarketData(ticker),
          fetchDividends(ticker, 5).catch(() => ({ events: [], price: null })),
          fetchYahooAnalystConsensus(ticker).catch(() => null),
        ]);
        const currentPrice = finite(data.quote?.price) ?? finite(data.candles.at(-1)?.close);
        const institutional = portfolioValuation(data, dividendPack.events);
        const filing = fundamentalValuationFallback(data);
        const analyst = yahooAnalystValuation(analystConsensus, currentPrice);

        const institutionalUsesFundamentals = institutional?.source === "THOMAS_PORTFOLIO_MULTI_ANCHOR";
        const filingFundamentalAnchors = filing?.anchors.filter((anchor) => anchor.label !== "Analyst consensus") ?? [];
        const strongFiling = filing != null && filingFundamentalAnchors.length >= 2;

        // Precedence:
        // 1) a quality-guarded institutional valuation with real fundamental anchors;
        // 2) a filing model supported by at least two independent fundamental anchors;
        // 3) Yahoo analyst consensus when Sentinel cannot build a defensible intrinsic target;
        // 4) weaker filing/trend evidence only when analyst consensus is unavailable.
        const valuation = institutionalUsesFundamentals
          ? institutional
          : strongFiling
            ? { ...filing!, source: "THOMAS_FUNDAMENTAL_RANGE" }
            : analyst
              ? analyst
              : filing
                ? { ...filing, source: "THOMAS_FUNDAMENTAL_RANGE" }
                : institutional;

        return {
          ticker,
          currentPrice,
          valuation,
          analystConsensus,
          sources: data.sources,
          warnings: data.warnings,
        };
      } catch (error: any) {
        return { ticker, currentPrice: null, valuation: null, analystConsensus: null, sources: [], warnings: [error?.message ?? "valuation fallback failed"] };
      }
    });

    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Valuation fallback failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
