import { runScan, DEFAULT_UNIVERSE } from "./scan";
import { runDividendScan } from "./dividendScan";
import { runThematicPortfolio } from "./thematicPortfolio";
import { buildAnalysis } from "./analyze";
import { buildMacroOutlook, type MacroOutlook } from "./macroOutlook";
import { governThomasSnapshot, resolveThomasValuationForMarketData, type ThomasValuationSnapshot } from "./thomasValuation";

export type FundAction = "INITIATE" | "ADD" | "HOLD" | "TRIM REVIEW" | "REPLACE" | "EXIT REVIEW" | "WATCH";
export type OpportunityDecisionType = "INITIATE FROM LIQUIDITY" | "ROTATE / REPLACE" | "WATCH WITH TRIGGER" | "REJECT";

export interface PositionValue {
  ticker: string;
  marketValue: number;
}

export interface ActiveFundIdea {
  ticker: string; source: string[]; held: boolean; action: FundAction;
  conviction: number; confidence: string; expectedReturnPct: number | null;
  targetPrice: number | null; currentPrice: number | null; momentum: number | null;
  valuationDecisionReady: boolean; valuationStatus: string; valuationSource: string;
  targetWeightPct: number; capitalUsd: number; committee: string;
  thesis: string; dissent: string[]; reasons: string[];
}

export interface OpportunityDecision {
  ticker: string;
  decision: OpportunityDecisionType;
  fundingSource: string;
  comparedWith: string | null;
  relativeEdge: number | null;
  proposedWeightPct: number;
  proposedCapitalUsd: number;
  reason: string;
  reasonTh: string;
  trigger: string;
  triggerTh: string;
}

export interface LiquiditySleeve {
  tickers: string[];
  positions: PositionValue[];
  currentUsd: number;
  currentPct: number;
  targetUsd: number;
  targetPct: number;
  deployableUsd: number;
  reserveGapUsd: number;
  status: "EXCESS" | "ON TARGET" | "BELOW TARGET";
  fundingOrder: string[];
}

export interface ActiveFundResult {
  asOf: string; nav: number; macro: MacroOutlook;
  liquidity: LiquiditySleeve;
  discovery: { momentum: number; dividend: number; thematic: number; watchlist: number; uniqueNew: number };
  newIdeas: ActiveFundIdea[]; existing: ActiveFundIdea[];
  opportunityDecisions: OpportunityDecision[];
  replacements: { from: string; to: string; reason: string; rotatePct: number; rotateUsd: number }[];
  capitalPlan: {
    requestedDeployUsd: number; deployUsd: number; fundedFromLiquidityUsd: number; fundedFromRotationsUsd: number;
    raiseUsd: number; liquidityAfterUsd: number; liquidityAfterPct: number;
    initiates: number; adds: number; holds: number; reviews: number;
  };
  process: string[]; warnings: string[];
}

/**
 * Capital-preservation and near-cash instruments. These are not ranked as equity
 * holdings and cannot be selected as the "weakest stock" in replacement alpha.
 * BINC is intentionally excluded because its duration/credit risk makes it a
 * strategic bond allocation rather than immediately deployable cash.
 */
export const LIQUIDITY_TICKERS = new Set([
  "SGOV", "JAAA", "TBIL", "BIL", "SHV", "SHY", "USFR", "TFLO", "ICSH", "JPST", "MINT",
]);

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const num = (x: any): number | null => typeof x === "number" && Number.isFinite(x) ? x : null;
const portfolioScore = (x: ActiveFundIdea) => x.conviction + Math.max(-20, Math.min(30, x.expectedReturnPct ?? 0)) * 0.5;
const cleanTicker = (x: string) => String(x).trim().toUpperCase();
const isLiquidityTicker = (ticker: string) => LIQUIDITY_TICKERS.has(cleanTicker(ticker));
async function analyzeSafe(ticker: string) {
  try {
    const analysis = await buildAnalysis(ticker);
    const valuation = await resolveThomasValuationForMarketData(analysis.data, { dividends: [] }).catch(() => null);
    return { analysis, valuation };
  } catch { return null; }
}

