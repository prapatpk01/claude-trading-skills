// Sentinel Global Fund — thematic leadership (Daniel Cho, macro strategy).
//
// Answers "what is actually working right now" from price, not from opinion.
// Each sector and theme is represented by a liquid proxy ETF; the proxy is
// ranked on relative strength against SPY over three horizons plus the health
// of its own trend. The regime then decides which kinds of leadership the fund
// is allowed to lean into: a Risk-On tape lets capital go to high-beta growth
// like semiconductors and AI infrastructure, a Risk-Off tape confines it to
// income and defensives no matter how well the aggressive themes are ranking.
//
// The list is deliberately proxy-based. Naming a theme "AI infrastructure" and
// asserting it is leading would be an opinion; measuring SMH and IGV against
// SPY is a fact that changes when the market changes.

import type { Candle } from "../types";
import { sma, pctReturn } from "../indicators";
import type { RegimeAssessment } from "./governance";

export type GroupKind = "sector" | "theme" | "defensive";
/** Sensitivity to the market cycle — the axis the regime gates on. */
export type RiskProfile = "high-beta" | "cyclical" | "defensive";

export interface ThemeGroup {
  proxy: string;
  label: string;
  kind: GroupKind;
  risk: RiskProfile;
  /** GICS sector this proxy maps to, when it is a sector fund. */
  sector?: string;
  note: string;
}

/**
 * The measurable universe. Sector SPDRs give complete GICS coverage; the
 * themes are the sub-groups that lead or lag the sector they sit inside —
 * semis and software move very differently from technology as a whole.
 */
export const THEME_UNIVERSE: ThemeGroup[] = [
  // ── sectors ──
  { proxy: "XLK", label: "Technology", kind: "sector", risk: "high-beta", sector: "Information Technology", note: "Broad technology" },
  { proxy: "XLC", label: "Communication Services", kind: "sector", risk: "cyclical", sector: "Communication Services", note: "Media, telecom, platforms" },
  { proxy: "XLY", label: "Consumer Discretionary", kind: "sector", risk: "cyclical", sector: "Consumer Discretionary", note: "Retail, autos, travel" },
  { proxy: "XLI", label: "Industrials", kind: "sector", risk: "cyclical", sector: "Industrials", note: "Capital goods, transport" },
  { proxy: "XLF", label: "Financials", kind: "sector", risk: "cyclical", sector: "Financials", note: "Banks, insurers, exchanges" },
  { proxy: "XLE", label: "Energy", kind: "sector", risk: "cyclical", sector: "Energy", note: "Oil, gas, services" },
  { proxy: "XLB", label: "Materials", kind: "sector", risk: "cyclical", sector: "Materials", note: "Chemicals, metals, packaging" },
  { proxy: "XLV", label: "Health Care", kind: "sector", risk: "defensive", sector: "Health Care", note: "Pharma, devices, providers" },
  { proxy: "XLP", label: "Consumer Staples", kind: "sector", risk: "defensive", sector: "Consumer Staples", note: "Food, household, beverages" },
  { proxy: "XLU", label: "Utilities", kind: "sector", risk: "defensive", sector: "Utilities", note: "Power — also the data-centre demand proxy" },
  { proxy: "XLRE", label: "Real Estate", kind: "sector", risk: "defensive", sector: "Real Estate", note: "REITs" },

  // ── themes ──
  { proxy: "SMH", label: "Semiconductors", kind: "theme", risk: "high-beta", note: "The core of the AI build-out — chips and equipment" },
  { proxy: "IGV", label: "Software & AI applications", kind: "theme", risk: "high-beta", note: "Where AI capability is monetised" },
  { proxy: "BOTZ", label: "Robotics & automation", kind: "theme", risk: "high-beta", note: "Physical automation and robotics" },
  { proxy: "ITA", label: "Aerospace & defence", kind: "theme", risk: "cyclical", note: "Defence budgets and aerospace cycle" },
  { proxy: "XBI", label: "Biotech", kind: "theme", risk: "high-beta", note: "Equal-weight biotech — rate and risk sensitive" },
  { proxy: "KRE", label: "Regional banks", kind: "theme", risk: "high-beta", note: "Credit and rate-curve sensitive" },
  { proxy: "XHB", label: "Homebuilders", kind: "theme", risk: "cyclical", note: "Rate-sensitive housing cycle" },
  { proxy: "GLD", label: "Gold", kind: "defensive", risk: "defensive", note: "Real-asset hedge" },
  { proxy: "TLT", label: "Long Treasuries", kind: "defensive", risk: "defensive", note: "Duration — the risk-off destination" },
];

