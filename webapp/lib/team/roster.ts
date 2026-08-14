// Sentinel Global Fund — team roster. Each analytical section in the app is
// attributed to the member who owns that discipline in the fund's structure.

export interface Member {
  name: string;
  role: string;
  desk: string;
  owns: string;
}

export const ROSTER: Record<string, Member> = {
  james: { name: "James Hartwell", role: "CIO / Executive Chair", desk: "Executive Management", owns: "Final APPROVE / DEFER / REJECT resolution and next-dollar CIO plan" },
  miriam: { name: "Miriam Osei", role: "CRO / Executive Risk", desk: "Executive Management", owns: "Independent risk PASS / CONDITIONAL / VETO" },
  sofia: { name: "Sofia Reyes", role: "Head of Investment Research", desk: "Investment Team", owns: "Investment-team mandate, thesis quality, broad opportunity hunt and signed investment proposal" },
  daniel: { name: "Daniel Cho", role: "Macro & Market Strategist", desk: "Investment Team", owns: "Regime score, cash buffer, sector rotation" },
  marcus: { name: "Marcus Webb", role: "Financial Modeling Analyst", desk: "Investment Team", owns: "Earnings trend, margins, forecasts and revision momentum" },
  thomas: { name: "Thomas Eriksson", role: "Head of Valuation", desk: "Investment Team", owns: "DCF, comps, fair-value range and margin of safety" },
  // Aisha owns dated catalysts; Maya owns the scanner, tape and entry structure.
  aisha: { name: "Aisha Fontaine", role: "Catalyst & Event Analyst", desk: "Investment Team", owns: "Catalyst scoring, event calendar, PEAD and invalidation triggers" },
  maya: { name: "Maya Chen", role: "Momentum & Market Structure Analyst", desk: "Investment Team", owns: "New-idea scanner, relative strength, structure and entry layer" },
  priya: { name: "Priya Nair", role: "Quantitative Strategist / Portfolio Intelligence", desk: "Investment Team", owns: "Expected return, robustness, factor attribution, next-dollar ranking and replacement-alpha comparison" },
  leo: { name: "Leo Tanaka", role: "Live Market Intelligence Analyst", desk: "Investment Team", owns: "Live feed, news, price changes and decision-change alerts" },
  lena: { name: "Lena Müller", role: "Head of Asset Management / Portfolio Optimizer", desk: "Asset Management Team", owns: "Signed portfolio plan, funding map, rebalance sequencing and replacement implementation" },
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
  "Every member may table evidence and file a measured risk. Decision authority is limited to the Investment Head, Asset Management Head, CRO and CIO.";

export const FUND = {
  name: "Sentinel Global Fund",
  cio: "James Hartwell",
  cro: "Miriam Osei",
  benchmark: "SPY total return × 1.3 per year",
  yieldTarget: 5,
  strategy: "Barbell — Growth/Momentum + Income/Dividend + Cash/Defensive",
  scoringVersion: "Momentum Scoring System v3.0",
  governanceVersion: "Governance Rules v2.0",
};