function sizeIdea(a: any, snapshot: ThomasValuationSnapshot | null, held: boolean, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a.committee;
  const governed = governThomasSnapshot(snapshot, a.data?.quote?.price ?? null);
  const exp = governed.valid ? governed.valuationGapPct : null, conv = num(c?.conviction) ?? 0, mult = num(c?.sizeMultiplier) ?? 0;
  const macroPenalty = macro.score < 38 ? 8 : macro.score < 55 ? 4 : 0;
  const initiateHurdle = 8 + macroPenalty;
  let action: FundAction = "WATCH";
  if (held) {
    if (c?.decision === "REJECT") action = "EXIT REVIEW";
    else if (governed.decisionReady && c?.decision === "APPROVE" && exp != null && exp >= 15 + macroPenalty / 2) action = "ADD";
    else if (governed.decisionReady && exp != null && exp < 0) action = "TRIM REVIEW";
    else action = "HOLD";
  } else if (governed.decisionReady && c?.decision === "APPROVE" && exp != null && exp >= initiateHurdle && macro.riskBudgetPct >= 30) {
    action = "INITIATE";
  }
  const rawWeight = action === "INITIATE" || action === "ADD" ? clamp((conv / 100) * 8 * mult, 1.5, 8) : 0;
  const targetWeight = rawWeight * macro.riskBudgetPct / 100;
  const reasons = [...(c?.reasons ?? [])];
  reasons.push(`Macro regime: ${macro.regime}; risk budget ${macro.riskBudgetPct}%; liquidity floor ${macro.cashFloorPct}%.`);
  if (macro.score < 55 && !held) reasons.push(`New-position hurdle raised to ${initiateHurdle}% expected return by the Macro desk.`);
  return {
    ticker: a.ticker, source: [], held, action, conviction: conv, confidence: c?.confidence ?? "LOW",
    expectedReturnPct: exp, targetPrice: governed.valid ? governed.fairValue : null, currentPrice: num(a.data?.quote?.price), momentum: num(a.momentum?.total),
    valuationDecisionReady: governed.decisionReady, valuationStatus: governed.status, valuationSource: snapshot?.source ?? "UNAVAILABLE",
    targetWeightPct: Math.round(targetWeight * 10) / 10, capitalUsd: Math.round(nav * targetWeight / 100),
    committee: c?.decision ?? "WATCH", thesis: a.thesis?.find((x: any) => x.label === "Base")?.narrative ?? "No base thesis available.",
    dissent: c?.dissent ?? [], reasons,
  };
}

function buildLiquiditySleeve(positions: PositionValue[], nav: number, macro: MacroOutlook): LiquiditySleeve {
  const liquidityPositions = positions
    .filter(x => isLiquidityTicker(x.ticker) && Number.isFinite(x.marketValue) && x.marketValue > 0)
    .map(x => ({ ticker: cleanTicker(x.ticker), marketValue: Math.round(x.marketValue * 100) / 100 }))
    .sort((a, b) => b.marketValue - a.marketValue);
  const currentUsd = liquidityPositions.reduce((s, x) => s + x.marketValue, 0);
  const targetPct = clamp(macro.cashFloorPct, 0, 100);
  const targetUsd = nav * targetPct / 100;
  const tolerance = Math.max(nav * 0.005, 25);
  const deployableUsd = Math.max(0, currentUsd - targetUsd);
  const reserveGapUsd = Math.max(0, targetUsd - currentUsd);
  const status = deployableUsd > tolerance ? "EXCESS" : reserveGapUsd > tolerance ? "BELOW TARGET" : "ON TARGET";
  return {
    tickers: [...LIQUIDITY_TICKERS], positions: liquidityPositions,
    currentUsd: Math.round(currentUsd), currentPct: nav > 0 ? Math.round(currentUsd / nav * 1000) / 10 : 0,
    targetUsd: Math.round(targetUsd), targetPct,
    deployableUsd: Math.round(deployableUsd), reserveGapUsd: Math.round(reserveGapUsd), status,
    fundingOrder: liquidityPositions.map(x => x.ticker),
  };
}

