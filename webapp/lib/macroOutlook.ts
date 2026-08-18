import { dailyCandles } from "./marketData";
import type { Candle } from "./types";
import { buildDeploymentRegime, type DeploymentRegime } from "./deploymentRegime";
import { buildMarketLeadershipMap } from "./research/marketLeadership";

export interface MacroHeadline { title: string; date: string; source: string }
export interface MacroScenario { name: string; nameTh: string; probability: number; thesis: string; thesisTh: string }
export interface MacroOutlook {
  asOf: string;
  score: number;
  regime: string;
  regimeTh: string;
  vision: string;
  visionTh: string;
  /** Authoritative capital budget from the blended CIO Deployment Regime. */
  riskBudgetPct: number;
  /** Authoritative minimum Cash Buffer from the blended CIO Deployment Regime. */
  cashFloorPct: number;
  deployment: DeploymentRegime;
  marketTape: { score: number; label: string; labelTh: string; asOf: string | null };
  indicators: Record<string, number | null>;
  scenarios: MacroScenario[];
  headlines: MacroHeadline[];
  allocationTilt: string[];
  allocationTiltTh: string[];
  warnings: string[];
}

const ret = (c: Candle[], n: number): number | null => {
  if (c.length <= n) return null;
  const a = c[c.length - 1 - n]?.close;
  const b = c[c.length - 1]?.close;
  return a && b ? ((b / a) - 1) * 100 : null;
};
const last = (c: Candle[]) => c[c.length - 1]?.close ?? null;
const avg = (xs: number[]) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

async function blsSeries() {
  const end = new Date().getUTCFullYear();
  const start = end - 2;
  const r = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seriesid: ["CUUR0000SA0", "LNS14000000", "CES0000000001"], startyear: String(start), endyear: String(end) }),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`BLS ${r.status}`);
  const j = await r.json();
  const map = new Map<string, any[]>((j.Results?.series ?? []).map((s:any)=>[s.seriesID, s.data ?? []]));
  const cpi = map.get("CUUR0000SA0") ?? [];
  const unemployment = map.get("LNS14000000") ?? [];
  const payrolls = map.get("CES0000000001") ?? [];
  const newest = (a:any[]) => a.find((x:any)=>/^M\d\d$/.test(x.period));
  const c0 = newest(cpi);
  const yearAgo = c0 ? cpi.find((x:any)=>x.year === String(Number(c0.year)-1) && x.period === c0.period) : null;
  const cpiYoY = c0 && yearAgo ? (Number(c0.value)/Number(yearAgo.value)-1)*100 : null;
  const u0 = newest(unemployment);
  const p0 = newest(payrolls);
  const p1 = p0 ? payrolls.find((x:any)=>!(x.year===p0.year && x.period===p0.period) && /^M\d\d$/.test(x.period)) : null;
  return {
    cpiYoY: Number.isFinite(cpiYoY) ? cpiYoY : null,
    unemployment: u0 ? Number(u0.value) : null,
    payrollChangeK: p0 && p1 ? Number(p0.value)-Number(p1.value) : null,
  };
}

