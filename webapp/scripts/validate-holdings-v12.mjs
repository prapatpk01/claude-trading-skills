import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("app/components/HoldingsDashboardV12.tsx",[
 "data-holdings-version=\"12.3\"","Overview","Holdings","Transactions","Cash & Income","Risk & Rebalance","PortfolioTruthSummary","PortfolioTransactionOverride","HoldingsMarketMonitor","PortfolioLedgerPanel","DividendCalendarPanel","CashLedgerPanel","CashBufferPanel","DividendLedgerPanel","PortfolioOptimizerPanel","OpportunityAllocationPanel","SINGLE SOURCE OF TRUTH"
]);
requireTokens("app/components/HoldingsMarketMonitor.tsx",[
 "holding-reconciliation","Shares","Average cost","Save corrected holding","reconciliation override","method: \"PATCH\""
]);
requireTokens("app/api/portfolio/route.ts",[
 "execute_portfolio_trade","export async function PATCH","export async function DELETE","Shares support up to 7 decimal places","split-brain portfolio"
]);
requireTokens("app/page.tsx",["HoldingsDashboardV12","data-sentinel-version=\"12.3\""]);

if(failures.length){console.error(`Holdings v12 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel Holdings v12.3 validation PASSED");
