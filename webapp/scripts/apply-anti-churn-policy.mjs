import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const committeePath = path.resolve(here, "../lib/team/committee.ts");
let source = fs.readFileSync(committeePath, "utf8");
let changed = false;

const replaceExact = (from, to, label) => {
  if (source.includes(to)) return;
  if (!source.includes(from)) {
    throw new Error(`Anti-churn policy patch failed: expected ${label} source block was not found.`);
  }
  source = source.replace(from, to);
  changed = true;
};

replaceExact(
  "/** Ordinary model changes cannot reverse a completed broker trade immediately. */\nconst BUY_STABILIZATION_DAYS = 14;",
  "/** 30-day anti-churn stabilization after an actual BUY. This is a soft default, not a forced holding period. */\nconst BUY_STABILIZATION_DAYS = 30;",
  "stabilization-day",
);

replaceExact(
  "  const emergencyExit = trendBroken && deepLoss;\n  const concentrationOverride = p.zone?.zone === \"EMERGENCY\" || p.zone?.zone === \"TRIM\" || (weight != null && weight > HARD_CAP_PCT);",
  "  const emergencyExit = trendBroken && deepLoss;\n  const concentrationOverride = p.zone?.zone === \"EMERGENCY\" || p.zone?.zone === \"TRIM\" || (weight != null && weight > HARD_CAP_PCT);\n  const riskOffOverride = input.regime != null && (input.regime.score < 40 || /RISK.?OFF|BEAR/i.test(input.regime.regime));\n  const replacementOverride = (input.replacements?.[p.ticker]?.length ?? 0) > 0;",
  "stabilization-override",
);

replaceExact(
  "  // A newly completed BUY gets time to settle. A normal SMA or momentum flip\n  // remains visible as an alert, but cannot manufacture a round trip. Severe\n  // structural damage and concentration-policy trims still override the lock.\n  if (buyLocked && !emergencyExit && !concentrationOverride && blocks.length > 0 && (trendBroken || momentumNegative)) {",
  "  // A newly completed BUY gets time to settle. A normal SMA or momentum flip\n  // remains visible as an alert, but cannot manufacture a round trip. The lock\n  // is deliberately soft: severe thesis/trend damage, concentration policy, a\n  // Risk-Off regime, or a named replacement may override it.\n  if (buyLocked && !emergencyExit && !concentrationOverride && !riskOffOverride && !replacementOverride && blocks.length > 0 && (trendBroken || momentumNegative)) {",
  "stabilization-gate",
);

replaceExact(
  "    reasons.push({ desk: \"Research\", member: ROSTER.maya.name, finding: `Technical alert retained for review: ${blocks.join(\"; \")}${momentumNegative ? `; signal ${p.momentum?.signal}` : \"\"}. Only a hard risk limit or severe trend-and-loss stop may override the lock.` });",
  "    reasons.push({ desk: \"Research\", member: ROSTER.maya.name, finding: `Technical alert retained for review: ${blocks.join(\"; \")}${momentumNegative ? `; signal ${p.momentum?.signal}` : \"\"}. The stabilization period may be overridden by severe thesis/trend damage, a hard risk or concentration limit, a Risk-Off regime, or a named replacement with a documented rotation case.` });",
  "stabilization-explanation",
);

if (changed) fs.writeFileSync(committeePath, source);
console.log(changed ? "Applied Sentinel 30-day anti-churn policy." : "Sentinel 30-day anti-churn policy already applied.");
