// Sentinel Global Fund — book-level review (Lena Müller, Kai Tanaka,
// Miriam Osei, James Hartwell) applied to the user's own holdings.

import { buildSleeves, dualObjectiveScorecard, blendedYield, correlationFlags, type HoldingLike, type SleeveRow, type DualObjective } from "./portfolio";
import { assessIncomeYield, INCOME_POLICY } from "./constitution";
import { assessPositionZone, type ZoneAssessment } from "./risk";
import { assessRegime, type RegimeAssessment } from "./governance";
import { ROSTER } from "./roster";
import type { Candle } from "../types";
import type { DeskNote } from "./memo";

/**
 * A risk anyone on the desk can put on the record.
 *
 * The fund's primary job is running the book together, so risk is not one
 * person's column. Any desk that measures something worrying files it here with
 * the evidence, and the register is what the meeting works through — a CRO who
 * is the only person allowed to see risk is a single point of failure.
 */
export interface RiskItem {
  raisedBy: string;
  role: string;
  severity: "high" | "medium" | "low";
  item: string;
  /** The measurement behind it. A risk without evidence is an opinion. */
  evidence: string;
  suggestedAction: string;
}

/** Every seat, and what it tabled — including the seats with nothing to add. */
export interface RoundTableEntry {
  member: string;
  role: string;
  desk: string;
  tabled: boolean;
  view: string;
}

export interface BookReview {
  asOf: string;
  nav: number;
  regime: RegimeAssessment | null;
  sleeves: SleeveRow[];
  objectives: DualObjective[];
  blendedYieldPct: number | null;
  yieldRows: { ticker: string; weightPct: number; yieldPct: number; contribution: number }[];
  zones: (ZoneAssessment & { ticker: string })[];
  cashPct: number;
  cashRequiredPct: number | null;
  correlations: { a: string; b: string; correlation: number }[];
  desks: DeskNote[];
  /** Everyone's view on the book, tabled or explicitly withheld. */
  roundTable: RoundTableEntry[];
  /** Risks filed by any desk, most severe first. */
  riskRegister: RiskItem[];
  actions: string[];
  disclosures: string[];
}

const pct = (v: number | null | undefined, d = 2) => (v == null ? "n/a" : `${v.toFixed(d)}%`);
const money = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export interface BookInput {
  holdings: HoldingLike[];
  benchmark: Candle[];
  /** Daily closes per ticker, for the correlation matrix. */
  closesByTicker?: Record<string, number[]>;
  /** Full candles per ticker, so the momentum, quant and execution desks can
   *  measure trend, volatility and liquidity rather than sit the meeting out. */
  candlesByTicker?: Record<string, Candle[]>;
  portfolioReturnPct?: number | null;
  spyReturnPct?: number | null;
}

