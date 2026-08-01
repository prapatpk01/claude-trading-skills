import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const required=[
  "app/api/v9/health/route.ts",
  "app/api/macro/intelligence/route.ts",
  "app/api/macro/history/route.ts",
  "app/api/committee/audit/route.ts",
  "app/api/portfolio/integrity/route.ts",
  "app/api/portfolio/cash-buffer/route.ts",
  "app/api/portfolio/optimizer/route.ts",
  "app/api/portfolio/opportunity-allocation/route.ts",
  "app/components/V9InstitutionalStatus.tsx",
  "app/sentinel-v9.css",
];
const missing=required.filter(f=>!fs.existsSync(path.join(root,f)));
if(missing.length){console.error("V9 validation failed. Missing:",missing.join(", "));process.exit(1)}
const health=fs.readFileSync(path.join(root,"app/api/v9/health/route.ts"),"utf8");
const page=fs.readFileSync(path.join(root,"app/page.tsx"),"utf8");
const committee=fs.readFileSync(path.join(root,"app/api/committee/audit/route.ts"),"utf8");
const contracts=[
  [health.includes('automaticExecution:false'),"automatic execution must remain disabled"],
  [health.includes('version:"9.0.0"')||health.includes('version: "9.0.0"'),"v9 health version missing"],
  [page.includes("V9InstitutionalStatus"),"v9 status panel not mounted"],
  [page.includes("HUMAN OVERSIGHT"),"human oversight header missing"],
  [committee.includes("human_authorized"),"committee human authorization audit missing"],
];
const failed=contracts.filter(([ok])=>!ok).map(([,msg])=>msg);
if(failed.length){console.error("V9 validation failed:",failed.join("; "));process.exit(1)}
console.log("Sentinel Investment OS v9.0 institutional release contracts: PASS");
