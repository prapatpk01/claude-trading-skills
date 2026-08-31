export const INV_RESEARCH_V39 = "39.0" as const;

export type DiscoveryLaneV39 = "MOMENTUM" | "THESIS";
export type DiscoveryStateV39 = "DISCOVERED" | "RESEARCH_READY" | "COMMITTEE_READY" | "DATA_LIMITED";

export type MomentumSeedV39 = {
  ticker: string;
  score: number;
  stage: string;
  price: number | null;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  rs3m: number | null;
  volumeRatio: number | null;
  aboveEma20: boolean;
  aboveEma50: boolean;
  ema20Above50: boolean;
};

export type DeepCandidateV39 = {
  ticker: string;
  name?: string;
  sector?: string;
  price?: number | null;
  targetPrice?: number | null;
  expectedReturnPct?: number | null;
  momentum?: number | null;
  institutional?: number | null;
  growth?: number | null;
  quality?: number | null;
  composite?: number | null;
  passed?: boolean;
  valuationReady?: boolean;
  lifecycle?: { stage?: string; score?: number; entryEligible?: boolean } | null;
  failedGates?: string[];
  reasons?: string[];
  thesis?: string;
  dataQuality?: string;
};

export type ThesisEvidenceV39 = {
  thesis?: { base?: string; whyNow?: string; invalidation?: string } | null;
  catalyst?: { score?: number | null; quality?: string | null; note?: string | null } | null;
  fundFit?: { score?: number | null; hardBlocks?: string[] | null } | null;
  structure?: { score?: number | null } | null;
};

export type SectorReadV39 = {
  sector: string;
  score: number | null;
  status: string | null;
  rank: number | null;
  relative1m?: number | null;
  relative3m?: number | null;
};

export type DiscoveryRowV39 = {
  ticker: string;
  name: string;
  sector: string;
  lane: DiscoveryLaneV39;
  state: DiscoveryStateV39;
  score: number;
  confidenceScore: number;
  price: number | null;
  targetPrice: number | null;
  expectedReturnPct: number | null;
  lifecycleStage: string;
  momentumScore: number | null;
  institutionalScore: number | null;
  growthScore: number | null;
  qualityScore: number | null;
  compositeScore: number | null;
  fastScore: number | null;
  return1w: number | null;
  return1m: number | null;
  return3m: number | null;
  rs3m: number | null;
  volumeRatio: number | null;
  sectorLeadershipScore: number | null;
  sectorLeadershipStatus: string | null;
  sectorRank: number | null;
  theme: string | null;
  thesis: string | null;
  catalyst: string | null;
  whyNow: string | null;
  invalidation: string | null;
  committeeReady: boolean;
  discoveryReasons: string[];
  hardBlocks: string[];
  failedGates: string[];
  dataQuality: string;
};

const clamp = (value: number, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const finite = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};
const avg = (values: Array<number | null | undefined>, fallback = 0) => {
  const clean = values.map(finite).filter((value): value is number => value != null);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : fallback;
};

function lifecycleQuality(stage: string) {
  const key = String(stage || "UNCONFIRMED").toUpperCase();
  if (key === "EARLY_MARKUP") return 100;
  if (key === "ACCUMULATION") return 92;
  if (key === "MOMENTUM_EXPANSION") return 90;
  if (key === "MATURE") return 52;
  if (key === "UNCONFIRMED") return 42;
  if (key === "WEAKENING") return 18;
  if (key === "BROKEN") return 0;
  return 35;
}

function catalystQuality(value: unknown) {
  const quality = String(value ?? "").toUpperCase();
  if (quality === "MEASURED") return 90;
  if (quality === "PARTIAL") return 62;
  return 35;
}

