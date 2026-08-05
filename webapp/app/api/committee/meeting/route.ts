import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { openOnly } from "@/lib/openPositions";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { dailyCandles, getLightQuote } from "@/lib/marketData";
import { fetchDividends, inferFrequency } from "@/lib/dividends";
import { computeBeta } from "@/lib/derive";
import { pctReturn } from "@/lib/indicators";
import { sma } from "@/lib/indicators";
import { assessRegime } from "@/lib/team/governance";
import { scoreMomentumV3 } from "@/lib/team/scoring";
import { assessValuation } from "@/lib/team/positionValuation";
import { assessPositionZone } from "@/lib/team/risk";
import { classifySleeve } from "@/lib/team/portfolio";
import { buildBookReview } from "@/lib/team/book";
import { runCommitteeMeeting, type PositionEvidence, type IdeaEvidence } from "@/lib/team/committee";
import { FUND, STANDING_DUTY } from "@/lib/team/roster";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Instruments held as liquidity, not as a view. They fund decisions. */
const RESERVES = new Set(["SGOV", "BIL", "SHV", "USFR", "TFLO", "ICSH", "JPST", "JAAA"]);

const finite = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) break;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** Same-origin read of a sibling route, preserving the caller's auth. */
async function internalJson(req: NextRequest, path: string): Promise<any> {
  const cookie = req.headers.get("cookie") ?? "";
  const authorization = req.headers.get("authorization") ?? "";
  const response = await fetch(new URL(path, req.nextUrl.origin), {
    cache: "no-store",
    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },
  });
  const text = await response.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; }
  catch { throw new Error(`${path} returned a non-JSON response`); }
  if (!response.ok) throw new Error(json?.error ?? `${path} returned ${response.status}`);
  return json;
}

/**
 * Positions as the transaction ledger sees them. The meeting must reason about
 * the same book the holdings screen shows, or its motions describe a portfolio
 * the fund does not have.
 */
async function loadHoldings(): Promise<{ rows: { ticker: string; shares: number; avg_cost: number }[]; note: string }> {
  const sb = getSupabase();
  if (sb) {
    const read = await loadOpenHoldings(sb);
    return { rows: read.rows.map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost })), note: read.note };
  }
  return { rows: openOnly(memStore.holdings).map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost })), note: "" };
}

/** Forward yield from the name's own distribution history, or null. */
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

/** Sessions to liquidate the line at 20% of median dollar volume. */
function sessionsToExit(candles: Candle[], positionValue: number): number | null {
  const recent = candles.slice(-20).filter((c) => c.volume > 0 && c.close > 0);
  if (recent.length < 5) return null;
  const advDollar = recent.reduce((s, c) => s + c.close * c.volume, 0) / recent.length;
  if (!(advDollar > 0)) return null;
  return Math.round((positionValue / (advDollar * 0.2)) * 100) / 100;
}