export const THEME_PROXIES = THEME_UNIVERSE.map((g) => g.proxy);

/**
 * Liquid names inside each group, used to build a scan universe from whatever
 * is actually leading rather than from a fixed list. Deliberately shallow —
 * enough large, liquid constituents per theme to give the scanner something to
 * rank, not an index reconstruction.
 */
export const THEME_MEMBERS: Record<string, string[]> = {
  SMH: ["NVDA", "AVGO", "AMD", "MU", "ARM", "TSM", "LRCX", "AMAT", "KLAC", "MRVL"],
  IGV: ["MSFT", "CRM", "NOW", "PLTR", "SNOW", "CRWD", "PANW", "DDOG", "ORCL", "ADBE"],
  BOTZ: ["ISRG", "ABB", "ROK", "TER", "SYM", "PATH"],
  XLK: ["AAPL", "MSFT", "NVDA", "AVGO", "CRM", "ORCL", "CSCO", "ACN", "AMD", "NOW"],
  XLC: ["GOOGL", "META", "NFLX", "DIS", "TMUS", "EA", "WBD"],
  XLY: ["AMZN", "TSLA", "HD", "MCD", "BKNG", "NKE", "SBUX", "TJX"],
  XLI: ["GE", "CAT", "UNP", "HON", "BA", "DE", "UPS", "ETN"],
  XLF: ["JPM", "BAC", "WFC", "GS", "MS", "SPGI", "BLK", "AXP"],
  XLE: ["XOM", "CVX", "COP", "SLB", "EOG", "PSX", "MPC"],
  XLB: ["LIN", "SHW", "FCX", "APD", "ECL", "NEM", "NUE"],
  XLV: ["LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ISRG", "AMGN"],
  XLP: ["PG", "COST", "WMT", "KO", "PEP", "PM", "MDLZ"],
  XLU: ["NEE", "SO", "DUK", "CEG", "VST", "AEP", "SRE"],
  XLRE: ["PLD", "AMT", "EQIX", "WELL", "SPG", "O", "DLR"],
  ITA: ["RTX", "LMT", "GD", "NOC", "HWM", "LHX", "TDG"],
  XBI: ["VRTX", "REGN", "ALNY", "INCY", "NBIX", "UTHR"],
  KRE: ["PNC", "USB", "TFC", "FITB", "RF", "KEY", "CFG"],
  XHB: ["DHI", "LEN", "PHM", "NVR", "BLDR", "MAS"],
};

export interface ThematicUniverse {
  tickers: string[];
  /** The groups the universe was drawn from, best first. */
  groups: GroupRank[];
  note: string;
}

/**
 * Build a scan universe from the groups that are both leading on relative
 * strength and permitted by the regime. A fixed list of last cycle's winners
 * finds last cycle's trades; this follows the money.
 */
export function buildThematicUniverse(
  ranked: GroupRank[],
  playbook: Playbook,
  maxTickers = 20
): ThematicUniverse {
  const eligible = ranked.filter((g) => isLeading(g) && playbook.allowed.includes(g.risk) && THEME_MEMBERS[g.proxy]);

  if (!eligible.length) {
    return {
      tickers: [],
      groups: [],
      note:
        playbook.allowed.length
          ? "No group is both leading on relative strength and permitted by the current regime, so there is no thematic universe to scan. Waiting is the position."
          : `The ${playbook.regime} regime permits no new deployment, so no scan universe is built. ${playbook.guidance}`,
    };
  }

  // Round-robin across the leading groups so one hot theme cannot monopolise
  // the universe and hide a setup in the second-best group.
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let depth = 0; picked.length < maxTickers; depth++) {
    let addedThisPass = false;
    for (const g of eligible) {
      const members = THEME_MEMBERS[g.proxy];
      if (depth >= members.length) continue;
      const t = members[depth];
      addedThisPass = true;
      if (seen.has(t)) continue;
      seen.add(t);
      picked.push(t);
      if (picked.length >= maxTickers) break;
    }
    if (!addedThisPass) break;
  }

  return {
    tickers: picked,
    groups: eligible,
    note: `Universe drawn from ${eligible.length} leading group${eligible.length === 1 ? "" : "s"} — ${eligible
      .map((g) => `${g.label} (${g.rs3m != null && g.rs3m >= 0 ? "+" : ""}${g.rs3m?.toFixed(1)}% vs SPY)`)
      .join(", ")} — filtered to the risk profiles the ${playbook.regime} regime permits.`,
  };
}

