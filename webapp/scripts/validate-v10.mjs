import fs from "node:fs";

const requiredFiles = [
  "app/page.tsx",
  "app/institutional-shell.css",
  "app/components/InstitutionalShell.tsx",
  "app/components/ExecutiveDashboard.tsx",
  "app/components/CommandCenterV10.tsx",
  "app/components/EndToEndInvestmentCommittee.tsx",
  "app/components/ResearchTabV2.tsx",
  "app/components/AlphaDiscoveryPlatform.tsx",
  "app/components/PortfolioTruthSummary.tsx",
  "app/components/HoldingsMarketMonitor.tsx",
  "app/components/PortfolioTransactionOverride.tsx",
  "app/components/HoldingTransactionForm.tsx",
  "app/components/PortfolioLedgerPanel.tsx",
  "app/api/v10/cio/route.ts",
  "app/api/portfolio/rebalance-execution/route.ts",
  "app/api/portfolio/transactions/route.ts",
  "app/api/portfolio/integrity/route.ts",
];

const failures = [];
const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "");

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`Missing ${file}`);
}

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

requireAll("app/page.tsx", [
  'data-sentinel-version="11.0"',
  'data-architecture="workspace-separated"',
  'data-source-of-truth="portfolio-ledger"',
  'section === "home"',
  'section === "command"',
  'section === "portfolio"',
  'section === "analyze"',
  'section === "research"',
  "ExecutiveDashboard",
  "CommandCenterV10",
  "EndToEndInvestmentCommittee",
  "PortfolioTruthSummary",
  "PortfolioTransactionOverride",
  "HoldingsMarketMonitor",
  "PortfolioLedgerPanel",
  "ResearchTabV2",
  "AlphaDiscoveryPlatform",
  'data-workspace="cio-command-center"',
  'data-workspace="portfolio-management"',
  'data-workspace="stock-analysis"',
  'data-workspace="research-lab"',
]);

requireAll("app/components/InstitutionalShell.tsx", [
  '"home" | "command" | "portfolio" | "analyze" | "research"',
  "CIO Command Center",
  "Portfolio Management",
  "Stock Analysis",
  "Research Lab",
  "ResearchWorkflow",
]);

requireAll("app/components/ExecutiveDashboard.tsx", [
  "Total Portfolio Value",
  "Unrealized P/L",
  "Cash & Equivalents",
  "Deployable Cash",
  "Portfolio Health",
  "Fund Operating Status",
  "CIO Executive Brief",
  "function Gauge",
  "function WorkspaceCard",
]);

requireAll("app/components/EndToEndInvestmentCommittee.tsx", [
  "Run Full Fund Meeting",
  "type CandidateStatus",
  "type HoldingReview",
  "type MeetingState",
  "function Gauge",
  "function DriverChart",
  "function RiskPanel",
  "function CapitalFlow",
  "function HoldingTable",
  "function CandidateRanking",
  "candidateMap",
  "holdingReviews",
  ".slice(0, 8)",
  '"APPROVED"',
  '"DEFERRED"',
  '"REJECTED"',
  "Select All Approved",
  "Submit Rebalance Package",
  "/api/portfolio/rebalance-execution",
  "humanApproved:true",
  "IN SGOV — NO SALE AUTHORIZED",
]);

requireAll("app/components/HoldingTransactionForm.tsx", [
  'type Action = "buy" | "sell"',
  'fetch("/api/portfolio"',
  "Record a buy or sell transaction",
  "Add holding",
  "Record sale",
]);

requireAll("app/components/PortfolioTransactionOverride.tsx", ["HoldingTransactionForm", "Buy / Sell transaction override"]);
requireAll("app/components/PortfolioLedgerPanel.tsx", ["/api/portfolio/transactions?limit=100", "Ledger & Portfolio Integrity", "Realized P/L"]);
requireAll("app/api/portfolio/rebalance-execution/route.ts", ["humanApproved", "reserveTicker", "packageId"]);

requireAll("app/institutional-shell.css", [
  ".sentinel-v11",
  ".dashboard-kpis",
  ".dashboard-grid-primary",
  ".workspace-launch-grid",
  ".pro-gauge",
  ".portfolio-operations-grid",
  "@media(max-width:720px)",
]);

if (failures.length) {
  console.error("Sentinel v11 workspace validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel Investment OS v11 workspace architecture, dark institutional UI, holdings operations and governed execution: PASS");
