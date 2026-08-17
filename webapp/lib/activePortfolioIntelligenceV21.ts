import {
  runActiveFundV2,
  type ActiveFundV2Result,
  type ExistingPositionInput,
  type CashContextInput,
  type ExecutionPlan,
} from "./activeFundV2";

export type V21Bucket = "BUY_ADD_NOW" | "WATCH_WITH_TRIGGER" | "REPLACE_REDUCE_REVIEW";

export type RankedCapitalCandidate = {
  rank: number;
  ticker: string;
  held: boolean;
  state: string;
  portfolioScore: number;
  expectedReturnPct: number | null;
  momentum: number | null;
  fairValueGapPct: number | null;
  reason: string;
};

export type WatchTrigger = {
  rank: number;
  ticker: string;
  trigger: string;
  triggerTh: string;
  blockers: string[];
  blockersTh: string[];
};

export type RotationReview = {
  from: string;
  to: string;
  scoreEdge: number;
  expectedReturnEdge: number | null;
  status: "EXECUTABLE" | "WATCH";
  reason: string;
  reasonTh: string;
};

export type ActivePortfolioPlanV21 = {
  version: "v21.0";
  buyAddNow: { ticker: string; action: string; amountUsd: number; funding: string }[];
  watchWithTrigger: WatchTrigger[];
  replaceReduceReview: RotationReview[];
  nextDollarRanking: RankedCapitalCandidate[];
  noTradeIntelligence: string;
  noTradeIntelligenceTh: string;
  mandate: string;
  mandateTh: string;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function fairValueGap(idea: any): number | null {
  const price = finite(idea?.currentPrice);
  const target = finite(idea?.targetPrice);
  if (price == null || target == null || price <= 0 || target <= 0) return null;
  return round1((target / price - 1) * 100);
}

function watchBlockers(idea: any) {
  const blockers: string[] = [];
  const blockersTh: string[] = [];
  const expected = finite(idea?.expectedReturnPct);
  const momentum = finite(idea?.momentum);
  const valuationStatus = String(idea?.valuationStatus ?? "UNAVAILABLE");
  const score = finite(idea?.portfolioScore) ?? 0;

  if (valuationStatus === "UNAVAILABLE") {
    blockers.push("No defensible fair-value target yet");
    blockersTh.push("ยังไม่มี Fair Value ที่เชื่อถือได้");
  }
  if (expected == null || expected < 8) {
    blockers.push(expected == null ? "Expected return is not measurable" : `Expected return ${round1(expected)}% is below the 8% deployment bar`);
    blockersTh.push(expected == null ? "ยังวัด Expected Return ไม่ได้" : `Expected Return ${round1(expected)}% ต่ำกว่าเกณฑ์ลงทุน 8%`);
  }
  if (momentum == null || momentum < 65) {
    blockers.push(momentum == null ? "Momentum gate is unavailable" : `Momentum ${round1(momentum)}/100 is below 65`);
    blockersTh.push(momentum == null ? "ยังไม่มี Momentum Gate" : `Momentum ${round1(momentum)}/100 ต่ำกว่า 65`);
  }
  if (score < 64) {
    blockers.push(`Portfolio score ${round1(score)}/100 is below 64`);
    blockersTh.push(`Portfolio Score ${round1(score)}/100 ต่ำกว่า 64`);
  }
  if (!blockers.length) {
    blockers.push("Research is constructive but Committee/technical/funding authority has not cleared execution");
    blockersTh.push("Research ผ่านเชิงคุณภาพ แต่ Committee / Technical / Funding ยังไม่อนุมัติให้ซื้อจริง");
  }
  return { blockers, blockersTh };
}

function triggerFor(idea: any, rank: number): WatchTrigger {
  const { blockers, blockersTh } = watchBlockers(idea);
  const expected = finite(idea?.expectedReturnPct);
  const momentum = finite(idea?.momentum);
  const valuationMissing = String(idea?.valuationStatus ?? "UNAVAILABLE") === "UNAVAILABLE";

  const gates = [
    valuationMissing ? "establish defensible Fair Value" : null,
    expected == null || expected < 8 ? "expected return ≥ 8%" : null,
    momentum == null || momentum < 65 ? "momentum ≥ 65 with no hard block" : null,
  ].filter(Boolean);
  const gatesTh = [
    valuationMissing ? "มี Fair Value ที่เชื่อถือได้" : null,
    expected == null || expected < 8 ? "Expected Return ≥ 8%" : null,
    momentum == null || momentum < 65 ? "Momentum ≥ 65 และไม่มี Hard Block" : null,
  ].filter(Boolean);

  return {
    rank,
    ticker: String(idea?.ticker ?? ""),
    trigger: gates.length ? `Re-underwrite when ${gates.join(" + ")}.` : "Re-underwrite when Committee, technical and funding gates all pass on the same snapshot.",
    triggerTh: gatesTh.length ? `วิเคราะห์ใหม่เมื่อ ${gatesTh.join(" + ")}` : "วิเคราะห์ใหม่เมื่อ Committee, Technical และ Funding ผ่านพร้อมกันใน Snapshot เดียว",
    blockers,
    blockersTh,
  };
}

function rankCapital(result: ActiveFundV2Result): RankedCapitalCandidate[] {
  const rows = [...result.existing, ...result.newIdeas, ...result.watchlistReviews]
    .filter((row: any) => row && row.ticker)
    .map((row: any) => ({
      ticker: String(row.ticker),
      held: Boolean(row.held),
      state: String(row.action ?? "WATCH"),
      portfolioScore: finite(row.portfolioScore) ?? 0,
      expectedReturnPct: finite(row.expectedReturnPct),
      momentum: finite(row.momentum),
      fairValueGapPct: fairValueGap(row),
      reason: `${row.held ? "Existing holding" : "New candidate"}; score ${round1(finite(row.portfolioScore) ?? 0)}/100; expected return ${finite(row.expectedReturnPct) == null ? "n/a" : `${round1(Number(row.expectedReturnPct))}%`}; momentum ${finite(row.momentum) == null ? "n/a" : `${round1(Number(row.momentum))}/100`}.`,
    }))
    .sort((a, b) => {
      const expectedA = a.expectedReturnPct ?? -50;
      const expectedB = b.expectedReturnPct ?? -50;
      return b.portfolioScore - a.portfolioScore || expectedB - expectedA;
    })
    .slice(0, 10);

  return rows.map((row, index) => ({ rank: index + 1, ...row }));
}

function rotationReviews(result: ActiveFundV2Result): RotationReview[] {
  const approved = result.replacements.map((row) => ({
    from: row.from,
    to: row.to,
    scoreEdge: row.scoreEdge,
    expectedReturnEdge: row.expectedReturnEdge,
    status: "EXECUTABLE" as const,
    reason: row.reason,
    reasonTh: `${row.to} เหนือกว่า ${row.from} ${row.scoreEdge} คะแนนพอร์ต${row.expectedReturnEdge == null ? "" : ` และ Expected Return ${row.expectedReturnEdge}%`} การสับเปลี่ยนใช้เฉพาะวงเงินที่ผ่าน Funding/Committee`,
  }));

  const used = new Set(approved.map((row) => `${row.from}->${row.to}`));
  const candidates = [...result.newIdeas].sort((a, b) => b.portfolioScore - a.portfolioScore);
  const weak = [...result.weakLinks].sort((a, b) => a.portfolioScore - b.portfolioScore);
  const watch: RotationReview[] = [];

  for (const old of weak) {
    const replacement = candidates.find((candidate) => {
      if (candidate.ticker === old.ticker) return false;
      const scoreEdge = candidate.portfolioScore - old.portfolioScore;
      const returnEdge = candidate.expectedReturnPct != null && old.expectedReturnPct != null
        ? candidate.expectedReturnPct - old.expectedReturnPct
        : null;
      return scoreEdge >= 8 && (returnEdge == null || returnEdge >= 3);
    });
    if (!replacement) continue;
    const key = `${old.ticker}->${replacement.ticker}`;
    if (used.has(key)) continue;
    const scoreEdge = round1(replacement.portfolioScore - old.portfolioScore);
    const returnEdge = replacement.expectedReturnPct != null && old.expectedReturnPct != null
      ? round1(replacement.expectedReturnPct - old.expectedReturnPct)
      : null;
    watch.push({
      from: old.ticker,
      to: replacement.ticker,
      scoreEdge,
      expectedReturnEdge: returnEdge,
      status: "WATCH",
      reason: `${replacement.ticker} currently outranks ${old.ticker} by ${scoreEdge} portfolio-score points${returnEdge == null ? "" : ` and ${returnEdge}% expected-return points`}. Keep this as the leading replacement pair, but do not rotate until the candidate clears valuation, technical, Committee and funding gates on the same snapshot.`,
      reasonTh: `${replacement.ticker} มีคะแนนพอร์ตเหนือ ${old.ticker} ${scoreEdge} จุด${returnEdge == null ? "" : ` และ Expected Return เหนือกว่า ${returnEdge}%`} ให้เป็นคู่ทดแทนอันดับต้น แต่ยังไม่สับเปลี่ยนจนกว่า Valuation, Technical, Committee และ Funding จะผ่านพร้อมกัน`,
    });
    if (watch.length >= 4) break;
  }

  return [...approved, ...watch].slice(0, 6);
}

function enhanceExecutionPlans(result: ActiveFundV2Result, watches: WatchTrigger[], rotations: RotationReview[]): ExecutionPlan[] {
  const watchByTicker = new Map(watches.map((row) => [row.ticker, row]));
  const plans = result.executionPlans.map((plan) => {
    if (plan.action !== "WAIT") return plan;
    const watch = watchByTicker.get(plan.ticker);
    if (!watch) return plan;
    return {
      ...plan,
      instruction: `WATCH #${watch.rank} · NO TRADE NOW`,
      instructionTh: `เฝ้าดูอันดับ #${watch.rank} · ยังไม่ซื้อ`,
      note: `${watch.blockers.join("; ")}. ${watch.trigger}`,
      noteTh: `${watch.blockersTh.join("; ")} · ${watch.triggerTh}`,
    };
  });

  const existingKeys = new Set(plans.map((plan) => `${plan.ticker}:${plan.action}:${plan.destinationTicker ?? ""}`));
  for (const rotation of rotations.filter((row) => row.status === "WATCH")) {
    const key = `${rotation.from}:WAIT:${rotation.to}`;
    if (existingKeys.has(key)) continue;
    plans.push({
      ticker: rotation.from,
      action: "WAIT",
      instruction: `REVIEW ROTATION ${rotation.from} → ${rotation.to}`,
      instructionTh: `ทบทวนสับเปลี่ยน ${rotation.from} → ${rotation.to}`,
      amountUsd: 0,
      sharesApprox: null,
      trimPct: null,
      fundingLegs: [],
      destinationTicker: rotation.to,
      proceedsDestination: null,
      note: rotation.reason,
      noteTh: rotation.reasonTh,
    });
  }
  return plans;
}

export async function runActivePortfolioIntelligenceV21(input: {
  positions: ExistingPositionInput[];
  watchlistTickers: string[];
  cash: CashContextInput;
}) {
  const base = await runActiveFundV2(input);
  const actionable = base.executionPlans.filter((plan) => (plan.action === "INITIATE" || plan.action === "ADD") && plan.amountUsd > 0);
  const watchIdeas = [...base.newIdeas, ...base.watchlistReviews]
    .filter((idea) => !actionable.some((plan) => plan.ticker === idea.ticker))
    .sort((a, b) => b.portfolioScore - a.portfolioScore)
    .slice(0, 5);
  const watches = watchIdeas.map((idea, index) => triggerFor(idea, index + 1));
  const rotations = rotationReviews(base);
  const nextDollarRanking = rankCapital(base);
  const executionPlans = enhanceExecutionPlans(base, watches, rotations);

  const buyAddNow = actionable.map((plan) => ({
    ticker: plan.ticker,
    action: plan.action,
    amountUsd: plan.amountUsd,
    funding: plan.fundingLegs.length ? plan.fundingLegs.map((leg) => `${leg.source} $${Math.round(leg.amountUsd)}`).join(" + ") : "Committee funding pending",
  }));

  const noTradeIntelligence = buyAddNow.length
    ? `${buyAddNow.length} BUY/ADD action(s) are currently funded. The remaining opportunity list stays ranked with explicit triggers instead of disappearing from the meeting.`
    : watches.length
      ? `No new risk is executable now. The fund still has a plan: ${watches.map((row) => `${row.ticker} #${row.rank}`).join(", ")} are the leading candidates and each has a named re-underwrite trigger.`
      : "No external candidate produced enough measured edge this cycle. Keep deployable capital in the approved reserve and refresh the broad research rotation rather than force a weak trade.";
  const noTradeIntelligenceTh = buyAddNow.length
    ? `รอบนี้มี BUY/ADD ที่มีแหล่งเงินแล้ว ${buyAddNow.length} รายการ ส่วนโอกาสที่เหลือยังถูกจัดอันดับพร้อม Trigger ชัดเจน ไม่หายออกจากแผนประชุม`
    : watches.length
      ? `รอบนี้ยังไม่มีหุ้นใหม่ที่ซื้อได้จริง แต่กองทุนยังมีแผน: ${watches.map((row) => `${row.ticker} #${row.rank}`).join(", ")} คือ Candidate นำและมี Trigger สำหรับวิเคราะห์ใหม่ทุกตัว`
      : "รอบนี้ยังไม่มี Candidate ภายนอกที่มี Edge เพียงพอ ให้พักเงินส่วนเกินใน Reserve ที่อนุมัติและหมุน Research Universe รอบใหม่ แทนการฝืนซื้อหุ้นคุณภาพต่ำ";

  const activePortfolioPlan: ActivePortfolioPlanV21 = {
    version: "v21.0",
    buyAddNow,
    watchWithTrigger: watches,
    replaceReduceReview: rotations,
    nextDollarRanking,
    noTradeIntelligence,
    noTradeIntelligenceTh,
    mandate: "Every CIO cycle must rank the next dollar, name the leading external candidates, identify replacement pairs and explain a no-trade decision. No trade is still a portfolio decision, not an empty meeting.",
    mandateTh: "ทุก CIO Meeting ต้องจัดอันดับว่าเงินก้อนถัดไปควรไปไหน ระบุ Candidate ภายนอก คู่สับเปลี่ยน และเหตุผลของการไม่เทรด การไม่ซื้อขายยังต้องเป็นแผนพอร์ต ไม่ใช่ประชุมแล้วไม่มีคำตอบ",
  };

  return {
    ...base,
    version: "active-portfolio-intelligence-v21.0",
    executionPlans,
    activePortfolioPlan,
    process: [
      "V21 Opportunity Hunter: maintain a broad US research rotation and preserve the leading candidates even when they are not executable today.",
      "V21 Next-Dollar Ranking: compare current holdings and external candidates on portfolio score, expected return, momentum and valuation evidence.",
      "V21 Replacement Engine: every weak link is challenged by the best external candidate; a review pair is named before a rotation is allowed to disappear into cash.",
      "V21 Three-Bucket CIO output: BUY/ADD NOW, WATCH WITH TRIGGER, and REPLACE/REDUCE REVIEW. A no-trade meeting still produces an explicit plan.",
      ...base.process,
    ],
  };
}