export interface GroupRank extends ThemeGroup {
  price: number;
  /** Excess return over SPY, in percentage points. */
  rs1m: number | null;
  rs3m: number | null;
  rs6m: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  /** 0-100 composite; 50 is "in line with the index". */
  leadership: number;
  trending: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

function excess(candles: Candle[], spy: Candle[], lookback: number): number | null {
  const a = pctReturn(candles, lookback);
  const b = pctReturn(spy, lookback);
  if (a == null || b == null) return null;
  return a - b;
}

/**
 * Rank the universe. A group leads when it is beating the index over multiple
 * horizons *and* its own trend is intact — outperforming on the way down is
 * not leadership.
 */
export function rankGroups(
  candlesByProxy: Record<string, Candle[]>,
  spy: Candle[]
): GroupRank[] {
  const out: GroupRank[] = [];
  for (const g of THEME_UNIVERSE) {
    const c = candlesByProxy[g.proxy];
    if (!c || c.length < 130 || !spy.length) continue;

    const closes = c.map((x) => x.close);
    const price = closes[closes.length - 1];
    const rs1m = excess(c, spy, 21);
    const rs3m = excess(c, spy, 63);
    const rs6m = excess(c, spy, 126);
    const s50 = sma(closes, 50);
    const s200 = closes.length >= 200 ? sma(closes, 200) : null;
    const aboveSma50 = s50 != null ? price > s50 : null;
    const aboveSma200 = s200 != null ? price > s200 : null;

    // Weighted excess return, then a trend adjustment. The 3-month window
    // carries the most weight: 1 month is noise, 6 months is history.
    let score = 50;
    const parts: [number | null, number][] = [[rs1m, 0.9], [rs3m, 1.4], [rs6m, 0.7]];
    let weighted = 0;
    let usedWeight = 0;
    for (const [v, w] of parts) {
      if (v == null) continue;
      weighted += v * w;
      usedWeight += w;
    }
    if (usedWeight > 0) score += (weighted / usedWeight) * 1.6;
    if (aboveSma50) score += 6; else if (aboveSma50 === false) score -= 6;
    if (aboveSma200) score += 8; else if (aboveSma200 === false) score -= 10;

    out.push({
      ...g,
      price: Math.round(price * 100) / 100,
      rs1m: rs1m == null ? null : round1(rs1m),
      rs3m: rs3m == null ? null : round1(rs3m),
      rs6m: rs6m == null ? null : round1(rs6m),
      aboveSma50,
      aboveSma200,
      leadership: Math.max(0, Math.min(100, Math.round(score))),
      trending: aboveSma200 !== false && aboveSma50 !== false,
    });
  }
  return out.sort((a, b) => b.leadership - a.leadership);
}

/** A group is "leading" when it is beating the index and its trend is intact. */
export function isLeading(g: GroupRank): boolean {
  return g.leadership >= 58 && g.trending && (g.rs3m ?? 0) > 0;
}

export interface Playbook {
  regime: string;
  posture: string;
  /** Risk profiles the regime permits new capital to go into. */
  allowed: RiskProfile[];
  cashMinPct: number;
  guidance: string;
}

export function regimePlaybook(regime: RegimeAssessment | null): Playbook {
  if (!regime) {
    return {
      regime: "Unknown", posture: "Stand down",
      allowed: [], cashMinPct: 15,
      guidance: "The benchmark history needed to read the regime is unavailable — no thematic tilt is issued (Rule #5: unverifiable inputs are not guessed).",
    };
  }
  switch (regime.regime) {
    case "Risk-On":
      return {
        regime: regime.regime, posture: "Aggressive — lean into leadership",
        allowed: ["high-beta", "cyclical", "defensive"], cashMinPct: regime.cashMinPct,
        guidance:
          "A constructive tape rewards beta. Add to the high-beta themes that are actually leading — not to the ones that led last cycle — and let the leaders carry the growth sleeve. Full deployment is permitted above the cash floor.",
      };
    case "Neutral":
      return {
        regime: regime.regime, posture: "Selective — leaders only",
        allowed: ["cyclical", "defensive"], cashMinPct: regime.cashMinPct,
        guidance:
          "A mixed tape punishes broad beta but still pays the strongest groups. Restrict new high-beta risk to names already leading on relative strength, stagger entries, and keep the cash floor intact.",
      };
    case "Risk-Off":
      return {
        regime: regime.regime, posture: "Defensive — protect the book",
        allowed: ["defensive"], cashMinPct: regime.cashMinPct,
        guidance:
          "Leadership in a falling tape is usually just a slower decline. Rotate toward income, staples, utilities and duration; add no new high-beta exposure regardless of how it ranks.",
      };
    default:
      return {
        regime: regime.regime, posture: "Capital preservation",
        allowed: [], cashMinPct: regime.cashMinPct,
        guidance: "No new deployment. Raise the cash sleeve to the floor and let the stops do the work.",
      };
  }
}

export interface ThematicTilt {
  playbook: Playbook;
  leaders: GroupRank[];
  laggards: GroupRank[];
  /** Themes the regime permits and that are leading — where new capital goes. */
  favoured: GroupRank[];
  /** Recommendations tied to what the book actually holds. */
  recommendations: string[];
  ranked: GroupRank[];
}

export function buildThematicTilt(
  ranked: GroupRank[],
  regime: RegimeAssessment | null,
  /** Current portfolio weight per GICS sector, from the allocation. */
  sectorWeights: Record<string, number>
): ThematicTilt {
  const playbook = regimePlaybook(regime);
  const leaders = ranked.filter(isLeading);
  const laggards = [...ranked].reverse().filter((g) => g.leadership < 42).slice(0, 5);
  const favoured = leaders.filter((g) => playbook.allowed.includes(g.risk));

  const recommendations: string[] = [];

  if (!favoured.length) {
    recommendations.push(
      playbook.allowed.length
        ? "No group is both leading on relative strength and permitted by the current regime — hold the existing book and wait for leadership to establish itself."
        : `The ${playbook.regime} regime permits no new deployment. ${playbook.guidance}`
    );
  }

  for (const g of favoured.slice(0, 4)) {
    const held = g.sector ? sectorWeights[g.sector] ?? 0 : null;
    const rs = `${g.rs3m != null && g.rs3m >= 0 ? "+" : ""}${g.rs3m?.toFixed(1)}% vs SPY over 3 months`;
    if (held == null) {
      recommendations.push(
        `${g.label} (${g.proxy}) is leading — ${rs}, leadership ${g.leadership}/100. ${g.note}. This is a theme rather than a GICS sector, so the book's exposure to it is not measured directly; check whether your growth names already sit inside it before adding.`
      );
    } else if (held < 5) {
      recommendations.push(
        `${g.label} is leading — ${rs} — and the book holds ${held.toFixed(1)}% of NAV there. ${playbook.posture}: this is the gap worth closing, via ${g.proxy} or a name inside the group, sized to the standard starter step and the 20% single-name cap.`
      );
    } else if (held < 15) {
      recommendations.push(
        `${g.label} is leading — ${rs} — and the book already holds ${held.toFixed(1)}%. Add on weakness rather than chasing; the exposure is established.`
      );
    } else {
      recommendations.push(
        `${g.label} is leading — ${rs} — but at ${held.toFixed(1)}% of NAV the book is already concentrated there. Let it run under the watch band rather than adding.`
      );
    }
  }

  for (const g of laggards.slice(0, 2)) {
    const held = g.sector ? sectorWeights[g.sector] ?? 0 : null;
    if (held != null && held >= 8) {
      recommendations.push(
        `${g.label} is lagging — ${g.rs3m != null && g.rs3m >= 0 ? "+" : ""}${g.rs3m?.toFixed(1)}% vs SPY, leadership ${g.leadership}/100${g.aboveSma200 === false ? ", below its 200-day average" : ""} — and the book carries ${held.toFixed(1)}% there. That is the first place to fund a rotation from.`
      );
    }
  }

  return { playbook, leaders, laggards, favoured, recommendations, ranked };
}

/** Look up the leading theme a ticker's sector belongs to, for the WATCH test. */
export function themeForSector(ranked: GroupRank[], sector: string | null): { label: string; rsPct: number } | null {
  if (!sector) return null;
  const g = ranked.find((x) => x.sector === sector);
  if (!g || !isLeading(g)) return null;
  return { label: g.label, rsPct: g.rs3m ?? 0 };
}