function themeFromText(sector: string, evidence?: ThesisEvidenceV39 | null) {
  const text = `${evidence?.thesis?.base ?? ""} ${evidence?.thesis?.whyNow ?? ""} ${evidence?.catalyst?.note ?? ""}`.toUpperCase();
  if (/AI|ARTIFICIAL INTELLIGENCE|DATA[ -]?CENTER|GPU|SEMICONDUCT|CHIP|ACCELERATOR/.test(text)) return "AI Infrastructure";
  if (/POWER|GRID|ELECTRIC|NUCLEAR|UTILITY|ENERGY DEMAND/.test(text)) return "Power & Grid Capex";
  if (/DEFEN[CS]E|AEROSPACE|MISSILE|MILITARY/.test(text)) return "Defense & Aerospace";
  if (/BANK|BROKER|CAPITAL MARKET|CREDIT|RATE CUT|M&A|IPO/.test(text)) return "Capital Markets & Rates";
  if (/CYBER|CLOUD|SOFTWARE|SAAS/.test(text)) return "Software / Cloud";
  if (/GLP-1|BIOTECH|PHARMA|DRUG|HEALTHCARE|MEDICAL/.test(text)) return "Healthcare Innovation";
  if (/GOLD|COPPER|METAL|MINING|COMMODIT/.test(text)) return "Metals Cycle";
  return sector && sector !== "Unknown" ? `${sector} Leadership` : "Market Leadership";
}

export function momentumDiscoveryScoreV39(seed: MomentumSeedV39, candidate?: DeepCandidateV39 | null) {
  const fast = clamp(finite(seed.score) ?? 0);
  const momentum = clamp(finite(candidate?.momentum) ?? fast);
  const institutional = clamp(finite(candidate?.institutional) ?? 50);
  const life = lifecycleQuality(candidate?.lifecycle?.stage ?? seed.stage);
  const rs = clamp(50 + (finite(seed.rs3m) ?? 0) * 2.2);
  const volume = seed.volumeRatio == null ? 50 : clamp(45 + (seed.volumeRatio - 1) * 45);
  return Math.round(clamp(fast * .36 + momentum * .28 + life * .16 + rs * .10 + institutional * .06 + volume * .04));
}

export function thesisDiscoveryScoreV39(candidate: DeepCandidateV39, sector: SectorReadV39 | null, evidence: ThesisEvidenceV39 | null) {
  const sectorScore = clamp(finite(sector?.score) ?? 50);
  const catalyst = clamp(finite(evidence?.catalyst?.score) ?? catalystQuality(evidence?.catalyst?.quality));
  const fit = clamp(finite(evidence?.fundFit?.score) ?? 50);
  const momentum = clamp(finite(candidate.momentum) ?? 50);
  const growthQuality = clamp(avg([candidate.growth, candidate.quality], 50));
  return Math.round(clamp(sectorScore * .25 + catalyst * .25 + fit * .20 + momentum * .15 + growthQuality * .15));
}

export function isCommitteeReadyV39(candidate: DeepCandidateV39, evidence?: ThesisEvidenceV39 | null) {
  const stage = String(candidate.lifecycle?.stage ?? "").toUpperCase();
  const primary = ["ACCUMULATION", "EARLY_MARKUP", "MOMENTUM_EXPANSION"].includes(stage);
  const upside = finite(candidate.expectedReturnPct);
  const blocks = Array.isArray(evidence?.fundFit?.hardBlocks) ? evidence!.fundFit!.hardBlocks!.map(String) : [];
  return Boolean(candidate.passed)
    && Boolean(candidate.valuationReady)
    && upside != null
    && upside >= 8
    && primary
    && blocks.length === 0;
}

