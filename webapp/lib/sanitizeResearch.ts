import { validatePeer, peerCoverage } from "./peerValidation";

export function sanitizeResearch<T extends any>(research: T): T {
  if (!research || !Array.isArray(research.peers)) return research;

  const peers = research.peers.map((p: any) => validatePeer({
    ticker: p.ticker,
    isSubject: !!p.isSubject,
    price: p.price ?? null,
    revenueTTM: p.revenueTTM ?? null,
    netIncomeTTM: p.netIncomeTTM ?? null,
    grossMargin: p.grossMargin ?? null,
    netMargin: p.netMargin ?? null,
    marketCap: p.marketCap ?? null,
    peTTM: p.peTTM ?? null,
    revenueCagrPct: p.revenueCagrPct ?? null,
    cagrYears: p.cagrYears ?? null,
    gaps: p.gaps ?? [],
  }));

  const coverage = peerCoverage(peers, 70);
  const valid = peers.filter((p: any) => p.comparable && p.revenueTTM != null && p.revenueTTM > 0);
  const pool = valid.reduce((s: number, p: any) => s + p.revenueTTM, 0);
  const subject = valid.find((p: any) => p.isSubject);
  const withGrowth = valid.filter((p: any) => p.revenueCagrPct != null);
  const growthWeight = withGrowth.reduce((s: number, p: any) => s + p.revenueTTM, 0);
  const poolCagr = growthWeight > 0
    ? withGrowth.reduce((s: number, p: any) => s + p.revenueCagrPct * p.revenueTTM, 0) / growthWeight
    : null;

  const oldSizing = research.sizing ?? {};
  const sizing = {
    ...oldSizing,
    peerPoolRevenue: coverage.publishPool && pool > 0 ? pool : null,
    contributors: valid.length,
    unreadable: peers.length - valid.length,
    subjectSharePct: coverage.publishPool && subject && pool > 0 ? subject.revenueTTM / pool * 100 : null,
    poolCagrPct: coverage.publishPool && poolCagr != null ? Math.round(poolCagr * 10) / 10 : null,
    coverage,
    definition: coverage.publishPool
      ? `Comparable trailing-twelve-month revenue pool using ${valid.length}/${peers.length} validated names. Every published margin is recomputed from the same TTM revenue and net-income basis.`
      : coverage.note,
    limits: [
      ...(Array.isArray(oldSizing.limits) ? oldSizing.limits : []),
      ...peers.flatMap((p: any) => (p.validationWarnings ?? []).map((w: string) => `${p.ticker}: ${w}`)).slice(0, 12),
    ],
  };

  return { ...research, peers, sizing };
}
