import { buildAnalysis } from "./analyze";
import { buildMacroOutlook, type MacroOutlook } from "./macroOutlook";
import { runInvestmentResearchOS, type InvestmentResearchProposal, type InvestmentResearchQueueItem } from "./research/investmentDiscovery";
import { classifyMomentumLifecycle, type MomentumLifecycleStage } from "./research/momentumLifecycle";
import { FUND_HOLDING_POLICY, researchMandate } from "./research/researchMandates";
import { governThomasSnapshot, resolveThomasValuationForMarketData, type ThomasValuationSnapshot } from "./thomasValuation";

export type FundAction = "INITIATE" | "ADD" | "LET WINNER RUN" | "HOLD" | "TRIM PROFIT REVIEW" | "TRIM REVIEW" | "EXIT REVIEW" | "WATCH" | "RESEARCH INCOMPLETE";
export type OpportunityDecisionType = "INITIATE FROM LIQUIDITY" | "ROTATE / REPLACE" | "WATCH WITH TRIGGER" | "RESEARCH INCOMPLETE" | "REJECT";
export type ValuationStatus = "VALID" | "NO_EDGE" | "LOW_CONFIDENCE" | "INVALID" | "UNAVAILABLE";
export type ValuationSource = "THOMAS_DCF_MULTI_ANCHOR" | "THOMAS_MULTI_ANCHOR" | "THOMAS_FUNDAMENTAL_RANGE" | "THOMAS_ETF_PRICE_HISTORY_PROXY" | "THOMAS_CASH_EQUIVALENT" | "YAHOO_ANALYST_CONSENSUS" | "UNAVAILABLE" | string;
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
  primaryEngine: string;
  discoveryEngines: string[];
  lifecycleStage: MomentumLifecycleStage;
  lifecycleScore: number;
  lifecycleEvidence: string[];
  searchBasis: string;
  searchBasisTh: string;
  investmentHorizon: string;
  investmentHorizonTh: string;
  reviewCadence: string;
  reviewCadenceTh: string;
  researchStatus: "COMPLETE" | "INCOMPLETE";
  valuationGapPct: number | null;
  valuationStatus: ValuationStatus;
  valuationSource: ValuationSource;
  valuationNote: string;
  valuationDecisionReady: boolean;
  valuationConfidence: string;
  valuationBear: number | null;
  valuationBull: number | null;
  valuationAnchors: Array<{ method: string; fairValue: number; weight: number; detail: string }>;
  valuationAsOf: string | null;
  valuationExpiresAt: string | null;
  valuationModelRoute: string | null;
  valuationWarnings: string[];
  positionShares: number | null;
  marketValueUsd: number | null;
  ideaCategory?: "FRESH_MARKET_DISCOVERY" | "WATCHLIST_REUNDERWRITE" | "PORTFOLIO_MONITOR";
  rotationCadence?: string;
  universeSource?: string;
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
    uniqueNew: number; incomplete: number; models: number; methodology: string;
    universeSource?: string;
    rotationWindows?: Array<{ cadence: string; label: string; purpose: string; masterUniverse: number; scheduledThisCycle: number; lastRotationAt: string; nextRotationAt: string }>;
    engines: { id: string; name: string; role: string; searches: string; qualified: number; searchBasis?: string; searchBasisTh?: string; investmentHorizon?: string; investmentHorizonTh?: string }[];
    holdingPolicy: typeof FUND_HOLDING_POLICY;
  };
  newIdeas: ActiveFundIdea[];
  watchlistReviews: ActiveFundIdea[];
  researchIncomplete: ActiveFundIdea[];
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
  return round1(f.momentum * .30 + proposal.lifecycleScore * .20 + f.institutional * .15 + expected * .15 + qualityGrowth * .10 + f.value * .05 + Math.min(100, proposal.sourceModels.length * 16) * .05);
}

function targetWeight(score: number, macro: MacroOutlook) {
  const base = clamp(2 + (score - 60) * .10, 2, 8);
  return round1(base * clamp(macro.riskBudgetPct, 20, 100) / 100);
}

