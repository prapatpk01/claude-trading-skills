import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const requireTokens = (file, tokens) => {
  let source = "";
  try { source = read(file); }
  catch { failures.push(`${file}: missing file`); return; }
  for (const token of tokens) if (!source.includes(token)) failures.push(`${file}: missing ${token}`);
};

// V13 introduced the feedback loop. The live Watchlist is now V14.2 and stores
// its promotion state through /api/watchlist rather than the retired V13
// component. Validate the current workflow, not the superseded component name.
requireTokens("app/page.tsx", [
  'data-sentinel-version="20.0"',
  "PortfolioPerformanceV13",
  "WatchlistIntelligenceV14",
  "CIOCommandCenterV20",
]);
requireTokens("app/components/PortfolioPerformanceV13.tsx", [
  'data-performance-version="13.0"',
  "NO SYNTHETIC HISTORY",
  "Top contributors",
  "Position weights",
  "Sharpe, Sortino, alpha, beta, drawdown",
]);
requireTokens("app/components/WatchlistIntelligenceV14.tsx", [
  'data-watchlist-version="14.2"',
  '"RESEARCH"',
  '"READY"',
  '"COMMITTEE"',
  '"PROMOTED"',
  "Promote to",
  "Analyze",
  "/api/watchlist",
  "Nothing is auto-promoted or auto-bought",
]);
requireTokens("app/components/CIOCommandCenterV20.tsx", [
  'data-cio-version="20.0"',
  "/api/committee/meeting",
  "MeetingApprovalPanel",
  "ONE ACTION LIST",
  "HUMAN APPROVAL REQUIRED",
]);
requireTokens("app/api/committee/minutes/route.ts", [
  "humanApproved !== true",
  "approvedBy is required",
  "execute_portfolio_trade",
]);
requireTokens("supabase/sentinel_v13.sql", [
  "portfolio_nav_history",
  "watchlist_events",
  "committee_decision_memory",
  "fund_operating_timeline",
]);

if (failures.length) {
  console.error(`Sentinel feedback-loop validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Sentinel V20 feedback loop and governed execution validation PASSED");
