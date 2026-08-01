import { runScan, DEFAULT_UNIVERSE } from "./scan";
import { runDividendScan } from "./dividendScan";
import { runThematicPortfolio } from "./thematicPortfolio";
import { buildAnalysis } from "./analyze";
import { buildMacroOutlook, type MacroOutlook } from "./macroOutlook";

export type FundAction = "INITIATE" | "ADD" | "HOLD" | "TRIM REVIEW" | "REPLACE" | "EXIT REVIEW" | "WATCH";
export type OpportunityDecisionType = "INITIATE FROM CASH" | "ROTATE / REPLACE" | "WATCH WITH TRIGGER" | "REJECT";

export interface ActiveFundIdea {
  ticker: string; source: string[]; held: boolean; action: FundAction;
  conviction: number; confidence: string; expectedReturnPct: number | null;
  targetPrice: number | null; currentPrice: number | null; momentum: number | null;
  targetWeightPct: number; capitalUsd: number; committee: string;
  thesis: string; dissent: string[]; reasons: string[];
}

export interface OpportunityDecision {
  ticker: string;
  decision: OpportunityDecisionType;
  comparedWith: string | null;
  relativeEdge: number | null;
  proposedWeightPct: number;
  proposedCapitalUsd: number;
  reason: string;
  reasonTh: string;
  trigger: string;
  triggerTh: string;
}

