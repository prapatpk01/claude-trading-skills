import fs from "node:fs";

const requiredFiles = [
  "app/api/v10/cio/route.ts",
  "app/components/AICioPanel.tsx",
  "app/components/InvestmentCommitteeCycle.tsx",
  "app/components/InvestmentCommitteeCycle.module.css",
  "app/api/macro/intelligence/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/api/system/health/route.ts",
];

const failures = [];
for (const file of requiredFiles) if (!fs.existsSync(file)) failures.push(`Missing ${file}`);

const cio = fs.existsSync("app/api/v10/cio/route.ts") ? fs.readFileSync("app/api/v10/cio/route.ts", "utf8") : "";
for (const contract of ["automaticExecution: false","humanApprovalRequired: true","evidenceFirst: true","auditTrailRequired: true"]) {
  if (!cio.includes(contract)) failures.push(`AI CIO contract missing: ${contract}`);
}

const page = fs.existsSync("app/page.tsx") ? fs.readFileSync("app/page.tsx", "utf8") : "";
const meeting = fs.existsSync("app/components/InvestmentCommitteeCycle.tsx") ? fs.readFileSync("app/components/InvestmentCommitteeCycle.tsx", "utf8") : "";
if (!page.includes("AICioPanel")) failures.push("AI CIO panel is not connected to the command center");
if (!page.includes("InvestmentCommitteeCycle")) failures.push("Investment Committee workflow is not connected to the portfolio workspace");
if (!page.includes("v10.3")) failures.push("v10.3 branding is missing");
if (!page.includes("data-source-of-truth=\"ledger\"")) failures.push("Ledger single-source marker is missing");
if (!page.includes("Institutional AI Investment Operating System")) failures.push("Institutional operating-system branding is missing");
for (const marker of ["PENDING_HUMAN","Approve & record transaction","/api/portfolio","sentinel:portfolio-updated","Create trade tickets"]) {
  if (!meeting.includes(marker)) failures.push(`Committee execution contract missing: ${marker}`);
}
if (!page.includes("onExecuted={refreshPortfolio}")) failures.push("Portfolio refresh is not connected to committee execution");
if (!page.includes("refreshKey={portfolioRefresh}")) failures.push("Ledger and portfolio truth refresh contract is missing");

if (failures.length) {
  console.error("Sentinel v10.3 validation failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel Investment OS v10.3 committee-to-ledger contracts: PASS");
