import fs from "node:fs";
import path from "node:path";

const requiredFiles = [
  "app/page.tsx",
  "app/institutional-shell.css",
  "app/components/InstitutionalShell.tsx",
  "app/components/ExecutiveDashboard.tsx",
  // These four are not mounted by the V12/V13 shell. They are still required
  // to exist — retiring them is an open decision, not one this script makes —
  // but their internal structure no longer gates the build.
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

// The page mounts workspace components, which mount the operational panels one
// level down. Checking page.tsx alone reports a panel as missing when it is
// simply no longer a direct child — so walk the live tree the page actually
// reaches and assert against that.
function liveTree(entry) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const src = read(file);
    const re = /from\s+"(\.[^"]+)"/g;
    let m;
    while ((m = re.exec(src))) {
      const base = file.slice(0, file.lastIndexOf("/"));
      for (const ext of [".tsx", ".ts"]) {
        const candidate = path.normalize(base + "/" + m[1] + ext);
        if (fs.existsSync(candidate)) { walk(candidate); break; }
      }
    }
  };
  walk(entry);
  return [...seen];
}
const live = liveTree("app/page.tsx");
const liveSource = live.map(read).join("\n");
const liveNames = live.map((f) => f.slice(f.lastIndexOf("/") + 1).replace(/\.tsx?$/, ""));

requireAll("app/page.tsx", [
  'data-source-of-truth="portfolio-ledger"',
  'section === "home"',
  'section === "command"',
  'section === "portfolio"',
  'section === "analyze"',
  'section === "research"',
  "ExecutiveDashboard",
]);

// Operational panels: mounted somewhere in the live tree, not necessarily on
// the page itself.
for (const component of ["PortfolioTruthSummary", "PortfolioTransactionOverride", "HoldingsMarketMonitor", "PortfolioLedgerPanel", "HoldingTransactionForm"]) {
  if (!liveNames.includes(component)) failures.push(`${component} is not reachable from app/page.tsx`);
}

// Every workspace section must render something. CIO is V35; portfolio and
// research retain their current workspace markers.
for (const workspace of ["cio-v35", "portfolio-v13", "research-v14"]) {
  if (!liveSource.includes(`data-workspace="${workspace}"`)) failures.push(`workspace marker missing: ${workspace}`);
}

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
  // Cash Buffer is one policy sleeve; its USD and reserve components remain
  // visible so an internal SGOV conversion is never mistaken for new capital.
  "Total Cash Buffer",
  "Broker USD Cash",
  "Reserve Holdings",
  "Deployable Buffer",
  "Liquidity",
  "Portfolio Health",
  "CIO Executive Brief",
  "function Gauge",
  "function WorkspaceCard",
]);

// Governance is now surfaced by CIOCommandCenterV35; legacy committee files
// remain on disk for audit/rollback but no longer define the primary workspace.
const approvalPath = read("app/components/MeetingApprovalPanel.tsx") + read("app/api/committee/minutes/route.ts");
for (const contract of ["humanApproved: true", "humanApproved !== true", "approvedBy is required", '"APPROVED"', '"AMENDED"', '"REJECTED"']) {
  if (!approvalPath.includes(contract)) failures.push(`human-approval contract missing from the live approval path: ${contract}`);
}

requireAll("app/components/HoldingTransactionForm.tsx", [
  'type Action = "buy" | "sell"',
  'fetch("/api/portfolio"',
  "Record a buy or sell transaction",
  "Add holding",
  "Record sale",
]);

requireAll("app/components/PortfolioTransactionOverride.tsx", ["HoldingTransactionForm", "Buy / Sell Transaction"]);
// The operating UI intentionally shows a compact recent-history window. Keep
// the validator aligned with that product contract rather than pinning the old
// 100-row request forever.
requireAll("app/components/PortfolioLedgerPanel.tsx", ["/api/portfolio/transactions?limit=20", "Ledger & Portfolio Integrity", "Realized P/L"]);
requireAll("app/api/portfolio/rebalance-execution/route.ts", ["humanApproved", "reserveTicker", "packageId"]);

requireAll("app/institutional-shell.css", [
  ".dashboard-kpis",
  ".dashboard-grid-primary",
  ".workspace-launch-grid",
  ".pro-gauge",
  ".portfolio-operations-grid",
  "@media(max-width:720px)",
]);

if (failures.length) {
  console.error("Sentinel workspace validation failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel workspace architecture, holdings operations and governed execution: PASS");
