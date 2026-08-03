import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("lib/stockUnderwriting.ts",[
 "12.1-institutional-equity-research","sector:","company:","competitors:","financial:","earnings:","catalysts:","forecast:","dcf:","thesis:","exportSheets",
 'name:"Summary"','name:"Financials"','name:"Valuation"','name:"Competitors"','name:"DCF"','name:"Catalysts"','name:"Risks"'
]);
requireTokens("app/components/StockAnalysisWorkspaceV12.tsx",[
 "A · Executive Summary","1 · Sector Overview","2 · Company Analysis","3 · Competitive Analysis","4 · Financial Analysis","5 · Earnings Analysis","6 · Catalyst Calendar","7 · Three Statement Model","8 · DCF Model","9 · Thesis Tracker","10 · Investment Conclusion","Export Excel · 7 sheets"
]);
requireTokens("app/api/analyze/export/route.ts",["ExcelJS","workbook.addWorksheet","Content-Disposition","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

if(failures.length){console.error(`Analyze v12 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel Analyze v12 institutional research validation PASSED");