function valuationFromSnapshot(snapshot: ThomasValuationSnapshot | null | undefined, price: number | null) {
  const read = governThomasSnapshot(snapshot, price);
  return {
    status: read.status as ValuationStatus,
    source: String(snapshot?.source ?? "UNAVAILABLE") as ValuationSource,
    targetPrice: read.valid ? read.fairValue : null,
    expectedReturnPct: read.valid ? read.valuationGapPct : null,
    note: read.reason,
    decisionReady: read.decisionReady,
    confidence: snapshot?.confidence ?? "LOW",
    bear: read.valid ? read.bearValue : null,
    bull: read.valid ? read.bullValue : null,
    anchors: read.valid ? snapshot?.anchors ?? [] : [],
    asOf: snapshot?.asOf ?? null,
    expiresAt: snapshot?.expiresAt ?? null,
    modelRoute: snapshot?.modelRoute ?? null,
    warnings: [...(snapshot?.warnings ?? []), ...(!read.valid ? [read.reason] : [])],
  };
}

function valuationEvidence(input: {
  decisionReady?: boolean; confidence?: string; bear?: number | null; bull?: number | null;
  anchors?: Array<{ method: string; fairValue: number; weight: number; detail: string }>;
  asOf?: string | null; expiresAt?: string | null; modelRoute?: string | null; warnings?: string[];
}) {
  return {
    valuationDecisionReady: Boolean(input.decisionReady),
    valuationConfidence: input.confidence ?? "LOW",
    valuationBear: input.bear ?? null,
    valuationBull: input.bull ?? null,
    valuationAnchors: input.anchors ?? [],
    valuationAsOf: input.asOf ?? null,
    valuationExpiresAt: input.expiresAt ?? null,
    valuationModelRoute: input.modelRoute ?? null,
    valuationWarnings: input.warnings ?? [],
  };
}

function stripSyntheticSpotTarget(thesis: string, status: ValuationStatus) {
  if (status !== "UNAVAILABLE" && status !== "INVALID") return thesis;
  const cleaned = String(thesis ?? "")
    .replace(/\s*Target\s*~?\$[\d,.]+\s*\([+-]?\d+(?:\.\d+)?%\s+vs\s+spot\)\.?/gi, "")
    .trim();
  return `${cleaned || "Operating thesis remains under review."} Valuation target is currently unavailable and is not inferred from spot.`;
}

function lifecycleFromAnalysis(a: any, valuationGapPct: number | null) {
  const technicals = a?.technicals ?? {};
  const momentum = finite(a?.momentum?.total);
  const volumeScore = finite(a?.momentum?.volume) ?? 0;
  const structureScore = finite(a?.momentum?.structure) ?? 0;
  const rs = finite(technicals?.rs30);
  const institutional = clamp(volumeScore / 25 * 55 + structureScore / 20 * 25 + (rs != null && rs >= 1 ? 20 : 0));
  return classifyMomentumLifecycle({
    momentum,
    institutional,
    rs30: rs,
    volumeRatio: finite(technicals?.volRatio),
    upDownVolume: finite(technicals?.upDownVolRatio),
    return1m: finite(technicals?.return1m),
    return3m: finite(technicals?.return3m),
    aboveEma20: typeof technicals?.aboveEma20 === "boolean" ? technicals.aboveEma20 : null,
    maFanning: typeof technicals?.maFanning === "boolean" ? technicals.maFanning : null,
    valuationGapPct,
  });
}

