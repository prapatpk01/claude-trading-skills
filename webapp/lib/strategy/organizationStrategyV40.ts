export const ORGANIZATION_STRATEGY_V40 = "40.0" as const;

export const FORWARD_BET_DOCTRINE_V40 = {
  name: "Forward Bet · Smart Money Anticipation",
  operatingSequence: ["ANTICIPATE", "ACCUMULATE", "CONFIRM", "SCALE"] as const,
  oldSequenceRetired: ["WAIT_FOR_NEWS", "WAIT_FOR_CLARITY", "CONFIRM", "BUY"] as const,
  principles: [
    "Invest from a forward thesis before consensus is fully reflected in price.",
    "Treat price/volume/relative-strength accumulation as evidence that informed capital may be positioning early.",
    "Uncertainty alone is not a veto. Risk is controlled through starter sizing, explicit invalidation and staged scaling.",
    "News is confirmation evidence, not a prerequisite for discovery or starter ownership.",
    "Add capital only as the thesis, flow and price structure confirm; cut when the thesis invalidates rather than when headlines become uncomfortable.",
    "Human approval remains mandatory and research never auto-executes broker orders.",
  ],
  desks: {
    INV: {
      mission: "Forecast where earnings, capital flows and narratives are likely to move next; identify beneficiaries before broad consensus.",
      primaryEvidence: ["future thesis", "sector leadership", "relative strength", "volume/accumulation", "institutional proxy", "earnings/capex direction", "catalyst path"],
      prohibitedDefault: "Do not require a confirming headline before surfacing a candidate.",
    },
    AM: {
      mission: "Own the best asymmetric ideas early with starter size, then scale as evidence confirms.",
      sizing: ["SCOUT", "STARTER", "CORE", "SCALE"] as const,
      prohibitedDefault: "Do not leave deployable capital idle solely because the macro narrative is unresolved.",
    },
    RISK: {
      mission: "Define what would prove the forward thesis wrong and cap loss if the bet fails.",
      hardVetoes: ["THESIS_INVALIDATED", "LIQUIDITY_BREACH", "CONCENTRATION_BREACH", "DATA_INTEGRITY_FAILURE", "STRUCTURAL_BREAKDOWN"],
      notAVeto: ["HEADLINE_UNCERTAINTY", "MACRO_UNRESOLVED", "CATALYST_NOT_YET_PUBLIC", "CONSENSUS_NOT_CONFIRMED"],
    },
    CIO: {
      mission: "Allocate to the highest expected-value asymmetric future path rather than the most comfortable current narrative.",
      decisionQuestion: "If our forward thesis is right, what is the payoff; if wrong, where is invalidation and how much do we lose?",
    },
  },
} as const;

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

export type TechnicalBuyGateInputV40 = {
  asOf?: string | null;
  nowMs?: number;
  maxAgeMinutes?: number;
  ema8?: number | null;
  ema13?: number | null;
  ema100?: number | null;
  ema200?: number | null;
  adx?: number | null;
  macd?: number | null;
  macdSignal?: number | null;
  macdHistogram?: number | null;
};

export type TechnicalBuyGateResultV40 = {
  eligible: boolean;
  freshness: "FRESH" | "STALE" | "MISSING";
  ageMinutes: number | null;
  reasons: string[];
};

export function technicalBuyGateV40(input: TechnicalBuyGateInputV40): TechnicalBuyGateResultV40 {
  const nowMs = finite(input.nowMs) ?? Date.now();
  const maxAgeMinutes = Math.max(1, finite(input.maxAgeMinutes) ?? 30);
  const snapshotMs = input.asOf ? Date.parse(input.asOf) : Number.NaN;
  const ageMinutes = Number.isFinite(snapshotMs) ? Math.max(0, (nowMs - snapshotMs) / 60_000) : null;
  const freshness: TechnicalBuyGateResultV40["freshness"] = ageMinutes == null
    ? "MISSING"
    : ageMinutes <= maxAgeMinutes
      ? "FRESH"
      : "STALE";

  const values = {
    ema8: finite(input.ema8),
    ema13: finite(input.ema13),
    ema100: finite(input.ema100),
    ema200: finite(input.ema200),
    adx: finite(input.adx),
    macd: finite(input.macd),
    macdSignal: finite(input.macdSignal),
    macdHistogram: finite(input.macdHistogram),
  };
  const missing = Object.entries(values).filter(([, value]) => value == null).map(([key]) => key);
  const reasons: string[] = [];
  if (freshness === "MISSING") reasons.push("technical timestamp missing");
  if (freshness === "STALE") reasons.push(`technical snapshot stale (${Math.round(ageMinutes ?? 0)}m > ${maxAgeMinutes}m)`);
  if (missing.length) reasons.push(`technical fields missing: ${missing.join(", ")}`);

  if (!missing.length) {
    if (!(values.ema8! > values.ema13!)) reasons.push("EMA8 is not above EMA13");
    if (!(values.ema100! > values.ema200!)) reasons.push("EMA100 is not above EMA200");
    if (!(values.adx! >= 20)) reasons.push("ADX is below 20");
    if (!(values.macd! > values.macdSignal!)) reasons.push("MACD is not above signal");
    if (!(values.macdHistogram! > 0)) reasons.push("MACD histogram is not positive");
  }

  return {
    eligible: freshness === "FRESH" && missing.length === 0 && reasons.length === 0,
    freshness,
    ageMinutes: ageMinutes == null ? null : Math.round(ageMinutes * 10) / 10,
    reasons,
  };
}

