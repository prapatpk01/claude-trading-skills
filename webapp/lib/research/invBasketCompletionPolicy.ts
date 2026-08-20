export type BasketCompletionSignal = {
  selectedCount: number;
  targetMinNames: number;
  targetMaxNames: number;
  deployableUsd: number;
  allocatedUsd: number;
  unallocatedUsd: number;
  minOrderUsd: number;
  pass: number;
  maxPasses: number;
};

export type BasketCompletionDecision = {
  shouldExpand: boolean;
  nextPass: number | null;
  reason: string;
};

const finite = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export function shouldExpandInvBasket(input: BasketCompletionSignal): BasketCompletionDecision {
  const selectedCount = Math.max(0, Math.round(finite(input.selectedCount)));
  const targetMinNames = Math.max(1, Math.min(8, Math.round(finite(input.targetMinNames, 5))));
  const targetMaxNames = Math.max(targetMinNames, Math.min(8, Math.round(finite(input.targetMaxNames, 8))));
  const unallocatedUsd = Math.max(0, finite(input.unallocatedUsd));
  const minOrderUsd = Math.max(1, finite(input.minOrderUsd, 100));
  const pass = Math.max(0, Math.round(finite(input.pass)));
  const maxPasses = Math.max(1, Math.min(5, Math.round(finite(input.maxPasses, 3))));

  if (pass + 1 >= maxPasses) return { shouldExpand: false, nextPass: null, reason: "INV basket expansion reached the governed pass limit." };
  if (selectedCount >= targetMaxNames) return { shouldExpand: false, nextPass: null, reason: "INV basket already reached the maximum governed size." };
  if (unallocatedUsd < minOrderUsd) return { shouldExpand: false, nextPass: null, reason: "Residual capital is below the minimum useful order size." };

  const missingMinimum = selectedCount < targetMinNames;
  const materialResidual = unallocatedUsd >= minOrderUsd * 2;
  if (!missingMinimum && !materialResidual) return { shouldExpand: false, nextPass: null, reason: "INV basket is sufficiently complete for the current capital pool." };

  return {
    shouldExpand: true,
    nextPass: pass + 1,
    reason: missingMinimum
      ? `INV basket has only ${selectedCount}/${targetMinNames} target-minimum names and still has deployable capital.`
      : `INV basket has residual capital that can support another quality position without breaching the ${targetMaxNames}-name cap.`,
  };
}