function fromProposal(proposal: InvestmentResearchProposal, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const score = scoreProposal(proposal);
  const weight = targetWeight(score, macro);
  const decisionReady = proposal.valuationConfidence !== "LOW" && proposal.valuationAnchors.length > 0;
  const approved = decisionReady && score >= 64 && proposal.expectedReturnPct >= 8 && proposal.sourceModels.length >= 2
    && ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(proposal.lifecycleStage);
  const gap = proposal.price > 0 ? (proposal.target / proposal.price - 1) * 100 : 0;
  return {
    ticker: proposal.ticker,
    source: ["Active Momentum Research V23", ...proposal.discoveryEngines],
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
    primaryEngine: proposal.primaryEngine,
    discoveryEngines: proposal.discoveryEngines,
    lifecycleStage: proposal.lifecycleStage,
    lifecycleScore: proposal.lifecycleScore,
    lifecycleEvidence: proposal.lifecycleEvidence,
    searchBasis: proposal.searchBasis,
    searchBasisTh: proposal.searchBasisTh,
    investmentHorizon: proposal.investmentHorizon,
    investmentHorizonTh: proposal.investmentHorizonTh,
    reviewCadence: proposal.reviewCadence,
    reviewCadenceTh: proposal.reviewCadenceTh,
    researchStatus: "COMPLETE",
    valuationGapPct: round1(gap),
    valuationStatus: Math.abs(gap) < .5 ? "NO_EDGE" : "VALID",
    valuationSource: proposal.valuationSource,
    valuationNote: `Thomas governed ${proposal.valuationModelRoute ?? "instrument"} valuation used by Research OS.`,
    ...valuationEvidence({ decisionReady, confidence: proposal.valuationConfidence, bear: proposal.valuationBear, bull: proposal.valuationBull, anchors: proposal.valuationAnchors, asOf: proposal.valuationAsOf, expiresAt: proposal.valuationExpiresAt, modelRoute: proposal.valuationModelRoute }),
    positionShares: null,
    marketValueUsd: null,
    ideaCategory: "FRESH_MARKET_DISCOVERY",
    rotationCadence: proposal.rotationCadence,
    universeSource: proposal.universeSource,
  };
}

function fromResearchQueue(item: InvestmentResearchQueueItem): ActiveFundIdea {
  const hasValuation = item.target != null && item.valuationAnchors.length > 0;
  const decisionReady = item.researchStatus === "COMPLETE" && item.valuationConfidence !== "LOW" && hasValuation;
  const complete = decisionReady;
  const gap = hasValuation ? item.valuationGapPct : null;
  return {
    ticker: item.ticker,
    source: ["Active Momentum Research Queue", ...item.sourceModels.map(model => model.toUpperCase())],
    held: false,
    action: complete ? "WATCH" : "RESEARCH INCOMPLETE",
    conviction: Math.round(clamp(item.score)),
    confidence: item.sourceModels.length >= 4 ? "HIGH" : item.sourceModels.length >= 2 ? "MEDIUM" : "LOW",
    expectedReturnPct: gap,
    targetPrice: item.target,
    currentPrice: item.price,
    momentum: item.factors.momentum,
    pnlPct: null,
    portfolioScore: round1(clamp(item.score)),
    targetWeightPct: 0,
    capitalUsd: 0,
    committee: "RESEARCH QUEUE",
    thesis: item.thesis,
    dissent: [...item.failedGates, ...item.valuationFailures],
    reasons: [
      `${item.researchEngineLabel} surfaced the name in the ${item.rotationCadence} rotation.`,
      complete
        ? "Fair Value exists, but at least one lifecycle, momentum or engine gate is not yet strong enough for initiation."
        : "Fair Value is incomplete; the name remains visible in research but is excluded from allocation.",
    ],
    factors: item.factors,
    primaryEngine: item.researchEngineLabel,
    discoveryEngines: item.sourceModels.map(model => model.toUpperCase()),
    lifecycleStage: item.lifecycleStage,
    lifecycleScore: item.lifecycleScore,
    lifecycleEvidence: item.lifecycleEvidence,
    searchBasis: item.searchBasis,
    searchBasisTh: item.searchBasisTh,
    investmentHorizon: item.investmentHorizon,
    investmentHorizonTh: item.investmentHorizonTh,
    reviewCadence: item.reviewCadence,
    reviewCadenceTh: item.reviewCadenceTh,
    researchStatus: complete ? "COMPLETE" : "INCOMPLETE",
    valuationGapPct: gap == null ? null : round1(gap),
    valuationStatus: complete ? Math.abs(gap ?? 0) < .5 ? "NO_EDGE" : "VALID" : hasValuation ? "LOW_CONFIDENCE" : "UNAVAILABLE",
    valuationSource: hasValuation ? item.valuationSource : "UNAVAILABLE",
    valuationNote: complete
      ? "Research Queue valuation is available; the candidate remains WATCH until every entry gate clears."
      : hasValuation ? "Display-only Fair Value: confidence or evidence is insufficient for a capital decision." : "No defensible Fair Value yet; spot is never used to manufacture a target.",
    ...valuationEvidence({ decisionReady: complete, confidence: item.valuationConfidence, bear: item.valuationBear, bull: item.valuationBull, anchors: item.valuationAnchors, asOf: item.valuationAsOf, expiresAt: item.valuationExpiresAt, modelRoute: item.valuationModelRoute, warnings: item.valuationFailures }),
    positionShares: null,
    marketValueUsd: null,
    ideaCategory: "FRESH_MARKET_DISCOVERY",
    rotationCadence: item.rotationCadence,
    universeSource: item.universeSource,
  };
}

