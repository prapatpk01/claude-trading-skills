import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("app/components/CIOCommandCenterV12.tsx",[
 "data-cio-version=\"12.4\"",
 "Executive Investment Committee Workspace",
 "Full Meeting",
 "Macro Strategy",
 "Portfolio Review",
 "Research Candidates",
 "Capital Allocation",
 "Risk & Valuation",
 "Voting & Resolution",
 "Decision History",
 "Fund Snapshot + Portfolio Ledger + Analyze Action Queue",
 "NO AUTO EXECUTION",
 "HUMAN APPROVAL",
 "/api/portfolio",
 "/api/analysis/actions",
 "/api/analysis/performance",
 "Open Holdings Workspace",
 "Open Research",
 "Open Stock Analyze",
]);
requireTokens("app/page.tsx",[
 "CIOCommandCenterV12",
 "data-sentinel-version=\"12.4\"",
 "section === \"command\"",
]);

if(failures.length){console.error(`CIO v12.4 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel CIO Command Center v12.4 validation PASSED");