export async function runActiveFund(
  existingTickers: string[], nav: number, candidateTickers: string[] = [], positionValues: PositionValue[] = []
): Promise<ActiveFundResult> {
  const allHeld = new Set(existingTickers.map(cleanTicker));
  const riskTickers = existingTickers.map(cleanTicker).filter(t => !isLiquidityTicker(t));
  const riskHeld = new Set(riskTickers);
  const warnings: string[] = [];
  const [macro, mom, div, theme] = await Promise.all([
    buildMacroOutlook().catch(e => {
      warnings.push(`Macro outlook: ${e?.message ?? "failed"}`);
      return { asOf:new Date().toISOString(), score:50, regime:"Neutral / Selective", regimeTh:"เป็นกลาง / คัดเลือก", vision:"Macro data unavailable; use neutral sizing.", visionTh:"ข้อมูล Macro ไม่พร้อม ระบบใช้ขนาดการลงทุนแบบเป็นกลาง", riskBudgetPct:65, cashFloorPct:15, indicators:{}, scenarios:[], headlines:[], allocationTilt:[], allocationTiltTh:[], warnings:[e?.message ?? "failed"] } as MacroOutlook;
    }),
    runScan(DEFAULT_UNIVERSE, 5).catch(e => { warnings.push(`Momentum discovery: ${e?.message ?? "failed"}`); return null; }),
    runDividendScan(DEFAULT_UNIVERSE, 5).catch(e => { warnings.push(`Dividend discovery: ${e?.message ?? "failed"}`); return null; }),
    runThematicPortfolio(8, "monthly").catch(e => { warnings.push(`Thematic discovery: ${e?.message ?? "failed"}`); return null; }),
  ]);
  warnings.push(...(macro.warnings ?? []));
  const liquidity = buildLiquiditySleeve(positionValues, nav, macro);

  const sourceMap = new Map<string, Set<string>>();
  const add = (ticker: string | undefined, source: string) => {
    if (!ticker) return;
    const t = cleanTicker(ticker);
    if (allHeld.has(t) || isLiquidityTicker(t)) return;
    if (!sourceMap.has(t)) sourceMap.set(t, new Set());
    sourceMap.get(t)!.add(source);
  };
  candidateTickers.forEach(t => add(t, "Watchlist / Research"));
  (mom?.setups ?? []).forEach((x: any) => add(x.ticker, "Momentum Scanner"));
  (div?.picks ?? []).forEach((x: any) => add(x.ticker, "Dividend Quality"));
  (theme?.holdings ?? []).forEach((x: any) => add(x.ticker, `Thematic · ${x.theme ?? x.proxy ?? "Leadership"}`));

  const ranked = [...sourceMap.entries()].sort((a,b) => {
    const aw = a[1].has("Watchlist / Research") ? 1 : 0, bw = b[1].has("Watchlist / Research") ? 1 : 0;
    return bw - aw || b[1].size - a[1].size;
  }).slice(0,15);
  const newAnalyses = await Promise.all(ranked.map(([t]) => analyzeSafe(t)));
  const currentAnalyses = await Promise.all(riskTickers.slice(0,15).map(t => analyzeSafe(t)));
  const newIdeas = newAnalyses.filter(Boolean).map((row:any,i) => { const x=sizeIdea(row.analysis,row.valuation,false,nav,macro); x.source=[...(ranked[i]?.[1]??[])]; return x; }).sort((a,b)=>portfolioScore(b)-portfolioScore(a));
  const existing = currentAnalyses.filter(Boolean).map((row:any)=>sizeIdea(row.analysis,row.valuation,true,nav,macro)).sort((a,b)=>portfolioScore(b)-portfolioScore(a));

  const approvedNew = newIdeas.filter(x=>x.action === "INITIATE");
  const weakest = [...existing].sort((a,b)=>portfolioScore(a)-portfolioScore(b));
  let availableLiquidity = liquidity.deployableUsd;
  const liquidityAllocations = new Map<string, number>();
  for (const cand of approvedNew) {
    const amount = Math.min(cand.capitalUsd, availableLiquidity);
    if (amount > 0) {
      liquidityAllocations.set(cand.ticker, Math.round(amount));
      availableLiquidity -= amount;
    }
  }

  const replacements: ActiveFundResult["replacements"] = [];
  for (const cand of approvedNew) {
    const unfunded = Math.max(0, cand.capitalUsd - (liquidityAllocations.get(cand.ticker) ?? 0));
    if (unfunded <= 0) continue;
    const old = weakest.find(x => !replacements.some(r=>r.from===x.ticker) && cand.conviction-x.conviction>=10 && (cand.expectedReturnPct??-99)-(x.expectedReturnPct??-99)>=8);
    if (!old) continue;
    const pct = Math.min(clamp(cand.targetWeightPct,1.5,Math.min(6,cand.targetWeightPct)), nav > 0 ? unfunded / nav * 100 : 0);
    const rotateUsd = Math.min(unfunded, Math.round(nav*pct/100));
    if (rotateUsd <= 0) continue;
    replacements.push({ from:old.ticker, to:cand.ticker, reason:`Liquidity above the Macro floor is insufficient for the full position. ${cand.ticker} also clears the conviction and expected-return gap versus ${old.ticker}.`, rotatePct:Math.round(pct*10)/10, rotateUsd });
  }

  const opportunityDecisions: OpportunityDecision[] = newIdeas.map(cand => {
    const old = weakest[0] ?? null;
    const edge = old ? Math.round((portfolioScore(cand)-portfolioScore(old))*10)/10 : null;
    const liquidityFunding = liquidityAllocations.get(cand.ticker) ?? 0;
    const replacement = replacements.find(r=>r.to===cand.ticker);
    if (cand.action === "INITIATE" && liquidityFunding > 0 && !replacement) {
      return {
        ticker:cand.ticker, decision:"INITIATE FROM LIQUIDITY", fundingSource:liquidity.fundingOrder.join(" → ") || "Liquidity sleeve",
        comparedWith:old?.ticker??null, relativeEdge:edge, proposedWeightPct:cand.targetWeightPct, proposedCapitalUsd:liquidityFunding,
        reason:`Approved opportunity funded from deployable liquidity above the ${liquidity.targetPct}% Macro floor. No risk holding needs to be sold.`,
        reasonTh:`โอกาสนี้ผ่านการอนุมัติและใช้เงินจาก Liquidity Sleeve ส่วนที่เกิน Cash Buffer เป้าหมาย ${liquidity.targetPct}% จึงไม่จำเป็นต้องขายหุ้นเสี่ยงที่ยังแข็งแรง`,
        trigger:"Deploy only the excess above the required liquidity floor and recheck price, valuation and portfolio risk before execution.",
        triggerTh:"ใช้ได้เฉพาะเงินส่วนเกินเหนือ Liquidity Floor และต้องตรวจราคา Valuation กับความเสี่ยงพอร์ตก่อนดำเนินการ",
      };
    }
    if (replacement) {
      return {
        ticker:cand.ticker, decision:"ROTATE / REPLACE", fundingSource:`Liquidity excess ${liquidityFunding} USD + ${replacement.from}`,
        comparedWith:replacement.from, relativeEdge:edge, proposedWeightPct:replacement.rotatePct, proposedCapitalUsd:liquidityFunding+replacement.rotateUsd,
        reason:`Use deployable liquidity first, then fund the remaining approved allocation by rotating from ${replacement.from}.`,
        reasonTh:`ใช้เงินส่วนเกินจาก Liquidity Sleeve ก่อน แล้วจึงจัดหาเงินส่วนที่เหลือด้วยการสับเปลี่ยนจาก ${replacement.from}`,
        trigger:"Execute only if the candidate still clears replacement alpha after costs and the liquidity floor remains intact.",
        triggerTh:"ดำเนินการเมื่อ Candidate ยังผ่าน Replacement Alpha หลังต้นทุน และ Liquidity Floor ไม่ถูกละเมิด",
      };
    }
    if (cand.committee === "REJECT" || cand.conviction < 45) {
      return {
        ticker:cand.ticker, decision:"REJECT", fundingSource:"None", comparedWith:old?.ticker??null, relativeEdge:edge,
        proposedWeightPct:0, proposedCapitalUsd:0,
        reason:"Reviewed against the portfolio but failed the committee quality, valuation or risk hurdle.",
        reasonTh:"นำมาเปรียบเทียบกับพอร์ตแล้ว แต่ไม่ผ่านเกณฑ์คุณภาพ Valuation หรือความเสี่ยงของคณะกรรมการ",
        trigger:"Return only after a material thesis, earnings, valuation or catalyst improvement.",
        triggerTh:"นำกลับมาวิเคราะห์เมื่อ Thesis ผลประกอบการ Valuation หรือ Catalyst ดีขึ้นอย่างมีนัยสำคัญ",
      };
    }
    const neededReturn = 8 + (macro.score < 38 ? 8 : macro.score < 55 ? 4 : 0);
    return {
      ticker:cand.ticker, decision:"WATCH WITH TRIGGER", fundingSource:"Liquidity sleeve after approval", comparedWith:old?.ticker??null, relativeEdge:edge,
      proposedWeightPct:0, proposedCapitalUsd:0,
      reason:`Included in portfolio construction, but capital is not authorized. The liquidity sleeve is reserved until all gates clear.`,
      reasonTh:`ถูกนำเข้ากระบวนการจัดพอร์ตแล้ว แต่ยังไม่อนุมัติเงินลงทุน Liquidity Sleeve จะยังถูกกันไว้จนกว่าจะผ่านทุก Gate`,
      trigger:`Promote when committee status is APPROVE, expected return is at least ${neededReturn}%, relative edge is positive, and deployable liquidity is available.`,
      triggerTh:`เลื่อนเป็นลงทุนเมื่อคณะกรรมการเป็น APPROVE ผลตอบแทนคาดหวังอย่างน้อย ${neededReturn}% ความได้เปรียบเป็นบวก และมี Liquidity ส่วนเกินพร้อมใช้`,
    };
  });

  const requestedDeployUsd = approvedNew.reduce((s,x)=>s+x.capitalUsd,0) + existing.filter(x=>x.action==="ADD").reduce((s,x)=>s+x.capitalUsd,0);
  const fundedFromLiquidityUsd = [...liquidityAllocations.values()].reduce((s,x)=>s+x,0);
  const fundedFromRotationsUsd = replacements.reduce((s,x)=>s+x.rotateUsd,0);
  const deployUsd = Math.min(requestedDeployUsd, fundedFromLiquidityUsd + fundedFromRotationsUsd);
  const liquidityAfterUsd = Math.max(liquidity.targetUsd, liquidity.currentUsd-fundedFromLiquidityUsd);

  return {
    asOf:new Date().toISOString(), nav, macro, liquidity,
    discovery:{ momentum:mom?.setups?.length??0, dividend:div?.picks?.length??0, thematic:theme?.holdings?.length??0, watchlist:candidateTickers.filter(x=>!allHeld.has(cleanTicker(x))).length, uniqueNew:sourceMap.size },
    newIdeas, existing, opportunityDecisions, replacements,
    capitalPlan:{
      requestedDeployUsd, deployUsd, fundedFromLiquidityUsd, fundedFromRotationsUsd,
      raiseUsd:fundedFromRotationsUsd, liquidityAfterUsd:Math.round(liquidityAfterUsd), liquidityAfterPct:nav>0?Math.round(liquidityAfterUsd/nav*1000)/10:0,
      initiates:approvedNew.length, adds:existing.filter(x=>x.action==="ADD").length, holds:existing.filter(x=>x.action==="HOLD").length,
      reviews:existing.filter(x=>x.action==="TRIM REVIEW"||x.action==="EXIT REVIEW").length,
    },
    process:[
      "Macro and market regime set the target Liquidity Buffer, risk appetite and maximum gross deployment.",
      "SGOV, JAAA and approved short-duration instruments are managed as the Liquidity Sleeve, not ranked as equity holdings.",
      "Every Opportunity Discovery candidate enters the allocation meeting, including WATCH names; WATCH means no capital yet, not exclusion.",
      "Research underwrites fundamentals, competition, thesis, catalysts, risks, five-year model and valuation for every candidate.",
      "Portfolio Construction uses deployable liquidity above the Macro floor before considering the sale of a risk holding.",
      "Replacement Alpha may rotate from a weaker risk asset only when excess liquidity is insufficient and the candidate clears a meaningful edge.",
      "If the Liquidity Sleeve is below target, new deployment is restricted and the committee prioritizes rebuilding the buffer."
    ], warnings,
  };
}
