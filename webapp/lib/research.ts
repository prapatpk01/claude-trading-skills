// Institutional research inputs the workbook previously left as blanks.
//
// The old sheets asked the reader to fill in TAM, peers and moat strength by
// hand, which makes the workbook a template rather than analysis. Everything
// here is computed from sources the app can actually reach without a key — SEC
// XBRL for fundamentals, the public chart endpoint for price — so the numbers
// are measured, and the things that genuinely cannot be measured are named as
// such instead of being left as a dash the reader might mistake for zero.
//
// The most important honesty call is market sizing. TAM is a research-house
// estimate; there is no free, verifiable source for it, and inventing one would
// be exactly the failure Rule #5 exists to prevent. So this module does not
// report a TAM. It reports something it can defend: the **revenue pool of a
// named peer set**, measured from those companies' own filings, and the
// subject's share of it. That is a real, checkable denominator. It is smaller
// than a true TAM — it excludes private companies and anyone outside the peer
// list — and the output says so every time.

import { getSecFundamentals, type SecFundamentals } from "./sec";
import { dailyCandles } from "./marketData";
import { THEME_MEMBERS } from "./team/thematic";
import type { MarketData, FinancialRow } from "./types";

const num = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const M = 1e6;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

// ── Peer resolution ───────────────────────────────────────────────────
//
// Peers come from the same curated group lists the thematic engine uses, which
// keeps one definition of "who competes with whom" in the codebase. The most
// specific list wins: a semiconductor name is compared against SMH, not against
// the whole of XLK, because the point of a peer table is a like-for-like read.

/** GICS sector → the broad group used when no narrower list contains the name. */
const SECTOR_PROXY: Record<string, string> = {
  "Information Technology": "XLK",
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  Industrials: "XLI",
  Financials: "XLF",
  Energy: "XLE",
  Materials: "XLB",
  "Health Care": "XLV",
  Utilities: "XLU",
  "Real Estate": "XLRE",
};

export interface PeerSet {
  /** Peer tickers, subject excluded. */
  peers: string[];
  /** The group the set was drawn from. */
  group: string;
  basis: string;
}

export function resolvePeers(ticker: string, sector: string | null, max = 6): PeerSet {
  const t = ticker.toUpperCase();
  // Narrowest list containing the subject, so the comparison is like-for-like.
  const containing = Object.entries(THEME_MEMBERS)
    .filter(([, members]) => members.includes(t))
    .sort((a, b) => a[1].length - b[1].length);

  if (containing.length) {
    const [group, members] = containing[0];
    return {
      peers: members.filter((m) => m !== t).slice(0, max),
      group,
      basis: `${t} sits in the ${group} group; the narrowest group containing it was used so the comparison is like-for-like.`,
    };
  }
  const proxy = sector ? SECTOR_PROXY[sector] : undefined;
  if (proxy && THEME_MEMBERS[proxy]) {
    return {
      peers: THEME_MEMBERS[proxy].filter((m) => m !== t).slice(0, max),
      group: proxy,
      basis: `${t} is not in a narrow industry list, so the ${sector} sector group (${proxy}) was used. These are sector peers, not direct competitors.`,
    };
  }
  return {
    peers: [],
    group: "—",
    basis: `No peer group is defined for ${t}${sector ? ` (${sector})` : ""}. The comparison table is empty rather than filled with names that do not compete.`,
  };
}

// ── Peer metrics, all from SEC filings + the public price feed ─────────

export interface PeerRow {
  ticker: string;
  isSubject: boolean;
  price: number | null;
  revenueTTM: number | null;
  netIncomeTTM: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  marketCap: number | null;
  peTTM: number | null;
  /** Revenue CAGR across the annual filings available, in percent. */
  revenueCagrPct: number | null;
  cagrYears: number | null;
  /** Anything that could not be read for this name. */
  gaps: string[];
}

function cagr(rows: FinancialRow[]): { pct: number | null; years: number | null } {
  const revs = rows
    .map((r) => num(r.totalRevenue))
    .filter((v): v is number => v != null && v > 0);
  // rows are newest-first
  if (revs.length < 2) return { pct: null, years: null };
  const latest = revs[0];
  const oldest = revs[revs.length - 1];
  const years = revs.length - 1;
  return { pct: round1((Math.pow(latest / oldest, 1 / years) - 1) * 100), years };
}

