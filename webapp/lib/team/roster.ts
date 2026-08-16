// Sentinel Global Fund — team roster. Each analytical section in the app is
// attributed to the member who owns that discipline in the fund's structure.

export interface Member {
  name: string;
  role: string;
  desk: string;
  owns: string;
}

export const ROSTER: Record<string, Member> = {
  james: { name: "James Hartwell", role: "CIO / Chief Portfolio Decision Maker", desk: "Executive Management", owns: "Final BUY/ADD NOW, WAIT FOR TRIGGER, ROTATE/REPLACE, TRIM/EXIT or HOLD CASH/SGOV resolution after all upstream authority gates" },
  miriam: { name: "Miriam Osei", role: "CRO / Forward Risk Officer", desk: "Executive Management", owns: "Independent PASS / CONDITIONAL / VETO using downside, evidence quality, concentration, event risk and hard-block discrimination" },
  sofia: { name: "Sofia Reyes", role: "Chief Investment Underwriter", desk: "Investment Team", owns: "Ownership underwriting across business quality, earnings, industry/TAM, valuation, catalysts and expected return; separates company quality from entry timing" },
  daniel: { name: "Daniel Cho", role: "Macro & Market Strategist", desk: "Investment Team", owns: "Regime score, cash buffer, sector rotation" },
  marcus: { name: "Marcus Webb", role: "Financial Modeling Analyst", desk: "Investment Team", owns: "Earnings trend, margins, forecasts and revision momentum" },
  thomas: { name: "Thomas Eriksson", role: "Head of Valuation", desk: "Investment Team", owns: "DCF, comps, fair-value range and margin of safety" },
  // Aisha owns dated catalysts; Maya owns the scanner, tape and entry structure.
  aisha: { name: "Aisha Fontaine", role: "Catalyst & Event Analyst", desk: "Investment Team", owns: "Catalyst scoring, event calendar, PEAD and invalidation triggers" },
  maya: { name: "Maya Chen", role: "Momentum & Market Structure Analyst", desk: "Investment Team", owns: "New-idea scanner, relative strength, structure and entry layer" },
  priya: { name: "Priya Nair", role: "Quantitative Strategist / Portfolio Intelligence", desk: "Investment Team", owns: "Expected return, robustness, factor attribution, next-dollar ranking and replacement-alpha comparison" },
  leo: { name: "Leo Tanaka", role: "Live Market Intelligence Analyst", desk: "Investment Team", owns: "Live feed, news, price changes and decision-change alerts" },
  lena: { name: "Lena Müller", role: "Head of Asset Management / Portfolio Capital Allocator", desk: "Asset Management Team", owns: "Next-dollar allocation, sizing, Cash-Floor-aware funding, sleeve drift, opportunity cost and replacement sequencing" },
  kai: { name: "Kai Tanaka", role: "Portfolio Risk & Construction Analyst", desk: "Asset Management Team", owns: "Sizing, concentration, correlation and stress limits" },
  ryan: { name: "Ryan Blackwood", role: "Execution & Trading Operations", desk: "Asset Management Team", owns: "Order mechanics, liquidity, staging and slippage" },
  nina: { name: "Nina Okonkwo", role: "Portfolio Data & Control Lead", desk: "Asset Management Team", owns: "Ledger, cash reconciliation, cost basis, source quality and lineage" },
};

/**
 * The standing job, before any desk's own remit.
 *
 * Every specialist may table evidence and file a risk. Only the two team heads,
 * CRO and CIO hold sequential decision authority.
 */
export const STANDING_DUTY =
  "Every member may table evidence and file a measured risk. Decision authority is limited to Sofia Reyes (ownership underwriting), Lena Müller (capital allocation), Miriam Osei (forward risk), and James Hartwell (final portfolio action). A CONDITIONAL decision is never executable until its trigger clears and the meeting is rerun.";

export const FUND = {
  name: "Sentinel Global Fund",
  cio: "James Hartwell",
  cro: "Miriam Osei",
  benchmark: "SPY total return × 1.3 per year",
  yieldTarget: 5,
  strategy: "Barbell — Growth/Momentum + Income/Dividend + Cash/Defensive",
  scoringVersion: "Momentum Scoring System v3.0",
  governanceVersion: "Decision Authority V22 / Governance Rules v2.0",
};
