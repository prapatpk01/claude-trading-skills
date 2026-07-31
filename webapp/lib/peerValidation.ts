export interface RawPeerComparable {
  ticker: string;
  isSubject: boolean;
  price: number | null;
  revenueTTM: number | null;
  netIncomeTTM: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  marketCap: number | null;
  peTTM: number | null;
  revenueCagrPct: number | null;
  cagrYears: number | null;
  gaps: string[];
}

export interface ValidatedPeerComparable extends RawPeerComparable {
  comparable: boolean;
  validationWarnings: string[];
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * Reject impossible or non-comparable peer metrics instead of displaying them
 * as if they were institutional-quality observations. Null means "unknown";
 * it is never converted to zero.
 */
export function validatePeer(row: RawPeerComparable): ValidatedPeerComparable {
  const warnings = [...(row.gaps ?? [])];
  let revenueTTM = finite(row.revenueTTM) && row.revenueTTM > 0 ? row.revenueTTM : null;
  let netIncomeTTM = finite(row.netIncomeTTM) ? row.netIncomeTTM : null;
  let netMargin = finite(row.netMargin) ? row.netMargin : null;
  let grossMargin = finite(row.grossMargin) ? row.grossMargin : null;
  let peTTM = finite(row.peTTM) && row.peTTM > 0 ? row.peTTM : null;
  let revenueCagrPct = finite(row.revenueCagrPct) ? row.revenueCagrPct : null;

  // Recompute margin from the same TTM numerator and denominator whenever both
  // are available. This prevents a margin from a different fiscal basis being
  // mixed with the displayed revenue.
  if (revenueTTM != null && netIncomeTTM != null) netMargin = (netIncomeTTM / revenueTTM) * 100;

  // Institutional sanity gates. A >100% GAAP net margin for a normal operating
  // company almost always means the period/unit mapping is broken or dominated
  // by a one-off. Do not publish it as a comparable margin.
  if (netMargin != null && (netMargin < -100 || netMargin > 100)) {
    warnings.push(`Net margin ${netMargin.toFixed(1)}% failed the comparable sanity range (-100% to +100%).`);
    netMargin = null;
  }
  if (grossMargin != null && (grossMargin < -20 || grossMargin > 100)) {
    warnings.push(`Gross margin ${grossMargin.toFixed(1)}% failed the comparable sanity range.`);
    grossMargin = null;
  }

  // Very high P/E can be real, but beyond 250x it is rarely a useful peer
  // multiple and is often a split/EPS-basis mismatch. Keep the row, suppress
  // the multiple, and require another valuation basis.
  if (peTTM != null && peTTM > 250) {
    warnings.push(`P/E ${peTTM.toFixed(1)}x was suppressed as non-comparable (>250x or EPS-basis mismatch).`);
    peTTM = null;
  }
  if (revenueCagrPct != null && (revenueCagrPct < -80 || revenueCagrPct > 200)) {
    warnings.push(`Revenue CAGR ${revenueCagrPct.toFixed(1)}% failed the sanity range.`);
    revenueCagrPct = null;
  }

  // A row is comparable for market-share/pool work only when revenue is valid.
  // Margin/P-E can remain unavailable without poisoning the denominator.
  const comparable = revenueTTM != null;
  if (!comparable) warnings.push("Excluded from peer revenue pool: comparable TTM revenue unavailable.");

  return { ...row, revenueTTM, netIncomeTTM, netMargin, grossMargin, peTTM, revenueCagrPct, comparable, validationWarnings: warnings };
}

export interface PeerCoverage {
  total: number;
  comparable: number;
  coveragePct: number;
  publishPool: boolean;
  note: string;
}

export function peerCoverage(rows: ValidatedPeerComparable[], minCoveragePct = 70): PeerCoverage {
  const total = rows.length;
  const comparable = rows.filter(r => r.comparable).length;
  const coveragePct = total ? (comparable / total) * 100 : 0;
  const subjectOk = rows.some(r => r.isSubject && r.comparable);
  const publishPool = subjectOk && comparable >= 3 && coveragePct >= minCoveragePct;
  return {
    total, comparable, coveragePct: Math.round(coveragePct * 10) / 10, publishPool,
    note: publishPool
      ? `${comparable}/${total} peers have comparable TTM revenue (${coveragePct.toFixed(1)}% coverage).`
      : `Comparable coverage is only ${comparable}/${total} (${coveragePct.toFixed(1)}%). Peer revenue pool and subject share are withheld until at least ${minCoveragePct}% coverage and three valid names are available.`,
  };
}
