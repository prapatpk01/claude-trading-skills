import type { FundResearchEvidence } from "@/lib/research/fundResearchEvidence";
import { getLatestTradingViewEarnings } from "@/lib/integrations/tradingViewIntelligenceStore";
import { assessTradingViewEarnings, type EarningsIntelligenceRead } from "@/lib/research/earningsIntelligence";

export type FundResearchEvidenceV30 = FundResearchEvidence & {
  earningsIntelligence: EarningsIntelligenceRead;
};

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function band(score: number | null) {
  if (score == null) return "UNAVAILABLE";
  if (score >= 70) return "POSITIVE";
  if (score <= 35) return "NEGATIVE";
  return "NEUTRAL";
}

export async function applyTradingViewResearchOverlay(
  ticker: string,
  base: FundResearchEvidence,
): Promise<FundResearchEvidenceV30> {
  const event = await getLatestTradingViewEarnings(ticker, 45).catch(() => null);
  const earnings = assessTradingViewEarnings(event);

  if (earnings.score == null) {
    return {
      ...base,
      earningsIntelligence: earnings,
      governance: {
        ...base.governance,
        rule: `${base.governance.rule} TradingView Earnings Intelligence is optional evidence: missing data does not reduce Fund Fit, and provider AI summary text never changes the score by itself.`,
      },
    };
  }

  const baseCatalyst = base.catalyst.score;
  const blendedCatalyst = baseCatalyst == null
    ? earnings.score
    : Math.round(baseCatalyst * .70 + earnings.score * .30);
  const adjustedFundFit = clamp(base.fundFit.score * .94 + earnings.score * .06);
  const evidenceText = earnings.evidence.length ? earnings.evidence.join(" · ") : "measured earnings event";
  const tvNote = `TradingView Earnings ${earnings.sentiment} ${earnings.score}/100 (${evidenceText}); provider AI summary is context-only and does not score.`;

  return {
    ...base,
    earningsIntelligence: earnings,
    thesis: {
      ...base.thesis,
      whyNow: `${base.thesis.whyNow} ${earnings.sentinelView}`,
    },
    catalyst: {
      ...base.catalyst,
      score: blendedCatalyst,
      band: band(blendedCatalyst),
      quality: base.catalyst.quality === "MEASURED" || earnings.quality === "MEASURED" ? "MEASURED" : "PARTIAL",
      nextEarningsDate: earnings.nextEarningsAt ?? base.catalyst.nextEarningsDate,
      note: `${base.catalyst.note} ${tvNote}`,
      risks: Array.from(new Set([...base.catalyst.risks, ...earnings.risks])),
    },
    fundFit: {
      ...base.fundFit,
      score: adjustedFundFit,
      reasons: [
        ...base.fundFit.reasons,
        `TradingView Earnings ${earnings.sentiment} ${earnings.score}/100 · confidence ${earnings.confidence}/100 · probability tilt ${earnings.probabilityAdjustmentPct >= 0 ? "+" : ""}${earnings.probabilityAdjustmentPct}pp`,
      ],
    },
    governance: {
      ...base.governance,
      rule: `${base.governance.rule} TradingView Earnings Intelligence may modestly adjust Catalyst/Fund Fit only when measured surprises exist; provider AI summary is context-only.`,
    },
  };
}
