import fs from "node:fs";

const requiredFiles = [
  "app/api/v10/cio/route.ts",
  "app/components/AICioPanel.tsx",
  "app/api/macro/intelligence/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/api/system/health/route.ts",
];

const failures = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`Missing ${file}`);
}

const cio = fs.existsSync("app/api/v10/cio/route.ts") ? fs.readFileSync("app/api/v10/cio/route.ts", "utf8") : "";
for (const contract of ["automaticExecution: false", "humanApprovalRequired: true", "evidenceFirst: true", "auditTrailRequired: true"]) {
  if (!cio.includes(contract)) failures.push(`AI CIO contract missing: ${contract}`);
}

const page = fs.existsSync("app/page.tsx") ? fs.readFileSync("app/page.tsx", "utf8") : "";
if (!page.includes("AICioPanel")) failures.push("AI CIO panel is not connected to the command center");
if (!page.includes("v10.0")) failures.push("v10.0 branding is missing");

if (failures.length) {
  console.error("Sentinel v10 validation failed:\n" + failures.map((x) => `- ${x}`).join("\n"));
  process.exit(1);
}

console.log("Sentinel Investment OS v10.0 release contracts: PASS");
