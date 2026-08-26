import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireTokens = (file, tokens) => {
  let source;
  try { source = read(file); } catch { failures.push(`${file}: missing file`); return; }
  for (const token of tokens) if (!source.includes(token)) failures.push(`${file}: missing ${token}`);
};
const forbidTokens = (file, pairs) => {
  let source;
  try { source = read(file); } catch { return; }
  for (const [token, reason] of pairs) if (source.includes(token)) failures.push(`${file}: ${reason} (${token})`);
};

// V35 remains archived for rollback and proves the five-step architecture did not disappear.
requireTokens("app/components/CIOCommandCenterV35.tsx", [
  'data-cio-version="35.0"',
  'data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION"',
  '"status"', '"opportunities"', '"portfolio"', '"capital"', '"decision"',
  "/api/committee/meeting",
  "/api/capital-recycling",
  "/api/holding-market",
  "MeetingPlanApprovalPanel",
  "MeetingApprovalPanel",
]);

// V35.1 is the live capital-clarity surface. It must never blur candidate,
// funding, liquidity repair or reserve conversion into one ambiguous action.
requireTokens("app/components/CIOCommandCenterV351.tsx", [
  'data-cio-version="35.1"',
  'data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION"',
  "CAPITAL CLARITY",
  "BROKER USD CASH",
  "DIVIDEND CASH",
  "RESERVE ASSETS",
  "TOTAL LIQUIDITY BUFFER",
  "BUY CANDIDATE",
  "NOT FUNDED",
  "Approved Funding",
  "NOT APPROVED",
  "Approved Trim Size —",
  "LANE A · LIQUIDITY REPAIR",
  "LANE B · INVESTMENT FUNDING",
  "Broker USD Cash (default parking)",
  "SGOV/JAAA requires a separate approved BUY action",
  "DESTINATIONS · SOURCE OF TRUTH",
  "NO BROKER ACTION AUTHORIZED",
  "Sentinel does not auto-trade",
  "Trend / Flow / Location / gates",
]);

requireTokens("app/api/capital-recycling/route.ts", [
  "brokerUsdCash",
  "dividendCash",
  "reserveMarketValue",
  "reserveHoldings",
  'defaultRepairParking: "BROKER_USD_CASH"',
  "reserveConversionRequiresSeparateApprovedBuy: true",
  "liquidityRepairIsRingFenced: true",
]);

requireTokens("app/page.tsx", [
  'import CIOCommandCenterV35 from "./components/CIOCommandCenterV351"',
  "CIOCommandCenterV35",
  'data-sentinel-version="35.0"',
  'data-capital-clarity-version="35.1"',
  'data-workspace="cio-v35"',
  'data-command-steps="5"',
  "STATUS → OPPORTUNITIES → PORTFOLIO → CAPITAL → CIO DECISION",
  "Human approval remains mandatory",
]);

forbidTokens("app/page.tsx", [
  ['<MomentumForecastWorkspace scope="cio"', "CIO must not stack the standalone Forecast workspace after V35"],
  ['<ReinvestmentBuilderWorkspace', "CIO must not stack the standalone Reinvestment Builder after V35"],
  ['<ThaiMeetingTranslator', "CIO translation must be integrated through AppLang, not a duplicate workspace"],
  ['data-workspace="cio-v20"', "legacy CIO V20 must not remain the primary command workspace"],
]);

// Governance remains anchored in the existing deterministic committee engine and ledger source.
requireTokens("app/api/committee/meeting/route.ts", ["runCommitteeMeeting", "loadOpenHoldings", "portfolioSnapshot", "proposals"]);
requireTokens("app/components/MeetingPlanApprovalPanel.tsx", ["PLAN_APPROVAL", "humanApproved", "does not place a broker order"]);
requireTokens("app/components/MeetingApprovalPanel.tsx", ["RECONCILE_EXISTING", "does not create another trade"]);
requireTokens("lib/portfolioSource.ts", ["live_holdings_ledger"]);

if (failures.length) {
  console.error(`CIO V35.1 validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("CIO V35.1 validation PASSED");