function rowFrom(ticker: string, isSubject: boolean, sec: SecFundamentals | null, price: number | null): PeerRow {
  const gaps: string[] = [];
  if (!sec) gaps.push("No SEC XBRL facts — the company may file in another form or not with the SEC at all.");
  if (price == null) gaps.push("No price.");
  const rev = sec?.revenueTTM ?? null;
  const ni = sec?.netIncomeTTM ?? null;
  const gp = sec?.grossProfitTTM ?? null;
  const shares = sec?.sharesOutstanding ?? null;
  const eps = sec?.epsTTM ?? null;
  if (rev == null) gaps.push("Revenue not tagged.");
  if (gp == null && rev != null) gaps.push("Gross profit not tagged — many financials and REITs do not report one.");
  if (shares == null) gaps.push("Share count not tagged, so no market cap.");
  const { pct, years } = sec ? cagr(sec.financials.income) : { pct: null, years: null };
  return {
    ticker,
    isSubject,
    price,
    revenueTTM: rev,
    netIncomeTTM: ni,
    grossMargin: gp != null && rev ? round1((gp / rev) * 100) : null,
    netMargin: ni != null && rev ? round1((ni / rev) * 100) : null,
    marketCap: price != null && shares ? price * shares : null,
    peTTM: price != null && eps && eps > 0 ? round1(price / eps) : null,
    revenueCagrPct: pct,
    cagrYears: years,
    gaps,
  };
}

/** Fetch one peer's comparable metrics. Never throws. */
async function peerRow(ticker: string, isSubject: boolean): Promise<PeerRow> {
  const [sec, candles] = await Promise.all([
    getSecFundamentals(ticker).catch(() => null),
    dailyCandles(ticker, 10).catch(() => []),
  ]);
  const price = candles.length ? candles[candles.length - 1].close : null;
  return rowFrom(ticker, isSubject, sec, price);
}

// ── Market sizing, measured rather than asserted ──────────────────────

export interface MarketSizing {
  /** Sum of TTM revenue across the subject and every peer read. */
  peerPoolRevenue: number | null;
  /** Companies that contributed revenue to the pool. */
  contributors: number;
  /** Companies in the peer set whose revenue could not be read. */
  unreadable: number;
  /** Subject revenue as a share of the pool. */
  subjectSharePct: number | null;
  /** Revenue-weighted CAGR of the pool, from the same filings. */
  poolCagrPct: number | null;
  definition: string;
  limits: string[];
}

export function marketSizing(rows: PeerRow[], group: string): MarketSizing {
  const withRev = rows.filter((r) => r.revenueTTM != null && r.revenueTTM > 0);
  const pool = withRev.reduce((s, r) => s + (r.revenueTTM as number), 0);
  const subject = rows.find((r) => r.isSubject);
  const unreadable = rows.length - withRev.length;

  // Revenue-weighted CAGR: a pool's growth is dominated by its large members,
  // so an unweighted average would let a tiny fast grower distort the read.
  const withCagr = withRev.filter((r) => r.revenueCagrPct != null);
  const wSum = withCagr.reduce((s, r) => s + (r.revenueTTM as number), 0);
  const poolCagr = wSum > 0
    ? round1(withCagr.reduce((s, r) => s + (r.revenueCagrPct as number) * (r.revenueTTM as number), 0) / wSum)
    : null;

  return {
    peerPoolRevenue: pool > 0 ? pool : null,
    contributors: withRev.length,
    unreadable,
    subjectSharePct:
      pool > 0 && subject?.revenueTTM != null ? round1((subject.revenueTTM / pool) * 100) : null,
    poolCagrPct: poolCagr,
    definition:
      `Combined trailing-twelve-month revenue of the ${withRev.length} companies in the ${group} peer set whose filings could be read, ` +
      `taken from their own SEC submissions. Share is the subject's revenue divided by that pool.`,
    limits: [
      "This is a peer-set revenue pool, not a TAM. It counts only the listed companies named in the peer set, so it excludes private competitors, non-SEC filers, and any part of the addressable market nobody currently serves.",
      "A true TAM is a research-house estimate with no free, verifiable source. It is left out rather than guessed; if you have a TAM figure from a source you trust, the workbook has a cell for it.",
      "Conglomerate revenue is counted whole. Where a peer earns only part of its revenue in this market, the pool is overstated and the subject's share understated.",
      ...(unreadable > 0
        ? [`${unreadable} name${unreadable === 1 ? "" : "s"} in the peer set could not be read and contribute nothing to the pool, which understates it.`]
        : []),
    ],
  };
}

