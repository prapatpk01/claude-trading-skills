type AnyRecord = Record<string, any>;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export interface GuardedScan<T = AnyRecord> {
  result: T;
  warnings: string[];
  blockedCount: number;
}

function evidenceForMomentum(item: AnyRecord): string[] {
  const missing: string[] = [];
  if (!text(item.ticker)) missing.push("ticker");
  if (!positive(item.price)) missing.push("current price");
  if (!positive(item.entryLow) || !positive(item.entryHigh)) missing.push("entry zone");
  if (!positive(item.stop)) missing.push("stop");
  if (!positive(item.targetLow) || !positive(item.targetHigh)) missing.push("target zone");
  if (!finite(item.score)) missing.push("score");
  if (!finite(item.riskReward) || item.riskReward < 1) missing.push("risk/reward");
  if (!text(item.dateConfirmed)) missing.push("price timestamp");
  if (!text(item.source)) missing.push("price source");
  return missing;
}

function evidenceForDividend(item: AnyRecord): string[] {
  const missing: string[] = [];
  if (!text(item.ticker)) missing.push("ticker");
  if (!positive(item.price)) missing.push("current price");
  if (!finite(item.score)) missing.push("score");
  if (!finite(item.yieldPct) && !finite(item.yield)) missing.push("dividend yield");
  if (!finite(item.distributionGrowthPct) && !finite(item.dividendGrowthPct)) missing.push("distribution growth");
  if (!text(item.dataQuality)) missing.push("data-quality classification");
  return missing;
}

function scrubTradeFields(item: AnyRecord, missing: string[]): AnyRecord {
  if (!missing.length) return item;
  return {
    ...item,
    tradeReady: false,
    qualified: false,
    entryLow: null,
    entryHigh: null,
    stop: null,
    targetLow: null,
    targetHigh: null,
    expectedReturnPct: null,
    winProbability: null,
    riskReward: null,
    evidenceStatus: "BLOCKED",
    evidenceWarnings: missing,
  };
}

export function guardScanResult(mode: "momentum" | "dividend" | "thematic", input: AnyRecord): GuardedScan {
  const warnings: string[] = [];
  let blockedCount = 0;
  const result: AnyRecord = { ...input };

  if (mode === "momentum") {
    const valid: AnyRecord[] = [];
    const downgraded: AnyRecord[] = [...(Array.isArray(input.nearQualified) ? input.nearQualified : [])];
    for (const raw of Array.isArray(input.setups) ? input.setups : []) {
      const missing = evidenceForMomentum(raw);
      if (missing.length) {
        blockedCount += 1;
        downgraded.push({
          ...scrubTradeFields(raw, missing),
          reasons: [...(Array.isArray(raw.reasons) ? raw.reasons : []), `Evidence incomplete: ${missing.join(", ")}`],
        });
      } else {
        valid.push({ ...raw, evidenceStatus: "VERIFIED", evidenceWarnings: [] });
      }
    }
    result.setups = valid;
    result.nearQualified = downgraded;
    if (!valid.length) result.noQualifiers = input.noQualifiers || "No trade-ready names passed all evidence, timing and risk gates. Review Near-Qualified candidates instead.";
  }

  if (mode === "dividend") {
    const picks: AnyRecord[] = [];
    const rejected: AnyRecord[] = [...(Array.isArray(input.rejected) ? input.rejected : [])];
    for (const raw of Array.isArray(input.picks) ? input.picks : []) {
      const missing = evidenceForDividend(raw);
      if (missing.length) {
        blockedCount += 1;
        rejected.push({ ...raw, qualified: false, evidenceStatus: "BLOCKED", evidenceWarnings: missing, rejectionReason: `Evidence incomplete: ${missing.join(", ")}` });
      } else {
        picks.push({ ...raw, evidenceStatus: "VERIFIED", evidenceWarnings: [] });
      }
    }
    result.picks = picks;
    result.rejected = rejected;
    if (!picks.length) result.noQualifiers = input.noQualifiers || "No dividend candidates passed the full evidence and durability gate.";
  }

  if (mode === "thematic") {
    const portfolio = Array.isArray(input.portfolio) ? input.portfolio : Array.isArray(input.holdings) ? input.holdings : [];
    const cleaned = portfolio.filter((x: AnyRecord) => text(x.ticker) && finite(x.score) && finite(x.weight) && x.weight > 0);
    blockedCount += portfolio.length - cleaned.length;
    if ("portfolio" in input) result.portfolio = cleaned;
    if ("holdings" in input) result.holdings = cleaned;
    if (!cleaned.length) warnings.push("Thematic portfolio withheld because no candidate had complete ticker, score and positive weight data.");
  }

  if (blockedCount) warnings.push(`${blockedCount} candidate(s) were downgraded or withheld because required evidence was incomplete.`);
  result.guard = { version: "v8.0", status: blockedCount ? "PARTIAL" : "PASS", blockedCount, warnings };
  return { result, warnings, blockedCount };
}
