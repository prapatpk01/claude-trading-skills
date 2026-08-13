import { buildAnalysis } from "./analyze";
import { buildMacroOutlook, type MacroOutlook } from "./macroOutlook";
import { runInvestmentResearchOS, type InvestmentResearchProposal } from "./research/investmentDiscovery";

export type FundAction = "INITIATE" | "ADD" | "LET WINNER RUN" | "HOLD" | "TRIM PROFIT REVIEW" | "TRIM REVIEW" | "EXIT REVIEW" | "WATCH";
export type OpportunityDecisionType = "INITIATE FROM LIQUIDITY" | "ROTATE / REPLACE" | "WATCH WITH TRIGGER" | "REJECT";
export type ValuationStatus = "VALID" | "NO_EDGE" | "UNAVAILABLE";
export type ValuationSource = "THOMAS_MULTI_ANCHOR" | "RESEARCH_OS_TARGET" | "UNAVAILABLE";
export type ExecutionAction = "HOLD" | "ADD" | "TRIM" | "EXIT" | "INITIATE" | "WAIT";

export interface ExistingPositionInput {
  ticker: string;
  shares: number;
  avgCost: number;
  openedAt?: string | null;
}

export interface CashContextInput {
  totalNav: number;
  cashBalance: number;
  dividendAvailable?: number;
  liquidityBuffer: number;
  cashFloorPct: number;
  targetValue: number;
  bufferPct: number | null;
  reserveHoldings?: { ticker: string; marketValue: number }[];
}

export interface FundingLeg {
  source: string;
  kind: "USD" | "DIVIDEND" | "RESERVE" | "ROTATION";
  amountUsd: number;
}

export interface ActiveFundIdea {
  ticker: string;
  source: string[];
  held: boolean;
  action: FundAction;
  conviction: number;
  confidence: string;
  expectedReturnPct: number | null;
  targetPrice: number | null;
  currentPrice: number | null;
  momentum: number | null;
  pnlPct: number | null;
  portfolioScore: number;
  targetWeightPct: number;
  capitalUsd: number;
  committee: string;
  thesis: string;
  dissent: string[];
  reasons: string[];
  factors?: Record<string, number>;
  valuationStatus: ValuationStatus;
  valuationSource: ValuationSource;
  valuationNote: string;
  positionShares: number | null;
  marketValueUsd: number | null;
}

export interface OpportunityDecision {
  ticker: string;
  decision: OpportunityDecisionType;
  fundingSource: string;
  fundingLegs: FundingLeg[];
  comparedWith: string | null;
  relativeEdge: number | null;
  proposedWeightPct: number;
  proposedCapitalUsd: number;
  reason: string;
  reasonTh: string;
  trigger: string;
  triggerTh: string;
}

export interface ExecutionPlan {
  ticker: string;
  action: ExecutionAction;
  instruction: string;
  instructionTh: string;
  amountUsd: number;
  sharesApprox: number | null;
  trimPct: number | null;
  fundingLegs: FundingLeg[];
  destinationTicker: string | null;
  proceedsDestination: string | null;
  note: string;
  noteTh: string;
}

export interface ActiveFundV2Result {
  version: string;
  asOf: string;
  nav: number;
  macro: MacroOutlook;
  liquidity: {
    currentUsd: number; currentPct: number; targetUsd: number; targetPct: number;
    deployableUsd: number; reserveGapUsd: number; status: "EXCESS" | "ON TARGET" | "BELOW TARGET";
    cashBalance: number; dividendAvailable: number;
    positions: { ticker: string; marketValue: number }[]; fundingOrder: string[];
  };
  discovery: {
    broadUniverse: number; detailedAnalyzed: number; qualified: number; watchlist: number;
    uniqueNew: number; models: number; methodology: string;
  };
  newIdeas: ActiveFundIdea[];
  existing: ActiveFundIdea[];
  portfolioWinners: ActiveFundIdea[];
  weakLinks: ActiveFundIdea[];
  opportunityDecisions: OpportunityDecision[];
  executionPlans: ExecutionPlan[];
  replacements: { from: string; to: string; reason: string; rotatePct: number; rotateUsd: number; scoreEdge: number; expectedReturnEdge: number | null }[];
  capitalPlan: {
    requestedDeployUsd: number; deployUsd: number; fundedFromLiquidityUsd: number; fundedFromRotationsUsd: number;
    raiseUsd: number; liquidityAfterUsd: number; liquidityAfterPct: number;
    initiates: number; adds: number; holds: number; reviews: number;
  };
  process: string[];
  warnings: string[];
}