async function fedHeadlines(): Promise<MacroHeadline[]> {
  const r = await fetch("https://www.federalreserve.gov/feeds/press_monetary.xml", { cache: "no-store", headers: { "User-Agent": "Sentinel-Capital/1.0" } });
  if (!r.ok) throw new Error(`Fed RSS ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8);
  const clean = (s:string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g,"&").trim();
  return items.map((m) => {
    const x = m[1];
    const title = clean(x.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "Federal Reserve update");
    const rawDate = clean(x.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const d = rawDate ? new Date(rawDate) : null;
    return { title, date: d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0,10) : rawDate, source: "Federal Reserve" };
  });
}

export async function buildMacroOutlook(): Promise<MacroOutlook> {
  const warnings: string[] = [];
  const symbols = ["SPY", "QQQ", "IWM", "HYG", "TLT", "GLD", "UUP"];
  const leadershipPromise = buildMarketLeadershipMap().catch((e: any) => {
    warnings.push(`Market tape: ${e?.message ?? "failed"}`);
    return null;
  });
  const entries = await Promise.all(symbols.map(async s => [s, await dailyCandles(s, 180).catch(e => { warnings.push(`${s}: ${e?.message ?? "failed"}`); return [] as Candle[]; })] as const));
  const m = new Map(entries);
  const spy = m.get("SPY") ?? [], qqq = m.get("QQQ") ?? [], iwm = m.get("IWM") ?? [], hyg = m.get("HYG") ?? [], tlt = m.get("TLT") ?? [], gld = m.get("GLD") ?? [], uup = m.get("UUP") ?? [];

  let econ = { cpiYoY: null as number|null, unemployment: null as number|null, payrollChangeK: null as number|null };
  let headlines: MacroHeadline[] = [];
  const leadership = await leadershipPromise;
  if (leadership?.warnings?.length) warnings.push(...leadership.warnings.map(warning => `Market tape: ${warning}`));
  try { econ = await blsSeries(); } catch (e:any) { warnings.push(`BLS: ${e?.message ?? "failed"}`); }
  try { headlines = await fedHeadlines(); } catch (e:any) { warnings.push(`Fed news: ${e?.message ?? "failed"}`); }

  const spy1m=ret(spy,21), spy3m=ret(spy,63), qqq3m=ret(qqq,63), iwm3m=ret(iwm,63), hyg3m=ret(hyg,63), tlt3m=ret(tlt,63), gld3m=ret(gld,63), usd3m=ret(uup,63);
  let score = 50;
  if ((spy1m ?? 0) > 0) score += 8; else score -= 8;
  if ((spy3m ?? 0) > 5) score += 10; else if ((spy3m ?? 0) < -5) score -= 12;
  if ((qqq3m ?? -99) > (spy3m ?? 0)) score += 4;
  if ((iwm3m ?? -99) > (spy3m ?? 0)) score += 6; else score -= 3;
  if ((hyg3m ?? 0) > 0) score += 8; else score -= 10;
  if ((tlt3m ?? 0) > 4) score += 3;
  if ((usd3m ?? 0) > 5) score -= 4;
  if (econ.cpiYoY != null) { if (econ.cpiYoY <= 3) score += 6; else if (econ.cpiYoY >= 4) score -= 8; }
  if (econ.unemployment != null) { if (econ.unemployment <= 4.5) score += 4; else if (econ.unemployment >= 5.2) score -= 10; }
  if (econ.payrollChangeK != null) { if (econ.payrollChangeK > 100) score += 4; else if (econ.payrollChangeK < 0) score -= 8; }
  score = Math.round(clamp(score, 0, 100));

  // Macro remains a 3–6 month economic/asset-allocation read. It no longer owns
  // sizing or the Cash Floor. Those controls belong exclusively to deployment.
  const regime = score >= 72 ? "Risk-On / Expansion" : score >= 55 ? "Constructive / Selective" : score >= 38 ? "Late-cycle / Defensive" : "Risk-Off / Capital Preservation";
  const regimeTh = score >= 72 ? "Risk-On / เศรษฐกิจและตลาดขยายตัว" : score >= 55 ? "เชิงบวกแต่ต้องคัดเลือก" : score >= 38 ? "ปลายวัฏจักร / เน้นป้องกัน" : "Risk-Off / รักษาเงินทุน";
  const deployment = buildDeploymentRegime({ macroScore: score, tapeScore: leadership?.sentimentScore ?? 50, spy });
  const riskBudgetPct = deployment.riskBudgetPct;
  const cashFloorPct = deployment.cashFloorPct;

  const growthLead = (qqq3m ?? 0) - (spy3m ?? 0);
  const breadth = (iwm3m ?? 0) - (spy3m ?? 0);
  const credit = hyg3m ?? 0;
  const inflation = econ.cpiYoY;
  const vision = score >= 72
    ? "The base case is continued earnings-led risk appetite over the next 3–6 months. Leadership can remain concentrated, but improving small-cap breadth and firm credit would confirm a healthier expansion. Add selectively on valuation and catalyst discipline rather than chasing vertical moves."
    : score >= 55
      ? "The next 3–6 months favor selective risk-taking rather than broad beta. Maintain exposure to durable growth and income, demand stronger valuation support for new positions, and keep cash available for volatility-driven entries."
      : score >= 38
        ? "The 3–6 month outlook is two-sided: slower growth, sticky inflation or weaker credit can pressure multiples. Favor quality cash flow, dividends, defense and shorter-duration exposure while requiring a high replacement-alpha hurdle."
        : "The priority for the next 3–6 months is capital preservation. Reduce gross deployment, raise cash, avoid fragile high-beta setups and wait for credit, breadth and trend confirmation before rebuilding risk."
  const visionTh = score >= 72
    ? "กรณีฐานในช่วง 3–6 เดือนข้างหน้าคือความต้องการรับความเสี่ยงที่ยังได้รับแรงหนุนจากกำไรบริษัท ตลาดอาจยังนำโดยหุ้นบางกลุ่ม แต่หาก Small Cap และ Credit แข็งแรงขึ้นจะยืนยันว่าการขยายตัวมีคุณภาพ ควรเพิ่มลงทุนแบบเลือกจังหวะจาก Valuation และ Catalyst ไม่ไล่ราคาที่ขึ้นแรงเกินไป"
    : score >= 55
      ? "ช่วง 3–6 เดือนข้างหน้าเหมาะกับการรับความเสี่ยงแบบคัดเลือก มากกว่าซื้อทั้งตลาด ควรรักษาหุ้น Growth คุณภาพและ Income ที่ยั่งยืน ใช้เกณฑ์ Valuation เข้มขึ้นสำหรับหุ้นใหม่ และถือเงินสดเพื่อรอซื้อเมื่อเกิดความผันผวน"
      : score >= 38
        ? "แนวโน้ม 3–6 เดือนมีความไม่แน่นอนสองด้าน หากเศรษฐกิจชะลอ เงินเฟ้อยังสูง หรือ Credit อ่อนตัว อาจกดดัน Valuation ควรเน้นกระแสเงินสดคุณภาพ หุ้นปันผล กลุ่มป้องกัน และกำหนดเกณฑ์ Replacement Alpha ที่สูง"
        : "เป้าหมายหลักในช่วง 3–6 เดือนคือรักษาเงินทุน ลดการใช้ความเสี่ยง เพิ่มเงินสด หลีกเลี่ยงหุ้น High Beta ที่เปราะบาง และรอให้ Credit, Market Breadth และแนวโน้มราคากลับมายืนยันก่อนเพิ่มน้ำหนักลงทุน"

  const bull = clamp(Math.round(25 + score * .35), 20, 55);
  const bear = clamp(Math.round(45 - score * .3), 15, 45);
  const base = 100 - bull - bear;
  const scenarios: MacroScenario[] = [
    { name:"Bull", nameTh:"กรณีบวก", probability:bull, thesis:"Inflation cools, earnings stay resilient and market breadth improves; cyclicals and growth leadership broaden.", thesisTh:"เงินเฟ้อลดลง กำไรบริษัทแข็งแรง และ Market Breadth ดีขึ้น ทำให้หุ้นวัฏจักรและ Growth ขยายวงกว้าง" },
    { name:"Base", nameTh:"กรณีฐาน", probability:base, thesis:"Growth slows but avoids recession; returns depend on earnings quality, valuation and stock selection.", thesisTh:"เศรษฐกิจชะลอแต่ไม่เข้าสู่ภาวะถดถอย ผลตอบแทนขึ้นกับคุณภาพกำไร Valuation และการเลือกหุ้น" },
    { name:"Bear", nameTh:"กรณีลบ", probability:bear, thesis:"Sticky inflation, weaker labor or credit stress compresses multiples and raises the value of cash and defense.", thesisTh:"เงินเฟ้อเหนียว ตลาดแรงงานอ่อนตัว หรือเกิดความตึงตัวใน Credit ทำให้ Multiple ลดลงและเพิ่มคุณค่าของเงินสดกับหุ้นป้องกัน" },
  ];

  const allocationTilt = score >= 72 ? ["Overweight quality growth and profitable momentum", "Add cyclical exposure only with breadth confirmation", "Keep a minimum cash reserve for pullbacks"] : score >= 55 ? ["Balance growth with durable income", "Prefer idiosyncratic catalysts over broad beta", "Use staggered entries and valuation caps"] : ["Overweight quality, income and defense", "Underweight fragile high-beta and weak balance sheets", "Raise cash and require stronger replacement alpha"];
  const allocationTiltTh = score >= 72 ? ["เพิ่มน้ำหนัก Quality Growth และ Momentum ที่มีกำไร", "เพิ่มหุ้นวัฏจักรเมื่อ Market Breadth ยืนยัน", "รักษาเงินสดขั้นต่ำเพื่อรอซื้อช่วงย่อ"] : score >= 55 ? ["สมดุล Growth กับรายได้ปันผลที่ยั่งยืน", "เน้น Catalyst เฉพาะบริษัทมากกว่าซื้อ Beta ทั้งตลาด", "ทยอยเข้าซื้อและตั้งเพดาน Valuation"] : ["เพิ่มน้ำหนัก Quality, Income และ Defensive", "ลดหุ้น High Beta ที่เปราะบางและงบดุลอ่อน", "เพิ่มเงินสดและใช้เกณฑ์ Replacement Alpha ที่สูงขึ้น"];

  return {
    asOf:new Date().toISOString(),
    score,
    regime,
    regimeTh,
    vision,
    visionTh,
    riskBudgetPct,
    cashFloorPct,
    deployment,
    marketTape: {
      score: leadership?.sentimentScore ?? 50,
      label: leadership?.sentimentLabel ?? "SELECTIVE",
      labelTh: leadership?.sentimentLabelTh ?? "เลือกกลุ่ม/เลือกหุ้น",
      asOf: leadership?.asOf ?? null,
    },
    indicators:{ spy1m, spy3m, qqq3m, iwm3m, hyg3m, tlt3m, gld3m, usd3m, cpiYoY:econ.cpiYoY, unemployment:econ.unemployment, payrollChangeK:econ.payrollChangeK, spy:last(spy), breadth, growthLead, credit, inflation, compositeTrend:avg([spy1m,spy3m,qqq3m,iwm3m,hyg3m].filter((x):x is number=>x!=null)) },
    scenarios,
    headlines,
    allocationTilt,
    allocationTiltTh,
    warnings,
  };
}
