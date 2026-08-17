export type ValuationSnapshotLike = {
  status: "COMPLETE" | "INCOMPLETE";
  modelRoute: string;
  source: string;
  currentPrice: number;
  fairValue: number | null;
  bearValue: number | null;
  bullValue: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  anchors: Array<{ method: string }>;
  note: string;
  expiresAt: string;
};

export type GovernedValuationRead = {
  valid: boolean;
  decisionReady: boolean;
  status: "VALID" | "NO_EDGE" | "LOW_CONFIDENCE" | "INVALID" | "UNAVAILABLE";
  fairValue: number | null;
  bearValue: number | null;
  bullValue: number | null;
  valuationGapPct: number | null;
  reason: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Final shared rail: validate basis, freshness and evidence; never repair a bad target with spot. */
export function governValuationSnapshot(
  snapshot: ValuationSnapshotLike | null | undefined,
  livePrice?: number | null,
  now = new Date(),
): GovernedValuationRead {
  const price = Number(livePrice ?? snapshot?.currentPrice);
  if (!snapshot || snapshot.status !== "COMPLETE" || !(price > 0)) {
    return { valid: false, decisionReady: false, status: "UNAVAILABLE", fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, reason: snapshot?.note || "Thomas did not produce a complete valuation snapshot." };
  }
  const fair = Number(snapshot.fairValue);
  if (!(fair > 0)) {
    return { valid: false, decisionReady: false, status: "UNAVAILABLE", fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, reason: "Fair Value is missing or non-positive." };
  }
  const ratio = fair / price;
  if (!Number.isFinite(ratio) || ratio < 0.4 || ratio > 2.5) {
    return { valid: false, decisionReady: false, status: "INVALID", fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, reason: `Rejected basis mismatch: Fair Value is ${Number.isFinite(ratio) ? ratio.toFixed(2) : "invalid"}x the live price; the governed rail is 0.40x–2.50x.` };
  }
  const expiryMs = new Date(snapshot.expiresAt).getTime();
  if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) {
    return { valid: false, decisionReady: false, status: "INVALID", fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, reason: `Valuation expired at ${snapshot.expiresAt || "an unknown time"}.` };
  }
  const cashLike = snapshot.modelRoute === "CASH_EQUIVALENT" || snapshot.source === "THOMAS_CASH_EQUIVALENT";
  const anchors = snapshot.anchors ?? [];
  if (!cashLike && !anchors.length) {
    return { valid: false, decisionReady: false, status: "INVALID", fairValue: null, bearValue: null, bullValue: null, valuationGapPct: null, reason: "No auditable valuation anchor accompanies the target." };
  }
  const methods = anchors.map(anchor => String(anchor.method).toLowerCase());
  const priceOnly = !cashLike && methods.length > 0 && methods.every(method => method.includes("trend") || method.includes("price-history"));
  const gap = round2((fair / price - 1) * 100);
  // A very large gap can be economically real, but it is also the signature of
  // stale split/share-count bases. Keep it visible for Thomas to investigate,
  // while requiring manual basis confirmation before it can move capital.
  const extremeGap = !cashLike && (ratio < 0.65 || ratio > 1.75);
  const decisionReady = cashLike || (snapshot.confidence !== "LOW" && !priceOnly && !extremeGap);
  return {
    valid: true,
    decisionReady,
    status: cashLike || Math.abs(gap) < 0.5 ? "NO_EDGE" : decisionReady ? "VALID" : "LOW_CONFIDENCE",
    fairValue: round2(fair),
    bearValue: snapshot.bearValue == null ? null : round2(Number(snapshot.bearValue)),
    bullValue: snapshot.bullValue == null ? null : round2(Number(snapshot.bullValue)),
    valuationGapPct: gap,
    reason: decisionReady ? snapshot.note : `${snapshot.note} Display only: ${extremeGap ? "an extreme valuation gap requires manual split/share-basis confirmation" : "LOW confidence or price-only evidence"} and cannot authorize a portfolio action.`,
  };
}
