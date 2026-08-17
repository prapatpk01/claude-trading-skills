// Structural checks on the investment committee workspace.
//
// These assert that the meeting is wired to the engine and that the governance
// language a reader relies on is actually present — not that any particular
// number appears, which is the engine's business and is covered by
// scripts/test-committee.mjs and scripts/test-authority-v22.mjs.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireTokens = (file, tokens) => {
  let source;
  try { source = read(file); }
  catch { failures.push(`${file}: missing file`); return; }
  for (const token of tokens) if (!source.includes(token)) failures.push(`${file}: missing ${token}`);
};
const forbidTokens = (file, tokens) => {
  let source;
  try { source = read(file); } catch { return; }
  for (const [token, why] of tokens) if (source.includes(token)) failures.push(`${file}: ${why} (${token})`);
};

// ── the component renders the meeting the engine produced ──
requireTokens("app/components/CIOCommandCenterV20.tsx", [
  'data-cio-version="20.0"',
  "/api/committee/meeting",
  "Decision & Execution Command Center",
  "One prioritized decision list",
  "Every research model sources new investments",
  "Every use names its source",
  "What a human must enter",
  "10 SPECIALISTS · ADVISORY EVIDENCE",
  "Teams & authority",
  "AuthorityGates",
  "deskReports",
  "Could not measure",
  "proposals",
  "BUY",
  "SELL",
  "HUMAN APPROVAL REQUIRED",
  "NO AUTO EXECUTION",
]);

forbidTokens("app/components/CIOCommandCenterV20.tsx", [
  ["/api/analysis/actions", "route does not exist — the analyze routes are /api/analyze/*"],
  ["/api/analysis/performance", "route does not exist — the analyze routes are /api/analyze/*"],
  ["summary?.winRate\\b", "the performance summary key is winRatePct"],
]);

// V22 preserves the prior committee engine byte-for-byte in committeeLegacy.ts
// and keeps committee.ts as a small governance wrapper. Validate both layers.
requireTokens("lib/team/committee.ts", [
  "export * from \"./committeeLegacy\"",
  "runLegacyCommitteeMeeting",
  "applyDecisionAuthorityV22",
  "export function runCommitteeMeeting",
]);
requireTokens("lib/team/authorityV22.ts", [
  "Chief Investment Underwriter",
  "Portfolio Capital Allocator",
  "Forward Risk Officer",
  "Chief Portfolio Decision Maker",
  "CONDITIONAL",
  "WAIT FOR TRIGGER",
  "HOLD CASH/SGOV",
  "applyDecisionAuthorityV22",
]);
requireTokens("lib/team/committeeLegacy.ts", [
  "export function runCommitteeMeeting",
  "MIN_COVERAGE_PCT",
  "HARD_CAP_PCT",
  "ABSTAIN",
  "cutForFunding",
  "veto",
  "dissent",
  "buildDecisionGates",
  "Head of Investment Research",
  "Head of Asset Management",
  "RAISE CASH",
  "motionForLiquidity",
  "earmarkedForCashUsd",
  "SGOV and other approved reserves are already inside the Cash Buffer",
  "overdrawn",
]);

// One source of truth for what the fund owns. The cash-buffer route delegates
// its work to lib/cashBufferSnapshot.ts, so validate that module rather than
// requiring a now-obsolete direct import on the thin HTTP wrapper.
requireTokens("lib/portfolioSource.ts", ["live_holdings_ledger", "ledger_shares", "unbacked", "shareMismatches"]);
requireTokens("app/api/portfolio/cash-buffer/route.ts", ["buildCashBufferSnapshot"]);
requireTokens("lib/cashBufferSnapshot.ts", ["loadOpenHoldings", "buildCashBufferSnapshot"]);
forbidTokens("lib/cashBufferSnapshot.ts", [['from("holdings")', "reads the holdings table directly instead of the ledger source"]]);
for (const file of [
  "app/api/portfolio/analytics/route.ts",
  "app/api/committee/meeting/route.ts",
]) {
  requireTokens(file, ["loadOpenHoldings"]);
  forbidTokens(file, [['from("holdings")', "reads the holdings table directly instead of the ledger source"]]);
}

requireTokens("app/api/portfolio/optimizer/route.ts", ["fundingSource", "proceedsDestination", "converting them to USD cannot close this gap"]);
for (const file of ["lib/team/committee.ts", "lib/team/committeeLegacy.ts", "lib/team/authorityV22.ts"]) {
  forbidTokens(file, [
    ["fetch(", "the meeting engine must not touch the network"],
    ["Date.now()", "the engine must use the asOf it is given, not the clock"],
  ]);
}

