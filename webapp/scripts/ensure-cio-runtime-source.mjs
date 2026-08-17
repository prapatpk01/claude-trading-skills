import fs from "node:fs";
import path from "node:path";

// Railway runs this guard before every build. Historical versions rewrote the
// CIO route at build time, which could silently restore obsolete snapshot code.
// Production builds now validate the committed source and never mutate it.
const root = process.cwd();
const contracts = [
  ["app/api/committee/meeting/route.ts", [
    "buildAuthoritativeCashBufferSnapshot",
    "portfolioSnapshot",
    "holdingsConsistent",
    'Cache-Control\": \"no-store, no-cache',
  ]],
  ["app/api/portfolio/cash-buffer/route.ts", [
    "buildAuthoritativeCashBufferSnapshot",
    "force-no-store",
  ]],
  ["app/components/CIOCommandCenterV20.tsx", [
    "loadPortfolioIdentity",
    "sentinel:portfolio-updated",
    "sentinel:cash-ledger-changed",
    "PORTFOLIO SNAPSHOT",
  ]],
];

for (const [relative, markers] of contracts) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error("CIO runtime contract missing in " + relative + ": " + marker);
  }
}

console.log("CIO runtime source verified: authoritative snapshot, no-cache and ledger refresh contracts are present.");
