import { NextRequest, NextResponse } from "next/server";
import { buildAnalysis } from "@/lib/analyze";
import { defaultAssumptions, computeDcf } from "@/lib/analysis";
import { getMarketData as fullMarketData } from "@/lib/marketData";
import { dailyCandles, getLightQuote } from "@/lib/marketData";
import { buildTickerMemo } from "@/lib/team/memo";
import { buildBookReview } from "@/lib/team/book";
import { scoreMomentumV3, atrStop } from "@/lib/team/scoring";
import { runSAMP } from "@/lib/team/samp";
import { assessRegime } from "@/lib/team/governance";
import { assessValuation } from "@/lib/team/positionValuation";
import {
  readStructure, scoreEngineA, scoreEngineB, checkEntry, checkHybrid,
  yieldTrapCheck, yieldBand,
} from "@/lib/team/engines";
import { buildPlansV4, type PositionV4 } from "@/lib/team/sizingV4";
import { buildGrowthInput, bestGrowthPct } from "@/lib/team/growthInputs";
import {
  rankGroups, buildThematicTilt, themeForSector, groupForSector, THEME_PROXIES,
} from "@/lib/team/thematic";
import { getSector, getSectors } from "@/lib/sectors";
import { readFearGreed } from "@/lib/team/fearGreed";
import { buildMacroPlan } from "@/lib/team/macroPlan";
import { buildNewsPulse } from "@/lib/news/pulse";
import { buildOutlook } from "@/lib/news/outlook";
import { classifySleeve as sleeveOf } from "@/lib/team/portfolio";
import { getSecFundamentals } from "@/lib/sec";
import { fetchDividends, inferFrequency } from "@/lib/dividends";
import { getSupabase } from "@/lib/supabase";
import { memStore } from "@/lib/store";
import { computeBeta } from "@/lib/derive";
import { openOnly } from "@/lib/openPositions";
import { pctReturn } from "@/lib/indicators";
import { FUND } from "@/lib/team/roster";
import type { Candle } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Open positions only. Every desk reasons about the book as it stands: a sold
 * position in NAV overstates the denominator and understates every weight
 * measured against it.
 */
