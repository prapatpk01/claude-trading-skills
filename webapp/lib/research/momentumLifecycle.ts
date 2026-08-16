export type MomentumLifecycleStage =
  | "ACCUMULATION"
  | "EARLY_MARKUP"
  | "MOMENTUM_EXPANSION"
  | "MATURE"
  | "WEAKENING"
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
  nearFairValue: boolean;
  weakening: boolean;
  reason: string;
  exitDiscipline: string;
};

const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Active-momentum lifecycle used by Sentinel Research OS V23.
 *
 * Raw RS/volume inputs are preferred. When a downstream portfolio view only has
 * the already-computed Momentum and Institutional scores, those aggregate scores
 * are accepted as lower-resolution proxies instead of hiding the lifecycle stage.
 */
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
    && (volumeRatio == null ? institutional >= 64 : volumeRatio >= 0.95)
    && (upDown == null ? institutional >= 64 : upDown >= 1);
  const relativeLeadership = rs30 == null ? momentum >= 62 : rs30 >= 1;
  const positiveTape = return3m == null ? momentum >= 62 : return3m > -3;
  const expansionReturn = return3m == null ? momentum >= 78 : return3m >= 7;
  const expansion = momentum >= 72 && institutional >= 62 && relativeLeadership && maFanning && expansionReturn;
  const matureMove = (return3m ?? 0) >= 35 || (return1m ?? 0) >= 18 || momentum >= 90;
  const nearFairValue = valuationGap != null && valuationGap <= 5;
  const weakening = momentum < 52 || (rs30 != null && rs30 < 0.97) || (return3m != null && return3m < -5) || input.aboveEma20 === false;

  let stage: MomentumLifecycleStage = "UNCONFIRMED";
  if (weakening) stage = "WEAKENING";
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
    UNCONFIRMED: 0,
  };
  const score = clamp(
    momentum * 0.38 +
    institutional * 0.28 +
    Math.max(0, Math.min(18, ((rs30 ?? 1) - 0.9) * 90)) +
    Math.max(0, Math.min(12, ((volumeRatio ?? 1) - 0.8) * 20)) +
    stageBonus[stage],
  );
  const preferredEntry = stage === "ACCUMULATION" || stage === "EARLY_MARKUP" || stage === "MOMENTUM_EXPANSION";

  const reason = stage === "ACCUMULATION"
    ? "Institutional/volume evidence is improving before a fully extended trend; this is the fund's preferred discovery zone."
    : stage === "EARLY_MARKUP"
      ? "Relative strength and trend participation have turned constructive while the move is still early."
      : stage === "MOMENTUM_EXPANSION"
        ? "Leadership is established and expanding; participate only while valuation still leaves room and technical risk remains clean."
        : stage === "MATURE"
          ? nearFairValue
            ? "Momentum may still be healthy, but the price is close to fair value; do not chase and prepare to trim as upside compresses."
            : "The move is extended versus its recent return profile; new money requires a reset or a fresh valuation/catalyst upgrade."
          : stage === "WEAKENING"
            ? "Relative strength/trend evidence is weakening; protect gains, review trim/exit and require a new thesis before adding."
            : "The evidence does not yet establish accumulation or a durable markup phase.";

  return {
    stage,
    score,
    preferredEntry,
    nearFairValue,
    weakening,
    reason,
    exitDiscipline: "Trim/exit when momentum weakens, the investment thesis changes, a hard risk block appears, or defensible valuation room is largely exhausted.",
  };
}
