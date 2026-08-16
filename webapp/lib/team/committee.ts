// Sentinel Decision Authority V22 wrapper.
//
// The original committee engine is preserved byte-for-byte in committeeLegacy.ts.
// This wrapper upgrades the four sequential authority gates without weakening
// the legacy execution safeguards: a CONDITIONAL decision is always DEFERRED
// and never reaches the broker blotter automatically.

export * from "./committeeLegacy";

import { runCommitteeMeeting as runLegacyCommitteeMeeting } from "./committeeLegacy";
import type { CommitteeInput } from "./committeeLegacy";
import { applyDecisionAuthorityV22 } from "./authorityV22";

export function runCommitteeMeeting(input: CommitteeInput) {
  const meeting = runLegacyCommitteeMeeting(input);
  return applyDecisionAuthorityV22(meeting, input);
}