async function loadHoldings() {
  const sb = getSupabase();
  if (sb) {
    let { data, error } = await sb.from("holdings").select("ticker,shares,avg_cost,closed_at");
    if (error && /closed_at/i.test(error.message)) {
      ({ data, error } = await sb.from("holdings").select("ticker,shares,avg_cost"));
    }
    if (error) throw new Error(error.message);
    return openOnly((data ?? []) as any[]) as { ticker: string; shares: number; avg_cost: number }[];
  }
  return openOnly(memStore.holdings).map((h) => ({ ticker: h.ticker, shares: h.shares, avg_cost: h.avg_cost }));
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

/** Distribution durability inputs for the income sleeve. */
function distributionQuality(events: { date: string; amount: number }[], yieldPct: number | null) {
  const cutoff = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  const recent = events.filter((e) => e.date >= cutoff);
  let cuts = 0;
  for (let i = 1; i < recent.length; i++) {
    // A payment more than 2% below the prior one counts as a cut; smaller
    // wobbles are rounding on a variable distribution, not a policy change.
    if (recent[i].amount < recent[i - 1].amount * 0.98) cuts++;
  }
  let deepestCutPct: number | null = null;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i - 1].amount > 0 && recent[i].amount < recent[i - 1].amount) {
      const drop = ((recent[i - 1].amount - recent[i].amount) / recent[i - 1].amount) * 100;
      if (deepestCutPct == null || drop > deepestCutPct) deepestCutPct = drop;
    }
  }
  const ttm = (from: number, to: number) => {
    const hi = new Date(Date.now() - from * 86400000).toISOString().slice(0, 10);
    const lo = new Date(Date.now() - to * 86400000).toISOString().slice(0, 10);
    return events.filter((e) => e.date > lo && e.date <= hi).reduce((s, e) => s + e.amount, 0);
  };
  const now = ttm(0, 365);
  const prior = ttm(365, 730);
  return {
    yieldPct,
    distributionGrowthPct: prior > 0 ? ((now - prior) / prior) * 100 : null,
    cuts,
    payments: recent.length,
    deepestCutPct,
  };
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

      // Rank the theme groups so the catalyst desk can name the theme this
      // company sits in and how strongly it is leading. The same 20 proxies the
      // macro and valuation desks pull, fetched in parallel.
      const themeCandles: Record<string, Candle[]> = {};
      const spyForThemes = await dailyCandles("SPY", 300).catch(() => [] as Candle[]);
      await Promise.all(
        THEME_PROXIES.map(async (t) => {
          const c = await dailyCandles(t, 300).catch(() => [] as Candle[]);
          if (c.length) themeCandles[t] = c;
        })
      );
      const rankedForTicker = spyForThemes.length ? rankGroups(themeCandles, spyForThemes) : [];
      const grp = groupForSector(rankedForTicker, analysis.data.overview?.sector ?? null);

      const memo = buildTickerMemo({
        data: analysis.data,
        nav: nav > 0 ? nav : null,
        currentWeightPct: heldWeight,
        yieldPct,
        dcfFairValue: analysis.dcf?.fairValue ?? null,
        dcfUpsidePct: analysis.dcf?.upsidePct ?? null,
        targetPrice: analysis.targetPrice ?? null,
        upsidePct: analysis.upsidePct ?? null,
        theme: grp
          ? { label: grp.label, proxy: grp.proxy, leadership: grp.leadership, rs3mPct: grp.rs3m }
          : null,
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
      // Full candles too, so the momentum, quant and execution desks can measure
      // trend, volatility and tradeability instead of sitting the meeting out.
      const candlesByTicker: Record<string, Candle[]> = {};
      const enriched = await Promise.all(
        holdings.map(async (h) => {
          const [q, candles] = await Promise.all([
            getLightQuote(h.ticker).catch(() => null),
            dailyCandles(h.ticker, 400).catch(() => [] as Candle[]),
          ]);
          if (candles.length) {
            closesByTicker[h.ticker] = candles.map((c) => c.close);
            candlesByTicker[h.ticker] = candles;
          }
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
        candlesByTicker,
        portfolioReturnPct,
        spyReturnPct,
      });
      return NextResponse.json({ mode, review, fund: FUND, windowNote: "Return comparison uses the most recent ~1 month of common price history." });
    }

    // ── Valuation desk (Team Rules v4) — two engines, then sizing ──
    if (mode === "valuation") {
      const holdings = await loadHoldings();
      if (!holdings.length) {
        return NextResponse.json({ error: "No holdings to value — add a position first." }, { status: 400 });
      }
      const spy = await dailyCandles("SPY", 400).catch(() => [] as Candle[]);
      const regime = spy.length ? assessRegime(spy) : null;

      // Theme leadership first — used to prioritise, not to permit.
      const proxyCandles: Record<string, Candle[]> = {};
      await Promise.all(
        THEME_PROXIES.map(async (t) => {
          const c = await dailyCandles(t, 300).catch(() => [] as Candle[]);
          if (c.length) proxyCandles[t] = c;
        })
      );
      const ranked = spy.length ? rankGroups(proxyCandles, spy) : [];

      const positions: PositionV4[] = [];
      const failures: { ticker: string; error: string }[] = [];
      const sectorValue: Record<string, number> = {};
      const diagnostics: any[] = [];

      for (const h of holdings) {
        try {
          const candles = await dailyCandles(h.ticker, 780);
          if (candles.length < 60) throw new Error("insufficient price history");
          const q = await getLightQuote(h.ticker).catch(() => null);
          const price = q?.price ?? candles[candles.length - 1].close;

          const [sec, divs, sectorInfo, md] = await Promise.all([
            getSecFundamentals(h.ticker).catch(() => null),
            fetchDividends(h.ticker, 5).then((d) => d.events).catch(() => []),
            getSector(h.ticker).catch(() => null),
            fullMarketData(h.ticker).catch(() => null),
          ]);

          const dcf = md ? computeDcf(md, defaultAssumptions(md)) : null;
          const valuation = assessValuation({
            candles, price,
            annualEps: sec?.annualEps ?? [],
            epsTTM: sec?.epsTTM ?? null,
            dividends: divs,
            dcf: dcf
              ? { fairValue: dcf.fairValue, wacc: dcf.wacc, terminalSharePct: dcf.terminalSharePct, reliable: dcf.reliable }
              : null,
          });

          const structure = readStructure(candles, spy);
          const isFund = sectorInfo?.isFund ?? false;
          const growth = buildGrowthInput(sec, isFund);
          const growthPct = bestGrowthPct(growth);

          const dq = distributionQuality(divs, await forwardYield(h.ticker, price));
          const yieldPct = dq.yieldPct;

          const engineA = scoreEngineA({ growth, structure });
          const engineB = scoreEngineB({
            yieldPct,
            distributionGrowthPct: dq.distributionGrowthPct,
            cuts: dq.cuts,
            payments: dq.payments,
            deepestCutPct: dq.deepestCutPct,
            fundamentalGrowthPct: growthPct,
            structure,
            valuation: valuation.verdict,
            existingPosition: true,
          });

          // Which engine holds this position? The one it qualifies for; where
          // it qualifies for both, the hybrid test decides priority.
          const cashLike = valuation.cashLike === true;
          const engine: PositionV4["engine"] = cashLike
            ? "Cash/Defensive"
            : (yieldPct ?? 0) >= 5
            ? "High Dividend Growth"
            : "Momentum Growth";

          const hybrid = checkHybrid(engineA, engineB, {
            growthPct, yieldPct,
            distributionGrowthPct: dq.distributionGrowthPct,
            above200: structure.above200,
          });

          if (sectorInfo?.sector) {
            sectorValue[sectorInfo.sector] = (sectorValue[sectorInfo.sector] ?? 0) + price * h.shares;
          }

          positions.push({
            ticker: h.ticker,
            shares: h.shares,
            avgCost: h.avg_cost,
            price,
            engineA, engineB, engine, hybrid, structure,
            entry: checkEntry(structure),
            valuation,
            growthPct,
            yieldPct,
            distributionGrowthPct: dq.distributionGrowthPct,
            stop: atrStop(candles, price, 2)?.stop ?? null,
            theme: themeForSector(ranked, sectorInfo?.sector ?? null),
          });

          diagnostics.push({
            ticker: h.ticker,
            engine,
            isHybrid: hybrid.isHybrid,
            hybridMissing: hybrid.missing,
            growthPct,
            growthDetail: engineA.lines.find((l) => l.label === "Revenue / EPS growth")?.detail ?? null,
            yieldPct,
            yieldBand: yieldBand(yieldPct),
            yieldTrap: yieldTrapCheck(yieldPct, dq.distributionGrowthPct, pctReturn(candles, 252)),
            distributionGrowthPct: dq.distributionGrowthPct,
            engineA: { score: engineA.score, signal: engineA.signal, coverage: engineA.coveragePct, blocks: engineA.blocks, lines: engineA.lines },
            engineB: { score: engineB.score, signal: engineB.signal, coverage: engineB.coveragePct, blocks: engineB.blocks, lines: engineB.lines },
            entry: checkEntry(structure),
          });
        } catch (e: any) {
          failures.push({ ticker: h.ticker, error: e?.message ?? "failed" });
        }
      }

      if (!positions.length) {
        return NextResponse.json({ error: "Could not value any holding — no price history was available." }, { status: 502 });
      }

      const nav = positions.reduce((s, p) => s + (p.price ?? p.avgCost) * p.shares, 0);
      const sectorWeights: Record<string, number> = {};
      for (const [k, v] of Object.entries(sectorValue)) sectorWeights[k] = nav > 0 ? (v / nav) * 100 : 0;

      const result = buildPlansV4({ positions, nav, regime });
      const tilt = ranked.length ? buildThematicTilt(ranked, regime, sectorWeights) : null;

      // Engine mix against the v4 strategic allocation.
      const byEngine: Record<string, number> = {};
      for (const p of positions) {
        const v = (p.price ?? p.avgCost) * p.shares;
        byEngine[p.engine] = (byEngine[p.engine] ?? 0) + v;
      }
      const mix = Object.entries(byEngine).map(([engine, v]) => ({
        engine, valuePct: nav > 0 ? Math.round((v / nav) * 1000) / 10 : 0,
      }));

      return NextResponse.json({
        mode,
        rulesVersion: "v4.0",
        nav: Math.round(nav * 100) / 100,
        regime, tilt, mix, diagnostics,
        ...result,
        failures,
        fund: FUND,
        disclosures: [
          "Team Rules v4.0 — Engine A requires growth above 12% with price confirmation; Engine B requires a yield of 5% or more with a durable, growing distribution.",
          "Forward estimates and analyst revisions are not available from free, keyless sources. Those components are excluded from the score and the coverage percentage says how much of each model could be evaluated (Rule #5).",
          "Valuation sizes an add; it does not sell a winner. A rich price forces a trim only when momentum is already weakening.",
          "Position ladder: 15% normal maximum, 15-20% for high conviction, 20% hard maximum.",
          "For research and education only. Not investment advice.",
        ],
      });
    }

    // ── Macro desk: regime + sentiment → concrete sleeve and group targets ──
    if (mode === "macro") {
      const holdings = await loadHoldings().catch(() => []);
      const spy = await dailyCandles("SPY", 400).catch(() => [] as Candle[]);
      const regime = spy.length ? assessRegime(spy) : null;

      // Sentiment inputs and the theme proxies, fetched together.
      const extra: Record<string, Candle[]> = {};
      await Promise.all(
        ["^VIX", "TLT", "HYG", "LQD", "RSP", ...THEME_PROXIES].map(async (t) => {
          const c = await dailyCandles(t, 300).catch(() => [] as Candle[]);
          if (c.length) extra[t] = c;
        })
      );
      const ranked = spy.length ? rankGroups(extra, spy) : [];

      const fearGreed = await readFearGreed({
        spy,
        vix: extra["^VIX"],
        tlt: extra["TLT"],
        hyg: extra["HYG"],
        lqd: extra["LQD"],
        rsp: extra["RSP"],
        sectors: THEME_PROXIES.map((t) => extra[t]).filter(Boolean),
      });

      // Where the book actually sits, by sleeve and by sector.
      const prices: Record<string, number | null> = {};
      await Promise.all(
        Array.from(new Set(holdings.map((h) => h.ticker))).map(async (t) => {
          const q = await getLightQuote(t).catch(() => null);
          prices[t] = q?.price ?? null;
        })
      );
      const sectorMap = holdings.length ? await getSectors(holdings.map((h) => h.ticker)).catch(() => ({})) : {};
      const nav = holdings.reduce((s, h) => s + (prices[h.ticker] ?? h.avg_cost) * h.shares, 0);

      const sleeveValue: Record<string, number> = {};
      const sectorValue: Record<string, number> = {};
      for (const h of holdings) {
        const v = (prices[h.ticker] ?? h.avg_cost) * h.shares;
        const yieldPct = await forwardYield(h.ticker, prices[h.ticker] ?? null);
        const sleeve = sleeveOf(h.ticker, yieldPct, null);
        sleeveValue[sleeve] = (sleeveValue[sleeve] ?? 0) + v;
        const sec = (sectorMap as any)[h.ticker.toUpperCase()]?.sector;
        if (sec) sectorValue[sec] = (sectorValue[sec] ?? 0) + v;
      }
      const pctOf = (m: Record<string, number>) =>
        Object.fromEntries(Object.entries(m).map(([k, v]) => [k, nav > 0 ? (v / nav) * 100 : 0]));

      const plan = buildMacroPlan({
        regime, fearGreed, ranked, nav,
        currentSleevePct: pctOf(sleeveValue),
        currentSectorPct: pctOf(sectorValue),
      });

      // News is a third, independent read. A failure here must not cost the
      // macro plan, so it degrades to null and the desk says the feeds were
      // unreachable rather than returning an error for the whole page.
      const pulse = await buildNewsPulse().catch(() => null);
      const outlook = pulse ? buildOutlook({ regime, fearGreed, pulse }) : null;

      return NextResponse.json({
        mode, nav: Math.round(nav * 100) / 100, plan, themes: ranked, fund: FUND,
        news: pulse, outlook,
        disclosures: [
          "The regime score and the sentiment reading are separate inputs: the regime measures where the market is, sentiment measures how crowded that position is. Sentiment tilts the allocation; it never changes the regime score.",
          fearGreed.source === "CNN Fear & Greed Index"
            ? "Sentiment is CNN's published Fear & Greed Index."
            : "Sentiment is a proxy computed from free price feeds — CNN's index was unreachable. It is not a reconstruction of that index; two of its components have no free source and are absent rather than estimated.",
          "Group targets are derived from proxy-ETF relative strength. A leading proxy does not mean every name inside the group is leading.",
          pulse
            ? `News read from ${pulse.sourcesOk} of ${pulse.sourcesTotal} public feeds, ${pulse.classified} of ${pulse.total} headlines classified (${pulse.coveragePct}%). It is a keyword lexicon, not a language model: it reads what is being discussed and how the wording leans, never whether a story is true or already priced.`
            : "The news feeds could not be reached from this host, so the narrative read is absent. The regime and sentiment reads are unaffected.",
          "News changes the pace and sequence of decisions already taken. It never changes a sleeve target, a position cap, or a score.",
          "Release dates in the calendar are projected from published conventions and marked [E]. FOMC is given at month resolution only — the committee sets the date and it is not guessed here.",
          "For research and education only. Not investment advice.",
        ],
      });
    }

    // ── Watchlist: rank every name through the scoring model ──
    if (mode === "watchlist") {
      const watch = await loadWatchlist();
      if (!watch.length) {
        return NextResponse.json({ error: "Watchlist is empty — add a ticker first." }, { status: 400 });
      }
      const spy = await dailyCandles("SPY", 300).catch(() => [] as Candle[]);
      const regime = spy.length ? assessRegime(spy) : null;
      const rows: any[] = [];
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
          // Priya's SAMP engine as a second, independent read
          const samp = runSAMP(candles, { profile: "Precision" });
          rows.push({
            ticker: w.ticker,
            reason: w.reason ?? null,
            alertPrice: w.alert_price ?? null,
            price: Math.round(price * 100) / 100,
            score: score.total,
            signal: score.signal,
            samp: samp
              ? {
                  direction: samp.direction,
                  strength: samp.strength,
                  acceleration: samp.acceleration,
                  regime: samp.regime,
                  longQuality: samp.longQuality,
                  state: samp.state,
                  strongBull: samp.strongBull,
                  strongBear: samp.strongBear,
                  earlyBull: samp.earlyBull,
                  watchLong: samp.watchLong,
                  lastSignal: samp.lastSignal,
                  barsSinceLastSignal: samp.barsSinceLastSignal,
                }
              : null,
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

    return NextResponse.json({ error: "Unknown mode. Expected ticker | portfolio | valuation | macro | watchlist." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Team analysis failed" }, { status: 500 });
  }
}
