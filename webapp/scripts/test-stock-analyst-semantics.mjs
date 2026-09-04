import fs from "node:fs";

const dashboard = fs.readFileSync(new URL("../app/components/StockAnalysisDashboardV12.tsx", import.meta.url), "utf8");
const charts = fs.readFileSync(new URL("../app/components/StockAnalysisChartsV12.tsx", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/analyze/route.ts", import.meta.url), "utf8");
const underwriting = fs.readFileSync(new URL("../lib/stockUnderwriting.ts", import.meta.url), "utf8");
const failures=[];
const check=(ok,msg)=>{if(!ok)failures.push(msg)};
check(!dashboard.includes("Number.isFinite(Number(v))"),"dashboard must not coerce null with Number(null)");
check(!charts.includes("Number.isFinite(Number(value))"),"charts must not coerce null with Number(null)");
check(route.includes("result.executionBlocked = true"),"route must separate execution blocking from analytical evidence");
check(!route.includes("result.targetPrice = null;"),"evidence block must not erase a measured target price");
check(underwriting.includes('version:"12.3-institutional-equity-research"'),"underwriting must expose v12.3 semantics");
check(underwriting.includes('dcfInputsReady?"MODEL_AVAILABLE":"INSUFFICIENT_INPUTS"'),"DCF model must require measured inputs");
check(underwriting.includes("const sensitivity=dcfInputsReady?"),"DCF sensitivity must not synthesize an unavailable grid");
check(dashboard.includes("Peer pool share"),"competitor share must be labelled as peer-pool share, not market share");
check(charts.includes("No synthetic zero series is drawn"),"empty charts must explicitly avoid zero-series substitution");
if(failures.length){console.error(`Stock Analyst semantics FAILED (${failures.length})`);failures.forEach(x=>console.error(`- ${x}`));process.exit(1)}
console.log("Stock Analyst v12.3 missing-value, valuation-preservation and chart-semantics regression: PASS");