function fromWatchlistAnalysis(a: any, snapshot: ThomasValuationSnapshot | null, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a?.committee ?? {};
  const conviction = finite(c.conviction) ?? 0;
  const momentum = finite(a?.momentum?.total);
  const price = finite(a?.data?.quote?.price);
  const valuation = valuationFromSnapshot(snapshot, price);
  const lifecycle = lifecycleFromAnalysis(a, valuation.expectedReturnPct);
  const expected = valuation.expectedReturnPct;
  const committee = String(c.decision ?? "WATCH").toUpperCase();
  const score = scoreExisting(conviction, momentum, expected, committee);
  const complete = valuation.status !== "UNAVAILABLE" && valuation.status !== "INVALID";
  const approved = valuation.decisionReady && committee === "APPROVE" && expected != null && expected >= 8 && score >= 64 && complete && lifecycle.entryEligible;
  const weight = approved ? targetWeight(score, macro) : 0;
  const rawThesis = a?.thesis?.find?.((x: any) => x.label === "Base")?.narrative ?? "Watchlist candidate awaiting a stronger edge.";
  const mandate = researchMandate("WATCHLIST_REUNDERWRITE");
  return {
    ticker: cleanTicker(a?.ticker ?? ""), source: ["Watchlist / Thomas Research"], held: false,
    action: !complete ? "RESEARCH INCOMPLETE" : approved ? "INITIATE" : "WATCH", conviction: Math.round(conviction), confidence: String(c.confidence ?? "LOW"),
    expectedReturnPct: expected, targetPrice: valuation.targetPrice, currentPrice: price, momentum,
    pnlPct: null, portfolioScore: score, targetWeightPct: weight, capitalUsd: round0(nav * weight / 100), committee,
    thesis: stripSyntheticSpotTarget(rawThesis, valuation.status),
    dissent: Array.isArray(c.dissent) ? c.dissent : [], reasons: [
      ...(Array.isArray(c.reasons) ? c.reasons : []),
      valuation.status === "UNAVAILABLE" ? "Valuation is unavailable; spot-price fallback is not accepted as fair value." : valuation.note,
    ],
    valuationStatus: valuation.status,
    valuationSource: valuation.source,
    valuationNote: valuation.note,
    ...valuationEvidence(valuation),
    primaryEngine: lifecycle.stage.includes("ACCUMULATION") ? "Accumulation & Flow" : "Momentum Leadership",
    discoveryEngines: ["Watchlist Deep Dive", "Momentum Lifecycle", "Thomas Valuation"],
    lifecycleStage: lifecycle.stage,
    lifecycleScore: lifecycle.score,
    lifecycleEvidence: lifecycle.evidence,
    ...mandate,
    researchStatus: complete && valuation.decisionReady ? "COMPLETE" : "INCOMPLETE",
    valuationGapPct: expected == null ? null : round1(expected),
    positionShares: null,
    marketValueUsd: null,
    ideaCategory: "WATCHLIST_REUNDERWRITE",
  };
}

