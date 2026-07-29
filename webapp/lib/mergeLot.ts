// Merging a new purchase into an existing open position.
//
// Buying more of something already held is one position at a blended cost, not
// two rows that happen to share a ticker. Two rows split the weight, so every
// downstream figure — the 20% single-name cap, the allocation ring, the
// valuation desk's sizing — sees half a position twice and understates the
// concentration that actually exists.
//
// A *closed* lot is left alone: it is history, and re-opening the name later
// starts a new position rather than reviving the old one.

export interface Lot {
  shares: number;
  avg_cost: number;
  target_price?: number | null;
  thesis?: string | null;
  notes?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
}

export interface MergeResult {
  shares: number;
  avg_cost: number;
  target_price: number | null;
  thesis: string | null;
  notes: string | null;
  opened_at: string | null;
  /** Human-readable summary of what changed, for the UI to echo back. */
  summary: string;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Blend an addition into an existing lot.
 *
 * Average cost is share-weighted, not a mean of the two prices: adding 1 share
 * at $600 to 100 held at $30 is a $35.64 book cost, not $315.
 */
export function mergeLot(existing: Lot, addition: Lot): MergeResult {
  const totalShares = existing.shares + addition.shares;
  const blended =
    totalShares > 0
      ? (existing.shares * existing.avg_cost + addition.shares * addition.avg_cost) / totalShares
      : existing.avg_cost;

  // The earlier opening date survives — the position started when it started.
  const opened =
    existing.opened_at && addition.opened_at
      ? existing.opened_at < addition.opened_at
        ? existing.opened_at
        : addition.opened_at
      : existing.opened_at ?? addition.opened_at ?? null;

  // New text wins where supplied; otherwise the existing note is kept rather
  // than silently erased by a form submitted with the field left empty.
  const thesis = (addition.thesis ?? "").trim() || existing.thesis || null;
  const notes = (addition.notes ?? "").trim() || existing.notes || null;
  const target = addition.target_price ?? existing.target_price ?? null;

  return {
    // Six decimals on the blended cost, not two: rounding to cents at each
    // merge would drift the book cost after repeated purchases. Display
    // rounds to cents; storage keeps the precision.
    shares: round6(totalShares),
    avg_cost: round6(blended),
    target_price: target,
    thesis,
    notes,
    opened_at: opened,
    summary:
      `Merged into the existing position: ${existing.shares} + ${addition.shares} = ${round6(totalShares)} shares, ` +
      `average cost ${costMove(existing.avg_cost, blended)}.`,
  };
}

/**
 * Describe the cost change at whatever precision makes it visible. A small
 * add to a large position moves the average by less than a cent, and
 * "$100.65 → $100.65" reads as though nothing happened.
 */
function costMove(before: number, after: number): string {
  for (const dp of [2, 4, 6]) {
    const a = before.toFixed(dp);
    const b = after.toFixed(dp);
    if (a !== b) return `$${a} → $${b}`;
  }
  return `$${before.toFixed(2)}, unchanged`;
}

/** The open lot a new purchase of `ticker` should merge into, if any. */
export function findOpenLot<T extends { ticker: string; closed_at?: string | null }>(
  rows: T[],
  ticker: string
): T | undefined {
  const t = ticker.trim().toUpperCase();
  return rows.find((r) => r.ticker.trim().toUpperCase() === t && !r.closed_at);
}