const LIQUIDITY_TICKERS = new Set(["SGOV", "JAAA", "TBIL", "BIL", "SHV", "SHY", "USFR", "TFLO", "ICSH", "JPST", "MINT"]);
const clamp = (x: number, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const finite = (x: unknown): number | null => typeof x === "number" && Number.isFinite(x) ? x : Number.isFinite(Number(x)) ? Number(x) : null;
const round1 = (x: number) => Math.round(x * 10) / 10;
const round0 = (x: number) => Math.round(x);
const round2 = (x: number) => Math.round(x * 100) / 100;
const cleanTicker = (x: string) => String(x).trim().toUpperCase();

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

async function analyzeSafe(ticker: string) {
  try { return await buildAnalysis(ticker); }
  catch { return null; }
}

function expectedScore(expectedReturnPct: number | null) {
  return clamp(50 + (expectedReturnPct ?? 0) * 2);
}

function scoreExisting(conviction: number, momentum: number | null, expectedReturnPct: number | null, committee: string) {
  const committeeScore = committee === "APPROVE" ? 85 : committee === "REJECT" ? 20 : 55;
  return round1(conviction * .32 + (momentum ?? 50) * .25 + expectedScore(expectedReturnPct) * .28 + committeeScore * .15);
}

function scoreProposal(proposal: InvestmentResearchProposal) {
  const f = proposal.factors;
  const qualityGrowth = (f.quality + f.growth) / 2;
  const expected = expectedScore(proposal.expectedReturnPct);
  return round1(expected * .30 + qualityGrowth * .20 + f.momentum * .20 + f.value * .15 + f.institutional * .10 + Math.min(100, proposal.sourceModels.length * 16) * .05);
}

function targetWeight(score: number, macro: MacroOutlook) {
  const base = clamp(2 + (score - 60) * .10, 2, 8);
  return round1(base * clamp(macro.riskBudgetPct, 20, 100) / 100);
}

function valuationFromAnalysis(a: any) {
  const price = finite(a?.data?.quote?.price);
  const rawTarget = finite(a?.targetPrice);
  const note = String(a?.valuationNote ?? "");
  const genericFallback = /insufficient fundamental data|generic ±20% spot band/i.test(note);
  if (genericFallback || price == null || price <= 0 || rawTarget == null || rawTarget <= 0) {
    return {
      status: "UNAVAILABLE" as ValuationStatus,
      source: "UNAVAILABLE" as ValuationSource,
      targetPrice: null,
      expectedReturnPct: null,
      note: genericFallback ? "Thomas could not establish a defensible fundamental fair-value anchor; the spot-price fallback is suppressed." : "A defensible valuation target is unavailable.",
    };
  }
  const gap = (rawTarget / price - 1) * 100;
  return {
    status: Math.abs(gap) < .5 ? "NO_EDGE" as ValuationStatus : "VALID" as ValuationStatus,
    source: "THOMAS_MULTI_ANCHOR" as ValuationSource,
    targetPrice: rawTarget,
    expectedReturnPct: finite(a?.expectedReturnPct),
    note: note || "Thomas multi-anchor valuation.",
  };
}

function stripSyntheticSpotTarget(thesis: string, status: ValuationStatus) {
  if (status !== "UNAVAILABLE") return thesis;
  const cleaned = String(thesis ?? "")
    .replace(/\s*Target\s*~?\$[\d,.]+\s*\([+-]?\d+(?:\.\d+)?%\s+vs\s+spot\)\.?/gi, "")
    .trim();
  return `${cleaned || "Operating thesis remains under review."} Valuation target is currently unavailable and is not inferred from spot.`;
}

function fromProposal(proposal: InvestmentResearchProposal, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const score = scoreProposal(proposal);
  const weight = targetWeight(score, macro);
  const approved = score >= 64 && proposal.expectedReturnPct >= 8 && proposal.sourceModels.length >= 2;
  const gap = proposal.price > 0 ? (proposal.target / proposal.price - 1) * 100 : 0;
  return {
    ticker: proposal.ticker,
    source: ["Sentinel Research OS Phase 1", ...proposal.sourceModels.map(x => x.toUpperCase())],
    held: false,
    action: approved ? "INITIATE" : "WATCH",
    conviction: Math.round(score),
    confidence: proposal.sourceModels.length >= 4 ? "HIGH" : proposal.sourceModels.length >= 2 ? "MEDIUM" : "LOW",
    expectedReturnPct: proposal.expectedReturnPct,
    targetPrice: proposal.target,
    currentPrice: proposal.price,
    momentum: proposal.factors.momentum,
    pnlPct: null,
    portfolioScore: score,
    targetWeightPct: approved ? weight : 0,
    capitalUsd: approved ? round0(nav * weight / 100) : 0,
    committee: approved ? "RESEARCH QUALIFIED" : "WATCH",
    thesis: proposal.thesis,
    dissent: proposal.unmeasured,
    reasons: [
      `Research OS score ${proposal.score}/100 across ${proposal.sourceModels.length} qualified factor models.`,
      `Expected return ${round1(proposal.expectedReturnPct)}%; momentum ${proposal.factors.momentum}; quality ${proposal.factors.quality}; growth ${proposal.factors.growth}; value ${proposal.factors.value}.`,
    ],
    factors: proposal.factors,
    valuationStatus: Math.abs(gap) < .5 ? "NO_EDGE" : "VALID",
    valuationSource: "RESEARCH_OS_TARGET",
    valuationNote: "Research OS target; Thomas remains the core fundamental valuation engine for portfolio holdings/watchlist deep dives.",
    positionShares: null,
    marketValueUsd: null,
  };
}

function fromWatchlistAnalysis(a: any, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a?.committee ?? {};
  const conviction = finite(c.conviction) ?? 0;
  const momentum = finite(a?.momentum?.total);
  const valuation = valuationFromAnalysis(a);
  const expected = valuation.expectedReturnPct;
  const committee = String(c.decision ?? "WATCH").toUpperCase();
  const score = scoreExisting(conviction, momentum, expected, committee);
  const approved = committee === "APPROVE" && expected != null && expected >= 8 && score >= 64 && valuation.status !== "UNAVAILABLE";
  const weight = approved ? targetWeight(score, macro) : 0;
  const rawThesis = a?.thesis?.find?.((x: any) => x.label === "Base")?.narrative ?? "Watchlist candidate awaiting a stronger edge.";
  return {
    ticker: cleanTicker(a?.ticker ?? ""), source: ["Watchlist / Thomas Research"], held: false,
    action: approved ? "INITIATE" : "WATCH", conviction: Math.round(conviction), confidence: String(c.confidence ?? "LOW"),
    expectedReturnPct: expected, targetPrice: valuation.targetPrice, currentPrice: finite(a?.data?.quote?.price), momentum,
    pnlPct: null, portfolioScore: score, targetWeightPct: weight, capitalUsd: round0(nav * weight / 100), committee,
    thesis: stripSyntheticSpotTarget(rawThesis, valuation.status),
    dissent: Array.isArray(c.dissent) ? c.dissent : [], reasons: [
      ...(Array.isArray(c.reasons) ? c.reasons : []),
      valuation.status === "UNAVAILABLE" ? "Valuation is unavailable; spot-price fallback is not accepted as fair value." : valuation.note,
    ],
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuationNote: valuation.note,
    positionShares: null,
    marketValueUsd: null,
  };
}

function fromExistingAnalysis(a: any, position: ExistingPositionInput, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a?.committee ?? {};
  const committee = String(c.decision ?? "WATCH").toUpperCase();
  const conviction = finite(c.conviction) ?? 0;
  const momentum = finite(a?.momentum?.total);
  const valuation = valuationFromAnalysis(a);
  const expected = valuation.expectedReturnPct;
  const price = finite(a?.data?.quote?.price);
  const pnlPct = price != null && position.avgCost > 0 ? (price / position.avgCost - 1) * 100 : null;
  const score = scoreExisting(conviction, momentum, expected, committee);
  let action: FundAction = "HOLD";

  const winner = pnlPct != null && pnlPct >= 10 && (momentum ?? 0) >= 65 && expected != null && expected >= 8 && committee !== "REJECT";
  const profitFading = pnlPct != null && pnlPct >= 12 && ((momentum != null && momentum < 55) || (expected != null && expected < 5));
  const broken = committee === "REJECT" || (expected != null && expected < 0 && (momentum ?? 50) < 50);

  if (broken) action = "EXIT REVIEW";
  else if (profitFading) action = "TRIM PROFIT REVIEW";
  else if (winner) action = "LET WINNER RUN";
  else if (committee === "APPROVE" && expected != null && expected >= 15 && (momentum ?? 0) >= 65) action = "ADD";
  else if ((expected != null && expected < 3) || (momentum != null && momentum < 48)) action = "TRIM REVIEW";

  const weight = action === "ADD" ? targetWeight(score, macro) : 0;
  const marketValue = price != null ? price * position.shares : position.avgCost * position.shares;
  const rawThesis = a?.thesis?.find?.((x: any) => x.label === "Base")?.narrative ?? "Current holding under active review.";
  return {
    ticker: position.ticker, source: ["Current portfolio / Thomas"], held: true, action,
    conviction: Math.round(conviction), confidence: String(c.confidence ?? "LOW"), expectedReturnPct: expected,
    targetPrice: valuation.targetPrice, currentPrice: price, momentum, pnlPct: pnlPct == null ? null : round1(pnlPct),
    portfolioScore: score, targetWeightPct: weight, capitalUsd: action === "ADD" ? round0(nav * Math.min(weight, 4) / 100) : round0(marketValue),
    committee, thesis: stripSyntheticSpotTarget(rawThesis, valuation.status),
    dissent: Array.isArray(c.dissent) ? c.dissent : [], reasons: [
      ...(Array.isArray(c.reasons) ? c.reasons : []),
      `Portfolio score ${score}/100; P/L ${pnlPct == null ? "unavailable" : `${round1(pnlPct)}%`}; momentum ${momentum ?? "unavailable"}; expected return ${expected ?? "unavailable"}%.`,
      valuation.status === "UNAVAILABLE" ? "Valuation unavailable; no trim/add decision is triggered by a synthetic 0% spot comparison." : valuation.note,
      action === "LET WINNER RUN" ? "Profit alone is not a sell signal: momentum and expected return remain constructive." : "Position is ranked against both current holdings and fresh external opportunities.",
    ],
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuationNote: valuation.note,
    positionShares: position.shares,
    marketValueUsd: round2(marketValue),
  };
}

function formatFunding(legs: FundingLeg[]) {
  return legs.length ? legs.map(x => `${x.source} $${round0(x.amountUsd)}`).join(" + ") : "No funding assigned";
}

export async function runActiveFundV2(input: {
  positions: ExistingPositionInput[];
  watchlistTickers: string[];
  cash: CashContextInput;
}): Promise<ActiveFundV2Result> {
  const warnings: string[] = [];
  const nav = input.cash.totalNav;
  const held = new Set(input.positions.map(x => cleanTicker(x.ticker)));
  const riskPositions = input.positions.filter(x => !LIQUIDITY_TICKERS.has(cleanTicker(x.ticker)));
  const excluded = new Set([...held, ...LIQUIDITY_TICKERS]);

  const [macro, phase1, existingAnalyses] = await Promise.all([
    buildMacroOutlook().catch((e: any) => {
      warnings.push(`Macro outlook: ${e?.message ?? "failed"}`);
      return { asOf:new Date().toISOString(), score:50, regime:"Neutral / Selective", regimeTh:"เป็นกลาง / คัดเลือก", vision:"Macro data unavailable; use neutral sizing.", visionTh:"ข้อมูล Macro ไม่พร้อม ระบบใช้ขนาดการลงทุนแบบเป็นกลาง", riskBudgetPct:65, cashFloorPct:input.cash.cashFloorPct, indicators:{}, scenarios:[], headlines:[], allocationTilt:[], allocationTiltTh:[], warnings:[e?.message ?? "failed"] } as MacroOutlook;
    }),
    runInvestmentResearchOS({ exclude: excluded, topN: 12, universeLimit: 40 }).catch((e: any) => {
      warnings.push(`Research OS: ${e?.message ?? "failed"}`);
      return { proposals: [], universeSize: 0, detailedUniverseSize: 0, analyzed: 0, qualified: 0, rejected: 0, warnings: [], models: [], methodology: "Research OS unavailable" };
    }),
    mapLimit(riskPositions.slice(0, 20), 5, async position => ({ position, analysis: await analyzeSafe(position.ticker) })),
  ]);

  warnings.push(...(phase1.warnings ?? []), ...(macro.warnings ?? []));
  const existing = existingAnalyses
    .filter(row => row.analysis)
    .map(row => fromExistingAnalysis(row.analysis, row.position, nav, macro))
    .sort((a, b) => b.portfolioScore - a.portfolioScore);

  const phaseIdeas = phase1.proposals.map(proposal => fromProposal(proposal, nav, macro));
  const phaseTickers = new Set(phaseIdeas.map(x => x.ticker));
  const watchExtras = input.watchlistTickers
    .map(cleanTicker)
    .filter(ticker => !held.has(ticker) && !phaseTickers.has(ticker) && !LIQUIDITY_TICKERS.has(ticker))
    .slice(0, 6);
  const watchAnalyses = await mapLimit(watchExtras, 4, async ticker => analyzeSafe(ticker));
  const watchIdeas = watchAnalyses.filter(Boolean).map(a => fromWatchlistAnalysis(a, nav, macro));
  const newIdeas = [...phaseIdeas, ...watchIdeas]
    .filter((idea, index, all) => all.findIndex(x => x.ticker === idea.ticker) === index)
    .sort((a, b) => b.portfolioScore - a.portfolioScore)
    .slice(0, 15);

  const portfolioWinners = existing.filter(x => x.action === "LET WINNER RUN" || x.action === "ADD").slice(0, 6);
  const weakLinks = existing
    .filter(x => ["TRIM PROFIT REVIEW", "TRIM REVIEW", "EXIT REVIEW"].includes(x.action))
    .concat(existing.slice().sort((a, b) => a.portfolioScore - b.portfolioScore).slice(0, 3))
    .filter((idea, index, all) => all.findIndex(x => x.ticker === idea.ticker) === index)
    .slice(0, 6);

  const currentUsd = Math.max(0, input.cash.liquidityBuffer);
  const targetUsd = Math.max(0, input.cash.targetValue);
  const deployableUsd = Math.max(0, currentUsd - targetUsd);
  const reserveGapUsd = Math.max(0, targetUsd - currentUsd);
  const tolerance = Math.max(nav * .005, 25);
  const liquidityStatus = deployableUsd > tolerance ? "EXCESS" : reserveGapUsd > tolerance ? "BELOW TARGET" : "ON TARGET";
  const reservePositions = (input.cash.reserveHoldings ?? []).map(x => ({ ticker: cleanTicker(x.ticker), marketValue: round0(x.marketValue) }));
  const cashBalance = Math.max(0, input.cash.cashBalance ?? 0);
  const dividendAvailable = Math.max(0, input.cash.dividendAvailable ?? 0);
  const fundingOrder = [cashBalance > 0 ? "USD" : null, dividendAvailable > 0 ? "DIVIDEND" : null, ...reservePositions.map(x => x.ticker)].filter(Boolean) as string[];

  let availableLiquidity = deployableUsd;
  const sourcePool = [
    { source: "USD", kind: "USD" as const, available: cashBalance },
    { source: "DIVIDEND", kind: "DIVIDEND" as const, available: dividendAvailable },
    ...reservePositions.map(x => ({ source: x.ticker, kind: "RESERVE" as const, available: Math.max(0, x.marketValue) })),
  ];
  const consumeLiquidity = (requested: number) => {
    let remaining = Math.min(Math.max(0, requested), Math.max(0, availableLiquidity));
    const legs: FundingLeg[] = [];
    for (const src of sourcePool) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, src.available);
      if (amount <= 0) continue;
      src.available -= amount;
      remaining -= amount;
      legs.push({ source: src.source, kind: src.kind, amountUsd: round2(amount) });
    }
    const funded = legs.reduce((s, x) => s + x.amountUsd, 0);
    availableLiquidity = Math.max(0, availableLiquidity - funded);
    return { funded: round2(funded), legs };
  };

  const approvedNew = newIdeas.filter(x => x.action === "INITIATE");
  const liquidityAllocations = new Map<string, { amount: number; legs: FundingLeg[] }>();
  for (const idea of approvedNew) {
    const result = consumeLiquidity(idea.capitalUsd);
    if (result.funded > 0) liquidityAllocations.set(idea.ticker, { amount: result.funded, legs: result.legs });
  }

  const addLiquidityAllocations = new Map<string, { amount: number; legs: FundingLeg[] }>();
  for (const idea of existing.filter(x => x.action === "ADD")) {
    const result = consumeLiquidity(idea.capitalUsd);
    if (result.funded > 0) addLiquidityAllocations.set(idea.ticker, { amount: result.funded, legs: result.legs });
  }

  const weakest = [...existing].sort((a, b) => a.portfolioScore - b.portfolioScore);
  const replacements: ActiveFundV2Result["replacements"] = [];
  for (const candidate of approvedNew) {
    const funded = liquidityAllocations.get(candidate.ticker)?.amount ?? 0;
    const unfunded = Math.max(0, candidate.capitalUsd - funded);
    if (unfunded <= 0) continue;
    const old = weakest.find(x => {
      if (replacements.some(r => r.from === x.ticker)) return false;
      if (x.action === "LET WINNER RUN" || x.action === "ADD") return false;
      const scoreEdge = candidate.portfolioScore - x.portfolioScore;
      const returnEdge = candidate.expectedReturnPct != null && x.expectedReturnPct != null ? candidate.expectedReturnPct - x.expectedReturnPct : null;
      return scoreEdge >= 12 && (returnEdge == null || returnEdge >= 5);
    });
    if (!old) continue;
    const scoreEdge = round1(candidate.portfolioScore - old.portfolioScore);
    const returnEdge = candidate.expectedReturnPct != null && old.expectedReturnPct != null ? round1(candidate.expectedReturnPct - old.expectedReturnPct) : null;
    const oldValue = Math.max(0, old.marketValueUsd ?? old.capitalUsd);
    const rotateUsd = round0(Math.min(unfunded, nav * .05, oldValue * .5));
    if (rotateUsd <= 0) continue;
    replacements.push({
      from: old.ticker, to: candidate.ticker, rotatePct: nav > 0 ? round1(rotateUsd / nav * 100) : 0, rotateUsd,
      scoreEdge, expectedReturnEdge: returnEdge,
      reason: `${candidate.ticker} leads ${old.ticker} by ${scoreEdge} portfolio-score points${returnEdge == null ? "" : ` and ${returnEdge}% expected-return points`}. Use liquidity excess first; rotate only the remaining funded amount. Profit alone never triggers the sale.`,
    });
  }

  const opportunityDecisions: OpportunityDecision[] = newIdeas.map(candidate => {
    const allocation = liquidityAllocations.get(candidate.ticker);
    const funded = allocation?.amount ?? 0;
    const replacement = replacements.find(r => r.to === candidate.ticker);
    const compare = replacement ? existing.find(x => x.ticker === replacement.from) ?? null : weakest[0] ?? null;
    const edge = compare ? round1(candidate.portfolioScore - compare.portfolioScore) : null;
    if (candidate.action === "INITIATE" && funded > 0 && !replacement) return {
      ticker: candidate.ticker, decision: "INITIATE FROM LIQUIDITY", fundingSource: formatFunding(allocation?.legs ?? []), fundingLegs: allocation?.legs ?? [],
      comparedWith: compare?.ticker ?? null, relativeEdge: edge, proposedWeightPct: candidate.targetWeightPct, proposedCapitalUsd: funded,
      reason: `Qualified new idea funded only from liquidity above the ${input.cash.cashFloorPct}% constitutional floor.`,
      reasonTh: `หุ้นใหม่ผ่านเกณฑ์และใช้เฉพาะสภาพคล่องส่วนที่เกิน Cash Floor ${input.cash.cashFloorPct}% ตามกฎกองทุน`,
      trigger: "Recheck live price, valuation and risk before human execution.", triggerTh: "ตรวจราคาล่าสุด Valuation และความเสี่ยงอีกครั้งก่อนมนุษย์ดำเนินการ",
    };
    if (replacement) {
      const rotationLeg: FundingLeg = { source: replacement.from, kind: "ROTATION", amountUsd: replacement.rotateUsd };
      const legs = [...(allocation?.legs ?? []), rotationLeg];
      return {
        ticker: candidate.ticker, decision: "ROTATE / REPLACE", fundingSource: formatFunding(legs), fundingLegs: legs,
        comparedWith: replacement.from, relativeEdge: edge, proposedWeightPct: candidate.targetWeightPct, proposedCapitalUsd: funded + replacement.rotateUsd,
        reason: replacement.reason, reasonTh: `ใช้ Liquidity ส่วนเกินก่อน แล้ว TRIM ${replacement.from} เฉพาะ $${replacement.rotateUsd} เพื่อสับเปลี่ยนไป ${candidate.ticker} เมื่อ Alpha/Expected Return เหนือกว่าชัดเจน`,
        trigger: "Committee cooldown, income impact, concentration and execution price must still pass.", triggerTh: "ยังต้องผ่านกฎ cooldown ผลกระทบต่อปันผล การกระจุกตัว และราคาดำเนินการ",
      };
    }
    if (candidate.action === "INITIATE") return {
      ticker: candidate.ticker, decision: "WATCH WITH TRIGGER", fundingSource: "No deployable capital yet", fundingLegs: [], comparedWith: compare?.ticker ?? null,
      relativeEdge: edge, proposedWeightPct: candidate.targetWeightPct, proposedCapitalUsd: 0,
      reason: "The idea qualifies, but current liquidity above the cash floor is insufficient and no rotation clears the minimum edge.",
      reasonTh: "หุ้นผ่านเกณฑ์ แต่เงินส่วนเกินเหนือ Cash Floor ยังไม่พอ และยังไม่มี Rotation ที่มีความได้เปรียบมากพอ",
      trigger: "Re-open when liquidity increases or a weak-link rotation clears the edge threshold.", triggerTh: "พิจารณาใหม่เมื่อ Liquidity เพิ่มขึ้นหรือมี Weak Link ที่สามารถสับเปลี่ยนได้ตามเกณฑ์",
    };
    return {
      ticker: candidate.ticker, decision: "REJECT", fundingSource: "None", fundingLegs: [], comparedWith: compare?.ticker ?? null, relativeEdge: edge,
      proposedWeightPct: 0, proposedCapitalUsd: 0, reason: "Research candidate does not yet clear the active-fund initiation hurdle.",
      reasonTh: "ยังไม่ผ่านเกณฑ์เปิดสถานะของ Active Fund", trigger: "Improve score, expected return, valuation or factor consensus.", triggerTh: "รอคะแนน Expected Return Valuation หรือ Factor Consensus ดีขึ้น",
    };
  });

  const executionPlans: ExecutionPlan[] = [];
  for (const idea of existing) {
    const price = idea.currentPrice;
    const marketValue = Math.max(0, idea.marketValueUsd ?? 0);
    const shares = Math.max(0, idea.positionShares ?? 0);
    const replacement = replacements.find(r => r.from === idea.ticker);
    if (idea.action === "EXIT REVIEW") {
      executionPlans.push({ ticker: idea.ticker, action: "EXIT", instruction: "EXIT 100%", instructionTh: "ขายออกทั้งหมด 100%", amountUsd: round2(marketValue), sharesApprox: shares || null, trimPct: 100, fundingLegs: [], destinationTicker: null, proceedsDestination: "Cash Buffer", note: "Thesis/committee evidence is broken enough for a full-exit review; human approval remains required.", noteTh: "Thesis/มติคณะกรรมการอ่อนแอถึงระดับทบทวนออกทั้งหมด โดยยังต้องให้มนุษย์อนุมัติ" });
      continue;
    }
    if (idea.action === "TRIM PROFIT REVIEW" || idea.action === "TRIM REVIEW") {
      const trimPct = idea.action === "TRIM PROFIT REVIEW" ? 25 : 20;
      const amount = marketValue * trimPct / 100;
      executionPlans.push({ ticker: idea.ticker, action: "TRIM", instruction: `TRIM ${trimPct}%`, instructionTh: `ลดน้ำหนัก ${trimPct}%`, amountUsd: round2(amount), sharesApprox: shares > 0 ? round2(shares * trimPct / 100) : price && price > 0 ? round2(amount / price) : null, trimPct, fundingLegs: [], destinationTicker: replacement?.to ?? null, proceedsDestination: replacement ? replacement.to : "Cash Buffer", note: replacement ? `Only the approved rotation amount is redirected to ${replacement.to}; remaining proceeds stay in the Cash Buffer.` : "No replacement is approved; proceeds stay in the Cash Buffer.", noteTh: replacement ? `ย้ายเฉพาะวงเงิน Rotation ที่อนุมัติไป ${replacement.to}; เงินส่วนที่เหลือพักใน Cash Buffer` : "ยังไม่มีหุ้นทดแทนที่อนุมัติ เงินที่ได้พักใน Cash Buffer" });
      continue;
    }
    if (idea.action === "ADD") {
      const allocation = addLiquidityAllocations.get(idea.ticker);
      const funded = allocation?.amount ?? 0;
      executionPlans.push({ ticker: idea.ticker, action: funded > 0 ? "ADD" : "WAIT", instruction: funded > 0 ? `ADD $${round0(funded)}` : "HOLD / WAIT", instructionTh: funded > 0 ? `เพิ่มน้ำหนัก $${round0(funded)}` : "ถือต่อ / รอเงินทุน", amountUsd: round2(funded), sharesApprox: price && price > 0 && funded > 0 ? round2(funded / price) : null, trimPct: null, fundingLegs: allocation?.legs ?? [], destinationTicker: idea.ticker, proceedsDestination: null, note: funded >= idea.capitalUsd ? "Requested ADD is fully funded from liquidity above the Cash Floor." : funded > 0 ? `Partial ADD only: $${round0(funded)} is funded versus $${round0(idea.capitalUsd)} requested.` : `ADD thesis is constructive, but no liquidity above the Cash Floor remains after higher-priority allocations.`, noteTh: funded >= idea.capitalUsd ? "วงเงิน ADD มีแหล่งเงินครบจาก Liquidity ส่วนที่เกิน Cash Floor" : funded > 0 ? `ADD ได้บางส่วน $${round0(funded)} จากวงเงินที่ต้องการ $${round0(idea.capitalUsd)}` : "Thesis ยังดี แต่ไม่มี Liquidity ส่วนเกิน Cash Floor เหลือสำหรับ ADD รอบนี้" });
      continue;
    }
    executionPlans.push({ ticker: idea.ticker, action: "HOLD", instruction: idea.action === "LET WINNER RUN" ? "HOLD / LET WINNER RUN" : "HOLD", instructionTh: idea.action === "LET WINNER RUN" ? "ถือต่อ / ปล่อยกำไรวิ่ง" : "ถือต่อ", amountUsd: 0, sharesApprox: null, trimPct: null, fundingLegs: [], destinationTicker: null, proceedsDestination: null, note: idea.action === "LET WINNER RUN" ? "No trim: momentum and expected return remain constructive." : "No portfolio transaction is recommended this cycle.", noteTh: idea.action === "LET WINNER RUN" ? "ยังไม่ลดน้ำหนัก เพราะ Momentum และผลตอบแทนคาดหวังยังสนับสนุน" : "รอบนี้ไม่มีรายการซื้อขายสำหรับหุ้นตัวนี้" });
  }

  for (const decision of opportunityDecisions) {
    const idea = newIdeas.find(x => x.ticker === decision.ticker);
    const price = idea?.currentPrice ?? null;
    if (decision.decision === "INITIATE FROM LIQUIDITY" || decision.decision === "ROTATE / REPLACE") {
      executionPlans.push({ ticker: decision.ticker, action: "INITIATE", instruction: `INITIATE $${round0(decision.proposedCapitalUsd)}`, instructionTh: `เปิดสถานะใหม่ $${round0(decision.proposedCapitalUsd)}`, amountUsd: round2(decision.proposedCapitalUsd), sharesApprox: price && price > 0 ? round2(decision.proposedCapitalUsd / price) : null, trimPct: null, fundingLegs: decision.fundingLegs, destinationTicker: decision.ticker, proceedsDestination: null, note: decision.reason, noteTh: decision.reasonTh });
    } else {
      executionPlans.push({ ticker: decision.ticker, action: "WAIT", instruction: "NO TRADE NOW", instructionTh: "ยังไม่ลงทุนรอบนี้", amountUsd: 0, sharesApprox: null, trimPct: null, fundingLegs: [], destinationTicker: null, proceedsDestination: null, note: decision.trigger, noteTh: decision.triggerTh });
    }
  }

  const fundedNewFromLiquidityUsd = [...liquidityAllocations.values()].reduce((s, x) => s + x.amount, 0);
  const fundedAddsFromLiquidityUsd = [...addLiquidityAllocations.values()].reduce((s, x) => s + x.amount, 0);
  const fundedFromLiquidityUsd = fundedNewFromLiquidityUsd + fundedAddsFromLiquidityUsd;
  const fundedFromRotationsUsd = replacements.reduce((s, x) => s + x.rotateUsd, 0);
  const requestedDeployUsd = approvedNew.reduce((s, x) => s + x.capitalUsd, 0) + existing.filter(x => x.action === "ADD").reduce((s, x) => s + x.capitalUsd, 0);
  const deployUsd = fundedFromLiquidityUsd + fundedFromRotationsUsd;
  const liquidityAfterUsd = Math.max(targetUsd, currentUsd - fundedFromLiquidityUsd);

  return {
    version: "active-fund-v2.1",
    asOf: new Date().toISOString(), nav, macro,
    liquidity: {
      currentUsd: round0(currentUsd), currentPct: input.cash.bufferPct == null ? round1(nav > 0 ? currentUsd / nav * 100 : 0) : round1(input.cash.bufferPct),
      targetUsd: round0(targetUsd), targetPct: input.cash.cashFloorPct, deployableUsd: round0(deployableUsd), reserveGapUsd: round0(reserveGapUsd),
      cashBalance: round2(cashBalance), dividendAvailable: round2(dividendAvailable), status: liquidityStatus, positions: reservePositions, fundingOrder,
    },
    discovery: {
      broadUniverse: phase1.universeSize, detailedAnalyzed: phase1.analyzed, qualified: phase1.qualified ?? phase1.proposals.length,
      watchlist: input.watchlistTickers.length, uniqueNew: newIdeas.length, models: phase1.models.length, methodology: phase1.methodology,
    },
    newIdeas, existing, portfolioWinners, weakLinks, opportunityDecisions, executionPlans, replacements,
    capitalPlan: {
      requestedDeployUsd: round0(requestedDeployUsd), deployUsd: round0(deployUsd), fundedFromLiquidityUsd: round0(fundedFromLiquidityUsd),
      fundedFromRotationsUsd: round0(fundedFromRotationsUsd), raiseUsd: round0(Math.max(0, requestedDeployUsd - deployUsd)),
      liquidityAfterUsd: round0(liquidityAfterUsd), liquidityAfterPct: nav > 0 ? round1(liquidityAfterUsd / nav * 100) : 0,
      initiates: approvedNew.length, adds: existing.filter(x => x.action === "ADD").length,
      holds: existing.filter(x => x.action === "HOLD" || x.action === "LET WINNER RUN").length,
      reviews: existing.filter(x => ["TRIM PROFIT REVIEW", "TRIM REVIEW", "EXIT REVIEW"].includes(x.action)).length,
    },
    process: [
      `Broad US opportunity pool → ${phase1.universeSize} names; ${phase1.analyzed} receive a rotating deep-dive each cycle across ${phase1.models.length} factor lenses.`,
      "Thomas valuation is reused for current holdings/watchlist deep dives; Active Fund does not invent a second fundamental valuation. Synthetic spot-price fallback targets are marked UNAVAILABLE, never fair value.",
      "Rank every current risk holding again instead of waiting for a thesis failure.",
      "Winner management: a profitable holding with strong momentum and expected return is allowed to run; profit alone is never a sell signal.",
      "Weak-link review: fading momentum, poor expected return or a rejected thesis creates a quantified TRIM/EXIT instruction.",
      "Capital rotation: compare the best new idea with the weakest eligible holding; rotate only when portfolio-score edge ≥12 and expected-return edge is normally ≥5 points.",
      `Protect the constitutional Cash Floor at ${input.cash.cashFloorPct}%; funding is quantified by USD, dividend cash and reserve instrument before any approved stock rotation.`,
      "All outputs are decision support. Existing committee cooldown, income, concentration, risk and human-approval gates still control execution.",
    ],
    warnings,
  };
}
