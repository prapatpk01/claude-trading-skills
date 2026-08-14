export type CommitteeGateRecord = {
  ticker: string;
  kind: string;
  outcome: string;
  outcomeReason?: string | null;
  veto?: { member?: string; reason?: string } | null;
  decisionGates?: { stage?: string; status?: string; rationale?: string }[];
};

export type CommitteeSnapshot = {
  meetingId?: string | null;
  asOf?: string | null;
  motions?: CommitteeGateRecord[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const finite = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();

function riskGate(record: CommitteeGateRecord | undefined) {
  if (!record) {
    return {
      allowed: false,
      reason: "No matching Committee motion exists in the current meeting. Run the CIO meeting first; Research alone cannot authorize a new risk position.",
      reasonTh: "ไม่พบมติ Committee ของหุ้นตัวนี้ในรอบประชุมปัจจุบัน ต้องผ่าน CIO Meeting ก่อน เพราะ Research เพียงอย่างเดียวไม่มีสิทธิ์อนุมัติการเพิ่มความเสี่ยง",
    };
  }
  const gates = Array.isArray(record.decisionGates) ? record.decisionGates : [];
  const failedGate = gates.find((gate) => String(gate.status ?? "").toUpperCase() !== "PASS");
  const carried = String(record.outcome ?? "").toUpperCase() === "CARRIED";
  const riskIncreasing = ["NEW BUY", "ADD"].includes(String(record.kind ?? "").toUpperCase());
  if (record.veto) {
    const why = record.veto.reason || record.outcomeReason || "Committee veto";
    return {
      allowed: false,
      reason: `Committee veto: ${why}`,
      reasonTh: `Committee VETO: ${why}`,
    };
  }
  if (!riskIncreasing) {
    return {
      allowed: false,
      reason: `The current Committee motion is ${record.kind || "not a risk-increase motion"}, not NEW BUY/ADD.`,
      reasonTh: `มติ Committee ปัจจุบันเป็น ${record.kind || "มติที่ไม่ใช่การเพิ่มความเสี่ยง"} ไม่ใช่ NEW BUY/ADD`,
    };
  }
  if (!carried) {
    const why = record.outcomeReason || `Outcome ${record.outcome}`;
    return {
      allowed: false,
      reason: `Committee has not carried this purchase: ${why}`,
      reasonTh: `Committee ยังไม่อนุมัติรายการซื้อ: ${why}`,
    };
  }
  if (failedGate) {
    const why = failedGate.rationale || `${failedGate.stage || "Authority"} gate ${failedGate.status || "did not pass"}`;
    return {
      allowed: false,
      reason: `Authority gate did not pass: ${why}`,
      reasonTh: `Authority Gate ยังไม่ผ่าน: ${why}`,
    };
  }
  if (gates.length && gates.length < 4) {
    return {
      allowed: false,
      reason: "The Committee authority chain is incomplete; all four Investment, Asset Management, Risk and CIO gates are required.",
      reasonTh: "Authority Chain ของ Committee ยังไม่ครบ ต้องผ่าน Investment, Asset Management, Risk และ CIO ทั้ง 4 ขั้น",
    };
  }
  return {
    allowed: true,
    reason: "Committee CARRIED the risk increase and every recorded authority gate passed.",
    reasonTh: "Committee อนุมัติรายการเพิ่มความเสี่ยงและ Authority Gate ที่บันทึกไว้ผ่านครบ",
  };
}

export function applyCommitteeCashPool(review: any, committee?: CommitteeSnapshot | null) {
  const output = structuredClone(review ?? {});
  const plans: any[] = Array.isArray(output.executionPlans) ? output.executionPlans : [];
  const motions = Array.isArray(committee?.motions) ? committee!.motions! : [];
  const riskMotions = new Map<string, CommitteeGateRecord>();
  for (const motion of motions) {
    const ticker = cleanTicker(motion.ticker);
    if (!ticker) continue;
    const kind = String(motion.kind ?? "").toUpperCase();
    if (["NEW BUY", "ADD"].includes(kind) || !riskMotions.has(ticker)) riskMotions.set(ticker, motion);
  }

  // Every sale enters one fungible Cash Buffer Pool first. There is no direct
  // HSBC→ADBE (or any stock→stock) cash wire in the decision sheet.
  const salePlans = plans.filter((plan) => ["TRIM", "EXIT"].includes(String(plan.action ?? "").toUpperCase()));
  const saleProceedsUsd = round2(salePlans.reduce((sum, plan) => sum + Math.max(0, finite(plan.amountUsd)), 0));
  const bufferBeforeUsd = Math.max(0, finite(output?.liquidity?.currentUsd));
  const floorUsd = Math.max(0, finite(output?.liquidity?.targetUsd));
  const poolAfterSalesUsd = round2(bufferBeforeUsd + saleProceedsUsd);
  const floorRepairUsd = round2(Math.max(0, floorUsd - bufferBeforeUsd));
  let deployableAfterSalesUsd = round2(Math.max(0, poolAfterSalesUsd - floorUsd));
  const initialDeployableAfterSalesUsd = deployableAfterSalesUsd;

  for (const plan of salePlans) {
    plan.destinationTicker = null;
    plan.proceedsDestination = "Cash Buffer Pool";
    plan.fundingLegs = [];
    plan.note = "Sale proceeds enter the Cash Buffer Pool first. They are not wired directly into a replacement. The fund restores the Cash Floor before any new risk purchase is funded.";
    plan.noteTh = "เงินจากการขายเข้ารวมใน Cash Buffer Pool ก่อน ไม่ได้โอนจากหุ้นตัวนี้ไปหุ้นทดแทนโดยตรง ระบบต้องเติม Cash Floor ให้ครบก่อนจึงนำส่วนเกินไปลงทุนใหม่";
  }

  const blockedBuys: { ticker: string; reason: string; reasonTh: string }[] = [];
  let approvedPurchasesUsd = 0;

  for (const plan of plans) {
    const action = String(plan.action ?? "").toUpperCase();
    if (action !== "INITIATE" && action !== "ADD") continue;
    const ticker = cleanTicker(plan.ticker);
    const gate = riskGate(riskMotions.get(ticker));
    const requested = Math.max(0, finite(plan.amountUsd));

    if (!gate.allowed) {
      blockedBuys.push({ ticker, reason: gate.reason, reasonTh: gate.reasonTh });
      plan.action = "WAIT";
      plan.instruction = "WAIT — COMMITTEE BLOCKED";
      plan.instructionTh = "รอ — COMMITTEE ยังไม่อนุมัติ";
      plan.amountUsd = 0;
      plan.sharesApprox = null;
      plan.fundingLegs = [];
      plan.destinationTicker = null;
      plan.proceedsDestination = null;
      plan.note = `${gate.reason} Any trim proceeds remain in the Cash Buffer Pool.`;
      plan.noteTh = `${gate.reasonTh} เงินจากการลดน้ำหนักทั้งหมดจึงพักอยู่ใน Cash Buffer Pool`;
      continue;
    }

    if (requested <= 0 || deployableAfterSalesUsd + 0.005 < requested) {
      plan.action = "WAIT";
      plan.instruction = "WAIT — PROTECT CASH FLOOR";
      plan.instructionTh = "รอ — รักษา CASH FLOOR";
      plan.amountUsd = 0;
      plan.sharesApprox = null;
      plan.fundingLegs = [];
      plan.destinationTicker = null;
      plan.note = `Committee approval exists, but only $${round2(deployableAfterSalesUsd).toFixed(2)} remains above the Cash Floor versus $${round2(requested).toFixed(2)} requested. The purchase waits rather than underfunding the buffer.`;
      plan.noteTh = `Committee อนุมัติแล้ว แต่มีเงินเหนือ Cash Floor เพียง $${round2(deployableAfterSalesUsd).toFixed(2)} จากวงเงินที่ต้องการ $${round2(requested).toFixed(2)} จึงรอแทนการดึง Cash Buffer ต่ำกว่าเกณฑ์`;
      continue;
    }

    deployableAfterSalesUsd = round2(deployableAfterSalesUsd - requested);
    approvedPurchasesUsd = round2(approvedPurchasesUsd + requested);
    plan.fundingLegs = [{ source: "CASH BUFFER POOL", kind: "ROTATION", amountUsd: round2(requested) }];
    plan.note = `Committee gate passed. Fund $${round2(requested).toFixed(2)} from the pooled balance only after the Cash Floor is satisfied.`;
    plan.noteTh = `Committee ผ่านครบ ใช้ $${round2(requested).toFixed(2)} จาก Cash Buffer Pool เฉพาะส่วนที่เหลือหลังรักษา Cash Floor แล้ว`;
  }

  // Replacement Alpha remains useful as a ranking explanation, but it may no
  // longer imply that one source stock directly pays for one destination stock.
  output.replacements = (Array.isArray(output.replacements) ? output.replacements : [])
    .filter((row: any) => riskGate(riskMotions.get(cleanTicker(row.to))).allowed)
    .map((row: any) => ({
      ...row,
      sourceHolding: row.from,
      from: "CASH BUFFER POOL",
      reason: `Weak-link candidate ${row.from} contributes to pooled sale proceeds. ${row.to} may receive capital only after the Cash Floor is restored and only because the current Committee carried ${row.to}. ${row.reason ?? ""}`.trim(),
    }));

  // The decision list must tell the same story as the execution sheet.
  output.opportunityDecisions = (Array.isArray(output.opportunityDecisions) ? output.opportunityDecisions : []).map((decision: any) => {
    const gate = riskGate(riskMotions.get(cleanTicker(decision.ticker)));
    if (!gate.allowed) return {
      ...decision,
      decision: "WATCH WITH TRIGGER",
      proposedCapitalUsd: 0,
      fundingSource: "Cash Buffer Pool — blocked pending Committee",
      fundingLegs: [],
      reason: gate.reason,
      reasonTh: gate.reasonTh,
      trigger: "Run a new Committee meeting after the technical/risk block clears.",
      triggerTh: "รอให้ Technical/Risk Block หาย แล้วประชุม Committee ใหม่",
    };
    return {
      ...decision,
      fundingSource: "Cash Buffer Pool",
      fundingLegs: [{ source: "CASH BUFFER POOL", kind: "ROTATION", amountUsd: Math.max(0, finite(decision.proposedCapitalUsd)) }],
    };
  });

  const remainingBufferUsd = round2(poolAfterSalesUsd - approvedPurchasesUsd);
  output.cashPoolPlan = {
    committeeMeetingId: committee?.meetingId ?? null,
    committeeAsOf: committee?.asOf ?? null,
    bufferBeforeUsd: round2(bufferBeforeUsd),
    saleProceedsUsd,
    floorRepairUsd,
    poolAfterSalesUsd,
    floorUsd: round2(floorUsd),
    deployableAfterSalesUsd: round2(initialDeployableAfterSalesUsd),
    approvedPurchasesUsd: round2(approvedPurchasesUsd),
    remainingDeployableUsd: round2(deployableAfterSalesUsd),
    remainingBufferUsd,
    blockedBuys,
    rule: "SELL/TRIM → Cash Buffer Pool → restore Cash Floor → fund only Committee-carried BUY/ADD → remainder stays in Cash Buffer",
    ruleTh: "SELL/TRIM → รวมเข้า Cash Buffer Pool → เติม Cash Floor → ซื้อเฉพาะรายการ BUY/ADD ที่ Committee อนุมัติ → เงินที่เหลือพักใน Cash Buffer",
  };

  output.executionPlans = plans;
  output.capitalPlan = {
    ...(output.capitalPlan ?? {}),
    deployUsd: round2(approvedPurchasesUsd),
    fundedFromLiquidityUsd: round2(approvedPurchasesUsd),
    fundedFromRotationsUsd: 0,
    liquidityAfterUsd: remainingBufferUsd,
    liquidityAfterPct: finite(output.nav) > 0 ? round2(remainingBufferUsd / finite(output.nav) * 100) : 0,
  };
  output.warnings = [
    ...(Array.isArray(output.warnings) ? output.warnings : []),
    ...(motions.length ? [] : ["No current Committee snapshot was supplied; all ADD/INITIATE actions are blocked by governance."]),
  ];
  return output;
}