export interface ActiveFundResult {
  asOf: string; nav: number; macro: MacroOutlook;
  discovery: { momentum: number; dividend: number; thematic: number; watchlist: number; uniqueNew: number };
  newIdeas: ActiveFundIdea[]; existing: ActiveFundIdea[];
  opportunityDecisions: OpportunityDecision[];
  replacements: { from: string; to: string; reason: string; rotatePct: number; rotateUsd: number }[];
  capitalPlan: { deployUsd: number; raiseUsd: number; cashAfterUsd: number; initiates: number; adds: number; holds: number; reviews: number };
  process: string[]; warnings: string[];
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const num = (x: any): number | null => typeof x === "number" && Number.isFinite(x) ? x : null;
const portfolioScore = (x: ActiveFundIdea) => x.conviction + Math.max(-20, Math.min(30, x.expectedReturnPct ?? 0)) * 0.5;
async function analyzeSafe(ticker: string) { try { return await buildAnalysis(ticker); } catch { return null; } }

function sizeIdea(a: any, held: boolean, nav: number, macro: MacroOutlook): ActiveFundIdea {
  const c = a.committee;
  const exp = num(a.expectedReturnPct), conv = num(c?.conviction) ?? 0, mult = num(c?.sizeMultiplier) ?? 0;
  const macroPenalty = macro.score < 38 ? 8 : macro.score < 55 ? 4 : 0;
  const initiateHurdle = 8 + macroPenalty;
  let action: FundAction = "WATCH";
  if (held) {
    if (c?.decision === "REJECT") action = "EXIT REVIEW";
    else if (c?.decision === "APPROVE" && exp != null && exp >= 15 + macroPenalty / 2) action = "ADD";
    else if (exp != null && exp < 0) action = "TRIM REVIEW";
    else action = "HOLD";
  } else {
    if (c?.decision === "APPROVE" && exp != null && exp >= initiateHurdle && macro.riskBudgetPct >= 30) action = "INITIATE";
    else action = "WATCH";
  }
  const rawWeight = action === "INITIATE" || action === "ADD" ? clamp((conv / 100) * 8 * mult, 1.5, 8) : 0;
  const targetWeight = rawWeight * macro.riskBudgetPct / 100;
  const reasons = [...(c?.reasons ?? [])];
  reasons.push(`Macro regime: ${macro.regime}; risk budget ${macro.riskBudgetPct}%; cash floor ${macro.cashFloorPct}%.`);
  if (macro.score < 55 && !held) reasons.push(`New-position hurdle raised to ${initiateHurdle}% expected return by the Macro desk.`);
  return {
    ticker: a.ticker, source: [], held, action, conviction: conv, confidence: c?.confidence ?? "LOW",
    expectedReturnPct: exp, targetPrice: num(a.targetPrice), currentPrice: num(a.data?.quote?.price), momentum: num(a.momentum?.total),
    targetWeightPct: Math.round(targetWeight * 10) / 10, capitalUsd: Math.round(nav * targetWeight / 100),
    committee: c?.decision ?? "WATCH", thesis: a.thesis?.find((x: any) => x.label === "Base")?.narrative ?? "No base thesis available.",
    dissent: c?.dissent ?? [], reasons,
  };
}

export async function runActiveFund(existingTickers: string[], nav: number, candidateTickers: string[] = []): Promise<ActiveFundResult> {
  const held = new Set(existingTickers.map(x => x.toUpperCase())), warnings: string[] = [];
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
  const sourceMap = new Map<string, Set<string>>();
  const add = (ticker: string | undefined, source: string) => {
    if (!ticker) return; const t = ticker.toUpperCase(); if (held.has(t)) return;
    if (!sourceMap.has(t)) sourceMap.set(t, new Set()); sourceMap.get(t)!.add(source);
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
  const currentAnalyses = await Promise.all(existingTickers.slice(0,15).map(t => analyzeSafe(t)));
  const newIdeas = newAnalyses.filter(Boolean).map((a:any,i) => { const x=sizeIdea(a,false,nav,macro); x.source=[...(ranked[i]?.[1]??[])]; return x; }).sort((a,b)=>portfolioScore(b)-portfolioScore(a));
  const existing = currentAnalyses.filter(Boolean).map((a:any)=>sizeIdea(a,true,nav,macro)).sort((a,b)=>portfolioScore(b)-portfolioScore(a));

  const approvedNew = newIdeas.filter(x=>x.action === "INITIATE");
  const weakest = [...existing].sort((a,b)=>portfolioScore(a)-portfolioScore(b));
  const replacements: ActiveFundResult["replacements"] = [];
  for (const cand of approvedNew) {
    const old = weakest.find(x => !replacements.some(r=>r.from===x.ticker) && cand.conviction-x.conviction>=10 && (cand.expectedReturnPct??-99)-(x.expectedReturnPct??-99)>=8);
    if (!old) continue;
    const pct = clamp(cand.targetWeightPct,1.5,Math.min(6,cand.targetWeightPct));
    replacements.push({ from:old.ticker, to:cand.ticker, reason:`${cand.ticker} has higher committee conviction (${cand.conviction} vs ${old.conviction}) and expected return (${cand.expectedReturnPct?.toFixed(1)??"—"}% vs ${old.expectedReturnPct?.toFixed(1)??"—"}%). Macro permits ${macro.riskBudgetPct}% of normal risk.`, rotatePct:Math.round(pct*10)/10, rotateUsd:Math.round(nav*pct/100) });
  }

  const opportunityDecisions: OpportunityDecision[] = newIdeas.map(cand => {
    const old = weakest[0] ?? null;
    const edge = old ? Math.round((portfolioScore(cand) - portfolioScore(old)) * 10) / 10 : null;
    const replacement = replacements.find(r => r.to === cand.ticker);
    if (replacement) {
      return {
        ticker:cand.ticker, decision:"ROTATE / REPLACE", comparedWith:replacement.from, relativeEdge:edge,
        proposedWeightPct:replacement.rotatePct, proposedCapitalUsd:replacement.rotateUsd,
        reason:`The committee approved ${cand.ticker} and it clears both the conviction and expected-return gap versus ${replacement.from}.`,
        reasonTh:`คณะกรรมการอนุมัติ ${cand.ticker} และมีทั้ง Conviction กับผลตอบแทนคาดหวังสูงกว่า ${replacement.from} ผ่านเกณฑ์สับเปลี่ยน`,
        trigger:"Execute only after valuation, liquidity and portfolio-risk checks remain valid at the intended entry price.",
        triggerTh:"ดำเนินการเมื่อ Valuation สภาพคล่อง และความเสี่ยงระดับพอร์ตยังผ่าน ณ ราคาเข้าที่กำหนด",
      };
    }
    if (cand.action === "INITIATE") {
      return {
        ticker:cand.ticker, decision:"INITIATE FROM CASH", comparedWith:old?.ticker ?? null, relativeEdge:edge,
        proposedWeightPct:cand.targetWeightPct, proposedCapitalUsd:cand.capitalUsd,
        reason:`Approved outside opportunity. It enters as a new position without forcing the sale of a stronger holding.`,
        reasonTh:`เป็นโอกาสใหม่นอกพอร์ตที่ผ่านการอนุมัติ จึงเสนอเปิดสถานะจากเงินสดโดยไม่บังคับขายหุ้นเดิมที่ยังแข็งแรง`,
        trigger:"Initiate only while expected return remains above the Macro-adjusted hurdle and cash stays above the required floor.",
        triggerTh:"เปิดสถานะเมื่อผลตอบแทนคาดหวังยังสูงกว่าเกณฑ์ที่ทีม Macro กำหนด และเงินสดหลังลงทุนไม่ต่ำกว่า Cash Floor",
      };
    }
    if (cand.committee === "REJECT" || cand.conviction < 45) {
      return {
        ticker:cand.ticker, decision:"REJECT", comparedWith:old?.ticker ?? null, relativeEdge:edge,
        proposedWeightPct:0, proposedCapitalUsd:0,
        reason:"The opportunity was reviewed against the portfolio but failed the committee quality, valuation or risk hurdle.",
        reasonTh:"นำมาเปรียบเทียบกับพอร์ตแล้ว แต่ไม่ผ่านเกณฑ์คุณภาพ Valuation หรือความเสี่ยงของคณะกรรมการ",
        trigger:"Re-enter the research queue only after a material thesis, earnings, valuation or catalyst improvement.",
        triggerTh:"นำกลับมาวิเคราะห์ใหม่เมื่อ Thesis ผลประกอบการ Valuation หรือ Catalyst ดีขึ้นอย่างมีนัยสำคัญ",
      };
    }
    const neededReturn = 8 + (macro.score < 38 ? 8 : macro.score < 55 ? 4 : 0);
    return {
      ticker:cand.ticker, decision:"WATCH WITH TRIGGER", comparedWith:old?.ticker ?? null, relativeEdge:edge,
      proposedWeightPct:0, proposedCapitalUsd:0,
      reason:`The opportunity is included in portfolio construction, but the committee has not authorized capital yet. It is continuously compared with ${old?.ticker ?? "the current book"}.`,
      reasonTh:`หลักทรัพย์นี้ถูกนำเข้ากระบวนการจัดพอร์ตแล้ว แต่คณะกรรมการยังไม่อนุมัติเงินลงทุน และจะเปรียบเทียบกับ ${old?.ticker ?? "พอร์ตปัจจุบัน"} ต่อเนื่อง`,
      trigger:`Promote to INITIATE when committee status becomes APPROVE, expected return is at least ${neededReturn}%, and relative portfolio edge is positive after risk checks.`,
      triggerTh:`เลื่อนเป็นเปิดสถานะใหม่เมื่อคณะกรรมการเปลี่ยนเป็น APPROVE ผลตอบแทนคาดหวังอย่างน้อย ${neededReturn}% และความได้เปรียบเทียบพอร์ตเป็นบวกหลังผ่าน Risk Check`,
    };
  });

  const deployUsd = approvedNew.reduce((s,x)=>s+x.capitalUsd,0) + existing.filter(x=>x.action==="ADD").reduce((s,x)=>s+x.capitalUsd,0);
  const raiseUsd = replacements.reduce((s,x)=>s+x.rotateUsd,0);
  const minimumCash = nav * macro.cashFloorPct / 100;
  const maxDeployable = Math.max(0, nav - minimumCash);
  const cappedDeploy = Math.min(deployUsd, maxDeployable);

  return {
    asOf:new Date().toISOString(), nav, macro,
    discovery:{ momentum:mom?.setups?.length??0, dividend:div?.picks?.length??0, thematic:theme?.holdings?.length??0, watchlist:candidateTickers.filter(x=>!held.has(x)).length, uniqueNew:sourceMap.size },
    newIdeas, existing, opportunityDecisions, replacements,
    capitalPlan:{ deployUsd:cappedDeploy, raiseUsd, cashAfterUsd:Math.max(minimumCash, nav + raiseUsd - cappedDeploy), initiates:approvedNew.length, adds:existing.filter(x=>x.action==="ADD").length, holds:existing.filter(x=>x.action==="HOLD").length, reviews:existing.filter(x=>x.action==="TRIM REVIEW"||x.action==="EXIT REVIEW").length },
    process:[
      "Macro and market regime set risk appetite, cash reserve and maximum gross deployment.",
      "Every Opportunity Discovery candidate enters the allocation meeting, including WATCH names; WATCH means no capital yet, not exclusion from portfolio analysis.",
      "Watchlist and Research candidates enter the same opportunity pool as Momentum, Dividend Quality and Thematic scans.",
      "Research underwrites fundamentals, competition, thesis, catalysts, risks, five-year model and valuation for every candidate.",
      "Specialist desks score independently; Risk may veto; the Investment Committee returns APPROVE, WATCH or REJECT.",
      "Portfolio Construction compares every outside idea against current holdings using replacement alpha, expected return and opportunity cost.",
      "Capital may initiate a new position, add to an existing winner, hold cash, trim a weak holding or rotate from a lower-conviction asset."
    ], warnings,
  };
}
