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

requireTokens("app/components/CIOCommandCenterV35.tsx", [
  'data-cio-version="35.0"',
  'data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION"',
  '"status"', '"opportunities"', '"portfolio"', '"capital"', '"decision"',
  "/api/committee/meeting",
  "/api/capital-recycling",
  "/api/holding-market",
  "MeetingPlanApprovalPanel",
  "MeetingApprovalPanel",
  "NO SALE REQUIRED",
  "Cash Buffer Excess",
  "Approved TRIM if required",
  "Executed SELL only",
  "Sentinel does not auto-trade",
  "Research upside",
  "Forecast 20–60D",
  "Trend / Flow / Location / gates",
  "Governance, risk register & committee evidence",
]);

requireTokens("app/page.tsx", [
  "CIOCommandCenterV35",
  'data-sentinel-version="35.0"',
  'data-workspace="cio-v35"',
  'data-command-steps="5"',
  "STATUS → OPPORTUNITIES → PORTFOLIO → CAPITAL → CIO DECISION",
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
  console.error(`CIO V35 validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("CIO V35 validation PASSED");
