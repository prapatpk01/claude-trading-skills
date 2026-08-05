import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const requireTokens=(file,tokens)=>{const source=read(file);for(const token of tokens)if(!source.includes(token))failures.push(`${file}: missing ${token}`)};

requireTokens("app/page.tsx",[
  'data-sentinel-version=',
  "PortfolioPerformanceV13",
  "WatchlistIntelligenceV13",
  "CIOScenarioLabV13",
  ]);
requireTokens("app/components/PortfolioPerformanceV13.tsx",[
  'data-performance-version="13.0"',
  "NO SYNTHETIC HISTORY",
  "Top contributors",
  "Position weights",
  "Sharpe, Sortino, alpha, beta, drawdown"
]);
requireTokens("app/components/WatchlistIntelligenceV13.tsx",[
  'data-watchlist-version="13.0"',
  "PROMOTE",
  "RISK REVIEW",
  "Open Analyze",
  "/api/analyze/actions"
]);
requireTokens("app/components/CIOScenarioLabV13.tsx",[
  'data-cio-scenario-version=',
  "WHAT-IF PORTFOLIO LAB",
  "NO AUTO EXECUTION",
  "Current weight",
  "After weight"
]);
requireTokens("supabase/sentinel_v13.sql",[
  "portfolio_nav_history",
  "watchlist_events",
  "committee_decision_memory",
  "fund_operating_timeline"
]);

if(failures.length){console.error(`Sentinel v13 validation FAILED (${failures.length})`);for(const failure of failures)console.error(`- ${failure}`);process.exit(1)}
console.log("Sentinel v13 feedback-loop architecture validation PASSED");
