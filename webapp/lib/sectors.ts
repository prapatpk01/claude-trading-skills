// Sector classification for portfolio allocation.
//
// The sector comes from the SEC's own SIC code on each filer — the same source
// as the rest of the fundamentals, so it needs no key and works from a
// datacenter IP. SIC is an industry taxonomy, not GICS, so the mapping below
// folds SIC major groups (and the handful of 4-digit codes that would otherwise
// land in the wrong place) onto the eleven GICS sectors people expect to see.
//
// Funds are not looked through. An ETF's SIC code describes the wrapper, not
// what it holds, so classifying SCHD as "Financials" because it is registered
// as an investment office would be worse than useless. Known wrappers are
// labelled as funds and flagged so the UI can say the allocation stops there.

import { getSecFundamentals } from "./sec";

export type Sector =
  | "Information Technology"
  | "Health Care"
  | "Financials"
  | "Consumer Discretionary"
  | "Consumer Staples"
  | "Communication Services"
  | "Industrials"
  | "Energy"
  | "Materials"
  | "Utilities"
  | "Real Estate"
  | "Fund / ETF"
  | "Unclassified";

export interface SectorInfo {
  sector: Sector;
  /** SIC description, e.g. "Semiconductors & Related Devices". */
  industry: string | null;
  sic: string | null;
  /** True when the holding is a fund wrapper rather than an operating company. */
  isFund: boolean;
  source: "SEC SIC" | "fund list" | "override" | "unknown";
}

/**
 * Exchange-traded and closed-end wrappers. Their SIC code describes the fund
 * structure, so they are named here rather than classified.
 */
const FUNDS = new Set([
  // broad equity
  "SPY", "VOO", "IVV", "VTI", "QQQ", "QQQM", "DIA", "IWM", "VT", "VXUS", "VEA", "VWO",
  "EFA", "EEM", "IEFA", "IEMG", "ITOT", "SPLG", "RSP", "MGK", "VUG", "VTV", "IWF", "IWD",
  // dividend & income
  "SCHD", "VYM", "DGRO", "DVY", "SDY", "NOBL", "HDV", "SPYD", "DIVO", "QDVO",
  "JEPI", "JEPQ", "SPYI", "QYLD", "RYLD", "XYLD", "GPIQ", "GPIX", "BALI", "PFF", "PFFD",
  // sector & thematic
  "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLU", "XLRE", "XLC",
  "SMH", "SOXX", "IGV", "ARKK", "IBB", "XBI", "VNQ", "SCHH", "IYR",
  // bonds & cash
  "BND", "AGG", "BNDX", "TLT", "IEF", "SHY", "LQD", "HYG", "JNK", "MUB", "TIP",
  "SGOV", "BIL", "SHV", "USFR", "ICSH", "TFLO", "JAAA", "JPST", "MINT", "NEAR",
  // international / factor
  "DFIV", "AVDV", "AVUV", "AVIV", "SCHF", "SCHE", "VIGI", "VYMI", "IDV",
  // commodities
  "GLD", "IAU", "SLV", "GLDM", "PDBC", "DBC", "USO",
]);

/**
 * Symbols whose SIC code is right about the filing and wrong about the
 * business, where the GICS sector everyone actually uses differs. SIC predates
 * the industries these companies are in — Alphabet and Meta file as data
 * processors, Visa and Mastercard as computer services — so the general rule
 * cannot reach them and they are named individually.
 */
const TICKER_OVERRIDES: Record<string, Sector> = {
  GOOGL: "Communication Services", GOOG: "Communication Services", META: "Communication Services",
  V: "Financials", MA: "Financials", PYPL: "Financials", FI: "Financials", FIS: "Financials",
  ACN: "Information Technology", IBM: "Information Technology", CRM: "Information Technology",
};