export function buildBookReview(input: BookInput): BookReview {
  const { holdings } = input;
  const { rows: sleeves, nav } = buildSleeves(holdings);
  const { blended, rows: yieldRows } = blendedYield(holdings);
  const income = assessIncomeYield(blended);
  const objectives = dualObjectiveScorecard(
    input.portfolioReturnPct ?? null,
    input.spyReturnPct ?? null,
    blended
  );
  const regime = input.benchmark.length ? assessRegime(input.benchmark) : null;

  const zones = holdings
    .map((h) => {
      const value = (h.price ?? h.avg_cost) * h.shares;
      const weightPct = nav > 0 ? (value / nav) * 100 : 0;
      return { ticker: h.ticker, ...assessPositionZone(weightPct, value, nav) };
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  const cashRow = sleeves.find((s) => s.sleeve === "Cash/Defensive");
  const cashPct = cashRow?.actualPct ?? 0;
  const cashRequiredPct = regime?.cashMinPct ?? null;

  const correlations = input.closesByTicker
    ? correlationFlags(
        Object.fromEntries(
          Object.entries(input.closesByTicker).map(([t, closes]) => {
            const rets: number[] = [];
            for (let i = 1; i < closes.length; i++) {
              if (closes[i - 1] > 0) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
            }
            return [t, rets];
          })
        )
      )
    : [];

  // ── Desk notes ────────────────────────────────────────────────────
  const desks: DeskNote[] = [];
  const actions: string[] = [];

  if (regime) {
    desks.push({
      member: ROSTER.daniel.name,
      role: ROSTER.daniel.role,
      heading: `Macro regime ${regime.icon} ${regime.regime} — ${regime.score}/100`,
      bullets: [
        ...regime.components.map((c) => `${c.label}: ${c.points}/${c.max} — ${c.detail}`),
        `Cash floor for this regime: ${regime.cashMinPct}% (book currently ${pct(cashPct)}).`,
      ],
      verdict: regime.note,
    });
    if (cashRequiredPct != null && cashPct < cashRequiredPct) {
      actions.push(
        `Raise the cash/defensive sleeve to at least ${cashRequiredPct}% — currently ${pct(cashPct)} against a ${regime.regime} regime.`
      );
    }
  }

  // Lena — sleeve balance and objectives
  const lenaBullets = sleeves.map(
    (s) =>
      `${s.alert ? "🔔" : "•"} ${s.sleeve}: ${pct(s.actualPct)} vs ${s.targetPct}% target (drift ${s.driftPct >= 0 ? "+" : ""}${s.driftPct.toFixed(2)} pts)${s.tickers.length ? ` — ${s.tickers.join(", ")}` : " — empty"}`
  );
  lenaBullets.push(`NAV ${money(nav)} across ${holdings.length} position${holdings.length === 1 ? "" : "s"}.`);
  if (blended != null) {
    lenaBullets.push(
      `Blended forward income ${pct(blended)} — ${income.label}. Preferred ${INCOME_POLICY.targetMinPct.toFixed(2)}–${INCOME_POLICY.targetMaxPct.toFixed(2)}%, soft floor ${INCOME_POLICY.softFloorPct.toFixed(2)}%.`
    );
    lenaBullets.push("Total return has priority over distribution yield; no asset is bought or retained solely to manufacture the income target.");
  }
  desks.push({
    member: ROSTER.lena.name,
    role: ROSTER.lena.role,
    heading: "Sleeve balance & dual objectives",
    bullets: lenaBullets,
    verdict: objectives
      .map((o) => `${o.pass === true ? "✅" : o.pass === false ? "⚠️" : "⏸"} ${o.label}: ${o.actual} vs ${o.target} — ${o.status}`)
      .join(" | "),
  });
  for (const s of sleeves) {
    if (s.alert) {
      actions.push(
        `Rule #7 drift alert — ${s.sleeve} is ${s.driftPct >= 0 ? "over" : "under"} target by ${Math.abs(s.driftPct).toFixed(2)} points (${pct(s.actualPct)} vs ${s.targetPct}%). Rebalance at the next review.`
      );
    }
  }
  if (income.status === "BELOW_FLOOR") {
    actions.push(
      `Income soft-floor review — blended income ${pct(blended)} is below ${INCOME_POLICY.softFloorPct.toFixed(2)}%. Income Team must propose a path toward ${INCOME_POLICY.targetMinPct.toFixed(2)}–${INCOME_POLICY.targetMaxPct.toFixed(2)}%, but must not sacrifice expected total return or buy yield solely to close the gap.`
    );
  } else if (income.status === "REVIEW_HIGH") {
    actions.push(
      `High-distribution review — blended income ${pct(blended)} is above ${INCOME_POLICY.reviewHighPct.toFixed(2)}%. Review distribution source, sustainability and upside sacrificed; higher yield is not automatically better and does not require a sale by itself.`
    );
  }

  // Kai — concentration
  const kaiBullets = zones.map(
    (z) => `${z.icon} ${z.ticker}: ${pct(z.weightPct)} — ${z.zone}. ${z.action}${z.trimToTarget ? ` Trim ≈ ${money(z.trimToTarget)}.` : ""}`
  );
  if (correlations.length) {
    kaiBullets.push(
      ...correlations.slice(0, 5).map((c) => `⚠️ ${c.a} / ${c.b} correlation ${c.correlation.toFixed(2)} — above the 0.7 flag`)
    );
  } else if (input.closesByTicker) {
    kaiBullets.push("No position pair exceeds the 0.7 correlation flag.");
  }
  desks.push({
    member: ROSTER.kai.name,
    role: ROSTER.kai.role,
    heading: "Concentration & correlation (Rule #3)",
    bullets: kaiBullets.length ? kaiBullets : ["No positions to assess."],
  });
  for (const z of zones) {
    if (z.zone === "EMERGENCY") actions.push(`🚨 ${z.ticker} at ${pct(z.weightPct)} — trim immediately to the 18-19% band.`);
    else if (z.zone === "TRIM") actions.push(`🔴 ${z.ticker} at ${pct(z.weightPct)} — mandatory trim, but Research must identify a replacement first (Rule #3).`);
    else if (z.zone === "WATCH") actions.push(`⚠️ ${z.ticker} at ${pct(z.weightPct)} — review at the meeting; trim or hold on the macro read.`);
  }

  // Miriam — governance
  const miriamBullets: string[] = [];
  const priced = holdings.filter((h) => h.price != null).length;
  miriamBullets.push(`Pricing verified for ${priced}/${holdings.length} positions [${priced === holdings.length ? "V" : "E"}].`);
  miriamBullets.push(
    holdings.some((h) => h.yieldPct == null)
      ? "Some positions have no verified distribution history — their yield contribution is scored zero, not estimated (Rule #5)."
      : "Distribution history present for every position."
  );
  miriamBullets.push("Cost basis is user-supplied and unaudited [E] until reconciled against a broker statement.");
  desks.push({
    member: ROSTER.miriam.name,
    role: ROSTER.miriam.role,
    heading: "Data integrity & governance",
    bullets: miriamBullets,
  });

  // James — CIO
  const reviewCount = objectives.filter((o) => o.pass === false).length;
  desks.push({
    member: ROSTER.james.name,
    role: ROSTER.james.role,
    heading: `CIO review — ${actions.length ? `${actions.length} action${actions.length > 1 ? "s" : ""} outstanding` : "book within policy"}`,
    bullets: [
      `NAV ${money(nav)} · ${holdings.length} positions · blended income ${pct(blended)} (${income.label}).`,
      reviewCount
        ? `${reviewCount} of 2 objectives require review; an income review is not automatically a direction to raise yield.`
        : "Both objectives are acceptable where measurable.",
      actions.length ? "Actions are listed below in priority order." : "No rebalancing action required this review.",
    ],
  });

  // ══ The committee round table ═══════════════════════════════════════
  const riskRegister: RiskItem[] = [];
  const roundTable: RoundTableEntry[] = [];
  const candles = input.candlesByTicker ?? {};
  const file = (
    who: { name: string; role: string },
    severity: RiskItem["severity"],
    item: string, evidence: string, suggestedAction: string
  ) => riskRegister.push({ raisedBy: who.name, role: who.role, severity, item, evidence, suggestedAction });
  const table = (who: { name: string; role: string; desk: string }, view: string, tabled = true) =>
    roundTable.push({ member: who.name, role: who.role, desk: who.desk, tabled, view });

  const weightOf = (t: string) => {
    const h = holdings.find((x) => x.ticker === t);
    if (!h || !nav) return 0;
    return (((h.price ?? h.avg_cost) * h.shares) / nav) * 100;
  };

  // ── Maya Chen — is the book still in uptrends? ──
  {
    const reads = holdings
      .map((h) => {
        const c = candles[h.ticker];
        if (!c || c.length < 200) return null;
        const closes = c.map((x) => x.close);
        const last = closes[closes.length - 1];
        const ma200 = closes.slice(-200).reduce((a, b) => a + b, 0) / 200;
        const ma50 = closes.slice(-50).reduce((a, b) => a + b, 0) / 50;
        return { ticker: h.ticker, above200: last > ma200, above50: last > ma50, weight: weightOf(h.ticker) };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (reads.length) {
      const broken = reads.filter((r) => !r.above200);
      const brokenWeight = broken.reduce((s, r) => s + r.weight, 0);
      table(ROSTER.maya,
        `${reads.length - broken.length} of ${reads.length} measurable positions hold above their own 200-day average. ` +
        (broken.length
          ? `Below it: ${broken.map((b) => `${b.ticker} (${b.weight.toFixed(1)}% of NAV)`).join(", ")} — ${brokenWeight.toFixed(1)}% of the book in broken trends.`
          : "No position is in a broken trend."));
      if (brokenWeight >= 15) {
        file(ROSTER.maya, brokenWeight >= 30 ? "high" : "medium",
          "Trend damage across a material share of the book",
          `${brokenWeight.toFixed(1)}% of NAV sits in names trading below their own 200-day average (${broken.map((b) => b.ticker).join(", ")}).`,
          "Review each broken name against its thesis. v4 §5: a broken structure with growth intact blocks new entries, not the holding — but the aggregate is a regime signal in its own right.");
      }
    } else {
      table(ROSTER.maya, "No position has 200 sessions of price history in this review, so no trend read is possible. Two hundred daily bars per holding would give one.", false);
    }
  }

  // ── Priya Nair — realised risk, measured ──
  {
    const rets: Record<string, number[]> = {};
    for (const [t, closes] of Object.entries(input.closesByTicker ?? {})) {
      const r: number[] = [];
      for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
      if (r.length > 20) rets[t] = r;
    }
    const betaWeighted = holdings.reduce((sum, h) => {
      const b = (h as any).beta;
      return b != null && nav ? sum + b * (weightOf(h.ticker) / 100) : sum;
    }, 0);
    const withBeta = holdings.filter((h) => (h as any).beta != null).length;
    const bits: string[] = [];
    if (withBeta) {
      bits.push(`Beta-weighted exposure ${betaWeighted.toFixed(2)} across the ${withBeta} position${withBeta === 1 ? "" : "s"} with a measurable beta — a 10% index fall implies roughly ${(betaWeighted * 10).toFixed(1)}% on that share of the book.`);
    }
    if (input.portfolioReturnPct != null && input.spyReturnPct != null) {
      const diff = input.portfolioReturnPct - input.spyReturnPct;
      bits.push(`Book ${input.portfolioReturnPct >= 0 ? "+" : ""}${input.portfolioReturnPct.toFixed(1)}% against SPY ${input.spyReturnPct >= 0 ? "+" : ""}${input.spyReturnPct.toFixed(1)}% over the common window — ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} points.`);
    }
    if (correlations.length) bits.push(`${correlations.length} position pair(s) correlate above 0.70; the highest is ${correlations[0].a}/${correlations[0].b} at ${correlations[0].correlation.toFixed(2)}.`);
    table(ROSTER.priya, bits.length ? bits.join(" ") : "Neither beta nor a common return window was measurable this review, so no quantitative read is tabled.", bits.length > 0);
    if (withBeta >= 2 && betaWeighted > 1.3) {
      file(ROSTER.priya, betaWeighted > 1.6 ? "high" : "medium",
        "Beta-weighted exposure above the book's risk budget",
        `Beta-weighted exposure ${betaWeighted.toFixed(2)} across ${withBeta} measurable positions.`,
        "Either reduce the highest-beta names or raise cash. Conviction does not lower beta; size does.");
    }
    if (correlations.length >= 3) {
      file(ROSTER.priya, "medium",
        "Diversification is thinner than the position count suggests",
        `${correlations.length} pairs above 0.70 correlation — ${correlations.slice(0, 3).map((c) => `${c.a}/${c.b} ${c.correlation.toFixed(2)}`).join(", ")}.`,
        "Treat the correlated cluster as one position for sizing. Ten names that move together is one bet held ten ways.");
    }
  }

  // ── Ryan Blackwood — can the book actually be traded? ──
  {
    const liquidity = holdings
      .map((h) => {
        const c = candles[h.ticker];
        if (!c || c.length < 20) return null;
        const recent = c.slice(-20);
        const advDollar = recent.reduce((s, x) => s + x.close * x.volume, 0) / recent.length;
        const positionValue = (h.price ?? h.avg_cost) * h.shares;
        if (!(advDollar > 0)) return null;
        return { ticker: h.ticker, days: positionValue / (advDollar * 0.2), advDollar, positionValue };
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    if (liquidity.length) {
      const worst = liquidity.slice().sort((a, b) => b.days - a.days)[0];
      table(ROSTER.ryan,
        `Every measurable position can be exited inside ${Math.max(...liquidity.map((l) => l.days)).toFixed(2)} session(s) at a fifth of its 20-day average dollar volume. ` +
        `Least liquid relative to size: ${worst.ticker} at ${worst.days.toFixed(2)} session(s).`);
      const illiquid = liquidity.filter((l) => l.days > 1);
      if (illiquid.length) {
        file(ROSTER.ryan, illiquid.some((l) => l.days > 3) ? "high" : "medium",
          "Position size is large against traded volume",
          illiquid.map((l) => `${l.ticker}: ${l.days.toFixed(1)} sessions to exit at 20% of ADV`).join("; "),
          "Scale the exit over several sessions, or cap the position at a size one session can clear. A stop you cannot fill is not a stop.");
      }
    } else {
      table(ROSTER.ryan, "No volume history reached this review, so tradeability could not be assessed. Twenty daily bars with volume per holding would give a read.", false);
    }
  }

  // ── Nina Okonkwo & Leo Tanaka — what the data itself says ──
  {
    const dated = Object.entries(candles)
      .map(([t, c]) => ({ t, date: c[c.length - 1]?.date ?? null }))
      .filter((x) => x.date);
    const oldest = dated.slice().sort((a, b) => (a.date! < b.date! ? -1 : 1))[0];
    const withPrice = holdings.filter((h) => h.price != null).length;
    const withYield = holdings.filter((h) => h.yieldPct != null).length;
    table(ROSTER.nina,
      `Prices resolved for ${withPrice}/${holdings.length}; distribution history for ${withYield}/${holdings.length}. ` +
      `Anything missing scores zero and is flagged rather than estimated (Rule #5).`);
    if (withPrice < holdings.length) {
      file(ROSTER.nina, "high",
        "NAV is computed with unpriced positions",
        `${holdings.length - withPrice} position(s) fell back to cost basis because no live price resolved.`,
        "Every weight in this review is measured against that NAV, so they are all slightly wrong. Re-run once prices resolve before acting on a drift figure.");
    }
    if (oldest?.date) {
      table(ROSTER.leo,
        `Oldest price in the book is ${oldest.t} at ${oldest.date}. Every weight and drift figure in this review is measured as of that set.`);
    } else {
      table(ROSTER.leo, "No dated price series reached this review, so the as-of position of the book cannot be stated.", false);
    }
  }

  table(ROSTER.sofia,
    "No business-quality read this review: the book pass does not pull filings per holding. The valuation desk's per-position work covers this ground name by name.", false);
  table(ROSTER.marcus,
    "No earnings-trend read this review, for the same reason. Margin direction and revision momentum are in the per-ticker memo instead.", false);
  table(ROSTER.aisha,
    "No catalyst read this review: reporting dates across the book are not fetched here. Worth adding — an earnings calendar clustered into one week is a portfolio risk, not a per-name one.", false);
  table(ROSTER.thomas,
    "No valuation read this review; fair values are produced by the valuation desk per position rather than in the book pass.", false);

  if (regime) {
    table(ROSTER.daniel, `${regime.regime} at ${regime.score}/100, cash floor ${regime.cashMinPct}%. ${regime.note}`);
    if (cashRequiredPct != null && cashPct < cashRequiredPct) {
      file(ROSTER.daniel, "high",
        "Cash below the regime floor",
        `Cash/defensive ${pct(cashPct)} against a ${cashRequiredPct}% floor for a ${regime.regime} regime.`,
        "Raise cash before adding elsewhere. The floor exists so the fund can act in a drawdown rather than watch one.");
    }
  } else {
    table(ROSTER.daniel, "Benchmark history was unavailable, so no regime could be scored this review.", false);
  }
  table(ROSTER.lena,
    `NAV ${money(nav)} across ${holdings.length} position(s); blended forward income ${pct(blended)} — ${income.label}. ` +
    `Preferred ${INCOME_POLICY.targetMinPct.toFixed(2)}–${INCOME_POLICY.targetMaxPct.toFixed(2)}%; total return takes priority over distribution yield. ` +
    sleeves.map((x) => `${x.sleeve} ${pct(x.actualPct)}/${x.targetPct}%`).join(", ") + ".");
  for (const sl of sleeves) {
    if (sl.alert) {
      file(ROSTER.lena, Math.abs(sl.driftPct) >= 10 ? "high" : "medium",
        `${sl.sleeve} sleeve off target`,
        `${pct(sl.actualPct)} against a ${sl.targetPct}% target — ${sl.driftPct >= 0 ? "+" : ""}${sl.driftPct.toFixed(2)} points, past the Rule #7 alert.`,
        "Rebalance at this review, funding the move from the most extended position rather than the weakest thesis.");
    }
  }
  if (income.status === "BELOW_FLOOR") {
    file(ROSTER.lena, "medium",
      "Portfolio income below the soft floor",
      `${pct(blended)} against a ${INCOME_POLICY.softFloorPct.toFixed(2)}% soft floor.`,
      "Propose an income remediation path, but do not force a purchase or retain a weaker asset solely to raise headline yield.");
  } else if (income.status === "REVIEW_HIGH") {
    file(ROSTER.lena, "medium",
      "Portfolio distribution rate above the review threshold",
      `${pct(blended)} is above ${INCOME_POLICY.reviewHighPct.toFixed(2)}%.`,
      "Review distribution composition, sustainability and opportunity cost. A high distribution rate is not automatically a superior total-return allocation.");
  }
  table(ROSTER.kai,
    zones.length
      ? `${zones.length} position(s) assessed for concentration; ${zones.filter((z) => z.zone !== "BASE").length} outside the base band.`
      : "No position reached the concentration bands.");
  for (const z of zones) {
    if (z.zone === "EMERGENCY" || z.zone === "TRIM") {
      file(ROSTER.kai, z.zone === "EMERGENCY" ? "high" : "medium",
        `${z.ticker} concentration — ${z.zone}`,
        `${pct(z.weightPct)} of NAV.`,
        z.action);
    }
  }
  table(ROSTER.miriam,
    `Data integrity: pricing verified for ${holdings.filter((h) => h.price != null).length}/${holdings.length}; cost basis user-supplied and unaudited [E].`);
  file(ROSTER.miriam, "low",
    "Cost basis is unaudited",
    "Entered by hand and never reconciled to a broker statement.",
    "Reconcile before any tax-driven decision. Every unrealised P/L figure in this app inherits the error.");
  table(ROSTER.james,
    actions.length
      ? `${actions.length} action(s) outstanding. The register below is what this meeting works through.`
      : "Book within policy on every measurable rule. No action required this review.");

  const sev = { high: 0, medium: 1, low: 2 };
  riskRegister.sort((a, b) => sev[a.severity] - sev[b.severity]);

  return {
    asOf: new Date().toISOString(),
    nav,
    regime,
    sleeves,
    objectives,
    blendedYieldPct: blended,
    yieldRows,
    zones,
    cashPct,
    cashRequiredPct,
    correlations,
    desks,
    roundTable,
    riskRegister,
    actions,
    disclosures: [
      `Income policy: preferred ${INCOME_POLICY.targetMinPct.toFixed(2)}–${INCOME_POLICY.targetMaxPct.toFixed(2)}%, soft floor ${INCOME_POLICY.softFloorPct.toFixed(2)}%, review above ${INCOME_POLICY.reviewHighPct.toFixed(2)}%; total return has priority and yield chasing is prohibited.`,
      "Sleeve classification is inferred from yield, beta and the fund's own instrument list; override it if a holding belongs elsewhere.",
      "Return figures are computed from current share counts valued back through time, not from a transaction ledger.",
      "Cost basis is user-supplied and unaudited [E].",
      "For research and education only. Not investment advice.",
    ],
  };
}
