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
requireTokens("app/components/CommitteeMeetingPanel.tsx", [
  'data-committee-version="1.0"',
  "/api/committee/meeting",
  "Investment Committee",
  "Agenda",
  "Attendance and quorum",
  "Macro regime and cash policy",
  "Motions",
  "Capital plan",
  "Trade blotter",
  "Resolutions",
  "Risk register and round table",
  "Minutes",
  "Vote sheet",
  "Dissent on the record",
  "NO AUTO EXECUTION",
  "ABSTENTION IS HONEST",
  "SOURCES FUND USES",
]);

// The old workspace called routes that do not exist, so two of its three
// panels were permanently empty. Nothing may reintroduce those paths.
forbidTokens("app/components/CommitteeMeetingPanel.tsx", [
  ["/api/analysis/actions", "route does not exist — the analyze routes are /api/analyze/*"],
  ["/api/analysis/performance", "route does not exist — the analyze routes are /api/analyze/*"],
]);

// V16 is the meeting venue: the Analysis team's valuation work above, the
// committee's motions, vote and funded capital plan below.
requireTokens("app/components/CIOCommandCenterV16.tsx", [
  "CommitteeMeetingPanel",
  "Investment Committee: Motions, Vote and Capital Plan",
  "HUMAN APPROVAL REQUIRED · NO AUTO EXECUTION",
]);
requireTokens("app/page.tsx", ["CIOCommandCenterV16"]);

// ── the engine is a pure module and the route is the only fetcher ──
requireTokens("lib/team/committee.ts", [
  "export function runCommitteeMeeting",
  "MIN_COVERAGE_PCT",
  "HARD_CAP_PCT",
  "ABSTAIN",
  "cutForFunding",
  "veto",
  "dissent",
  // The liquidity motion must state both ends: what to sell, and that the
  // proceeds stay put. Either one missing turns it back into "raise the buffer".
  "RAISE CASH",
  "motionForLiquidity",
  "earmarkedForCashUsd",
  "proceeds stay as settled cash",
  "overdrawn",
]);

// One source of truth for what the fund owns. Routes that describe the current
// book must not read the holdings table directly — that is how two panels came
// to print two different NAVs for one portfolio.
requireTokens("lib/portfolioSource.ts", ["live_holdings_ledger", "ledger_shares", "unbacked", "shareMismatches"]);
for (const file of [
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/analytics/route.ts",
  "app/api/committee/meeting/route.ts",
]) {
  requireTokens(file, ["loadOpenHoldings"]);
  forbidTokens(file, [['from("holdings")', "reads the holdings table directly instead of the ledger source"]]);
}

// The optimizer must name a funding source and a destination for the cash.
requireTokens("app/api/portfolio/optimizer/route.ts", ["fundingSource", "proceedsDestination", "restoring the buffer is the destination"]);
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
]);

// ── research must be able to hand a name to the committee ──
// The "Committee Ready" stage existed for months with no way to send anything.
requireTokens("app/components/ResearchWorkspaceV12.tsx", [
  "referToCommittee",
  '"COMMITTEE"',
  "/api/analyze/actions",
  "Refer to committee",
  "Refer the shortlist to the investment committee",
  // The referral must carry the price it was written at, or the committee
  // cannot tell that the thesis has drifted off it.
  "price:candidate.price",
  "source:engine",
]);

// ── The fund's own rulebook must be the single source of its thresholds ──
// docs/INVESTMENT_SYSTEM.md is the document; lib/team/constitution.ts is the
// machine-readable copy; scripts/test-constitution.mjs asserts they agree.
requireTokens("lib/team/constitution.ts", [
  "FUND_CONSTITUTION_VERSION", "POSITION_ZONES", "REGIME_BANDS", "PRE_TRADE_GATES",
  "HARD_RULES", "TRIM_REQUIRES_REPLACEMENT", "WIN_RATE_DISCLOSURE",
  "permittedDeployFraction", "softBlockApplies", "zoneForWeight",
]);
// The committee must enforce the rules, not restate their numbers.
requireTokens("lib/team/committee.ts", [
  "TRIM_REQUIRES_REPLACEMENT", "permittedDeployFraction", "winRatePresentation",
  "Rule #3", "Rule #2", "FUND_CONSTITUTION_VERSION",
]);
if (!fs.existsSync(path.join(root, "docs/INVESTMENT_SYSTEM.md"))) {
  failures.push("docs/INVESTMENT_SYSTEM.md: the fund's rulebook must be committed alongside the code that enforces it");
}

requireTokens("app/page.tsx", ['section === "command"']);

if (failures.length) {
  console.error(`Investment committee validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Sentinel investment committee validation PASSED");
