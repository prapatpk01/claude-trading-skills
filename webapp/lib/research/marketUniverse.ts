import { ENGINE_UNIVERSES, FACTOR_UNIVERSE, type FactorMode } from "@/lib/factorDiscovery";
import { loadSecSymbolUniverse } from "@/lib/symbols";

export type ResearchRotationCadence = "3D" | "7D" | "1M" | "3M";

export type RotationWindow = {
  cadence: ResearchRotationCadence;
  label: string;
  purpose: string;
  masterUniverse: number;
  scheduledThisCycle: number;
  lastRotationAt: string;
  nextRotationAt: string;
};

export type RotatingResearchName = {
  ticker: string;
  cadence: ResearchRotationCadence;
  source: string;
};

const CADENCE: Array<{ cadence: ResearchRotationCadence; days: number; weight: number; label: string; purpose: string }> = [
  { cadence: "3D", days: 3, weight: .30, label: "3-day fast rotation", purpose: "Liquid leaders, fresh relative strength, volume accumulation and early markup." },
  { cadence: "7D", days: 7, weight: .30, label: "7-day cross-sectional rotation", purpose: "Broad factor ranking, sector leadership and replacement-candidate refresh." },
  { cadence: "1M", days: 30, weight: .24, label: "Monthly fundamental rotation", purpose: "Growth, quality, estimate, filing and valuation evidence refresh." },
  { cadence: "3M", days: 90, weight: .16, label: "Quarterly full-universe rotation", purpose: "Long-tail, small/mid-cap and stale-name coverage so the same leaders cannot monopolise research." },
];

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function unique(values: Iterable<string>) {
  return Array.from(new Set(Array.from(values, value => String(value ?? "").trim().toUpperCase()).filter(value => TICKER.test(value))));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function windowEpoch(days: number, now: Date) {
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / (days * 86400000));
}

function windowDates(days: number, now: Date) {
  const epoch = windowEpoch(days, now);
  return {
    epoch,
    lastRotationAt: new Date(epoch * days * 86400000).toISOString(),
    nextRotationAt: new Date((epoch + 1) * days * 86400000).toISOString(),
  };
}

function rankedSample(values: string[], count: number, salt: string, blocked: Set<string>) {
  return values
    .filter(ticker => !blocked.has(ticker))
    .map(ticker => ({ ticker, rank: stableHash(`${salt}:${ticker}`) }))
    .sort((left, right) => left.rank - right.rank || left.ticker.localeCompare(right.ticker))
    .slice(0, count)
    .map(row => row.ticker);
}

function quotas(total: number) {
  let assigned = 0;
  return CADENCE.map((policy, index) => {
    const count = index === CADENCE.length - 1 ? total - assigned : Math.max(1, Math.round(total * policy.weight));
    assigned += count;
    return { ...policy, count };
  });
}

/**
 * Assemble a truthful master universe and a bounded deep-research queue.
 *
 * The SEC registrant list supplies several thousand actual listed issuers.  It
 * is the discovery source, not a claim that every registrant is immediately
 * investable.  Liquidity, price history and the seven independent Research OS
 * gates decide that later.  The deterministic cadence windows guarantee fresh
 * long-tail names without attempting thousands of expensive fundamental calls
 * inside one Vercel request.
 */
export async function buildRotatingMarketUniverse(options: {
  exclude?: Iterable<string>;
  detailedLimit: number;
  now?: Date;
}) {
  const now = options.now ?? new Date();
  const excluded = new Set(unique(options.exclude ?? []));
  const engineCore = unique([
    ...FACTOR_UNIVERSE,
    ...Object.values(ENGINE_UNIVERSES).flat(),
  ]).filter(ticker => !excluded.has(ticker));
  const engineCoreSet = new Set(engineCore);

  let sec: { ticker: string; name: string }[] = [];
  const warnings: string[] = [];
  try {
    sec = await loadSecSymbolUniverse();
  } catch (error) {
    warnings.push(`SEC master universe unavailable: ${error instanceof Error ? error.message : "request failed"}. Core liquid universe used for this cycle.`);
  }

  const masterTickers = unique([...engineCore, ...sec.map(row => row.ticker)])
    .filter(ticker => !excluded.has(ticker));
  const masterSource = sec.length >= 1000
    ? "SEC EDGAR listed-registrant master universe; index-family coverage target: S&P 1500, Nasdaq listings and Russell 3000 segments"
    : "Sentinel liquid-US core universe (SEC master fallback unavailable)";

  const selected = new Set<string>();
  const queue: RotatingResearchName[] = [];
  const windows: RotationWindow[] = [];
  for (const policy of quotas(Math.max(28, Math.min(56, options.detailedLimit)))) {
    const dates = windowDates(policy.days, now);
    const coreCount = policy.cadence === "3D" ? Math.min(policy.count, Math.max(2, Math.round(policy.count * .35))) : 0;
    const core = rankedSample(engineCore, coreCount, `${policy.cadence}:${dates.epoch}:core`, selected);
    for (const ticker of core) selected.add(ticker);
    const broad = rankedSample(masterTickers, policy.count - core.length, `${policy.cadence}:${dates.epoch}:broad`, selected);
    for (const ticker of broad) selected.add(ticker);
    const tickers = [...core, ...broad];
    queue.push(...tickers.map(ticker => ({ ticker, cadence: policy.cadence, source: engineCoreSet.has(ticker) ? "LIQUID_CORE" : "SEC_BROAD_MARKET" })));
    windows.push({
      cadence: policy.cadence,
      label: policy.label,
      purpose: policy.purpose,
      masterUniverse: masterTickers.length,
      scheduledThisCycle: tickers.length,
      lastRotationAt: dates.lastRotationAt,
      nextRotationAt: dates.nextRotationAt,
    });
  }

  return {
    masterTickers,
    masterUniverseSize: masterTickers.length,
    masterSource,
    queue,
    windows,
    warnings,
  };
}

export function preferredEngineCore(mode: FactorMode) {
  return unique(ENGINE_UNIVERSES[mode]);
}