export type SmartMoneyFootprintInputV40 = {
  relativeStrength3m?: number | null;
  return1m?: number | null;
  return3m?: number | null;
  volumeRatio?: number | null;
  institutionalScore?: number | null;
  lifecycleStage?: string | null;
  aboveEma20?: boolean | null;
  aboveEma50?: boolean | null;
  ema20Above50?: boolean | null;
};

export function smartMoneyFootprintScoreV40(input: SmartMoneyFootprintInputV40) {
  const rs3m = finite(input.relativeStrength3m) ?? 0;
  const ret1m = finite(input.return1m) ?? 0;
  const ret3m = finite(input.return3m) ?? 0;
  const volume = finite(input.volumeRatio);
  const institutional = finite(input.institutionalScore) ?? 50;
  const stage = String(input.lifecycleStage ?? "UNCONFIRMED").toUpperCase();

  const rsScore = clamp(50 + rs3m * 2.4);
  const acceleration = clamp(50 + (ret1m - ret3m / 3) * 4);
  const volumeScore = volume == null ? 50 : clamp(50 + (volume - 1) * 55);
  const lifecycleScore = stage === "ACCUMULATION" ? 100
    : stage === "EARLY_MARKUP" ? 95
      : stage === "MOMENTUM_EXPANSION" ? 82
        : stage === "MATURE" ? 48
          : stage === "WEAKENING" ? 15
            : stage === "BROKEN" ? 0
              : 42;
  const trendScore = [input.aboveEma20, input.aboveEma50, input.ema20Above50]
    .reduce<number>((sum, value) => sum + (value === true ? 33.34 : value === false ? 0 : 16.67), 0);

  return Math.round(clamp(
    rsScore * 0.24 +
    acceleration * 0.18 +
    volumeScore * 0.18 +
    institutional * 0.18 +
    lifecycleScore * 0.14 +
    trendScore * 0.08,
  ));
}

export type ForwardThesisInputV40 = {
  sectorLeadershipScore?: number | null;
  catalystScore?: number | null;
  fundFitScore?: number | null;
  growthScore?: number | null;
  qualityScore?: number | null;
  smartMoneyScore?: number | null;
  expectedReturnPct?: number | null;
};

export function forwardThesisScoreV40(input: ForwardThesisInputV40) {
  const sector = finite(input.sectorLeadershipScore) ?? 50;
  const catalyst = finite(input.catalystScore) ?? 50;
  const fit = finite(input.fundFitScore) ?? 50;
  const growth = finite(input.growthScore) ?? 50;
  const quality = finite(input.qualityScore) ?? 50;
  const smartMoney = finite(input.smartMoneyScore) ?? 50;
  const upside = finite(input.expectedReturnPct);
  const asymmetry = upside == null ? 50 : clamp(40 + upside * 2.5);

  return Math.round(clamp(
    smartMoney * 0.30 +
    sector * 0.20 +
    fit * 0.15 +
    growth * 0.10 +
    quality * 0.10 +
    asymmetry * 0.10 +
    catalyst * 0.05,
  ));
}

export type AnticipatorySizingV40 = "SCOUT" | "STARTER" | "CORE" | "SCALE" | "NO_RISK";

export function anticipatorySizingV40(input: {
  convictionScore: number;
  smartMoneyScore: number;
  thesisInvalidated?: boolean;
  hardRiskBlock?: boolean;
}) : AnticipatorySizingV40 {
  if (input.thesisInvalidated || input.hardRiskBlock) return "NO_RISK";
  const conviction = clamp(input.convictionScore);
  const smartMoney = clamp(input.smartMoneyScore);
  if (conviction >= 82 && smartMoney >= 72) return "SCALE";
  if (conviction >= 74 && smartMoney >= 65) return "CORE";
  if (conviction >= 62 && smartMoney >= 58) return "STARTER";
  if (conviction >= 52 && smartMoney >= 52) return "SCOUT";
  return "NO_RISK";
}
