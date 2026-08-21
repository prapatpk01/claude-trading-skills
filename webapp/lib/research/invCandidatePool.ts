export type InvCandidatePoolRow = Record<string, any> & {
  ticker?: string;
  status?: string;
  lifecycle?: { stage?: string };
  valuationReady?: boolean;
  valuationValid?: boolean;
  expectedReturnPct?: number;
  momentum?: number;
  composite?: number;
  researchEvidence?: { fundFit?: { score?: number; hardBlocks?: unknown[] } };
};

export type InvCandidatePoolResult = {
  candidates: InvCandidatePoolRow[];
  stageCounts: Record<string, number>;
  requestedLimit: number;
};

const PRIMARY_STAGES = new Set(["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"]);
const BLOCKED_STAGES = new Set(["WEAKENING", "BROKEN"]);
const REJECTED_STATUSES = new Set(["REJECTED", "MOMENTUM_STAGE_REJECTED"]);

const cleanTicker = (value: unknown) => String(value ?? "").trim().toUpperCase();
const finite = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

// V31: workflow progress is evidence, not alpha. Older ranking gave +1000 to
// COMMITTEE_READY and +700 to MATURE fallback, which could dominate upside,
// lifecycle and momentum. The pool now rewards investable stage + valuation +
// expected return while retaining a modest bonus for completed underwriting.
function rowScore(row: InvCandidatePoolRow) {
  const status = String(row?.status ?? "");
  const stage = String(row?.lifecycle?.stage ?? "UNCONFIRMED");
  const expected = Math.max(-20, Math.min(40, finite(row?.expectedReturnPct)));
  let score = 0;

  if (status === "COMMITTEE_READY") score += 120;
  else if (status === "MATURE_FALLBACK_REVIEW") score += 10;

  if (row?.valuationValid || row?.valuationReady) score += 100;
  if (PRIMARY_STAGES.has(stage)) score += 140;
  else if (stage === "MATURE") score -= 80;
  else score += 10;

  score += Math.max(0, finite(row?.researchEvidence?.fundFit?.score)) * 1.3;
  score += Math.max(0, finite(row?.momentum)) * .7;
  score += Math.max(0, finite(row?.composite)) * .35;
  score += expected * 7;
  return score;
}

function eligible(row: InvCandidatePoolRow) {
  const ticker = cleanTicker(row?.ticker);
  if (!ticker) return false;
  const status = String(row?.status ?? "");
  if (REJECTED_STATUSES.has(status)) return false;
  const stage = String(row?.lifecycle?.stage ?? "UNCONFIRMED");
  if (BLOCKED_STAGES.has(stage)) return false;
  const hardBlocks = row?.researchEvidence?.fundFit?.hardBlocks;
  if (Array.isArray(hardBlocks) && hardBlocks.length > 0) return false;
  return true;
}

export function buildInvCandidatePool(stageCandidates: Record<string, any> | null | undefined, limit = 15): InvCandidatePoolResult {
  const requestedLimit = Math.max(5, Math.min(20, Math.round(limit)));
  const stages = ["selected", "valuation", "momentum", "qualified", "analyzed"] as const;
  const stageCounts: Record<string, number> = {};
  const byTicker = new Map<string, InvCandidatePoolRow & { candidatePoolStage?: string; candidatePoolRank?: number }>();

  for (const stage of stages) {
    const rows = Array.isArray(stageCandidates?.[stage]) ? stageCandidates[stage] : [];
    stageCounts[stage] = rows.length;
    for (const raw of rows) {
      const row = raw as InvCandidatePoolRow;
      if (!eligible(row)) continue;
      const ticker = cleanTicker(row.ticker);
      const candidate = { ...row, ticker, candidatePoolStage: stage.toUpperCase() };
      const previous = byTicker.get(ticker);
      if (!previous || rowScore(candidate) > rowScore(previous)) byTicker.set(ticker, candidate);
    }
  }

  const ranked = Array.from(byTicker.values())
    .sort((a, b) => rowScore(b) - rowScore(a) || cleanTicker(a.ticker).localeCompare(cleanTicker(b.ticker)))
    .slice(0, requestedLimit)
    .map((row, index) => ({ ...row, candidatePoolRank: index + 1 }));

  return { candidates: ranked, stageCounts, requestedLimit };
}
