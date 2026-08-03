import fs from "node:fs";

const requiredFiles = [
  "app/api/v10/cio/route.ts",
  "app/components/AICioPanel.tsx",
  "app/components/EndToEndInvestmentCommittee.tsx",
  "app/api/portfolio/rebalance-execution/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/api/system/health/route.ts",
  "app/components/AlphaDiscoveryPlatform.tsx",
];

const failures = [];
for (const file of requiredFiles) if (!fs.existsSync(file)) failures.push(`Missing ${file}`);
const read = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
function requireText(file, fragments) {
  const source = read(file);
  for (const fragment of fragments) if (!source.includes(fragment)) failures.push(`${file} missing contract: ${fragment}`);
}

const cio = read("app/api/v10/cio/route.ts");
for (const contract of ["automaticExecution: false", "humanApprovalRequired: true", "evidenceFirst: true", "auditTrailRequired: true"]) {
  if (!cio.includes(contract)) failures.push(`AI CIO governance contract missing: ${contract}`);
}

requireText("app/components/EndToEndInvestmentCommittee.tsx", [
  "AI FUND OPERATING SYSTEM",
  "SINGLE MEETING STATE",
  "Run Full Fund Meeting",
  "CIO EXECUTIVE DASHBOARD",
  "Fund Health",
  "Market Opportunity",
  "Portfolio Quality",
  "Risk Control",
  "Committee Consensus",
  "MACRO DRIVER CHART",
  "CAPITAL FLOW",
  "1 · MACRO, REGIME & SENTIMENT",
  "2 · PORTFOLIO REVIEW & CAPITAL RELEASE",
  "3 · INVESTMENT STRATEGY, RESEARCH & CAPITAL ALLOCATION",
  "4 · FINAL RESOLUTION, FUNDING & EXECUTION",
  "Select All Approved",
  "Submit Rebalance Package",
  "/api/portfolio/rebalance-execution",
  "humanApproved:true",
  "KEEP ${usd(meeting.reserve)} IN SGOV — NO SALE AUTHORIZED",
]);

requireText("app/api/portfolio/rebalance-execution/route.ts", ["humanApproved", "reserveTicker", "packageId"]);
requireText("app/components/AlphaDiscoveryPlatform.tsx", ["Thematic Portfolio", "portfolioWeightPct", "Build Thematic Portfolio"]);

const page = read("app/page.tsx");
for (const marker of [
  "EndToEndInvestmentCommittee",
  "Institutional AI Investment Operating System",
  "data-source-of-truth=\"single-fund-mandate-and-ledger\"",
  "data-governance=\"end-to-end-investment-committee\"",
  "data-sentinel-version=\"10.7\"",
  "refreshKey={portfolioRefresh}",
]) {
  if (!page.includes(marker)) failures.push(`Application shell contract missing: ${marker}`);
}

if (failures.length) {
  console.error("Sentinel v10.7 institutional Fund OS validation failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}
console.log("Sentinel Investment OS v10.7 institutional gauges, charts and four-agenda meeting: PASS");