// ── Returns on capital — the metric the old sheet was missing ──────────

export interface ReturnsProfile {
  nopat: number | null;
  investedCapital: number | null;
  roicPct: number | null;
  /** ROIC less WACC. Positive means the business creates value as it grows. */
  spreadPct: number | null;
  effectiveTaxRatePct: number | null;
  taxRateSource: "filed" | "assumed";
  roePct: number | null;
  roaPct: number | null;
  /** ROIC for each year available, newest first — is the return improving? */
  roicHistory: { year: string; roicPct: number }[];
  verdict: string;
  gaps: string[];
}

const STATUTORY_TAX = 0.21;

function roicFor(inc: FinancialRow | undefined, bal: FinancialRow | undefined, taxRate: number): number | null {
  const ebit = num(inc?.operatingIncome) ?? num(inc?.ebit);
  if (ebit == null) return null;
  const debt = (num(bal?.longTermDebt) ?? 0) + (num(bal?.shortTermDebt) ?? 0);
  const equity = num(bal?.totalShareholderEquity);
  const cash = num(bal?.cashAndEquivalents) ?? 0;
  if (equity == null) return null;
  const invested = debt + equity - cash;
  if (!(invested > 0)) return null;
  return round1(((ebit * (1 - taxRate)) / invested) * 100);
}

export function returnsProfile(data: MarketData, waccPct: number | null): ReturnsProfile {
  const inc = data.financials.income;
  const bal = data.financials.balance;
  const gaps: string[] = [];

  const i0 = inc[0];
  const b0 = bal[0];
  const tax = num(i0?.incomeTaxExpense);
  const pretax = num(i0?.incomeBeforeTax);
  let taxRate = STATUTORY_TAX;
  let taxRateSource: "filed" | "assumed" = "assumed";
  if (tax != null && pretax != null && pretax > 0) {
    const r = tax / pretax;
    // A rate outside 0–50% is usually a one-off (a valuation-allowance release,
    // a repatriation charge) rather than the ongoing rate, so it is not used.
    if (r >= 0 && r <= 0.5) { taxRate = r; taxRateSource = "filed"; }
    else gaps.push(`Filed effective tax rate of ${(r * 100).toFixed(0)}% looks like a one-off, so the 21% statutory rate was used instead.`);
  } else {
    gaps.push("Tax expense or pre-tax income was not tagged, so the 21% US statutory rate was assumed.");
  }

  const ebit = num(i0?.operatingIncome) ?? num(i0?.ebit);
  const debt = (num(b0?.longTermDebt) ?? 0) + (num(b0?.shortTermDebt) ?? 0);
  const equity = num(b0?.totalShareholderEquity);
  const cash = num(b0?.cashAndEquivalents) ?? 0;
  const invested = equity != null ? debt + equity - cash : null;
  const nopat = ebit != null ? ebit * (1 - taxRate) : null;
  const roic = nopat != null && invested != null && invested > 0 ? round1((nopat / invested) * 100) : null;

  if (ebit == null) gaps.push("Operating income was not tagged, so ROIC could not be computed.");
  if (equity == null) gaps.push("Shareholder equity was not tagged, so invested capital could not be computed.");
  if (invested != null && invested <= 0) gaps.push("Invested capital is zero or negative — net cash exceeds debt plus equity, which makes ROIC meaningless rather than high.");

  const roicHistory: { year: string; roicPct: number }[] = [];
  for (let k = 0; k < Math.min(inc.length, bal.length, 5); k++) {
    const v = roicFor(inc[k], bal[k], taxRate);
    if (v != null) roicHistory.push({ year: String(inc[k].fiscalDate).slice(0, 4), roicPct: v });
  }

  const spread = roic != null && waccPct != null ? round1(roic - waccPct) : null;
  let verdict: string;
  if (spread == null) {
    verdict = "ROIC or WACC is unavailable, so no value-creation judgement is made.";
  } else if (spread > 10) {
    verdict = `ROIC of ${roic}% exceeds the ${waccPct}% cost of capital by ${spread} points. Growth creates value here, which is what justifies paying up for it — reinvestment compounds rather than dilutes.`;
  } else if (spread > 0) {
    verdict = `ROIC of ${roic}% is ${spread} points above the ${waccPct}% cost of capital. Value is created, but the margin is thin enough that a cyclical downturn could erase it.`;
  } else {
    verdict = `ROIC of ${roic}% sits ${Math.abs(spread)} points BELOW the ${waccPct}% cost of capital. Every dollar reinvested destroys value at current returns; growth is not the thesis, a return to adequate returns is.`;
  }

  // Direction matters as much as level.
  if (roicHistory.length >= 3) {
    const recent = roicHistory[0].roicPct;
    const older = roicHistory[roicHistory.length - 1].roicPct;
    const dir = recent - older;
    verdict += ` Over ${roicHistory.length} years ROIC has moved from ${older}% to ${recent}% (${dir >= 0 ? "+" : ""}${round1(dir)} points), so returns are ${Math.abs(dir) < 2 ? "broadly stable" : dir > 0 ? "improving" : "deteriorating"}.`;
  }

  const ov = data.overview;
  return {
    nopat, investedCapital: invested, roicPct: roic, spreadPct: spread,
    effectiveTaxRatePct: round1(taxRate * 100), taxRateSource,
    roePct: ov?.roe != null ? round1(ov.roe * 100) : null,
    roaPct: ov?.roa != null ? round1(ov.roa * 100) : null,
    roicHistory, verdict, gaps,
  };
}

