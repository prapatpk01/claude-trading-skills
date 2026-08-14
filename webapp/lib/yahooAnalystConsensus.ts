import YahooFinance from "yahoo-finance2";

const yf: any = new (YahooFinance as any)({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

const finite = (value: unknown): number | null => {
  if (value == null) return null;
  const raw = typeof value === "object" && (value as any).raw !== undefined ? (value as any).raw : value;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export type YahooAnalystConsensus = {
  ticker: string;
  targetMeanPrice: number;
  targetMedianPrice: number | null;
  targetLowPrice: number | null;
  targetHighPrice: number | null;
  analystCount: number | null;
  recommendationMean: number | null;
  recommendationKey: string | null;
  transport?: "YAHOO_FINANCE2" | "YFINANCE_COOKIE_CRUMB" | "YAHOO_HTML";
};

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Yahoo analyst request exceeded ${ms}ms`)), ms)),
  ]);
}

function getSetCookies(headers: Headers): string[] {
  const anyHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

function cookieHeaderFromSetCookies(values: string[]) {
  const cookies = values
    .flatMap((value) => value.split(/,(?=[^;,]+=)/g))
    .map((value) => value.trim().split(";", 1)[0])
    .filter((value) => /^[^=]+=/.test(value));
  return Array.from(new Set(cookies)).join("; ");
}

function mergeCookies(base: string, headers: Headers) {
  const next = cookieHeaderFromSetCookies(getSetCookies(headers));
  if (!next) return base;
  const map = new Map<string, string>();
  for (const part of `${base}; ${next}`.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    map.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return Array.from(map.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

function normalizeFinancialData(clean: string, financial: any, transport: YahooAnalystConsensus["transport"]): YahooAnalystConsensus | null {
  const mean = finite(financial?.targetMeanPrice);
  if (mean == null || mean <= 0) return null;
  return {
    ticker: clean,
    targetMeanPrice: mean,
    targetMedianPrice: finite(financial?.targetMedianPrice),
    targetLowPrice: finite(financial?.targetLowPrice),
    targetHighPrice: finite(financial?.targetHighPrice),
    analystCount: finite(financial?.numberOfAnalystOpinions),
    recommendationMean: finite(financial?.recommendationMean),
    recommendationKey: financial?.recommendationKey ? String(financial.recommendationKey) : null,
    transport,
  };
}

async function fetchViaYahooFinance2(clean: string) {
  const response: any = await withTimeout(
    yf.quoteSummary(clean, { modules: ["financialData"] } as any),
    4500,
  );
  return normalizeFinancialData(clean, response?.financialData ?? null, "YAHOO_FINANCE2");
}

/**
 * yfinance-style Yahoo request flow.
 *
 * yfinance does not hit quoteSummary as an anonymous stateless request. It first
 * establishes a Yahoo cookie, obtains the crumb linked to that cookie, then sends
 * both on the quoteSummary request. Railway/cloud hosts often reject the simpler
 * stateless flow even though the public chart endpoint still works.
 */
async function fetchViaCookieCrumb(clean: string): Promise<YahooAnalystConsensus | null> {
  let cookie = "";
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // yfinance's primary/basic strategy first touches fc.yahoo.com to establish a
  // session cookie. Failure is non-fatal because getcrumb itself can sometimes
  // set the required cookie.
  try {
    const seed = await withTimeout(fetch("https://fc.yahoo.com", {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      headers,
    }), 3500);
    cookie = mergeCookies(cookie, seed.headers);
  } catch {
    // Continue to the crumb endpoint, matching yfinance's best-effort behavior.
  }

  const crumbResponse = await withTimeout(fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    method: "GET",
    cache: "no-store",
    redirect: "follow",
    headers: {
      ...headers,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  }), 4500);
  cookie = mergeCookies(cookie, crumbResponse.headers);
  if (!crumbResponse.ok) return null;

  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.includes("<html") || /Too Many Requests/i.test(crumb)) return null;

  const params = new URLSearchParams({
    modules: "financialData",
    corsDomain: "finance.yahoo.com",
    formatted: "false",
    symbol: clean,
    crumb,
  });

  // yfinance uses Yahoo's v10 quoteSummary family after obtaining the crumb.
  // Try query2 first, then query1 because Yahoo occasionally routes cloud IPs
  // differently across the two hosts.
  for (const host of ["query2.finance.yahoo.com", "query1.finance.yahoo.com"]) {
    try {
      const response = await withTimeout(fetch(`https://${host}/v10/finance/quoteSummary/${encodeURIComponent(clean)}?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        headers: {
          ...headers,
          Referer: `https://finance.yahoo.com/quote/${encodeURIComponent(clean)}/analysis/`,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }), 5000);
      cookie = mergeCookies(cookie, response.headers);
      if (!response.ok) continue;
      const payload: any = await response.json().catch(() => null);
      const financial = payload?.quoteSummary?.result?.[0]?.financialData ?? null;
      const parsed = normalizeFinancialData(clean, financial, "YFINANCE_COOKIE_CRUMB");
      if (parsed) return parsed;
    } catch {
      // Try the alternate Yahoo host.
    }
  }

  return null;
}

function htmlNumberNearKey(html: string, key: string): number | null {
  const patterns = [
    new RegExp(`\\"${key}\\"\\s*:\\s*\\{?\\s*\\"raw\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
    new RegExp(`\\"${key}\\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

async function fetchViaYahooHtml(clean: string): Promise<YahooAnalystConsensus | null> {
  try {
    const response = await withTimeout(fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(clean)}/analysis/`, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }), 5500);
    if (!response.ok) return null;
    const html = await response.text();
    const mean = htmlNumberNearKey(html, "targetMeanPrice");
    if (mean == null || mean <= 0) return null;
    return {
      ticker: clean,
      targetMeanPrice: mean,
      targetMedianPrice: htmlNumberNearKey(html, "targetMedianPrice"),
      targetLowPrice: htmlNumberNearKey(html, "targetLowPrice"),
      targetHighPrice: htmlNumberNearKey(html, "targetHighPrice"),
      analystCount: htmlNumberNearKey(html, "numberOfAnalystOpinions"),
      recommendationMean: htmlNumberNearKey(html, "recommendationMean"),
      recommendationKey: null,
      transport: "YAHOO_HTML",
    };
  } catch {
    return null;
  }
}

/**
 * Best-effort Yahoo Finance analyst consensus fallback.
 *
 * The same financialData fields power yfinance's analyst_price_targets API.
 * We try yahoo-finance2 first, then reproduce yfinance's cookie+crumb flow for
 * cloud runtimes, and finally parse Yahoo's public analysis HTML if the JSON
 * endpoint is blocked. Any failure remains non-fatal so the portfolio review can
 * continue to lower-order valuation fallbacks.
 */
export async function fetchYahooAnalystConsensus(ticker: string): Promise<YahooAnalystConsensus | null> {
  const clean = String(ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(clean)) return null;

  try {
    const direct = await fetchViaYahooFinance2(clean);
    if (direct) return direct;
  } catch {
    // Continue to yfinance-style transport.
  }

  const crumb = await fetchViaCookieCrumb(clean).catch(() => null);
  if (crumb) return crumb;

  return await fetchViaYahooHtml(clean).catch(() => null);
}
