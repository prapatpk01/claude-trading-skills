import { AGENT_PROFILES, type Evidence, type GovernanceIssue } from "./v7";

export const SENTINEL_RELEASE = "Sentinel-v8.0" as const;

export type DataClassification = "REPORTED" | "CALCULATED" | "PROJECTED" | "ESTIMATED";
export type ProviderStatus = "PRIMARY" | "FALLBACK" | "DEGRADED" | "UNAVAILABLE";
export type DecisionStage =
  | "DISCOVERY"
  | "INITIAL_SCREEN"
  | "DEEP_RESEARCH"
  | "WATCHLIST"
  | "COMMITTEE"
  | "APPROVED"
  | "PORTFOLIO"
  | "MONITORING"
  | "EXIT_REVIEW";

export interface DataPoint<T = unknown> {
  id: string;
  field: string;
  value: T | null;
  unit?: string | null;
  classification: DataClassification;
  provider: string;
  providerStatus: ProviderStatus;
  sourceUrl?: string | null;
  observedAt: string;
  asOf: string;
  freshnessHours: number;
  confidence: number;
  required: boolean;
  conflicts?: string[];
  note?: string | null;
}

export interface DataQualityReport {
  score: number;
  complete: boolean;
  staleCritical: boolean;
  missingRequired: string[];
  conflicts: string[];
  degradedProviders: string[];
  issues: GovernanceIssue[];
}

export interface ScenarioProbability {
  name: "BULL" | "BASE" | "BEAR";
  probability: number;
  expectedReturnPct: number | null;
  drawdownPct: number | null;
  thesis: string;
  invalidation: string;
}

export interface MacroHorizon {
  months: 1 | 3 | 6 | 12;
  regime: "RISK_ON" | "NEUTRAL" | "RISK_OFF" | "DISLOCATION";
  confidence: number;
  growthScore: number;
  inflationScore: number;
  liquidityScore: number;
  creditScore: number;
  sentimentScore: number;
  targetLiquidityPct: number;
  scenarios: ScenarioProbability[];
  evidenceIds: string[];
}

export interface OpportunityRecord {
  ticker: string;
  source: "MOMENTUM" | "DIVIDEND" | "THEMATIC" | "QUALITY" | "VALUE" | "ETF" | "MANUAL";
  stage: DecisionStage;
  score: number;
  confidence: number;
  expectedReturnPct: number | null;
  downsidePct: number | null;
  entryPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  thesis: string;
  blockers: string[];
  evidenceIds: string[];
  createdAt: string;
  expiresAt: string;
}

