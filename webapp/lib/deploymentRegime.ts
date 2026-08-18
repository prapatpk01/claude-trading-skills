import type { Candle } from "./types";
import { regimeBandFor } from "./team/constitution";

export type DeploymentLabel = "RISK ON" | "SELECTIVE RISK ON" | "SELECTIVE / NEUTRAL" | "DEFENSIVE / RISK OFF" | "CRISIS";

export interface DeploymentRegime {
  authority: "CIO_DEPLOYMENT_REGIME_V1";
  score: number;
  regime: "Risk-On" | "Neutral" | "Risk-Off" | "Crisis";
  label: DeploymentLabel;
  labelTh: string;
  icon: string;
  cashMinPct: number;
  targetPct: number;
  cashFloorPct: number;
  deployFraction: number;
  deployRule: string;
  riskBudgetPct: number;
  macroScore: number;
  tapeScore: number;
  volatilityScore: number;
  realizedVol: number | null;
  weights: { macro: 45; tape: 35; volatilityRisk: 20 };
  components: { label: string; points: number; max: number; detail: string }[];
  note: string;
  methodology: string;
}

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const round1 = (value: number) => Math.round(value * 10) / 10;

function realizedVolAnnualized(candles: Candle[], lookback = 20): number | null {
  if (candles.length < lookback + 1) return null;
  const sample = candles.slice(-(lookback + 1));
  const returns: number[] = [];
  for (let i = 1; i < sample.length; i += 1) {
    const previous = sample[i - 1]?.close;
    const current = sample[i]?.close;
    if (!(previous > 0) || !(current > 0)) continue;
    returns.push(Math.log(current / previous));
  }
  if (returns.length < Math.max(10, lookback / 2)) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Convert realized volatility to a 0–100 control score. Lower volatility earns
 * more room, but the curve is deliberately gradual rather than a binary VIX gate. */
export function volatilityControlScore(realizedVolPct: number | null): number {
  if (realizedVolPct == null || !Number.isFinite(realizedVolPct)) return 50;
  if (realizedVolPct <= 12) return 100;
  if (realizedVolPct <= 16) return Math.round(100 - (realizedVolPct - 12) * 5);
  if (realizedVolPct <= 22) return Math.round(80 - (realizedVolPct - 16) * 5);
  if (realizedVolPct <= 30) return Math.round(50 - (realizedVolPct - 22) * 3.75);
  if (realizedVolPct <= 40) return Math.round(20 - (realizedVolPct - 30) * 2);
  return 0;
}

function deploymentLabel(score: number): { label: DeploymentLabel; labelTh: string } {
  if (score >= 70) return { label: "RISK ON", labelTh: "รับความเสี่ยง" };
  if (score >= 55) return { label: "SELECTIVE RISK ON", labelTh: "รับความเสี่ยงแบบคัดเลือก" };
  if (score >= 40) return { label: "SELECTIVE / NEUTRAL", labelTh: "เป็นกลาง / คัดเลือก" };
  if (score >= 20) return { label: "DEFENSIVE / RISK OFF", labelTh: "เน้นป้องกัน / ลดความเสี่ยง" };
  return { label: "CRISIS", labelTh: "ภาวะวิกฤต / รักษาเงินทุน" };
}

/**
 * Single authoritative capital-control score.
 *
 * Macro answers the 3–6 month question, tape answers the 1–4 week question,
 * and realized volatility controls how aggressively those views may be acted on.
 * The blended score alone owns Cash Floor, deployment fraction and sizing budget.
 */
export function buildDeploymentRegime(input: {
  macroScore: number | null | undefined;
  tapeScore: number | null | undefined;
  spy: Candle[];
}): DeploymentRegime {
  const macroScore = clamp(Number.isFinite(Number(input.macroScore)) ? Number(input.macroScore) : 50);
  const tapeScore = clamp(Number.isFinite(Number(input.tapeScore)) ? Number(input.tapeScore) : 50);
  const realizedVol = realizedVolAnnualized(input.spy);
  const volatilityScore = volatilityControlScore(realizedVol);
  const score = Math.round(clamp(macroScore * 0.45 + tapeScore * 0.35 + volatilityScore * 0.20));
  const band = regimeBandFor(score);
  const labels = deploymentLabel(score);
  const riskBudgetPct = Math.round(band.deployFraction * 100);

  return {
    authority: "CIO_DEPLOYMENT_REGIME_V1",
    score,
    regime: band.name,
    label: labels.label,
    labelTh: labels.labelTh,
    icon: band.icon,
    cashMinPct: band.cashMinPct,
    targetPct: band.cashMinPct,
    cashFloorPct: band.cashMinPct,
    deployFraction: band.deployFraction,
    deployRule: band.deployRule,
    riskBudgetPct,
    macroScore: Math.round(macroScore),
    tapeScore: Math.round(tapeScore),
    volatilityScore,
    realizedVol: realizedVol == null ? null : round1(realizedVol),
    weights: { macro: 45, tape: 35, volatilityRisk: 20 },
    components: [
      { label: "Macro regime (3–6M)", points: Math.round(macroScore * 0.45), max: 45, detail: `${Math.round(macroScore)}/100 × 45%` },
      { label: "Market tape (1–4W)", points: Math.round(tapeScore * 0.35), max: 35, detail: `${Math.round(tapeScore)}/100 × 35%` },
      { label: "Volatility / risk control", points: Math.round(volatilityScore * 0.20), max: 20, detail: realizedVol == null ? "Realized volatility unavailable — neutral 50/100" : `${round1(realizedVol)}% annualized realized volatility → ${volatilityScore}/100` },
    ],
    note: `${labels.label} ${score}/100. Macro ${Math.round(macroScore)}, market tape ${Math.round(tapeScore)}, volatility control ${volatilityScore}. Risk budget ${riskBudgetPct}% and Cash Floor ${band.cashMinPct}% are governed by this score only.`,
    methodology: "Authoritative CIO Deployment Regime = 45% Macro (3–6 months) + 35% Market Tape (1–4 weeks) + 20% realized-volatility control. The fund constitution maps the resulting score to deployment fraction and minimum Cash Buffer. Macro and tape remain visible context but cannot independently override sizing or the Cash Floor.",
  };
}
