import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const requiredFiles = [
  "lib/institutional/v7.ts",
  "lib/institutional/v8.ts",
  "app/api/v7/health/route.ts",
  "app/api/v7/committee/route.ts",
  "app/api/v8/health/route.ts",
  "app/api/watchlist/route.ts",
  "app/api/scan/route.ts",
  "lib/team/roster.ts",
  "supabase/schema.sql",
];

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required file: ${file}`);
}

function requireText(file, fragments) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, "utf8");
  for (const fragment of fragments) {
    if (!text.includes(fragment)) failures.push(`${file} missing v8 control: ${fragment}`);
  }
}

requireText("lib/institutional/v8.ts", [
  "SENTINEL_RELEASE",
  "Sentinel-v8.0",
  "DataClassification",
  "REPORTED",
  "CALCULATED",
  "PROJECTED",
  "ESTIMATED",
  "validateDataPoints",
  "STALE_CRITICAL_DATA",
  "SOURCE_CONFLICT",
  "validateMacroHorizon",
  "SCENARIO_PROBABILITY",
  "DecisionStage",
  "runV8ReleaseSelfTest",
  "humanApprovalRequired",
]);

requireText("app/api/v8/health/route.ts", [
  "runV8ReleaseSelfTest",
  "productionReady: false",
  "humanApprovalRequired: true",
  "Cache-Control",
]);

requireText("lib/institutional/v7.ts", [
  "runInstitutionalCommittee",
  "LIQUIDITY_FLOOR",
  "POSITION_CAP",
  "INCOMPLETE_COMMITTEE",
  "BROKEN_LINEAGE",
]);

requireText("supabase/schema.sql", [
  "institutional_decisions",
  "human_approved",
  "execution_status",
  "portfolio_context",
  "dissent",
]);

if (failures.length) {
  console.error("Sentinel v8 institutional validation FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Sentinel v8 institutional validation PASSED");
console.log(`Validated ${requiredFiles.length} critical files and v7/v8 governance controls.`);