/** 4-digit SIC codes whose major group would otherwise mislead. */
const SIC_EXACT: Record<string, Sector> = {
  "2833": "Health Care", "2834": "Health Care", "2835": "Health Care", "2836": "Health Care",
  // Household & personal products file under chemicals; they are staples.
  "2840": "Consumer Staples", "2841": "Consumer Staples", "2842": "Consumer Staples",
  "2843": "Consumer Staples", "2844": "Consumer Staples",
  // Footwear files under rubber & plastics; it is apparel.
  "3021": "Consumer Discretionary", "3140": "Consumer Discretionary",
  "3559": "Information Technology", // semiconductor production equipment
  "3576": "Information Technology", "3577": "Information Technology",
  "3661": "Information Technology", "3663": "Information Technology",
  "3669": "Information Technology", "3672": "Information Technology",
  "3674": "Information Technology", "3677": "Information Technology",
  "3678": "Information Technology", "3679": "Information Technology",
  "3711": "Consumer Discretionary", "3713": "Consumer Discretionary",
  "3714": "Consumer Discretionary", "3716": "Consumer Discretionary",
  "3751": "Consumer Discretionary",
  "3812": "Industrials", // search & navigation equipment (defense)
  "3821": "Health Care", "3826": "Health Care", "3827": "Health Care",
  "3841": "Health Care", "3842": "Health Care", "3843": "Health Care",
  "3844": "Health Care", "3845": "Health Care", "3851": "Health Care",
  "5912": "Consumer Staples", // drug stores
  // Managed care files as insurance; GICS treats it as health care.
  "6324": "Health Care",
  "6798": "Real Estate", // REITs
  "7310": "Communication Services", "7311": "Communication Services",
  "7812": "Communication Services", "7819": "Communication Services",
  "7822": "Communication Services", "7841": "Communication Services",
  "8731": "Health Care", // commercial physical & biological research
};

/** SIC major group (first two digits) → sector. */
function sectorFromMajorGroup(mg: number): Sector {
  if (mg >= 1 && mg <= 9) return "Consumer Staples";       // agriculture, forestry, fishing
  if (mg === 13 || mg === 29) return "Energy";              // oil & gas extraction, refining
  if (mg >= 10 && mg <= 14) return "Materials";             // metal & mineral mining
  if (mg >= 15 && mg <= 17) return "Industrials";           // construction
  if (mg === 20 || mg === 21) return "Consumer Staples";    // food, tobacco
  if (mg === 22 || mg === 23) return "Consumer Discretionary";
  if (mg >= 24 && mg <= 26) return "Materials";             // lumber, furniture, paper
  if (mg === 27) return "Communication Services";           // printing & publishing
  if (mg === 28) return "Materials";                        // chemicals (pharma caught above)
  if (mg === 30 || mg === 32 || mg === 33) return "Materials";
  if (mg === 31 || mg === 39) return "Consumer Discretionary";
  if (mg === 34) return "Industrials";
  if (mg === 35) return "Industrials";                      // machinery (computers caught above)
  if (mg === 36) return "Information Technology";
  if (mg === 37) return "Industrials";                      // aerospace (autos caught above)
  if (mg === 38) return "Information Technology";           // instruments (medical caught above)
  if (mg >= 40 && mg <= 47) return "Industrials";           // transportation
  if (mg === 48) return "Communication Services";
  if (mg === 49) return "Utilities";
  if (mg >= 50 && mg <= 59) return "Consumer Discretionary";
  if (mg >= 60 && mg <= 64) return "Financials";
  if (mg === 65) return "Real Estate";
  if (mg === 67) return "Financials";                       // holding & investment offices
  if (mg === 70 || mg === 72) return "Consumer Discretionary";
  if (mg === 73) return "Information Technology";           // business services incl. software
  if (mg >= 78 && mg <= 79) return "Communication Services";
  if (mg === 80) return "Health Care";
  if (mg === 82 || mg === 83 || mg === 84 || mg === 86) return "Consumer Discretionary";
  if (mg === 87) return "Industrials";
  return "Unclassified";
}

export function sectorFromSic(sic: string | null | undefined, ticker?: string): Sector {
  if (ticker) {
    const override = TICKER_OVERRIDES[ticker.trim().toUpperCase()];
    if (override) return override;
  }
  if (!sic) return "Unclassified";
  const code = String(sic).trim().padStart(4, "0");
  const exact = SIC_EXACT[code];
  if (exact) return exact;
  const num = parseInt(code, 10);
  // 3570-3579 is computer & office equipment, sitting inside the machinery
  // major group. Apple, Dell and HP file here and are information technology.
  if (num >= 3570 && num <= 3579) return "Information Technology";

  const mg = parseInt(code.slice(0, 2), 10);
  if (!Number.isFinite(mg)) return "Unclassified";
  return sectorFromMajorGroup(mg);
}

// Sector lookups change about as often as a company changes business — cache
// them for a day so a portfolio refresh is not a dozen SEC round trips.
const CACHE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; info: SectorInfo }>();

