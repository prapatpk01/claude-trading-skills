// Structural checks on the investment committee workspace.
//
// These assert that the meeting is wired to the engine and that the governance
// language a reader relies on is actually present — not that any particular
// number appears, which is the engine's business and is covered by
// scripts/test-committee.mjs.

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

requireTokens("lib/team/committee.ts", [
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
forbidTokens("lib/team/committee.ts", [
  ["fetch(", "the meeting engine must not touch the network"],
  ["Date.now()", "the engine must use the asOf it is given, not the clock"],
]);

requireTokens("app/api/committee/meeting/route.ts", [
  "runCommitteeMeeting",
  "buildBookReview",
  "assessRegime",
  "scoreMomentumV3",
  "assessValuation",
  "assessPositionZone",
  "classifySleeve",
  "/api/analyze/actions",
  "/api/analyze/performance",
  "/api/portfolio/cash-buffer",
  "unavailable",
  "runDeskScan",
  "runInvestmentResearchOS",
  "Sentinel Research OS Phase 1",
  "proposals",
  "Swing model supplies tactical timing only",
]);

requireTokens("lib/research/deskScan.ts", ["export async function runDeskScan", "runSwingScan", "NEVER_SOURCE", "exclude"]);
requireTokens("lib/research/investmentDiscovery.ts", ["runInvestmentResearchOS", "balancedUniverse", "sourceModels", "Phase 1 factor consensus", "ENGINE_UNIVERSES"]);
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
]);

requireTokens("lib/team/constitution.ts", [
  "FUND_CONSTITUTION_VERSION", "POSITION_ZONES", "REGIME_BANDS", "PRE_TRADE_GATES",
  "HARD_RULES", "TRIM_REQUIRES_REPLACEMENT", "WIN_RATE_DISCLOSURE",
  "permittedDeployFraction", "softBlockApplies", "zoneForWeight",
]);
requireTokens("lib/team/committee.ts", [
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