requireTokens("app/api/committee/meeting/route.ts", [
  "runCommitteeMeeting",
  "buildBookReview",
  "assessRegime",
  "scoreMomentumV3",
  "resolveThomasValuation",
  "loadThomasValuationLedger",
  "assessPositionZone",
  "classifySleeve",
  "/api/analyze/actions",
  "/api/analyze/performance",
  "buildAuthoritativeCashBufferSnapshot",
  "portfolioSnapshot",
  "unavailable",
  "runDeskScan",
  "runInvestmentResearchOS",
  "Active Momentum Research V23",
  "proposals",
  "lifecycle and Fair Value gates",
]);

requireTokens("lib/research/deskScan.ts", ["export async function runDeskScan", "runSwingScan", "NEVER_SOURCE", "exclude"]);
requireTokens("lib/research/investmentDiscovery.ts", ["runInvestmentResearchOS", "buildRotatingMarketUniverse", "researchQueue", "sourceModels", "RESEARCH_ENGINES", "buildEngineUniverses", "engineReports", "lifecycleStage", "valuationGapPct", "rotationCadence"]);
requireTokens("lib/research/marketUniverse.ts", ["loadSecSymbolUniverse", "SEC EDGAR listed-registrant master universe", '"3D"', '"7D"', '"1M"', '"3M"']);
requireTokens("lib/thomasValuation.ts", ["resolveThomasValuation", "THOMAS_DCF_MULTI_ANCHOR", "YAHOO_ANALYST_CONSENSUS", "saveThomasValuationLedger"]);
requireTokens("app/api/committee/swing-scan/route.ts", ["runDeskScan"]);
forbidTokens("app/api/committee/swing-scan/route.ts", [
  ["runSwingScan(", "the scan must go through lib/research/deskScan.ts so the meeting and the page agree"],
]);

requireTokens("app/components/ResearchWorkspaceV12.tsx", [
  "referToCommittee",
  '"COMMITTEE"',
  "/api/analyze/actions",
  "Refer to committee",
  "Refer the shortlist to the investment committee",
  "price:candidate.price",
  "source:engine",
  "body?.error",
  "watchError",
  "ACTIVE MOMENTUM RESEARCH OS · V23",
  "Momentum Stage",
  "Valuation Complete",
]);

requireTokens("app/components/ActiveFundDecisionView.tsx", [
  "DiscoveryEnginePanel",
  "DiscoveryIdeaTable",
  "IncompleteResearchTable",
  "RESEARCH INCOMPLETE",
  "lifecycleStage",
  "valuationGapPct",
  "searchBasisTh",
  "investmentHorizonTh",
  "reviewCadenceTh",
  "Fresh market discoveries — outside Holdings and Watchlist",
  "Watchlist re-underwrite — tracked names, not fresh discoveries",
]);

requireTokens("lib/activeFundV2.ts", [
  "active-momentum-fund-v23",
  "RESEARCH INCOMPLETE",
  "classifyMomentumLifecycle",
  "Accumulation Confirmed",
  "Fair Value is mandatory",
  "valuation gap of 0% or less",
  "FUND_HOLDING_POLICY",
  "searchBasis",
  "investmentHorizon",
]);

requireTokens("docs/SENTINEL_ACTIVE_MOMENTUM_V23.md", [
  "Active Momentum",
  "ACCUMULATION",
  "EARLY_MARKUP",
  "MOMENTUM_EXPANSION",
  "RESEARCH INCOMPLETE",
  "Valuation Gap",
  "SEC EDGAR",
  "3-day",
  "Research Queue",
  "Thomas",
  "4–16 weeks",
  "Quarterly",
]);

requireTokens("lib/team/constitution.ts", [
  "FUND_CONSTITUTION_VERSION", "POSITION_ZONES", "REGIME_BANDS", "PRE_TRADE_GATES",
  "HARD_RULES", "TRIM_REQUIRES_REPLACEMENT", "WIN_RATE_DISCLOSURE",
  "permittedDeployFraction", "softBlockApplies", "zoneForWeight",
]);
requireTokens("lib/team/committeeLegacy.ts", [
  "TRIM_REQUIRES_REPLACEMENT", "permittedDeployFraction", "winRatePresentation",
  "Rule #3", "Rule #2", "FUND_CONSTITUTION_VERSION",
  "buildDeskReports", "deskReports", "gaps",
]);
if (!fs.existsSync(path.join(root, "docs/INVESTMENT_SYSTEM.md"))) {
  failures.push("docs/INVESTMENT_SYSTEM.md: the fund's rulebook must be committed alongside the code that enforces it");
}

requireTokens("app/page.tsx", ["CIOCommandCenterV20", 'data-sentinel-version="20.0"', 'section === "command"']);

if (failures.length) {
  console.error(`Investment committee validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Sentinel investment committee validation PASSED");
