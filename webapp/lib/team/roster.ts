// Sentinel Global Fund — team roster. Each analytical section in the app is
// attributed to the member who owns that discipline in the fund's structure.

export interface Member {
  name: string;
  role: string;
  desk: string;
  owns: string;
}

export const ROSTER: Record<string, Member> = {
  james: { name: "James Hartwell", role: "CIO", desk: "Executive", owns: "Final verdict, deployment approval" },
  miriam: { name: "Miriam Osei", role: "CRO", desk: "Executive", owns: "Gate compliance, data integrity, bias checks" },
  nina: { name: "Nina Okonkwo", role: "Data & Source Engineer", desk: "Executive", owns: "News flow, source logging, feed quality, lineage" },
  leo: { name: "Leo Tanaka", role: "Real-time Data Analyst", desk: "Executive", owns: "Live feed parsing, timestamps" },
  sofia: { name: "Sofia Reyes", role: "Sr. Fundamental Analyst", desk: "Research", owns: "Business quality, moat, thesis" },
  marcus: { name: "Marcus Webb", role: "Sr. Financial Analyst", desk: "Research", owns: "Earnings trend, margins, revision momentum" },
  // The two research seats are split by what they answer, not by title: Maya
  // finds what is moving, Aisha decides whether there is a reason for it.
  aisha: { name: "Aisha Fontaine", role: "Catalyst & Thematic Analyst", desk: "Research", owns: "Theme, thesis, catalyst scoring, measured PEAD, event calendar" },
  maya: { name: "Maya Chen", role: "Momentum Analyst", desk: "Research", owns: "Momentum scoring v3.0, hard blocks, entry layer" },
  priya: { name: "Priya Nair", role: "Quantitative Strategist", desk: "Quant", owns: "Win-rate tracking, factor attribution" },
  thomas: { name: "Thomas Eriksson", role: "Head of Valuation", desk: "Quant", owns: "DCF, comps, margin of safety" },
  daniel: { name: "Daniel Cho", role: "Head of Macro Strategy", desk: "Macro", owns: "Regime score, cash buffer, rotation" },
  kai: { name: "Kai Tanaka", role: "Portfolio Risk Analyst", desk: "Risk", owns: "Sizing, ATR stops, concentration zones" },
  lena: { name: "Lena Müller", role: "Portfolio Manager", desk: "Portfolio", owns: "Sleeve balance, dual objectives, yield" },
  ryan: { name: "Ryan Blackwood", role: "Execution Trader", desk: "Execution", owns: "Entry mechanics, slippage" },
};

/**
 * The standing job, before any desk's own remit.
 *
 * Running the book is the whole team's work: every seat may table a view at the
 * portfolio review and every seat may file a risk with its evidence. A fund
 * where only the CRO is allowed to see risk has one pair of eyes on it.
 */
export const STANDING_DUTY =
  "Jointly manage the holdings portfolio. Every member may table a view at the investment meeting and file a risk to the register, with the measurement behind it.";

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
