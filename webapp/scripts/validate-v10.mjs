import fs from "node:fs";

const requiredFiles = [
  "app/api/v10/cio/route.ts",
  "app/components/AICioPanel.tsx",
  "app/components/EndToEndInvestmentCommittee.tsx",
  "app/components/CommitteeMeetingV10.tsx",
  "app/api/portfolio/rebalance-execution/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/api/system/health/route.ts",
  "app/components/AlphaDiscoveryPlatform.tsx",
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`Missing ${file}`);
}

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function requireText(file, fragments) {
  const source = read(file);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) failures.push(`${file} missing contract: ${fragment}`);
  }
}

const cio = read("app/api/v10/cio/route.ts");
for (const contract of [
  "automaticExecution: false",
  "humanApprovalRequired: true",
  "evidenceFirst: true",
  "auditTrailRequired: true",
]) {
  if (!cio.includes(contract)) failures.push(`AI CIO governance contract missing: ${contract}`);
}

requireText("app/components/EndToEndInvestmentCommittee.tsx", [
  "END-TO-END INVESTMENT COMMITTEE",
  "Run Full Fund Meeting",
  "Macro & Regime",
  "Cash / Risk Budget",
  "Holdings Review",
  "Theme / Stock Search",
  "ADD / TRIM / EXIT",
  "Funding Plan",
  "Committee Vote",
  "Execution & Minutes",
  "CommitteeMeetingV10",
]);

requireText("app/components/CommitteeMeetingV10.tsx", [
  "OPEN NEW",
  "ADD EXISTING",
  "TRIM",
  "EXIT",
  "Select All Approved",
  "Submit Rebalance Package",
  "/api/portfolio/rebalance-execution",
  "humanApproved:true",
  "Promise.allSettled",
]);

requireText("app/api/portfolio/rebalance-execution/route.ts", [
  "humanApproved",
  "reserveTicker",
  "packageId",
]);

requireText("app/components/AlphaDiscoveryPlatform.tsx", [
  "Thematic Portfolio",
  "portfolioWeightPct",
  "Build Thematic Portfolio",
]);

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
  console.error("Sentinel v10.7 end-to-end committee validation failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel Investment OS v10.7 end-to-end committee contracts: PASS");
