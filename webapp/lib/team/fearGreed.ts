// Market sentiment — the Fear & Greed reading, used as a contrarian overlay.
//
// Two sources, in order of preference:
//
//   1. CNN's published Fear & Greed Index, when the host is reachable.
//   2. A proxy computed from the same underlying ideas, using only the free
//      price feeds the app already pulls.
//
// The proxy is not a reconstruction of CNN's index and does not pretend to be:
// two of CNN's seven components (put/call ratio and the McClellan volume
// summation) have no free source, so the proxy measures six things CNN also
// measures and says how many it could evaluate. Which source produced the
// number is always reported, because a contrarian signal that might be a
// different index is worth less than one you can name.
//
// Sentiment deliberately does NOT move the regime score. The regime measures
// where the market *is*; sentiment measures how crowded that position is. They
// answer different questions, and averaging them would blur both.

import type { Candle } from "../types";
import { sma, pctReturn } from "../indicators";

export type FearGreedBand =
  | "Capitulation" | "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed";

export interface SentimentComponent {
  label: string;
  /** 0 = maximum fear, 100 = maximum greed. */
  value: number | null;
  detail: string;
}

export interface FearGreedRead {
  value: number;
  band: FearGreedBand;
  source: "CNN Fear & Greed Index" | "Computed proxy";
  components: SentimentComponent[];
  /** Share of the proxy's components that could be evaluated. */
  coveragePct: number;
  note: string;
}

/**
 * Bands. CNN's own cut-points are 25 / 45 / 55 / 75; the fund adds a
 * *capitulation* tier below 15, where the panic is deep enough that adding is
 * the position rather than a tilt.
 */