export function buildMomentumDiscoveryRowV39(input: {
  seed: MomentumSeedV39;
  candidate?: DeepCandidateV39 | null;
  coverageReady: boolean;
}): DiscoveryRowV39 {
  const { seed, candidate, coverageReady } = input;
  const score = momentumDiscoveryScoreV39(seed, candidate);
  const stage = String(candidate?.lifecycle?.stage ?? seed.stage ?? "UNCONFIRMED");
  const committeeReady = candidate ? isCommitteeReadyV39(candidate, null) : false;
  const discoveryReasons = [
    `Fast momentum ${Math.round(seed.score)}/100`,
    `${stage} lifecycle`,
    seed.rs3m != null ? `RS3M ${seed.rs3m >= 0 ? "+" : ""}${seed.rs3m.toFixed(1)}%` : null,
    seed.return1m != null ? `1M ${seed.return1m >= 0 ? "+" : ""}${seed.return1m.toFixed(1)}%` : null,
    seed.volumeRatio != null ? `Volume ${seed.volumeRatio.toFixed(2)}x` : null,
  ].filter(Boolean) as string[];
  const state: DiscoveryStateV39 = !coverageReady ? "DATA_LIMITED" : committeeReady ? "COMMITTEE_READY" : score >= 62 ? "RESEARCH_READY" : "DISCOVERED";
  return {
    ticker: seed.ticker,
    name: String(candidate?.name ?? seed.ticker),
    sector: String(candidate?.sector ?? "Unknown"),
    lane: "MOMENTUM",
    state,
    score,
    confidenceScore: Math.round(clamp((coverageReady ? 80 : 45) * .5 + (candidate ? 85 : 45) * .5)),
    price: finite(candidate?.price) ?? finite(seed.price),
    targetPrice: finite(candidate?.targetPrice),
    expectedReturnPct: finite(candidate?.expectedReturnPct),
    lifecycleStage: stage,
    momentumScore: finite(candidate?.momentum),
    institutionalScore: finite(candidate?.institutional),
    growthScore: finite(candidate?.growth),
    qualityScore: finite(candidate?.quality),
    compositeScore: finite(candidate?.composite),
    fastScore: finite(seed.score),
    return1w: finite(seed.return1w),
    return1m: finite(seed.return1m),
    return3m: finite(seed.return3m),
    rs3m: finite(seed.rs3m),
    volumeRatio: finite(seed.volumeRatio),
    sectorLeadershipScore: null,
    sectorLeadershipStatus: null,
    sectorRank: null,
    theme: null,
    thesis: candidate?.thesis ?? null,
    catalyst: null,
    whyNow: discoveryReasons.join(" · "),
    invalidation: "Re-underwrite if momentum lifecycle weakens, price loses the primary trend, or relative strength materially reverses.",
    committeeReady,
    discoveryReasons,
    hardBlocks: [],
    failedGates: Array.isArray(candidate?.failedGates) ? candidate!.failedGates!.map(String) : [],
    dataQuality: String(candidate?.dataQuality ?? (coverageReady ? "FAST_SCAN_MEASURED" : "DATA_LIMITED")),
  };
}

