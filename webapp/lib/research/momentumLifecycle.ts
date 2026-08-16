export type MomentumLifecycleStage =
  | "ACCUMULATION"
  | "EARLY_MARKUP"
  | "MOMENTUM_EXPANSION"
  | "MATURE"
  | "WEAKENING"
  | "BROKEN"
  | "UNCONFIRMED";

export type MomentumLifecycleInput = {
  momentum: number | null;
  institutional: number | null;
  rs30: number | null;
  volumeRatio: number | null;
  upDownVolume: number | null;
  return1m?: number | null;
  return3m: number | null;
  aboveEma20?: boolean | null;
  maFanning?: boolean | null;
  valuationGapPct?: number | null;
};

export type MomentumLifecycleRead = {
  stage: MomentumLifecycleStage;
  score: number;
  preferredEntry: boolean;
  entryEligible: boolean;
  holdEligible: boolean;
  exitSignal: boolean;
  nearFairValue: boolean;
  weakening: boolean;
  reason: string;
  evidence: string[];
  risks: string[];
  exitDiscipline: string;
};

export type MomentumLifecycle = MomentumLifecycleRead;

const finite = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/** Active-momentum lifecycle shared by discovery, portfolio review and execution. */
export function classifyMomentumLifecycle(input: MomentumLifecycleInput): MomentumLifecycleRead {
  const momentum = finite(input.momentum) ?? 0;
  const institutional = finite(input.institutional) ?? 0;
  const rs30 = finite(input.rs30);
  const volumeRatio = finite(input.volumeRatio);
  const upDown = finite(input.upDownVolume);
  const return1m = finite(input.return1m);
  const return3m = finite(input.return3m);
  const valuationGap = finite(input.valuationGapPct);

  const aboveEma20 = input.aboveEma20 !== false;
  const maFanning = input.maFanning === true || (input.maFanning == null && momentum >= 74);
  const accumulationFlow = institutional >= 60
    && (volumeRatio == null ? institutional >= 64 : volumeRatio >= .95)
    && (upDown == null ? institutional >= 64 : upDown >= 1);
  const relativeLeadership = rs30 == null ? momentum >= 62 : rs30 >= 1;
  const positiveTape = return3m == null ? momentum >= 62 : return3m > -3;
  const expansionReturn = return3m == null ? momentum >= 78 : return3m >= 7;
  const expansion = momentum >= 72 && institutional >= 62 && relativeLeadership && maFanning && expansionReturn;
  const matureMove = (return3m ?? 0) >= 35 || (return1m ?? 0) >= 18 || momentum >= 90;
  const nearFairValue = valuationGap != null && valuationGap <= 5;
  const broken = input.aboveEma20 === false && momentum < 45
    && ((rs30 != null && rs30 < .95) || (return3m != null && return3m < -8));
  const weakening = !broken && (momentum < 52 || (rs30 != null && rs30 < .97)
    || (return3m != null && return3m < -5) || input.aboveEma20 === false);

  let stage: MomentumLifecycleStage = "UNCONFIRMED";
  if (broken) stage = "BROKEN";
  else if (weakening) stage = "WEAKENING";
  else if (matureMove || nearFairValue) stage = "MATURE";
  else if (expansion) stage = "MOMENTUM_EXPANSION";
  else if (momentum >= 62 && institutional >= 58 && relativeLeadership && positiveTape && aboveEma20) stage = "EARLY_MARKUP";
  else if (accumulationFlow && momentum >= 50 && momentum < 72 && (return3m ?? 0) < 18) stage = "ACCUMULATION";

  const stageBonus: Record<MomentumLifecycleStage, number> = {
    ACCUMULATION: 20,
    EARLY_MARKUP: 25,
    MOMENTUM_EXPANSION: 18,
    MATURE: 4,
    WEAKENING: -20,
    BROKEN: -34,
    UNCONFIRMED: 0,
  };
  const score = clamp(momentum * .38 + institutional * .28
    + Math.max(0, Math.min(18, ((rs30 ?? 1) - .9) * 90))
    + Math.max(0, Math.min(12, ((volumeRatio ?? 1) - .8) * 20))
    + stageBonus[stage]);
  const preferredEntry = stage === "ACCUMULATION" || stage === "EARLY_MARKUP" || stage === "MOMENTUM_EXPANSION";
  const holdEligible = preferredEntry || stage === "MATURE";

  const reason = stage === "ACCUMULATION"
    ? "Institutional and volume evidence is improving before the trend is extended."
    : stage === "EARLY_MARKUP"
      ? "Relative strength and trend participation are constructive while the move is still early."
      : stage === "MOMENTUM_EXPANSION"
        ? "Leadership is established and expanding; participate only while valuation room remains."
        : stage === "MATURE"
          ? nearFairValue ? "Momentum may remain healthy, but price is close to Fair Value; do not chase and prepare to trim." : "The move is extended; new money requires a constructive reset."
          : stage === "WEAKENING"
            ? "Relative strength or trend evidence is weakening; protect gains and review a trim."
            : stage === "BROKEN"
              ? "Trend, relative strength and return structure are broken; review exit."
              : "Evidence does not yet establish accumulation or durable markup.";

  const evidence = [
    `Momentum ${momentum.toFixed(0)}/100`,
    `Accumulation proxy ${institutional.toFixed(0)}/100`,
    ...(rs30 == null ? [] : [`RS vs SPY ${rs30.toFixed(3)}`]),
    ...(volumeRatio == null ? [] : [`5D/20D volume ${volumeRatio.toFixed(2)}x`]),
    ...(upDown == null ? [] : [`Up/Down volume ${upDown.toFixed(2)}x`]),
  ];
  const risks = [
    ...(!relativeLeadership ? ["Relative strength is not leading"] : []),
    ...(!accumulationFlow ? ["Volume does not confirm accumulation"] : []),
    ...(nearFairValue ? ["Valuation room is 5% or less"] : []),
    ...(stage === "WEAKENING" || stage === "BROKEN" ? [reason] : []),
  ];

  return {
    stage,
    score,
    preferredEntry,
    entryEligible: preferredEntry,
    holdEligible,
    exitSignal: stage === "WEAKENING" || stage === "BROKEN",
    nearFairValue,
    weakening: stage === "WEAKENING" || stage === "BROKEN",
    reason,
    evidence,
    risks,
    exitDiscipline: "Trim when momentum weakens or valuation room falls to 5% or less; exit when the thesis/trend breaks or Fair Value is fully priced.",
  };
}