function fromExistingAnalysis(a: any, snapshot: ThomasValuationSnapshot | null, position: ExistingPositionInput, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a?.committee ?? {};
  const committee = String(c.decision ?? "WATCH").toUpperCase();
  const conviction = finite(c.conviction) ?? 0;
  const momentum = finite(a?.momentum?.total);
  const price = finite(a?.data?.quote?.price);
  const valuation = valuationFromSnapshot(snapshot, price);
  const expected = valuation.expectedReturnPct;
  const lifecycle = lifecycleFromAnalysis(a, expected);
  const pnlPct = price != null && position.avgCost > 0 ? (price / position.avgCost - 1) * 100 : null;
  const score = scoreExisting(conviction, momentum, expected, committee);
  let action: FundAction = "HOLD";

  const winner = pnlPct != null && pnlPct >= 10 && lifecycle.holdEligible && (momentum ?? 0) >= 65 && expected != null && expected >= 8 && committee !== "REJECT";
  const fullValuation = valuation.decisionReady && expected != null && expected <= 0;
  const nearFullValuation = valuation.decisionReady && expected != null && expected <= 5;
  const profitFading = pnlPct != null && pnlPct >= 8 && (lifecycle.stage === "WEAKENING" || nearFullValuation);
  const broken = committee === "REJECT" || lifecycle.stage === "BROKEN" || fullValuation;

  if (broken) action = "EXIT REVIEW";
  else if (profitFading) action = "TRIM PROFIT REVIEW";
  else if (winner) action = "LET WINNER RUN";
  else if (valuation.decisionReady && committee === "APPROVE" && expected != null && expected >= 15 && (momentum ?? 0) >= 65 && lifecycle.entryEligible) action = "ADD";
  else if (nearFullValuation || lifecycle.stage === "WEAKENING" || (momentum != null && momentum < 48)) action = "TRIM REVIEW";

  const weight = action === "ADD" ? targetWeight(score, macro) : 0;
  const marketValue = price != null ? price * position.shares : position.avgCost * position.shares;
  const rawThesis = a?.thesis?.find?.((x: any) => x.label === "Base")?.narrative ?? "Current holding under active review.";
  const mandate = researchMandate("PORTFOLIO_MONITOR");
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
    ...valuationEvidence(valuation),
    primaryEngine: "Portfolio Momentum Monitor",
    discoveryEngines: ["Portfolio Momentum Monitor", "Thomas Valuation", "Thesis Monitor"],
    lifecycleStage: lifecycle.stage,
    lifecycleScore: lifecycle.score,
    lifecycleEvidence: lifecycle.evidence,
    ...mandate,
    researchStatus: valuation.decisionReady ? "COMPLETE" : "INCOMPLETE",
    valuationGapPct: expected == null ? null : round1(expected),
    positionShares: position.shares,
    marketValueUsd: round2(marketValue),
    ideaCategory: "PORTFOLIO_MONITOR",
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
  const watchlistSet = new Set(input.watchlistTickers.map(cleanTicker));
  const riskPositions = input.positions.filter(x => !LIQUIDITY_TICKERS.has(cleanTicker(x.ticker)));
  const excluded = new Set([...held, ...watchlistSet, ...LIQUIDITY_TICKERS]);

  const [macro, phase1, existingAnalyses] = await Promise.all([
    buildMacroOutlook().catch((e: any) => {
      warnings.push(`Macro outlook: ${e?.message ?? "failed"}`);
      return { asOf:new Date().toISOString(), score:50, regime:"Neutral / Selective", regimeTh:"เป็นกลาง / คัดเลือก", vision:"Macro data unavailable; use neutral sizing.", visionTh:"ข้อมูล Macro ไม่พร้อม ระบบใช้ขนาดการลงทุนแบบเป็นกลาง", riskBudgetPct:65, cashFloorPct:input.cash.cashFloorPct, indicators:{}, scenarios:[], headlines:[], allocationTilt:[], allocationTiltTh:[], warnings:[e?.message ?? "failed"] } as MacroOutlook;
    }),
    runInvestmentResearchOS({ exclude: excluded, topN: 12, universeLimit: 40 }).catch((e: any) => {
      warnings.push(`Research OS: ${e?.message ?? "failed"}`);
      return { proposals: [], researchQueue: [], universeSize: 0, detailedUniverseSize: 0, analyzed: 0, qualified: 0, rejected: 0, warnings: [], models: [], engineDefinitions: [], engineStats: [], rotationWindows: [], universeSource: "Unavailable", methodology: "Research OS unavailable" };
    }),
    mapLimit(riskPositions.slice(0, 20), 4, async position => {
      const analysis = await analyzeSafe(position.ticker);
      const valuation = analysis?.data ? await resolveThomasValuationForMarketData(analysis.data, { dividends: [] }).catch(() => null) : null;
      return { position, analysis, valuation };
    }),
  ]);

  warnings.push(...(phase1.warnings ?? []), ...(macro.warnings ?? []));
  const existing = existingAnalyses
    .filter(row => row.analysis)
    .map(row => fromExistingAnalysis(row.analysis, row.valuation, row.position, nav, macro))
    .sort((a, b) => b.portfolioScore - a.portfolioScore);

  const phaseIdeas = phase1.proposals.map(proposal => fromProposal(proposal, nav, macro));
  const phaseTickers = new Set(phaseIdeas.map(x => x.ticker));
  const queueIdeas = (phase1.researchQueue ?? [])
    .filter(item => !phaseTickers.has(item.ticker))
    .map(item => fromResearchQueue(item));
  const watchExtras = input.watchlistTickers
    .map(cleanTicker)
    .filter(ticker => !held.has(ticker) && !phaseTickers.has(ticker) && !LIQUIDITY_TICKERS.has(ticker))
    .slice(0, 6);
  const watchAnalyses = await mapLimit(watchExtras, 3, async ticker => {
    const analysis = await analyzeSafe(ticker);
    const valuation = analysis?.data ? await resolveThomasValuationForMarketData(analysis.data, { dividends: [] }).catch(() => null) : null;
    return { analysis, valuation };
  });
  const watchIdeas = watchAnalyses.filter(row => row.analysis).map(row => fromWatchlistAnalysis(row.analysis, row.valuation, nav, macro));
  const freshIdeas = [...phaseIdeas, ...queueIdeas]
    .filter((idea, index, all) => all.findIndex(x => x.ticker === idea.ticker) === index)
    .sort((a, b) => b.portfolioScore - a.portfolioScore)
    .slice(0, 15);
  const watchlistReviews = watchIdeas
    .filter((idea, index, all) => all.findIndex(x => x.ticker === idea.ticker) === index)
    .sort((a, b) => b.portfolioScore - a.portfolioScore)
    .slice(0, 10);
  const allNewIdeas = [...freshIdeas, ...watchlistReviews];
  const newIdeas = freshIdeas.filter(idea => idea.researchStatus === "COMPLETE" && idea.valuationStatus !== "UNAVAILABLE");
  const researchIncomplete = freshIdeas.filter(idea => idea.researchStatus === "INCOMPLETE" || idea.valuationStatus === "UNAVAILABLE");

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

  const decisionIdeas = [...newIdeas, ...watchlistReviews.filter(idea => idea.researchStatus === "COMPLETE" && idea.valuationStatus !== "UNAVAILABLE")];
  const decisionIncomplete = [...researchIncomplete, ...watchlistReviews.filter(idea => idea.researchStatus === "INCOMPLETE" || idea.valuationStatus === "UNAVAILABLE")];
  const approvedNew = decisionIdeas.filter(x => x.action === "INITIATE");
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

  const opportunityDecisions: OpportunityDecision[] = decisionIdeas.map(candidate => {
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
  opportunityDecisions.push(...decisionIncomplete.map(candidate => ({
    ticker: candidate.ticker,
    decision: "RESEARCH INCOMPLETE" as const,
    fundingSource: "None",
    fundingLegs: [],
    comparedWith: null,
    relativeEdge: null,
    proposedWeightPct: 0,
    proposedCapitalUsd: 0,
    reason: "No defensible Fair Value is available. The name remains in research and cannot enter allocation, replacement or execution ranking.",
    reasonTh: "ยังไม่มี Fair Value ที่เชื่อถือได้ หุ้นจึงอยู่ใน Research Incomplete และห้ามเข้าสู่การจัดสรรเงิน การสับเปลี่ยน หรือคำสั่งลงทุน",
    trigger: "Complete a filing / DCF / comparable / analyst-consensus valuation, then rerun the Momentum Lifecycle gate.",
    triggerTh: "จัดทำ Valuation จากงบ DCF Comparable หรือ Analyst Consensus ให้ครบ แล้วตรวจ Momentum Lifecycle ใหม่",
  })));

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
    const idea = allNewIdeas.find(x => x.ticker === decision.ticker);
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
    version: "active-momentum-fund-v23",
    asOf: new Date().toISOString(), nav, macro,
    liquidity: {
      currentUsd: round0(currentUsd), currentPct: input.cash.bufferPct == null ? round1(nav > 0 ? currentUsd / nav * 100 : 0) : round1(input.cash.bufferPct),
      targetUsd: round0(targetUsd), targetPct: input.cash.cashFloorPct, deployableUsd: round0(deployableUsd), reserveGapUsd: round0(reserveGapUsd),
      cashBalance: round2(cashBalance), dividendAvailable: round2(dividendAvailable), status: liquidityStatus, positions: reservePositions, fundingOrder,
    },
    discovery: {
      broadUniverse: phase1.universeSize, detailedAnalyzed: phase1.analyzed, qualified: phase1.qualified ?? phase1.proposals.length,
      watchlist: input.watchlistTickers.length, uniqueNew: newIdeas.filter(idea => idea.action === "INITIATE").length, incomplete: researchIncomplete.length,
      models: phase1.models.length, engines: phase1.engineStats ?? [], methodology: phase1.methodology, holdingPolicy: FUND_HOLDING_POLICY,
      universeSource: phase1.universeSource,
      rotationWindows: phase1.rotationWindows ?? [],
    },
    newIdeas, watchlistReviews, researchIncomplete, existing, portfolioWinners, weakLinks, opportunityDecisions, executionPlans, replacements,
    capitalPlan: {
      requestedDeployUsd: round0(requestedDeployUsd), deployUsd: round0(deployUsd), fundedFromLiquidityUsd: round0(fundedFromLiquidityUsd),
      fundedFromRotationsUsd: round0(fundedFromRotationsUsd), raiseUsd: round0(Math.max(0, requestedDeployUsd - deployUsd)),
      liquidityAfterUsd: round0(liquidityAfterUsd), liquidityAfterPct: nav > 0 ? round1(liquidityAfterUsd / nav * 100) : 0,
      initiates: approvedNew.length, adds: existing.filter(x => x.action === "ADD").length,
      holds: existing.filter(x => x.action === "HOLD" || x.action === "LET WINNER RUN").length,
      reviews: existing.filter(x => ["TRIM PROFIT REVIEW", "TRIM REVIEW", "EXIT REVIEW"].includes(x.action)).length,
    },
    process: [
      `Separate discovery engines scan a broad US opportunity pool of ${phase1.universeSize} names; ${phase1.analyzed} receive a rotating deep-dive each cycle without blending every style into one black-box score.`,
      "Active Momentum entry gate: only Accumulation Confirmed, Early Markup or Markup candidates with constructive momentum can enter the investment-ready list; Late / Extended names are not chased.",
      "Fair Value is mandatory for a new allocation. Thomas valuation is reused for holdings/watchlist deep dives, synthetic spot-price bands are suppressed, and missing Fair Value is isolated as RESEARCH INCOMPLETE with no capital allocation.",
      "Rank every current risk holding again instead of waiting for a thesis failure. Strong winners may run while momentum, thesis and valuation headroom remain constructive.",
      "Exit discipline: a broken thesis, BROKEN lifecycle or a valuation gap of 0% or less creates EXIT REVIEW; WEAKENING momentum or a gap of 5% or less creates TRIM REVIEW.",
      "Capital rotation: compare the best new idea with the weakest eligible holding; rotate only when portfolio-score edge ≥12 and expected-return edge is normally ≥5 points.",
      `Protect the constitutional Cash Floor at ${input.cash.cashFloorPct}%; funding is quantified by USD, dividend cash and reserve instrument before any approved stock rotation.`,
      "All outputs are decision support. Existing committee cooldown, income, concentration, risk and human-approval gates still control execution.",
    ],
    warnings,
  };
}
