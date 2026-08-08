import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const file = path.join(root, "app/api/committee/meeting/route.ts");
let src = fs.readFileSync(file, "utf8");
let changed = false;

function replaceOnce(from, to, label) {
  if (src.includes(to)) return;
  if (!src.includes(from)) throw new Error(`shared buffer patch failed: ${label}`);
  src = src.replace(from, to);
  changed = true;
}

replaceOnce(
  'import type { Candle } from "@/lib/types";',
  'import type { Candle } from "@/lib/types";\nimport { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";',
  "shared buffer import",
);

replaceOnce(
  '    let buffer: any = null;\n    try { buffer = await internalJson(req, "/api/portfolio/cash-buffer"); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
  '    let buffer: any = null;\n    try { buffer = await buildCashBufferSnapshot(); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
  "direct cash buffer read",
);

replaceOnce(
  '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const nav = finite(buffer?.totalNav) ?? securitiesValue + cashBalance;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? finite(buffer?.gapValue) ?? 0);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (cashBalance / nav) * 100 : null);\n    const targetCashPct = finite(buffer?.targetPct);',
  '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const reserveFallback = gathered.reduce((sum, g) => RESERVES.has(g.ticker) ? sum + (g.price ?? g.avgCost) * g.shares : sum, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const dividendAvailable = finite(buffer?.dividendAvailable) ?? 0;\n    const combinedBuffer = finite(buffer?.liquidityBuffer) ?? (cashBalance + dividendAvailable + reserveFallback);\n    const nav = finite(buffer?.totalNav) ?? securitiesValue;\n    const targetCashPct = finite(buffer?.targetPct);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (combinedBuffer / nav) * 100 : null);\n    const targetCashValue = nav > 0 && targetCashPct != null ? nav * targetCashPct / 100 : null;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? (targetCashValue == null ? 0 : combinedBuffer - targetCashValue));',
  "combined buffer inputs",
);

if (changed) fs.writeFileSync(file, src);
console.log(changed ? "Applied shared combined Cash Buffer to CIO meeting." : "Shared Cash Buffer patch already applied.");
