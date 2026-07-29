import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { getMarketData, dailyCandles, getLightQuote } from "@/lib/marketData";
import { buildTickerMemo } from "@/lib/team/memo";
import { buildBookReview } from "@/lib/team/book";
import { scoreMomentumV3, atrStop } from "@/lib/team/scoring";
import { assessRegime } from "@/lib/team/governance";
import { fetchDividends, inferFrequency } from "@/lib/dividends";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { computeBeta } from "@/lib/derive";
import { FUND } from "@/lib/team/roster";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function loadHoldings() {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("holdings").select("ticker,shares,avg_cost");
    if (error) throw new Error(error.message);
    return (data ?? []) as { ticker: string; shares: number; avg_cost: number }[];
  }
  return memStore.holdings.map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost }));
}

async function loadWatchlist() {
  const sb = getSupabase();
  if (sb) {
    const { data, error } = await sb.from("watchlist").select("ticker,reason,alert_price");
    if (error) throw new Error(error.message);
    return (data ?? []) as { ticker: string; reason?: string; alert_price?: number }[];
  }
  return memStore.watchlist.map((w) => ({ ticker: w.ticker, reason: w.reason, alert_price: w.alert_price ?? undefined }));
}

/** Forward yield % for a ticker, from its own distribution history. */
async function forwardYield(ticker: string, price: number | null): Promise<number | null> {
  try {
    const { events, price: p } = await fetchDividends(ticker, 3);
    if (!events.length) return null;
    const px = price ?? p;
    if (!px) return null;
    const { perYear } = inferFrequency(events);
    const last = events[events.length - 1];
    const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const ttm = events.filter((e) => e.date >= cutoff).reduce((s, e) => s + e.amount, 0);
    const est = perYear ? last.amount * perYear : ttm;
    return est > 0 ? Math.round((est / px) * 10000) / 100 : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const mode = body.mode as string;

  try {
    // ── Single ticker: full investment-committee memo ──
    if (mode === "ticker") {
      const ticker = String(body.ticker ?? "").trim().toUpperCase();
      if (!/^[A-Z.\-]{1,10}$/.test(ticker)) {
        return NextResponse.json({ error: "Provide a valid ticker." }, { status: 400 });
      }
      // Reuse the analysis the page already computed when it was supplied,
      // otherwise fetch fresh.
      const analysis = body.analysis?.data ? body.analysis : await buildAnalysis(ticker);
      const holdings = await loadHoldings().catch(() => []);
      const prices: Record<string, number | null> = {};
      await Promise.all(
        holdings.map(async (h) => {
          const q = await getLightQuote(h.ticker).catch(() => null);
          prices[h.ticker] = q?.price ?? null;
        })
      );
      const nav = holdings.reduce((s, h) => s + (prices[h.ticker] ?? h.avg_cost) * h.shares, 0);
      const held = holdings.find((h) => h.ticker === ticker);
      const heldWeight =
        held && nav > 0 ? (((prices[ticker] ?? held.avg_cost) * held.shares) / nav) * 100 : null;

      const price = analysis.data.quote?.price ?? null;
      const yieldPct = await forwardYield(ticker, price);

      const memo = buildTickerMemo({
        data: analysis.data,
        nav: nav > 0 ? nav : null,
        currentWeightPct: heldWeight,
        yieldPct,
        dcfFairValue: analysis.dcf?.fairValue ?? null,
        dcfUpsidePct: analysis.dcf?.upsidePct ?? null,
        targetPrice: analysis.targetPrice ?? null,
        upsidePct: analysis.upsidePct ?? null,
      });
      return NextResponse.json({ mode, memo, fund: FUND });
    }

    // ── Whole book: portfolio committee review ──
    if (mode === "portfolio") {
      const holdings = await loadHoldings();
      if (!holdings.length) {
        return NextResponse.json({ error: "No holdings to review — add a position first." }, { status: 400 });
      }
      const spy = await dailyCandles("SPY", 400).catch(() => [] as Candle[]);
      const closesByTicker: Record<string, number[]> = {};
      const enriched = await Promise.all(
        holdings.map(async (h) => {
          const [q, candles] = await Promise.all([
            getLightQuote(h.ticker).catch(() => null),
            dailyCandles(h.ticker, 400).catch(() => [] as Candle[]),
          ]);
          if (candles.length) closesByTicker[h.ticker] = candles.map((c) => c.close);
          const price = q?.price ?? candles[candles.length - 1]?.close ?? null;
          return {
            ...h,
            price,
            yieldPct: await forwardYield(h.ticker, price),
            beta: candles.length && spy.length ? computeBeta(candles, spy) : null,
          };
        })
      );

      // Portfolio vs SPY over the window we can measure
      let portfolioReturnPct: number | null = null;
      let spyReturnPct: number | null = null;
      const dates = new Set<string>();
      Object.values(closesByTicker).forEach(() => {});
      const anyCandles = Object.keys(closesByTicker);
      if (anyCandles.length && spy.length > 21) {
        // value the book at the start and end of the common window
        let startVal = 0;
        let endVal = 0;
        for (const h of enriched) {
          const closes = closesByTicker[h.ticker];
          if (!closes || closes.length < 22) continue;
          startVal += closes[closes.length - 22] * h.shares;
          endVal += closes[closes.length - 1] * h.shares;
        }
        if (startVal > 0) portfolioReturnPct = ((endVal - startVal) / startVal) * 100;
        const s0 = spy[spy.length - 22]?.close;
        const s1 = spy[spy.length - 1]?.close;
        if (s0 && s1) spyReturnPct = ((s1 - s0) / s0) * 100;
      }

      const review = buildBookReview({
        holdings: enriched,
        benchmark: spy,
        closesByTicker,
        portfolioReturnPct,
        spyReturnPct,
      });
      return NextResponse.json({ mode, review, fund: FUND, windowNote: "Return comparison uses the most recent ~1 month of common price history." });
    }

    // ── Watchlist: rank every name through the scoring model ──
    if (mode === "watchlist") {
      const watch = await loadWatchlist();
      if (!watch.length) {
        return NextResponse.json({ error: "Watchlist is empty — add a ticker first." }, { status: 400 });
      }
      const spy = await dailyCandles("SPY", 300).catch(() => [] as Candle[]);
      const regime = spy.length ? assessRegime(spy) : null;
      const rows = [];
      for (const w of watch.slice(0, 20)) {
        try {
          const candles = await dailyCandles(w.ticker, 400);
          if (candles.length < 60) {
            rows.push({ ticker: w.ticker, reason: w.reason ?? null, error: "insufficient price history" });
            continue;
          }
          const beta = spy.length ? computeBeta(candles, spy) : null;
          const score = scoreMomentumV3({ candles, benchmark: spy, beta });
          const price = candles[candles.length - 1].close;
          const stop = atrStop(candles, price, 2);
          rows.push({
            ticker: w.ticker,
            reason: w.reason ?? null,
            alertPrice: w.alert_price ?? null,
            price: Math.round(price * 100) / 100,
            score: score.total,
            signal: score.signal,
            signalReason: score.signalReason,
            hardBlocks: score.hardBlocks,
            phaseTotals: score.phaseTotals,
            dataQualityScore: score.dataQualityScore,
            stop: stop?.stop ?? null,
            distanceToAlert:
              w.alert_price && price ? Math.round(((price - w.alert_price) / w.alert_price) * 10000) / 100 : null,
          });
        } catch (e: any) {
          rows.push({ ticker: w.ticker, reason: w.reason ?? null, error: e?.message ?? "failed" });
        }
      }
      rows.sort((a: any, b: any) => (b.score ?? -1) - (a.score ?? -1));
      return NextResponse.json({ mode, regime, rows, fund: FUND });
    }

    return NextResponse.json({ error: "Unknown mode. Expected ticker | portfolio | watchlist." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Team analysis failed" }, { status: 500 });
  }
}
