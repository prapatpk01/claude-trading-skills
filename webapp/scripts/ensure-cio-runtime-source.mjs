import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const meetingPath = path.join(root, "app/api/committee/meeting/route.ts");
const cioPath = path.join(root, "app/components/CIOCommandCenterV20.tsx");

function edit(file, transform) {
  const before = fs.readFileSync(file, "utf8");
  const after = transform(before);
  if (after !== before) fs.writeFileSync(file, after);
  return after;
}

function replaceRequired(src, from, to, label) {
  if (src.includes(to)) return src;
  if (!src.includes(from)) throw new Error(`ensure-cio-runtime-source: missing ${label}`);
  return src.replace(from, to);
}

const meeting = edit(meetingPath, (input) => {
  let src = input;

  src = replaceRequired(
    src,
    'import { runInvestmentResearchOS } from "@/lib/research/investmentDiscovery";',
    'import { runInvestmentResearchOS } from "@/lib/research/investmentDiscovery";\nimport { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";',
    "cash buffer import",
  );

  src = replaceRequired(
    src,
    '    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },\n  });',
    '    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },\n    signal: AbortSignal.timeout(8_000),\n  });',
    "internal fetch timeout",
  );

  src = src.replace(
    'new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Phase 1 exceeded its meeting time budget")), 42_000))',
    'new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Phase 1 exceeded its meeting time budget")), 18_000))',
  );
  src = src.replace(
    'setTimeout(() => reject(new Error("the sweep did not finish inside the meeting\'s time budget")), 25_000)',
    'setTimeout(() => reject(new Error("the sweep did not finish inside the meeting\'s time budget")), 12_000)',
  );

  src = replaceRequired(
    src,
    '    let buffer: any = null;\n    try { buffer = await internalJson(req, "/api/portfolio/cash-buffer"); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
    '    let buffer: any = null;\n    try { buffer = await buildCashBufferSnapshot(); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
    "direct cash buffer snapshot",
  );

  src = replaceRequired(
    src,
    '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const nav = finite(buffer?.totalNav) ?? securitiesValue + cashBalance;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? finite(buffer?.gapValue) ?? 0);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (cashBalance / nav) * 100 : null);\n    const targetCashPct = finite(buffer?.targetPct);',
    '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const reserveFallback = gathered.reduce((sum, g) => RESERVES.has(g.ticker) ? sum + (g.price ?? g.avgCost) * g.shares : sum, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const dividendAvailable = finite(buffer?.dividendAvailable) ?? 0;\n    const combinedBuffer = finite(buffer?.liquidityBuffer) ?? (cashBalance + dividendAvailable + reserveFallback);\n    const nav = finite(buffer?.totalNav) ?? securitiesValue;\n    const targetCashPct = finite(buffer?.targetPct);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (combinedBuffer / nav) * 100 : null);\n    const targetCashValue = nav > 0 && targetCashPct != null ? nav * targetCashPct / 100 : null;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? (targetCashValue == null ? 0 : combinedBuffer - targetCashValue));',
    "combined cash buffer inputs",
  );

  src = replaceRequired(
    src,
    '        sources: { navFrom: buffer ? "portfolio ledger cash-buffer" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length },',
    '        cashBuffer: { valueUsd: finite(buffer?.liquidityBuffer) ?? combinedBuffer, pct: cashBufferPct, targetPct: targetCashPct, reserveHoldings: buffer?.reserveHoldings ?? [] },\n        sources: { navFrom: buffer ? "shared cash-buffer snapshot" : "computed from holdings and prices", priced: positions.filter((p) => p.price != null).length, positions: positions.length },',
    "cash buffer response",
  );

  return src;
});

for (const marker of [
  'import { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";',
  'buffer = await buildCashBufferSnapshot()',
  'const combinedBuffer =',
  'cashBuffer: { valueUsd:',
]) {
  if (!meeting.includes(marker)) throw new Error(`ensure-cio-runtime-source: meeting verification failed: ${marker}`);
}