export async function GET(req: NextRequest) {
  const unavailable: string[] = [];
  try {
    const { rows: holdings, note: reconciliationNote } = await loadHoldings();
    if (reconciliationNote) unavailable.push(reconciliationNote);

    // ── benchmark first: the regime, beta and momentum all lean on it ──
    const benchmark = await dailyCandles("SPY", 320).catch(() => [] as Candle[]);
    if (!benchmark.length) unavailable.push("SPY benchmark history (Yahoo chart endpoint)");

    // ── the ledger's own numbers, not a second computation of them ──
    let buffer: any = null;
    try { buffer = await internalJson(req, "/api/portfolio/cash-buffer"); }
    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }

    // ── per-name evidence, gathered once and shared across the desks ──
    const gathered = await mapLimit(holdings, 4, async (h) => {
      const ticker = String(h.ticker).toUpperCase();
      const [candles, quote, yieldPct] = await Promise.all([
        dailyCandles(ticker, 320).catch(() => [] as Candle[]),
        getLightQuote(ticker).catch(() => null),
        forwardYield(ticker, null),
      ]);
      const price = finite(quote?.price) ?? finite(candles.at(-1)?.close);
      return { ticker, shares: Number(h.shares), avgCost: Number(h.avg_cost), candles, quote, price, yieldPct };
    });

    const unpriced = gathered.filter((g) => g.price == null).map((g) => g.ticker);
    if (unpriced.length) unavailable.push(`current price for ${unpriced.join(", ")}`);

    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);
    const cashBalance = finite(buffer?.cashBalance) ?? 0;
    const nav = finite(buffer?.totalNav) ?? securitiesValue + cashBalance;
    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? finite(buffer?.gapValue) ?? 0);
    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (cashBalance / nav) * 100 : null);
    const targetCashPct = finite(buffer?.targetPct);

    const regime = benchmark.length ? assessRegime(benchmark) : null;

    const positions: PositionEvidence[] = gathered.map((g) => {
      const price = g.price;
      const marketValue = price == null ? null : price * g.shares;
      const weightPct = marketValue == null || nav <= 0 ? null : (marketValue / nav) * 100;
      const isReserve = RESERVES.has(g.ticker);
      const closes = g.candles.map((c) => c.close).filter((c) => Number.isFinite(c) && c > 0);
      const beta = benchmark.length && g.candles.length ? computeBeta(g.candles, benchmark) : null;

      // Maya's model needs both series; without them the seat abstains rather
      // than scoring a name off a partial history.
      const momentum =
        g.candles.length >= 60 && benchmark.length >= 60
          ? (() => {
              const s = scoreMomentumV3({ candles: g.candles, benchmark, beta });
              return { total: s.total, signal: s.signal, hardBlocks: s.hardBlocks.map((b: any) => b.reason ?? String(b)), dataQualityPct: Math.round(s.dataQualityScore) };
            })()
          : null;

      // Thomas prices reserves as cash-like; the module already knows that and
      // returns CASH EQUIVALENT rather than a verdict nobody should act on.
      const valuation =
        price != null && g.candles.length >= 60
          ? (() => {
              const v = assessValuation({ candles: g.candles, price });
              return v.verdict ? { verdict: v.verdict, deviationPct: v.deviationPct, confidence: v.confidence } : null;
            })()
          : null;

      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);
      const trend =
        closes.length >= 60
          ? {
              aboveSma50: sma50 == null || price == null ? null : price > sma50,
              aboveSma200: sma200 == null || price == null ? null : price > sma200,
              return1m: pctReturn(g.candles, 21),
              return3m: pctReturn(g.candles, 63),
            }
          : null;

      return {
        ticker: g.ticker,
        shares: g.shares,
        avgCost: g.avgCost,
        price,
        marketValue,
        weightPct,
        isReserve,
        sleeve: classifySleeve(g.ticker, g.yieldPct, beta),
        pnlPct: g.avgCost > 0 && price != null ? (price / g.avgCost - 1) * 100 : null,
        zone: weightPct != null && marketValue != null && nav > 0 && !isReserve ? assessPositionZone(weightPct, marketValue, nav) : null,
        momentum,
        valuation,
        trend,
        liquidity: marketValue != null ? { sessionsToExit: sessionsToExit(g.candles, marketValue) } : null,
        priceAsOf: g.quote?.asOf ?? g.candles.at(-1)?.date ?? null,
        yieldPct: g.yieldPct,
      };
    });

    // ── the book-level review supplies the round table and risk register ──
    const closesByTicker: Record<string, number[]> = {};
    const candlesByTicker: Record<string, Candle[]> = {};
    for (const g of gathered) {
      if (g.candles.length) {
        closesByTicker[g.ticker] = g.candles.map((c) => c.close);
        candlesByTicker[g.ticker] = g.candles;
      }
    }
    let book: ReturnType<typeof buildBookReview> | null = null;
    try {
      book = buildBookReview({
        holdings: gathered.map((g) => ({ ticker: g.ticker, shares: g.shares, avg_cost: g.avgCost, price: g.price, yieldPct: g.yieldPct })),
        benchmark,
        closesByTicker,
        candlesByTicker,
      });
    } catch (e: any) {
      unavailable.push(`book review (${e?.message ?? "failed"})`);
    }

    // ── ideas referred to the committee from the analysis workspace ──
    let ideas: IdeaEvidence[] = [];
    try {
      const actions = await internalJson(req, "/api/analyze/actions");
      const rows: any[] = Array.isArray(actions?.actions) ? actions.actions : [];
      ideas = rows
        .filter((row) => String(row?.action ?? "").toUpperCase() === "COMMITTEE")
        .map((row) => {
          const payload = row?.payload ?? {};
          // The price the paper was written at, kept apart from today's price
          // so the meeting can see how far the thesis has drifted from it.
          const referencePrice = finite(payload?.price) ?? finite(payload?.currentPrice);
          const target = finite(payload?.target) ?? finite(payload?.targetPrice);
          const submittedAt = row?.created_at ? String(row.created_at) : null;
          const ageDays = submittedAt ? Math.max(0, Math.round((Date.now() - new Date(submittedAt).getTime()) / 86400000)) : null;
          return {
            ticker: String(row?.ticker ?? "").toUpperCase(),
            rating: String(row?.rating ?? "WATCH").toUpperCase(),
            conviction: finite(row?.conviction),
            source: String(payload?.source ?? "Stock Analyze"),
            price: referencePrice,
            target,
            upsidePct: null,
            submittedAt: submittedAt ? submittedAt.slice(0, 10) : null,
            note: payload?.thesis ? String(payload.thesis).slice(0, 240) : null,
            alreadyHeld: false,
            sleeve: null,
            ageDays,
            referencePrice,
            priceDriftPct: null,
            dataQuality: payload?.dataQuality ? String(payload.dataQuality) : null,
          } as IdeaEvidence;
        })
        .filter((idea) => /^[A-Z.\-]{1,10}$/.test(idea.ticker));
      // One motion per name: the most recent referral wins.
      const seen = new Set<string>();
      ideas = ideas.filter((idea) => (seen.has(idea.ticker) ? false : (seen.add(idea.ticker), true))).slice(0, 12);

      // A referral says which name; the fund still has to know which sleeve the
      // money lands in, or the PM cannot object to a buy that widens the drift.
      ideas = await mapLimit(ideas, 4, async (idea) => {
        const [quote, candles, yieldPct] = await Promise.all([
          getLightQuote(idea.ticker).catch(() => null),
          dailyCandles(idea.ticker, 320).catch(() => [] as Candle[]),
          forwardYield(idea.ticker, idea.price),
        ]);
        // Today's price is what the fund would actually pay; the referral's is
        // only the number the thesis was written against.
        const price = finite(quote?.price) ?? finite(candles.at(-1)?.close) ?? idea.referencePrice;
        const beta = benchmark.length && candles.length ? computeBeta(candles, benchmark) : null;
        return {
          ...idea,
          price,
          upsidePct: price != null && idea.target != null && price > 0 ? Math.round((idea.target / price - 1) * 1000) / 10 : null,
          priceDriftPct:
            price != null && idea.referencePrice != null && idea.referencePrice > 0
              ? Math.round((price / idea.referencePrice - 1) * 1000) / 10
              : null,
          sleeve: yieldPct != null || beta != null ? classifySleeve(idea.ticker, yieldPct, beta) : null,
        };
      });
    } catch (e: any) {
      unavailable.push(`research referrals (${e?.message ?? "unavailable"})`);
    }

    // ── Priya's record: the fund's own closed decisions ──
    let track: { completed: number; winRatePct: number | null; averageReturnPct: number | null } | null = null;
    try {
      const perf = await internalJson(req, "/api/analyze/performance");
      const s = perf?.summary ?? {};
      track = { completed: Number(s.completed ?? 0), winRatePct: finite(s.winRatePct), averageReturnPct: finite(s.averageReturnPct) };
    } catch (e: any) {
      unavailable.push(`decision record (${e?.message ?? "unavailable"})`);
    }

    const meeting = runCommitteeMeeting({
      asOf: new Date().toISOString(),
      nav,
      cashBalance,
      deployableCash,
      cashBufferPct,
      targetCashPct,
      regime,
      positions,
      ideas,
      book,
      track,
      unavailable,
    });

    return NextResponse.json(
      { ...meeting, fund: FUND, standingDuty: STANDING_DUTY, sources: { navFrom: buffer ? "portfolio ledger cash-buffer" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Investment committee meeting could not be assembled." }, { status: 500 });
  }
}
