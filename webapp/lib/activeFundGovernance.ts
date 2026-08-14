export type CommitteeGateRecord = {
  ticker: string;
  kind: string;
  sizeUsd?: number | null;
  approxShares?: number | null;
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
const finiteOrNull = (value: unknown): number | null => Number.isFinite(Number(value)) ? Number(value) : null;
const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const saleKinds = new Set(["RAISE CASH", "TRIM", "EXIT"]);

function gatesPassed(record: CommitteeGateRecord | undefined) {
  if (!record || record.veto || String(record.outcome ?? "").toUpperCase() !== "CARRIED") return false;
  const gates = Array.isArray(record.decisionGates) ? record.decisionGates : [];
  return gates.length >= 4 && gates.every((gate) => String(gate.status ?? "").toUpperCase() === "PASS");
}

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
    return { allowed: false, reason: `Committee veto: ${why}`, reasonTh: `Committee VETO: ${why}` };
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
    return { allowed: false, reason: `Committee has not carried this purchase: ${why}`, reasonTh: `Committee ยังไม่อนุมัติรายการซื้อ: ${why}` };
  }
  if (failedGate) {
    const why = failedGate.rationale || `${failedGate.stage || "Authority"} gate ${failedGate.status || "did not pass"}`;
    return { allowed: false, reason: `Authority gate did not pass: ${why}`, reasonTh: `Authority Gate ยังไม่ผ่าน: ${why}` };
  }
  if (gates.length < 4) {
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

function motionPriority(record: CommitteeGateRecord) {
  const kind = String(record.kind ?? "").toUpperCase();
  if (kind === "RAISE CASH") return 0;
  if (kind === "EXIT") return 1;
  if (kind === "TRIM") return 2;
  if (kind === "NEW BUY") return 3;
  if (kind === "ADD") return 4;
  return 5;
}

function bestMotion(records: CommitteeGateRecord[]) {
  return [...records].sort((a, b) => {
    const carriedDelta = Number(gatesPassed(b)) - Number(gatesPassed(a));
    return carriedDelta || motionPriority(a) - motionPriority(b);
  })[0];
}

export function applyCommitteeCashPool(review: any, committee?: CommitteeSnapshot | null) {
  const output = structuredClone(review ?? {});
  const plans: any[] = Array.isArray(output.executionPlans) ? output.executionPlans : [];
  const motions = Array.isArray(committee?.motions) ? committee!.motions! : [];
  const motionsByTicker = new Map<string, CommitteeGateRecord[]>();
  const riskMotions = new Map<string, CommitteeGateRecord>();

  for (const motion of motions) {
    const ticker = cleanTicker(motion.ticker);
    if (!ticker) continue;
    const rows = motionsByTicker.get(ticker) ?? [];
    rows.push(motion);
    motionsByTicker.set(ticker, rows);
    const kind = String(motion.kind ?? "").toUpperCase();
    if (["NEW BUY", "ADD"].includes(kind) || !riskMotions.has(ticker)) riskMotions.set(ticker, motion);
  }

  const bufferBeforeUsd = Math.max(0, finite(output?.liquidity?.currentUsd));
  const floorUsd = Math.max(0, finite(output?.liquidity?.targetUsd));
  const floorRepairUsd = round2(Math.max(0, floorUsd - bufferBeforeUsd));
  const existingRows: any[] = Array.isArray(output.existing) ? output.existing : [];
  const existingByTicker = new Map(existingRows.map((row: any) => [cleanTicker(row.ticker), row]));
  const heldTickers = new Set(existingByTicker.keys());
  const planByTicker = new Map<string, any>();
  for (const plan of plans) {
    const ticker = cleanTicker(plan.ticker);
    if (ticker && heldTickers.has(ticker) && !planByTicker.has(ticker)) planByTicker.set(ticker, plan);
  }

  const saleMotionByTicker = new Map<string, CommitteeGateRecord>();
  for (const [ticker, records] of motionsByTicker.entries()) {
    const authorized = records
      .filter((record) => saleKinds.has(String(record.kind ?? "").toUpperCase()) && gatesPassed(record))
      .sort((a, b) => motionPriority(a) - motionPriority(b));
    if (authorized.length) saleMotionByTicker.set(ticker, authorized[0]);
  }

  let inferredFloorRepairRemaining = floorRepairUsd;
  const saleAmount = (record: CommitteeGateRecord, ticker: string, rawPlan?: any) => {
    const exact = Math.abs(finiteOrNull(record.sizeUsd) ?? 0);
    if (exact > 0) return round2(exact);
    const kind = String(record.kind ?? "").toUpperCase();
    const row = existingByTicker.get(ticker);
    if (kind === "RAISE CASH") {
      const available = Math.max(0, finite(row?.marketValueUsd));
      const inferred = round2(Math.min(inferredFloorRepairRemaining, available || inferredFloorRepairRemaining));
      inferredFloorRepairRemaining = round2(Math.max(0, inferredFloorRepairRemaining - inferred));
      return inferred;
    }
    if (kind === "EXIT") return round2(Math.max(0, finite(row?.marketValueUsd) || finite(rawPlan?.amountUsd)));
    return round2(Math.max(0, finite(rawPlan?.amountUsd)));
  };

  const applySaleAuthority = (plan: any, record: CommitteeGateRecord, ticker: string) => {
    const kind = String(record.kind ?? "").toUpperCase();
    const amountUsd = saleAmount(record, ticker, plan);
    const row = existingByTicker.get(ticker);
    const price = Math.max(0, finite(row?.currentPrice));
    const exactShares = finiteOrNull(record.approxShares);
    const sharesApprox = exactShares != null && exactShares > 0
      ? exactShares
      : price > 0 && amountUsd > 0
        ? round2(amountUsd / price)
        : kind === "EXIT" ? finiteOrNull(row?.positionShares) : null;
    plan.action = kind === "EXIT" ? "EXIT" : "TRIM";
    plan.instruction = kind === "RAISE CASH" ? `RAISE BUFFER — SELL ${ticker}` : `${kind} ${ticker}`;
    plan.instructionTh = kind === "RAISE CASH" ? `เพิ่ม CASH BUFFER — ขาย ${ticker}` : `${kind} ${ticker}`;
    plan.amountUsd = amountUsd;
    plan.sharesApprox = sharesApprox;
    plan.trimPct = kind === "EXIT" ? 100 : plan.trimPct ?? null;
    plan.fundingLegs = [];
    plan.destinationTicker = null;
    plan.proceedsDestination = "Cash Buffer Pool";
    plan.committeeKind = kind;
    plan.committeeOutcome = record.outcome;
    plan.note = kind === "RAISE CASH"
      ? `Committee-authorized Cash Floor repair. Sell exactly $${amountUsd.toFixed(2)} of ${ticker}; proceeds are ring-fenced in the Cash Buffer and cannot fund another purchase at this meeting.`
      : `Committee-authorized ${kind}. Sell exactly $${amountUsd.toFixed(2)} of ${ticker}; proceeds enter the Cash Buffer Pool before any later allocation.`;
    plan.noteTh = kind === "RAISE CASH"
      ? `มติ Committee ให้ขาย ${ticker} จำนวน $${amountUsd.toFixed(2)} เพื่อเติม Cash Floor โดยตรง เงินส่วนนี้ถูกกันไว้ใน Cash Buffer และห้ามนำไปซื้อหุ้นอื่นในรอบนี้`
      : `Committee อนุมัติ ${kind} ${ticker} จำนวน $${amountUsd.toFixed(2)} เงินจากการขายต้องเข้ารวม Cash Buffer Pool ก่อนการจัดสรรครั้งถัดไป`;
    return plan;
  };

  // Research may propose a sale, but the Action Sheet may show it only when the
  // exact current Committee motion carried. This prevents V/MELI research trims
  // from appearing as executable sales when the CIO meeting authorized only an
  // HSBC cash-floor repair.
  for (const plan of plans) {
    const ticker = cleanTicker(plan.ticker);
    if (!heldTickers.has(ticker)) continue;
    const rawAction = String(plan.action ?? "").toUpperCase();
    const authorizedSale = saleMotionByTicker.get(ticker);
    if (authorizedSale) {
      applySaleAuthority(plan, authorizedSale, ticker);
      continue;
    }
    if (["TRIM", "EXIT"].includes(rawAction)) {
      const record = bestMotion(motionsByTicker.get(ticker) ?? []);
      const deferredSale = record && saleKinds.has(String(record.kind ?? "").toUpperCase()) && String(record.outcome ?? "").toUpperCase() !== "CARRIED";
      plan.action = deferredSale ? "WAIT" : "HOLD";
      plan.instruction = deferredSale ? "WAIT — COMMITTEE DEFERRED SALE" : "HOLD — NO COMMITTEE SELL AUTHORITY";
      plan.instructionTh = deferredSale ? "รอ — COMMITTEE ยังไม่อนุมัติขาย" : "ถือต่อ — COMMITTEE ไม่ได้อนุมัติขาย";
      plan.amountUsd = 0;
      plan.sharesApprox = null;
      plan.trimPct = null;
      plan.fundingLegs = [];
      plan.destinationTicker = null;
      plan.proceedsDestination = null;
      plan.note = deferredSale
        ? `Research suggested a reduction, but the current Committee did not carry the ${record?.kind ?? "sale"}. It is not an executable trade.`
        : "Research suggested a reduction, but no current Committee sell motion authorizes it. Keep the position unchanged.";
      plan.noteTh = deferredSale
        ? `Research เสนอให้ลดน้ำหนัก แต่ Committee รอบนี้ยังไม่อนุมัติ ${record?.kind ?? "รายการขาย"} จึงไม่ใช่รายการซื้อขายจริง`
        : "Research เสนอให้ลดน้ำหนัก แต่ไม่มีมติขายจาก Committee รอบนี้ จึงต้องถือสถานะเดิม";
    }
  }

  // A Committee sale must appear even when the independent underwriting layer
  // originally emitted HOLD/ADD and therefore had no sale row to reuse.
  for (const [ticker, record] of saleMotionByTicker.entries()) {
    let plan = planByTicker.get(ticker);
    if (!plan) {
      plan = {
        ticker,
        action: "HOLD",
        instruction: "HOLD",
        instructionTh: "ถือต่อ",
        amountUsd: 0,
        sharesApprox: null,
        trimPct: null,
        fundingLegs: [],
        destinationTicker: null,
        proceedsDestination: null,
        note: "",
        noteTh: "",
      };
      plans.push(plan);
      planByTicker.set(ticker, plan);
    }
    applySaleAuthority(plan, record, ticker);
  }

  // The visible holding state follows the same authority snapshot. Keep the
  // research action for audit, but do not present it as the meeting decision.
  output.existing = existingRows.map((row: any) => {
    const ticker = cleanTicker(row.ticker);
    const record = bestMotion(motionsByTicker.get(ticker) ?? []);
    if (!record) return { ...row, researchAction: row.action, action: motions.length ? "WAIT" : row.action };
    const kind = String(record.kind ?? "").toUpperCase();
    const carried = gatesPassed(record);
    const action = carried
      ? kind === "RAISE CASH" ? "RAISE BUFFER"
        : kind === "TRIM" ? "TRIM"
        : kind === "EXIT" ? "EXIT"
        : kind === "ADD" ? "ADD"
        : "HOLD"
      : kind === "HOLD" ? "HOLD" : "WAIT";
    return { ...row, researchAction: row.action, action, committeeKind: kind, committeeOutcome: record.outcome };
  });

  const salePlans = plans.filter((plan) => ["TRIM", "EXIT"].includes(String(plan.action ?? "").toUpperCase()) && finite(plan.amountUsd) > 0);
  const cashFloorRepairSalesUsd = round2(salePlans
    .filter((plan) => String(plan.committeeKind ?? "").toUpperCase() === "RAISE CASH")
    .reduce((sum, plan) => sum + Math.max(0, finite(plan.amountUsd)), 0));
  const otherCommitteeSalesUsd = round2(salePlans
    .filter((plan) => String(plan.committeeKind ?? "").toUpperCase() !== "RAISE CASH")
    .reduce((sum, plan) => sum + Math.max(0, finite(plan.amountUsd)), 0));
  const saleProceedsUsd = round2(cashFloorRepairSalesUsd + otherCommitteeSalesUsd);
  const poolAfterSalesUsd = round2(bufferBeforeUsd + saleProceedsUsd);
  let deployableAfterSalesUsd = round2(Math.max(0, poolAfterSalesUsd - floorUsd));
  const initialDeployableAfterSalesUsd = deployableAfterSalesUsd;

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
      plan.note = `${gate.reason} Any Committee-authorized sale proceeds remain in the Cash Buffer Pool.`;
      plan.noteTh = `${gate.reasonTh} เงินจากรายการขายที่ Committee อนุมัติจะพักอยู่ใน Cash Buffer Pool`;
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

  output.replacements = (Array.isArray(output.replacements) ? output.replacements : [])
    .filter((row: any) => riskGate(riskMotions.get(cleanTicker(row.to))).allowed)
    .map((row: any) => ({
      ...row,
      sourceHolding: row.from,
      from: "CASH BUFFER POOL",
      reason: `Research ranking only: ${row.from} is a weak-link candidate. No sale is assumed unless the current Committee separately carried it. ${row.to} may receive pooled capital only after the Cash Floor is restored and the Committee carried ${row.to}. ${row.reason ?? ""}`.trim(),
    }));

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
    cashFloorRepairSalesUsd,
    otherCommitteeSalesUsd,
    saleProceedsUsd,
    floorRepairUsd,
    poolAfterSalesUsd,
    floorUsd: round2(floorUsd),
    deployableAfterSalesUsd: round2(initialDeployableAfterSalesUsd),
    approvedPurchasesUsd: round2(approvedPurchasesUsd),
    remainingDeployableUsd: round2(deployableAfterSalesUsd),
    remainingBufferUsd,
    blockedBuys,
    rule: "Committee exact SELL/TRIM/RAISE-BUFFER only → Cash Buffer Pool → restore Cash Floor → fund only Committee-carried BUY/ADD → remainder stays in Cash Buffer",
    ruleTh: "ใช้เฉพาะยอดขาย/ลดน้ำหนัก/RAISE BUFFER ที่ Committee อนุมัติจริง → รวมเข้า Cash Buffer Pool → เติม Cash Floor → ซื้อเฉพาะ BUY/ADD ที่ Committee อนุมัติ → เงินที่เหลือพักใน Cash Buffer",
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
    ...(motions.length ? [] : ["No current Committee snapshot was supplied; all execution-changing actions are blocked by governance."]),
  ];
  return output;
}
