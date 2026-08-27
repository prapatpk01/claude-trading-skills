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

// Capital Clarity V35.2 remains the live five-step presentation surface while
// V36 replaces the new-idea scoring and authority underneath it.
requireTokens("app/components/CIOCommandCenterV351.tsx", [
  'data-cio-version="35.2"',
  'data-command-architecture="STATUS-OPPORTUNITIES-PORTFOLIO-CAPITAL-DECISION"',
  "CIO MARKET BRIEF",
  "Executive Market Brief",
  "MARKET_BENCHMARKS",
  '"SPY", "QQQ", "IWM", "HYG"',
  "BREADTH",
  "MOMENTUM",
  "CIO STANCE",
  "DATA LIMITED",
  "CAPITAL CLARITY",
  "BROKER USD CASH",
  "DIVIDEND CASH",
  "RESERVE ASSETS",
  "TOTAL LIQUIDITY BUFFER",
  "BUY CANDIDATE",
  "NOT FUNDED",
  "Approved Funding",
  "NO BROKER ACTION AUTHORIZED",
  "Sentinel does not auto-trade",
]);

// V36 new-idea engine: holdings keep V34; new ideas use acceleration-aware V36.
requireTokens("lib/team/sentinelInvestmentV36.ts", [
  'SENTINEL_INVESTMENT_V36 = "36.0"',
  'label: "Trend Quality"',
  'label: "Momentum Acceleration"',
  'label: "Relative Strength"',
  'label: "Volume / Smart Flow"',
  'label: "Entry Quality"',
  'label: "Volatility / Liquidity Quality"',
  'label: "Momentum Persistence / Freshness"',
  "input.market.score * 0.25",
  "momentum.momentumScore * 0.45",
  "ownership.score * 0.20",
  "momentum.entryScore * 0.10",
  'action = "STARTER BUY"',
  'code: "CRISIS_REGIME"',
  'code: "PERSISTENT_DISTRIBUTION"',
  "High beta itself earns no points",
]);
requireTokens("lib/team/committee.ts", [
  "applyDecisionAuthorityV36",
  "allocationFor",
  "Authoritative Total Liquidity Buffer below Cash Floor",
  "sleeve drift as a regime-aware sizing/rebalance input",
]);
requireTokens("lib/team/authorityV36.ts", [
  'version: "36.0"',
  'action: "STARTER BUY"',
  "Soft timing notes remain",
  "Sleeve drift may reduce size but does not veto",
]);
requireTokens("app/api/committee/meeting/route.ts", [
  "holdingTechnicalEvidence",
  "newIdeaTechnicalEvidence",
  "buildSentinelMarketScoreV36",
  "scoreNewIdeaV36",
  "sentinelV36",
  "marketV36",
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

requireTokens("lib/release.ts", [
  'appVersion: "36.0"',
  'investmentVersion: "36.0"',
  'healthRelease: "Sentinel-Investment-OS-v36.0"',
]);
requireTokens("app/page.tsx", [
  "data-sentinel-version={SENTINEL_RELEASE.appVersion}",
  "data-investment-version={SENTINEL_RELEASE.investmentVersion}",
  'data-workspace="cio-v36"',
  'data-command-steps="5"',
  "STATUS → OPPORTUNITIES → PORTFOLIO → CAPITAL → CIO DECISION",
  "Human approval remains mandatory",
]);

forbidTokens("app/page.tsx", [
  ['<MomentumForecastWorkspace scope="cio"', "CIO must not stack the standalone Forecast workspace"],
  ['<ReinvestmentBuilderWorkspace', "CIO must not stack the standalone Reinvestment Builder"],
  ['<ThaiMeetingTranslator', "CIO translation must be integrated through AppLang, not a duplicate workspace"],
  ['data-workspace="cio-v20"', "legacy CIO V20 must not remain the primary command workspace"],
]);

// Governance remains anchored in the deterministic committee and ledger source.
requireTokens("app/components/MeetingPlanApprovalPanel.tsx", ["PLAN_APPROVAL", "humanApproved", "does not place a broker order"]);
requireTokens("app/components/MeetingApprovalPanel.tsx", ["RECONCILE_EXISTING", "does not create another trade"]);
requireTokens("lib/portfolioSource.ts", ["live_holdings_ledger"]);
requireTokens("scripts/test-sentinel-investment-v36.mjs", [
  "conviction weighting is 25/45/20/10",
  "soft block is not a CRO veto",
  "true hard block remains non-executable",
]);

if (failures.length) {
  console.error(`CIO V36 validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("CIO V36 sentiment + momentum-rising validation PASSED");
