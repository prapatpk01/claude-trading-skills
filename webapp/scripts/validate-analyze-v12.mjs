import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("lib/stockUnderwriting.ts",[
 "12.3-institutional-equity-research","sector:","company:","competitors:","financial:","earnings:","catalysts:","forecast:","dcf:","thesis:","exportSheets",
 "dcfInputsReady", "governedValue", "peerRevenuePool",
 'name:"Summary"','name:"Financials"','name:"Valuation"','name:"Competitors"','name:"DCF"','name:"Catalysts"','name:"Risks"'
]);
requireTokens("app/components/StockAnalysisChartsV12.tsx",[
 "COMPARATIVE VISUAL ANALYTICS","Research score comparison","Price, risk and valuation map","Annual financial trend","Eight-quarter earnings trend","Competitor growth comparison","Competitor margin comparison","Bull / Base / Bear revenue forecast","DCF sensitivity","data-analysis-charts=\"12.3\"","No synthetic zero series is drawn"
]);
requireTokens("app/components/StockAnalysisDashboardV12.tsx",[
 "data-stock-analysis-version=\"12.3\"","overview","financials","valuation","competitors","catalysts","risks","thesis","portfolio","Portfolio Fit Engine","Committee Consensus","Analysis Performance","Add Watchlist","Send to CIO Committee","Track Performance","Export Excel","Export PDF","Committee Pack","StockAnalysisChartsV12","Peer pool share","Missing data is not shown as zero"
]);
requireTokens("app/api/analyze/route.ts",["12.3-institutional-equity-research","executionBlocked = true","valuationGovernance","Measured valuation evidence is retained"]);
requireTokens("app/api/analyze/actions/route.ts",["WATCHLIST","COMMITTEE","analysis_actions"]);
requireTokens("app/api/analyze/performance/route.ts",["analysis_performance","review_30d","review_90d","review_180d","review_365d","winRatePct"]);
requireTokens("app/api/analyze/export/route.ts",["ExcelJS","workbook.addWorksheet","Content-Disposition","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
requireTokens("supabase/analysis_phase22.sql",["analysis_actions","analysis_performance","review_30d","review_365d"]);
// The mounted component is the contract. The generation number is not: pinning
// it here made this script fail on every upgrade rather than on a regression,
// and validate-v13.mjs already asserts the current value.
requireTokens("app/page.tsx",["StockAnalysisDashboardV12","data-sentinel-version="]);

if(failures.length){console.error(`Analyze v12.3 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel Analyze v12.3 data-integrity + mobile dashboard validation PASSED");