export function buildThesisDiscoveryRowV39(input: {
  candidate: DeepCandidateV39;
  sector: SectorReadV39 | null;
  evidence: ThesisEvidenceV39 | null;
  coverageReady: boolean;
}): DiscoveryRowV39 {
  const { candidate, sector, evidence, coverageReady } = input;
  const score = thesisDiscoveryScoreV39(candidate, sector, evidence);
  const hardBlocks = Array.isArray(evidence?.fundFit?.hardBlocks) ? evidence!.fundFit!.hardBlocks!.map(String) : [];
  const committeeReady = isCommitteeReadyV39(candidate, evidence);
  const sectorStatus = String(sector?.status ?? "UNCONFIRMED");
  const theme = themeFromText(String(candidate.sector ?? "Unknown"), evidence);
  const discoveryReasons = [
    sector ? `${sectorStatus} sector ${Math.round(Number(sector.score ?? 0))}/100` : "Sector leadership unconfirmed",
    evidence?.catalyst?.score != null ? `Catalyst ${Math.round(Number(evidence.catalyst.score))}/100` : "Catalyst qualitative",
    evidence?.fundFit?.score != null ? `Fund fit ${Math.round(Number(evidence.fundFit.score))}/100` : null,
    candidate.momentum != null ? `Momentum ${Math.round(Number(candidate.momentum))}/100` : null,
  ].filter(Boolean) as string[];
  const state: DiscoveryStateV39 = !coverageReady ? "DATA_LIMITED" : hardBlocks.length ? "DISCOVERED" : committeeReady ? "COMMITTEE_READY" : score >= 60 ? "RESEARCH_READY" : "DISCOVERED";
  return {
    ticker: candidate.ticker,
    name: String(candidate.name ?? candidate.ticker),
    sector: String(candidate.sector ?? "Unknown"),
    lane: "THESIS",
    state,
    score,
    confidenceScore: Math.round(clamp((finite(evidence?.fundFit?.score) ?? 45) * .45 + catalystQuality(evidence?.catalyst?.quality) * .30 + (sector ? 80 : 40) * .25)),
    price: finite(candidate.price),
    targetPrice: finite(candidate.targetPrice),
    expectedReturnPct: finite(candidate.expectedReturnPct),
    lifecycleStage: String(candidate.lifecycle?.stage ?? "UNCONFIRMED"),
    momentumScore: finite(candidate.momentum),
    institutionalScore: finite(candidate.institutional),
    growthScore: finite(candidate.growth),
    qualityScore: finite(candidate.quality),
    compositeScore: finite(candidate.composite),
    fastScore: null,
    return1w: null,
    return1m: null,
    return3m: null,
    rs3m: null,
    volumeRatio: null,
    sectorLeadershipScore: finite(sector?.score),
    sectorLeadershipStatus: sector?.status ?? null,
    sectorRank: finite(sector?.rank),
    theme,
    thesis: evidence?.thesis?.base ?? candidate.thesis ?? null,
    catalyst: evidence?.catalyst?.note ?? null,
    whyNow: evidence?.thesis?.whyNow ?? discoveryReasons.join(" · "),
    invalidation: evidence?.thesis?.invalidation ?? hardBlocks[0] ?? "Re-underwrite if the sector thesis, catalyst path or momentum structure breaks.",
    committeeReady,
    discoveryReasons,
    hardBlocks,
    failedGates: Array.isArray(candidate.failedGates) ? candidate.failedGates.map(String) : [],
    dataQuality: String(candidate.dataQuality ?? "MEDIUM"),
  };
}

export function rankDiscoveryRowsV39(rows: DiscoveryRowV39[], topN: number) {
  const stateBonus = (state: DiscoveryStateV39) => state === "COMMITTEE_READY" ? 8 : state === "RESEARCH_READY" ? 4 : state === "DISCOVERED" ? 0 : -12;
  return [...rows]
    .sort((a, b) => (b.score * .72 + b.confidenceScore * .28 + stateBonus(b.state)) - (a.score * .72 + a.confidenceScore * .28 + stateBonus(a.state)) || a.ticker.localeCompare(b.ticker))
    .slice(0, Math.max(1, topN));
}

export function mergeDiscoveryRowsV39(momentum: DiscoveryRowV39[], thesis: DiscoveryRowV39[], topN: number) {
  const map = new Map<string, DiscoveryRowV39 & { lanes: DiscoveryLaneV39[] }>();
  for (const row of [...momentum, ...thesis]) {
    const existing = map.get(row.ticker);
    if (!existing) {
      map.set(row.ticker, { ...row, lanes: [row.lane] });
      continue;
    }
    const lanes = Array.from(new Set([...existing.lanes, row.lane]));
    const preferred = (row.score * .72 + row.confidenceScore * .28) > (existing.score * .72 + existing.confidenceScore * .28) ? row : existing;
    map.set(row.ticker, { ...preferred, lanes, score: Math.round(Math.max(existing.score, row.score) * .7 + avg([existing.score, row.score]) * .3) });
  }
  return rankDiscoveryRowsV39(Array.from(map.values()), topN) as Array<DiscoveryRowV39 & { lanes: DiscoveryLaneV39[] }>;
}
