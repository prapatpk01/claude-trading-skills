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
const read=(f)=>{try{return fs.readFileSync(path.join(root,f),"utf8")}catch{return ""}};
const shell=read("app/components/CIOCommandCenterV12.tsx")+read("app/components/HoldingsDashboardV12.tsx");
const approval=read("app/components/MeetingApprovalPanel.tsx");
const minutes=read("app/api/committee/minutes/route.ts");

// The two contracts below used to assert that the v9 page layout was mounted —
// the V9InstitutionalStatus panel and a "HUMAN OVERSIGHT" header. Three UI
// generations replaced that layout, so those assertions were failing on a
// design decision rather than on a broken guarantee, and they had been keeping
// CI red before it ever reached typecheck or build.
//
// What v9 was actually protecting is that the app never executes on its own and
// says so where a person can see it. That guarantee is intact and now stronger,
// so the contracts point at where it lives rather than at where it used to be
// rendered. This deliberately does NOT decide whether V9InstitutionalStatus is
// reconnected or retired — the file check above still requires it to exist.
const contracts=[
  [health.includes('automaticExecution:false'),"automatic execution must remain disabled"],
  [health.includes('version:"9.0.0"')||health.includes('version: "9.0.0"'),"v9 health version missing"],
  // Assert the guarantee, not one generation's wording: the page must say both
  // that a human approves and that nothing executes on its own.
  [/human approval/i.test(page) && /no automatic execution|never execute|no auto execution/i.test(page),
    "the page must state that a human approves and that nothing executes automatically"],
  [shell.includes("NO AUTO EXECUTION"),"the live workspaces must carry the no-auto-execution guarantee"],
  [approval.includes("humanApproved: true")&&minutes.includes("humanApproved !== true"),
    "the ledger write path must require an explicit human approval flag"],
  [minutes.includes("approvedBy is required"),"an approval must carry the approver's name"],
  [committee.includes("human_authorized"),"committee human authorization audit missing"],
];
const failed=contracts.filter(([ok])=>!ok).map(([,msg])=>msg);
if(failed.length){console.error("V9 validation failed:",failed.join("; "));process.exit(1)}
console.log("Sentinel Investment OS v9.0 institutional release contracts: PASS");
