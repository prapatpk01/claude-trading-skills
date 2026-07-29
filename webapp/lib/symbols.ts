// Symbol lookup for the ticker autocomplete.
//
// Two sources, in order:
//   1. Yahoo's public search endpoint — best names and covers ETFs well.
//   2. SEC EDGAR's company_tickers.json — a complete list of US-listed
//      registrants that always works from datacenter IPs, cached in memory.
// A mistyped symbol (GIPQ for GPIQ) otherwise saves silently and only shows
// up later as a missing price, so this needs to work on every host.

import YahooFinance from "yahoo-finance2";

const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });

export interface SymbolHit {
  ticker: string;
  name: string;
  type?: string;
  exchange?: string;
  source: "yahoo" | "sec";
}

// ── SEC fallback list ─────────────────────────────────────────────────
let secList: { ticker: string; name: string }[] | null = null;
let secLoadedAt = 0;

async function loadSecList(): Promise<{ ticker: string; name: string }[]> {
  const DAY = 24 * 60 * 60 * 1000;
  if (secList && Date.now() - secLoadedAt < DAY) return secList;
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
    headers: {
      "User-Agent": process.env.SEC_USER_AGENT || "EquityResearchWeb/1.0 (contact: research@example.com)",
      Accept: "application/json",
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
  const data = await res.json();
  const out: { ticker: string; name: string }[] = [];
  for (const key of Object.keys(data ?? {})) {
    const row = data[key];
    if (row?.ticker) out.push({ ticker: String(row.ticker).toUpperCase(), name: String(row.title ?? "") });
  }
  secList = out;
  secLoadedAt = Date.now();
  return out;
}

function rankSec(list: { ticker: string; name: string }[], q: string, limit: number): SymbolHit[] {
  const up = q.toUpperCase();
  const scored: { hit: SymbolHit; score: number }[] = [];
  for (const row of list) {
    let score = -1;
    if (row.ticker === up) score = 0;
    else if (row.ticker.startsWith(up)) score = 1;
    else if (row.name.toUpperCase().startsWith(up)) score = 2;
    else if (row.ticker.includes(up)) score = 3;
    else if (row.name.toUpperCase().includes(up)) score = 4;
    if (score >= 0) {
      scored.push({ hit: { ticker: row.ticker, name: row.name, source: "sec" }, score });
      // exact ticker matches are enough to stop early on long lists
      if (scored.length > 400) break;
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.hit.ticker.length - b.hit.ticker.length)
    .slice(0, limit)
    .map((s) => s.hit);
}

/** Search symbols by ticker or company name. */
export async function searchSymbols(query: string, limit = 8): Promise<SymbolHit[]> {
  const q = query.trim();
  if (q.length < 1) return [];

  // 1) Yahoo search — richer metadata, good ETF coverage
  try {
    const res = await yf.search(q, { quotesCount: limit * 2, newsCount: 0, enableFuzzyQuery: false });
    const quotes: any[] = res?.quotes ?? [];
    const hits = quotes
      .filter((x) => x?.symbol && (x.quoteType === "EQUITY" || x.quoteType === "ETF" || x.quoteType === "MUTUALFUND" || x.quoteType === "INDEX"))
      .map((x) => ({
        ticker: String(x.symbol).toUpperCase(),
        name: x.shortname || x.longname || x.symbol,
        type: x.quoteType,
        exchange: x.exchDisp || x.exchange,
        source: "yahoo" as const,
      }));
    if (hits.length) return hits.slice(0, limit);
  } catch {
    // fall through to the SEC list
  }

  // 2) SEC list — always reachable
  try {
    const list = await loadSecList();
    return rankSec(list, q, limit);
  } catch {
    return [];
  }
}
