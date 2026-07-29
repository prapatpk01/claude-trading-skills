// Sentinel Global Fund — investment committee memo builder.
//
// Runs the fund's own framework over real data and attributes each section to
// the desk that owns it. Deterministic: no external model, no invented facts.
// Anything the free data feed cannot verify is reported as unavailable rather
// than estimated (Rule #5).

import type { MarketData } from "../types";
import { scoreMomentumV3, atrStop, type MomentumScoreV3 } from "./scoring";
import { assessRegime, runGates, type RegimeAssessment, type GateResult } from "./governance";
import { assessPositionZone, sizeByRisk, checkRiskCaps, type ZoneAssessment, type RiskCheck } from "./risk";
import { classifySleeve, type Sleeve } from "./portfolio";
import { ROSTER, FUND } from "./roster";

export interface DeskNote {
  member: string;
  role: string;
  heading: string;
  bullets: string[];
  verdict?: string;
}

export interface TickerMemo {
  ticker: string;
  name: string;
  asOf: string;
  price: number;
  regime: RegimeAssessment;
  score: MomentumScoreV3;
  gates: GateResult;
  sleeve: Sleeve;
  stop: { stop: number; atr: number } | null;
  suggestedShares: number | null;
  riskChecks: RiskCheck[];
  zone: ZoneAssessment | null;
  desks: DeskNote[];
  verdict: {
    signal: string;
    headline: string;
    detail: string;
  };
  disclosures: string[];
}

const pct = (v: number | null | undefined, d = 1) => (v == null ? "n/a" : `${v.toFixed(d)}%`);
const money = (v: number | null | undefined, d = 2) => (v == null ? "n/a" : `$${v.toFixed(d)}`);
const bn = (v: number | null | undefined) => {
  if (v == null) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
};

export interface MemoInput {
  data: MarketData;
  /** NAV of the book, used for sizing and the concentration zone. */
  nav?: number | null;
  /** Existing weight of this name in the book, when already held. */
  currentWeightPct?: number | null;
  /** Forward yield estimate for sleeve classification. */
  yieldPct?: number | null;
  dcfFairValue?: number | null;
  dcfUpsidePct?: number | null;
  targetPrice?: number | null;
  upsidePct?: number | null;
}

