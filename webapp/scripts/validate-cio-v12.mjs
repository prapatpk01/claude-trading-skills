// Structural checks on the investment committee workspace.
//
// These assert that the meeting is wired to the engine and that the governance
// language a reader relies on is actually present — not that any particular
// number appears, which is the engine's business and is covered by
// scripts/test-committee.mjs.

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const failures = [];
const requireTokens = (file, tokens) => {
  let source;
  try { source = read(file); }
  catch { failures.push(`${file}: missing file`); return; }
  for (const token of tokens) if (!source.includes(token)) failures.push(`${file}: missing ${token}`);
};
const forbidTokens = (file, tokens) => {
  let source;
  try { source = read(file); } catch { return; }
  for (const [token, why] of tokens) if (source.includes(token)) failures.push(`${file}: ${why} (${token})`);
};

// ── the component renders the meeting the engine produced ──
requireTokens("app/components/CIOCommandCenterV12.tsx", [
  'data-cio-version="14.0"',
  "/api/committee/meeting",
  "Investment Committee",
  "Agenda",
  "Attendance and quorum",
  "Macro regime and cash policy",
  "Motions",
  "Capital plan",
  "Trade blotter",
  "Resolutions",
  "Risk register and round table",
  "Minutes",
  "Vote sheet",
  "Dissent on the record",
  "NO AUTO EXECUTION",
  "ABSTENTION IS HONEST",
  "SOURCES FUND USES",
]);

// The old workspace called routes that do not exist, so two of its three
// panels were permanently empty. Nothing may reintroduce those paths.
forbidTokens("app/components/CIOCommandCenterV12.tsx", [
  ["/api/analysis/actions", "route does not exist — the analyze routes are /api/analyze/*"],
  ["/api/analysis/performance", "route does not exist — the analyze routes are /api/analyze/*"],
  ["summary?.winRate\b", "the performance summary key is winRatePct"],
]);

// ── the engine is a pure module and the route is the only fetcher ──
requireTokens("lib/team/committee.ts", [
  "export function runCommitteeMeeting",
  "MIN_COVERAGE_PCT",
  "HARD_CAP_PCT",
  "ABSTAIN",
  "cutForFunding",
  "veto",
  "dissent",
]);
forbidTokens("lib/team/committee.ts", [
  ["fetch(", "the meeting engine must not touch the network"],
  ["Date.now()", "the engine must use the asOf it is given, not the clock"],
]);

requireTokens("app/api/committee/meeting/route.ts", [
  "runCommitteeMeeting",
  "buildBookReview",
  "assessRegime",
  "scoreMomentumV3",
  "assessValuation",
  "assessPositionZone",
  "classifySleeve",
  "/api/analyze/actions",
  "/api/analyze/performance",
  "/api/portfolio/cash-buffer",
  "unavailable",
]);

// ── research must be able to hand a name to the committee ──
// The "Committee Ready" stage existed for months with no way to send anything.
requireTokens("app/components/ResearchWorkspaceV12.tsx", [
  "referToCommittee",
  '"COMMITTEE"',
  "/api/analyze/actions",
  "Refer to committee",
  "Refer the shortlist to the investment committee",
  // The referral must carry the price it was written at, or the committee
  // cannot tell that the thesis has drifted off it.
  "price:candidate.price",
  "source:engine",
]);

requireTokens("app/page.tsx", ["CIOCommandCenterV12", 'section === "command"']);

if (failures.length) {
  console.error(`Investment committee validation FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Sentinel investment committee validation PASSED");