export async function getSector(ticker: string): Promise<SectorInfo> {
  const t = ticker.trim().toUpperCase();
  const hit = cache.get(t);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;

  let info: SectorInfo;
  if (FUNDS.has(t)) {
    info = { sector: "Fund / ETF", industry: "Exchange-traded or closed-end fund", sic: null, isFund: true, source: "fund list" };
  } else if (TICKER_OVERRIDES[t]) {
    // Named explicitly — no need to spend an SEC round trip to be overruled.
    info = { sector: TICKER_OVERRIDES[t], industry: null, sic: null, isFund: false, source: "override" };
  } else {
    const sec = await getSecFundamentals(t).catch(() => null);
    if (sec?.sic) {
      info = {
        sector: sectorFromSic(sec.sic, t),
        industry: sec.industry ?? null,
        sic: sec.sic,
        isFund: false,
        source: "SEC SIC",
      };
    } else {
      info = { sector: "Unclassified", industry: null, sic: null, isFund: false, source: "unknown" };
    }
  }
  cache.set(t, { at: Date.now(), info });
  return info;
}

export interface AllocationRow {
  ticker: string;
  sector: Sector;
  industry: string | null;
  isFund: boolean;
  shares: number;
  price: number | null;
  value: number;
  weightPct: number;
}

export interface SectorRow {
  sector: Sector;
  value: number;
  weightPct: number;
  tickers: string[];
}

export interface Allocation {
  nav: number;
  holdings: AllocationRow[];
  bySector: SectorRow[];
  /** Share of NAV sitting in fund wrappers, which are not looked through. */
  fundPct: number;
  unclassifiedPct: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Look up several tickers at once, reusing the day cache. */
export async function getSectors(tickers: string[]): Promise<Record<string, SectorInfo>> {
  const out: Record<string, SectorInfo> = {};
  await Promise.all(
    Array.from(new Set(tickers.map((t) => t.trim().toUpperCase())))
      .filter(Boolean)
      .map(async (t) => {
        out[t] = await getSector(t);
      })
  );
  return out;
}

const UNKNOWN: SectorInfo = {
  sector: "Unclassified", industry: null, sic: null, isFund: false, source: "unknown",
};

/**
 * Weights and sector buckets from an already-resolved sector map.
 *
 * Kept free of any I/O so the client can compute the allocation from exactly
 * the holdings and quotes the holdings table is rendering. Deriving it from a
 * second, independently-loaded copy of the book is what let the donut drift out
 * of sync with the positions it claimed to describe.
 */
export function computeAllocation(
  holdings: { ticker: string; shares: number; avg_cost: number }[],
  prices: Record<string, number | null>,
  sectors: Record<string, SectorInfo>
): Allocation {
  const valued = holdings.map((h) => {
    const t = h.ticker.trim().toUpperCase();
    const price = prices[h.ticker] ?? prices[t] ?? null;
    return { h, t, price, value: (price ?? h.avg_cost) * h.shares, info: sectors[t] ?? UNKNOWN };
  });
  const nav = valued.reduce((s, v) => s + v.value, 0);
  const weight = (v: number) => (nav > 0 ? (v / nav) * 100 : 0);

  const rows: AllocationRow[] = valued
    .map((v) => ({
      ticker: v.t,
      sector: v.info.sector,
      industry: v.info.industry,
      isFund: v.info.isFund,
      shares: v.h.shares,
      price: v.price,
      value: round2(v.value),
      weightPct: round2(weight(v.value)),
    }))
    .sort((a, b) => b.value - a.value);

  const byS = new Map<Sector, { value: number; tickers: string[] }>();
  for (const r of rows) {
    const e = byS.get(r.sector) ?? { value: 0, tickers: [] };
    e.value += r.value;
    e.tickers.push(r.ticker);
    byS.set(r.sector, e);
  }
  const bySector: SectorRow[] = [...byS.entries()]
    .map(([sector, e]) => ({
      sector,
      value: round2(e.value),
      weightPct: round2(weight(e.value)),
      tickers: e.tickers,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    nav: round2(nav),
    holdings: rows,
    bySector,
    fundPct: round2(bySector.filter((s) => s.sector === "Fund / ETF").reduce((s, r) => s + r.weightPct, 0)),
    unclassifiedPct: round2(bySector.filter((s) => s.sector === "Unclassified").reduce((s, r) => s + r.weightPct, 0)),
  };
}

/** Server-side convenience: resolve sectors, then compute the allocation. */
export async function buildAllocation(
  holdings: { ticker: string; shares: number; avg_cost: number }[],
  prices: Record<string, number | null>
): Promise<Allocation> {
  const sectors = await getSectors(holdings.map((h) => h.ticker));
  return computeAllocation(holdings, prices, sectors);
}
