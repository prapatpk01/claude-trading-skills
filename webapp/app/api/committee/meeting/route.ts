import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { openOnly } from "@/lib/openPositions";
import { loadOpenHoldings } from "@/lib/portfolioSource";
import { readFearGreed } from "@/lib/team/fearGreed";
import { buildNewsPulse } from "@/lib/news/pulse";
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
import { runDeskScan } from "@/lib/research/deskScan";
import { runInvestmentResearchOS } from "@/lib/research/investmentDiscovery";
import { FUND, STANDING_DUTY } from "@/lib/team/roster";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A name the research desk sourced itself, with the trade it implies. */
interface DeskProposal {
  ticker: string;
  setupType: string;
  score: number;
  coveragePct: number;
  price: number;
  entryLow: number;
  entryHigh: number;
  stop: number;
  target: number;
  riskReward: number;
  expectedReturnPct: number;
  thesis: string;
  catalyst: string;
  unmeasured: string[];
}

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
    const discoveryHeld = new Set(holdings.map(row => String(row.ticker).toUpperCase()));
    // Phase 1 is the Investment Team's broad sourcing engine. Start it early so
    // all factor lenses run while the rest of the meeting evidence is gathered.
    const phase1ResearchPromise = Promise.race([
      runInvestmentResearchOS({ exclude: discoveryHeld, topN: 6, universeLimit: 32 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Phase 1 exceeded its meeting time budget")), 42_000)),
    ]);

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

    // Stage 1 of the meeting is the tape AND how crowded it is. The regime says
    // where the market is; sentiment says how many people are already there.
    // They are separate readings and neither substitutes for the other.
    const [sentiment, newsPulse] = await Promise.all([
      readFearGreed({ spy: benchmark, vix: await dailyCandles("^VIX", 90).catch(() => [] as Candle[]) }).catch((e: any) => {
        unavailable.push(`sentiment index (${e?.message ?? "unavailable"})`);
        return null;
      }),
      buildNewsPulse().catch((e: any) => {
        unavailable.push(`news feeds (${e?.message ?? "unavailable"})`);
        return null;
      }),
    ]);

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

    // ── the research desk sources its own names ──
    //
    // A committee that only debates what a person happened to refer will, on
    // most days, debate nothing. The desk runs its scan before every meeting
    // and tables what survives the four hard filters, so the agenda always has
    // new work on it. A human referral still wins on a name both produce: the
    // person did the deeper research.
    let proposals: DeskProposal[] = [];
    let scanRegime: any = null;
    let scanUniverseSize = 0;
    let scanRejected = 0;
    const scanWarnings: string[] = [];
    let researchOS: any = { universeSize: 0, analyzed: 0, rejected: 0, warnings: [], models: [], methodology: null };
    try {
      const held = new Set(gathered.map((g) => g.ticker.toUpperCase()));
      const referred = new Set(ideas.map((i) => i.ticker));
      // The route has a 60-second ceiling and the scan is the last thing to
      // run. Give it a deadline of its own so a slow price host costs the
      // meeting its proposals and not the whole meeting.
      const scan = await Promise.race([
        runDeskScan({
          topN: 4,
          // A narrower sweep with fewer catalyst calls than the standalone
          // scanner, so the whole meeting still assembles inside the limit.
          universeLimit: 24,
          catalystLimit: 10,
          exclude: held,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("the sweep did not finish inside the meeting's time budget")), 25_000)
        ),
      ]);
      scanRegime = scan.result.regime;
      scanUniverseSize = scan.result.universeSize;
      scanRejected = scan.result.rejected.length;
      scanWarnings.push(...scan.warnings);

      const sourced = scan.result.setups.filter((s) => !referred.has(s.ticker.toUpperCase()));
      proposals = sourced.map((s) => ({
        ticker: s.ticker,
        setupType: s.setupType,
        score: s.momentumScore,
        coveragePct: s.coveragePct,
        price: s.price,
        entryLow: s.entryLow,
        entryHigh: s.entryHigh,
        stop: s.stop,
        target: s.target,
        riskReward: s.riskReward,
        expectedReturnPct: s.expectedReturnPct,
        thesis: s.notes.thesis,
        catalyst: s.catalyst.note,
        unmeasured: s.unmeasured,
      }));

      const sourcedIdeas: IdeaEvidence[] = await mapLimit(sourced, 4, async (s) => {
        const [candles, yieldPct] = await Promise.all([
          dailyCandles(s.ticker, 320).catch(() => [] as Candle[]),
          forwardYield(s.ticker, s.price),
        ]);
        const beta = benchmark.length && candles.length ? computeBeta(candles, benchmark) : null;
        return {
          ticker: s.ticker,
          rating: "BUY",
          conviction: s.momentumScore,
          source: `Research desk swing scan — ${s.setupType}`,
          price: s.price,
          target: s.target,
          upsidePct: s.expectedReturnPct,
          submittedAt: new Date().toISOString().slice(0, 10),
          note: s.notes.thesis.slice(0, 240),
          alreadyHeld: false,
          sleeve: yieldPct != null || beta != null ? classifySleeve(s.ticker, yieldPct, beta) : null,
          // The desk scanned it moments ago, so there is no shelf life to run
          // down and no drift away from the price the thesis was written at.
          ageDays: 0,
          referencePrice: s.price,
          priceDriftPct: 0,
          dataQuality: `${s.coveragePct}% of the alpha score measured`,
        };
      });
      ideas = [...ideas, ...sourcedIdeas].slice(0, 12);
    } catch (e: any) {
      unavailable.push(`research desk scan (${e?.message ?? "unavailable"})`);
    }

    // Phase 1 is independent of the tactical swing filter. A durable growth,
    // quality, value or dividend idea must not disappear because it is not a
    // 7–15 day momentum setup today.
    try {
      const phase1 = await phase1ResearchPromise;
      researchOS = {
        universeSize: phase1.universeSize,
        analyzed: phase1.analyzed,
        rejected: phase1.rejected,
        warnings: phase1.warnings,
        models: phase1.models,
        methodology: phase1.methodology,
      };
      const existingIdeas = new Set(ideas.map(idea => idea.ticker));
      const phase1Proposals = phase1.proposals.filter(proposal => !existingIdeas.has(proposal.ticker));
      const phase1Ideas: IdeaEvidence[] = await mapLimit(phase1Proposals, 4, async proposal => {
        const [candles, yieldPct] = await Promise.all([
          dailyCandles(proposal.ticker, 320).catch(() => [] as Candle[]),
          forwardYield(proposal.ticker, proposal.price),
        ]);
        const beta = benchmark.length && candles.length ? computeBeta(candles, benchmark) : null;
        return {
          ticker: proposal.ticker,
          rating: "BUY",
          conviction: proposal.score,
          source: proposal.setupType,
          price: proposal.price,
          target: proposal.target,
          upsidePct: proposal.expectedReturnPct,
          submittedAt: new Date().toISOString().slice(0, 10),
          note: proposal.thesis.slice(0, 240),
          alreadyHeld: false,
          sleeve: yieldPct != null || beta != null ? classifySleeve(proposal.ticker, yieldPct, beta) : null,
          ageDays: 0,
          referencePrice: proposal.price,
          priceDriftPct: 0,
          dataQuality: `${proposal.sourceModels.length}/7 factor models qualified`,
        };
      });
      ideas = [...ideas, ...phase1Ideas].slice(0, 12);
      const phase1Tickers = new Set(phase1Proposals.map(proposal => proposal.ticker));
      proposals = [...phase1Proposals, ...proposals.filter(proposal => !phase1Tickers.has(proposal.ticker))].slice(0, 10);
    } catch (e: any) {
      unavailable.push(`Sentinel Research OS Phase 1 (${e?.message ?? "unavailable"})`);
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
      {
        ...meeting,
        // Stage 1 evidence, kept beside the regime rather than folded into it.
        sentiment,
        newsPulse,
        // Phase 1 factor discovery plus the tactical swing timing lens.
        proposals,
        scan: {
          regime: scanRegime,
          universeSize: scanUniverseSize,
          rejected: scanRejected,
          warnings: scanWarnings,
          researchOS,
          note: proposals.length
            ? `${proposals.length} unique name(s) were sourced by the combined Investment process. Phase 1 analyzed ${researchOS.analyzed}/${researchOS.universeSize} names across ${researchOS.models.length || 0} factor lenses; the tactical swing lens scanned ${scanUniverseSize}.`
            : `No name cleared the combined Investment process. Phase 1 and the tactical swing lens retain every rejection reason rather than force a weak idea.`,
        },
        // The five stages of the fund's meeting, and whether each has its
        // evidence. A stage without evidence is named, not quietly skipped.
        stages: [
          { n: 1, name: "Investment Team analysis", owner: "Sofia Reyes", ready: regime != null, detail: regime ? `${regime.regime} ${regime.score}/100; macro, fundamentals, valuation, catalysts, momentum and quant evidence assembled.` : "Investment Team cannot present without a market-regime read." },
          { n: 2, name: "Investment proposal", owner: "Sofia Reyes · Head of Investment", ready: ideas.length > 0, detail: ideas.length ? `${ideas.length} name(s) presented. Phase 1 uses every factor lens; the Swing model supplies tactical timing only. ${proposals.length} combined model proposal(s) are shown in the opportunity list.` : `Phase 1 and Swing returned no qualified name. Sofia presents NO NEW BUY rather than forcing a candidate.` },
          { n: 3, name: "Asset Management plan", owner: "Lena Müller · Head of Asset Management", ready: positions.length > 0, detail: `${positions.length} position(s) reviewed; ${positions.filter((p) => p.price != null).length} priced. Sizing, funding, cash and before/after portfolio impact are owned here.` },
          { n: 4, name: "Executive authority gates", owner: "Miriam Osei → James Hartwell", ready: meeting.quorum.met, detail: `CRO risk gate followed by CIO final resolution. Specialist desk opinions are evidence, not votes. ${meeting.quorum.note}` },
          { n: 5, name: "Broker reconciliation and minutes", owner: "Fund owner", ready: false, detail: "Record actual broker activity in Holdings first. The checklist then matches ticker, side and approximate size; the owner confirms or rejects each line without creating a duplicate trade." },
        ],
        fund: FUND,
        standingDuty: STANDING_DUTY,
        sources: { navFrom: buffer ? "portfolio ledger cash-buffer" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Investment committee meeting could not be assembled." }, { status: 500 });
  }
}