// ── Moat, scored from evidence ────────────────────────────────────────

export type MoatStrength = "Wide" | "Narrow" | "None" | "Unrated";

export interface MoatSource {
  source: string;
  strength: MoatStrength;
  /** The measurement behind the rating — never an assertion on its own. */
  evidence: string;
}

export interface MoatAssessment {
  overall: MoatStrength;
  sources: MoatSource[];
  /** How many of the five tests could be evaluated at all. */
  ratedCount: number;
  note: string;
}

/** Standard deviation, for margin stability. */
function stdev(xs: number[]): number | null {
  if (xs.length < 3) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function moatAssessment(
  data: MarketData,
  returns: ReturnsProfile,
  peers: PeerRow[]
): MoatAssessment {
  const inc = data.financials.income;
  const cf = data.financials.cashflow;
  const sources: MoatSource[] = [];

  const grossMargins = inc
    .map((r) => {
      const rev = num(r.totalRevenue);
      const gp = num(r.grossProfit);
      return rev && gp != null ? (gp / rev) * 100 : null;
    })
    .filter((v): v is number => v != null);

  // 1. Pricing power — the level of gross margin, against the peer set.
  {
    const gm = grossMargins[0] ?? null;
    const peerGms = peers.filter((p) => !p.isSubject && p.grossMargin != null).map((p) => p.grossMargin as number);
    const peerMed = peerGms.length
      ? peerGms.slice().sort((a, b) => a - b)[Math.floor(peerGms.length / 2)]
      : null;
    if (gm == null) {
      sources.push({ source: "Pricing power (gross margin)", strength: "Unrated", evidence: "Gross profit is not tagged in the filings, so margin level cannot be measured." });
    } else if (peerMed == null) {
      sources.push({
        source: "Pricing power (gross margin)",
        strength: gm >= 50 ? "Narrow" : "None",
        evidence: `Gross margin ${round1(gm)}%, with no readable peer median to compare against — rated on level alone, which is weaker evidence.`,
      });
    } else {
      const gap = gm - peerMed;
      sources.push({
        source: "Pricing power (gross margin)",
        strength: gap >= 10 ? "Wide" : gap >= 3 ? "Narrow" : "None",
        evidence: `Gross margin ${round1(gm)}% against a peer median of ${round1(peerMed)}% — ${gap >= 0 ? "+" : ""}${round1(gap)} points. A durable premium is the clearest sign customers cannot easily substitute.`,
      });
    }
  }

  // 2. Durability — margin stability through the cycle.
  {
    const sd = stdev(grossMargins);
    if (sd == null) {
      sources.push({ source: "Durability (margin stability)", strength: "Unrated", evidence: `Only ${grossMargins.length} year${grossMargins.length === 1 ? "" : "s"} of gross margin available; stability needs at least three.` });
    } else {
      sources.push({
        source: "Durability (margin stability)",
        strength: sd <= 2 ? "Wide" : sd <= 5 ? "Narrow" : "None",
        evidence: `Gross margin standard deviation of ${round1(sd)} points across ${grossMargins.length} years. A margin that holds through a cycle is evidence the pricing is structural, not cyclical.`,
      });
    }
  }

  // 3. Capital efficiency — ROIC against the cost of capital.
  {
    if (returns.spreadPct == null) {
      sources.push({ source: "Capital efficiency (ROIC vs WACC)", strength: "Unrated", evidence: returns.gaps[0] ?? "ROIC or WACC unavailable." });
    } else {
      sources.push({
        source: "Capital efficiency (ROIC vs WACC)",
        strength: returns.spreadPct >= 10 ? "Wide" : returns.spreadPct > 0 ? "Narrow" : "None",
        evidence: `ROIC ${returns.roicPct}% against a ${round1((returns.roicPct ?? 0) - returns.spreadPct)}% cost of capital — a spread of ${returns.spreadPct >= 0 ? "+" : ""}${returns.spreadPct} points. Excess returns that persist are the definition of a moat; competition should have removed them.`,
      });
    }
  }

  // 4. Scale — revenue against the peer pool.
  {
    const subject = peers.find((p) => p.isSubject);
    const pool = peers.filter((p) => p.revenueTTM != null).reduce((s, p) => s + (p.revenueTTM as number), 0);
    if (!subject?.revenueTTM || pool <= 0) {
      sources.push({ source: "Scale advantage", strength: "Unrated", evidence: "Subject or peer revenue could not be read, so relative scale is unknown." });
    } else {
      const share = (subject.revenueTTM / pool) * 100;
      sources.push({
        source: "Scale advantage",
        strength: share >= 35 ? "Wide" : share >= 15 ? "Narrow" : "None",
        evidence: `${round1(share)}% of the readable peer-set revenue pool. Scale is only a moat where it lowers unit cost or raises switching friction — check that it does before crediting it.`,
      });
    }
  }

  // 5. Reinvestment intensity — how much capital the moat costs to hold.
  {
    const rev = num(inc[0]?.totalRevenue);
    const capex = cf[0] ? Math.abs(num(cf[0].capitalExpenditures) ?? 0) : null;
    const rd = num(inc[0]?.researchAndDevelopment);
    if (rev == null || (capex == null && rd == null)) {
      sources.push({ source: "Cost of holding the moat", strength: "Unrated", evidence: "Capex or R&D is not tagged, so reinvestment intensity cannot be measured." });
    } else {
      const capexPct = capex != null ? (capex / rev) * 100 : null;
      const rdPct = rd != null ? (rd / rev) * 100 : null;
      const total = (capexPct ?? 0) + (rdPct ?? 0);
      // Low reinvestment with high returns is the strongest combination; high
      // reinvestment is not automatically bad, but it makes the moat expensive.
      const highReturns = (returns.spreadPct ?? 0) > 5;
      sources.push({
        source: "Cost of holding the moat",
        strength: total <= 10 && highReturns ? "Wide" : total <= 25 ? "Narrow" : "None",
        evidence:
          `Capex ${capexPct != null ? round1(capexPct) + "%" : "n/a"} and R&D ${rdPct != null ? round1(rdPct) + "%" : "n/a"} of revenue, ` +
          `${round1(total)}% combined. A moat that needs heavy annual spend to defend converts less of its return into cash for owners.`,
      });
    }
  }

  const rated = sources.filter((s) => s.strength !== "Unrated");
  const score = rated.reduce((s, x) => s + (x.strength === "Wide" ? 2 : x.strength === "Narrow" ? 1 : 0), 0);
  const maxScore = rated.length * 2;
  const ratio = maxScore > 0 ? score / maxScore : 0;
  const overall: MoatStrength =
    rated.length < 3 ? "Unrated" : ratio >= 0.7 ? "Wide" : ratio >= 0.35 ? "Narrow" : "None";

  return {
    overall,
    sources,
    ratedCount: rated.length,
    note:
      rated.length < 3
        ? `Only ${rated.length} of 5 moat tests could be evaluated, which is not enough to rate the moat. The unrated tests are listed with the reason each failed rather than scored as zero.`
        : `${rated.length} of 5 tests evaluated, scoring ${score} of a possible ${maxScore}. Wide requires 70% of the available points, Narrow 35%. Each rating cites the measurement behind it; none is asserted.`,
  };
}

// ── The 12-month catalyst timeline, with dates ─────────────────────────

export interface Catalyst {
  /** ISO date where one can be projected, else null. */
  date: string | null;
  window: string;
  event: string;
  kind: "Earnings" | "Distribution" | "Macro" | "Structural";
  impact: string;
  /** How the date was arrived at. */
  basis: string;
}

/**
 * Projected reporting dates from the company's own history.
 *
 * Companies report on a stable cadence, so the median gap between the last
 * reports projects the next ones well enough to plan around — and the basis is
 * stated so nobody mistakes a projection for an announced date.
 */
export function projectEarningsDates(
  reported: string[],
  now = new Date(),
  count = 4
): { dates: string[]; medianGapDays: number | null } {
  const ds = reported
    .map((d) => Date.parse(d))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  if (ds.length < 2) return { dates: [], medianGapDays: null };
  const gaps: number[] = [];
  for (let i = 1; i < ds.length; i++) gaps.push((ds[i] - ds[i - 1]) / 86_400_000);
  const sorted = gaps.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // A cadence far from quarterly means the history is irregular; don't project.
  if (!(median >= 60 && median <= 120)) return { dates: [], medianGapDays: Math.round(median) };

  const out: string[] = [];
  let next = ds[ds.length - 1];
  for (let i = 0; i < 12 && out.length < count; i++) {
    next += median * 86_400_000;
    if (next > now.getTime()) out.push(new Date(next).toISOString().slice(0, 10));
  }
  return { dates: out, medianGapDays: Math.round(median) };
}

export interface TimelineInput {
  data: MarketData;
  /** Ex-dividend dates already projected by the dividend engine, if any. */
  projectedExDates?: { date: string; amount: number }[];
  /** Macro events from the news desk's calendar. */
  macro?: { label: string; date: string | null; window: string; daysAway: number | null }[];
  now?: Date;
}

export function catalystTimeline(input: TimelineInput): Catalyst[] {
  const now = input.now ?? new Date();
  const out: Catalyst[] = [];
  const dayGap = (iso: string) => Math.round((Date.parse(iso) - now.getTime()) / 86_400_000);

  // 1. Earnings — the single biggest scheduled mover for most names.
  const reported = input.data.earnings
    .map((e) => e.reportedDate)
    .filter((d): d is string => !!d);
  const { dates, medianGapDays } = projectEarningsDates(reported, now, 4);
  dates.forEach((d, i) => {
    out.push({
      date: d,
      window: `${d} [E]`,
      event: `Q${i + 1} results (projected)`,
      kind: "Earnings",
      impact:
        i === 0
          ? "The next print is the primary near-term driver: the beat or miss sets the direction and the guidance sets the multiple. Size before it, not during it."
          : "Successive prints either confirm the growth path the target price assumes or break it. Each one is a scheduled opportunity to be wrong cheaply.",
      basis: `Projected from a median ${medianGapDays}-day reporting cadence across ${reported.length} past reports. Not an announced date — confirm on the company's investor-relations page.`,
    });
  });
  if (!dates.length) {
    out.push({
      date: null,
      window: "Unknown",
      event: "Next quarterly results",
      kind: "Earnings",
      impact: "The primary near-term driver, but its date could not be projected.",
      basis: medianGapDays
        ? `Reporting history is irregular (median gap ${medianGapDays} days), so no date is projected rather than guessing one.`
        : "Fewer than two past reporting dates are available, so no cadence could be measured.",
    });
  }

  // 2. Distributions — the income sleeve's own calendar.
  for (const ex of (input.projectedExDates ?? []).slice(0, 4)) {
    out.push({
      date: ex.date,
      window: `${ex.date} [E]`,
      event: `Ex-dividend — $${ex.amount.toFixed(4)} per share`,
      kind: "Distribution",
      impact: "Price drops by roughly the distribution on the ex-date. Relevant to timing an entry, and to whether a holding is bought before or after the record date.",
      basis: "Projected by the dividend engine from the company's own payment history.",
    });
  }

  // 3. Macro — the same calendar the news desk uses.
  for (const m of (input.macro ?? []).slice(0, 6)) {
    out.push({
      date: m.date,
      window: m.window,
      event: m.label,
      kind: "Macro",
      impact: "Moves the multiple rather than the earnings — a repricing of the discount rate hits every long-duration holding at once.",
      basis: "Projected from the agency's published release convention; see the macro desk for the full rule.",
    });
  }

  // 4. Structural drivers, which have no date but belong on the list.
  const sector = input.data.overview?.sector ?? "the sector";
  out.push({
    date: null,
    window: "Rolling, 3–12 months",
    event: `${sector} demand and capex cycle`,
    kind: "Structural",
    impact: "Determines whether the growth in the base case is available to be captured. No date; monitored through peer results and industry orders.",
    basis: "Not a scheduled event — included because a dated list that omits the actual driver is misleading.",
  });

  out.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });
  // Twelve months only — beyond that a "catalyst" is a hope.
  return out.filter((c) => !c.date || (dayGap(c.date) <= 400 && dayGap(c.date) >= -1));
}

