import fs from "node:fs";

const requiredFiles = [
  "app/api/v10/cio/route.ts",
  "app/components/AICioPanel.tsx",
  "app/components/EndToEndInvestmentCommittee.tsx",
  "app/components/PortfolioTransactionOverride.tsx",
  "app/components/HoldingTransactionForm.tsx",
  "app/components/PortfolioTruthSummary.tsx",
  "app/components/PortfolioLedgerPanel.tsx",
  "app/components/HoldingsMarketMonitor.tsx",
  "app/api/portfolio/rebalance-execution/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/transactions/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/api/system/health/route.ts",
  "app/components/AlphaDiscoveryPlatform.tsx",
];

const failures = [];
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");
for (const file of requiredFiles) if (!fs.existsSync(file)) failures.push(`Missing ${file}`);

function requireAll(file, fragments) {
  const source = read(file);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${file} missing contract: ${fragment}`);
  }
}

const cio = read("app/api/v10/cio/route.ts");
for (const contract of ["automaticExecution: false", "humanApprovalRequired: true", "evidenceFirst: true", "auditTrailRequired: true"]) {
  if (!cio.includes(contract)) failures.push(`AI CIO governance contract missing: ${contract}`);
}

requireAll("app/components/EndToEndInvestmentCommittee.tsx", [
  "INSTITUTIONAL AI FUND OPERATING SYSTEM", "SINGLE MEETING STATE", "Run Full Fund Meeting", "CIO EXECUTIVE VIEW",
  "type CandidateStatus", "type HoldingReview", "type MeetingState", "function Gauge", "function DriverChart", "function RiskPanel",
  "function CapitalFlow", "function HoldingTable", "function CandidateRanking", "candidateMap", "holdingReviews", ".slice(0, 8)",
  "1 · MACRO, REGIME & SENTIMENT", "2 · PORTFOLIO, VALUATION, RISK & LIQUIDITY REVIEW",
  "3 · INVESTMENT STRATEGY, RESEARCH & CAPITAL ALLOCATION", "4 · FINAL RESOLUTION, FUNDING & EXECUTION",
  '"APPROVED"', '"DEFERRED"', '"REJECTED"', "Select All Approved", "Submit Rebalance Package",
  "/api/portfolio/rebalance-execution", "humanApproved: true", "IN SGOV — NO SALE AUTHORIZED",
]);

requireAll("app/components/PortfolioTransactionOverride.tsx", [
  'data-portfolio-operations="buy-sell-entry"', "Record Buy / Sell Transaction", "HoldingTransactionForm",
]);
requireAll("app/components/HoldingTransactionForm.tsx", [
  'type Action = "buy" | "sell"', 'fetch("/api/portfolio"', "Record a buy or sell transaction", "Record sale",
]);
requireAll("app/components/PortfolioLedgerPanel.tsx", [
  "/api/portfolio/transactions?limit=100", "Ledger & Portfolio Integrity", "BUY notional", "SELL notional",
]);
requireAll("app/api/portfolio/rebalance-execution/route.ts", ["humanApproved", "reserveTicker", "packageId"]);
requireAll("app/components/AlphaDiscoveryPlatform.tsx", ["Thematic Portfolio", "portfolioWeightPct", "Build Thematic Portfolio"]);

const page = read("app/page.tsx");
for (const marker of [
  "EndToEndInvestmentCommittee", "Institutional AI Investment Operating System",
  'data-source-of-truth="single-fund-mandate-and-ledger"', 'data-governance="end-to-end-investment-committee"',
  'data-sentinel-version="10.7"', "refreshKey={portfolioRefresh}",
  "PortfolioTruthSummary", "PortfolioTransactionOverride", "HoldingsMarketMonitor", "PortfolioLedgerPanel",
  "Portfolio Holdings, Buy/Sell entry and Trade Ledger",
]) {
  if (!page.includes(marker)) failures.push(`Application shell contract missing: ${marker}`);
}

if (failures.length) {
  console.error("Sentinel v10.7 institutional Fund OS validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel Investment OS v10.7 committee, holdings, buy/sell entry and auditable trade ledger: PASS");
