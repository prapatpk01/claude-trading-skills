import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TARGETS = ["app", "lib"];
const EXT = new Set([".ts", ".tsx", ".js", ".mjs"]);
const failures = [];
const warnings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (EXT.has(path.extname(entry.name))) audit(full);
  }
}

function rel(file) { return path.relative(ROOT, file).replaceAll("\\", "/"); }
function lineOf(src, index) { return src.slice(0, index).split("\n").length; }

function hit(file, src, re, message, severity = "failure") {
  for (const match of src.matchAll(re)) {
    const item = `${rel(file)}:${lineOf(src, match.index ?? 0)} ${message}`;
    (severity === "failure" ? failures : warnings).push(item);
  }
}

function audit(file) {
  const src = fs.readFileSync(file, "utf8");
  const name = rel(file);

  // Missing financial values must never be converted to zero before a ratio,
  // balance-sheet or committee calculation. Explicit display fallbacks are fine.
  if (!name.endsWith("format.ts")) {
    hit(file, src, /const\s+n\s*=\s*\([^)]*\)\s*=>[^\n]*\?[^\n]*:\s*0\s*;/g,
      "numeric normalizer converts missing evidence to zero");
  }

  hit(file, src, /generic\s*[±+\-]?20%\s*spot\s*band/gi,
    "generic spot-band valuation is forbidden");
  hit(file, src, /base\s*=\s*round2\(price\)/gi,
    "spot price is assigned as Base Fair Value");
  hit(file, src, /dataQuality\s*=\s*Math\.max\([^\n]*warnings/gi,
    "data-quality score is derived only from warning count", "warning");
  hit(file, src, /quote[^\n]*\?\?[^\n]*avg_cost/gi,
    "missing live quote silently falls back to average cost", "warning");
  hit(file, src, /decision\s*===\s*["']APPROVE["'][^\n]*human/gi,
    "approval path should be reviewed for explicit human authorization", "warning");
}

for (const target of TARGETS) {
  const dir = path.join(ROOT, target);
  if (fs.existsSync(dir)) walk(dir);
}

console.log(`Runtime safety audit: ${failures.length} failure(s), ${warnings.length} warning(s).`);
for (const item of warnings) console.warn(`WARN ${item}`);
for (const item of failures) console.error(`FAIL ${item}`);
if (failures.length) process.exit(1);