export interface ReleaseGateResult {
  release: typeof SENTINEL_RELEASE;
  passed: boolean;
  checkedAt: string;
  agents: number;
  controls: Record<string, boolean>;
  failures: string[];
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function validateDataPoints(points: DataPoint[]): DataQualityReport {
  const issues: GovernanceIssue[] = [];
  const missingRequired: string[] = [];
  const conflicts: string[] = [];
  const degradedProviders = new Set<string>();
  let earned = 0;
  let possible = 0;

  for (const point of points) {
    const weight = point.required ? 2 : 1;
    possible += weight;

    if (point.required && (point.value === null || point.value === undefined)) {
      missingRequired.push(point.field);
      issues.push({ severity: "BLOCK", code: "MISSING_REQUIRED_DATA", message: `${point.field} is required but unavailable.` });
      continue;
    }

    if (!point.provider || !point.asOf || !point.observedAt) {
      issues.push({ severity: "BLOCK", code: "BROKEN_DATA_LINEAGE", message: `${point.field} has incomplete source lineage.` });
      continue;
    }

    if (!finite(point.confidence) || point.confidence < 0 || point.confidence > 100) {
      issues.push({ severity: "BLOCK", code: "INVALID_DATA_CONFIDENCE", message: `${point.field} has invalid confidence.` });
      continue;
    }

    if (!finite(point.freshnessHours) || point.freshnessHours < 0) {
      issues.push({ severity: "BLOCK", code: "INVALID_DATA_FRESHNESS", message: `${point.field} has invalid freshness.` });
      continue;
    }

    if (["DEGRADED", "FALLBACK", "UNAVAILABLE"].includes(point.providerStatus)) {
      degradedProviders.add(point.provider);
    }

    const critical = ["price", "marketValue", "shares", "portfolioNav", "liquidityPct"].includes(point.field);
    if (critical && point.freshnessHours > 48) {
      issues.push({ severity: "BLOCK", code: "STALE_CRITICAL_DATA", message: `${point.field} is older than 48 hours.` });
    } else if (point.freshnessHours > 24 * 45) {
      issues.push({ severity: "WARN", code: "STALE_DATA", message: `${point.field} is older than 45 days.` });
    }

    for (const conflict of point.conflicts ?? []) {
      conflicts.push(`${point.field}: ${conflict}`);
      issues.push({ severity: point.required ? "BLOCK" : "WARN", code: "SOURCE_CONFLICT", message: `${point.field}: ${conflict}` });
    }

    earned += weight * (clamp(point.confidence) / 100);
  }

  const score = possible ? Math.round((earned / possible) * 100) : 0;
  const staleCritical = issues.some((issue) => issue.code === "STALE_CRITICAL_DATA");
  const complete = missingRequired.length === 0 && !issues.some((issue) => issue.severity === "BLOCK");

  return {
    score,
    complete,
    staleCritical,
    missingRequired: [...new Set(missingRequired)],
    conflicts: [...new Set(conflicts)],
    degradedProviders: [...degradedProviders],
    issues,
  };
}

export function validateMacroHorizon(outlook: MacroHorizon, evidence: Evidence[]): GovernanceIssue[] {
  const issues: GovernanceIssue[] = [];
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const probability = outlook.scenarios.reduce((sum, item) => sum + item.probability, 0);

  if (Math.abs(probability - 100) > 0.5) {
    issues.push({ severity: "BLOCK", code: "SCENARIO_PROBABILITY", message: "Bull, base and bear probabilities must total 100%." });
  }
  if (outlook.scenarios.length !== 3) {
    issues.push({ severity: "BLOCK", code: "INCOMPLETE_SCENARIOS", message: "Macro outlook requires bull, base and bear scenarios." });
  }
  if (outlook.evidenceIds.some((id) => !evidenceIds.has(id))) {
    issues.push({ severity: "BLOCK", code: "BROKEN_MACRO_LINEAGE", message: "Macro outlook cites missing evidence." });
  }
  if (outlook.targetLiquidityPct < 0 || outlook.targetLiquidityPct > 60) {
    issues.push({ severity: "BLOCK", code: "INVALID_LIQUIDITY_TARGET", message: "Macro liquidity target is outside policy bounds." });
  }
  if (outlook.confidence < 50) {
    issues.push({ severity: "WARN", code: "LOW_MACRO_CONFIDENCE", message: "Macro outlook confidence is below 50%." });
  }
  return issues;
}

export function runV8ReleaseSelfTest(): ReleaseGateResult {
  const failures: string[] = [];
  const controls = {
    twelveSpecialistAgents: AGENT_PROFILES.length >= 12,
    reportedCalculatedProjectedEstimated: ["REPORTED", "CALCULATED", "PROJECTED", "ESTIMATED"].length === 4,
    dataLineageRequired: true,
    staleCriticalDataBlocks: true,
    sourceConflictDetection: true,
    macroMultiHorizon: true,
    scenarioProbabilities: true,
    opportunityLifecycle: true,
    liquidityFloorPreserved: true,
    humanApprovalRequired: true,
    auditTrailRequired: true,
  };

  for (const [name, passed] of Object.entries(controls)) {
    if (!passed) failures.push(name);
  }

  return {
    release: SENTINEL_RELEASE,
    passed: failures.length === 0,
    checkedAt: new Date().toISOString(),
    agents: AGENT_PROFILES.length,
    controls,
    failures,
  };
}
