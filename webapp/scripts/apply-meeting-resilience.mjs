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
]);

patch("app/components/CIOCommandCenterV20.tsx", [
  [
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";',
    'const FROZEN_MEETING_KEY = "sentinel:cio:frozen-meeting:v20";\nconst LAST_MEETING_KEY = "sentinel:cio:last-meeting:v20";',
    "last meeting key",
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

console.log("Applied CIO meeting resilience patch.");