// ── The whole research pack ───────────────────────────────────────────

export interface ResearchPack {
  peerSet: PeerSet;
  peers: PeerRow[];
  sizing: MarketSizing;
  returns: ReturnsProfile;
  moat: MoatAssessment;
  timeline: Catalyst[];
  sources: string[];
}

export interface ResearchInput {
  data: MarketData;
  waccPct: number | null;
  projectedExDates?: { date: string; amount: number }[];
  macro?: { label: string; date: string | null; window: string; daysAway: number | null }[];
  now?: Date;
}

export async function buildResearch(input: ResearchInput): Promise<ResearchPack> {
  const { data, waccPct } = input;
  const ticker = data.ticker.toUpperCase();
  const set = resolvePeers(ticker, data.overview?.sector ?? null);

  // The subject and every peer are read the same way, so the comparison is not
  // quietly mixing a rich source for the subject with a thin one for the peers.
  const rows = await Promise.all([
    peerRow(ticker, true),
    ...set.peers.map((p) => peerRow(p, false)),
  ]);

  const returns = returnsProfile(data, waccPct);
  const moat = moatAssessment(data, returns, rows);

  return {
    peerSet: set,
    peers: rows,
    sizing: marketSizing(rows, set.group),
    returns,
    moat,
    timeline: catalystTimeline({ data, projectedExDates: input.projectedExDates, macro: input.macro, now: input.now }),
    sources: [
      "Fundamentals: SEC EDGAR XBRL company facts (companyfacts API) — the filers' own tagged figures, for the subject and every peer alike.",
      "Prices: Yahoo Finance public chart endpoint.",
      "Peer sets: the app's own industry group lists, chosen narrowest-first so the comparison is like-for-like.",
      "Release dates: each agency's published release convention, marked [E] where projected.",
      "No paid data, no analyst consensus, and no estimated TAM — where a figure has no free verifiable source it is left out and named, not filled in.",
    ],
  };
}
