import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const failures=[];
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("app/components/HoldingsDashboardV12.tsx",[
 "data-holdings-version=\"12.4\"","Full Workspace","Overview","Holdings","Transactions","Cash & Income","Risk & Rebalance",
 "holdings-overview","holdings-master","holdings-transactions","holdings-income","holdings-risk",
 "Verified Portfolio Overview","Holdings Master & Reconciliation","Transaction Operations & Audit Ledger","Cash, Liquidity & Income Center","Risk, Allocation & Rebalance Proposals",
 "PortfolioTruthSummary","PortfolioTransactionOverride","HoldingsMarketMonitor","PortfolioLedgerPanel","DividendCalendarPanel","CashLedgerPanel","CashBufferPanel","DividendLedgerPanel","PortfolioOptimizerPanel","OpportunityAllocationPanel","SINGLE SOURCE OF TRUTH","NO AUTO EXECUTION"
]);
// The reconciliation path is still here; the wording and the call shape moved
// (the method is now chosen at the call site rather than hard-coded), so assert
// the capability rather than the literal string a previous version used.
requireTokens("app/components/HoldingsMarketMonitor.tsx",[
 "holding-reconciliation","Shares","Average cost","Save corrected holding","reconcil","PATCH"
]);
requireTokens("app/api/portfolio/route.ts",[
 "execute_portfolio_trade","export async function PATCH","export async function DELETE","Shares support up to 7 decimal places","split-brain"
]);
// The mounted component is the contract. The generation number is not: pinning
// it here made this script fail on every upgrade rather than on a regression,
// and validate-v13.mjs already asserts the current value.
requireTokens("app/page.tsx",["HoldingsDashboardV12","data-sentinel-version="]);

if(failures.length){console.error(`Holdings v12 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel Holdings v12.4 full workspace validation PASSED");