const cio = edit(cioPath, (input) => {
  let src = input;

  src = replaceRequired(
    src,
    '  nav: number;\n  quorum:',
    '  nav: number;\n  cashBuffer?: { valueUsd: number; pct: number | null; targetPct: number | null; reserveHoldings?: { ticker?: string; marketValue?: number }[] };\n  quorum:',
    "Meeting cashBuffer type",
  );

  src = src.replace(
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";',
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20.5";',
  );

  src = replaceRequired(
    src,
    '  const response = await fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" } });',
    '  const response = await fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });',
    "meeting client timeout",
  );

  src = replaceRequired(
    src,
    '      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime}` : "UNAVAILABLE"} note={meeting.regime ? `${meeting.regime.score}/100 · cash floor ${meeting.regime.cashMinPct}%` : "No benchmark evidence"} />\n      <Kpi label={tr(lang, "New ideas", "หุ้นใหม่ที่เสนอ")}',
    '      <Kpi label={tr(lang, "Market regime", "สภาวะตลาด")} value={meeting.regime ? `${meeting.regime.icon} ${meeting.regime.regime}` : "UNAVAILABLE"} note={meeting.regime ? `${meeting.regime.score}/100 · cash floor ${meeting.regime.cashMinPct}%` : "No benchmark evidence"} />\n      <Kpi label={tr(lang, "Cash Buffer", "เงินสำรอง Cash Buffer")} value={meeting.cashBuffer ? money(meeting.cashBuffer.valueUsd) : "—"} note={meeting.cashBuffer ? `${meeting.cashBuffer.pct == null ? "—" : meeting.cashBuffer.pct.toFixed(1) + "%"} ${tr(lang, "of portfolio", "ของพอร์ต")} · ${tr(lang, "floor", "ขั้นต่ำ")} ${(meeting.cashBuffer.targetPct ?? meeting.regime?.cashMinPct ?? 0).toFixed(1)}%${meeting.cashBuffer.reserveHoldings?.length ? ` · ${meeting.cashBuffer.reserveHoldings.map((row) => row.ticker).filter(Boolean).join("/")}` : ""}` : tr(lang, "Buffer data unavailable", "ไม่มีข้อมูล Cash Buffer")} />\n      <Kpi label={tr(lang, "New ideas", "หุ้นใหม่ที่เสนอ")}',
    "Cash Buffer KPI",
  );

  src = replaceRequired(
    src,
    '      <Kpi label={tr(lang, "Capital allocation", "แผนจัดสรรเงิน")} value={meeting.capitalPlan.allocationStatus} note={meeting.capitalPlan.allocationComplete ? `${money(meeting.capitalPlan.temporaryParkingUsd)} temporary reserve` : `${money(meeting.capitalPlan.unallocatedUsd)} has no destination`} />',
    '      <Kpi label={tr(lang, "Capital allocation", "แผนจัดสรรเงิน")} value={meeting.capitalPlan.allocationStatus} note={meeting.capitalPlan.allocationComplete ? `${tr(lang, "Temporary reserve", "เงินพักชั่วคราว")}: ${money(meeting.capitalPlan.temporaryParkingUsd)} · ${tr(lang, "Unallocated", "เงินไม่มีปลายทาง")}: ${money(meeting.capitalPlan.unallocatedUsd)}` : `${money(meeting.capitalPlan.unallocatedUsd)} ${tr(lang, "has no destination", "ยังไม่มีปลายทาง")}`} />',
    "Capital allocation KPI",
  );

  return src;
});

for (const marker of [
  'cashBuffer?: { valueUsd:',
  'sentinel:cio:frozen-meeting:v20.5',
  'label={tr(lang, "Cash Buffer", "เงินสำรอง Cash Buffer")}',
]) {
  if (!cio.includes(marker)) throw new Error(`ensure-cio-runtime-source: CIO verification failed: ${marker}`);
}

console.log("ensure-cio-runtime-source: direct Cash Buffer + SGOV reserve policy applied");
