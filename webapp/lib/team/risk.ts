// Sentinel Global Fund — risk framework (Kai Tanaka).
// Rule #3 position balance, Rule #4 ATR stops, Kelly sizing, risk caps.

export type PositionZone = "BASE" | "WATCH" | "TRIM" | "EMERGENCY";

export interface ZoneAssessment {
  zone: PositionZone;
  icon: string;
  weightPct: number;
  action: string;
  /** Dollar amount to trim to reach the 18-19% target band, when required. */
  trimToTarget: number | null;
}

/** Rule #3 v2 — position balance zones. */
export function assessPositionZone(weightPct: number, marketValue: number, nav: number): ZoneAssessment {
  const targetPct = 18.5; // midpoint of the 18-19% post-trim target
  const trimTo = () => Math.round((marketValue - (targetPct / 100) * nav) * 100) / 100;

  if (weightPct > 25) {
    return { zone: "EMERGENCY", icon: "🚨", weightPct, action: "Trim immediately — above the 25% emergency line", trimToTarget: trimTo() };
  }
  if (weightPct >= 23) {
    return { zone: "TRIM", icon: "🔴", weightPct, action: "Mandatory trim to 18-19%. Research must identify a replacement first", trimToTarget: trimTo() };
  }
  // The published table reads "BASE ≤ 20%" and "WATCH 20–22%", so exactly 20%
  // stays in BASE — consistent with Gate 5, which passes at ≤ 20%.
  if (weightPct > 20) {
    return { zone: "WATCH", icon: "⚠️", weightPct, action: "Review at the meeting — trim or watch, judged against macro", trimToTarget: null };
  }
  return { zone: "BASE", icon: "✅", weightPct, action: "Optimal — within the 20% cap", trimToTarget: null };
}

export interface KellySize {
  fraction: number;      // fractional Kelly after the 0.25 multiplier
  cappedFraction: number; // after the 3% floor and 20% ceiling
  dollars: number;
  note: string;
}

/**
 * Quarter-Kelly sizing.
 *   f* = (WR × AvgWin − (1−WR) × AvgLoss) / AvgWin × 0.25
 * Ceiling 20% (Rule #3), floor 3%.
 */
export function kellySize(nav: number, winRate: number, avgWin: number, avgLoss: number): KellySize {
  if (avgWin <= 0) {
    return { fraction: 0, cappedFraction: 0.03, dollars: Math.round(nav * 0.03), note: "Avg win unavailable — defaulted to the 3% floor" };
  }
  const raw = ((winRate * avgWin - (1 - winRate) * avgLoss) / avgWin) * 0.25;
  const capped = Math.max(0.03, Math.min(0.2, raw));
  return {
    fraction: Math.round(raw * 10000) / 10000,
    cappedFraction: Math.round(capped * 10000) / 10000,
    dollars: Math.round(nav * capped),
    note:
      raw > 0.2 ? "Kelly above the 20% ceiling — capped (Rule #3)"
      : raw < 0.03 ? "Kelly below the 3% floor — raised to the floor"
      : "Within the 3-20% band",
  };
}

export interface RiskCheck {
  label: string;
  pass: boolean;
  detail: string;
}

/** Per-trade and aggregate risk caps: 1.5% NAV per trade, 8% NAV open. */
export function checkRiskCaps(
  nav: number,
  entry: number,
  stop: number,
  shares: number,
  existingOpenRisk = 0
): RiskCheck[] {
  const riskPerShare = Math.max(0, entry - stop);
  const tradeRisk = riskPerShare * shares;
  const tradePct = nav > 0 ? (tradeRisk / nav) * 100 : 0;
  const openPct = nav > 0 ? ((existingOpenRisk + tradeRisk) / nav) * 100 : 0;
  return [
    {
      label: "Risk per trade ≤ 1.5% NAV",
      pass: tradePct <= 1.5,
      detail: `${tradePct.toFixed(2)}% ($${tradeRisk.toFixed(0)} at ${riskPerShare.toFixed(2)}/share × ${shares})`,
    },
    {
      label: "Total open risk ≤ 8% NAV",
      pass: openPct <= 8,
      detail: `${openPct.toFixed(2)}% including existing positions`,
    },
  ];
}

/** Shares affordable at a given risk budget, respecting the stop distance. */
export function sizeByRisk(nav: number, entry: number, stop: number, riskPctOfNav = 1.5): number {
  const riskPerShare = entry - stop;
  if (riskPerShare <= 0 || nav <= 0) return 0;
  return Math.max(0, Math.floor((nav * (riskPctOfNav / 100)) / riskPerShare));
}
