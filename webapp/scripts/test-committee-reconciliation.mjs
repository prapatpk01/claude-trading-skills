import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Compiled reconciliation module path is required.");
const { reconcileCommitteeMotions } = await import(pathToFileURL(path.resolve(process.cwd(), modulePath)).href);

const motions = [
  { id: "BUY-NVDA", ticker: "NVDA", kind: "NEW BUY", proposedUsd: 500, proposedShares: 2 },
  { id: "SELL-VOO", ticker: "VOO", kind: "EXIT", proposedUsd: -300, proposedShares: 0.5 },
  { id: "BUY-MELI", ticker: "MELI", kind: "NEW BUY", proposedUsd: 500, proposedShares: 0.25 },
];
const transactions = [
  { id: "tx-1", ticker: "NVDA", side: "BUY", shares: 1, price: 480, trade_date: "2026-08-06" },
  { id: "tx-2", ticker: "VOO", side: "SELL", shares: 0.2, price: 600, trade_date: "2026-08-06" },
  { id: "tx-old", ticker: "MELI", side: "BUY", shares: 0.25, price: 2000, trade_date: "2026-08-05" },
];

const result = reconcileCommitteeMotions(motions, transactions, "2026-08-06", 40);
assert.equal(result[0].status, "MATCHED", "NVDA is within the ±40% value tolerance");
assert.equal(result[0].actualShares, 1);
assert.equal(result[0].actualPrice, 480);
assert.equal(result[1].status, "DIFFERENT", "VOO is detected but materially smaller than proposed");
assert.equal(result[1].expectedSide, "SELL");
assert.equal(result[2].status, "NOT_FOUND", "transactions before the meeting date are not matched");
console.log("Committee auto-reconciliation tests passed (8 assertions).");