export function buildTickerMemo(input: MemoInput): TickerMemo {
  const { data } = input;
  const price = data.quote?.price ?? data.candles[data.candles.length - 1]?.close ?? 0;
  const ov = data.overview;

  const regime = assessRegime(data.benchmarkCandles);
  const score = scoreMomentumV3({
    candles: data.candles,
    benchmark: data.benchmarkCandles,
    beta: ov?.beta ?? null,
  });

  const stop = atrStop(data.candles, price, 2);
  const nav = input.nav ?? null;
  const suggestedShares = nav && stop ? sizeByRisk(nav, price, stop.stop, 1.5) : null;
  const riskChecks =
    nav && stop && suggestedShares != null
      ? checkRiskCaps(nav, price, stop.stop, suggestedShares)
      : [];
  const zone =
    nav && input.currentWeightPct != null
      ? assessPositionZone(input.currentWeightPct, (input.currentWeightPct / 100) * nav, nav)
      : null;

  const sleeve = classifySleeve(data.ticker, input.yieldPct ?? null, ov?.beta ?? null);

  const gates = runGates({
    regime,
    score,
    positionWeightPct: input.currentWeightPct ?? null,
    stop: stop?.stop ?? null,
    entry: price,
    dataQualityScore: score.dataQualityScore,
  });

  // ── Desk notes ────────────────────────────────────────────────────
  const desks: DeskNote[] = [];

  // Daniel Cho — macro
  desks.push({
    member: ROSTER.daniel.name,
    role: ROSTER.daniel.role,
    heading: `Macro regime ${regime.icon} ${regime.regime} — ${regime.score}/100`,
    bullets: [
      ...regime.components.map((c) => `${c.label}: ${c.points}/${c.max} — ${c.detail}`),
      `Cash floor for this regime: ${regime.cashMinPct}%. ${regime.deployRule}.`,
    ],
    verdict: regime.note,
  });

  // Sofia Reyes — fundamentals
  const sofiaBullets: string[] = [];
  if (ov) {
    sofiaBullets.push(`Sector: ${ov.sector} · ${ov.industry}`);
    sofiaBullets.push(`Market cap ${bn(ov.marketCap)} · P/E ${ov.peRatio?.toFixed(1) ?? "n/a"} · P/S ${ov.priceToSales?.toFixed(2) ?? "n/a"}`);
    sofiaBullets.push(
      `Profitability: net margin ${ov.profitMargin != null ? pct(ov.profitMargin * 100) : "n/a"} · operating margin ${ov.operatingMargin != null ? pct(ov.operatingMargin * 100) : "n/a"} · ROE ${ov.roe != null ? pct(ov.roe * 100) : "n/a"}`
    );
  }
  const inc = data.financials.income;
  if (inc.length >= 2) {
    const r0 = Number(inc[0].totalRevenue) || 0;
    const r1 = Number(inc[1].totalRevenue) || 0;
    const g = r1 > 0 ? ((r0 - r1) / r1) * 100 : null;
    sofiaBullets.push(`Revenue ${bn(r0)} in the latest fiscal year, ${g != null ? `${g >= 0 ? "+" : ""}${g.toFixed(1)}% year over year` : "growth not computable"}`);
  } else {
    sofiaBullets.push("Annual statements unavailable from the filing feed — fundamental scoring withheld [U]");
  }
  const quality =
    ov?.roe != null && ov.roe > 0.15 && ov?.profitMargin != null && ov.profitMargin > 0.1
      ? "Business quality screens as strong on returns and margin."
      : ov?.roe != null
      ? "Business quality is mixed on the return/margin screen."
      : "Insufficient verified fundamentals to grade business quality.";
  desks.push({
    member: ROSTER.sofia.name,
    role: ROSTER.sofia.role,
    heading: "Business quality & thesis",
    bullets: sofiaBullets,
    verdict: quality,
  });

  // Marcus Webb — earnings trend
  const marcusBullets: string[] = [];
  const q = data.quarters ?? [];
  if (q.length) {
    for (const row of q.slice(0, 4)) {
      marcusBullets.push(
        `${row.end}: revenue ${bn(row.revenue)}${row.revenueYoY != null ? ` (${row.revenueYoY >= 0 ? "+" : ""}${(row.revenueYoY * 100).toFixed(1)}% YoY)` : ""}, net margin ${row.netMargin != null ? pct(row.netMargin * 100) : "n/a"}, EPS ${money(row.eps)}`
      );
    }
    const yoys = q.map((x) => x.revenueYoY).filter((x): x is number => x != null);
    if (yoys.length >= 2) {
      marcusBullets.push(
        yoys[0] > yoys[1]
          ? "Revenue growth accelerated versus the prior quarter — positive revision momentum."
          : "Revenue growth decelerated versus the prior quarter — watch estimate revisions."
      );
    }
  } else {
    marcusBullets.push("Quarterly filings unavailable — earnings trend withheld [U]");
  }
  desks.push({
    member: ROSTER.marcus.name,
    role: ROSTER.marcus.role,
    heading: "Earnings trend & revision momentum",
    bullets: marcusBullets,
  });

  // Maya Chen — momentum scoring
  desks.push({
    member: ROSTER.maya.name,
    role: ROSTER.maya.role,
    heading: `${FUND.scoringVersion} — ${score.total}/100 → ${score.signal}`,
    bullets: [
      ...score.lines.map((l) => `[${l.phase}] ${l.label}: ${l.points}/${l.max} — ${l.detail} [${l.flag}]`),
      ...(score.hardBlocks.length
        ? score.hardBlocks.map((b) => `❌ HARD BLOCK ${b.code}: ${b.reason}`)
        : ["No hard blocks triggered."]),
    ],
    verdict: score.signalReason,
  });

  // Aisha Fontaine — catalyst
  desks.push({
    member: ROSTER.aisha.name,
    role: ROSTER.aisha.role,
    heading: "Catalyst & event risk",
    bullets: [
      data.earnings.length
        ? `Most recent reported quarter ${data.earnings[0].fiscalDate}${data.earnings[0].surprisePercent != null ? `, surprise ${data.earnings[0].surprisePercent >= 0 ? "+" : ""}${data.earnings[0].surprisePercent.toFixed(1)}%` : ""}`
        : "No consensus/surprise history in the free feed — PEAD not scorable [U]",
      "Scheduled catalyst dates (FOMC/CPI/NFP, product events, company guidance) are not present in the free data feed — Rule #2 staggering must be confirmed manually before deployment.",
      "Earnings blackout (Rule: reject inside 5 days) cannot be enforced automatically without a verified earnings calendar.",
    ],
    verdict: "Catalyst layer scored conservatively — no unverified catalyst has been credited.",
  });

  // Thomas Eriksson — valuation
  const thomasBullets: string[] = [];
  if (input.dcfFairValue != null) {
    thomasBullets.push(`DCF fair value ${money(input.dcfFairValue)} versus spot ${money(price)} (${input.dcfUpsidePct != null ? `${input.dcfUpsidePct >= 0 ? "+" : ""}${input.dcfUpsidePct.toFixed(1)}%` : "n/a"})`);
  }
  if (input.targetPrice != null) {
    thomasBullets.push(`Blended scenario target ${money(input.targetPrice)} (${input.upsidePct != null ? `${input.upsidePct >= 0 ? "+" : ""}${input.upsidePct.toFixed(1)}%` : "n/a"})`);
  }
  if (ov?.analystTargetPrice != null) thomasBullets.push(`Street target ${money(ov.analystTargetPrice)}`);
  if (!thomasBullets.length) thomasBullets.push("Valuation inputs unavailable [U]");
  const mos =
    input.upsidePct != null
      ? input.upsidePct >= 25
        ? "Margin of safety adequate."
        : input.upsidePct >= 10
        ? "Margin of safety thin."
        : "No margin of safety at spot."
      : "Margin of safety not assessable.";
  desks.push({
    member: ROSTER.thomas.name,
    role: ROSTER.thomas.role,
    heading: "Valuation & margin of safety",
    bullets: thomasBullets,
    verdict: mos,
  });

  // Kai Tanaka — risk
  const kaiBullets: string[] = [];
  if (stop) {
    kaiBullets.push(`Rule #4 stop: ${money(stop.stop)} = entry ${money(price)} − 2 × ATR(14) ${stop.atr.toFixed(2)}`);
    kaiBullets.push(`Risk per share ${money(price - stop.stop)} (${pct(((price - stop.stop) / price) * 100)} of entry)`);
  } else {
    kaiBullets.push("ATR unavailable — no stop can be set, so Rule #4 blocks execution [U]");
  }
  if (nav && suggestedShares != null) {
    kaiBullets.push(`At 1.5% NAV risk on a ${bn(nav)} book: ${suggestedShares} shares (${money(suggestedShares * price)}, ${pct((suggestedShares * price / nav) * 100)} of NAV)`);
  } else {
    kaiBullets.push("No NAV supplied — position sizing deferred. Add holdings to size against the real book.");
  }
  for (const c of riskChecks) kaiBullets.push(`${c.pass ? "✅" : "❌"} ${c.label}: ${c.detail}`);
  if (zone) kaiBullets.push(`${zone.icon} Current weight ${pct(zone.weightPct, 2)} — ${zone.zone} zone. ${zone.action}`);
  desks.push({
    member: ROSTER.kai.name,
    role: ROSTER.kai.role,
    heading: "Position sizing & stop",
    bullets: kaiBullets,
  });

  // Lena Müller — portfolio fit
  desks.push({
    member: ROSTER.lena.name,
    role: ROSTER.lena.role,
    heading: "Portfolio fit",
    bullets: [
      `Classified to the ${sleeve} sleeve${input.yieldPct != null ? ` on a ${pct(input.yieldPct)} forward yield` : ""}.`,
      `Sleeve targets — Growth/Momentum 55%, Income/Dividend 30%, Cash/Defensive 13%. Rule #7 alerts on drift beyond 5 points.`,
      input.currentWeightPct != null
        ? `Already held at ${pct(input.currentWeightPct, 2)} of NAV.`
        : "Not currently held — a new position would consume cash-sleeve capacity.",
    ],
  });

  // Miriam Osei — compliance
  desks.push({
    member: ROSTER.miriam.name,
    role: ROSTER.miriam.role,
    heading: `Pre-trade gates — ${gates.passed}/${gates.evaluated} evaluable gates pass`,
    bullets: gates.gates.map(
      (g) => `${g.pass === true ? "✅" : g.pass === false ? "❌" : "⏸"} Gate ${g.n} (${g.owner}) — ${g.label}: ${g.detail}`
    ),
    verdict: gates.verdict,
  });

  // James Hartwell — CIO verdict
  const cioHeadline = !gates.cleared
    ? "HOLD — gate failure"
    : score.signal === "STRONG BUY"
    ? "APPROVE — full size, subject to sign-off"
    : score.signal === "BUY"
    ? "APPROVE — staggered entry, subject to sign-off"
    : score.signal === "SOFT-BLOCK WATCH"
    ? "WATCH — soft-block under Rule #1"
    : score.signal === "WATCH"
    ? "WATCH — await confirmation"
    : "REJECT";

  desks.push({
    member: ROSTER.james.name,
    role: ROSTER.james.role,
    heading: `CIO verdict — ${cioHeadline}`,
    bullets: [
      `Momentum ${score.total}/100 → ${score.signal}. Regime ${regime.score}/100 → ${regime.regime}.`,
      gates.verdict,
      stop ? `Stop is defined at ${money(stop.stop)}; no order may be worked without it.` : "No stop available — execution is barred by Rule #4.",
    ],
    verdict:
      "Gate 9 is a manual authorisation. This system never self-approves a deployment — it prepares the decision.",
  });

  return {
    ticker: data.ticker,
    name: ov?.name ?? data.ticker,
    asOf: new Date().toISOString(),
    price,
    regime,
    score,
    gates,
    sleeve,
    stop,
    suggestedShares,
    riskChecks,
    zone,
    desks,
    verdict: {
      signal: score.signal,
      headline: cioHeadline,
      detail: gates.cleared ? score.signalReason : gates.verdict,
    },
    disclosures: [
      "Win-rate figures are Component Estimates, not live backtests (Rule #6) — the fund requires ≥100 live trades before quoting a verified rate.",
      "Data marked [U] scores zero and is never estimated (Rule #5).",
      "Scheduled macro and earnings dates are not available from the free data feed; Rule #2 staggering and the 5-day earnings blackout must be confirmed manually.",
      "For research and education only. Not investment advice.",
    ],
  };
}