export function classifyFearGreed(v: number): FearGreedBand {
  if (v < 15) return "Capitulation";
  if (v < 25) return "Extreme Fear";
  if (v < 45) return "Fear";
  if (v <= 55) return "Neutral";
  if (v <= 75) return "Greed";
  return "Extreme Greed";
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** Map a value across a range onto 0-100, clamped. */
const scale = (x: number, lo: number, hi: number) => clamp(((x - lo) / (hi - lo)) * 100, 0, 100);

export interface ProxyInputs {
  spy: Candle[];
  /** ^VIX, when the feed carries it. */
  vix?: Candle[];
  /** 20+ year Treasuries — the safe haven. */
  tlt?: Candle[];
  /** High-yield and investment-grade credit. */
  hyg?: Candle[];
  lqd?: Candle[];
  /** Equal-weight S&P, as a breadth proxy against the cap-weighted index. */
  rsp?: Candle[];
  /** Sector proxies, for the share trading above their own 50-day. */
  sectors?: Candle[][];
}

/**
 * Compute the proxy. Each component scores 0-100 toward greed; unavailable
 * components are excluded from the average rather than scored as neutral,
 * which would quietly drag every reading toward 50.
 */
export function computeFearGreedProxy(input: ProxyInputs): FearGreedRead {
  const components: SentimentComponent[] = [];

  // 1. Market momentum — SPY against its 125-day average.
  {
    const closes = input.spy.map((c) => c.close);
    const ma = closes.length >= 125 ? sma(closes, 125) : null;
    const price = closes[closes.length - 1];
    if (ma && price) {
      const devPct = ((price - ma) / ma) * 100;
      components.push({
        label: "Market momentum",
        // -10% below the average is deep fear; +10% above is greed.
        value: scale(devPct, -10, 10),
        detail: `SPY ${devPct >= 0 ? "+" : ""}${devPct.toFixed(1)}% against its 125-day average`,
      });
    } else {
      components.push({ label: "Market momentum", value: null, detail: "Under 125 sessions of history [U]" });
    }
  }

  // 2. Volatility — VIX where available, realized volatility otherwise.
  {
    const vixCloses = input.vix?.map((c) => c.close) ?? [];
    const vix = vixCloses[vixCloses.length - 1];
    if (vix) {
      components.push({
        label: "Volatility (VIX)",
        // VIX 12 is complacency, 32 is panic — inverted, so low VIX = greed.
        value: 100 - scale(vix, 12, 32),
        detail: `VIX ${vix.toFixed(1)}`,
      });
    } else {
      const win = input.spy.slice(-21);
      if (win.length >= 21) {
        const r: number[] = [];
        for (let i = 1; i < win.length; i++) r.push(Math.log(win[i].close / win[i - 1].close));
        const m = r.reduce((a, b) => a + b, 0) / r.length;
        const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
        const rv = Math.sqrt(v) * Math.sqrt(252) * 100;
        components.push({
          label: "Volatility (realized proxy)",
          value: 100 - scale(rv, 10, 30),
          detail: `${rv.toFixed(1)}% realized — VIX unavailable, using the realized proxy [E]`,
        });
      } else {
        components.push({ label: "Volatility", value: null, detail: "Insufficient history [U]" });
      }
    }
  }

  // 3. Safe-haven demand — stocks against long Treasuries over 20 sessions.
  {
    const s = pctReturn(input.spy, 20);
    const t = input.tlt?.length ? pctReturn(input.tlt, 20) : null;
    if (s != null && t != null) {
      const spread = s - t;
      components.push({
        label: "Safe-haven demand",
        value: scale(spread, -8, 8),
        detail: `SPY ${s >= 0 ? "+" : ""}${s.toFixed(1)}% vs TLT ${t >= 0 ? "+" : ""}${t.toFixed(1)}% over 20 sessions`,
      });
    } else {
      components.push({ label: "Safe-haven demand", value: null, detail: "Treasury series unavailable [U]" });
    }
  }

  // 4. Junk-bond demand — high yield against investment grade.
  {
    const h = input.hyg?.length ? pctReturn(input.hyg, 20) : null;
    const l = input.lqd?.length ? pctReturn(input.lqd, 20) : null;
    if (h != null && l != null) {
      const spread = h - l;
      components.push({
        label: "Junk-bond demand",
        value: scale(spread, -3, 3),
        detail: `HYG ${h >= 0 ? "+" : ""}${h.toFixed(1)}% vs LQD ${l >= 0 ? "+" : ""}${l.toFixed(1)}% — credit appetite`,
      });
    } else {
      components.push({ label: "Junk-bond demand", value: null, detail: "Credit series unavailable [U]" });
    }
  }

  // 5. Breadth — equal weight keeping pace with the cap-weighted index.
  {
    const r = input.rsp?.length ? pctReturn(input.rsp, 20) : null;
    const s = pctReturn(input.spy, 20);
    if (r != null && s != null) {
      const spread = r - s;
      components.push({
        label: "Breadth (equal vs cap weight)",
        value: scale(spread, -4, 4),
        detail: `RSP ${spread >= 0 ? "+" : ""}${spread.toFixed(1)}% against SPY — ${spread >= 0 ? "broad participation" : "narrow leadership"}`,
      });
    } else {
      components.push({ label: "Breadth", value: null, detail: "Equal-weight series unavailable [U]" });
    }
  }

  // 6. Price strength — share of sector groups above their own 50-day.
  {
    const groups = (input.sectors ?? []).filter((c) => c.length >= 50);
    if (groups.length >= 5) {
      const above = groups.filter((c) => {
        const closes = c.map((x) => x.close);
        const ma = sma(closes, 50);
        return ma != null && closes[closes.length - 1] > ma;
      }).length;
      const pct = (above / groups.length) * 100;
      components.push({
        label: "Price strength",
        value: pct,
        detail: `${above} of ${groups.length} sector groups above their 50-day average`,
      });
    } else {
      components.push({ label: "Price strength", value: null, detail: "Too few sector series [U]" });
    }
  }

  const scored = components.filter((c) => c.value != null) as { label: string; value: number; detail: string }[];
  const value = scored.length
    ? Math.round(scored.reduce((s, c) => s + c.value, 0) / scored.length)
    : 50;
  const coveragePct = Math.round((scored.length / components.length) * 100);

  return {
    value,
    band: classifyFearGreed(value),
    source: "Computed proxy",
    components,
    coveragePct,
    note:
      `Computed from ${scored.length} of ${components.length} components using free price feeds. ` +
      `This is not CNN's index: its put/call and McClellan components have no free source, so they are absent rather than estimated.`,
  };
}

/**
 * CNN's published index. Returns null on any failure — an unreachable host,
 * a shape change, or a value outside 0-100 — so the caller falls back to the
 * proxy rather than publishing a number it could not validate.
 */
export async function fetchCnnFearGreed(): Promise<FearGreedRead | null> {
  const url = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
  try {
    const res = await fetch(url, {
      headers: {
        // The endpoint rejects requests without a browser-shaped User-Agent.
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const raw = json?.fear_and_greed?.score;
    const value = typeof raw === "number" ? Math.round(raw) : NaN;
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;

    const prev = json?.fear_and_greed;
    const components: SentimentComponent[] = [];
    const add = (label: string, key: string) => {
      const v = json?.[key]?.score;
      if (typeof v === "number") {
        components.push({ label, value: Math.round(v), detail: json?.[key]?.rating ?? "" });
      }
    };
    add("Market momentum", "market_momentum_sp500");
    add("Stock price strength", "stock_price_strength");
    add("Stock price breadth", "stock_price_breadth");
    add("Put / call options", "put_call_options");
    add("Market volatility", "market_volatility_vix");
    add("Safe-haven demand", "safe_haven_demand");
    add("Junk-bond demand", "junk_bond_demand");

    return {
      value,
      band: classifyFearGreed(value),
      source: "CNN Fear & Greed Index",
      components,
      coveragePct: 100,
      note:
        `CNN's published reading${prev?.previous_close != null ? `, previous close ${Math.round(prev.previous_close)}` : ""}` +
        `${prev?.previous_1_week != null ? `, a week ago ${Math.round(prev.previous_1_week)}` : ""}.`,
    };
  } catch {
    return null;
  }
}

/** The published index where reachable, the proxy otherwise. */
export async function readFearGreed(proxy: ProxyInputs): Promise<FearGreedRead> {
  const cnn = await fetchCnnFearGreed();
  if (cnn) return cnn;
  const computed = computeFearGreedProxy(proxy);
  return {
    ...computed,
    note: `${computed.note} CNN's published index could not be reached from this host.`,
  };
}
