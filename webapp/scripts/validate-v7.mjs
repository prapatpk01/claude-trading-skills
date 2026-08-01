import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "lib/institutional/v7.ts",
  "app/api/v7/health/route.ts",
  "app/api/v7/committee/route.ts",
  "app/api/watchlist/route.ts",
  "app/api/scan/route.ts",
  "lib/team/roster.ts",
  "supabase/schema.sql",
];

const failures = [];
for (const file of requiredFiles) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) failures.push(`Missing required file: ${file}`);
}

function requireText(file, fragments) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, "utf8");
  for (const fragment of fragments) {
    if (!text.includes(fragment)) failures.push(`${file} missing institutional control: ${fragment}`);
  }
}

requireText("lib/institutional/v7.ts", [
  "validateEvidence",
  "runInstitutionalCommittee",
  "STALE_CRITICAL_EVIDENCE",
  "LIQUIDITY_FLOOR",
  "POSITION_CAP",
  "INCOMPLETE_COMMITTEE",
  "BROKEN_LINEAGE",
  "rulesVersion: \"Sentinel-v7.0\"",
]);

requireText("app/api/v7/health/route.ts", [
  "runV7SelfTest",
  "evidenceLineage",
  "deskVetoes",
  "humanApprovalRequired",
  "Cache-Control",
]);

requireText("app/api/v7/committee/route.ts", [
  "runInstitutionalCommittee",
  "institutional_decisions",
  "persistenceWarning",
  "Cache-Control",
]);

requireText("supabase/schema.sql", [
  "institutional_decisions",
  "human_approved",
  "execution_status",
  "portfolio_context",
  "dissent",
]);

requireText("app/api/watchlist/route.ts", ["upsert", "source", "entry_price", "stop_price", "target_price"]);
requireText("app/api/scan/route.ts", ["momentum", "dividend", "thematic"]);

if (failures.length) {
  console.error("Sentinel v7 institutional validation FAILED");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Sentinel v7 institutional validation PASSED");
console.log(`Validated ${requiredFiles.length} critical files and governance controls.`);
