import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

function patch(rel, edits) {
  const file = path.join(root, rel);
  let src = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const [from, to, label] of edits) {
    if (src.includes(to)) continue;
    if (!src.includes(from)) throw new Error(`meeting resilience patch failed: ${label}`);
    src = src.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, src);
}

patch("app/api/committee/meeting/route.ts", [
  [
    'import { runInvestmentResearchOS } from "@/lib/research/investmentDiscovery";',
    'import { runInvestmentResearchOS } from "@/lib/research/investmentDiscovery";\nimport { buildCashBufferSnapshot } from "@/lib/cashBufferSnapshot";',
    "shared cash buffer import",
  ],
  [
    '    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },\n  });',
    '    headers: { accept: "application/json", ...(cookie ? { cookie } : {}), ...(authorization ? { authorization } : {}) },\n    signal: AbortSignal.timeout(8_000),\n  });',
    "internal API timeout",
  ],
  [
    'new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Phase 1 exceeded its meeting time budget")), 42_000))',
    'new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Phase 1 exceeded its meeting time budget")), 18_000))',
    "phase1 budget",
  ],
  [
    'setTimeout(() => reject(new Error("the sweep did not finish inside the meeting\'s time budget")), 25_000)',
    'setTimeout(() => reject(new Error("the sweep did not finish inside the meeting\'s time budget")), 12_000)',
    "desk scan budget",
  ],
  [
    '    let buffer: any = null;\n    try { buffer = await internalJson(req, "/api/portfolio/cash-buffer"); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
    '    let buffer: any = null;\n    try { buffer = await buildCashBufferSnapshot(); }\n    catch (e: any) { unavailable.push(`cash buffer (${e?.message ?? "unavailable"})`); }',
    "direct combined buffer read",
  ],
  [
    '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const nav = finite(buffer?.totalNav) ?? securitiesValue + cashBalance;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? finite(buffer?.gapValue) ?? 0);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (cashBalance / nav) * 100 : null);\n    const targetCashPct = finite(buffer?.targetPct);',
    '    const securitiesValue = gathered.reduce((s, g) => s + (g.price ?? g.avgCost) * g.shares, 0);\n    const reserveFallback = gathered.reduce((sum, g) => RESERVES.has(g.ticker) ? sum + (g.price ?? g.avgCost) * g.shares : sum, 0);\n    const cashBalance = finite(buffer?.cashBalance) ?? 0;\n    const dividendAvailable = finite(buffer?.dividendAvailable) ?? 0;\n    const combinedBuffer = finite(buffer?.liquidityBuffer) ?? (cashBalance + dividendAvailable + reserveFallback);\n    const nav = finite(buffer?.totalNav) ?? securitiesValue;\n    const targetCashPct = finite(buffer?.targetPct);\n    const cashBufferPct = finite(buffer?.bufferPct) ?? (nav > 0 ? (combinedBuffer / nav) * 100 : null);\n    const targetCashValue = nav > 0 && targetCashPct != null ? nav * targetCashPct / 100 : null;\n    const deployableCash = Math.max(0, finite(buffer?.deployableCash) ?? (targetCashValue == null ? 0 : combinedBuffer - targetCashValue));',
    "combined buffer inputs",
  ],
]);

patch("app/components/CIOCommandCenterV20.tsx", [
  [
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";',
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20.2";',
    "invalidate stale frozen meeting",
  ],
  [
    'const LAST_MEETING_KEY = "sentinel:cio:last-meeting:v20";',
    'const LAST_MEETING_KEY = "sentinel:cio:last-meeting:v20.2";',
    "invalidate stale last meeting",
  ],
  [
    'const response = await fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" } });',
    'const response = await fetch("/api/committee/meeting", { cache: "no-store", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(45_000) });',
    "client timeout",
  ],
  [
    '    setLoading(true);\n    setError(null);\n    loadMeeting()\n      .then((payload) => { if (active) setMeeting(payload); })',
    '    if (refreshKey === 0) {\n      try {\n        const cached = window.localStorage.getItem(LAST_MEETING_KEY);\n        if (cached) {\n          const parsed = JSON.parse(cached) as Meeting;\n          if (parsed?.meetingId && parsed?.motions) setMeeting(parsed);\n        }\n      } catch { window.localStorage.removeItem(LAST_MEETING_KEY); }\n    }\n    setLoading(true);\n    setError(null);\n    loadMeeting()\n      .then((payload) => {\n        if (active) setMeeting(payload);\n        try { window.localStorage.setItem(LAST_MEETING_KEY, JSON.stringify(payload)); } catch {}\n      })',
    "cache last meeting",
  ],
]);

patch("app/page.tsx", [
  [
    '<CIOCommandCenterV20 key={`cio-${lang}`} lang={lang} onNavigate={navigate} />',
    '<CIOCommandCenterV20 lang={lang} onNavigate={navigate} />',
    "language toggle must not remount CIO",
  ],
]);

patch("app/components/ThaiMeetingTranslator.tsx", [
  [
    '    const observer = new MutationObserver(() => translateRoot(root));\n    observer.observe(root, { childList: true, subtree: true, characterData: true });',
    '    let queued = false;\n    const observer = new MutationObserver(() => {\n      if (queued) return;\n      queued = true;\n      queueMicrotask(() => {\n        queued = false;\n        translateRoot(root);\n      });\n    });\n    observer.observe(root, { childList: true, subtree: true });',
    "prevent translator mutation loop",
  ],
]);

console.log("Applied CIO resilience, Thai toggle, and combined Cash Buffer policy.");
