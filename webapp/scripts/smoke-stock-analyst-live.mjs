const base = String(process.env.STOCK_ANALYST_BASE_URL || process.argv[2] || "http://127.0.0.1:3000").replace(/\/$/, "");
const tickers = String(process.env.STOCK_ANALYST_TICKERS || "NVDA,AVGO,AMD,TSM").split(",").map(x => x.trim().toUpperCase()).filter(Boolean);
const failures = [];
const results = [];
const finite = value => typeof value === "number" && Number.isFinite(value);
const close = (a,b,tolerance=.03) => Math.abs(a-b) <= Math.max(tolerance, Math.abs(b)*0.001);

async function analyze(ticker){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 95_000);
  try {
    const response = await fetch(`${base}/api/analyze?ticker=${encodeURIComponent(ticker)}`, { headers:{accept:"application/json"}, signal:controller.signal });
    const text = await response.text();
    let body; try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(`non-JSON response: ${text.slice(0,160)}`); }
    if(!response.ok) throw new Error(`${response.status}: ${body?.error || "analysis failed"}`);
    return body;
  } finally { clearTimeout(timer); }
}

for(const ticker of tickers){
  try {
    const body = await analyze(ticker);
    const u = body?.underwriting || {};
    const valuation = u?.valuation || {};
    const governed = body?.valuationGovernance || {};
    const dcf = u?.dcf || {};
    const price = valuation.price;
    if(!finite(price) || price <= 0) failures.push(`${ticker}: current price must be a positive measured number`);
    if(u.version !== "12.3-institutional-equity-research") failures.push(`${ticker}: underwriting version is ${u.version || "missing"}, expected 12.3`);

    if(governed.decisionReady && finite(governed.fairValue) && governed.fairValue > 0){
      if(!finite(valuation.fairValue) || !close(valuation.fairValue, governed.fairValue)) failures.push(`${ticker}: underwriting fair value ${valuation.fairValue} does not preserve governed ${governed.fairValue}`);
      if(!finite(valuation.targetPrice) || valuation.targetPrice <= 0) failures.push(`${ticker}: governed valuation is ready but target price is missing/non-positive`);
      if(valuation.fairValue === 0 || valuation.targetPrice === 0) failures.push(`${ticker}: governed valuation was coerced to zero`);
    }

    if(dcf.status !== "MODEL_AVAILABLE"){
      if(Array.isArray(dcf.sensitivity) && dcf.sensitivity.length) failures.push(`${ticker}: unavailable DCF must not publish a synthetic sensitivity grid`);
    } else {
      if(!finite(dcf.waccPct) || dcf.waccPct < 4 || dcf.waccPct > 25) failures.push(`${ticker}: DCF WACC ${dcf.waccPct} is not a plausible percentage`);
      if(!finite(dcf.terminalGrowthPct) || dcf.terminalGrowthPct < 0 || dcf.terminalGrowthPct > 8) failures.push(`${ticker}: terminal growth ${dcf.terminalGrowthPct} is not a plausible percentage`);
      const sensitivityValues = (dcf.sensitivity || []).map(x=>x?.value).filter(finite);
      if(!sensitivityValues.length || sensitivityValues.every(x=>x===0)) failures.push(`${ticker}: available DCF has no measured sensitivity values`);
    }

    const rawPeers = new Map((Array.isArray(body?.research?.peers)?body.research.peers:[]).filter(p=>p&&!p.isSubject&&p.ticker).map(p=>[String(p.ticker).toUpperCase(),p]));
    for(const peer of Array.isArray(u?.competitors?.rows)?u.competitors.rows:[]){
      const raw = rawPeers.get(String(peer.ticker).toUpperCase());
      if(!raw) continue;
      if(raw.revenueTTM == null && peer.revenue !== null) failures.push(`${ticker}/${peer.ticker}: missing peer revenue became ${peer.revenue} instead of null`);
      if(raw.revenueCagrPct == null && peer.growthPct !== null) failures.push(`${ticker}/${peer.ticker}: missing peer growth became ${peer.growthPct} instead of null`);
      if(raw.netMargin == null && peer.marginPct !== null) failures.push(`${ticker}/${peer.ticker}: missing peer margin became ${peer.marginPct} instead of null`);
      if(raw.peTTM == null && peer.pe !== null) failures.push(`${ticker}/${peer.ticker}: missing peer P/E became ${peer.pe} instead of null`);
    }

    const annual = Array.isArray(u?.financial?.annual)?u.financial.annual:[];
    if(!annual.length && Array.isArray(u?.forecast?.scenarios) && u.forecast.scenarios.some(s=>(s.years||[]).some(y=>finite(y.revenue)))) failures.push(`${ticker}: forecast fabricated revenue without annual revenue evidence`);

    results.push({
      ticker,
      decision:u.decision,
      evidence:u?.evidence?.score,
      price:valuation.price,
      fairValue:valuation.fairValue,
      valuationSource:valuation.source,
      dcf:dcf.status,
      peers:Array.isArray(u?.competitors?.rows)?u.competitors.rows.length:0,
      hardBlocks:Array.isArray(u?.evidence?.hardBlocks)?u.evidence.hardBlocks.length:0,
    });
  } catch(error){
    failures.push(`${ticker}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.table(results);
if(results.length !== tickers.length) failures.push(`Only ${results.length}/${tickers.length} tickers returned a complete HTTP analysis response`);
if(failures.length){
  console.error(`\nStock Analyst live smoke FAILED (${failures.length})`);
  failures.forEach(item=>console.error(`- ${item}`));
  process.exit(1);
}
console.log(`\nStock Analyst live smoke PASSED for ${tickers.join(", ")}. Missing evidence stayed null, governed valuation stayed consistent, and DCF semantics were valid.`);
